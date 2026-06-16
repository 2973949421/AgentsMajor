import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { getHexAgentBusinessAssignment, type HexAgentBusinessAssignment, type HexRoundBusinessDuel } from "../business/index.js";
import { getHexAgentEconomyContext, type HexRoundEconomyContext } from "../economy/index.js";
import { getHexAgentFinanceAssignment, type HexAgentFinanceAssignment, type HexRoundFinanceDuel } from "../finance/index.js";
import { buildHexPathGraph, calculateHexApCost } from "../path/index.js";
import { buildHexAgentMemoryContext, type HexAgentMemoryPromptContext, type HexPhaseId, type HexRoundMemory, type HexSide } from "../state/index.js";
import { buildHexAgentOpeningBrief, type HexAgentOpeningBrief } from "./hex-round-opening-brief.js";
import type { HexRoundStartAgentOutputForAction } from "./hex-round-start-agent-output.js";

export const hexAgentActionTypes = [
  "hold_position",
  "move",
  "watch_angle",
  "peek",
  "gather_info",
  "use_utility",
  "map_control",
  "prepare_trade",
  "seek_duel",
  "execute_site",
  "plant_bomb",
  "defuse_bomb",
  "retake",
  "rotate",
  "save",
  "lurk",
  "fake",
  "boost"
] as const;

export type HexAgentActionType = (typeof hexAgentActionTypes)[number];

export interface HexReachableCellSummary {
  cellId: string;
  regionId?: string;
  pointIds: string[];
  flags: string[];
  apCost: number;
}

export interface HexAgentPhaseObjective {
  phaseId: HexPhaseId;
  side: HexSide;
  objective: string;
  pressure: string;
  preferredActionTypes: HexAgentActionType[];
}

export interface HexAgentRouteCandidate {
  targetCellId: string;
  label: string;
  apCost: number;
  regionId?: string;
  pointIds: string[];
  flags: string[];
}

export interface HexRoundTacticalPlan {
  roundNumber: number;
  attackVariant: string;
  defenseVariant: string;
  attackFocusRegions: string[];
  defenseFocusRegions: string[];
  attackFocusPoints: string[];
  defenseFocusPoints: string[];
  c4SitePreference: "a" | "b";
  instruction: string;
}

export interface HexAgentCommandRequest {
  schemaVersion: 1;
  phaseId: HexPhaseId;
  phaseIndex: number;
  map: {
    mapSlug: string;
    cellsPerAp: number;
  };
  agent: HexAgentMemoryPromptContext["agent"];
  bombState: HexAgentMemoryPromptContext["bombState"];
  knownEnemies: HexAgentMemoryPromptContext["knownEnemies"];
  lastSeenEnemies: HexAgentMemoryPromptContext["lastSeenEnemies"];
  reachableCells: HexReachableCellSummary[];
  phaseObjective: HexAgentPhaseObjective;
  tacticalPlan?: HexRoundTacticalPlan;
  financeDuel?: HexAgentFinanceDuelPromptContext;
  financeAssignment?: HexAgentFinanceAssignment;
  agentOpeningBrief?: HexAgentOpeningBrief;
  roundStartAgentOutput?: HexRoundStartAgentOutputForAction;
  businessDuel?: HexAgentBusinessDuelPromptContext;
  businessAssignment?: HexAgentBusinessAssignment;
  objectiveHints: string[];
  occupiedCellIds: string[];
  reservedCellIds: string[];
  targetCandidates: HexAgentRouteCandidate[];
  routeCandidates: HexAgentRouteCandidate[];
  allowedActionTypes: HexAgentActionType[];
  economy?: HexAgentEconomyPromptContext;
  constraints: string[];
  actionResultSummary?: string;
  businessExecutionSummary?: string;
}

export interface HexAgentCompactCommandRequest {
  schemaVersion: 1;
  requestMode: "compact_match";
  outputLanguage: "zh-CN";
  phase: {
    phaseId: HexPhaseId;
    phaseIndex: number;
    objective: string;
    pressure: string;
  };
  outputSchema: {
    requiredFields: readonly ["agentId", "phaseId", "currentCellId", "targetCellId", "actionType", "businessIntent"];
    optionalFields: readonly ["briefRefId", "roundStartOutputId", "actionRationaleZh", "tacticalIntent", "riskNotes", "confidence"];
    semanticFieldsMustUseChinese: readonly ["businessIntent", "actionRationaleZh", "tacticalIntent", "riskNotes"];
    codeIdentifiersRemainEnglish: readonly ["agentId", "phaseId", "currentCellId", "targetCellId", "actionType"];
  };
  agent: {
    agentId: string;
    teamId: string;
    side: HexSide;
    roleLabel?: string | undefined;
    currentCellId: string;
    currentRegionId?: string | undefined;
    currentPointIds: string[];
    apRemaining: number;
    apBudget: number;
    carryingC4: boolean;
  };
  map: {
    mapSlug: string;
    cellsPerAp: number;
  };
  businessDuel?: {
    subthemeId: string;
    subthemeTitle: string;
    coreQuestion: string;
    defenseThesis: string;
    defenseClaims: string[];
    attackThesis: string;
    attackChallengePoints: string[];
    agentAssignment?: Pick<HexAgentBusinessAssignment, "agentId" | "teamId" | "side" | "role" | "businessTask" | "csCarrierHint" | "linkedProofId" | "linkedChallengeId"> | undefined;
  } | undefined;
  financeDuel?: {
    topicKey: string;
    topicTitle: string;
    defenseSummaryZh: string;
    attackSummaryZh: string;
  } | undefined;
  agentOpeningBrief?: HexAgentOpeningBrief | undefined;
  roundStartAgentOutput?: HexRoundStartAgentOutputForAction | undefined;
  tacticalPlan?: {
    roundNumber: number;
    attackVariant: string;
    defenseVariant: string;
    c4SitePreference: "a" | "b";
    instruction: string;
    focusRegions: string[];
    focusPoints: string[];
  } | undefined;
  economy?: {
    posture: string;
    buyType: string;
    resourceTier: string;
    utilityTier: string;
    spend: number;
    outputBudget: number;
    allowedActionTypes: HexAgentActionType[];
    constraints: string[];
  } | undefined;
  bombState: {
    planted: boolean;
    plantedCellId?: string | undefined;
    carrierAgentId?: string | undefined;
    droppedCellId?: string | undefined;
  };
  targetCandidates: HexAgentRouteCandidate[];
  occupiedCellIds: string[];
  reservedCellIds: string[];
  lastSeenEnemies: Array<{
    enemyAgentId: string;
    cellId: string;
    confidence: number;
    note: "historical_last_seen_not_current_truth";
  }>;
  objectiveHints: string[];
  hardConstraints: string[];
}

