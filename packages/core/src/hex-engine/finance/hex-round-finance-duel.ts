import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HexSide } from "../state/index.js";

export interface HexFinanceEvidenceFact {
  factId: string;
  statement: string;
  metricName: string;
  source: string;
  sourceType: string;
  evidenceId: string;
  confidence: number;
  dataMode: string;
}

export interface HexFinancePromptFact {
  factId: string;
  shortText: string;
  evidenceId: string;
}

export interface HexFinanceScoreCap {
  condition: string;
  maxScore: number;
  reason: string;
}

export interface HexFinanceJudgeLedger {
  allowedClaims: string[];
  cappedClaims: string[];
  prohibitedClaims: string[];
}

export interface HexFinanceSideSwapPolicy {
  topicCycleRoundCount?: number;
  topicIndexFormula?: string;
  halfPolicy?: string;
  sideRoleResolution?: string;
  teamIdentityRule?: string;
  hardGuards?: string[];
}

export interface HexRoundFinanceEvidencePack {
  schemaVersion: 1;
  generatedAt: string;
  generator: string;
  dataMode: string;
  mapBindingId: string;
  financeMapSlug: string;
  roundNumber: number;
  roundKey: string;
  topicTitle: string;
  defenseThesisFocus: string;
  attackChallengeFocus: string;
  requiredSources: string[];
  optionalSources: string[];
  facts: HexFinanceEvidenceFact[];
  missingEvidence: string[];
  scoreCaps: HexFinanceScoreCap[];
  promptFacts: HexFinancePromptFact[];
  judgeLedger: HexFinanceJudgeLedger;
  sourceWarnings: string[];
}

export interface HexRoundFinanceEvidenceAggregate {
  schemaVersion: 1;
  generatedAt: string;
  generator: string;
  mapBindingId: string;
  financeMapSlug: string;
  dataMode: string;
  sideSwapPolicy: HexFinanceSideSwapPolicy;
  packs: HexRoundFinanceEvidencePack[];
}

export interface HexRoundFinanceTopic {
  roundNumber: number;
  roundKey: string;
  topicTitle: string;
  defenseThesisFocus: string;
  attackChallengeFocus: string;
}

export interface HexTeamFinanceThesis {
  thesisId: string;
  teamId: string;
  side: "defense";
  topicKey: string;
  thesis: string;
  keyAssumptions: string[];
  evidenceRefs: string[];
  riskBoundary: string;
}

export interface HexTeamFinanceChallenge {
  challengeId: string;
  teamId: string;
  side: "attack";
  topicKey: string;
  thesis: string;
  challengePoints: string[];
  requiredDefense: string[];
  evidenceRefs: string[];
}

export interface HexAgentFinanceAssignment {
  assignmentId: string;
  agentId: string;
  teamId: string;
  side: HexSide;
  role: string;
  topicKey: string;
  linkedThesisId?: string;
  linkedChallengeId?: string;
  financeTask: string;
  evidenceRules: string[];
}

export interface HexRoundFinanceDuel {
  schemaVersion: 1;
  source: "hex_round_finance_duel";
  roundNumber: number;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  overtimeUnsupported: boolean;
  attackTeamId: string;
  defenseTeamId: string;
  topic: HexRoundFinanceTopic;
  defenseThesis: HexTeamFinanceThesis;
  attackChallenge: HexTeamFinanceChallenge;
  agentAssignments: HexAgentFinanceAssignment[];
  evidencePackRef: {
    mapBindingId: string;
    financeMapSlug: string;
    generatedAt: string;
    aggregateEvidencePath: string;
  };
  evidence: {
    facts: HexFinanceEvidenceFact[];
    promptFacts: HexFinancePromptFact[];
    missingEvidence: string[];
    scoreCaps: HexFinanceScoreCap[];
    judgeLedger: HexFinanceJudgeLedger;
    sourceWarnings: string[];
  };
  sideSwapPolicy: HexFinanceSideSwapPolicy;
  sourceAudit: {
    mode: "generated_evidence_pack";
    materialPaths: Record<string, string>;
    notes: string[];
  };
}

