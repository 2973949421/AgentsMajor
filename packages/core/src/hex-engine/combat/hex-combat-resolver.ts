import type { HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import { summarizeHexEconomyEvidence, type HexEconomyCombatEvidence, type HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundFinanceDuel } from "../finance/index.js";
import type { HexRoundMemory, HexSide } from "../state/index.js";
import { buildHexCombatCasualties, buildHexCombatSuppressions } from "./hex-combat-casualties.js";
import type { HexCombatAttributionScore } from "./hex-combat-casualties.js";
import { materializeHexCombatMemoryEvents } from "./hex-combat-events.js";
import type {
  HexCombatAudit,
  HexCombatBusinessVerdict,
  HexCombatCasualty,
  HexCombatContact,
  HexCombatControlHint,
  HexCombatFinanceEvidenceAdoption,
  HexCombatFinanceVerdict,
  HexCombatParticipant,
  HexCombatResolution,
  HexCombatResolutionCore,
  HexCombatScoreboard,
  HexCombatSideEvidence,
  HexCombatSuppression,
  HexCombatVarianceAudit,
  HexCombatVarianceMode,
  HexCombatVerdict
} from "./hex-combat-types.js";

export interface ResolveHexCombatInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  contact: HexCombatContact;
  actions: HexValidatedAgentAction[];
  economyContext?: HexRoundEconomyContext;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
  varianceMode?: HexCombatVarianceMode;
  seed?: string;
}

export interface HexCombatVarianceInput {
  attackScore: number;
  defenseScore: number;
  varianceMode?: HexCombatVarianceMode;
  seed?: string;
}

export interface HexCombatVarianceResult {
  attackScore: number;
  defenseScore: number;
  audit: HexCombatVarianceAudit;
}

const financeWeight = 65 as const;
const businessWeight = financeWeight;
const csWeight = 35 as const;
const decisiveMargin = 12;
const pressureMargin = 6;
const varianceThreshold = 5;
const maxVarianceDelta = 3;

export function resolveHexCombat(input: ResolveHexCombatInput): HexCombatResolution {
  const attackEconomyEvidence = summarizeHexEconomyEvidence({
    economyContext: input.economyContext,
    agentIds: input.contact.attackAgentIds
  });
  const defenseEconomyEvidence = summarizeHexEconomyEvidence({
    economyContext: input.economyContext,
    agentIds: input.contact.defenseAgentIds
  });
  const attackEvidence = scoreSide({
    side: "attack",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: attackEconomyEvidence,
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {}),
    ...(input.financeDuel ? { financeDuel: input.financeDuel } : {})
  });
  const defenseEvidence = scoreSide({
    side: "defense",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: defenseEconomyEvidence,
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {}),
    ...(input.financeDuel ? { financeDuel: input.financeDuel } : {})
  });
  const varianceInput: HexCombatVarianceInput = {
    attackScore: attackEvidence.totalScore,
    defenseScore: defenseEvidence.totalScore,
    varianceMode: input.varianceMode ?? "off"
  };
  if (input.seed) {
    varianceInput.seed = input.seed;
  }
  const variance = applyHexCombatVariance(varianceInput);
  const adjustedScores = buildScoreboard(attackEvidence, defenseEvidence, variance.attackScore, variance.defenseScore);
  const margin = Math.abs(adjustedScores.attack.totalScore - adjustedScores.defense.totalScore);
  const advantage = margin < pressureMargin
    ? "contested"
    : adjustedScores.attack.totalScore > adjustedScores.defense.totalScore
      ? "attack"
      : "defense";
  const financeVerdict = input.financeDuel ? buildFinanceVerdict(advantage, adjustedScores) : undefined;
  const financeEvidenceAdoption = input.financeDuel
    ? {
        attack: adjustedScores.attack.financeEvidenceAdoption ?? buildEmptyFinanceEvidenceAdoption("attack"),
        defense: adjustedScores.defense.financeEvidenceAdoption ?? buildEmptyFinanceEvidenceAdoption("defense")
      }
    : undefined;
  const businessVerdict = financeVerdict ? mapFinanceVerdictToBusinessVerdict(financeVerdict) : buildBusinessVerdict(advantage, adjustedScores);
  const verdict = buildVerdict(margin);
  const attributionScores = buildAttributionScores({
    contact: input.contact,
    actions: input.actions,
    businessDuel: input.businessDuel,
    financeDuel: input.financeDuel
  });
  const casualties = buildHexCombatCasualties(input.contact, advantage, verdict, attributionScores);
  const suppressions = buildHexCombatSuppressions(input.contact, advantage, verdict, casualties);
  const businessReasons = [
    ...adjustedScores.attack.reasons.filter((reason) => reason.includes(":business")),
    ...adjustedScores.defense.reasons.filter((reason) => reason.includes(":business")),
    `business_verdict:${businessVerdict}`
  ];
  if (financeVerdict) {
    businessReasons.push("business_compat_from_finance_verdict");
  }
  const financeReasons = input.financeDuel
    ? [
        ...adjustedScores.attack.reasons.filter((reason) => reason.includes(":finance")),
        ...adjustedScores.defense.reasons.filter((reason) => reason.includes(":finance")),
        `finance_verdict:${financeVerdict}`
      ]
    : undefined;
  const csReasons = [
    ...adjustedScores.attack.reasons.filter((reason) => !reason.includes(":business") && !reason.includes(":finance")),
    ...adjustedScores.defense.reasons.filter((reason) => !reason.includes(":business") && !reason.includes(":finance"))
  ];
  const financeReasonZh = financeEvidenceAdoption
    ? buildFinanceReasonZh(financeVerdict, financeEvidenceAdoption)
    : undefined;
  const csReasonZh = buildCsReasonZh(csReasons);
  const audit: HexCombatAudit = {
    businessWeight,
    financeWeight,
    csWeight,
    financeEvidenceApplied: Boolean(input.financeDuel),
    triggerReasons: [...input.contact.triggerReasons],
    variance: variance.audit,
    economy: {
      economyEvidenceApplied: Boolean(input.economyContext),
      attack: attackEconomyEvidence,
      defense: defenseEconomyEvidence,
      reasons: [...attackEconomyEvidence.reasons, ...defenseEconomyEvidence.reasons]
    },
    contactRetention: {
      ...(input.contact.relevanceScore !== undefined ? { relevanceScore: input.contact.relevanceScore } : {}),
      retentionReasons: [...(input.contact.retentionReasons ?? [])],
      ...(input.contact.prunedCandidateCount ? { prunedCandidateCount: input.contact.prunedCandidateCount } : {})
    },
    roleContributions: [...attributionScores.entries()].map(([agentId, score]) => {
      const participant = input.contact.participants.find((candidate) => candidate.agentId === agentId);
      return {
        agentId,
        side: participant?.side ?? "attack",
        roleLabel: score.roleLabel,
        contributionType: score.killerScore > score.assistScore ? "killer" as const : score.assistScore > 0 ? "assist" as const : "neutral" as const,
        scoreDelta: roundScore(Math.max(score.killerScore, score.assistScore)),
        reasons: [...score.reasons]
      };
    })
  };
  if (input.contact.triggerReasons.includes("site_contest") || input.contact.triggerReasons.includes("plant_pressure")) {
    audit.sitePressure = true;
  }
  if (input.contact.triggerReasons.includes("plant_pressure") && advantage === "defense") {
    audit.plantDenied = true;
  }
  if (input.contact.participants.length > 1 && input.contact.triggerReasons.some((reason) => reason === "same_region" || reason === "shared_point" || reason === "nearby_cells")) {
    audit.tradeOpportunity = true;
  }
  const core: HexCombatResolutionCore = {
    contactId: input.contact.contactId,
    phaseId: input.contact.phaseId,
    phaseIndex: input.contact.phaseIndex,
    participants: input.contact.participants.map(cloneParticipant),
    scores: adjustedScores,
    advantage,
    businessVerdict,
    ...(financeVerdict ? { financeVerdict } : {}),
    ...(financeEvidenceAdoption ? { financeEvidenceAdoption } : {}),
    ...(financeReasonZh ? { financeReasonZh } : {}),
    csReasonZh,
    businessReasons,
    ...(financeReasons ? { financeReasons } : {}),
    csReasons,
    verdict,
    casualties,
    suppressions,
    regionControlHint: buildControlHint(advantage, verdict),
    audit
  };

  return {
    ...core,
    memoryEvents: materializeHexCombatMemoryEvents(core)
  };
}

