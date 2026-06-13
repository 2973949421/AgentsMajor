import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Agent, Team, TeamInitialProposalSummary } from "@agent-major/shared";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import type { HexSide } from "../state/index.js";

export interface HexRoundBusinessSubtheme {
  subthemeId: string;
  subthemeIndex: number;
  title: string;
  coreQuestion: string;
  attackQuestion: string;
  defenseQuestion: string;
}

export interface HexTeamBusinessProof {
  proofId: string;
  teamId: string;
  side: "defense";
  subthemeId: string;
  thesis: string;
  claims: string[];
  evidenceFocus: string[];
  economyPosture?: string;
  buyType?: string;
}

export interface HexTeamBusinessChallenge {
  challengeId: string;
  teamId: string;
  side: "attack";
  subthemeId: string;
  thesis: string;
  challengePoints: string[];
  targetFailureModes: string[];
  economyPosture?: string;
  buyType?: string;
}

export interface HexAgentBusinessAssignment {
  assignmentId: string;
  agentId: string;
  teamId: string;
  side: HexSide;
  role: string;
  subthemeId: string;
  linkedProofId?: string;
  linkedChallengeId?: string;
  businessTask: string;
  csCarrierHint: string;
  evidenceRules: string[];
}

export interface HexBusinessDuelSourceAudit {
  mode: "material_summary" | "fixture_fallback";
  materialPaths: Record<string, string>;
  missingMaterialTeamIds: string[];
  overtimeUnsupported: boolean;
  notes: string[];
}

export interface HexBusinessTeamMaterialSummary extends TeamInitialProposalSummary {
  playerOperatingPrinciples: string[];
}

export interface HexRoundBusinessDuel {
  schemaVersion: 1;
  source: "hex_round_business_duel";
  roundNumber: number;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  overtimeUnsupported: boolean;
  subtheme: HexRoundBusinessSubtheme;
  attackTeamId: string;
  defenseTeamId: string;
  defenseProof: HexTeamBusinessProof;
  attackChallenge: HexTeamBusinessChallenge;
  agentAssignments: HexAgentBusinessAssignment[];
  sourceAudit: HexBusinessDuelSourceAudit;
}

export interface HexBusinessDuelTeamInput {
  team: Team;
  agents: Agent[];
  materialSummary?: HexBusinessTeamMaterialSummary;
}

export interface BuildHexRoundBusinessDuelInput {
  roundNumber: number;
  attack: HexBusinessDuelTeamInput;
  defense: HexBusinessDuelTeamInput;
  teamEconomyPlans?: Record<string, Pick<TeamEconomyPlan, "posture" | "summaryBuyType">>;
  workspaceRoot?: string;
}

export interface BuildFixtureHexRoundBusinessDuelInput {
  roundNumber: number;
  attackTeamId: string;
  defenseTeamId: string;
  agents: Array<{
    agentId: string;
    teamId: string;
    side: HexSide;
  }>;
}

const dust2BusinessSubthemes: HexRoundBusinessSubtheme[] = [
  {
    subthemeId: "dust2_business_subtheme_1",
    subthemeIndex: 1,
    title: "机会识别与高价值切口",
    coreQuestion: "谁能更准确判断本回合最值得争夺的商业切口。",
    attackQuestion: "攻方如何质疑守方对高价值机会的判断是否过窄或过慢。",
    defenseQuestion: "守方如何自证自身机会识别足够聚焦且能经受质疑。"
  },
  {
    subthemeId: "dust2_business_subtheme_2",
    subthemeIndex: 2,
    title: "信息差与中路控制",
    coreQuestion: "谁能围绕信息差建立更可信的决策优势。",
    attackQuestion: "攻方如何用信息争夺击穿守方的判断盲区。",
    defenseQuestion: "守方如何自证信息边界清楚且响应不被误导。"
  },
  {
    subthemeId: "dust2_business_subtheme_3",
    subthemeIndex: 3,
    title: "资源集中与关键位突破",
    coreQuestion: "谁能把有限资源压到最关键的突破窗口。",
    attackQuestion: "攻方如何质疑守方资源配置是否错位或分散。",
    defenseQuestion: "守方如何自证关键资源投入与防线价值匹配。"
  },
  {
    subthemeId: "dust2_business_subtheme_4",
    subthemeIndex: 4,
    title: "执行闭环与边界修补",
    coreQuestion: "谁能证明方案不是口号，而是有边界、有补位、有闭环。",
    attackQuestion: "攻方如何攻击守方执行闭环中的缺口。",
    defenseQuestion: "守方如何自证边界被覆盖，关键缺口已被修补。"
  },
  {
    subthemeId: "dust2_business_subtheme_5",
    subthemeIndex: 5,
    title: "叙事误导与转点响应",
    coreQuestion: "谁能在真假压力中保持商业判断稳定。",
    attackQuestion: "攻方如何制造质疑，让守方暴露叙事响应缺陷。",
    defenseQuestion: "守方如何自证面对误导时仍能守住主张。"
  },
  {
    subthemeId: "dust2_business_subtheme_6",
    subthemeIndex: 6,
    title: "终局主张与反证压力",
    coreQuestion: "谁能在终局压力下让核心主张经得起反证。",
    attackQuestion: "攻方如何集中质疑守方终局主张的不可持续性。",
    defenseQuestion: "守方如何自证最终主张能承受反证压力。"
  }
];

