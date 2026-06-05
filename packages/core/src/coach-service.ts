import type {
  Agent,
  CoachPostMatchReview,
  CoachTimeoutCorrection,
  Event,
  MapGame,
  Match,
  Round,
  RoundReport,
  ScorePair,
  Summary,
  Team
} from "@agent-major/shared";
import {
  coachPostMatchReviewSchema,
  coachTimeoutCorrectionSchema
} from "@agent-major/shared";

import type { Repositories } from "@agent-major/db";

import { cs2EconomyRules } from "./economy-output-service.js";
import { sanitizeLlmPayload } from "./llm-output-normalizer.js";
import type { LlmStageRunner } from "./llm-stage-runner.js";
import { mr6MapRules } from "./map-rules.js";

export interface ResolvedCoachTimeout {
  teamId: string;
  teamName: string;
  triggerRoundId: string;
  triggerRoundNumber: number;
  correction: CoachTimeoutCorrection;
  responseArtifactId?: string;
  timeoutsRemainingBefore: number;
  timeoutsRemainingAfter: number;
  tokenBankBefore: number;
  tokenBankAfter: number;
}

export interface CoachServiceContext {
  repositories: Repositories;
  stageRunner: LlmStageRunner;
  useLlmCoachTimeouts?: boolean | undefined;
  useLlmCoachPostMatchReviews?: boolean | undefined;
  appendEvent(input: Omit<Event, "globalSequence" | "sequenceInScope">): Promise<Event>;
}

export interface CoachServiceDependencies {
  readApprovedTeamMemoryOverlay(teamId: string): Promise<Record<string, unknown> | undefined>;
  readMapSemanticContext(mapName: string): Record<string, unknown> | undefined;
  readJudgeRubricContext(mapName: string): Record<string, unknown> | undefined;
  readTeamInitialProposal(team: Team): unknown;
  readTeamCoachContext(team: Team): Record<string, unknown> | undefined;
  sortAgentsForRound(agents: Agent[]): Agent[];
}

const coachTimeoutMinRoundNumber = 5;
const coachTimeoutCooldownRounds = 3;
const coachTimeoutBalanceGuardrail = "平衡约束：主区优先，但至少保留一个次级区域的信息锚点或回防锚点，禁止五人全部压向同一单点。";
const llmThinkingDisabledParams = {
  thinking: { type: "disabled" }
} satisfies Record<string, unknown>;

export async function ensureCoachStatesForMap(input: {
  context: CoachServiceContext;
  mapGame: MapGame;
  match: Match;
}): Promise<void> {
  const existingStates = await input.context.repositories.teamMapCoachStates.listByMapGame(input.mapGame.id);
  const existingTeamIds = new Set(existingStates.map((state) => state.teamId));
  const now = timestamp();
  for (const teamId of [input.match.teamAId, input.match.teamBId]) {
    if (existingTeamIds.has(teamId)) {
      continue;
    }

    await input.context.repositories.teamMapCoachStates.save({
      mapGameId: input.mapGame.id,
      teamId,
      timeoutsRemaining: 2,
      tokenBank: cs2EconomyRules.coachInitialBank,
      updatedAt: now
    });
  }
}