export function applyHexCombatVariance(input: HexCombatVarianceInput): HexCombatVarianceResult {
  const beforeAttackScore = roundScore(input.attackScore);
  const beforeDefenseScore = roundScore(input.defenseScore);
  const mode = input.varianceMode ?? "off";
  if (mode === "off") {
    return buildVarianceResult(beforeAttackScore, beforeDefenseScore, beforeAttackScore, beforeDefenseScore, 0, {
      mode,
      varianceApplied: false,
      reason: "variance_off"
    });
  }
  if (!input.seed) {
    return buildVarianceResult(beforeAttackScore, beforeDefenseScore, beforeAttackScore, beforeDefenseScore, 0, {
      mode,
      varianceApplied: false,
      reason: "missing_seed"
    });
  }
  if (Math.abs(beforeAttackScore - beforeDefenseScore) > varianceThreshold) {
    return buildVarianceResult(beforeAttackScore, beforeDefenseScore, beforeAttackScore, beforeDefenseScore, 0, {
      mode,
      varianceApplied: false,
      reason: "margin_too_large",
      seed: input.seed
    });
  }

  const varianceDelta = hashSeedToDelta(input.seed);
  const afterAttackScore = clampScore(beforeAttackScore + varianceDelta);
  const afterDefenseScore = beforeDefenseScore;
  return buildVarianceResult(beforeAttackScore, beforeDefenseScore, afterAttackScore, afterDefenseScore, varianceDelta, {
    mode,
    varianceApplied: true,
    reason: "close_evidence_margin",
    seed: input.seed
  });
}

function scoreSide(input: {
  side: HexSide;
  contact: HexCombatContact;
  memory: HexRoundMemory;
  actions: HexValidatedAgentAction[];
  economyEvidence: HexEconomyCombatEvidence;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
}): HexCombatSideEvidence {
  const participants = input.contact.participants.filter((participant) => participant.side === input.side);
  const contactRegionIds = new Set(input.contact.regionIds);
  const sideActionsNearContact = input.actions.filter((action) => {
    if (action.side !== input.side) {
      return false;
    }
    const agent = input.memory.agents.find((candidate) => candidate.agentId === action.agentId);
    return Boolean(agent?.currentRegionId && contactRegionIds.has(agent.currentRegionId))
      || participants.some((participant) => participant.agentId === action.agentId);
  });
  const financeEvidenceAdoption = input.financeDuel
    ? buildFinanceEvidenceAdoption({
        side: input.side,
        participants,
        sideActionsNearContact,
        financeDuel: input.financeDuel
      })
    : undefined;
  const financeScore = input.financeDuel
    ? scoreFinanceEvidence(input.side, participants, sideActionsNearContact, input.memory, input.financeDuel, financeEvidenceAdoption)
    : undefined;
  const businessScore = financeScore ?? scoreBusinessEvidence(input.side, participants, sideActionsNearContact, input.memory, input.businessDuel);
  const csScore = scoreCsEvidence(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence);
  return {
    businessScore,
    ...(financeScore !== undefined ? { financeScore } : {}),
    csScore,
    totalScore: roundScore(businessScore + csScore),
    reasons: [
      ...(input.financeDuel
        ? buildFinanceReasons(input.side, participants, sideActionsNearContact, input.memory, input.financeDuel, financeEvidenceAdoption)
        : buildBusinessReasons(input.side, participants, sideActionsNearContact, input.memory, input.businessDuel)),
      ...buildCsReasons(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence)
    ],
    ...(financeEvidenceAdoption ? { financeEvidenceAdoption } : {})
  };
}

function scoreBusinessEvidence(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory,
  businessDuel: HexRoundBusinessDuel | undefined
): number {
  let score = 0;
  const validActions = sideActionsNearContact.filter((action) => action.valid && !action.fallbackReason);
  const businessTexts = validActions.map((action) => action.businessIntent).filter((text) => text.trim().length > 0);
  if (businessTexts.length > 0) {
    score += 15;
  }
  if (validActions.some((action) => action.actionType !== "hold_position")) {
    score += 10;
  }
  score += validActions.length >= 2 ? 15 : validActions.length === 1 ? 8 : 0;
  if (businessTexts.some((text) => matchesSideBusinessLanguage(side, text))) {
    score += 15;
  } else if (businessTexts.length > 0) {
    score += 8;
  }
  const assignedActions = validActions.filter((action) => actionMatchesBusinessAssignment(side, action, businessDuel));
  if (assignedActions.length > 0) {
    score += 15;
  }
  if (businessTexts.some((text) => matchesRoundBusinessLanguage(side, text, businessDuel))) {
    score += 10;
  }
  if (participants.some((participant) => {
    const agent = memory.agents.find((candidate) => candidate.agentId === participant.agentId);
    return Boolean(agent?.actionResultSummary || agent?.businessExecutionSummary);
  })) {
    score += 10;
  }
  return Math.min(businessWeight, score);
}