export interface BuildHexRoundFinanceDuelInput {
  roundNumber: number;
  attackTeamId: string;
  defenseTeamId: string;
  agents: Array<{
    agentId: string;
    teamId: string;
    side: HexSide;
    role?: string;
  }>;
  workspaceRoot?: string;
  evidenceAggregate?: HexRoundFinanceEvidenceAggregate;
  aggregateEvidencePath?: string;
}

const defaultEvidencePath = "data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json";

export function buildHexRoundFinanceDuel(input: BuildHexRoundFinanceDuelInput): HexRoundFinanceDuel {
  const aggregate = input.evidenceAggregate ?? loadHexRoundFinanceEvidenceAggregate({
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.aggregateEvidencePath ? { aggregateEvidencePath: input.aggregateEvidencePath } : {})
  });
  const topicSelection = getHexRoundFinanceTopic({
    roundNumber: input.roundNumber,
    evidenceAggregate: aggregate
  });
  const pack = topicSelection.pack;
  const defenseThesis = buildDefenseThesis({
    roundNumber: input.roundNumber,
    defenseTeamId: input.defenseTeamId,
    pack
  });
  const attackChallenge = buildAttackChallenge({
    roundNumber: input.roundNumber,
    attackTeamId: input.attackTeamId,
    pack
  });
  const agentAssignments = input.agents.map((agent) => buildAgentAssignment({
    agent,
    pack,
    defenseThesisId: defenseThesis.thesisId,
    attackChallengeId: attackChallenge.challengeId
  }));

  return validateHexRoundFinanceDuel({
    schemaVersion: 1,
    source: "hex_round_finance_duel",
    roundNumber: input.roundNumber,
    halfIndex: topicSelection.halfIndex,
    roundInHalf: topicSelection.roundInHalf,
    mirrorRoundNumber: topicSelection.mirrorRoundNumber,
    overtimeUnsupported: topicSelection.overtimeUnsupported,
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    topic: {
      roundNumber: pack.roundNumber,
      roundKey: pack.roundKey,
      topicTitle: pack.topicTitle,
      defenseThesisFocus: pack.defenseThesisFocus,
      attackChallengeFocus: pack.attackChallengeFocus
    },
    defenseThesis,
    attackChallenge,
    agentAssignments,
    evidencePackRef: {
      mapBindingId: aggregate.mapBindingId,
      financeMapSlug: aggregate.financeMapSlug,
      generatedAt: aggregate.generatedAt,
      aggregateEvidencePath: input.aggregateEvidencePath ?? defaultEvidencePath
    },
    evidence: {
      facts: pack.facts.map((fact) => ({ ...fact })),
      promptFacts: pack.promptFacts.map((fact) => ({ ...fact })),
      missingEvidence: [...pack.missingEvidence],
      scoreCaps: pack.scoreCaps.map((cap) => ({ ...cap })),
      judgeLedger: {
        allowedClaims: [...pack.judgeLedger.allowedClaims],
        cappedClaims: [...pack.judgeLedger.cappedClaims],
        prohibitedClaims: [...pack.judgeLedger.prohibitedClaims]
      },
      sourceWarnings: [...pack.sourceWarnings]
    },
    sideSwapPolicy: { ...aggregate.sideSwapPolicy },
    sourceAudit: {
      mode: "generated_evidence_pack",
      materialPaths: {
        aggregateEvidencePath: input.aggregateEvidencePath ?? defaultEvidencePath
      },
      notes: [
        "finance_duel_replaces_business_prompt_semantics",
        "businessDuel_is_retained_only_for_trace_compatibility",
        ...(topicSelection.overtimeUnsupported ? ["overtime_not_defined_for_finance_duel_v1"] : [])
      ]
    }
  });
}