export function getHexRoundBusinessSubtheme(input: { roundNumber: number }): {
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  overtimeUnsupported: boolean;
  subtheme: HexRoundBusinessSubtheme;
} {
  const overtimeUnsupported = input.roundNumber > 12;
  const normalizedRound = overtimeUnsupported ? ((input.roundNumber - 1) % 12) + 1 : input.roundNumber;
  const halfIndex = normalizedRound <= 6 ? 0 : 1;
  const roundInHalf = ((normalizedRound - 1) % 6) + 1;
  const mirrorRoundNumber = halfIndex === 0 ? normalizedRound + 6 : normalizedRound - 6;
  return {
    halfIndex,
    roundInHalf,
    mirrorRoundNumber,
    overtimeUnsupported,
    subtheme: dust2BusinessSubthemes[roundInHalf - 1]!
  };
}

export function buildHexRoundBusinessDuel(input: BuildHexRoundBusinessDuelInput): HexRoundBusinessDuel {
  const subtheme = getHexRoundBusinessSubtheme({ roundNumber: input.roundNumber });
  const workspaceRoot = input.workspaceRoot ?? findWorkspaceRoot(process.cwd());
  const defenseMaterial = input.defense.materialSummary ?? loadTeamMaterialSummary(input.defense.team, workspaceRoot);
  const attackMaterial = input.attack.materialSummary ?? loadTeamMaterialSummary(input.attack.team, workspaceRoot);
  const missingMaterialTeamIds = [
    ...(defenseMaterial ? [] : [input.defense.team.id]),
    ...(attackMaterial ? [] : [input.attack.team.id])
  ];
  if (missingMaterialTeamIds.length > 0) {
    throw new Error(`hex_business_duel_missing_material:${missingMaterialTeamIds.join(",")}`);
  }

  const defensePlan = input.teamEconomyPlans?.[input.defense.team.id];
  const attackPlan = input.teamEconomyPlans?.[input.attack.team.id];
  const defenseProof = buildDefenseProof({
    roundNumber: input.roundNumber,
    teamId: input.defense.team.id,
    material: defenseMaterial!,
    subtheme: subtheme.subtheme,
    ...(defensePlan ? { economyPlan: defensePlan } : {})
  });
  const attackChallenge = buildAttackChallenge({
    roundNumber: input.roundNumber,
    teamId: input.attack.team.id,
    material: attackMaterial!,
    defenseMaterial: defenseMaterial!,
    subtheme: subtheme.subtheme,
    ...(attackPlan ? { economyPlan: attackPlan } : {})
  });
  const agentAssignments = [
    ...buildAssignmentsForTeam({
      agents: input.attack.agents,
      material: attackMaterial!,
      side: "attack",
      subtheme: subtheme.subtheme,
      linkedChallengeId: attackChallenge.challengeId
    }),
    ...buildAssignmentsForTeam({
      agents: input.defense.agents,
      material: defenseMaterial!,
      side: "defense",
      subtheme: subtheme.subtheme,
      linkedProofId: defenseProof.proofId
    })
  ];

  return validateHexRoundBusinessDuel({
    schemaVersion: 1,
    source: "hex_round_business_duel",
    roundNumber: input.roundNumber,
    halfIndex: subtheme.halfIndex,
    roundInHalf: subtheme.roundInHalf,
    mirrorRoundNumber: subtheme.mirrorRoundNumber,
    overtimeUnsupported: subtheme.overtimeUnsupported,
    subtheme: subtheme.subtheme,
    attackTeamId: input.attack.team.id,
    defenseTeamId: input.defense.team.id,
    defenseProof,
    attackChallenge,
    agentAssignments,
    sourceAudit: {
      mode: "material_summary",
      materialPaths: {
        [input.attack.team.id]: materialPathForTeam(input.attack.team) ?? "provided_material_summary",
        [input.defense.team.id]: materialPathForTeam(input.defense.team) ?? "provided_material_summary"
      },
      missingMaterialTeamIds,
      overtimeUnsupported: subtheme.overtimeUnsupported,
      notes: subtheme.overtimeUnsupported ? ["overtime_not_defined_in_n35"] : []
    }
  });
}