function buildBusinessReasons(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory,
  businessDuel: HexRoundBusinessDuel | undefined
): string[] {
  const reasons: string[] = [];
  const validActions = sideActionsNearContact.filter((action) => action.valid && !action.fallbackReason);
  if (validActions.some((action) => action.businessIntent.trim().length > 0)) {
    reasons.push(`${side}:business_intent_present`);
  }
  if (validActions.some((action) => action.actionType !== "hold_position")) {
    reasons.push(`${side}:action_matches_combat_pressure`);
  }
  if (validActions.length >= 2) {
    reasons.push(`${side}:team_coordination_near_contact`);
  }
  if (validActions.some((action) => matchesSideBusinessLanguage(side, action.businessIntent))) {
    reasons.push(`${side}:side_specific_business_argument`);
  }
  if (validActions.some((action) => actionMatchesBusinessAssignment(side, action, businessDuel))) {
    reasons.push(`${side}:business_assignment_carried_by_action`);
  }
  if (validActions.some((action) => matchesRoundBusinessLanguage(side, action.businessIntent, businessDuel))) {
    reasons.push(`${side}:business_duel_theme_referenced`);
  }
  if (sideActionsNearContact.some((action) => action.fallbackReason)) {
    reasons.push(`${side}:business_fallback_not_positive_evidence`);
  }
  if (participants.some((participant) => {
    const agent = memory.agents.find((candidate) => candidate.agentId === participant.agentId);
    return Boolean(agent?.actionResultSummary || agent?.businessExecutionSummary);
  })) {
    reasons.push(`${side}:previous_phase_summary_supports_action`);
  }
  return reasons;
}

function scoreFinanceEvidence(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory,
  financeDuel: HexRoundFinanceDuel,
  adoption: HexCombatFinanceEvidenceAdoption | undefined
): number {
  let score = 0;
  const validActions = sideActionsNearContact.filter((action) => action.valid && !action.fallbackReason);
  const financeTexts = validActions.map((action) => action.businessIntent).filter((text) => text.trim().length > 0);
  const acceptedEvidenceCount = adoption?.acceptedEvidenceRefs.length ?? 0;
  const missingEvidenceCount = adoption?.missingEvidenceApplied.length ?? 0;
  if (financeTexts.length > 0) {
    score += 6;
  }
  if (validActions.some((action) => action.actionType !== "hold_position")) {
    score += 8;
  }
  score += validActions.length >= 2 ? 10 : validActions.length === 1 ? 6 : 0;
  if (financeTexts.some((text) => matchesSideFinanceLanguage(side, text))) {
    score += 10;
  } else if (financeTexts.length > 0) {
    score += 4;
  }
  if (validActions.some((action) => actionMatchesFinanceAssignment(side, action, financeDuel))) {
    score += 12;
  }
  if (financeTexts.some((text) => matchesRoundFinanceLanguage(side, text, financeDuel))) {
    score += acceptedEvidenceCount > 0 || missingEvidenceCount > 0 ? 10 : 4;
  }
  if (acceptedEvidenceCount > 0) {
    score += Math.min(18, 8 + acceptedEvidenceCount * 4);
  }
  if (missingEvidenceCount > 0) {
    score += side === "attack" ? Math.min(14, 6 + missingEvidenceCount * 3) : Math.min(8, 3 + missingEvidenceCount * 2);
  }
  if (participants.some((participant) => {
    const agent = memory.agents.find((candidate) => candidate.agentId === participant.agentId);
    return Boolean(agent?.actionResultSummary || agent?.businessExecutionSummary);
  })) {
    score += 5;
  }
  const shouldApplyCap = financeDuel.evidence.scoreCaps.length > 0
    && (acceptedEvidenceCount === 0 || (adoption?.scoreCapRefs.length ?? 0) > 0);
  if (shouldApplyCap) {
    const cap = Math.min(...financeDuel.evidence.scoreCaps.map((candidate) => candidate.maxScore));
    score = Math.min(score, Math.max(0, Math.min(financeWeight, Math.round((cap / 100) * financeWeight))));
  }
  if (acceptedEvidenceCount === 0 && missingEvidenceCount === 0) {
    score = Math.min(score, 20);
  }
  return Math.min(financeWeight, score);
}

function buildFinanceReasons(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory,
  financeDuel: HexRoundFinanceDuel,
  adoption: HexCombatFinanceEvidenceAdoption | undefined
): string[] {
  const reasons: string[] = [];
  const validActions = sideActionsNearContact.filter((action) => action.valid && !action.fallbackReason);
  if (validActions.some((action) => action.businessIntent.trim().length > 0)) {
    reasons.push(`${side}:finance_intent_present`);
  }
  if (validActions.some((action) => action.actionType !== "hold_position")) {
    reasons.push(`${side}:finance_action_matches_combat_pressure`);
  }
  if (validActions.length >= 2) {
    reasons.push(`${side}:finance_team_coordination_near_contact`);
  }
  if (validActions.some((action) => matchesSideFinanceLanguage(side, action.businessIntent))) {
    reasons.push(`${side}:finance_side_specific_argument`);
  }
  if (validActions.some((action) => actionMatchesFinanceAssignment(side, action, financeDuel))) {
    reasons.push(`${side}:finance_assignment_carried_by_action`);
  }
  if (validActions.some((action) => matchesRoundFinanceLanguage(side, action.businessIntent, financeDuel))) {
    reasons.push(`${side}:finance_duel_topic_referenced`);
  }
  if ((adoption?.acceptedEvidenceRefs.length ?? 0) > 0) {
    reasons.push(`${side}:finance_evidence_reference_used`);
  }
  if ((adoption?.missingEvidenceApplied.length ?? 0) > 0) {
    reasons.push(`${side}:finance_missing_evidence_applied`);
  }
  if (validActions.some((action) => mentionsFinanceRiskBoundary(collectActionFinanceText(action), financeDuel))) {
    reasons.push(`${side}:finance_risk_boundary_acknowledged`);
  }
  if (sideActionsNearContact.some((action) => action.fallbackReason)) {
    reasons.push(`${side}:finance_fallback_not_positive_evidence`);
  }
  if ((adoption?.rejectedEvidenceRefs.length ?? 0) > 0) {
    reasons.push(`${side}:finance_evidence_ref_rejected`);
  }
  if ((adoption?.acceptedEvidenceRefs.length ?? 0) === 0 && (adoption?.missingEvidenceApplied.length ?? 0) === 0) {
    reasons.push(`${side}:finance_no_accepted_evidence`);
  }
  if (financeDuel.evidence.scoreCaps.length > 0 && ((adoption?.scoreCapRefs.length ?? 0) > 0 || (adoption?.acceptedEvidenceRefs.length ?? 0) === 0)) {
    reasons.push(`${side}:finance_score_cap_applied_without_evidence_reference`);
  }
  if (participants.some((participant) => {
    const agent = memory.agents.find((candidate) => candidate.agentId === participant.agentId);
    return Boolean(agent?.actionResultSummary || agent?.businessExecutionSummary);
  })) {
    reasons.push(`${side}:previous_phase_summary_supports_finance_action`);
  }
  return reasons;
}