export interface HexAgentCommandRequestSizeMetrics {
  fullRequestCharLength: number;
  compactRequestCharLength: number;
  estimatedReductionRatio: number;
  providerPromptTokens?: number | undefined;
}

export interface HexAgentBusinessDuelPromptContext {
  roundNumber: number;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  subthemeId: string;
  subthemeTitle: string;
  coreQuestion: string;
  defenseProof: {
    proofId: string;
    teamId: string;
    thesis: string;
    claims: string[];
  };
  attackChallenge: {
    challengeId: string;
    teamId: string;
    thesis: string;
    challengePoints: string[];
  };
}

export interface HexAgentFinanceDuelPromptContext {
  roundNumber: number;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  topicKey: string;
  topicTitle: string;
  defenseThesis: {
    thesisId: string;
    teamId: string;
    thesis: string;
    keyAssumptions: string[];
    evidenceRefs: string[];
    riskBoundary: string;
  };
  attackChallenge: {
    challengeId: string;
    teamId: string;
    thesis: string;
    challengePoints: string[];
    requiredDefense: string[];
    evidenceRefs: string[];
  };
  evidence: {
    promptFacts: Array<{
      factId: string;
      shortText: string;
      evidenceId: string;
    }>;
    missingEvidence: string[];
    scoreCaps: Array<{
      condition: string;
      maxScore: number;
      reason: string;
    }>;
    sourceWarnings: string[];
  };
}

export interface HexAgentEconomyPromptContext {
  economyPosture: string;
  buyType: string;
  loadoutPackage: string;
  spend: number;
  outputBudget: number;
  dropSent: number;
  dropReceived: number;
  resourceTier: string;
  utilityTier: string;
  economyAllowedActionTypes: HexAgentActionType[];
  economyConstraints: string[];
  notes: string[];
}

export interface HexAgentActionDraft {
  agentId: string;
  phaseId: HexPhaseId;
  currentCellId: string;
  targetCellId: string;
  actionType: HexAgentActionType;
  businessIntent: string;
  briefRefId?: string;
  roundStartOutputId?: string;
  actionRationaleZh?: string;
  tacticalIntent?: string;
  riskNotes?: string[];
  confidence?: number;
}

export interface NormalizeHexAgentActionDraftInput {
  rawDraft: unknown;
  request: HexAgentCommandRequest;
}

export interface NormalizeHexAgentActionDraftResult {
  draft?: HexAgentActionDraft;
  errors: string[];
  ignoredFields: string[];
  repairedFields: string[];
}

export type HexSemanticLanguage = "zh" | "en" | "mixed" | "unknown";

export interface HexAgentSemanticLanguageAudit {
  semanticLanguage: HexSemanticLanguage;
  languageMismatch: boolean;
  inspectedSemanticFields: string[];
}

const allowedDraftFields = new Set([
  "agentId",
  "phaseId",
  "currentCellId",
  "targetCellId",
  "actionType",
  "businessIntent",
  "briefRefId",
  "roundStartOutputId",
  "actionRationaleZh",
  "tacticalIntent",
  "riskNotes",
  "confidence"
]);

const forbiddenDraftFields = new Set([
  "winner",
  "winnerTeamId",
  "roundWinType",
  "kills",
  "killLedger",
  "casualties",
  "damage",
  "bombPlanted",
  "bombDefused",
  "economyDelta",
  "dbFact",
  "roundReport",
  "hiddenEnemyPosition"
]);

const maxPhaseBusinessIntentChars = 160;
const maxPhaseActionRationaleChars = 200;
const maxRiskNoteCount = 3;
const maxRiskNoteChars = 80;