export function buildFixtureHexRoundBusinessDuel(input: BuildFixtureHexRoundBusinessDuelInput): HexRoundBusinessDuel {
  const subtheme = getHexRoundBusinessSubtheme({ roundNumber: input.roundNumber });
  const defenseProof: HexTeamBusinessProof = {
    proofId: `proof_${input.roundNumber}_${input.defenseTeamId}_${subtheme.subtheme.subthemeId}`,
    teamId: input.defenseTeamId,
    side: "defense",
    subthemeId: subtheme.subtheme.subthemeId,
    thesis: `Fixture defense proof for ${subtheme.subtheme.title}.`,
    claims: [subtheme.subtheme.defenseQuestion],
    evidenceFocus: ["fixture_defense_assignment"]
  };
  const attackChallenge: HexTeamBusinessChallenge = {
    challengeId: `challenge_${input.roundNumber}_${input.attackTeamId}_${subtheme.subtheme.subthemeId}`,
    teamId: input.attackTeamId,
    side: "attack",
    subthemeId: subtheme.subtheme.subthemeId,
    thesis: `Fixture attack challenge for ${subtheme.subtheme.title}.`,
    challengePoints: [subtheme.subtheme.attackQuestion],
    targetFailureModes: ["fixture_attack_assignment"]
  };
  return validateHexRoundBusinessDuel({
    schemaVersion: 1,
    source: "hex_round_business_duel",
    roundNumber: input.roundNumber,
    halfIndex: subtheme.halfIndex,
    roundInHalf: subtheme.roundInHalf,
    mirrorRoundNumber: subtheme.mirrorRoundNumber,
    overtimeUnsupported: subtheme.overtimeUnsupported,
    subtheme: subtheme.subtheme,
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    defenseProof,
    attackChallenge,
    agentAssignments: input.agents.map((agent) => ({
      assignmentId: `assignment_${input.roundNumber}_${agent.agentId}_${subtheme.subtheme.subthemeId}`,
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      role: "unknown",
      subthemeId: subtheme.subtheme.subthemeId,
      ...(agent.side === "attack" ? { linkedChallengeId: attackChallenge.challengeId } : { linkedProofId: defenseProof.proofId }),
      businessTask: agent.side === "attack" ? subtheme.subtheme.attackQuestion : subtheme.subtheme.defenseQuestion,
      csCarrierHint: agent.side === "attack" ? "用行动承载质疑。" : "用站位和交火承载自证。",
      evidenceRules: ["fixture_assignment_not_positive_business_evidence"]
    })),
    sourceAudit: {
      mode: "fixture_fallback",
      materialPaths: {},
      missingMaterialTeamIds: [],
      overtimeUnsupported: subtheme.overtimeUnsupported,
      notes: ["fixture_fallback_business_duel", ...(subtheme.overtimeUnsupported ? ["overtime_not_defined_in_n35"] : [])]
    }
  });
}

