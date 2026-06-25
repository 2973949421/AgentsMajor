import type { HexMapAsset } from "@agent-major/shared";
import type { HexRoundStartAgentOutputForAction, HexValidatedAgentAction } from "../action/index.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import { summarizeHexEconomyEvidence, type HexEconomyCombatEvidence, type HexRoundEconomyContext } from "../economy/index.js";
import { judgeHexFinanceEvidence, type HexFinanceEvidenceJudgeSideResult } from "../finance/index.js";
import type { HexFinanceCombatEffectCap, HexRoundFinanceDuel, HexSubmittedFinanceOutput } from "../finance/index.js";
import type { HexRoundMemory, HexSide } from "../state/index.js";
import { buildHexCombatCasualties, buildHexCombatSuppressions } from "./hex-combat-casualties.js";
import type { HexCombatAttributionScore } from "./hex-combat-casualties.js";
import { materializeHexCombatMemoryEvents } from "./hex-combat-events.js";
import type {
  HexCombatAudit,
  HexCombatAttributionHistory,
  HexCombatAdvantage,
  HexCombatBusinessVerdict,
  HexCombatCasualty,
  HexCombatContact,
  HexCombatControlHint,
  HexCombatDuelPair,
  HexCombatEffectAllowed,
  HexCombatFinanceEvidenceAdoption,
  HexCombatFinanceFirepowerScore,
  HexCombatFinanceProjection,
  HexCombatFinanceVerdict,
  HexCombatFireLane,
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
  roundStartAgentOutputs?: readonly HexRoundStartAgentOutputForAction[];
  submittedFinanceOutputs?: readonly HexSubmittedFinanceOutput[];
  varianceMode?: HexCombatVarianceMode;
  seed?: string;
  attributionHistory?: HexCombatAttributionHistory;
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

interface HexCombatOutcome {
  advantage: HexCombatAdvantage;
  verdict: HexCombatVerdict;
  auditReasons: string[];
}

interface HexDirectDuelPressure {
  side: HexSide;
  score: number;
  reasons: string[];
}

const financeWeight = 65 as const;
const businessWeight = financeWeight;
const csWeight = 35 as const;
const decisiveMargin = 12;
const pressureMargin = 6;
const closePressureMargin = 3;
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
  const financeJudge = input.financeDuel
    ? judgeHexFinanceEvidence({
        financeDuel: input.financeDuel,
        ...(input.submittedFinanceOutputs ? { submittedFinanceOutputs: input.submittedFinanceOutputs } : {}),
        roundStartAgentOutputs: input.roundStartAgentOutputs ?? []
      })
    : undefined;
  const attackEvidence = scoreSide({
    side: "attack",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: attackEconomyEvidence,
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {}),
    ...(input.financeDuel ? { financeDuel: input.financeDuel } : {}),
    ...(financeJudge ? { financeJudgeSide: financeJudge.attack } : {}),
    submittedFinanceOutputs: input.submittedFinanceOutputs ?? []
  });
  const defenseEvidence = scoreSide({
    side: "defense",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: defenseEconomyEvidence,
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {}),
    ...(input.financeDuel ? { financeDuel: input.financeDuel } : {}),
    ...(financeJudge ? { financeJudgeSide: financeJudge.defense } : {}),
    submittedFinanceOutputs: input.submittedFinanceOutputs ?? []
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
  const outcome = buildCombatOutcome(adjustedScores, input.contact);
  const advantage = outcome.advantage;
  const financeEvidenceAdoption = input.financeDuel
    ? {
        attack: adjustedScores.attack.financeEvidenceAdoption ?? buildEmptyFinanceEvidenceAdoption("attack"),
        defense: adjustedScores.defense.financeEvidenceAdoption ?? buildEmptyFinanceEvidenceAdoption("defense")
      }
    : undefined;
  const financeVerdict = input.financeDuel ? buildFinanceVerdict(advantage, adjustedScores, financeEvidenceAdoption) : undefined;
  const businessVerdict = financeVerdict ? mapFinanceVerdictToBusinessVerdict(financeVerdict) : buildBusinessVerdict(advantage, adjustedScores);
  const verdict = outcome.verdict;
  const attributionScores = buildAttributionScores({
    contact: input.contact,
    actions: input.actions,
    businessDuel: input.businessDuel,
    financeDuel: input.financeDuel,
    ...(input.attributionHistory ? { attributionHistory: input.attributionHistory } : {})
  });
  const casualties = buildHexCombatCasualties(input.contact, advantage, verdict, attributionScores);
  const suppressions = buildHexCombatSuppressions(input.contact, advantage, verdict, casualties);
  const financeProjection = financeEvidenceAdoption
    ? buildFinanceProjection({
        adoption: financeEvidenceAdoption,
        contact: input.contact,
        verdict,
        casualties
      })
    : undefined;
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
        ...adjustedScores.attack.reasons.filter((reason) => reason.includes(":finance") || reason.includes(":n59") || reason.includes(":n63")),
        ...adjustedScores.defense.reasons.filter((reason) => reason.includes(":finance") || reason.includes(":n59") || reason.includes(":n63")),
        ...(financeProjection?.projectionReasons ?? []),
        `finance_verdict:${financeVerdict}`
      ]
    : undefined;
  const csReasons = [
    ...adjustedScores.attack.reasons.filter(isCsReason),
    ...adjustedScores.defense.reasons.filter(isCsReason),
    `contact:threat_level:${input.contact.contactThreatLevel ?? "observation"}`,
    ...(input.contact.lethalEligible ? ["contact:lethal_gate_passed"] : ["contact:lethal_gate_blocked"]),
    ...(input.contact.lethalGateReasons ?? []).map((reason) => `contact:${reason}`),
    ...(input.contact.lethalGateBlockedReasons ?? []).map((reason) => `contact:${reason}`),
    ...outcome.auditReasons
  ];
  const financeReasonZh = financeEvidenceAdoption
    ? buildFinanceReasonZh(financeVerdict, financeEvidenceAdoption)
    : undefined;
  const csReasonZh = buildCsReasonZh(csReasons);
  const duelPairingAudit = buildDuelPairingAudit(input.contact);
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
    contactThreat: {
      level: input.contact.contactThreatLevel ?? "observation",
      lethalEligible: Boolean(input.contact.lethalEligible),
      lethalGateReasons: [...(input.contact.lethalGateReasons ?? [])],
      lethalGateBlockedReasons: [...(input.contact.lethalGateBlockedReasons ?? [])],
      lineOfFireExposure: Boolean(input.contact.lineOfFireExposure),
      openSightNoCover: Boolean(input.contact.openSightNoCover),
      samePointExposure: Boolean(input.contact.samePointExposure),
      objectiveExposure: Boolean(input.contact.objectiveExposure),
      implicitDuelFromMovement: Boolean(input.contact.implicitDuelFromMovement),
      coverBlockedLethal: Boolean(input.contact.coverBlockedLethal)
    },
    contactRetention: {
      ...(input.contact.relevanceScore !== undefined ? { relevanceScore: input.contact.relevanceScore } : {}),
      retentionReasons: [...(input.contact.retentionReasons ?? [])],
      ...(input.contact.prunedCandidateCount ? { prunedCandidateCount: input.contact.prunedCandidateCount } : {})
    },
    ...(duelPairingAudit ? { duelPairing: duelPairingAudit } : {}),
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
    duelPairs: input.contact.duelPairs.map(cloneDuelPair),
    fireLanes: input.contact.fireLanes.map(cloneFireLane),
    pressureKeys: [...input.contact.pressureKeys],
    scores: adjustedScores,
    advantage,
    businessVerdict,
    ...(financeVerdict ? { financeVerdict } : {}),
    ...(financeEvidenceAdoption ? { financeEvidenceAdoption } : {}),
    ...(financeProjection ? { financeProjection } : {}),
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