export function buildHexAgentCommandRequest(input: {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  agentId: string;
  allowedActionTypes?: readonly HexAgentActionType[];
  economyContext?: HexRoundEconomyContext;
  occupiedCellIds?: readonly string[];
  reservedCellIds?: readonly string[];
  tacticalPlan?: HexRoundTacticalPlan;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
  roundStartAgentOutputs?: readonly HexRoundStartAgentOutputForAction[];
}): HexAgentCommandRequest {
  const context = buildHexAgentMemoryContext({
    memory: input.memory,
    agentId: input.agentId
  });
  const reachableCells = buildReachableCellSummaries(input.asset, context.agent.currentCellId, context.agent.apRemaining);
  const phaseObjective = buildPhaseObjective(input.memory.phaseId, context.agent.side);
  const blockedCellIds = new Set([...(input.occupiedCellIds ?? []), ...(input.reservedCellIds ?? [])]);
  blockedCellIds.delete(context.agent.currentCellId);
  const objectiveHints = buildObjectiveHints(input.asset, context, input.tacticalPlan);
  const routeCandidates = buildRouteCandidates(
    reachableCells,
    context.agent.currentCellId,
    phaseObjective.preferredActionTypes,
    blockedCellIds,
    context.agent.side === "attack" ? input.tacticalPlan?.attackFocusRegions : input.tacticalPlan?.defenseFocusRegions,
    context.agent.side === "attack" ? input.tacticalPlan?.attackFocusPoints : input.tacticalPlan?.defenseFocusPoints
  );
  const economy = input.economyContext
    ? getHexAgentEconomyContext({
        economyContext: input.economyContext,
        agentId: input.agentId
      })
    : undefined;
  const businessAssignment = input.businessDuel
    ? getHexAgentBusinessAssignment({
        businessDuel: input.businessDuel,
        agentId: input.agentId
      })
    : undefined;
  const financeAssignment = input.financeDuel
    ? getHexAgentFinanceAssignment({
        financeDuel: input.financeDuel,
        agentId: input.agentId
      })
    : undefined;
  const agentOpeningBrief = input.financeDuel
    ? buildHexAgentOpeningBrief({
        financeDuel: input.financeDuel,
        agent: {
          agentId: context.agent.agentId,
          teamId: context.agent.teamId,
          side: context.agent.side,
          role: readOptionalAgentRoleLabel(context.agent)
        },
        economy
      })
    : undefined;
  const roundStartAgentOutput = input.roundStartAgentOutputs?.find((output) => output.agentId === input.agentId);
  const request: HexAgentCommandRequest = {
    schemaVersion: 1,
    phaseId: input.memory.phaseId,
    phaseIndex: input.memory.phaseIndex,
    map: {
      mapSlug: input.asset.mapSlug,
      cellsPerAp: input.asset.apModel.cellsPerAp
    },
    agent: context.agent,
    bombState: context.bombState,
    knownEnemies: context.knownEnemies,
    lastSeenEnemies: context.lastSeenEnemies,
    reachableCells,
    phaseObjective,
    ...(input.tacticalPlan ? { tacticalPlan: input.tacticalPlan } : {}),
    ...(input.financeDuel ? { financeDuel: summarizeFinanceDuelForRequest(input.financeDuel) } : {}),
    ...(financeAssignment ? { financeAssignment } : {}),
    ...(agentOpeningBrief ? { agentOpeningBrief } : {}),
    ...(roundStartAgentOutput ? { roundStartAgentOutput } : {}),
    ...(input.businessDuel ? { businessDuel: summarizeBusinessDuelForRequest(input.businessDuel) } : {}),
    ...(businessAssignment ? { businessAssignment } : {}),
    objectiveHints,
    occupiedCellIds: [...(input.occupiedCellIds ?? [])],
    reservedCellIds: [...(input.reservedCellIds ?? [])],
    targetCandidates: routeCandidates,
    routeCandidates,
    allowedActionTypes: [...(input.allowedActionTypes ?? hexAgentActionTypes)],
    constraints: [
      "Only output one Hex agent action draft for the requested agent.",
      "Do not output winner, roundWinType, kills, damage, bomb results, economy deltas, database facts, or hidden enemy positions.",
      "targetCellId must come from reachableCells.",
      "Prefer targetCandidates when they are present; they are legal, phase-relevant route choices.",
      "Do not choose occupiedCellIds or reservedCellIds when they are friendly occupied or reserved cells; enemy occupied cells indicate possible contact, not an automatic fallback.",
      "A move action must change position. Use hold_position, watch_angle, or save when staying on the current cell is intentional.",
      "currentCellId must match the agent currentCellId.",
      "businessIntent is required and must explain the phase action purpose in Chinese.",
      "businessIntent must connect the phaseObjective, role responsibility, selected target, and roundStartAgentOutput when present.",
      "When financeDuel is present, businessIntent is a legacy field name; use it as a short phase action rationale, not a full thesis rewrite.",
      "When roundStartAgentOutput is present, cite it briefly; do not restate the full opening statement.",
      "When agentOpeningBrief is present, cite the brief idea briefly and do not restate the whole defense thesis or attack challenge.",
      "When financeAssignment is present, businessIntent must respect that assignment and evidence boundaries; do not invent financial facts.",
      "When businessAssignment is present, businessIntent must carry that assignment; do not rewrite proof, challenge, assignment, team ids, or agent ids.",
      "lastSeenEnemies are historical hints, not current enemy truth.",
      "The code validates movement, AP, C4 legality, and final game facts."
    ]
  };
  if (input.tacticalPlan) {
    request.constraints.push(`Round tactical variation: ${input.tacticalPlan.instruction}`);
  }
  request.constraints.push(...objectiveHints);
  if (economy) {
    request.economy = {
      economyPosture: economy.economyPosture,
      buyType: economy.buyType,
      loadoutPackage: economy.loadoutPackage,
      spend: economy.spend,
      outputBudget: economy.outputBudget,
      dropSent: economy.dropSent,
      dropReceived: economy.dropReceived,
      resourceTier: economy.resourceTier,
      utilityTier: economy.utilityTier,
      economyAllowedActionTypes: [...economy.allowedActionTypes],
      economyConstraints: [...economy.constraints],
      notes: [...economy.notes]
    };
    request.constraints.push(
      "Economy context is already resolved before this phase; do not modify buy type, drops, output budget, or economy state.",
      "Low resource agents must not claim a full execute_site without explicit future desperation support.",
      "Utility actions must respect utilityTier and cannot invent unavailable utility.",
      "Economy advantage must be converted into map control, coordination, or business evidence; it is not a winner field."
    );
  }
  if (context.actionResultSummary) {
    request.actionResultSummary = context.actionResultSummary;
  }
  if (context.businessExecutionSummary) {
    request.businessExecutionSummary = context.businessExecutionSummary;
  }
  return request;
}