interface FinanceEvidenceRefInfo {
  ref: string;
  factId?: string;
  evidenceId?: string;
  dataMode?: string;
  source?: string;
}

function buildFinanceEvidenceAdoption(input: {
  side: HexSide;
  participants: HexCombatParticipant[];
  sideActionsNearContact: HexValidatedAgentAction[];
  financeDuel: HexRoundFinanceDuel;
}): HexCombatFinanceEvidenceAdoption {
  const acceptedEvidenceRefs = new Set<string>();
  const rejectedEvidenceRefs = new Set<string>();
  const missingEvidenceApplied = new Set<string>();
  const scoreCapRefs = new Set<string>();
  const adoptionReasons = new Set<string>();
  const rejectionReasons = new Set<string>();
  const evidenceIndex = buildFinanceEvidenceIndex(input.financeDuel);

  for (const action of input.sideActionsNearContact) {
    const actionText = collectActionFinanceText(action);
    const referencedInfos = collectReferencedFinanceEvidenceInfos(actionText, evidenceIndex);
    const unknownRefs = collectUnknownEvidenceRefs(actionText, evidenceIndex);
    const actionEligible = actionIsPositiveFinanceEvidence(action);
    if (!actionEligible) {
      const reason = action.fallbackReason ? "fallback_not_positive_finance_evidence" : "invalid_action_not_positive_finance_evidence";
      for (const info of referencedInfos) {
        rejectedEvidenceRefs.add(`${info.ref}:${reason}`);
      }
      for (const ref of unknownRefs) {
        rejectedEvidenceRefs.add(`${ref}:${reason}`);
      }
      if (action.fallbackReason || action.validationErrors.length > 0) {
        rejectionReasons.add(reason);
      }
      continue;
    }

    for (const ref of unknownRefs) {
      rejectedEvidenceRefs.add(`${ref}:unknown_evidence_ref`);
      rejectionReasons.add("unknown_evidence_ref");
    }

    for (const info of referencedInfos) {
      if (info.dataMode === "unavailable_observation") {
        rejectedEvidenceRefs.add(`${info.ref}:unavailable_observation_not_positive_fact`);
        missingEvidenceApplied.add(info.ref);
        rejectionReasons.add("unavailable_observation_not_positive_fact");
        continue;
      }
      acceptedEvidenceRefs.add(info.ref);
      if (info.dataMode === "configured_proxy_fact") {
        adoptionReasons.add(`${info.ref}:configured_proxy_fact_adopted_with_score_cap`);
        addDefaultScoreCaps(input.financeDuel, scoreCapRefs);
      } else {
        adoptionReasons.add(`${info.ref}:evidence_adopted`);
      }
    }

    for (const missing of collectMissingEvidenceApplied(actionText, input.financeDuel)) {
      missingEvidenceApplied.add(missing);
      adoptionReasons.add(`${missing}:missing_evidence_applied`);
    }
    for (const cap of collectScoreCapsApplied(actionText, input.financeDuel)) {
      scoreCapRefs.add(cap);
      adoptionReasons.add(`${cap}:score_cap_applied`);
    }
  }

  if (acceptedEvidenceRefs.size === 0 && missingEvidenceApplied.size === 0) {
    rejectionReasons.add("no_accepted_finance_evidence");
    addDefaultScoreCaps(input.financeDuel, scoreCapRefs);
  }
  return {
    side: input.side,
    acceptedEvidenceRefs: [...acceptedEvidenceRefs],
    rejectedEvidenceRefs: [...rejectedEvidenceRefs],
    missingEvidenceApplied: [...missingEvidenceApplied],
    scoreCapRefs: [...scoreCapRefs],
    adoptionReasons: [...adoptionReasons],
    rejectionReasons: [...rejectionReasons],
    financeReasonZh: buildFinanceAdoptionReasonZh({
      side: input.side,
      acceptedEvidenceRefs,
      rejectedEvidenceRefs,
      missingEvidenceApplied,
      scoreCapRefs
    })
  };
}

function buildEmptyFinanceEvidenceAdoption(side: HexSide): HexCombatFinanceEvidenceAdoption {
  return {
    side,
    acceptedEvidenceRefs: [],
    rejectedEvidenceRefs: [],
    missingEvidenceApplied: [],
    scoreCapRefs: [],
    adoptionReasons: [],
    rejectionReasons: ["missing_finance_evidence_adoption"],
    financeReasonZh: [`${side === "attack" ? "攻方" : "守方"}未记录金融证据采信链。`]
  };
}

function buildFinanceEvidenceIndex(financeDuel: HexRoundFinanceDuel): {
  infos: FinanceEvidenceRefInfo[];
  byToken: Map<string, FinanceEvidenceRefInfo>;
  knownFactRefs: Set<string>;
} {
  const byRef = new Map<string, FinanceEvidenceRefInfo>();
  for (const fact of financeDuel.evidence.facts) {
    byRef.set(fact.factId, {
      ref: fact.factId,
      factId: fact.factId,
      evidenceId: fact.evidenceId,
      dataMode: fact.dataMode,
      source: fact.source
    });
  }
  for (const fact of financeDuel.evidence.promptFacts) {
    byRef.set(fact.factId, {
      ...(byRef.get(fact.factId) ?? { ref: fact.factId, factId: fact.factId }),
      evidenceId: byRef.get(fact.factId)?.evidenceId ?? fact.evidenceId
    });
  }
  for (const ref of [...financeDuel.defenseThesis.evidenceRefs, ...financeDuel.attackChallenge.evidenceRefs]) {
    if (!byRef.has(ref)) {
      byRef.set(ref, { ref });
    }
  }

  const infos = [...byRef.values()];
  const byToken = new Map<string, FinanceEvidenceRefInfo>();
  for (const info of infos) {
    for (const token of [info.ref, info.factId, info.evidenceId, info.source]) {
      const normalized = normalizeFinanceText(token ?? "");
      if (normalized.length >= 2) {
        byToken.set(normalized, info);
      }
    }
  }
  return {
    infos,
    byToken,
    knownFactRefs: new Set(infos.map((info) => info.ref.toUpperCase()))
  };
}

