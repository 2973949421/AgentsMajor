import type { LlmResponse } from "@agent-major/llm";
import { teamRoundPlanDecisionSchema } from "@agent-major/shared";
import type {
  Agent,
  BuyType,
  CoachTimeoutCorrection,
  EconomyState,
  EconomyPosture,
  LoadoutPackage,
  MapGame,
  Match,
  Round,
  ScorePair,
  SideAssignment,
  Team,
  TeamRoundPlanDecision
} from "@agent-major/shared";

import type { RoundRetryMode } from "./engine.js";
import {
  normalizeKnownTacticalZoneId,
  normalizeLlmEconomyPosture,
  normalizeLlmLoadoutPackage,
  sanitizeLlmPayload
} from "../llm/llm-output-normalizer.js";
import type { LlmStageRunner } from "../llm/llm-stage-runner.js";
import type { SideContext } from "../match/map-rules.js";
import type { TeamEconomyPlan } from "../economy/economy-output-service.js";
import type { RuleBasedTacticalPlans } from "../match/tactical-protocol.js";

export interface TeamPlanPipelineCoachTimeout {
  teamId: string;
  correction: CoachTimeoutCorrection;
}

export interface TeamPlanPipelineInput {
  match: Match;
  round: Round;
  observabilityAttempt: number;
  mapGame: MapGame;
  sideContext: SideContext;
  sideAssignment: SideAssignment;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  buyTypeByTeam: Map<string, BuyType>;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  beforeEconomy: EconomyState[];
  tacticalPlans?: RuleBasedTacticalPlans;
  recentPublicRoundSummaries: string[];
  coachTimeout?: TeamPlanPipelineCoachTimeout;
  retryMode?: RoundRetryMode | undefined;
  stageRunner: LlmStageRunner;
}

export interface TeamPlanPipelineSideInput {
  team: Team;
  opponent: Team;
  activeAgents: Agent[];
  side: "attack" | "defense";
  tacticalHint?: RuleBasedTacticalPlans["attackPlan"] | RuleBasedTacticalPlans["defenseDeployment"] | undefined;
  teamMemoryOverlay?: Record<string, unknown> | undefined;
}

export interface TeamPlanPipelineDependencies {
  readTeamMemoryOverlay(teamId: string): Promise<Record<string, unknown> | undefined>;
  buildRequestInput(input: TeamPlanPipelineInput & TeamPlanPipelineSideInput): unknown;
  validateResponseData?(data: unknown, input: TeamPlanPipelineInput & TeamPlanPipelineSideInput): TeamRoundPlanDecision;
  shouldRetryStructuredJsonWithoutThinking(errorMessage: string): boolean;
}

const llmThinkingDisabledParams = {
  thinking: { type: "disabled" }
} satisfies Record<string, unknown>;

const llmThinkingEnabledParams = {
  thinking: { type: "enabled" },
  reasoning_effort: "high"
} satisfies Record<string, unknown>;