export function buildHexAgentCompactCommandRequest(request: HexAgentCommandRequest): HexAgentCompactCommandRequest {
  const sideFocusRegions = request.agent.side === "attack"
    ? request.tacticalPlan?.attackFocusRegions
    : request.tacticalPlan?.defenseFocusRegions;
  const sideFocusPoints = request.agent.side === "attack"
    ? request.tacticalPlan?.attackFocusPoints
    : request.tacticalPlan?.defenseFocusPoints;
  const compact: HexAgentCompactCommandRequest = {
    schemaVersion: 1,
    requestMode: "compact_match",
    outputLanguage: "zh-CN",
    phase: {
      phaseId: request.phaseId,
      phaseIndex: request.phaseIndex,
      objective: request.phaseObjective.objective,
      pressure: request.phaseObjective.pressure
    },
    outputSchema: {
      requiredFields: ["agentId", "phaseId", "currentCellId", "targetCellId", "actionType", "businessIntent"],
      optionalFields: ["briefRefId", "roundStartOutputId", "actionRationaleZh", "tacticalIntent", "riskNotes", "confidence"],
      semanticFieldsMustUseChinese: ["businessIntent", "actionRationaleZh", "tacticalIntent", "riskNotes"],
      codeIdentifiersRemainEnglish: ["agentId", "phaseId", "currentCellId", "targetCellId", "actionType"]
    },
    agent: {
      agentId: request.agent.agentId,
      teamId: request.agent.teamId,
      side: request.agent.side,
      roleLabel: readOptionalAgentRoleLabel(request.agent),
      currentCellId: request.agent.currentCellId,
      currentRegionId: request.agent.currentRegionId,
      currentPointIds: [...request.agent.currentPointIds],
      apRemaining: request.agent.apRemaining,
      apBudget: request.agent.apBudget,
      carryingC4: request.agent.carryingC4
    },
    map: {
      mapSlug: request.map.mapSlug,
      cellsPerAp: request.map.cellsPerAp
    },
    bombState: {
      planted: request.bombState.planted,
      plantedCellId: request.bombState.plantedCellId,
      carrierAgentId: request.bombState.carrierAgentId,
      droppedCellId: request.bombState.droppedCellId
    },
    targetCandidates: request.targetCandidates.slice(0, 8).map((candidate) => ({
      ...candidate,
      pointIds: [...candidate.pointIds],
      flags: [...candidate.flags]
    })),
    occupiedCellIds: request.occupiedCellIds.slice(0, 12),
    reservedCellIds: request.reservedCellIds.slice(0, 12),
    lastSeenEnemies: request.lastSeenEnemies.slice(0, 5).map((enemy) => ({
      enemyAgentId: enemy.enemyAgentId,
      cellId: enemy.cellId,
      confidence: enemy.confidence,
      note: "historical_last_seen_not_current_truth"
    })),
    objectiveHints: request.objectiveHints.slice(0, 6),
    hardConstraints: [
      "只输出一个 JSON object，不要输出数组，除非系统明确要求。",
      "businessIntent、tacticalIntent、riskNotes 必须用中文表达本阶段行动理由。",
      "如果有 roundStartAgentOutput，businessIntent 必须短句引用该真实开局输出，但不要复述完整开局判断。",
      "如果只有 agentOpeningBrief，businessIntent 才引用该系统输入卡的任务或证据边界，但不要复述完整金融主张。",
      "必须输出 actionRationaleZh；如果请求包含 agentOpeningBrief，才输出 briefRefId 且必须等于 agentOpeningBrief.briefId。",
      "如果有 roundStartAgentOutput，必须输出 roundStartOutputId，且必须等于 roundStartAgentOutput.outputId。",
      "businessIntent 不超过 160 个中文字符，actionRationaleZh 不超过 200 个中文字符，riskNotes 最多 3 条且每条不超过 80 个中文字符。",
      "JSON 字段名、actionType、cell id、phaseId、agentId 必须保持给定英文标识。",
      "targetCellId 必须从 targetCandidates 中选择；不要选择 friendly occupied/reserved cell。",
      "lastSeenEnemies 是历史信息，不是当前敌人真实位置。",
      "不要输出 winner、kill、damage、economyDelta、DB fact 或隐藏敌人位置。"
    ]
  };
  if (request.businessDuel) {
    const compactAssignment = request.businessAssignment
      ? {
          agentId: request.businessAssignment.agentId,
          teamId: request.businessAssignment.teamId,
          side: request.businessAssignment.side,
          role: request.businessAssignment.role,
          businessTask: request.businessAssignment.businessTask,
          csCarrierHint: request.businessAssignment.csCarrierHint,
          ...(request.businessAssignment.linkedProofId ? { linkedProofId: request.businessAssignment.linkedProofId } : {}),
          ...(request.businessAssignment.linkedChallengeId ? { linkedChallengeId: request.businessAssignment.linkedChallengeId } : {})
        }
      : undefined;
    compact.businessDuel = {
      subthemeId: request.businessDuel.subthemeId,
      subthemeTitle: request.businessDuel.subthemeTitle,
      coreQuestion: request.businessDuel.coreQuestion,
      defenseThesis: request.businessDuel.defenseProof.thesis,
      defenseClaims: request.businessDuel.defenseProof.claims.slice(0, 3),
      attackThesis: request.businessDuel.attackChallenge.thesis,
      attackChallengePoints: request.businessDuel.attackChallenge.challengePoints.slice(0, 3),
      ...(compactAssignment ? { agentAssignment: compactAssignment } : {})
    };
  }
  if (request.financeDuel) {
    compact.financeDuel = {
      topicKey: request.financeDuel.topicKey,
      topicTitle: request.financeDuel.topicTitle,
      defenseSummaryZh: "守方自证已固定在开局信息卡；局内只引用信息卡，不复述完整主张。",
      attackSummaryZh: "攻方质疑已固定在开局信息卡；局内只引用信息卡，不复述完整质疑。"
    };
    if (request.roundStartAgentOutput) {
      compact.roundStartAgentOutput = { ...request.roundStartAgentOutput };
    } else if (request.agentOpeningBrief) {
      compact.agentOpeningBrief = { ...request.agentOpeningBrief };
    }
    delete compact.businessDuel;
  }
  if (request.tacticalPlan) {
    compact.tacticalPlan = {
      roundNumber: request.tacticalPlan.roundNumber,
      attackVariant: request.tacticalPlan.attackVariant,
      defenseVariant: request.tacticalPlan.defenseVariant,
      c4SitePreference: request.tacticalPlan.c4SitePreference,
      instruction: request.tacticalPlan.instruction,
      focusRegions: [...(sideFocusRegions ?? [])],
      focusPoints: [...(sideFocusPoints ?? [])]
    };
  }
  if (request.economy) {
    compact.economy = {
      posture: request.economy.economyPosture,
      buyType: request.economy.buyType,
      resourceTier: request.economy.resourceTier,
      utilityTier: request.economy.utilityTier,
      spend: request.economy.spend,
      outputBudget: request.economy.outputBudget,
      allowedActionTypes: request.economy.economyAllowedActionTypes.slice(0, 10),
      constraints: request.economy.economyConstraints.slice(0, 4)
    };
  }
  return compact;
}

export function calculateHexAgentCommandRequestSizeMetrics(input: {
  fullRequest: HexAgentCommandRequest;
  compactRequest: HexAgentCompactCommandRequest;
  providerPromptTokens?: number | undefined;
}): HexAgentCommandRequestSizeMetrics {
  const fullRequestCharLength = JSON.stringify(input.fullRequest).length;
  const compactRequestCharLength = JSON.stringify(input.compactRequest).length;
  const estimatedReductionRatio = fullRequestCharLength > 0
    ? Number(((fullRequestCharLength - compactRequestCharLength) / fullRequestCharLength).toFixed(4))
    : 0;
  const metrics: HexAgentCommandRequestSizeMetrics = {
    fullRequestCharLength,
    compactRequestCharLength,
    estimatedReductionRatio
  };
  if (input.providerPromptTokens !== undefined) {
    metrics.providerPromptTokens = input.providerPromptTokens;
  }
  return metrics;
}