function collectReferencedFinanceEvidenceInfos(
  text: string,
  index: ReturnType<typeof buildFinanceEvidenceIndex>
): FinanceEvidenceRefInfo[] {
  const normalized = normalizeFinanceText(text);
  const refs = new Map<string, FinanceEvidenceRefInfo>();
  for (const [token, info] of index.byToken) {
    if (normalized.includes(token)) {
      refs.set(info.ref, info);
    }
  }
  return [...refs.values()];
}

function collectUnknownEvidenceRefs(text: string, index: ReturnType<typeof buildFinanceEvidenceIndex>): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\bF\d{3,}\b/gi)) {
    const ref = match[0].toUpperCase();
    if (!index.knownFactRefs.has(ref)) {
      refs.add(ref);
    }
  }
  return [...refs];
}

function collectMissingEvidenceApplied(text: string, financeDuel: HexRoundFinanceDuel): string[] {
  const normalized = normalizeFinanceText(text);
  return uniqueStrings(financeDuel.evidence.missingEvidence.filter((item) => {
    const token = normalizeFinanceText(item);
    return token.length >= 2 && normalized.includes(token);
  }));
}

function collectScoreCapsApplied(text: string, financeDuel: HexRoundFinanceDuel): string[] {
  const normalized = normalizeFinanceText(text);
  return uniqueStrings(financeDuel.evidence.scoreCaps.filter((cap) => {
    const condition = normalizeFinanceText(cap.condition);
    const reason = normalizeFinanceText(cap.reason);
    return (condition.length >= 2 && normalized.includes(condition)) || (reason.length >= 4 && normalized.includes(reason.slice(0, 16)));
  }).map((cap) => cap.condition));
}

function addDefaultScoreCaps(financeDuel: HexRoundFinanceDuel, scoreCapRefs: Set<string>): void {
  for (const cap of financeDuel.evidence.scoreCaps) {
    scoreCapRefs.add(cap.condition);
  }
}

function actionIsPositiveFinanceEvidence(action: HexValidatedAgentAction): boolean {
  return action.valid
    && !action.fallbackReason
    && !action.validationErrors.some((error) => ["phase_repeated_round_thesis", "phase_action_reason_too_long"].includes(error));
}

function collectActionFinanceText(action: HexValidatedAgentAction): string {
  return [
    action.businessIntent,
    action.actionRationaleZh,
    action.tacticalIntent,
    ...action.riskNotes
  ].filter(Boolean).join(" ");
}

function buildFinanceAdoptionReasonZh(input: {
  side: HexSide;
  acceptedEvidenceRefs: Set<string>;
  rejectedEvidenceRefs: Set<string>;
  missingEvidenceApplied: Set<string>;
  scoreCapRefs: Set<string>;
}): string[] {
  const sideLabel = input.side === "attack" ? "攻方" : "守方";
  const reasons: string[] = [];
  if (input.acceptedEvidenceRefs.size > 0) {
    reasons.push(`${sideLabel}采信证据：${[...input.acceptedEvidenceRefs].join("、")}。`);
  } else {
    reasons.push(`${sideLabel}没有被采信的正向证据。`);
  }
  if (input.rejectedEvidenceRefs.size > 0) {
    reasons.push(`${sideLabel}未采信引用：${[...input.rejectedEvidenceRefs].join("、")}。`);
  }
  if (input.missingEvidenceApplied.size > 0) {
    reasons.push(`${sideLabel}应用缺失证据约束：${[...input.missingEvidenceApplied].join("、")}。`);
  }
  if (input.scoreCapRefs.size > 0) {
    reasons.push(`${sideLabel}受到评分上限约束：${[...input.scoreCapRefs].join("、")}。`);
  }
  return reasons;
}

function buildFinanceReasonZh(
  verdict: HexCombatFinanceVerdict | undefined,
  adoption: { attack: HexCombatFinanceEvidenceAdoption; defense: HexCombatFinanceEvidenceAdoption }
): string[] {
  const verdictText = verdict === "challenge_landed"
    ? "攻方质疑成立。"
    : verdict === "thesis_defended"
      ? "守方自证守住。"
      : "金融攻防未分胜负。";
  return [
    verdictText,
    ...adoption.attack.financeReasonZh,
    ...adoption.defense.financeReasonZh
  ];
}

function buildCsReasonZh(csReasons: string[]): string[] {
  return uniqueStrings(csReasons.map((reason) => {
    const core = reason.includes(":") ? reason.split(":").at(-1)! : reason;
    const labels: Record<string, string> = {
      numbers_or_trade_support: "人数或补枪结构支持该方。",
      close_cell_distance: "双方距离足够近，形成有效交火。",
      validated_ap_path: "行动路径和 AP 校验通过。",
      map_flag_context: "地图点位或地形标记提供执行证据。",
      active_action_pressure: "行动类型对目标区域形成主动压力。",
      "economy:low_resource_constraint": "经济资源较低，执行强度受限。",
      "economy:high_resource_support": "经济资源支持更高执行强度。"
    };
    return labels[core] ?? `未翻译 CS 技术原因：${reason}`;
  }));
}

function scoreCsEvidence(
  side: HexSide,
  participants: HexCombatParticipant[],
  contact: HexCombatContact,
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): number {
  let score = 0;
  const opponentCount = contact.participants.filter((participant) => participant.side !== side).length;
  score += participants.length >= opponentCount ? 10 : 5;
  score += contact.minCellDistance === undefined ? 2 : contact.minCellDistance <= 1 ? 7 : contact.minCellDistance <= 3 ? 4 : 2;
  if (participants.some((participant) => participant.action.valid)) {
    score += 5;
  }
  score += scoreMapFlags(participants);
  score += participants.every((participant) => participant.lifeStatus === "alive") ? 5 : 2;
  if (participants.some((participant) => isPressureAction(participant.action))) {
    score += 3;
  }
  score += economyScoreAdjustment(sideActionsNearContact, economyEvidence);
  return Math.min(csWeight, Math.max(0, score));
}