export async function runTeamPlanPipeline(
  input: TeamPlanPipelineInput,
  dependencies: TeamPlanPipelineDependencies
): Promise<Record<string, TeamRoundPlanDecision>> {
  const sides = [
    { team: input.teamA, opponent: input.teamB, activeAgents: input.activeA },
    { team: input.teamB, opponent: input.teamA, activeAgents: input.activeB }
  ];
  const output: Record<string, TeamRoundPlanDecision> = {};

  for (const side of sides) {
    const teamSide = side.team.id === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    const sideInput = {
      ...input,
      team: side.team,
      opponent: side.opponent,
      activeAgents: side.activeAgents,
      side: teamSide,
      tacticalHint: teamSide === "attack" ? input.tacticalPlans?.attackPlan : input.tacticalPlans?.defenseDeployment,
      teamMemoryOverlay: await dependencies.readTeamMemoryOverlay(side.team.id)
    } satisfies TeamPlanPipelineInput & TeamPlanPipelineSideInput;
    const requestInput = dependencies.buildRequestInput(sideInput);
    const validateResponseData = (data: unknown) =>
      (dependencies.validateResponseData ?? validateTeamPlanResponseData)(data, sideInput);

    let response: LlmResponse<TeamRoundPlanDecision>;
    try {
      response = await input.stageRunner.runStructuredStage<TeamRoundPlanDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(side.team.id)}_team_plan`,
        stageId: `team_plan:${side.team.id}`,
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "team_plan",
        schemaName: "TeamRoundPlanDecision",
        driverModelId: side.activeAgents[0]?.driverModelId ?? "",
        requestInput,
        responseFormat: "json_object",
        seed: `team_plan:${input.round.id}:${side.team.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 3200,
        extraParams: llmThinkingEnabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.round.roundNumber,
        validateResponseData
      });
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      if (!dependencies.shouldRetryStructuredJsonWithoutThinking(validationError)) {
        throw error;
      }
      response = await input.stageRunner.runStructuredStage<TeamRoundPlanDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(side.team.id)}_team_plan_no_thinking`,
        stageId: `team_plan:${side.team.id}`,
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "team_plan",
        schemaName: "TeamRoundPlanDecision",
        driverModelId: side.activeAgents[0]?.driverModelId ?? "",
        requestInput,
        responseFormat: "json_object",
        seed: `team_plan_no_thinking:${input.round.id}:${side.team.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 2200,
        extraParams: llmThinkingDisabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.round.roundNumber,
        validateResponseData
      });
    }

    output[side.team.id] = response.data;
  }

  return output;
}

export function validateTeamPlanResponseData(
  data: unknown,
  sideInput: TeamPlanPipelineInput & TeamPlanPipelineSideInput
): TeamRoundPlanDecision {
  return validateTeamRoundPlan({
    plan: teamRoundPlanDecisionSchema.parse(
      normalizeTeamRoundPlanPayload(sanitizeLlmPayload(data), {
        activeAgents: sideInput.activeAgents,
        defaultPosture: sideInput.teamEconomyPlans[sideInput.team.id]?.posture ?? "eco",
        economySummary: sideInput.teamEconomyPlans[sideInput.team.id]?.postureReason ?? "按当前经济态势执行团队买型。",
        buyIntentByAgent: sideInput.activeAgents.map((agent) => {
          const decision = sideInput.teamEconomyPlans[sideInput.team.id]?.decisions.find((entry) => entry.agentId === agent.id);
          const buyIntent: {
            agentId: string;
            targetPosture: EconomyPosture;
            preferredLoadout?: LoadoutPackage;
          } = {
            agentId: agent.id,
            targetPosture: decision?.economyPosture ?? sideInput.teamEconomyPlans[sideInput.team.id]?.posture ?? "eco"
          };
          if (decision?.loadoutPackage) {
            buyIntent.preferredLoadout = decision.loadoutPackage;
          }
          return buyIntent;
        })
      })
    ),
    teamId: sideInput.team.id,
    expectedSide: sideInput.side,
    activeAgents: sideInput.activeAgents
  });
}

