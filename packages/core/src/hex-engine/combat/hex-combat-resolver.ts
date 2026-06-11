import type { HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import { summarizeHexEconomyEvidence, type HexEconomyCombatEvidence, type HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundMemory, HexSide } from "../state/index.js";
import { materializeHexCombatMemoryEvents } from "./hex-combat-events.js";
import type {
  HexCombatAudit,
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
    economyEvidence: attackEconomyEvidence
  });
  const defenseEvidence = scoreSide({
    side: "defense",
    contact: input.contact,
    memory: input.memory,
    actions: input.actions,
    economyEvidence: defenseEconomyEvidence
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
  const verdict = buildVerdict(margin);
  const casualties = buildCasualties(input.contact, advantage, verdict);
  const suppressions = buildSuppressions(input.contact, advantage, verdict, casualties);
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
  const businessScore = scoreBusinessEvidence(input.side, participants, sideActionsNearContact, input.memory);
  const csScore = scoreCsEvidence(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence);
  return {
    businessScore,
    csScore,
    totalScore: roundScore(businessScore + csScore),
    reasons: [
      ...buildBusinessReasons(input.side, participants, sideActionsNearContact, input.memory),
      ...buildCsReasons(input.side, participants, input.contact, sideActionsNearContact, input.economyEvidence)
    ]
  };
}

function scoreBusinessEvidence(
  side: HexSide,
  participants: HexCombatParticipant[],
  sideActionsNearContact: HexValidatedAgentAction[],
  memory: HexRoundMemory
): number {
  let score = 0;
  const validActions = sideActionsNearContact.filter((action) => action.valid);
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
  memory: HexRoundMemory
): string[] {
  const reasons: string[] = [];
  const validActions = sideActionsNearContact.filter((action) => action.valid);
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

function buildCasualties(contact: HexCombatContact, advantage: "attack" | "defense" | "contested", verdict: HexCombatVerdict): HexCombatCasualty[] {
  if (advantage === "contested") {
    return [];
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  const target = chooseVulnerableParticipant(contact.participants.filter((participant) => participant.side === losingSide));
  if (!target) {
    return [];
  }
  if (verdict === "kill") {
    return [buildCasualty(target, "killed", "decisive_combat_margin")];
  }
  if (verdict === "wound_or_forced_back" && target.lifeStatus === "wounded") {
    return [buildCasualty(target, "killed", "wounded_agent_lost_close_combat")];
  }
  if (verdict === "wound_or_forced_back") {
    return [buildCasualty(target, "wounded", "combat_pressure_margin")];
  }
  return [];
}

function buildSuppressions(
  contact: HexCombatContact,
  advantage: "attack" | "defense" | "contested",
  verdict: HexCombatVerdict,
  casualties: HexCombatCasualty[]
): HexCombatSuppression[] {
  if (verdict === "kill") {
    return [];
  }
  if (advantage === "contested") {
    return contact.participants.map((participant) => buildSuppression(participant, "suppressed", "contested_combat"));
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  return contact.participants
    .filter((participant) => participant.side === losingSide)
    .filter((participant) => !casualties.some((casualty) => casualty.agentId === participant.agentId))
    .map((participant) => buildSuppression(participant, "forced_back", "combat_pressure_margin"));
}

function buildControlHint(advantage: "attack" | "defense" | "contested", verdict: HexCombatVerdict): HexCombatControlHint {
  if (advantage === "contested") {
    return "contested";
  }
  return verdict === "contested_suppression" ? "contested" : advantage;
}

function chooseVulnerableParticipant(participants: HexCombatParticipant[]): HexCombatParticipant | undefined {
  return participants.find((participant) => participant.lifeStatus === "wounded") ?? participants[0];
}

function buildCasualty(participant: HexCombatParticipant, result: "killed" | "wounded", reason: string): HexCombatCasualty {
  return {
    agentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason
  };
}

function buildSuppression(participant: HexCombatParticipant, result: "suppressed" | "forced_back", reason: string): HexCombatSuppression {
  return {
    agentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason
  };
}

function matchesSideBusinessLanguage(side: HexSide, text: string): boolean {
  const normalized = text.toLowerCase();
  const attackTerms = ["breach", "challenge", "pressure", "entry", "execute", "exploit", "质疑", "漏洞", "突破", "进点", "切入"];
  const defenseTerms = ["defend", "hold", "anchor", "deny", "response", "防守", "回应", "顶住", "守住", "拦截"];
  const terms = side === "attack" ? attackTerms : defenseTerms;
  return terms.some((term) => normalized.includes(term));
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