function buildCsReasons(
  side: HexSide,
  participants: HexCombatParticipant[],
  contact: HexCombatContact,
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): string[] {
  const reasons: string[] = [];
  const opponentCount = contact.participants.filter((participant) => participant.side !== side).length;
  if (participants.length >= opponentCount) {
    reasons.push(`${side}:numbers_or_trade_support`);
  }
  if (contact.minCellDistance !== undefined && contact.minCellDistance <= 3) {
    reasons.push(`${side}:close_cell_distance`);
  }
  if (participants.some((participant) => participant.action.valid)) {
    reasons.push(`${side}:validated_ap_path`);
  }
  if (scoreMapFlags(participants) > 0) {
    reasons.push(`${side}:map_flag_context`);
  }
  if (participants.some((participant) => isPressureAction(participant.action))) {
    reasons.push(`${side}:active_action_pressure`);
  }
  if (economyEvidence.reasons.length > 0) {
    reasons.push(...economyEvidence.reasons.map((reason) => `${side}:${reason}`));
  }
  if (lowResourceFullExecuteAttempt(sideActionsNearContact, economyEvidence)) {
    reasons.push(`${side}:economy:low_resource_full_execute_penalty`);
  }
  return reasons;
}

function economyScoreAdjustment(sideActionsNearContact: HexValidatedAgentAction[], economyEvidence: HexEconomyCombatEvidence): number {
  let adjustment = economyEvidence.scoreDelta;
  if (lowResourceFullExecuteAttempt(sideActionsNearContact, economyEvidence)) {
    adjustment -= 5;
  }
  return Math.max(-5, Math.min(5, adjustment));
}

function lowResourceFullExecuteAttempt(
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): boolean {
  return economyEvidence.resourceTiers.includes("low") && sideActionsNearContact.some((action) => action.actionType === "execute_site");
}

function buildScoreboard(
  attackEvidence: HexCombatSideEvidence,
  defenseEvidence: HexCombatSideEvidence,
  adjustedAttackTotal: number,
  adjustedDefenseTotal: number
): HexCombatScoreboard {
  return {
    attack: {
      ...attackEvidence,
      totalScore: adjustedAttackTotal
    },
    defense: {
      ...defenseEvidence,
      totalScore: adjustedDefenseTotal
    },
    neutralScore: Math.max(0, roundScore(100 - Math.abs(adjustedAttackTotal - adjustedDefenseTotal)))
  };
}

function buildVerdict(margin: number): HexCombatVerdict {
  if (margin >= decisiveMargin) {
    return "kill";
  }
  if (margin >= pressureMargin) {
    return "wound_or_forced_back";
  }
  return "contested_suppression";
}

function buildControlHint(advantage: "attack" | "defense" | "contested", verdict: HexCombatVerdict): HexCombatControlHint {
  if (advantage === "contested") {
    return "contested";
  }
  return verdict === "contested_suppression" ? "contested" : advantage;
}

function buildBusinessVerdict(advantage: "attack" | "defense" | "contested", scores: HexCombatScoreboard): HexCombatBusinessVerdict {
  if (advantage === "attack" && scores.attack.businessScore >= scores.defense.businessScore) {
    return "challenge_succeeded";
  }
  if (advantage === "defense" && scores.defense.businessScore >= scores.attack.businessScore) {
    return "proof_rebutted_challenge";
  }
  return "contested_no_business_resolution";
}

function buildFinanceVerdict(advantage: "attack" | "defense" | "contested", scores: HexCombatScoreboard): HexCombatFinanceVerdict {
  const attackFinanceScore = scores.attack.financeScore ?? scores.attack.businessScore;
  const defenseFinanceScore = scores.defense.financeScore ?? scores.defense.businessScore;
  if (advantage === "attack" && attackFinanceScore >= defenseFinanceScore) {
    return "challenge_landed";
  }
  if (advantage === "defense" && defenseFinanceScore >= attackFinanceScore) {
    return "thesis_defended";
  }
  return "contested_no_finance_resolution";
}

function mapFinanceVerdictToBusinessVerdict(verdict: HexCombatFinanceVerdict): HexCombatBusinessVerdict {
  if (verdict === "challenge_landed") {
    return "challenge_succeeded";
  }
  if (verdict === "thesis_defended") {
    return "proof_rebutted_challenge";
  }
  return "contested_no_business_resolution";
}

function buildAttributionScores(input: {
  contact: HexCombatContact;
  actions: HexValidatedAgentAction[];
  businessDuel: HexRoundBusinessDuel | undefined;
  financeDuel: HexRoundFinanceDuel | undefined;
}): Map<string, HexCombatAttributionScore> {
  const actionByAgent = new Map(input.actions.map((action) => [action.agentId, action]));
  const financeEvidenceIndex = input.financeDuel ? buildFinanceEvidenceIndex(input.financeDuel) : undefined;
  const scores = new Map<string, HexCombatAttributionScore>();
  for (const participant of input.contact.participants) {
    const action = actionByAgent.get(participant.agentId) ?? participant.action;
    let killerScore = 0;
    let assistScore = 0;
    const reasons: string[] = [];
    if (action.valid && !action.fallbackReason) {
      killerScore += 8;
      assistScore += 4;
      reasons.push("valid_non_fallback_action");
    } else {
      reasons.push("fallback_not_positive_evidence");
    }
    if (action.actionType !== "hold_position") {
      killerScore += 5;
      assistScore += 3;
      reasons.push("non_hold_action");
    }
    if (isPressureAction(action)) {
      killerScore += 5;
      assistScore += 2;
      reasons.push("pressure_action");
    }
    if (isSupportAction(action)) {
      assistScore += 7;
      reasons.push("support_action");
    }
    if (input.financeDuel ? actionMatchesFinanceAssignment(participant.side, action, input.financeDuel) : actionMatchesBusinessAssignment(participant.side, action, input.businessDuel)) {
      killerScore += 5;
      assistScore += 5;
      reasons.push(input.financeDuel ? "finance_assignment_match" : "business_assignment_match");
    }
    if (input.financeDuel ? matchesRoundFinanceLanguage(participant.side, action.businessIntent, input.financeDuel) : matchesRoundBusinessLanguage(participant.side, action.businessIntent, input.businessDuel)) {
      killerScore += 3;
      assistScore += 3;
      reasons.push(input.financeDuel ? "finance_duel_language_match" : "business_duel_language_match");
    }
    const acceptedFinanceRefs = input.financeDuel && financeEvidenceIndex && actionIsPositiveFinanceEvidence(action)
      ? collectReferencedFinanceEvidenceInfos(collectActionFinanceText(action), financeEvidenceIndex)
        .filter((info) => info.dataMode !== "unavailable_observation")
        .map((info) => info.ref)
      : [];
    if (acceptedFinanceRefs.length > 0) {
      killerScore += 2;
      assistScore += 2;
      reasons.push("finance_evidence_reference_used");
      reasons.push(...acceptedFinanceRefs.slice(0, 2).map((ref) => `accepted_finance_evidence:${ref}`));
    }
    if (participant.targetFlags.includes("bombsite_a") || participant.targetFlags.includes("bombsite_b") || participant.currentFlags.includes("cover")) {
      killerScore += 2;
      assistScore += 2;
      reasons.push("map_flag_context");
    }
    const roleContribution = scoreRoleContribution({
      roleLabel: resolveRoleLabel(participant, input.businessDuel, input.financeDuel),
      participant,
      action
    });
    killerScore += roleContribution.killerDelta;
    assistScore += roleContribution.assistDelta;
    reasons.push(...roleContribution.reasons);
    if (participant.supportParticipant) {
      assistScore += 6;
      killerScore = Math.max(0, killerScore - 4);
      reasons.push("same_side_support_participant");
    }
    scores.set(participant.agentId, {
      killerScore: roundScore(Math.max(0, killerScore)),
      assistScore: roundScore(Math.max(0, assistScore)),
      roleLabel: roleContribution.roleLabel,
      reasons
    });
  }
  return scores;
}