export function auditHexAgentDraftSemanticLanguage(draft: HexAgentActionDraft | undefined): HexAgentSemanticLanguageAudit {
  const inspected: Array<[string, string]> = [];
  if (draft?.businessIntent) {
    inspected.push(["businessIntent", draft.businessIntent]);
  }
  if (draft?.actionRationaleZh) {
    inspected.push(["actionRationaleZh", draft.actionRationaleZh]);
  }
  if (draft?.tacticalIntent) {
    inspected.push(["tacticalIntent", draft.tacticalIntent]);
  }
  for (const [index, note] of (draft?.riskNotes ?? []).entries()) {
    inspected.push([`riskNotes.${index}`, note]);
  }
  if (inspected.length === 0) {
    return {
      semanticLanguage: "unknown",
      languageMismatch: false,
      inspectedSemanticFields: []
    };
  }
  const text = inspected.map(([, value]) => value).join(" ");
  const cjkCount = countMatches(text, /[\u3400-\u9FFF]/g);
  const latinCount = countMatches(text.replace(/\b(?:h_\d+_\d+_l-?\d+|[a-z]+_\d+|[a-z]+_[a-z_]+)\b/gi, ""), /[A-Za-z]/g);
  let semanticLanguage: HexSemanticLanguage = "unknown";
  if (cjkCount >= 4 && latinCount <= cjkCount * 1.2) {
    semanticLanguage = "zh";
  } else if (cjkCount >= 4 && latinCount > cjkCount * 1.2) {
    semanticLanguage = "mixed";
  } else if (latinCount >= 8) {
    semanticLanguage = "en";
  }
  return {
    semanticLanguage,
    languageMismatch: semanticLanguage === "en" || semanticLanguage === "mixed",
    inspectedSemanticFields: inspected.map(([field]) => field)
  };
}

function summarizeBusinessDuelForRequest(duel: HexRoundBusinessDuel): HexAgentBusinessDuelPromptContext {
  return {
    roundNumber: duel.roundNumber,
    halfIndex: duel.halfIndex,
    roundInHalf: duel.roundInHalf,
    mirrorRoundNumber: duel.mirrorRoundNumber,
    subthemeId: duel.subtheme.subthemeId,
    subthemeTitle: duel.subtheme.title,
    coreQuestion: duel.subtheme.coreQuestion,
    defenseProof: {
      proofId: duel.defenseProof.proofId,
      teamId: duel.defenseProof.teamId,
      thesis: duel.defenseProof.thesis,
      claims: [...duel.defenseProof.claims]
    },
    attackChallenge: {
      challengeId: duel.attackChallenge.challengeId,
      teamId: duel.attackChallenge.teamId,
      thesis: duel.attackChallenge.thesis,
      challengePoints: [...duel.attackChallenge.challengePoints]
    }
  };
}

function summarizeFinanceDuelForRequest(duel: HexRoundFinanceDuel): HexAgentFinanceDuelPromptContext {
  return {
    roundNumber: duel.roundNumber,
    halfIndex: duel.halfIndex,
    roundInHalf: duel.roundInHalf,
    mirrorRoundNumber: duel.mirrorRoundNumber,
    topicKey: duel.topic.roundKey,
    topicTitle: duel.topic.topicTitle,
    defenseThesis: {
      thesisId: duel.defenseThesis.thesisId,
      teamId: duel.defenseThesis.teamId,
      thesis: duel.defenseThesis.thesis,
      keyAssumptions: [...duel.defenseThesis.keyAssumptions],
      evidenceRefs: [...duel.defenseThesis.evidenceRefs],
      riskBoundary: duel.defenseThesis.riskBoundary
    },
    attackChallenge: {
      challengeId: duel.attackChallenge.challengeId,
      teamId: duel.attackChallenge.teamId,
      thesis: duel.attackChallenge.thesis,
      challengePoints: [...duel.attackChallenge.challengePoints],
      requiredDefense: [...duel.attackChallenge.requiredDefense],
      evidenceRefs: [...duel.attackChallenge.evidenceRefs]
    },
    evidence: {
      promptFacts: duel.evidence.promptFacts.map((fact) => ({ ...fact })),
      missingEvidence: [...duel.evidence.missingEvidence],
      scoreCaps: duel.evidence.scoreCaps.map((cap) => ({ ...cap })),
      sourceWarnings: [...duel.evidence.sourceWarnings]
    }
  };
}

function readOptionalAgentRoleLabel(agent: HexAgentCommandRequest["agent"]): string | undefined {
  const record = agent as HexAgentCommandRequest["agent"] & { roleLabel?: unknown; role?: unknown };
  const roleLabel = typeof record.roleLabel === "string" ? record.roleLabel.trim() : "";
  if (roleLabel) {
    return roleLabel;
  }
  const role = typeof record.role === "string" ? record.role.trim() : "";
  return role || undefined;
}