function isCsReason(reason: string): boolean {
  return !reason.includes(":business")
    && !reason.includes(":finance")
    && !reason.includes(":n59")
    && !reason.includes(":n60");
}

function buildDuelPairingAudit(contact: HexCombatContact): HexCombatAudit["duelPairing"] | undefined {
  if ((contact.duelPairs?.length ?? 0) === 0 && (contact.fireLanes?.length ?? 0) === 0 && (contact.pressureKeys?.length ?? 0) === 0) {
    return undefined;
  }
  const primary = [...(contact.duelPairs ?? [])].sort((left, right) => right.directnessScore - left.directnessScore || left.duelPairId.localeCompare(right.duelPairId))[0];
  const reasons = uniqueStrings([
    "n65_lite_duel_pairing",
    ...(primary?.reasons ?? []),
    ...(contact.fireLanes ?? []).flatMap((lane) => lane.exposureFlags)
  ]);
  return {
    ...(primary ? { primaryDuelPairId: primary.duelPairId, primaryPressureKey: primary.pressureKey } : {}),
    duelPairCount: contact.duelPairs?.length ?? 0,
    fireLaneCount: contact.fireLanes?.length ?? 0,
    pressureKeys: [...(contact.pressureKeys ?? [])],
    reasons
  };
}

function scoreSide(input: {
  side: HexSide;
  contact: HexCombatContact;
  memory: HexRoundMemory;
  actions: HexValidatedAgentAction[];
  economyEvidence: HexEconomyCombatEvidence;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
  financeJudgeSide?: HexFinanceEvidenceJudgeSideResult;
  submittedFinanceOutputs?: readonly HexSubmittedFinanceOutput[];
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
    ? input.financeJudgeSide
      ? mapFinanceJudgeSideToCombatAdoption(input.financeJudgeSide)
      : buildEmptyFinanceEvidenceAdoption(input.side)
    : undefined;
  const financeFirepowerScore = input.financeDuel
    ? buildFinanceFirepowerScore({
        side: input.side,
        participants,
        contact: input.contact,
        adoption: financeEvidenceAdoption,
        submittedFinanceOutputs: input.submittedFinanceOutputs ?? []
      })
    : undefined;
  const financeScore = financeFirepowerScore?.appliedToCombatScore;
  const businessScore = input.financeDuel ? 0 : scoreBusinessEvidence(input.side, participants, sideActionsNearContact, input.memory, input.businessDuel);
  const csScore = scoreCsEvidence(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence);
  return {
    businessScore,
    ...(financeScore !== undefined ? { financeScore } : {}),
    ...(financeFirepowerScore ? { financeFirepowerScore } : {}),
    csScore,
    totalScore: roundScore(input.financeDuel ? (financeScore ?? 0) + csScore : businessScore + csScore),
    reasons: [
      ...(input.financeDuel
        ? buildFinanceReasons(input.side, participants, sideActionsNearContact, input.memory, input.financeDuel, financeEvidenceAdoption, financeFirepowerScore)
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

function scoreFinanceEvidence(adoption: HexCombatFinanceEvidenceAdoption | undefined): number {
  if (!adoption || adoption.acceptedEvidenceRefs.length === 0) {
    return 0;
  }
  return Math.min(financeWeight, Math.round((adoption.sideScore / 100) * financeWeight));
}
interface FinanceFirepowerCap {
  pressure: number;
  lethal: number;
  label: string;
}

function buildFinanceFirepowerScore(input: {
  side: HexSide;
  participants: HexCombatParticipant[];
  contact: HexCombatContact;
  adoption: HexCombatFinanceEvidenceAdoption | undefined;
  submittedFinanceOutputs: readonly HexSubmittedFinanceOutput[];
}): HexCombatFinanceFirepowerScore {
  const participantIds = new Set(input.participants.map((participant) => participant.agentId));
  const participantOutputs = input.submittedFinanceOutputs.filter((output) =>
    participantIds.has(output.agentId)
    && output.cardKind === (input.side === "defense" ? "stance" : "challenge")
  );
  const combatUsableOutputs = participantOutputs.filter((output) => output.submittedUsableForCombat && !output.orphanedChallenge);
  const acceptedEvidenceSet = new Set(input.adoption?.acceptedEvidenceRefs ?? []);
  const acceptedRefSet = new Set(input.side === "defense" ? input.adoption?.acceptedClaims ?? [] : input.adoption?.acceptedChallenges ?? []);
  const participantAcceptedEvidenceRefs = new Set<string>();
  const participantAcceptedClaimRefs = new Set<string>();

  for (const output of combatUsableOutputs) {
    if (input.side === "defense" && output.submittedStanceCard) {
      for (const claim of output.submittedStanceCard.coreClaims) {
        if (acceptedRefSet.has(claim.claimId)) {
          participantAcceptedClaimRefs.add(claim.claimId);
        }
        for (const evidenceRef of claim.evidenceRefs) {
          if (acceptedEvidenceSet.has(evidenceRef)) {
            participantAcceptedEvidenceRefs.add(evidenceRef);
          }
        }
      }
    }
    if (input.side === "attack" && output.submittedChallengeCard) {
      for (const challenge of output.submittedChallengeCard.challenges) {
        if (acceptedRefSet.has(challenge.challengeId)) {
          participantAcceptedClaimRefs.add(challenge.challengeId);
        }
        for (const evidenceRef of challenge.evidenceRefs) {
          if (acceptedEvidenceSet.has(evidenceRef)) {
            participantAcceptedEvidenceRefs.add(evidenceRef);
          }
        }
      }
      for (const evidenceRef of output.submittedChallengeCard.evidenceRefs) {
        if (acceptedEvidenceSet.has(evidenceRef)) {
          participantAcceptedEvidenceRefs.add(evidenceRef);
        }
      }
    }
  }

  const auditReasons: string[] = [];
  if (participantOutputs.length === 0) {
    auditReasons.push("no_participant_submitted_finance_output");
  }
  if (combatUsableOutputs.length < participantOutputs.length) {
    auditReasons.push("participant_submitted_output_not_combat_usable_filtered");
  }
  if (participantAcceptedEvidenceRefs.size === 0) {
    auditReasons.push("no_participant_accepted_evidence");
  }

  const n59Cap = capFromN59Effects(input.adoption?.combatEffectAllowed ?? []);
  const n62Cap = capFromSubmittedOutputs(combatUsableOutputs);
  const baseScore = participantAcceptedEvidenceRefs.size === 0
    ? 0
    : Math.min(
      input.adoption?.sideScore ?? 0,
      15 + participantAcceptedEvidenceRefs.size * 12 + participantAcceptedClaimRefs.size * 8
    );
  const rawPressureScore = Math.round((baseScore / 100) * 45);
  const rawLethalScore = Math.round((baseScore / 100) * 20);
  const pressureScore = Math.min(rawPressureScore, n59Cap.pressure, n62Cap.pressure);
  const lethalScore = Math.min(rawLethalScore, n59Cap.lethal, n62Cap.lethal);
  const blockedLethalScore = input.contact.lethalEligible ? 0 : lethalScore;
  const appliedToCombatScore = pressureScore + (input.contact.lethalEligible ? lethalScore : 0);
  const caps = [`n59:${n59Cap.label}`, `n62:${n62Cap.label}`];
  if (pressureScore < rawPressureScore || lethalScore < rawLethalScore) {
    auditReasons.push("finance_firepower_cap_applied");
  }
  if (!input.contact.lethalEligible && lethalScore > 0) {
    auditReasons.push("finance_lethal_score_blocked_by_contact_gate");
  }
  if (appliedToCombatScore > 0) {
    auditReasons.push("finance_firepower_applied_to_combat_score");
  }

  return {
    side: input.side,
    pressureScore: roundScore(pressureScore),
    lethalScore: roundScore(lethalScore),
    totalScore: roundScore(pressureScore + lethalScore),
    appliedToCombatScore: roundScore(appliedToCombatScore),
    blockedLethalScore: roundScore(blockedLethalScore),
    participantAcceptedEvidenceRefs: [...participantAcceptedEvidenceRefs],
    participantAcceptedClaimRefs: [...participantAcceptedClaimRefs],
    participantSubmittedOutputRefs: combatUsableOutputs.map((output) => output.submittedOutputId),
    capApplied: caps.join("|"),
    caps,
    auditReasons: uniqueStrings(auditReasons)
  };
}

function capFromN59Effects(effects: readonly HexCombatEffectAllowed[]): FinanceFirepowerCap {
  if (effects.includes("possible_kill")) return { pressure: 45, lethal: 20, label: "possible_kill" };
  if (effects.includes("force_reposition") || effects.includes("map_control")) return { pressure: 30, lethal: 0, label: "force_reposition_or_map_control" };
  if (effects.includes("pressure")) return { pressure: 18, lethal: 0, label: "pressure" };
  if (effects.includes("minor_delay")) return { pressure: 5, lethal: 0, label: "minor_delay" };
  return { pressure: 0, lethal: 0, label: "no_effect" };
}

function capFromSubmittedOutputs(outputs: readonly HexSubmittedFinanceOutput[]): FinanceFirepowerCap {
  if (outputs.length === 0) {
    return { pressure: 0, lethal: 0, label: "none" };
  }
  return outputs.map((output) => capFromN62Effect(output.combatEffectCap))
    .sort((left, right) => (right.pressure + right.lethal) - (left.pressure + left.lethal))[0]!;
}

function capFromN62Effect(effect: HexFinanceCombatEffectCap): FinanceFirepowerCap {
  switch (effect) {
    case "possible_kill": return { pressure: 45, lethal: 20, label: "possible_kill" };
    case "possible_wound": return { pressure: 38, lethal: 8, label: "possible_wound" };
    case "forced_back": return { pressure: 30, lethal: 0, label: "forced_back" };
    case "suppression": return { pressure: 18, lethal: 0, label: "suppression" };
    case "weak_pressure": return { pressure: 10, lethal: 0, label: "weak_pressure" };
    case "minor_delay": return { pressure: 5, lethal: 0, label: "minor_delay" };
    case "none": return { pressure: 0, lethal: 0, label: "none" };
  }
}
function buildFinanceReasons(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory,
  financeDuel: HexRoundFinanceDuel,
  adoption: HexCombatFinanceEvidenceAdoption | undefined,
  firepower: HexCombatFinanceFirepowerScore | undefined
): string[] {
  void participants;
  void memory;
  void financeDuel;
  const reasons: string[] = [];
  const validActions = sideActionsNearContact.filter((action) => action.valid && !action.fallbackReason);
  if (validActions.some((action) => action.businessIntent.trim().length > 0 || action.actionRationaleZh?.trim())) {
    reasons.push(`${side}:finance_intent_present_audit_only`);
  }
  if ((adoption?.acceptedEvidenceRefs.length ?? 0) > 0) {
    reasons.push(`${side}:n59_accepted_evidence_present`);
  } else {
    reasons.push(`${side}:n59_no_accepted_evidence`);
  }
  if ((firepower?.appliedToCombatScore ?? 0) > 0) {
    reasons.push(`${side}:n63_finance_firepower_applied:${firepower?.appliedToCombatScore}`);
  }
  if ((firepower?.blockedLethalScore ?? 0) > 0) {
    reasons.push(`${side}:n63_finance_lethal_blocked_by_contact_gate:${firepower?.blockedLethalScore}`);
  }
  if (firepower?.caps.some((cap) => cap.startsWith("n62:"))) {
    reasons.push(`${side}:n63_finance_firepower_capped_by_economy`);
  }
  if (firepower?.caps.some((cap) => cap.startsWith("n59:"))) {
    reasons.push(`${side}:n63_finance_firepower_capped_by_n59_projection`);
  }
  if ((adoption?.rejectedEvidenceRefs.length ?? 0) > 0) {
    reasons.push(`${side}:n59_rejected_evidence_present`);
  }
  if ((adoption?.missingEvidenceApplied.length ?? 0) > 0) {
    reasons.push(`${side}:n59_missing_evidence_applied`);
  }
  if ((adoption?.scoreCapRefs.length ?? 0) > 0) {
    reasons.push(`${side}:n59_score_cap_applied`);
  }
  if (sideActionsNearContact.some((action) => action.fallbackReason)) {
    reasons.push(`${side}:finance_fallback_not_positive_evidence`);
  }
  reasons.push(...(firepower?.auditReasons ?? []).map((reason) => `${side}:n63:${reason}`));
  reasons.push(...(adoption?.auditReasons ?? []).map((reason) => `${side}:n59:${reason}`));
  return uniqueStrings(reasons);
}
function buildFinanceProjection(input: {
  adoption: { attack: HexCombatFinanceEvidenceAdoption; defense: HexCombatFinanceEvidenceAdoption };
  contact: HexCombatContact;
  verdict: HexCombatVerdict;
  casualties: HexCombatCasualty[];
}): HexCombatFinanceProjection {
  const financialResult = input.adoption.attack.financialResult ?? input.adoption.defense.financialResult ?? "contested";
  const combatEffectAllowed = uniqueCombatEffects([
    ...input.adoption.attack.combatEffectAllowed,
    ...input.adoption.defense.combatEffectAllowed
  ]);
  const projectionReasons: string[] = [];
  const projectionReasonsZh: string[] = [];
  const blockedEffects: HexCombatEffectAllowed[] = [];
  const hasKill = input.verdict === "kill" && input.casualties.some((casualty) => casualty.result === "killed");
  const hasWoundOrForcedBack = input.verdict === "wound_or_forced_back" || input.casualties.some((casualty) => casualty.result === "wounded");
  const financeDisabled = financialResult === "no_financial_win_allowed" || combatEffectAllowed.includes("no_effect") || combatEffectAllowed.length === 0;
  let appliedEffect: HexCombatFinanceProjection["appliedEffect"] = "none";

  if (financeDisabled) {
    projectionReasons.push("finance_projection:no_financial_effect");
    projectionReasonsZh.push("金融未形成采信胜负，不参与战斗放大。");
    if (hasKill) {
      projectionReasons.push("finance_projection:cs_only_kill_when_no_financial_win");
      projectionReasonsZh.push("本次击杀只能由 CS 执行事实解释，不能包装成金融胜利。");
    }
  } else if (hasKill) {
    if (combatEffectAllowed.includes("possible_kill") && input.contact.lethalEligible) {
      appliedEffect = "possible_kill";
      projectionReasons.push("finance_projection:possible_kill_allowed_by_n59_and_cs_lethal");
      projectionReasonsZh.push("N59 允许金融参与击杀解释，但击杀仍由 CS 致命接触产生。");
    } else {
      blockedEffects.push("possible_kill");
      projectionReasons.push("finance_projection:kill_explanation_blocked");
      projectionReasonsZh.push("金融投影未允许击杀解释，本次击杀只能由 CS 执行事实解释。");
    }
  } else if (hasWoundOrForcedBack) {
    if (combatEffectAllowed.includes("force_reposition")) {
      appliedEffect = "force_reposition";
      projectionReasons.push("finance_projection:force_reposition_allowed");
      projectionReasonsZh.push("金融投影允许解释退让或被迫换位，但不直接制造伤亡。");
    } else if (combatEffectAllowed.includes("pressure")) {
      appliedEffect = "pressure";
      projectionReasons.push("finance_projection:pressure_allowed_for_wound_or_forced_back");
      projectionReasonsZh.push("金融投影只允许解释压制，伤亡仍由 CS 执行事实决定。");
    } else if (combatEffectAllowed.includes("minor_delay")) {
      appliedEffect = "minor_delay";
      projectionReasons.push("finance_projection:minor_delay_only");
      projectionReasonsZh.push("金融投影仅允许轻微延缓，不解释伤亡。");
    }
  } else if (combatEffectAllowed.includes("pressure")) {
    appliedEffect = "pressure";
    projectionReasons.push("finance_projection:pressure_allowed");
    projectionReasonsZh.push("金融投影允许解释压制，但没有形成金融击杀权限。");
  } else if (combatEffectAllowed.includes("map_control")) {
    appliedEffect = "map_control";
    projectionReasons.push("finance_projection:map_control_allowed");
    projectionReasonsZh.push("金融投影允许解释控图主动权，但不直接制造伤亡。");
  } else if (combatEffectAllowed.includes("minor_delay")) {
    appliedEffect = "minor_delay";
    projectionReasons.push("finance_projection:minor_delay_only");
    projectionReasonsZh.push("金融投影仅允许轻微延缓。");
  }

  if (!input.contact.lethalEligible && combatEffectAllowed.includes("possible_kill")) {
    blockedEffects.push("possible_kill");
    projectionReasons.push("finance_projection:possible_kill_blocked_by_non_lethal_contact");
    projectionReasonsZh.push("金融允许的 possible_kill 被 CS 致命门槛阻断：本次接触不是致命接触。");
    if (appliedEffect === "possible_kill") {
      appliedEffect = "none";
    }
  }

  if (appliedEffect !== "none") {
    projectionReasons.push(`finance_projection:applied:${appliedEffect}`);
  }

  return {
    financialResult,
    combatEffectAllowed,
    appliedEffect,
    blockedEffects: uniqueCombatEffects(blockedEffects),
    projectionReasons: uniqueStrings(projectionReasons),
    projectionReasonsZh: uniqueStrings(projectionReasonsZh),
    financeMayExplainKill: appliedEffect === "possible_kill" && hasKill,
    financeMayApplyPressure: appliedEffect === "pressure",
    financeMayForceReposition: appliedEffect === "force_reposition",
    financeMayApplyMapControl: appliedEffect === "map_control"
  };
}

function uniqueCombatEffects(effects: readonly HexCombatEffectAllowed[]): HexCombatEffectAllowed[] {
  return [...new Set(effects)];
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
    scoreCaps: [...scoreCapRefs].map((condition) => ({ condition, reason: "legacy_score_cap_ref" })),
    acceptedClaims: [],
    rejectedClaims: [],
    acceptedChallenges: [],
    rejectedChallenges: [],
    sideScore: acceptedEvidenceRefs.size > 0 ? Math.min(100, 20 + acceptedEvidenceRefs.size * 10) : 0,
    stanceScore: input.side === "defense" && acceptedEvidenceRefs.size > 0 ? Math.min(100, 20 + acceptedEvidenceRefs.size * 10) : 0,
    challengeScore: input.side === "attack" && acceptedEvidenceRefs.size > 0 ? Math.min(100, 20 + acceptedEvidenceRefs.size * 10) : 0,
    financialResult: acceptedEvidenceRefs.size > 0 ? "contested" : "no_financial_win_allowed",
    combatEffectAllowed: acceptedEvidenceRefs.size > 0 ? ["pressure"] : ["no_effect", "minor_delay"],
    adoptionReasons: [...adoptionReasons],
    rejectionReasons: [...rejectionReasons],
    auditReasons: [...adoptionReasons, ...rejectionReasons],
    financeReasonZh: buildFinanceAdoptionReasonZh({
      side: input.side,
      acceptedEvidenceRefs,
      rejectedEvidenceRefs,
      missingEvidenceApplied,
      scoreCapRefs
    })
  };
}

function mapFinanceJudgeSideToCombatAdoption(side: HexFinanceEvidenceJudgeSideResult): HexCombatFinanceEvidenceAdoption {
  return {
    side: side.side,
    acceptedEvidenceRefs: [...side.acceptedEvidenceRefs],
    rejectedEvidenceRefs: [...side.rejectedEvidenceRefs],
    missingEvidenceApplied: [...side.missingEvidenceApplied],
    scoreCapRefs: [...side.scoreCapRefs],
    scoreCaps: side.scoreCaps.map((cap) => ({ ...cap })),
    acceptedClaims: [...side.acceptedClaims],
    rejectedClaims: [...side.rejectedClaims],
    acceptedChallenges: [...side.acceptedChallenges],
    rejectedChallenges: [...side.rejectedChallenges],
    sideScore: side.sideScore,
    stanceScore: side.stanceScore,
    challengeScore: side.challengeScore,
    financialResult: side.financialResult,
    combatEffectAllowed: [...side.combatEffectAllowed],
    adoptionReasons: [...side.adoptionReasons],
    rejectionReasons: [...side.rejectionReasons],
    financeReasonZh: [...side.financeReasonZh],
    auditReasons: [...side.auditReasons]
  };
}

function buildEmptyFinanceEvidenceAdoption(side: HexSide): HexCombatFinanceEvidenceAdoption {
  return {
    side,
    acceptedEvidenceRefs: [],
    rejectedEvidenceRefs: [],
    missingEvidenceApplied: [],
    scoreCapRefs: [],
    scoreCaps: [],
    acceptedClaims: [],
    rejectedClaims: [],
    acceptedChallenges: [],
    rejectedChallenges: [],
    sideScore: 0,
    stanceScore: 0,
    challengeScore: 0,
    financialResult: "no_financial_win_allowed",
    combatEffectAllowed: ["no_effect", "minor_delay"],
    adoptionReasons: [],
    rejectionReasons: ["missing_finance_evidence_adoption"],
    financeReasonZh: [`${side === "attack" ? "挑战方" : "立场方"}未记录 N59 金融证据采信链。`],
    auditReasons: ["missing_finance_evidence_adoption"]
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
  const financialResult = adoption.attack.financialResult ?? adoption.defense.financialResult;
  const verdictText = financialResult === "challenge_breaks_stance"
    ? "金融裁判：挑战方击中具体 claim。"
    : financialResult === "stance_survives"
      ? "金融裁判：立场方证据链暂时守住。"
      : financialResult === "no_financial_win_allowed"
        ? "金融裁判：没有正向采信证据，不能形成金融胜负。"
        : "金融裁判：双方证据链未拉开足够差距。";
  return [
    `${verdictText} 兼容裁定：${verdict ?? "contested_no_finance_resolution"}。`,
    ...adoption.defense.financeReasonZh,
    ...adoption.attack.financeReasonZh
  ];
}
function buildCsReasonZh(csReasons: string[]): string[] {
  return uniqueStrings(csReasons.map((reason) => {
    if (reason.startsWith("combat_margin:")) {
      return `双方综合分差为 ${reason.split(":").at(-1)}。`;
    }
    if (reason.startsWith("direct_duel_pressure_attack:")) {
      return `攻方直接对枪压力为 ${reason.split(":").at(-1)}。`;
    }
    if (reason.startsWith("direct_duel_pressure_defense:")) {
      return `守方直接对枪压力为 ${reason.split(":").at(-1)}。`;
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":valid_non_fallback_action")) {
      return "直接对枪者行动有效，计入枪线压力。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":direct_duel_action")) {
      return "直接对枪者选择了主动交火行动。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":implicit_movement_duel")) {
      return "移动或转点进入枪线，计入隐式对枪压力。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":angle_or_map_control")) {
      return "架枪或控图动作提供有限对枪压力。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":exposure_pressure")) {
      return "开阔枪线、同点位或目标暴露提高对枪压力。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":role_duel_pressure")) {
      return "枪男角色承担主对枪压力。";
    }
    if (reason.includes(":direct_duel:") && reason.endsWith(":fallback_or_invalid_no_pressure")) {
      return "无效或降级行动不计入对枪压力。";
    }
    if (reason.endsWith(":direct_duel:objective_actor_exposed")) {
      return "对手下包或拆包暴露，当前方获得额外对枪压力。";
    }
    const core = reason.includes(":") ? reason.split(":").at(-1)! : reason;
    const labels: Record<string, string> = {
      numbers_or_trade_support: "人数或补枪结构支持该方。",
      close_cell_distance: "双方距离足够近，形成有效交火。",
      validated_ap_path: "行动路径和 AP 校验通过。",
      map_flag_context: "地图点位或地形标记提供执行证据。",
      active_action_pressure: "行动类型对目标区域形成主动压力。",
      support_assist_present: "支援者只提供协助和补枪压力，不直接放大主交火人数。",
      observation: "本次只是观察接触，不能直接形成击杀。",
      suppression: "本次是压制接触，可以形成压制或退让。",
      lethal: "本次达到致命接触门槛，可以根据分差形成伤亡。",
      lethal_gate_passed: "致命门槛通过。",
      lethal_gate_blocked: "致命门槛未通过，不能直接击杀。",
      close_active_duel: "近距离主动交火构成致命门槛。",
      shared_point_active_duel: "同点位主动交火构成致命门槛。",
      objective_actor_close_pressure: "下包或拆包目标在近距离压力下构成致命门槛。",
      line_of_fire_exposure: "双方处于可射击枪线暴露关系。",
      open_sight_no_cover: "双方在开阔无掩体位置相对。",
      same_point_exposure: "双方争夺同一战术点位。",
      objective_exposure: "包点、入口、下包或拆包附近暴露。",
      implicit_duel_from_movement: "移动或转点进入可射击关系，按隐式交火处理。",
      high_intensity_lethal_contact: "本次是高烈度致命接触。",
      lethal_duel_outcome: "致命接触进入对枪结算。",
      lethal_duel_margin_kill: "致命接触分差达到击杀门槛。",
      lethal_duel_margin_wound: "致命接触低分差形成受伤或退让。",
      lethal_duel_pressure_tiebreak: "总分持平，使用直接对枪压力作确定性判定。",
      direct_duel_pressure_delta_kill: "直接对枪压力优势明确，形成击杀。",
      direct_duel_pressure_delta_wound: "直接对枪压力小幅领先，形成受伤或退让。",
      symmetric_lethal_duel_no_advantage: "双方直接对枪压力完全相等，保持压制。",
      cover_blocks_lethal: "掩体或遮蔽阻断致命升级。",
      no_active_combat_action: "缺少主动交火动作。",
      unknown_cell_distance: "缺少可审计距离，不能升级为致命接触。",
      distance_exceeds_lethal_gate: "距离超过致命接触门槛。",
      abstract_contact_only: "只有抽象区域或目标争夺，不足以直接击杀。",
      no_close_or_shared_fight: "没有近距离或同点位交火。",
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
  const directParticipants = participants.filter((participant) => !participant.supportParticipant);
  const directOpponentCount = contact.participants.filter((participant) => participant.side !== side && !participant.supportParticipant).length;
  score += directParticipants.length >= directOpponentCount ? 10 : 5;
  if (participants.length > directParticipants.length) {
    score += 2;
  }
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
  const directParticipants = participants.filter((participant) => !participant.supportParticipant);
  const directOpponentCount = contact.participants.filter((participant) => participant.side !== side && !participant.supportParticipant).length;
  if (directParticipants.length >= directOpponentCount) {
    reasons.push(`${side}:numbers_or_trade_support`);
  }
  if (participants.length > directParticipants.length) {
    reasons.push(`${side}:support_assist_present`);
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

function buildCombatOutcome(scores: HexCombatScoreboard, contact: HexCombatContact): HexCombatOutcome {
  if (contact.lethalEligible) {
    return buildLethalDuelOutcome(scores, contact);
  }
  const margin = Math.abs(scores.attack.totalScore - scores.defense.totalScore);
  const advantage = buildAdvantage(scores, contact);
  return {
    advantage,
    verdict: buildVerdict(margin, contact),
    auditReasons: [`combat_margin:${roundScore(margin)}`]
  };
}

function buildLethalDuelOutcome(scores: HexCombatScoreboard, contact: HexCombatContact): HexCombatOutcome {
  const margin = Math.abs(scores.attack.totalScore - scores.defense.totalScore);
  const scoreAdvantage = scores.attack.totalScore > scores.defense.totalScore
    ? "attack"
    : scores.defense.totalScore > scores.attack.totalScore
      ? "defense"
      : "contested";
  const baseReasons = [
    `combat_margin:${roundScore(margin)}`,
    "lethal_duel_outcome",
    ...(isHighIntensityLethalContact(contact) ? ["high_intensity_lethal_contact"] : [])
  ];
  if (margin >= closePressureMargin && scoreAdvantage !== "contested") {
    return {
      advantage: scoreAdvantage,
      verdict: "kill",
      auditReasons: [
        ...baseReasons,
        "lethal_duel_margin_kill"
      ]
    };
  }
  if (margin >= 1 && scoreAdvantage !== "contested") {
    return {
      advantage: scoreAdvantage,
      verdict: "wound_or_forced_back",
      auditReasons: [
        ...baseReasons,
        "lethal_duel_margin_wound"
      ]
    };
  }

  const attackPressure = buildDirectDuelPressure("attack", contact);
  const defensePressure = buildDirectDuelPressure("defense", contact);
  const pressureDelta = attackPressure.score - defensePressure.score;
  const pressureReasons = [
    ...baseReasons,
    "lethal_duel_pressure_tiebreak",
    `direct_duel_pressure_attack:${attackPressure.score}`,
    `direct_duel_pressure_defense:${defensePressure.score}`,
    ...attackPressure.reasons,
    ...defensePressure.reasons
  ];
  if (pressureDelta >= 2) {
    return {
      advantage: "attack",
      verdict: "kill",
      auditReasons: [
        ...pressureReasons,
        "direct_duel_pressure_delta_kill"
      ]
    };
  }
  if (pressureDelta === 1) {
    return {
      advantage: "attack",
      verdict: "wound_or_forced_back",
      auditReasons: [
        ...pressureReasons,
        "direct_duel_pressure_delta_wound"
      ]
    };
  }
  if (pressureDelta <= -2) {
    return {
      advantage: "defense",
      verdict: "kill",
      auditReasons: [
        ...pressureReasons,
        "direct_duel_pressure_delta_kill"
      ]
    };
  }
  if (pressureDelta === -1) {
    return {
      advantage: "defense",
      verdict: "wound_or_forced_back",
      auditReasons: [
        ...pressureReasons,
        "direct_duel_pressure_delta_wound"
      ]
    };
  }
  return {
    advantage: "contested",
    verdict: "contested_suppression",
    auditReasons: [
      ...pressureReasons,
      "symmetric_lethal_duel_no_advantage"
    ]
  };
}

function buildDirectDuelPressure(side: HexSide, contact: HexCombatContact): HexDirectDuelPressure {
  let score = 0;
  const reasons: string[] = [];
  const directParticipants = contact.participants.filter((participant) =>
    participant.side === side && !participant.supportParticipant
  );
  for (const participant of directParticipants) {
    const action = participant.action;
    const prefix = `${side}:direct_duel:${participant.agentId}`;
    if (action.valid && !action.fallbackReason) {
      score += 2;
      reasons.push(`${prefix}:valid_non_fallback_action`);
      if (isDirectDuelAction(action)) {
        score += 4;
        reasons.push(`${prefix}:direct_duel_action`);
      } else if (isMovementDuelAction(action) && contact.implicitDuelFromMovement) {
        score += 3;
        reasons.push(`${prefix}:implicit_movement_duel`);
      } else if (["watch_angle", "map_control"].includes(action.actionType)) {
        score += 2;
        reasons.push(`${prefix}:angle_or_map_control`);
      }
    } else {
      reasons.push(`${prefix}:fallback_or_invalid_no_pressure`);
    }
    if (contact.openSightNoCover || contact.samePointExposure || contact.objectiveExposure) {
      score += 2;
      reasons.push(`${prefix}:exposure_pressure`);
    }
    const roleLabel = normalizeRoleLabel(participant.roleLabel);
    if (["entry", "star_rifler", "awper", "rifler"].includes(roleLabel)) {
      score += 2;
      reasons.push(`${prefix}:role_duel_pressure`);
    }
  }
  if (directParticipants.length > 0 && contact.participants.some((participant) =>
    participant.side !== side && ["plant_bomb", "defuse_bomb"].includes(participant.action.actionType)
  )) {
    score += 2;
    reasons.push(`${side}:direct_duel:objective_actor_exposed`);
  }
  return {
    side,
    score: roundScore(score),
    reasons
  };
}

function buildAdvantage(scores: HexCombatScoreboard, contact: HexCombatContact): "attack" | "defense" | "contested" {
  const margin = Math.abs(scores.attack.totalScore - scores.defense.totalScore);
  const threshold = contact.contactThreatLevel === "lethal" && isHighIntensityLethalContact(contact)
    ? closePressureMargin
    : pressureMargin;
  if (margin < threshold) {
    return "contested";
  }
  return scores.attack.totalScore > scores.defense.totalScore ? "attack" : "defense";
}

function buildVerdict(margin: number, contact: HexCombatContact): HexCombatVerdict {
  if (!contact.lethalEligible) {
    return margin >= pressureMargin ? "wound_or_forced_back" : "contested_suppression";
  }
  if (margin >= decisiveMargin) {
    return "kill";
  }
  const pressureThreshold = isHighIntensityLethalContact(contact)
    ? closePressureMargin
    : pressureMargin;
  if (margin >= pressureThreshold) {
    return "wound_or_forced_back";
  }
  return "contested_suppression";
}

function isHighIntensityLethalContact(contact: HexCombatContact): boolean {
  return Boolean(
    contact.lethalEligible
    && (contact.minCellDistance !== undefined && contact.minCellDistance <= 1
      || contact.openSightNoCover
      || contact.samePointExposure
      || contact.objectiveExposure
      || contact.implicitDuelFromMovement)
  );
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

function buildFinanceVerdict(
  advantage: HexCombatAdvantage,
  scores: HexCombatScoreboard,
  adoption: { attack: HexCombatFinanceEvidenceAdoption; defense: HexCombatFinanceEvidenceAdoption } | undefined
): HexCombatFinanceVerdict {
  void advantage;
  void scores;
  const financialResult = adoption?.attack.financialResult ?? adoption?.defense.financialResult;
  if (financialResult === "challenge_breaks_stance") {
    return "challenge_landed";
  }
  if (financialResult === "stance_survives") {
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
  attributionHistory?: HexCombatAttributionHistory;
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
    if (isSetupRoleRestrictedToAssist(roleContribution.roleLabel, action)) {
      assistScore += 4;
      killerScore = Math.min(killerScore, 1);
      reasons.push("role_setup_limited_to_assist");
    }
    const roundKillCount = input.attributionHistory?.roundKillCountsByAgent[participant.agentId] ?? 0;
    if (roundKillCount > 0) {
      const penalty = roundKillCount >= 2 ? 8 : 4;
      killerScore -= penalty;
      reasons.push(`recent_kill_deprioritized:${roundKillCount}`);
    }
    const lastKillPhaseIndex = input.attributionHistory?.lastKillPhaseIndexByAgent[participant.agentId];
    if (lastKillPhaseIndex !== undefined && lastKillPhaseIndex >= input.contact.phaseIndex - 1) {
      killerScore -= 4;
      reasons.push(`last_phase_kill_deprioritized:${lastKillPhaseIndex}`);
    }
    if (participant.supportParticipant) {
      assistScore += 6;
      killerScore = 0;
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

function isSetupRoleRestrictedToAssist(roleLabel: string, action: HexValidatedAgentAction): boolean {
  return ["igl", "support"].includes(roleLabel) && !isDirectDuelAction(action);
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

function isDirectDuelAction(action: HexValidatedAgentAction): boolean {
  return action.valid && ["peek", "seek_duel", "execute_site", "retake", "defuse_bomb", "plant_bomb"].includes(action.actionType);
}

function isMovementDuelAction(action: HexValidatedAgentAction): boolean {
  return action.valid && ["move", "rotate"].includes(action.actionType);
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

function cloneDuelPair(pair: HexCombatDuelPair): HexCombatDuelPair {
  return {
    ...pair,
    reasons: [...pair.reasons],
    contributorAgentIds: [...pair.contributorAgentIds]
  };
}

function cloneFireLane(lane: HexCombatFireLane): HexCombatFireLane {
  return {
    ...lane,
    regionIds: [...lane.regionIds],
    pointIds: [...lane.pointIds],
    exposureFlags: [...lane.exposureFlags]
  };
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