function scoreRoleContribution(input: {
  roleLabel: string;
  participant: HexCombatParticipant;
  action: HexValidatedAgentAction;
}): { roleLabel: string; killerDelta: number; assistDelta: number; reasons: string[] } {
  const reasons: string[] = [];
  let killerDelta = 0;
  let assistDelta = 0;
  if (!input.action.valid || input.action.fallbackReason) {
    return { roleLabel: input.roleLabel, killerDelta, assistDelta, reasons: ["role_fallback_no_positive_contribution"] };
  }
  if (input.roleLabel === "awper" && ["watch_angle", "peek", "seek_duel"].includes(input.action.actionType)) {
    killerDelta += 10;
    assistDelta += 2;
    reasons.push("role_awper_angle_or_pick");
  }
  if (input.roleLabel === "star_rifler" && ["peek", "seek_duel", "execute_site", "retake"].includes(input.action.actionType)) {
    killerDelta += 9;
    assistDelta += 2;
    reasons.push("role_star_rifler_pressure");
  }
  if (input.roleLabel === "entry" && ["peek", "seek_duel", "execute_site"].includes(input.action.actionType)) {
    killerDelta += 8;
    assistDelta += 1;
    reasons.push("role_entry_first_contact");
  }
  if (input.roleLabel === "igl" && ["map_control", "prepare_trade", "watch_angle", "hold_position"].includes(input.action.actionType)) {
    killerDelta += 1;
    assistDelta += 9;
    reasons.push("role_igl_control_or_trade_setup");
  }
  if (input.roleLabel === "support" && ["prepare_trade", "use_utility", "map_control", "watch_angle", "hold_position"].includes(input.action.actionType)) {
    assistDelta += 10;
    reasons.push("role_support_setup_or_cover");
  }
  if (reasons.length === 0) {
    reasons.push(`role_${input.roleLabel}_neutral`);
  }
  return { roleLabel: input.roleLabel, killerDelta, assistDelta, reasons };
}

function resolveRoleLabel(
  participant: HexCombatParticipant,
  businessDuel: HexRoundBusinessDuel | undefined,
  financeDuel?: HexRoundFinanceDuel | undefined
): string {
  const fromFinanceDuel = financeDuel?.agentAssignments.find((assignment) => assignment.agentId === participant.agentId)?.role;
  if (fromFinanceDuel) {
    return normalizeRoleLabel(fromFinanceDuel);
  }
  const fromDuel = businessDuel?.agentAssignments.find((assignment) => assignment.agentId === participant.agentId)?.role;
  return normalizeRoleLabel(fromDuel ?? participant.roleLabel);
}

function normalizeRoleLabel(role: string | undefined): string {
  const normalized = (role ?? "unknown").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("awp")) {
    return "awper";
  }
  if (normalized.includes("star")) {
    return "star_rifler";
  }
  if (normalized.includes("entry")) {
    return "entry";
  }
  if (normalized.includes("igl") || normalized.includes("leader")) {
    return "igl";
  }
  if (normalized.includes("support")) {
    return "support";
  }
  if (normalized.includes("rifler")) {
    return "rifler";
  }
  return normalized || "unknown";
}

function actionMatchesBusinessAssignment(
  side: HexSide,
  action: HexValidatedAgentAction,
  businessDuel: HexRoundBusinessDuel | undefined
): boolean {
  if (!businessDuel || !action.valid || action.fallbackReason) {
    return false;
  }
  const assignment = businessDuel.agentAssignments.find((candidate) => candidate.agentId === action.agentId && candidate.side === side);
  if (!assignment) {
    return false;
  }
  if (side === "attack" && assignment.linkedChallengeId !== businessDuel.attackChallenge.challengeId) {
    return false;
  }
  if (side === "defense" && assignment.linkedProofId !== businessDuel.defenseProof.proofId) {
    return false;
  }
  return action.businessIntent.trim().length > 0 && matchesSideBusinessLanguage(side, action.businessIntent);
}

function actionMatchesFinanceAssignment(
  side: HexSide,
  action: HexValidatedAgentAction,
  financeDuel: HexRoundFinanceDuel
): boolean {
  if (!action.valid || action.fallbackReason) {
    return false;
  }
  const assignment = financeDuel.agentAssignments.find((candidate) => candidate.agentId === action.agentId && candidate.side === side);
  if (!assignment) {
    return false;
  }
  if (side === "attack" && assignment.linkedChallengeId !== financeDuel.attackChallenge.challengeId) {
    return false;
  }
  if (side === "defense" && assignment.linkedThesisId !== financeDuel.defenseThesis.thesisId) {
    return false;
  }
  return action.businessIntent.trim().length > 0 && (
    matchesSideFinanceLanguage(side, action.businessIntent)
    || matchesRoundFinanceLanguage(side, action.businessIntent, financeDuel)
    || referencesFinanceEvidence(action.businessIntent, financeDuel)
  );
}

function matchesRoundBusinessLanguage(
  side: HexSide,
  text: string,
  businessDuel: HexRoundBusinessDuel | undefined
): boolean {
  if (!businessDuel || text.trim().length === 0) {
    return false;
  }
  const haystack = normalizeBusinessText(text);
  const sourceTexts = side === "attack"
    ? [
      businessDuel.subtheme.title,
      businessDuel.subtheme.attackQuestion,
      businessDuel.attackChallenge.thesis,
      ...businessDuel.attackChallenge.challengePoints,
      ...businessDuel.attackChallenge.targetFailureModes
    ]
    : [
      businessDuel.subtheme.title,
      businessDuel.subtheme.defenseQuestion,
      businessDuel.defenseProof.thesis,
      ...businessDuel.defenseProof.claims,
      ...businessDuel.defenseProof.evidenceFocus
    ];
  return sourceTexts.some((candidate) => {
    const normalized = normalizeBusinessText(candidate);
    return normalized.length >= 2 && (haystack.includes(normalized) || normalized.includes(haystack));
  });
}