export function loadHexRoundFinanceEvidenceAggregate(input: {
  workspaceRoot?: string;
  aggregateEvidencePath?: string;
} = {}): HexRoundFinanceEvidenceAggregate {
  const workspaceRoot = input.workspaceRoot ?? findWorkspaceRoot(process.cwd());
  const relativePath = input.aggregateEvidencePath ?? defaultEvidencePath;
  const absolutePath = join(workspaceRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`hex_finance_duel_missing_evidence_pack:${relativePath}`);
  }
  return JSON.parse(readFileSync(absolutePath, "utf8")) as HexRoundFinanceEvidenceAggregate;
}

export function getHexRoundFinanceTopic(input: {
  roundNumber: number;
  evidenceAggregate: HexRoundFinanceEvidenceAggregate;
}): {
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  overtimeUnsupported: boolean;
  pack: HexRoundFinanceEvidencePack;
} {
  const topicCycleRoundCount = input.evidenceAggregate.sideSwapPolicy.topicCycleRoundCount ?? 6;
  if (topicCycleRoundCount !== 6) {
    throw new Error(`hex_finance_duel_unsupported_topic_cycle:${topicCycleRoundCount}`);
  }
  const overtimeUnsupported = input.roundNumber > 12;
  const normalizedRound = overtimeUnsupported ? ((input.roundNumber - 1) % 12) + 1 : input.roundNumber;
  const halfIndex = normalizedRound <= 6 ? 0 : 1;
  const roundInHalf = ((normalizedRound - 1) % 6) + 1;
  const mirrorRoundNumber = halfIndex === 0 ? normalizedRound + 6 : normalizedRound - 6;
  const pack = input.evidenceAggregate.packs.find((candidate) => candidate.roundNumber === roundInHalf)
    ?? input.evidenceAggregate.packs[roundInHalf - 1];
  if (!pack) {
    throw new Error(`hex_finance_duel_missing_round_pack:${roundInHalf}`);
  }
  return {
    halfIndex,
    roundInHalf,
    mirrorRoundNumber,
    overtimeUnsupported,
    pack
  };
}

export function getHexAgentFinanceAssignment(input: {
  financeDuel: HexRoundFinanceDuel;
  agentId: string;
}): HexAgentFinanceAssignment | undefined {
  return input.financeDuel.agentAssignments.find((assignment) => assignment.agentId === input.agentId);
}

export function validateHexRoundFinanceDuel(duel: HexRoundFinanceDuel): HexRoundFinanceDuel {
  const requiredTexts = [
    duel.source,
    duel.topic.roundKey,
    duel.topic.topicTitle,
    duel.topic.defenseThesisFocus,
    duel.topic.attackChallengeFocus,
    duel.defenseThesis.thesisId,
    duel.defenseThesis.thesis,
    duel.attackChallenge.challengeId,
    duel.attackChallenge.thesis
  ];
  for (const text of requiredTexts) {
    assertStableText(text, "hex_finance_duel_required_text");
  }
  if (duel.defenseThesis.teamId !== duel.defenseTeamId) {
    throw new Error("hex_finance_duel_defense_team_mismatch");
  }
  if (duel.attackChallenge.teamId !== duel.attackTeamId) {
    throw new Error("hex_finance_duel_attack_team_mismatch");
  }
  if (duel.evidence.promptFacts.length === 0) {
    throw new Error("hex_finance_duel_missing_prompt_facts");
  }
  const assignmentIds = new Set<string>();
  for (const assignment of duel.agentAssignments) {
    assertStableText(assignment.assignmentId, "hex_finance_duel_assignment_id");
    assertStableText(assignment.agentId, "hex_finance_duel_assignment_agent");
    assertStableText(assignment.financeTask, "hex_finance_duel_assignment_task");
    if (assignmentIds.has(assignment.assignmentId)) {
      throw new Error(`hex_finance_duel_duplicate_assignment:${assignment.assignmentId}`);
    }
    assignmentIds.add(assignment.assignmentId);
    if (assignment.side === "attack" && assignment.linkedChallengeId !== duel.attackChallenge.challengeId) {
      throw new Error(`hex_finance_duel_attack_assignment_link:${assignment.agentId}`);
    }
    if (assignment.side === "defense" && assignment.linkedThesisId !== duel.defenseThesis.thesisId) {
      throw new Error(`hex_finance_duel_defense_assignment_link:${assignment.agentId}`);
    }
  }
  return duel;
}

