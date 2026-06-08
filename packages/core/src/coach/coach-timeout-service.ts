import type { Agent, CoachTimeoutCorrection, Event, MapGame, Match, Round, RoundReport, ScorePair, Team } from "@agent-major/shared";
import { coachTimeoutCorrectionSchema } from "@agent-major/shared";

import type { Repositories } from "@agent-major/db";

import { cs2EconomyRules } from "../economy/economy-output-service.js";
import { sanitizeLlmPayload } from "../llm/llm-output-normalizer.js";
import type { LlmStageRunner } from "../llm/llm-stage-runner.js";
import { mr6MapRules } from "../match/map-rules.js";
import { normalizeCoachTimeoutCorrectionPayload, removeUndefined, validateCoachTimeoutCorrection } from "./coach-validation.js";

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

  return { timeoutUsedEvent, coachTimeoutCorrectionEvent };
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

function timestamp(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