function buildPhaseObjective(phaseId: HexPhaseId, side: HexSide): HexAgentPhaseObjective {
  const attack = side === "attack";
  const byPhase: Record<HexPhaseId, { attack: string; defense: string; pressure: string; preferredActionTypes: HexAgentActionType[] }> = {
    default_opening: {
      attack: "Leave spawn with a concrete default route, take early map control, and prepare a later site decision.",
      defense: "Leave spawn into a defensible coverage position, establish early information, and avoid overstacking one cell.",
      pressure: "Pure waiting wastes the opening phase; choose a useful route or a clearly justified angle.",
      preferredActionTypes: ["move", "map_control", "gather_info", "watch_angle"]
    },
    first_contact: {
      attack: "Create first contact pressure through mid, long, short, or tunnels instead of drifting near spawn.",
      defense: "Hold or contest likely contact lanes and convert information into a rotate or crossfire.",
      pressure: "This phase should either approach contact, gather actionable info, or secure a key lane.",
      preferredActionTypes: ["map_control", "gather_info", "peek", "watch_angle", "prepare_trade"]
    },
    mid_round_decision: {
      attack: "Choose a site direction or split pressure and move toward a bombsite-capable path.",
      defense: "React to known pressure, maintain site coverage, and rotate if the current position no longer covers a threat.",
      pressure: "A round that does not choose a site by mid round risks timeout with no plant.",
      preferredActionTypes: ["rotate", "map_control", "execute_site", "prepare_trade", "use_utility"]
    },
    execute_or_retake: {
      attack: "Execute, trade, plant pressure, or commit to a site path with visible AP-backed movement.",
      defense: "Anchor the threatened site or start a retake/rotate based on known pressure.",
      pressure: "If the bomb is not planted, attack must make a meaningful site move or explain a high-value delay.",
      preferredActionTypes: ["execute_site", "plant_bomb", "prepare_trade", "seek_duel", "retake", "rotate"]
    },
    post_plant_or_clutch: {
      attack: "If planted, protect the bomb; if not planted, force the final site attempt or justify a save with facts.",
      defense: "If planted, retake or defuse; if not planted, deny the last plant route and preserve crossfires.",
      pressure: "The final phase resolves hard conditions; no-plant attack defaults toward a defense timeout.",
      preferredActionTypes: ["plant_bomb", "defuse_bomb", "retake", "save", "watch_angle", "seek_duel"]
    }
  };
  const selected = byPhase[phaseId];
  return {
    phaseId,
    side,
    objective: attack ? selected.attack : selected.defense,
    pressure: selected.pressure,
    preferredActionTypes: selected.preferredActionTypes
  };
}

function buildRouteCandidates(
  reachableCells: HexReachableCellSummary[],
  currentCellId: string,
  preferredActionTypes: readonly HexAgentActionType[],
  blockedCellIds: ReadonlySet<string> = new Set(),
  focusRegions: readonly string[] = [],
  focusPoints: readonly string[] = []
): HexAgentRouteCandidate[] {
  const currentCell = reachableCells.find((cell) => cell.cellId === currentCellId);
  const includeCurrentPlantCandidate = Boolean(
    currentCell
    && preferredActionTypes.includes("plant_bomb")
    && currentCell.flags.some((flag) => flag === "bombsite_a" || flag === "bombsite_b")
  );
  const candidateCells = [
    ...(includeCurrentPlantCandidate && currentCell ? [currentCell] : []),
    ...reachableCells.filter((cell) => cell.cellId !== currentCellId && cell.apCost > 0)
  ];
  const scored = candidateCells
    .map((cell) => ({
      cell,
      score: scoreRouteCandidate(cell, preferredActionTypes, blockedCellIds, focusRegions, focusPoints)
    }))
    .sort((left, right) => right.score - left.score || left.cell.apCost - right.cell.apCost || left.cell.cellId.localeCompare(right.cell.cellId));
  return scored.slice(0, 10).map(({ cell }) => ({
    targetCellId: cell.cellId,
    label: buildRouteCandidateLabel(cell),
    apCost: cell.apCost,
    ...(cell.regionId ? { regionId: cell.regionId } : {}),
    pointIds: [...cell.pointIds],
    flags: [...cell.flags]
  }));
}

function scoreRouteCandidate(
  cell: HexReachableCellSummary,
  preferredActionTypes: readonly HexAgentActionType[],
  blockedCellIds: ReadonlySet<string>,
  focusRegions: readonly string[] = [],
  focusPoints: readonly string[] = []
): number {
  let score = Math.min(12, cell.apCost * 8);
  if (blockedCellIds.has(cell.cellId)) {
    score -= 100;
  }
  if (cell.regionId) {
    score += 2;
    if (focusRegions.includes(cell.regionId)) {
      score += 12;
    }
  }
  if (cell.pointIds.length > 0) {
    score += 3;
    score += cell.pointIds.filter((pointId) => focusPoints.includes(pointId)).length * 10;
  }
  if (cell.flags.some((flag) => flag === "bombsite_a" || flag === "bombsite_b")) {
    score += preferredActionTypes.includes("plant_bomb") || preferredActionTypes.includes("execute_site") ? 8 : 4;
  }
  if (cell.flags.includes("choke")) {
    score += preferredActionTypes.includes("map_control") || preferredActionTypes.includes("peek") ? 4 : 1;
  }
  if (cell.flags.includes("cover")) {
    score += preferredActionTypes.includes("watch_angle") ? 3 : 1;
  }
  return score;
}

function buildObjectiveHints(
  asset: HexMapAsset,
  context: HexAgentMemoryPromptContext,
  tacticalPlan: HexRoundTacticalPlan | undefined
): string[] {
  const hints: string[] = [];
  const currentCell = asset.cells.find((cell) => cell.cellId === context.agent.currentCellId);
  const currentCellIsBombsite = Boolean(currentCell?.flags.includes("bombsite_a") || currentCell?.flags.includes("bombsite_b"));
  if (context.agent.carryingC4) {
    const preferredSite = tacticalPlan?.c4SitePreference ?? "a";
    hints.push(`You are carrying C4; prioritize a credible route toward ${preferredSite.toUpperCase()} site unless the phase facts make another site clearly better.`);
    if (currentCellIsBombsite) {
      hints.push("You are currently on a legal bombsite cell; plant_bomb with targetCellId=currentCellId is a valid objective candidate when AP/path and hard C4 rules pass.");
    } else {
      hints.push("If not on a bombsite, keep moving toward a bombsite-capable target instead of holding spawn or drifting without objective pressure.");
    }
  }
  if (context.bombState.planted && context.agent.side === "defense") {
    hints.push("Bomb is planted; defuse_bomb is only valid at the planted cell, otherwise rotate/retake toward the planted site.");
  }
  return hints;
}

function buildRouteCandidateLabel(cell: HexReachableCellSummary): string {
  const parts = [
    cell.regionId ? `region:${cell.regionId}` : "region:unknown",
    cell.pointIds.length > 0 ? `points:${cell.pointIds.join(",")}` : "points:none",
    cell.flags.length > 0 ? `flags:${cell.flags.join(",")}` : "flags:none",
    `ap:${cell.apCost.toFixed(2)}`
  ];
  return parts.join(" | ");
}

