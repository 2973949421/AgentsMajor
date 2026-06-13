import type { HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import { summarizeHexEconomyEvidence, type HexEconomyCombatEvidence, type HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundMemory, HexSide } from "../state/index.js";
import { buildHexCombatCasualties, buildHexCombatSuppressions } from "./hex-combat-casualties.js";
import { materializeHexCombatMemoryEvents } from "./hex-combat-events.js";
import type {
  HexCombatAudit,
  HexCombatBusinessVerdict,
  HexCombatCasualty,
  HexCombatContact,
  HexCombatControlHint,
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

const businessWeight = 65 as const;
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
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {})
  });
  const defenseEvidence = scoreSide({
    side: "defense",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: defenseEconomyEvidence,
    ...(input.businessDuel ? { businessDuel: input.businessDuel } : {})
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
  const businessVerdict = buildBusinessVerdict(advantage, adjustedScores);
  const verdict = buildVerdict(margin);
  const attributionScores = buildAttributionScores({
    contact: input.contact,
    actions: input.actions,
    businessDuel: input.businessDuel
  });
  const casualties = buildHexCombatCasualties(input.contact, advantage, verdict, attributionScores);
  const suppressions = buildHexCombatSuppressions(input.contact, advantage, verdict, casualties);
  const businessReasons = [
    ...adjustedScores.attack.reasons.filter((reason) => reason.includes(":business")),
    ...adjustedScores.defense.reasons.filter((reason) => reason.includes(":business")),
    `business_verdict:${businessVerdict}`
  ];
  const csReasons = [
    ...adjustedScores.attack.reasons.filter((reason) => !reason.includes(":business")),
    ...adjustedScores.defense.reasons.filter((reason) => !reason.includes(":business"))
  ];
  const audit: HexCombatAudit = {
    businessWeight,
    csWeight,
    triggerReasons: [...input.contact.triggerReasons],
    variance: variance.audit,
    economy: {
      economyEvidenceApplied: Boolean(input.economyContext),
      attack: attackEconomyEvidence,
      defense: defenseEconomyEvidence,
      reasons: [...attackEconomyEvidence.reasons, ...defenseEconomyEvidence.reasons]
    }
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
    businessReasons,
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
  const businessScore = scoreBusinessEvidence(input.side, participants, sideActionsNearContact, input.memory, input.businessDuel);
  const csScore = scoreCsEvidence(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence);
  return {
    businessScore,
    csScore,
    totalScore: roundScore(businessScore + csScore),
    reasons: [
      ...buildBusinessReasons(input.side, participants, sideActionsNearContact, input.memory, input.businessDuel),
      ...buildCsReasons(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence)
    ]
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

function buildAttributionScores(input: {
  contact: HexCombatContact;
  actions: HexValidatedAgentAction[];
  businessDuel: HexRoundBusinessDuel | undefined;
}): Map<string, number> {
  const actionByAgent = new Map(input.actions.map((action) => [action.agentId, action]));
  const scores = new Map<string, number>();
  for (const participant of input.contact.participants) {
    const action = actionByAgent.get(participant.agentId) ?? participant.action;
    let score = 0;
    if (action.valid && !action.fallbackReason) {
      score += 8;
    }
    if (action.actionType !== "hold_position") {
      score += 5;
    }
    if (isPressureAction(action)) {
      score += 5;
    }
    if (actionMatchesBusinessAssignment(participant.side, action, input.businessDuel)) {
      score += 8;
    }
    if (matchesRoundBusinessLanguage(participant.side, action.businessIntent, input.businessDuel)) {
      score += 4;
    }
    if (participant.targetFlags.includes("bombsite_a") || participant.targetFlags.includes("bombsite_b") || participant.currentFlags.includes("cover")) {
      score += 2;
    }
    scores.set(participant.agentId, score);
  }
  return scores;
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