function matchesSideBusinessLanguage(side: HexSide, text: string): boolean {
  const normalized = text.toLowerCase();
  const attackTerms = ["breach", "challenge", "pressure", "entry", "execute", "exploit", "质疑", "漏洞", "突破", "进点", "切入"];
  const defenseTerms = ["defend", "hold", "anchor", "deny", "response", "防守", "回应", "顶住", "守住", "拦截"];
  const terms = side === "attack" ? attackTerms : defenseTerms;
  return terms.some((term) => normalized.includes(term));
}

function normalizeBusinessText(text: string): string {
  return text.toLowerCase().replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, "");
}

function matchesRoundFinanceLanguage(
  side: HexSide,
  text: string,
  financeDuel: HexRoundFinanceDuel
): boolean {
  if (text.trim().length === 0) {
    return false;
  }
  const haystack = normalizeFinanceText(text);
  const sourceTexts = side === "attack"
    ? [
      financeDuel.topic.topicTitle,
      financeDuel.topic.attackChallengeFocus,
      financeDuel.attackChallenge.thesis,
      ...financeDuel.attackChallenge.challengePoints,
      ...financeDuel.attackChallenge.requiredDefense,
      ...financeDuel.evidence.missingEvidence
    ]
    : [
      financeDuel.topic.topicTitle,
      financeDuel.topic.defenseThesisFocus,
      financeDuel.defenseThesis.thesis,
      ...financeDuel.defenseThesis.keyAssumptions,
      financeDuel.defenseThesis.riskBoundary,
      ...financeDuel.evidence.promptFacts.map((fact) => fact.shortText)
    ];
  return sourceTexts.some((candidate) => {
    const normalized = normalizeFinanceText(candidate);
    return normalized.length >= 4 && (haystack.includes(normalized.slice(0, Math.min(16, normalized.length))) || normalized.includes(haystack));
  });
}

function matchesSideFinanceLanguage(side: HexSide, text: string): boolean {
  const normalized = text.toLowerCase();
  const attackTerms = ["质疑", "反证", "挑战", "风险", "假设", "估值", "周期", "供需", "下修", "缺口", "证据不足", "challenge", "risk", "valuation"];
  const defenseTerms = ["自证", "主张", "支撑", "证明", "证据", "风险边界", "周期", "供需", "估值", "守住", "thesis", "evidence"];
  const terms = side === "attack" ? attackTerms : defenseTerms;
  return terms.some((term) => normalized.includes(term));
}

function referencesFinanceEvidence(text: string, financeDuel: HexRoundFinanceDuel): boolean {
  const normalized = normalizeFinanceText(text);
  const evidenceTokens = [
    ...financeDuel.defenseThesis.evidenceRefs,
    ...financeDuel.attackChallenge.evidenceRefs,
    ...financeDuel.evidence.promptFacts.flatMap((fact) => [fact.factId, fact.evidenceId]),
    ...financeDuel.evidence.facts.flatMap((fact) => [fact.factId, fact.evidenceId, fact.metricName, fact.source])
  ].map(normalizeFinanceText).filter((token) => token.length >= 2);
  return evidenceTokens.some((token) => normalized.includes(token));
}

function mentionsFinanceRiskBoundary(text: string, financeDuel: HexRoundFinanceDuel): boolean {
  const normalized = normalizeFinanceText(text);
  const boundaryTokens = [
    ...financeDuel.evidence.missingEvidence,
    ...financeDuel.evidence.scoreCaps.map((cap) => cap.condition),
    ...financeDuel.evidence.scoreCaps.map((cap) => cap.reason),
    "缺失",
    "缺少",
    "评分上限",
    "代理事实",
    "不能证明",
    "风险边界"
  ].map(normalizeFinanceText).filter((token) => token.length >= 2);
  return boundaryTokens.some((token) => normalized.includes(token));
}

function normalizeFinanceText(text: string): string {
  return text.toLowerCase().replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff:]+/gu, "");
}

function scoreMapFlags(participants: HexCombatParticipant[]): number {
  const flags = new Set(participants.flatMap((participant) => [...participant.currentFlags, ...participant.targetFlags]));
  if (flags.has("cover") || flags.has("bombsite_a") || flags.has("bombsite_b")) {
    return 5;
  }
  if (flags.has("choke") || flags.has("route_hint")) {
    return 3;
  }
  if (flags.has("high_risk")) {
    return 1;
  }
  return 0;
}

function isPressureAction(action: HexValidatedAgentAction): boolean {
  return action.valid && ["peek", "seek_duel", "execute_site", "retake", "defuse_bomb", "plant_bomb", "map_control"].includes(action.actionType);
}

function isSupportAction(action: HexValidatedAgentAction): boolean {
  return action.valid && ["prepare_trade", "use_utility", "map_control", "watch_angle", "hold_position"].includes(action.actionType);
}

function buildVarianceResult(
  beforeAttackScore: number,
  beforeDefenseScore: number,
  afterAttackScore: number,
  afterDefenseScore: number,
  varianceDelta: number,
  audit: Pick<HexCombatVarianceAudit, "mode" | "varianceApplied" | "reason" | "seed">
): HexCombatVarianceResult {
  const varianceAudit: HexCombatVarianceAudit = {
    mode: audit.mode,
    varianceApplied: audit.varianceApplied,
    reason: audit.reason,
    beforeAttackScore,
    beforeDefenseScore,
    afterAttackScore,
    afterDefenseScore,
    varianceDelta
  };
  if (audit.seed) {
    varianceAudit.seed = audit.seed;
  }
  return {
    attackScore: afterAttackScore,
    defenseScore: afterDefenseScore,
    audit: varianceAudit
  };
}

function hashSeedToDelta(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % (maxVarianceDelta * 2 + 1)) - maxVarianceDelta;
}

function cloneParticipant(participant: HexCombatParticipant): HexCombatParticipant {
  const cloned: HexCombatParticipant = {
    ...participant,
    currentPointIds: [...participant.currentPointIds],
    targetPointIds: [...participant.targetPointIds],
    currentFlags: [...participant.currentFlags],
    targetFlags: [...participant.targetFlags]
  };
  if (participant.currentRegionId) {
    cloned.currentRegionId = participant.currentRegionId;
  }
  if (participant.targetRegionId) {
    cloned.targetRegionId = participant.targetRegionId;
  }
  return cloned;
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, roundScore(value)));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