export function normalizeHexAgentActionDraft(input: NormalizeHexAgentActionDraftInput): NormalizeHexAgentActionDraftResult {
  const extracted = extractDraftObject(input.rawDraft);
  const rawDraft = extracted.rawDraft;
  const errors: string[] = [...extracted.errors];
  const ignoredFields: string[] = [];
  const repairedFields: string[] = [...extracted.repairedFields];

  if (!isRecord(rawDraft)) {
    return {
      errors: errors.length > 0 ? errors : ["draft:not_object"],
      ignoredFields,
      repairedFields
    };
  }

  for (const key of Object.keys(rawDraft)) {
    if (!allowedDraftFields.has(key) || forbiddenDraftFields.has(key)) {
      ignoredFields.push(key);
    }
  }

  const agentId = input.request.agent.agentId;
  if (readString(rawDraft.agentId) !== input.request.agent.agentId) {
    repairedFields.push("repaired_agentId");
  }
  const phaseId = input.request.phaseId;
  if (readString(rawDraft.phaseId) !== input.request.phaseId) {
    repairedFields.push("repaired_phaseId");
  }

  const currentCellId = input.request.agent.currentCellId;
  if (readString(rawDraft.currentCellId) !== input.request.agent.currentCellId) {
    repairedFields.push("repaired_currentCellId");
  }

  const targetCellId = readString(rawDraft.targetCellId);
  if (!targetCellId) {
    errors.push("draft:missing_targetCellId");
  }

  const actionType = readString(rawDraft.actionType);
  if (!isHexAgentActionType(actionType)) {
    errors.push("draft:invalid_actionType");
  }

  const businessIntent = readString(rawDraft.businessIntent);
  if (!businessIntent) {
    errors.push("draft:missing_businessIntent");
  }
  const actionRationaleZh = readOptionalString(rawDraft.actionRationaleZh);
  const tacticalIntent = readOptionalString(rawDraft.tacticalIntent);
  const riskNotes = readStringArray(rawDraft.riskNotes);
  if (containsGarbledText(businessIntent) || containsGarbledText(readOptionalString(rawDraft.tacticalIntent) ?? "")) {
    errors.push("draft:garbled_text");
  }
  if (containsGarbledText(actionRationaleZh ?? "")) {
    errors.push("draft:garbled_text");
  }
  if (riskNotes.some(containsGarbledText)) {
    errors.push("draft:garbled_text");
  }
  if (input.request.agentOpeningBrief) {
    const phaseBoundaryErrors = validatePhaseActionBoundary({
      businessIntent,
      actionRationaleZh,
      riskNotes,
      brief: input.request.agentOpeningBrief,
      roundStartOutput: input.request.roundStartAgentOutput
    });
    errors.push(...phaseBoundaryErrors);
  } else if (input.request.roundStartAgentOutput) {
    const phaseBoundaryErrors = validatePhaseActionBoundary({
      businessIntent,
      actionRationaleZh,
      riskNotes,
      roundStartOutput: input.request.roundStartAgentOutput
    });
    errors.push(...phaseBoundaryErrors);
  }

  if (errors.length > 0) {
    return {
      errors,
      ignoredFields,
      repairedFields
    };
  }

  const draft: HexAgentActionDraft = {
    agentId,
    phaseId,
    currentCellId,
    targetCellId,
    actionType: actionType as HexAgentActionType,
    businessIntent
  };
  const rawBriefRefId = readOptionalString(rawDraft.briefRefId);
  if (input.request.agentOpeningBrief) {
    if (!rawBriefRefId) {
      repairedFields.push("repaired_missing_briefRefId");
    } else if (rawBriefRefId !== input.request.agentOpeningBrief.briefId) {
      repairedFields.push("repaired_invalid_briefRefId");
    }
    draft.briefRefId = input.request.agentOpeningBrief.briefId;
  } else if (rawBriefRefId) {
    draft.briefRefId = rawBriefRefId;
  }
  const rawRoundStartOutputId = readOptionalString(rawDraft.roundStartOutputId);
  if (input.request.roundStartAgentOutput) {
    if (!rawRoundStartOutputId) {
      repairedFields.push("repaired_missing_roundStartOutputId");
    } else if (rawRoundStartOutputId !== input.request.roundStartAgentOutput.outputId) {
      repairedFields.push("repaired_invalid_roundStartOutputId");
    }
    draft.roundStartOutputId = input.request.roundStartAgentOutput.outputId;
  } else if (rawRoundStartOutputId) {
    draft.roundStartOutputId = rawRoundStartOutputId;
  }
  if (actionRationaleZh) {
    draft.actionRationaleZh = actionRationaleZh;
  }
  if (tacticalIntent) {
    draft.tacticalIntent = tacticalIntent;
  }
  if (riskNotes.length > 0) {
    draft.riskNotes = riskNotes;
  }
  const confidence = readConfidence(rawDraft.confidence);
  if (confidence !== undefined) {
    draft.confidence = confidence;
  }
  return {
    draft,
    errors,
    ignoredFields,
    repairedFields
  };
}

function validatePhaseActionBoundary(input: {
  businessIntent: string;
  actionRationaleZh?: string | undefined;
  riskNotes: string[];
  brief?: HexAgentOpeningBrief | undefined;
  roundStartOutput?: HexRoundStartAgentOutputForAction | undefined;
}): string[] {
  const errors = new Set<string>();
  if (isTooLongPhaseActionText(input.businessIntent, maxPhaseBusinessIntentChars)
    || isTooLongPhaseActionText(input.actionRationaleZh ?? "", maxPhaseActionRationaleChars)
    || input.riskNotes.length > maxRiskNoteCount
    || input.riskNotes.some((note) => isTooLongPhaseActionText(note, maxRiskNoteChars))) {
    errors.add("phase_action_reason_too_long");
  }
  if ((input.brief && (repeatsRoundOpeningBrief(input.businessIntent, input.brief)
    || repeatsRoundOpeningBrief(input.actionRationaleZh ?? "", input.brief)))
    || (input.roundStartOutput && (repeatsRoundStartOutput(input.businessIntent, input.roundStartOutput)
      || repeatsRoundStartOutput(input.actionRationaleZh ?? "", input.roundStartOutput)))) {
    errors.add("phase_repeated_round_thesis");
  }
  return [...errors];
}