export function validateHexRoundBusinessDuel(duel: HexRoundBusinessDuel): HexRoundBusinessDuel {
  const requiredTexts = [
    duel.source,
    duel.subtheme.subthemeId,
    duel.subtheme.title,
    duel.subtheme.coreQuestion,
    duel.defenseProof.proofId,
    duel.defenseProof.teamId,
    duel.defenseProof.thesis,
    duel.attackChallenge.challengeId,
    duel.attackChallenge.teamId,
    duel.attackChallenge.thesis
  ];
  const assignmentIds = new Set<string>();
  for (const text of requiredTexts) {
    assertStableText(text, "hex_business_duel_required_text");
  }
  if (duel.defenseProof.teamId !== duel.defenseTeamId) {
    throw new Error("hex_business_duel_defense_team_mismatch");
  }
  if (duel.attackChallenge.teamId !== duel.attackTeamId) {
    throw new Error("hex_business_duel_attack_team_mismatch");
  }
  if (duel.defenseProof.subthemeId !== duel.subtheme.subthemeId || duel.attackChallenge.subthemeId !== duel.subtheme.subthemeId) {
    throw new Error("hex_business_duel_subtheme_mismatch");
  }
  if (duel.defenseProof.claims.length === 0 || duel.attackChallenge.challengePoints.length === 0) {
    throw new Error("hex_business_duel_missing_claims");
  }
  for (const assignment of duel.agentAssignments) {
    assertStableText(assignment.assignmentId, "hex_business_duel_assignment_id");
    assertStableText(assignment.agentId, "hex_business_duel_assignment_agent");
    assertStableText(assignment.teamId, "hex_business_duel_assignment_team");
    assertStableText(assignment.businessTask, "hex_business_duel_assignment_task");
    if (assignmentIds.has(assignment.assignmentId)) {
      throw new Error(`hex_business_duel_duplicate_assignment:${assignment.assignmentId}`);
    }
    assignmentIds.add(assignment.assignmentId);
    if (assignment.side === "attack" && assignment.linkedChallengeId !== duel.attackChallenge.challengeId) {
      throw new Error(`hex_business_duel_attack_assignment_link:${assignment.agentId}`);
    }
    if (assignment.side === "defense" && assignment.linkedProofId !== duel.defenseProof.proofId) {
      throw new Error(`hex_business_duel_defense_assignment_link:${assignment.agentId}`);
    }
  }
  return duel;
}

export function getHexAgentBusinessAssignment(input: {
  businessDuel: HexRoundBusinessDuel;
  agentId: string;
}): HexAgentBusinessAssignment | undefined {
  return input.businessDuel.agentAssignments.find((assignment) => assignment.agentId === input.agentId);
}

function buildDefenseProof(input: {
  roundNumber: number;
  teamId: string;
  material: TeamInitialProposalSummary;
  subtheme: HexRoundBusinessSubtheme;
  economyPlan?: Pick<TeamEconomyPlan, "posture" | "summaryBuyType">;
}): HexTeamBusinessProof {
  return {
    proofId: `proof_${input.roundNumber}_${input.teamId}_${input.subtheme.subthemeId}`,
    teamId: input.teamId,
    side: "defense",
    subthemeId: input.subtheme.subthemeId,
    thesis: `${input.material.teamThesis} / ${input.subtheme.defenseQuestion}`,
    claims: selectStableItems(input.material.mustHoldClaims, input.subtheme.subthemeIndex, 2),
    evidenceFocus: [
      input.material.product,
      input.material.operations,
      input.material.moat
    ].filter((item) => item.length > 0).slice(0, 3),
    ...(input.economyPlan?.posture ? { economyPosture: input.economyPlan.posture } : {}),
    ...(input.economyPlan?.summaryBuyType ? { buyType: input.economyPlan.summaryBuyType } : {})
  };
}

function buildAttackChallenge(input: {
  roundNumber: number;
  teamId: string;
  material: HexBusinessTeamMaterialSummary;
  defenseMaterial: HexBusinessTeamMaterialSummary;
  subtheme: HexRoundBusinessSubtheme;
  economyPlan?: Pick<TeamEconomyPlan, "posture" | "summaryBuyType">;
}): HexTeamBusinessChallenge {
  return {
    challengeId: `challenge_${input.roundNumber}_${input.teamId}_${input.subtheme.subthemeId}`,
    teamId: input.teamId,
    side: "attack",
    subthemeId: input.subtheme.subthemeId,
    thesis: `${input.material.teamThesis} / ${input.subtheme.attackQuestion}`,
    challengePoints: selectStableItems(input.defenseMaterial.failureModes, input.subtheme.subthemeIndex, 2),
    targetFailureModes: selectStableItems(input.defenseMaterial.failureModes, input.subtheme.subthemeIndex + 1, 2),
    ...(input.economyPlan?.posture ? { economyPosture: input.economyPlan.posture } : {}),
    ...(input.economyPlan?.summaryBuyType ? { buyType: input.economyPlan.summaryBuyType } : {})
  };
}