export async function resolveCoachTimeoutIfNeeded(input: {
  context: CoachServiceContext;
  dependencies: CoachServiceDependencies;
  match: Match;
  mapGame: MapGame;
  round: Round;
  observabilityAttempt: number;
  roundNumber: number;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  recentRoundReports: RoundReport[];
}): Promise<ResolvedCoachTimeout | undefined> {
  const previousReport = input.recentRoundReports.at(-1);
  if (!previousReport) {
    return undefined;
  }

  const losingTeamId = previousReport.winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
  const losingTeam = losingTeamId === input.teamA.id ? input.teamA : input.teamB;
  const activeAgents = losingTeamId === input.teamA.id ? input.activeA : input.activeB;
  const coachState = await input.context.repositories.teamMapCoachStates.getByMapGameAndTeam(input.mapGame.id, losingTeamId);
  if (!coachState || coachState.timeoutsRemaining <= 0) {
    return undefined;
  }
  const coachTokenBank = coachState.tokenBank ?? cs2EconomyRules.coachInitialBank;
  if (coachTokenBank < cs2EconomyRules.coachTimeoutCost) {
    return undefined;
  }
  if (input.roundNumber < coachTimeoutMinRoundNumber) {
    return undefined;
  }
  if (
    typeof coachState.lastTimeoutRoundNumber === "number" &&
    input.roundNumber - coachState.lastTimeoutRoundNumber <= coachTimeoutCooldownRounds
  ) {
    return undefined;
  }

  const triggerReason = detectCoachTimeoutTrigger({
    losingTeam,
    recentRoundReports: input.recentRoundReports,
    scoreBeforeRound: input.scoreBeforeRound,
    teamAId: input.teamA.id,
    teamBId: input.teamB.id
  });
  if (!triggerReason || !input.context.useLlmCoachTimeouts) {
    return undefined;
  }

  const response = await input.context.stageRunner.runStructuredStage<CoachTimeoutCorrection>({
    callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(losingTeamId)}_coach_timeout`,
    attemptNumber: input.observabilityAttempt,
    task: "coach_timeout",
    schemaName: "CoachTimeoutCorrection",
    driverModelId: activeAgents[0]?.driverModelId ?? "",
    requestInput: {
      objective: "在战术暂停窗口内输出一张只影响下一回合的结构化修正单。",
      roundId: input.round.id,
      roundNumber: input.roundNumber,
      mapName: input.mapGame.mapName,
      teamId: losingTeam.id,
      teamName: losingTeam.displayName,
      mapSemanticContext: input.dependencies.readMapSemanticContext(input.mapGame.mapName),
      judgeRubricContext: input.dependencies.readJudgeRubricContext(input.mapGame.mapName),
      initialProposal: input.dependencies.readTeamInitialProposal(losingTeam),
      coachContext: input.dependencies.readTeamCoachContext(losingTeam),
      teamMemoryOverlay: await input.dependencies.readApprovedTeamMemoryOverlay(losingTeam.id),
      triggerRoundNumber: previousReport.roundNumber,
      triggerRoundSummary: previousReport.summary,
      triggerReason,
      triggerPolicy: {
        earliestTimeoutRound: coachTimeoutMinRoundNumber,
        cooldownRoundsAfterLastTimeoutTrigger: coachTimeoutCooldownRounds,
        repeatedGapRequiresAtLeastTwoMatchingDiagnostics: true
      },
      antiOvercorrectionRules: [
        "修正单只能指定主优先区，不能让五名选手全部压向同一单点。",
        "必须保留至少一个次级区域的信息锚点或回防锚点。",
        "禁止使用“唯一主攻方向”“不参与某区任何行动”“取消所有某区 call”这类绝对指令。",
        "playerAdjustments 可以分工不同：3人围绕主区，1人信息，1人回防/兜底。"
      ],
      latestJudgeDiagnostic: previousReport.judgeDiagnostic ?? previousReport.judgeResult.diagnostic,
      recentPublicRoundSummaries: input.recentRoundReports.map((report) => report.summary),
      activeAgents: activeAgents.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? []
      }))
    },
    responseFormat: "json_object",
    seed: `coach_timeout:${input.round.id}:${losingTeam.id}`,
    modelTier: "cheap",
    temperature: 0,
    maxOutputTokens: 1600,
    extraParams: llmThinkingDisabledParams,
    match: input.match,
    mapGame: input.mapGame,
    round: input.round,
    roundNumber: input.roundNumber,
    validateResponseData: (data) =>
      validateCoachTimeoutCorrection({
        correction: coachTimeoutCorrectionSchema.parse(normalizeCoachTimeoutCorrectionPayload(sanitizeLlmPayload(data))),
        teamId: losingTeam.id,
        triggerRoundNumber: previousReport.roundNumber,
        expiresAfterRoundNumber: input.roundNumber,
        activeAgents
      })
  });

  return {
    teamId: losingTeam.id,
    teamName: losingTeam.displayName,
    triggerRoundId: previousReport.roundId,
    triggerRoundNumber: previousReport.roundNumber,
    correction: response.data,
    ...(response.responseArtifactId ? { responseArtifactId: response.responseArtifactId } : {}),
    timeoutsRemainingBefore: coachState.timeoutsRemaining,
    timeoutsRemainingAfter: Math.max(0, coachState.timeoutsRemaining - 1),
    tokenBankBefore: coachTokenBank,
    tokenBankAfter: Math.max(0, coachTokenBank - cs2EconomyRules.coachTimeoutCost)
  };
}

export async function readApprovedTeamMemoryOverlay(input: {
  repositories: Repositories;
  teamId: string;
}): Promise<Record<string, unknown> | undefined> {
  const summary = await input.repositories.summaries.getLatestByScope("team", input.teamId);
  if (!summary) {
    return undefined;
  }

  const payload = readUnknownRecord(summary.payload);
  if (!payload || payload.kind !== "coach_post_match_review" || payload.status !== "approved") {
    return undefined;
  }

  return readUnknownRecord(payload.review);
}

export async function commitCoachTimeoutUsage(input: {
  context: CoachServiceContext;
  match: Match;
  mapGame: MapGame;
  round: Round;
  coachTimeout: ResolvedCoachTimeout;
  createdAt: string;
}): Promise<{
  timeoutUsedEvent: Event;
  coachTimeoutCorrectionEvent: Event;
}> {
  const timeoutUsedEvent = await input.context.appendEvent({
    id: `evt_${input.round.id}_timeout_used_${safeId(input.coachTimeout.teamId)}`,
    type: "timeout_used",
    category: "runtime_control",
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    roundId: input.round.id,
    scopeType: "round",
    scopeId: input.round.id,
    payload: {
      schemaVersion: 1,
      teamId: input.coachTimeout.teamId,
      teamName: input.coachTimeout.teamName,
      triggerRoundId: input.coachTimeout.triggerRoundId,
      triggerRoundNumber: input.coachTimeout.triggerRoundNumber,
      timeoutsRemainingBefore: input.coachTimeout.timeoutsRemainingBefore,
      timeoutsRemainingAfter: input.coachTimeout.timeoutsRemainingAfter
    },
    createdAt: input.createdAt
  });
  const coachTimeoutCorrectionEvent = await input.context.appendEvent({
    id: `evt_${input.round.id}_coach_timeout_correction_${safeId(input.coachTimeout.teamId)}`,
    type: "coach_timeout_correction_created",
    category: "runtime_control",
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    roundId: input.round.id,
    scopeType: "round",
    scopeId: input.round.id,
    payload: removeUndefined({
      schemaVersion: 1,
      visibility: "public_after_round",
      teamId: input.coachTimeout.teamId,
      teamName: input.coachTimeout.teamName,
      triggerRoundNumber: input.coachTimeout.triggerRoundNumber,
      expiresAfterRoundNumber: input.coachTimeout.correction.expiresAfterRoundNumber,
      correction: input.coachTimeout.correction,
      artifactId: input.coachTimeout.responseArtifactId
    }),
    createdAt: input.createdAt
  });

  await input.context.repositories.teamMapCoachStates.save({
    mapGameId: input.mapGame.id,
    teamId: input.coachTimeout.teamId,
    timeoutsRemaining: input.coachTimeout.timeoutsRemainingAfter,
    tokenBank: input.coachTimeout.tokenBankAfter,
    lastTimeoutRoundNumber: input.coachTimeout.triggerRoundNumber,
    updatedAt: input.createdAt
  });

  return {
    timeoutUsedEvent,
    coachTimeoutCorrectionEvent
  };
}

export async function generateCoachPostMatchReviewsIfNeeded(input: {
  context: CoachServiceContext;
  dependencies: CoachServiceDependencies;
  match: Match;
}): Promise<void> {
  if (!input.context.useLlmCoachPostMatchReviews) {
    return;
  }

  const [teamA, teamB] = (await Promise.all([
    required(input.context.repositories.teams.getById(input.match.teamAId), `Team not found: ${input.match.teamAId}`),
    required(input.context.repositories.teams.getById(input.match.teamBId), `Team not found: ${input.match.teamBId}`)
  ])) as [Team, Team];
  const mapGames = (await input.context.repositories.mapGames.listByMatch(input.match.id)).sort((left, right) => left.order - right.order);
  const mapSummaries = (
    await Promise.all(mapGames.map((mapGame) => (mapGame.summaryId ? input.context.repositories.summaries.getById(mapGame.summaryId) : null)))
  ).filter((summary): summary is Summary => Boolean(summary));
  const matchSummary = await input.context.repositories.summaries.getLatestByScope("match", input.match.id);
  const matchEvents = await input.context.repositories.events.listByMatch(input.match.id);

  for (const team of [teamA, teamB]) {
    const existingSummary = await input.context.repositories.summaries.getLatestByScope("team", team.id);
    const existingPayload = readUnknownRecord(existingSummary?.payload);
    if (existingPayload?.kind === "coach_post_match_review" && existingPayload.matchId === input.match.id) {
      continue;
    }

    const teamAgents = input.dependencies.sortAgentsForRound(await input.context.repositories.agents.listByTeam(team.id));
    const driverModelId = teamAgents[0]?.driverModelId ?? "";
    if (!driverModelId) {
      continue;
    }

    const response = await input.context.stageRunner.runMatchStructuredStage<CoachPostMatchReview>({
      callId: `llm_${safeId(input.match.id)}_team_${safeId(team.id)}_coach_post_match_review`,
      task: "coach_post_match_review",
      schemaName: "CoachPostMatchReview",
      driverModelId,
      requestInput: {
        objective: "生成一份只服务下一场比赛、且需要人工确认后才会采纳的赛后复盘。",
        matchId: input.match.id,
        teamId: team.id,
        teamName: team.displayName,
        coachContext: input.dependencies.readTeamCoachContext(team),
        initialProposal: input.dependencies.readTeamInitialProposal(team),
        teamMemoryOverlay: await input.dependencies.readApprovedTeamMemoryOverlay(team.id),
        matchSummary: matchSummary?.payload,
        mapSummaries: mapSummaries.map((summary) => summary.payload),
        timeoutUsage: summarizeCoachTimeoutUsage(matchEvents, team.id),
        latestMapResults: mapGames.map((mapGame) => ({
          mapGameId: mapGame.id,
          mapName: mapGame.mapName,
          winnerTeamId: mapGame.winnerTeamId,
          score: {
            teamA: mapGame.teamAScore,
            teamB: mapGame.teamBScore
          }
        }))
      },
      responseFormat: "json_object",
      seed: `coach_post_match_review:${input.match.id}:${team.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 2200,
      match: input.match,
    validateResponseData: (data) =>
        validateCoachPostMatchReview({
          review: coachPostMatchReviewSchema.parse(data),
          teamId: team.id,
          matchId: input.match.id
        })
    });

    const createdAt = timestamp();
    const summaryId = `summary_${input.match.id}_${team.id}_coach_post_match_review`;
    const pendingSummary: Summary = {
      id: summaryId,
      summaryType: "team_memory",
      scopeType: "team",
      scopeId: team.id,
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      title: `赛后复盘待采纳：${team.displayName}`,
      content: `${team.displayName} 的教练赛后复盘已生成，等待人工确认后再作为下一场补丁。`,
      payload: {
        kind: "coach_post_match_review",
        status: "pending",
        teamId: team.id,
        matchId: input.match.id,
        review: response.data
      },
      sourceEventIds: [],
      createdAt
    };
    await input.context.repositories.summaries.save(pendingSummary);
    await input.context.appendEvent({
      id: `evt_${input.match.id}_${team.id}_coach_post_match_review_created`,
      type: "coach_post_match_review_created",
      category: "runtime_control",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      scopeType: "match",
      scopeId: input.match.id,
      payload: {
        schemaVersion: 1,
        matchId: input.match.id,
        teamId: team.id,
        teamName: team.displayName,
        summaryId,
        status: "pending",
        responseArtifactId: response.responseArtifactId
      },
      createdAt
    });
  }
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function validateCoachTimeoutCorrection(input: {
  correction: CoachTimeoutCorrection;
  teamId: string;
  triggerRoundNumber: number;
  expiresAfterRoundNumber: number;
  activeAgents: Agent[];
}): CoachTimeoutCorrection {
  const activeAgentIds = new Set(input.activeAgents.map((agent) => agent.id));
  const adjustmentIds = input.correction.playerAdjustments.map(
    (adjustment: CoachTimeoutCorrection["playerAdjustments"][number]) => adjustment.agentId
  );
  const adjustmentIdSet = new Set(adjustmentIds);
  if (adjustmentIdSet.size !== adjustmentIds.length) {
    throw new Error(`Coach timeout correction returned duplicate player adjustments for ${input.teamId}`);
  }
  for (const agentId of adjustmentIds) {
    if (!activeAgentIds.has(agentId)) {
      throw new Error(`Coach timeout correction returned adjustment for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!adjustmentIdSet.has(agentId)) {
      throw new Error(`Coach timeout correction missed adjustment for active agent: ${agentId}`);
    }
  }

  const balancedCorrection = constrainCoachTimeoutCorrection(input.correction);
  return {
    ...balancedCorrection,
    teamId: input.teamId,
    triggerRoundNumber: input.triggerRoundNumber,
    expiresAfterRoundNumber: input.expiresAfterRoundNumber
  };
}

function validateCoachPostMatchReview(input: {
  review: CoachPostMatchReview;
  teamId: string;
  matchId: string;
}): CoachPostMatchReview {
  return {
    ...input.review,
    teamId: input.teamId,
    matchId: input.matchId
  };
}

function constrainCoachTimeoutCorrection(correction: CoachTimeoutCorrection): CoachTimeoutCorrection {
  return {
    ...correction,
    nextRoundObjective: softenCoachOverfocusText(correction.nextRoundObjective),
    ownCoreToHold: softenCoachOverfocusText(correction.ownCoreToHold),
    opponentGapToHit: softenCoachOverfocusText(correction.opponentGapToHit),
    zonePriorityShift: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.zonePriorityShift)),
    teamDirective: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.teamDirective)),
    playerAdjustments: correction.playerAdjustments.map((adjustment) => ({
      ...adjustment,
      adjustment: softenCoachOverfocusText(adjustment.adjustment)
    }))
  };
}

function withCoachBalanceGuardrail(text: string): string {
  return text.includes("平衡约束") ? text : `${text} ${coachTimeoutBalanceGuardrail}`;
}

function softenCoachOverfocusText(text: string): string {
  return text
    .replace(/唯一主攻方向/g, "主要进攻方向")
    .replace(/唯一主证明通道/g, "主要证明通道")
    .replace(/唯一决定性证明通道/g, "主要决定性证明通道")
    .replace(/五名选手全部/g, "多数选手")
    .replace(/全员执行/g, "以三人核心执行")
    .replace(/全员默认/g, "主要资源默认")
    .replace(/全部回到/g, "回到")
    .replace(/不分散资源至/g, "避免过度分散资源，同时保留信息位观察")
    .replace(/不参与([^，。；;]+)任何行动/g, "不主动投入$1主战，但保留异常信息响应")
    .replace(/取消所有([^，。；;]+)call/g, "降低$1call 优先级，同时保留异常信息响应");
}

function normalizeCoachTimeoutCorrectionPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  const normalizedRecord: Record<string, unknown> = { ...record };
  for (const field of [
    "triggerReason",
    "diagnosedFailure",
    "nextRoundObjective",
    "ownCoreToHold",
    "opponentGapToHit",
    "zonePriorityShift",
    "teamDirective"
  ] satisfies Array<keyof CoachTimeoutCorrection>) {
    const normalizedText = normalizeCoachTimeoutText(record[field]);
    if (normalizedText) {
      normalizedRecord[field] = normalizedText;
    }
  }

  const normalizedAdjustments = normalizeCoachTimeoutPlayerAdjustments(record.playerAdjustments ?? record.playerDirectives);
  if (normalizedAdjustments) {
    normalizedRecord.playerAdjustments = normalizedAdjustments;
  }

  return normalizedRecord;
}

function normalizeCoachTimeoutPlayerAdjustments(
  value: unknown
): CoachTimeoutCorrection["playerAdjustments"] | undefined {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: entry
        };
      }

      const record = readUnknownRecord(entry);
      if (!record) {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: normalizeCoachTimeoutText(entry) ?? String(entry)
        };
      }

      return {
        agentId:
          readStringField(record, ["agentId", "playerId", "id", "agent"]) ?? `unknown_agent_${index + 1}`,
        adjustment:
          normalizeCoachTimeoutText(
            record.adjustment ?? record.directive ?? record.text ?? record.summary ?? record.instruction
          ) ?? "保持当前职责但收紧执行。"
      };
    });
  }

  const adjustmentsRecord = readUnknownRecord(value);
  if (!adjustmentsRecord) {
    return undefined;
  }

  return Object.entries(adjustmentsRecord).map(([agentId, adjustmentValue]) => ({
    agentId,
    adjustment: normalizeCoachTimeoutText(adjustmentValue) ?? String(adjustmentValue)
  }));
}

function normalizeCoachTimeoutText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeCoachTimeoutText(item)).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join("；") : undefined;
  }

  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const directText = readStringField(record, ["text", "summary", "directive", "adjustment", "reason", "focus"]);
  if (directText) {
    return directText;
  }

  const entries = Object.entries(record)
    .map(([key, nestedValue]) => {
      const nestedText = normalizeCoachTimeoutText(nestedValue);
      return nestedText ? `${normalizeCoachTimeoutKeyLabel(key)}：${nestedText}` : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries.join("；") : undefined;
}

function normalizeCoachTimeoutKeyLabel(key: string): string {
  switch (key) {
    case "primary":
      return "主优先";
    case "secondary":
      return "次优先";
    case "raise":
    case "increase":
      return "提高";
    case "lower":
    case "decrease":
      return "降低";
    case "deprioritize":
    case "deemphasize":
      return "降权";
    case "focus":
      return "聚焦";
    case "avoid":
      return "避免";
    case "zone":
    case "zoneId":
      return "区域";
    case "summary":
      return "摘要";
    case "text":
      return "说明";
    case "directive":
      return "指令";
    case "adjustment":
      return "调整";
    default:
      return key;
  }
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function detectCoachTimeoutTrigger(input: {
  losingTeam: Team;
  recentRoundReports: RoundReport[];
  scoreBeforeRound: ScorePair;
  teamAId: string;
  teamBId: string;
}): string | undefined {
  const recentReports = [...input.recentRoundReports];
  const lossReports = recentReports.filter((report) => report.winnerTeamId !== input.losingTeam.id);
  const trailingLossReports: RoundReport[] = [];
  for (let index = recentReports.length - 1; index >= 0; index -= 1) {
    const report = recentReports[index];
    if (!report || report.winnerTeamId === input.losingTeam.id) {
      break;
    }
    trailingLossReports.unshift(report);
  }
  if (trailingLossReports.length >= 3 || (trailingLossReports.length >= 2 && trailingLossReports.some((report) => report.judgeResult.margin === "decisive"))) {
    return `${input.losingTeam.displayName} 已连续两局失守，需要用战术暂停统一下一回合修正重点。`;
  }

  const recentThreeLossReports = lossReports.slice(-3);
  const repeatedDiagnostic = mostFrequentWithCount(
    recentThreeLossReports
      .map((report) => report.judgeDiagnostic?.attackedOpportunityGap ?? report.judgeResult.diagnostic?.attackedOpportunityGap)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  );
  if (recentThreeLossReports.length >= 3 && repeatedDiagnostic && repeatedDiagnostic.count >= 2) {
    return `${input.losingTeam.displayName} 在最近三局里反复暴露同类命题缺口：${repeatedDiagnostic.value}。`;
  }

  const teamScore = input.losingTeam.id === input.teamAId ? input.scoreBeforeRound.teamA : input.scoreBeforeRound.teamB;
  const opponentScore = input.losingTeam.id === input.teamAId ? input.scoreBeforeRound.teamB : input.scoreBeforeRound.teamA;
  const previousLoss = recentThreeLossReports.at(-1);
  if (opponentScore >= mr6MapRules.mapWinScore - 1 && previousLoss?.judgeResult.margin === "decisive") {
    return `${input.losingTeam.displayName} 正承受 map point 压力，且上一局为明显失守，需要暂停统一下一局的防守重点。`;
  }
  if (teamScore >= 5 && previousLoss?.judgeResult.margin === "decisive") {
    return `${input.losingTeam.displayName} 已进入关键分区间，上一局明显失守，需要暂停收束下一局执行。`;
  }

  return undefined;
}

function summarizeCoachTimeoutUsage(events: Event[], teamId: string): {
  totalUsed: number;
  rounds: Array<{ roundId?: string; triggerRoundNumber?: number }>;
} {
  const timeoutEvents = events
    .filter((event) => event.type === "timeout_used")
    .map((event) => ({
      roundId: event.roundId,
      payload: readUnknownRecord(event.payload)
    }))
    .filter((entry) => entry.payload?.teamId === teamId);
  return {
    totalUsed: timeoutEvents.length,
    rounds: timeoutEvents.map((entry) => ({
      ...(entry.roundId ? { roundId: entry.roundId } : {}),
      ...(typeof entry.payload?.triggerRoundNumber === "number" ? { triggerRoundNumber: entry.payload.triggerRoundNumber } : {})
    }))
  };
}

function mostFrequentWithCount(values: string[]): { value: string; count: number } | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: { value: string; count: number } | undefined;
  for (const [value, count] of counts.entries()) {
    if (!best || count > best.count) {
      best = { value, count };
    }
  }
  return best;
}

async function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function timestamp(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