function isTooLongPhaseActionText(text: string, maxChars: number): boolean {
  return text.replace(/\s+/g, "").length > maxChars;
}

function repeatsRoundOpeningBrief(text: string, brief: HexAgentOpeningBrief): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (normalized.length < 48) {
    return false;
  }
  const candidates = [
    brief.proofOrChallengeZh,
    brief.evidenceBoundaryZh,
    brief.roundTaskZh,
    brief.roleQuestionZh ?? "",
    ...(brief.usableFactsZh ?? [])
  ]
    .map((value) => value.replace(/\s+/g, ""))
    .filter((value) => value.length >= 12);
  return candidates.some((candidate) => {
    const exactWindow = candidate.slice(0, Math.min(candidate.length, 32));
    if (exactWindow.length >= 16 && normalized.includes(exactWindow)) {
      return true;
    }
    const overlapWindow = candidate.slice(0, Math.min(candidate.length, 48));
    return overlapWindow.length >= 24 && normalized.includes(overlapWindow);
  });
}

function repeatsRoundStartOutput(text: string, output: HexRoundStartAgentOutputForAction): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (normalized.length < 48) {
    return false;
  }
  const candidates = [
    output.openingStatementZh,
    output.riskBoundaryZh,
    output.buyConstraintAppliedZh,
    output.phaseActionCarryoverZh
  ]
    .map((value) => value.replace(/\s+/g, ""))
    .filter((value) => value.length >= 12);
  return candidates.some((candidate) => {
    const exactWindow = candidate.slice(0, Math.min(candidate.length, 32));
    if (exactWindow.length >= 16 && normalized.includes(exactWindow)) {
      return true;
    }
    const overlapWindow = candidate.slice(0, Math.min(candidate.length, 48));
    return overlapWindow.length >= 24 && normalized.includes(overlapWindow);
  });
}

export function isHexAgentActionType(value: string): value is HexAgentActionType {
  return (hexAgentActionTypes as readonly string[]).includes(value);
}

function buildReachableCellSummaries(asset: HexMapAsset, fromCellId: string, apRemaining: number): HexReachableCellSummary[] {
  const cellsById = new Map(asset.cells.map((cell) => [cell.cellId, cell]));
  const startCell = cellsById.get(fromCellId);
  if (!startCell?.playable || apRemaining < 0) {
    return [];
  }

  const graph = buildHexPathGraph(asset);
  const bestPaths = new Map<string, { cellIds: string[]; verticalLinkIds: string[]; apCost: number }>();
  const queue: Array<{ cellId: string; cellIds: string[]; verticalLinkIds: string[] }> = [
    {
      cellId: fromCellId,
      cellIds: [fromCellId],
      verticalLinkIds: []
    }
  ];
  bestPaths.set(fromCellId, {
    cellIds: [fromCellId],
    verticalLinkIds: [],
    apCost: 0
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.get(current.cellId) ?? []) {
      const nextCellIds = [...current.cellIds, edge.toCellId];
      const nextVerticalLinkIds = edge.verticalLinkId ? [...current.verticalLinkIds, edge.verticalLinkId] : current.verticalLinkIds;
      const apCost = calculateHexApCost({
        asset,
        pathCellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds
      }).apCost;
      if (apCost > apRemaining) {
        continue;
      }
      const existing = bestPaths.get(edge.toCellId);
      if (existing && existing.apCost <= apCost) {
        continue;
      }
      bestPaths.set(edge.toCellId, {
        cellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds,
        apCost
      });
      queue.push({
        cellId: edge.toCellId,
        cellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds
      });
    }
  }

  return [...bestPaths.entries()]
    .map(([cellId, path]) => {
      const cell = cellsById.get(cellId);
      return cell?.playable ? summarizeCell(cell, path.apCost) : undefined;
    })
    .filter((cell): cell is HexReachableCellSummary => Boolean(cell))
    .sort((left, right) => left.apCost - right.apCost || left.cellId.localeCompare(right.cellId));
}

function summarizeCell(cell: HexCell, apCost: number): HexReachableCellSummary {
  const summary: HexReachableCellSummary = {
    cellId: cell.cellId,
    pointIds: [...cell.pointIds],
    flags: [...cell.flags],
    apCost
  };
  if (cell.regionId) {
    summary.regionId = cell.regionId;
  }
  return summary;
}

function extractDraftObject(rawDraft: unknown): {
  rawDraft: unknown;
  errors: string[];
  repairedFields: string[];
} {
  if (!isRecord(rawDraft)) {
    return {
      rawDraft,
      errors: [],
      repairedFields: []
    };
  }
  if (isRecord(rawDraft.draft)) {
    return {
      rawDraft: rawDraft.draft,
      errors: [],
      repairedFields: []
    };
  }
  if (Array.isArray(rawDraft.actions)) {
    if (rawDraft.actions.length === 1 && isRecord(rawDraft.actions[0])) {
      return {
        rawDraft: rawDraft.actions[0],
        errors: [],
        repairedFields: ["repaired_single_action_array"]
      };
    }
    return {
      rawDraft: undefined,
      errors: rawDraft.actions.length > 1 ? ["draft:multiple_actions_not_allowed"] : ["draft:actions_empty"],
      repairedFields: []
    };
  }
  if (Array.isArray(rawDraft.drafts)) {
    if (rawDraft.drafts.length === 1 && isRecord(rawDraft.drafts[0])) {
      return {
        rawDraft: rawDraft.drafts[0],
        errors: [],
        repairedFields: ["repaired_single_draft_array"]
      };
    }
    return {
      rawDraft: undefined,
      errors: rawDraft.drafts.length > 1 ? ["draft:multiple_actions_not_allowed"] : ["draft:drafts_empty"],
      repairedFields: []
    };
  }
  return {
    rawDraft,
    errors: [],
    repairedFields: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function containsGarbledText(value: string): boolean {
  return value.includes("\uFFFD") || /Ã.|Â.|â€|é�|�/.test(value);
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text.length > 0 ? text : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter((item) => item.length > 0) : [];
}

function readConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}