function buildAssignmentsForTeam(input: {
  agents: Agent[];
  material: HexBusinessTeamMaterialSummary;
  side: HexSide;
  subtheme: HexRoundBusinessSubtheme;
  linkedProofId?: string;
  linkedChallengeId?: string;
}): HexAgentBusinessAssignment[] {
  return input.agents.map((agent, index) => {
    const role = agent.roleProfile?.primaryRole ?? agent.role;
    const responsibility = agent.roleProfile?.agentMajorResponsibilities?.[0]
      ?? selectStableItems(input.material.playerOperatingPrinciples, index + 1, 1)[0]
      ?? "围绕本回合商业攻防职责执行。";
    return {
      assignmentId: `assignment_${agent.id}_${input.subtheme.subthemeId}`,
      agentId: agent.id,
      teamId: agent.teamId,
      side: input.side,
      role,
      subthemeId: input.subtheme.subthemeId,
      ...(input.linkedProofId ? { linkedProofId: input.linkedProofId } : {}),
      ...(input.linkedChallengeId ? { linkedChallengeId: input.linkedChallengeId } : {}),
      businessTask: input.side === "attack"
        ? `质疑：${input.subtheme.attackQuestion} / ${responsibility}`
        : `自证：${input.subtheme.defenseQuestion} / ${responsibility}`,
      csCarrierHint: input.side === "attack"
        ? "用推进、控图、下包压力或交火承载质疑。"
        : "用站位、信息、交叉火力、回防或阻断承载自证。",
      evidenceRules: [
        "只能用本回合行动承载商业攻防。",
        "fallback 文本不能作为正向商业证据。",
        "不能写最终胜负、击杀、伤害或经济变化。"
      ]
    };
  });
}

function loadTeamMaterialSummary(team: Team, workspaceRoot: string): HexBusinessTeamMaterialSummary | undefined {
  const materialPath = materialPathForTeam(team);
  if (!materialPath) {
    return undefined;
  }
  const absolutePath = join(workspaceRoot, "data/materials", materialPath.replace(/^data[\\/]+materials[\\/]+/, ""));
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(absolutePath, "utf8")) as HexBusinessTeamMaterialSummary & { teamSlug?: string; displayName?: string };
  return {
    proposalId: raw.proposalId,
    version: raw.version,
    teamThesis: raw.teamThesis,
    opportunity: raw.opportunity,
    product: raw.product,
    engineering: raw.engineering,
    business: raw.business,
    operations: raw.operations,
    scaling: raw.scaling,
    moat: raw.moat,
    mustHoldClaims: [...raw.mustHoldClaims],
    failureModes: [...raw.failureModes],
    playerOperatingPrinciples: [...(raw.playerOperatingPrinciples ?? [])],
    frontendSummary: raw.frontendSummary
  };
}

function materialPathForTeam(team: Team): string | undefined {
  const source = team.source;
  if (isRecord(source)) {
    const processedPaths = source.processed_paths;
    if (isRecord(processedPaths) && typeof processedPaths.initial_proposal === "string") {
      return processedPaths.initial_proposal;
    }
    const materialRefs = source.material_refs;
    if (isRecord(materialRefs) && typeof materialRefs.initial_proposal === "string") {
      return materialRefs.initial_proposal;
    }
    if (typeof source.team_slug === "string") {
      return `processed/teams/${source.team_slug}/initial-proposal.json`;
    }
  }
  if (team.shortName) {
    return `processed/teams/${slugify(team.shortName)}/initial-proposal.json`;
  }
  return undefined;
}

function selectStableItems(items: readonly string[], seed: number, count: number): string[] {
  if (items.length === 0) {
    return [];
  }
  const start = Math.abs(seed - 1) % items.length;
  return Array.from({ length: Math.min(count, items.length) }, (_, offset) => items[(start + offset) % items.length]!)
    .filter((item) => item.length > 0);
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