export function validateTeamRoundPlan(input: {
  plan: TeamRoundPlanDecision;
  teamId: string;
  expectedSide: "attack" | "defense";
  activeAgents: Agent[];
}): TeamRoundPlanDecision {
  if (input.plan.teamId !== input.teamId) {
    throw new Error(`Team plan returned an invalid teamId: ${input.plan.teamId}`);
  }
  if (input.plan.side !== input.expectedSide) {
    throw new Error(`Team plan returned an invalid side: ${input.plan.side}`);
  }

  const activeAgentIds = new Set(input.activeAgents.map((agent) => agent.id));
  const directiveAgentIds = input.plan.playerDirectives.map((directive: TeamRoundPlanDecision["playerDirectives"][number]) => directive.agentId);
  const directiveAgentIdSet = new Set(directiveAgentIds);
  if (directiveAgentIdSet.size !== directiveAgentIds.length) {
    throw new Error(`Team plan returned duplicate player directives for ${input.teamId}`);
  }
  for (const agentId of directiveAgentIds) {
    if (!activeAgentIds.has(agentId)) {
      throw new Error(`repair_invalid_agent_id: Team plan returned directive for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!directiveAgentIdSet.has(agentId)) {
      throw new Error(`Team plan missed directive for active agent: ${agentId}`);
    }
  }
  if (input.plan.economyIntent?.buyIntentByAgent) {
    const intentAgentIds = input.plan.economyIntent.buyIntentByAgent.map((entry) => entry.agentId);
    const intentAgentSet = new Set(intentAgentIds);
    if (intentAgentSet.size !== intentAgentIds.length) {
      throw new Error(`Team plan returned duplicate economyIntent entries for ${input.teamId}`);
    }
    for (const agentId of intentAgentIds) {
      if (!activeAgentIds.has(agentId)) {
        throw new Error(`Team plan returned economyIntent for inactive agent: ${agentId}`);
      }
    }
  }

  return input.plan;
}

export function normalizeTeamRoundPlanPayload(
  data: unknown,
  options?: {
    activeAgents?: Array<{ id: string; displayName?: string; role?: string }>;
    defaultPosture?: EconomyPosture;
    economySummary?: string;
    buyIntentByAgent?: Array<{
      agentId: string;
      targetPosture?: EconomyPosture;
      preferredLoadout?: LoadoutPackage;
    }>;
  }
): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  let playerDirectives = record.playerDirectives;
  if (!Array.isArray(record.playerDirectives)) {
    const directivesRecord = readUnknownRecord(record.playerDirectives);
    if (directivesRecord) {
      playerDirectives = Object.entries(directivesRecord).map(([agentId, directiveValue]) => {
        if (typeof directiveValue === "string") {
          return {
            agentId,
            directive: directiveValue
          };
        }

        const directiveRecord = readUnknownRecord(directiveValue);
        if (directiveRecord && typeof directiveRecord.directive === "string") {
          return {
            agentId,
            directive: directiveRecord.directive
          };
        }

        return {
          agentId,
          directive: directiveValue
        };
      });
    }
  }
  playerDirectives = normalizeTeamPlanDirectiveAgentIds(playerDirectives, options?.activeAgents);

  let economyIntent: unknown = record.economyIntent;
  const economyIntentRecord = readUnknownRecord(record.economyIntent);
  if (economyIntentRecord || options?.defaultPosture || options?.economySummary || options?.buyIntentByAgent) {
    const defaultPosture =
      options?.defaultPosture ?? normalizeLlmEconomyPosture(economyIntentRecord?.defaultPosture) ?? "eco";
    const buyIntentByAgent = options?.buyIntentByAgent?.map((entry) =>
      removeUndefined({
        agentId: entry.agentId,
        targetPosture: normalizeLlmEconomyPosture(entry.targetPosture) ?? defaultPosture,
        preferredLoadout: normalizeLlmLoadoutPackage(entry.preferredLoadout)
      })
    );
    economyIntent = {
      ...(economyIntentRecord ?? {}),
      defaultPosture,
      summary:
        typeof economyIntentRecord?.summary === "string"
          ? normalizeChineseFirstTacticalText(economyIntentRecord.summary)
          : normalizeChineseFirstTacticalText(options?.economySummary ?? "按当前经济态势执行团队买型。"),
      ...(buyIntentByAgent ? { buyIntentByAgent } : {})
    };
  }

  return {
    ...record,
    ...(typeof record.primaryIntent === "string" ? { primaryIntent: normalizeChineseFirstTacticalText(record.primaryIntent) } : {}),
    ...(typeof record.primaryZoneId === "string"
      ? { primaryZoneId: normalizeKnownTacticalZoneId(record.primaryZoneId) ?? record.primaryZoneId }
      : {}),
    ...(typeof record.secondaryZoneId === "string"
      ? { secondaryZoneId: normalizeKnownTacticalZoneId(record.secondaryZoneId) ?? record.secondaryZoneId }
      : {}),
    ...(typeof record.coordinationSummary === "string"
      ? { coordinationSummary: normalizeChineseFirstTacticalText(record.coordinationSummary) }
      : {}),
    playerDirectives: Array.isArray(playerDirectives)
      ? playerDirectives.map((entry) => {
          const directiveRecord = readUnknownRecord(entry);
          if (!directiveRecord || typeof directiveRecord.directive !== "string") {
            return entry;
          }
          return {
            ...directiveRecord,
            directive: normalizeChineseFirstTacticalText(directiveRecord.directive)
          };
        })
      : playerDirectives,
    ...(typeof record.winCondition === "string" ? { winCondition: normalizeChineseFirstTacticalText(record.winCondition) } : {}),
    ...(typeof record.risk === "string" ? { risk: normalizeChineseFirstTacticalText(record.risk) } : {}),
    economyIntent
  };
}

function normalizeTeamPlanDirectiveAgentIds(
  playerDirectives: unknown,
  activeAgents: Array<{ id: string; displayName?: string; role?: string }> | undefined
): unknown {
  if (!Array.isArray(playerDirectives) || !activeAgents || activeAgents.length === 0) {
    return playerDirectives;
  }

  const directiveRecords = playerDirectives.map((entry) => readUnknownRecord(entry));
  if (directiveRecords.some((entry) => !entry || typeof entry.agentId !== "string")) {
    return playerDirectives;
  }

  const activeAgentIds = new Set(activeAgents.map((agent) => agent.id));
  const allAlreadyValid = directiveRecords.every((entry) => activeAgentIds.has(String(entry?.agentId)));
  if (allAlreadyValid) {
    return playerDirectives;
  }

  const directiveAgentIds = directiveRecords.map((entry) => String(entry?.agentId ?? ""));
  const canMapByPosition =
    directiveRecords.length === activeAgents.length &&
    directiveAgentIds.every(isOrderedAgentPlaceholder) &&
    orderedPlaceholdersAreUniqueAndContiguous(directiveAgentIds);
  if (!canMapByPosition) {
    return playerDirectives;
  }

  return directiveRecords.map((entry, index) => ({
    ...entry,
    agentId: activeAgents[index]?.id
  }));
}

function isOrderedAgentPlaceholder(value: string): boolean {
  return /^(?:player|agent)[_-]?[1-9]\d*$/i.test(value.trim());
}

function orderedPlaceholdersAreUniqueAndContiguous(values: string[]): boolean {
  const indexes = values
    .map((value) => /(\d+)$/.exec(value.trim())?.[1])
    .map((value) => (value ? Number.parseInt(value, 10) : Number.NaN));
  if (indexes.some((value) => !Number.isFinite(value))) {
    return false;
  }
  const unique = new Set(indexes);
  if (unique.size !== indexes.length) {
    return false;
  }
  return indexes.every((value) => value >= 1 && value <= indexes.length);
}

function normalizeChineseFirstTacticalText(value: string): string {
  let output = value.trim();
  const replacements: Array<{ source: string; target: string }> = [
    { source: "with controlled aggression", target: "以可控侵略性" },
    { source: "controlled aggression", target: "可控侵略性" },
    { source: "primary task", target: "首要任务" },
    { source: "do not overcommit", target: "不要过度投入" },
    { source: "overcommit", target: "过度投入" },
    { source: "immediately", target: "立即" },
    { source: "toward", target: "朝向" },
    { source: "probe", target: "试探" },
    { source: "rotation", target: "轮转" },
    { source: "rotations", target: "轮转" },
    { source: "window control", target: "窗口控制" },
    { source: "window", target: "窗口" },
    { source: "spawn", target: "出生点" },
    { source: "crossfire", target: "交叉火力" },
    { source: "sightlines", target: "枪线" },
    { source: "sightline", target: "枪线" },
    { source: "flank", target: "侧翼" },
    { source: "closeout", target: "收束" }
  ];
  for (const replacement of replacements) {
    output = output.replace(buildLiteralPattern(replacement.source), replacement.target);
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function buildLiteralPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return /^[A-Za-z0-9_]+$/.test(value) ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