function buildDefenseThesis(input: {
  roundNumber: number;
  defenseTeamId: string;
  pack: HexRoundFinanceEvidencePack;
}): HexTeamFinanceThesis {
  return {
    thesisId: `finance_thesis_${input.roundNumber}_${input.defenseTeamId}_${input.pack.roundKey}`,
    teamId: input.defenseTeamId,
    side: "defense",
    topicKey: input.pack.roundKey,
    thesis: input.pack.defenseThesisFocus,
    keyAssumptions: input.pack.promptFacts.slice(0, 3).map((fact) => fact.shortText),
    evidenceRefs: input.pack.promptFacts.slice(0, 5).map((fact) => fact.evidenceId),
    riskBoundary: buildRiskBoundary(input.pack)
  };
}

function buildAttackChallenge(input: {
  roundNumber: number;
  attackTeamId: string;
  pack: HexRoundFinanceEvidencePack;
}): HexTeamFinanceChallenge {
  const challengePoints = input.pack.judgeLedger.cappedClaims.length > 0
    ? input.pack.judgeLedger.cappedClaims.slice(0, 3)
    : input.pack.missingEvidence.slice(0, 3).map((item) => `缺少 ${item}，相关主张需要降级。`);
  return {
    challengeId: `finance_challenge_${input.roundNumber}_${input.attackTeamId}_${input.pack.roundKey}`,
    teamId: input.attackTeamId,
    side: "attack",
    topicKey: input.pack.roundKey,
    thesis: input.pack.attackChallengeFocus,
    challengePoints,
    requiredDefense: input.pack.missingEvidence.slice(0, 4),
    evidenceRefs: input.pack.promptFacts.slice(0, 5).map((fact) => fact.evidenceId)
  };
}

function buildAgentAssignment(input: {
  agent: BuildHexRoundFinanceDuelInput["agents"][number];
  pack: HexRoundFinanceEvidencePack;
  defenseThesisId: string;
  attackChallengeId: string;
}): HexAgentFinanceAssignment {
  const role = input.agent.role?.trim() || "unknown";
  const sideTask = input.agent.side === "attack"
    ? `质疑：${input.pack.attackChallengeFocus}`
    : `自证：${input.pack.defenseThesisFocus}`;
  return {
    assignmentId: `finance_assignment_${input.agent.agentId}_${input.pack.roundKey}`,
    agentId: input.agent.agentId,
    teamId: input.agent.teamId,
    side: input.agent.side,
    role,
    topicKey: input.pack.roundKey,
    ...(input.agent.side === "attack" ? { linkedChallengeId: input.attackChallengeId } : { linkedThesisId: input.defenseThesisId }),
    financeTask: `${sideTask} / 角色 ${role} 必须用本回合证据包内事实承载观点。`,
    evidenceRules: [
      "只能引用 financeDuel.evidence.promptFacts 和 evidenceRefs。",
      "不能把代理事实冒充完整行业数据库结论。",
      "不能写最终胜负、击杀、伤害、经济变化或数据库事实。",
      "缺失证据必须作为风险边界，不得用想象补齐。"
    ]
  };
}

function buildRiskBoundary(pack: HexRoundFinanceEvidencePack): string {
  const missing = pack.missingEvidence.length > 0 ? `缺少 ${pack.missingEvidence.join(", ")}` : "暂无缺失证据登记";
  const cap = pack.scoreCaps[0] ? `评分上限 ${pack.scoreCaps[0].maxScore}: ${pack.scoreCaps[0].reason}` : "无评分上限";
  return `${missing}; ${cap}`;
}

function assertStableText(value: string, code: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${code}:empty`);
  }
  if (value.includes("\uFFFD") || /Ã.|Â.|â€|é�|�/.test(value)) {
    throw new Error(`${code}:garbled`);
  }
}

function findWorkspaceRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
  return resolve(startDirectory);
}
