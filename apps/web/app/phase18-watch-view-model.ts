import type {
  EconomyRow,
  LiveAgentOutput,
  LiveReplayAgent,
  LiveReplayData,
  LiveReplayMap,
  LiveReplayRound,
  LiveRoundKillLedgerEntry,
  LiveRoundFrame,
  LiveTeamPlan,
  ScorePair
} from "./live-replay-model";
import type { ReplayGuardState, RunMatchUiState, WebRunLlmCallProgress, WebRunProgress } from "./run-match-controls";

type TeamDirective = LiveTeamPlan["playerDirectives"][number];

export interface BroadcastHudViewModel {
  banner: string;
  teamAName: string;
  teamBName: string;
  bo3Label: string;
  bo3ScoreLabel: string;
  mapLabel: string;
  roundLabel: string;
  runStatusLabel: string;
  runModeLabel: string;
  contextLine: string;
}

export interface OverlayRosterViewModel {
  teamId: string;
  displayName: string;
  shortName: string;
  sideLabel: string;
  score: number;
  timeoutsLabel?: string;
  coachLabel?: string;
  proposalLabel?: string;
  players: OverlayRosterPlayerViewModel[];
  emptyMessage?: string;
}

export interface OverlayRosterPlayerViewModel {
  id: string;
  displayName: string;
  roleLabel: string;
  kdaLabel: string;
  roundKillLabel: string;
  hpLabel: string;
  totalEconomyLabel: string;
  roundSpendLabel: string;
  highlight: "default" | "impact" | "target" | "mvp";
}

export interface BottomTickerViewModel {
  briefLabel: string;
  briefValue: string;
  latestKillLabel: string;
  latestKillValue: string;
  latestHighlightLabel: string;
  latestHighlightValue: string;
  roundOutcome: RoundOutcomeViewModel | null;
}

export type RoundWinMethod =
  | "attack_elimination"
  | "attack_bomb_explosion"
  | "defense_elimination"
  | "defense_defuse"
  | "defense_timeout_no_plant"
  | "unknown";

export type RoundCasualtyDensity = "low" | "medium" | "high" | "extreme";

export interface RoundOutcomeViewModel {
  winMethod: RoundWinMethod;
  winMethodLabel: string;
  winMethodDetail: string;
  casualtyDensity: RoundCasualtyDensity;
  casualtyDensityLabel: string;
  combatShapeLabel: string;
  tradeIntensityLabel: string;
  killCountLabel: string;
  killCount: number;
}

export interface ReplayStageState {
  kind: "replay_ready" | "waiting" | "generating" | "failed" | "replay_hidden";
  badge: string;
  title: string;
  description: string;
}

export interface OpsDockViewModel {
  statusLabel: string;
  helperText: string;
  latestError?: string;
  summaryItems: Array<{ label: string; value: string }>;
  llmCalls: WebRunLlmCallProgress[];
}

export interface RoundEvidenceViewModel {
  roundLabel: string;
  factChainLabel: string;
  roundOutcome: RoundOutcomeViewModel | null;
  coachTimeoutCorrection: CoachTimeoutEvidenceViewModel | null;
  teamPlans: TeamPlanEvidenceViewModel[];
  playerActions: PlayerActionEvidenceViewModel[];
  judge: JudgeEvidenceViewModel | null;
  emptyMessage?: string;
}

export interface CoachTimeoutEvidenceViewModel {
  teamId: string;
  teamName: string;
  triggerReason: string;
  triggerReasonRaw: string;
  diagnosedFailure: string;
  diagnosedFailureRaw: string;
  nextRoundObjective: string;
  nextRoundObjectiveRaw: string;
  ownCoreToHold: string;
  ownCoreToHoldRaw: string;
  opponentGapToHit: string;
  opponentGapToHitRaw: string;
  zonePriorityShift: string;
  zonePriorityShiftRaw: string;
  teamDirective: string;
  teamDirectiveRaw: string;
  confidenceLabel: string;
  expiresAfterRoundLabel: string;
  playerAdjustments: Array<{
    agentId: string;
    displayName: string;
    adjustment: string;
    adjustmentRaw: string;
  }>;
}

export interface TeamPlanEvidenceViewModel {
  teamId: string;
  teamName: string;
  sideLabel: string;
  primaryIntent: string;
  primaryIntentRaw: string;
  zonesLabel: string;
  coordinationSummary: string;
  coordinationSummaryRaw: string;
  winCondition: string;
  winConditionRaw: string;
  risk: string;
  riskRaw: string;
  confidenceLabel: string;
  directives: Array<{ agentId: string; displayName: string; directive: string; directiveRaw: string }>;
}

export interface PlayerActionEvidenceViewModel {
  agentId: string;
  teamId: string;
  teamName: string;
  displayName: string;
  roleLabel: string;
  dutyLabel: string;
  directiveLabel: string;
  directiveLabelRaw: string;
  action: string;
  actionRaw: string;
  confidenceLabel: string;
  fingerprintLabel: string;
}

export interface JudgeEvidenceViewModel {
  winnerLabel: string;
  loserLabel: string;
  marginLabel: string;
  roundWinTypeLabel: string;
  roundWinTypeDetail: string;
  attackWinConditionLabel: string;
  defenseWinConditionLabel: string;
  mvpLabel: string;
  confidenceLabel: string;
  diagnostic: JudgeDiagnosticEvidenceViewModel | null;
  diagnosticMissingLabel?: string;
  reason: string;
  reasonRaw: string;
}

export interface JudgeDiagnosticEvidenceViewModel {
  currentSubTheme: string;
  currentSubThemeRaw: string;
  attackedOpportunityGap: string;
  attackedOpportunityGapRaw: string;
  defendedCoreProposition: string;
  defendedCorePropositionRaw: string;
  mainAttackZoneLabel: string;
  mainAttackZoneId: string;
  mainDefenseZoneLabel: string;
  mainDefenseZoneId: string;
  zoneRelationLabel: string;
  decisiveEvidence: string;
  decisiveEvidenceRaw: string;
}

export type MatchHudViewModel = BroadcastHudViewModel;
export type TeamPanelViewModel = OverlayRosterViewModel;
export type TeamPanelPlayerViewModel = OverlayRosterPlayerViewModel;
export type OpsSidebarViewModel = OpsDockViewModel;

const FALLBACK_TEAMS = {
  teamA: { id: "team-a", displayName: "Falcon-7B", shortName: "F7B" },
  teamB: { id: "team-b", displayName: "VitaLLMty", shortName: "VIT" }
} as const;

const ROLE_LABELS: Record<string, string> = {
  anchor: "Anchor",
  awper: "AWPer",
  closer: "Closer",
  entry: "Entry",
  entry_fragger: "Entry",
  igl: "IGL",
  lurker: "Lurker",
  macro: "Macro",
  pace: "Pace",
  rifler: "Rifler",
  scope: "Scope",
  space: "Space",
  star_rifler: "Star Rifler",
  support: "Support",
  trade: "Trader",
  trader: "Trader"
};

const WIN_METHOD_META: Record<
  RoundWinMethod,
  { label: string; detail: string; combatShapeLabel: string }
> = {
  attack_elimination: {
    label: "攻方全歼胜",
    detail: "攻方通过全歼守方拿下本局，不依赖炸弹爆炸结算。",
    combatShapeLabel: "攻方清场"
  },
  attack_bomb_explosion: {
    label: "攻方下包爆炸胜",
    detail: "攻方完成下包，并守到炸弹爆炸。",
    combatShapeLabel: "下包守爆"
  },
  defense_elimination: {
    label: "守方全歼胜",
    detail: "守方通过全歼攻方守住本局。",
    combatShapeLabel: "守方清场"
  },
  defense_defuse: {
    label: "守方拆包胜",
    detail: "守方在炸弹生效前完成拆包，完成点位回收。",
    combatShapeLabel: "拆包拉扯"
  },
  defense_timeout_no_plant: {
    label: "守方超时未下包胜",
    detail: "守方通过拖时和控图，让攻方没能完成下包。",
    combatShapeLabel: "拖时控图"
  },
  unknown: {
    label: "胜法待定",
    detail: "当前回合暂无法从事实链稳定推导胜法。",
    combatShapeLabel: "待判定"
  }
};

const CASUALTY_DENSITY_META: Record<
  RoundCasualtyDensity,
  { label: string; tradeIntensityLabel: string }
> = {
  low: { label: "低战损", tradeIntensityLabel: "低换血" },
  medium: { label: "中战损", tradeIntensityLabel: "多轮补枪" },
  high: { label: "高战损", tradeIntensityLabel: "强对抗" },
  extreme: { label: "极高战损", tradeIntensityLabel: "极限换血" }
};

export function buildReplayStageState(input: {
  hasReplay: boolean;
  replayGuard: ReplayGuardState;
  runUiState: RunMatchUiState | null;
  selectedMapName?: string | null;
}): ReplayStageState {
  if (input.replayGuard.hidden) {
    return {
      kind: "replay_hidden",
      badge: "回放保护",
      title: "等待新的事实回放",
      description: input.replayGuard.message
    };
  }

  if (input.hasReplay) {
    return {
      kind: "replay_ready",
      badge: "回放就绪",
      title: "已加载真实回放事实链",
      description: input.selectedMapName
        ? `当前查看 ${input.selectedMapName}。主画面只消费已提交的 replay 事实，不重新模拟比赛。`
        : "主画面只消费已提交的 replay 事实，不重新模拟比赛。"
    };
  }

  if (input.runUiState?.state === "running") {
    return {
      kind: "generating",
      badge: "生成中",
      title: "真实 LLM 正在生成新的回放局面",
      description:
        input.runUiState.message ||
        "当前 run 还没有提交新的回放事实，主舞台会在成功写入后自动切回新的 replay。"
    };
  }

  if (input.runUiState?.state === "failed") {
    return {
      kind: "failed",
      badge: "生成失败",
      title: "本次运行没有产出新的回放事实",
      description:
        input.runUiState.progress?.error ||
        input.runUiState.message ||
        "最近一次 run 在写入 fresh replay 之前失败了。"
    };
  }

  return {
    kind: "waiting",
    badge: "待生成",
    title: "先生成一局，再开始看比赛",
    description: "默认验收入口是“生成下一局”。成功后主舞台会自动切到新的事实回放。"
  };
}

export function buildBroadcastHudViewModel(input: {
  replay: LiveReplayData | null;
  selectedMap: LiveReplayMap | null;
  currentRound: LiveReplayRound | null;
  stageState: ReplayStageState;
  runUiState: RunMatchUiState | null;
  bo3Score: ScorePair;
}): BroadcastHudViewModel {
  const teamA = input.replay?.teams.teamA ?? FALLBACK_TEAMS.teamA;
  const teamB = input.replay?.teams.teamB ?? FALLBACK_TEAMS.teamB;

  return {
    banner: "Phase 1.8 / 真实 LLM 导播视角",
    teamAName: teamA.displayName,
    teamBName: teamB.displayName,
    bo3Label: input.replay?.maps.length === 1 ? "DUST2 单图" : "BO3",
    bo3ScoreLabel: `${input.bo3Score.teamA}-${input.bo3Score.teamB}`,
    mapLabel: input.selectedMap ? `M${input.selectedMap.order} / ${input.selectedMap.mapName}` : mapLabelFromProgress(input.runUiState?.progress),
    roundLabel: input.currentRound
      ? `第 ${input.currentRound.roundNumber} 局`
      : roundLabelFromProgress(input.runUiState?.progress, input.stageState.kind === "waiting"),
    runStatusLabel: formatRunStatusLabel(input.stageState.kind, input.runUiState),
    runModeLabel: formatRunModeLabel(input.runUiState?.requestedMode ?? input.runUiState?.progress?.mode ?? null),
    contextLine:
      input.stageState.kind === "replay_ready"
        ? "主画面优先，控制与调试信息收进侧边控制台。"
        : input.stageState.description
  };
}

export function buildOverlayRosterViewModel(input: {
  replay: LiveReplayData | null;
  selectedMap: LiveReplayMap | null;
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
  teamKey: "teamA" | "teamB";
}): OverlayRosterViewModel {
  const team = input.replay?.teams[input.teamKey] ?? FALLBACK_TEAMS[input.teamKey];
  const currentScore = input.frame?.currentScore ?? input.currentRound?.roundReport.scoreBeforeRound ?? { teamA: 0, teamB: 0 };
  const score = input.teamKey === "teamA" ? currentScore.teamA : currentScore.teamB;
  const timeoutsRemaining = input.selectedMap?.timeoutsRemainingByTeam[team.id];
  const coachLabel = buildCoachLabel(team);
  const proposalLabel = buildProposalLabel(team);
  const players = buildOverlayPlayers({
    replay: input.replay,
    selectedMap: input.selectedMap,
    currentRound: input.currentRound,
    frame: input.frame,
    teamId: team.id
  });

  return {
    teamId: team.id,
    displayName: team.displayName,
    shortName: team.shortName,
    sideLabel: readSideLabel(input.currentRound, team.id),
    score,
    ...(typeof timeoutsRemaining === "number" ? { timeoutsLabel: `战术暂停 ${timeoutsRemaining}/2` } : {}),
    ...(coachLabel ? { coachLabel } : {}),
    ...(proposalLabel ? { proposalLabel } : {}),
    players,
    ...(players.length === 0 ? { emptyMessage: "当前还没有已提交的回放局，选手信息会在首局生成后出现。" } : {})
  };
}

export function buildBottomTickerViewModel(input: {
  replay: LiveReplayData | null;
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
  stageState: ReplayStageState;
}): BottomTickerViewModel {
  const latestKill = input.frame?.killLedger.at(-1);
  const supportRate = input.frame?.supportRate;
  const highlightLabel = input.frame?.highlightTags.length
    ? `${input.frame.highlightTags.join(" / ")}${input.frame.highlightMvpName ? ` / MVP ${input.frame.highlightMvpName}` : ""}`
    : supportRate
      ? `${input.replay?.teams.teamA.shortName ?? "F7B"} ${supportRate.teamA}% / ${input.replay?.teams.teamB.shortName ?? "VIT"} ${supportRate.teamB}%`
      : "等待高光与支持率";
  const roundOutcome = buildRoundOutcomeViewModel({
    currentRound: input.currentRound,
    frame: input.frame
  });

  return {
    briefLabel: "局势摘要",
    briefValue: input.frame?.roundSummary ?? input.frame?.casterLine ?? input.stageState.description,
    latestKillLabel: "最新击杀",
    latestKillValue: latestKill
      ? latestKill.actorName && latestKill.targetName
        ? `${latestKill.actorName} -> ${latestKill.targetName}`
        : "击杀数据缺失"
      : "当前切片还没有击杀事件",
    latestHighlightLabel: "高光焦点",
    latestHighlightValue: highlightLabel,
    roundOutcome
  };
}

export function buildRoundOutcomeViewModel(input: {
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
}): RoundOutcomeViewModel | null {
  if (!input.currentRound) {
    return null;
  }

  const roundReport = input.currentRound.roundReport;
  const killCount = input.frame?.killLedger.length ?? roundReport.killLedger?.length ?? 0;
  const casualtyDensity = deriveCasualtyDensity(killCount);
  const attackTeamId = input.currentRound.tacticalRound?.sideAssignment.attackingTeamId ?? null;
  const isAttackWin = attackTeamId ? roundReport.winnerTeamId === attackTeamId : null;
  const tacticalResult = input.currentRound.tacticalRound?.collision.result ?? null;
  const winMethod = roundReport.judgeResult.roundWinType
    ? toRoundWinMethod(roundReport.judgeResult.roundWinType)
    : deriveWinMethod({
        isAttackWin,
        killCount,
        tacticalResult
      });
  const winMethodMeta = WIN_METHOD_META[winMethod];
  const casualtyMeta = CASUALTY_DENSITY_META[casualtyDensity];

  return {
    winMethod,
    winMethodLabel: winMethodMeta.label,
    winMethodDetail: winMethodMeta.detail,
    casualtyDensity,
    casualtyDensityLabel: casualtyMeta.label,
    combatShapeLabel: winMethodMeta.combatShapeLabel,
    tradeIntensityLabel: casualtyMeta.tradeIntensityLabel,
    killCountLabel: `${killCount} 次击杀`,
    killCount
  };
}

export function buildOpsDockViewModel(runUiState: RunMatchUiState | null): OpsDockViewModel {
  const progress = runUiState?.progress ?? null;
  const summaryItems = [
    { label: "运行状态", value: formatRunStatusLabelFromUi(runUiState) },
    { label: "运行模式", value: formatRunModeLabel(runUiState?.requestedMode ?? progress?.mode ?? null) },
    { label: "已提交局数", value: progress ? String(progress.completedRounds) : "0" },
    { label: "当前地图", value: progress?.currentMapOrder ? `M${progress.currentMapOrder}` : "--" },
    { label: "当前回合", value: progress?.currentRoundNumber ? `R${progress.currentRoundNumber}` : "--" },
    { label: "LLM 调用", value: progress ? `${progress.llmSummary.completedCalls}/${progress.llmSummary.expectedTotalCalls}` : "0/0" }
  ];

  return {
    statusLabel: formatRunStatusLabelFromUi(runUiState),
    helperText:
      runUiState?.message ||
      "默认从“生成下一局”开始验收。确认单局路径可信以后，再扩大到整张图和整场 BO3。",
    ...(progress?.error ? { latestError: progress.error } : {}),
    summaryItems,
    llmCalls: progress?.llmCalls ?? []
  };
}

export function buildRoundEvidenceViewModel(input: {
  replay: LiveReplayData | null;
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
}): RoundEvidenceViewModel {
  if (!input.replay || !input.currentRound) {
    return {
      roundLabel: "回合待生成",
      factChainLabel: "暂无已提交事实",
      roundOutcome: null,
      coachTimeoutCorrection: null,
      teamPlans: [],
      playerActions: [],
      judge: null,
      emptyMessage: "当前还没有可审计的已提交回合。"
    };
  }

  const roundReport = input.currentRound.roundReport;
  const roundOutcome = buildRoundOutcomeViewModel({
    currentRound: input.currentRound,
    frame: input.frame
  });
  const coachTimeoutCorrection = buildCoachTimeoutEvidence(input.replay, roundReport.appliedCoachTimeoutCorrection);
  const teamPlans = buildTeamPlanEvidence(input.replay, roundReport.llmTeamPlans);
  const playerActions = buildPlayerActionEvidence(input.replay, roundReport.agentOutputs, roundReport.llmTeamPlans);
  const judge = buildJudgeEvidence(input.replay, roundReport);

  return {
    roundLabel: `R${input.currentRound.roundNumber}`,
    factChainLabel: `战术暂停 ${coachTimeoutCorrection ? "1/1" : "0/0"} · 队伍计划 ${teamPlans.length}/2 · 选手行动 ${playerActions.length}/10 · 裁判 ${judge ? "1/1" : "0/1"}`,
    roundOutcome,
    coachTimeoutCorrection,
    teamPlans,
    playerActions,
    judge,
    ...(teamPlans.length === 0 && playerActions.length === 0 && !judge && !coachTimeoutCorrection
      ? { emptyMessage: "当前回合还没有可审计的 LLM 事实链。" }
      : {})
  };
}

export function buildMatchHudViewModel(input: Parameters<typeof buildBroadcastHudViewModel>[0]): MatchHudViewModel {
  return buildBroadcastHudViewModel(input);
}

export function buildTeamPanelViewModel(input: Parameters<typeof buildOverlayRosterViewModel>[0]): TeamPanelViewModel {
  return buildOverlayRosterViewModel(input);
}

export function buildOpsSidebarViewModel(runUiState: RunMatchUiState | null): OpsSidebarViewModel {
  return buildOpsDockViewModel(runUiState);
}

function buildOverlayPlayers(input: {
  replay: LiveReplayData | null;
  selectedMap: LiveReplayMap | null;
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
  teamId: string;
}): OverlayRosterPlayerViewModel[] {
  if (!input.replay || !input.currentRound) {
    return [];
  }

  const cumulativeCombatStatsByAgentId = buildCumulativeCombatStatsByAgentId(input.selectedMap, input.currentRound);
  const roundKillCountsByAgentId = buildRoundKillCountsByAgentId(input.frame?.killLedger ?? input.currentRound.roundReport.killLedger ?? []);
  const economyPlayers = input.currentRound.roundReport.economyDelta.agents
    .filter((row) => row.teamId === input.teamId)
    .map((row) =>
      toOverlayPlayer(
        row,
        input.replay?.agentsById[row.agentId],
        input.frame,
        cumulativeCombatStatsByAgentId.get(row.agentId),
        roundKillCountsByAgentId.get(row.agentId) ?? 0
      )
    );

  if (economyPlayers.length > 0) {
    return economyPlayers.slice(0, 5);
  }

  return Object.values(input.replay.agentsById)
    .filter((agent) => agent.teamId === input.teamId)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .slice(0, 5)
    .map((agent) => toFallbackPlayer(agent, cumulativeCombatStatsByAgentId.get(agent.id), roundKillCountsByAgentId.get(agent.id) ?? 0));
}

function buildTeamPlanEvidence(
  replay: LiveReplayData,
  teamPlans: Record<string, LiveTeamPlan> | undefined
): TeamPlanEvidenceViewModel[] {
  if (!teamPlans) {
    return [];
  }

  const teamOrder = [replay.teams.teamA.id, replay.teams.teamB.id];
  return Object.values(teamPlans)
    .sort((left, right) => teamOrder.indexOf(left.teamId) - teamOrder.indexOf(right.teamId))
    .map((plan) => ({
      teamId: plan.teamId,
      teamName: teamNameById(replay, plan.teamId),
      sideLabel: plan.side === "attack" ? "进攻方" : "防守方",
      primaryIntent: translateEvidenceText(plan.primaryIntent),
      primaryIntentRaw: plan.primaryIntent,
      zonesLabel: [plan.primaryZoneId, plan.secondaryZoneId]
        .filter((value): value is string => Boolean(value))
        .map(translateZoneId)
        .join(" / "),
      coordinationSummary: translateEvidenceText(plan.coordinationSummary),
      coordinationSummaryRaw: plan.coordinationSummary,
      winCondition: translateEvidenceText(plan.winCondition),
      winConditionRaw: plan.winCondition,
      risk: translateEvidenceText(plan.risk),
      riskRaw: plan.risk,
      confidenceLabel: formatConfidence(plan.confidence),
      directives: plan.playerDirectives.map((directive: TeamDirective) => ({
        agentId: directive.agentId,
        displayName: replay.agentsById[directive.agentId]?.displayName ?? directive.agentId,
        directive: translateEvidenceText(directive.directive),
        directiveRaw: directive.directive
      }))
    }));
}

function buildCoachTimeoutEvidence(
  replay: LiveReplayData,
  correction: LiveReplayRound["roundReport"]["appliedCoachTimeoutCorrection"] | undefined
): CoachTimeoutEvidenceViewModel | null {
  if (!correction) {
    return null;
  }

  return {
    teamId: correction.teamId,
    teamName: teamNameById(replay, correction.teamId),
    triggerReason: translateEvidenceText(correction.triggerReason),
    triggerReasonRaw: correction.triggerReason,
    diagnosedFailure: translateEvidenceText(correction.diagnosedFailure),
    diagnosedFailureRaw: correction.diagnosedFailure,
    nextRoundObjective: translateEvidenceText(correction.nextRoundObjective),
    nextRoundObjectiveRaw: correction.nextRoundObjective,
    ownCoreToHold: translateEvidenceText(correction.ownCoreToHold),
    ownCoreToHoldRaw: correction.ownCoreToHold,
    opponentGapToHit: translateEvidenceText(correction.opponentGapToHit),
    opponentGapToHitRaw: correction.opponentGapToHit,
    zonePriorityShift: translateEvidenceText(correction.zonePriorityShift),
    zonePriorityShiftRaw: correction.zonePriorityShift,
    teamDirective: translateEvidenceText(correction.teamDirective),
    teamDirectiveRaw: correction.teamDirective,
    confidenceLabel: formatConfidence(correction.confidence),
    expiresAfterRoundLabel: `仅对 R${correction.expiresAfterRoundNumber} 生效`,
    playerAdjustments: correction.playerAdjustments.map((adjustment) => ({
      agentId: adjustment.agentId,
      displayName: replay.agentsById[adjustment.agentId]?.displayName ?? adjustment.agentId,
      adjustment: translateEvidenceText(adjustment.adjustment),
      adjustmentRaw: adjustment.adjustment
    }))
  };
}

function buildPlayerActionEvidence(
  replay: LiveReplayData,
  agentOutputs: LiveAgentOutput[],
  teamPlans: Record<string, LiveTeamPlan> | undefined
): PlayerActionEvidenceViewModel[] {
  const planByTeamId = teamPlans ?? {};
  const teamOrder = new Map([
    [replay.teams.teamA.id, 0],
    [replay.teams.teamB.id, 1]
  ]);

  return [...agentOutputs]
    .sort((left, right) => (teamOrder.get(left.teamId) ?? 99) - (teamOrder.get(right.teamId) ?? 99) || left.agentId.localeCompare(right.agentId))
    .map((output) => {
      const agent = replay.agentsById[output.agentId];
      const directive = planByTeamId[output.teamId]?.playerDirectives.find((item: TeamDirective) => item.agentId === output.agentId)?.directive;
      return {
        agentId: output.agentId,
        teamId: output.teamId,
        teamName: teamNameById(replay, output.teamId),
        displayName: agent?.displayName ?? output.agentId,
        roleLabel: translateToken(agent?.role ?? output.role),
        dutyLabel: buildDutyLabel(agent),
        directiveLabel: translateEvidenceText(directive ?? "这个已提交回合没有写入队伍计划事实；旧回合不会伪回填。"),
        directiveLabelRaw: directive ?? "",
        action: translateEvidenceText(output.action),
        actionRaw: output.action,
        confidenceLabel: formatConfidence(output.confidence),
        fingerprintLabel: output.rawFingerprint
      };
    });
}

function buildJudgeEvidence(
  replay: LiveReplayData,
  roundReport: LiveReplayRound["roundReport"]
): JudgeEvidenceViewModel {
  const judge = roundReport.judgeResult;
  const mvpAgent = replay.agentsById[judge.mvpAgentId];
  const diagnostic = buildJudgeDiagnosticEvidence(roundReport);
  const winMethod = toRoundWinMethod(judge.roundWinType);
  const winMethodMeta = WIN_METHOD_META[winMethod];
  return {
    winnerLabel: teamNameById(replay, judge.winnerTeamId),
    loserLabel: teamNameById(replay, judge.loserTeamId),
    marginLabel: translateMargin(judge.margin),
    roundWinTypeLabel: winMethodMeta.label,
    roundWinTypeDetail: winMethodMeta.detail,
    attackWinConditionLabel:
      typeof judge.attackWinConditionMet === "boolean" ? (judge.attackWinConditionMet ? "已成立" : "未成立") : "旧回合未归档",
    defenseWinConditionLabel:
      typeof judge.defenseWinConditionMet === "boolean"
        ? (judge.defenseWinConditionMet ? "已成立" : "未成立")
        : "旧回合未归档",
    mvpLabel: mvpAgent?.displayName ?? judge.mvpAgentId,
    confidenceLabel: formatConfidence(judge.confidence),
    diagnostic,
    ...(diagnostic ? {} : { diagnosticMissingLabel: "旧回合未归档裁判诊断；不会根据判词伪造补齐。" }),
    reason: translateEvidenceText(judge.reason),
    reasonRaw: judge.reason
  };
}

function buildJudgeDiagnosticEvidence(roundReport: LiveReplayRound["roundReport"]): JudgeDiagnosticEvidenceViewModel | null {
  const diagnostic = roundReport.judgeDiagnostic ?? roundReport.judgeResult.diagnostic;
  if (!diagnostic) {
    return null;
  }

  return {
    currentSubTheme: translateEvidenceText(diagnostic.currentSubTheme),
    currentSubThemeRaw: diagnostic.currentSubTheme,
    attackedOpportunityGap: translateEvidenceText(diagnostic.attackedOpportunityGap),
    attackedOpportunityGapRaw: diagnostic.attackedOpportunityGap,
    defendedCoreProposition: translateEvidenceText(diagnostic.defendedCoreProposition),
    defendedCorePropositionRaw: diagnostic.defendedCoreProposition,
    mainAttackZoneLabel: formatZoneName(diagnostic.mainAttackZoneId),
    mainAttackZoneId: diagnostic.mainAttackZoneId,
    mainDefenseZoneLabel: formatZoneName(diagnostic.mainDefenseZoneId),
    mainDefenseZoneId: diagnostic.mainDefenseZoneId,
    zoneRelationLabel:
      diagnostic.mainAttackZoneId === diagnostic.mainDefenseZoneId
        ? "主攻落点与守方命题焦点一致"
        : "主攻落点与守方命题焦点不同，表示攻守双方围绕不同关键区交锋",
    decisiveEvidence: translateEvidenceText(diagnostic.decisiveEvidence),
    decisiveEvidenceRaw: diagnostic.decisiveEvidence
  };
}

function formatZoneName(zoneId: string): string {
  const labels: Record<string, string> = {
    buyer_mid: "中路",
    conversion_site_a: "A 点",
    conversion_site_b: "B 点",
    pricing_ramp: "A 大",
    retention_connector: "A 小",
    token_economy: "B 洞",
    spawn_a: "T 出生点",
    spawn_b: "CT 出生点"
  };
  return labels[zoneId] ?? zoneId.replaceAll("_", " ");
}

function teamNameById(replay: LiveReplayData, teamId: string): string {
  if (replay.teams.teamA.id === teamId) {
    return replay.teams.teamA.displayName;
  }
  if (replay.teams.teamB.id === teamId) {
    return replay.teams.teamB.displayName;
  }
  return teamId;
}

function toOverlayPlayer(
  row: EconomyRow,
  _agent: LiveReplayAgent | undefined,
  frame: LiveRoundFrame | null,
  combatStats: { kills: number; deaths: number; kdaLabel: string } | undefined,
  roundKills: number
): OverlayRosterPlayerViewModel {
  const highlight = resolvePlayerHighlight(row.agentId, frame);
  return {
    id: row.agentId,
    displayName: row.displayName,
    roleLabel: translateToken(row.role),
    kdaLabel: combatStats?.kdaLabel ?? "0 / 0 / --",
    roundKillLabel: `${roundKills}`,
    hpLabel: "--",
    totalEconomyLabel: `$${row.afterTokenBank}`,
    roundSpendLabel: `$${row.spent}`,
    highlight
  };
}

function toFallbackPlayer(
  agent: LiveReplayAgent,
  combatStats: { kills: number; deaths: number; kdaLabel: string } | undefined,
  roundKills: number
): OverlayRosterPlayerViewModel {
  return {
    id: agent.id,
    displayName: agent.displayName,
    roleLabel: translateToken(agent.role),
    kdaLabel: combatStats?.kdaLabel ?? "0 / 0 / --",
    roundKillLabel: `${roundKills}`,
    hpLabel: "--",
    totalEconomyLabel: "--",
    roundSpendLabel: "--",
    highlight: "default"
  };
}

function buildCombatStatsByAgentId(ledger: LiveRoundKillLedgerEntry[]): Map<string, { kills: number; deaths: number; kdaLabel: string }> {
  const stats = new Map<string, { kills: number; deaths: number }>();
  for (const entry of ledger) {
    const actorStats = stats.get(entry.actorAgentId) ?? { kills: 0, deaths: 0 };
    actorStats.kills += 1;
    stats.set(entry.actorAgentId, actorStats);

    const targetStats = stats.get(entry.targetAgentId) ?? { kills: 0, deaths: 0 };
    targetStats.deaths += 1;
    stats.set(entry.targetAgentId, targetStats);
  }

  return new Map(
    [...stats.entries()].map(([agentId, value]) => [
      agentId,
      {
        ...value,
        kdaLabel: `${value.kills} / ${value.deaths} / --`
      }
    ])
  );
}

function buildRoundKillCountsByAgentId(ledger: LiveRoundKillLedgerEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of ledger) {
    counts.set(entry.actorAgentId, (counts.get(entry.actorAgentId) ?? 0) + 1);
  }
  return counts;
}

function buildCumulativeCombatStatsByAgentId(
  selectedMap: LiveReplayMap | null,
  currentRound: LiveReplayRound
): Map<string, { kills: number; deaths: number; kdaLabel: string }> {
  if (!selectedMap) {
    return buildCombatStatsByAgentId(currentRound.roundReport.killLedger ?? []);
  }

  const currentRoundIndex = selectedMap.rounds.findIndex((round) => round.id === currentRound.id);
  const roundsInScope =
    currentRoundIndex >= 0
      ? selectedMap.rounds.slice(0, currentRoundIndex + 1)
      : selectedMap.rounds.filter((round) => round.roundNumber <= currentRound.roundNumber);

  const mergedLedger = roundsInScope.flatMap((round) => round.roundReport.killLedger ?? []);
  return buildCombatStatsByAgentId(mergedLedger);
}

function buildDutyLabel(agent: LiveReplayAgent | undefined): string {
  if (!agent) {
    return "职责待同步";
  }

  return translateEvidenceText(agent.roleResponsibilities[0] ?? "执行稳定职责");
}

function buildCoachLabel(team: LiveReplayData["teams"]["teamA"] | LiveReplayData["teams"]["teamB"]): string | undefined {
  if (!team.coachDisplayName && !team.coachDutySummary) {
    return undefined;
  }

  if (team.coachDisplayName && team.coachDutySummary) {
    return `Coach ${team.coachDisplayName} | ${translateEvidenceText(team.coachDutySummary)}`;
  }
  return team.coachDisplayName ? `Coach ${team.coachDisplayName}` : translateEvidenceText(team.coachDutySummary ?? "");
}

function buildProposalLabel(team: LiveReplayData["teams"]["teamA"] | LiveReplayData["teams"]["teamB"]): string | undefined {
  if (team.proposalSummary) {
    return translateEvidenceText(team.proposalSummary);
  }
  if (team.proposalThesis) {
    return translateEvidenceText(team.proposalThesis);
  }
  return undefined;
}

function deriveWinMethod(input: {
  isAttackWin: boolean | null;
  killCount: number;
  tacticalResult: string | null;
}): RoundWinMethod {
  if (input.isAttackWin === null) {
    return "unknown";
  }

  if (input.isAttackWin) {
    if (input.killCount <= 2) {
      return "attack_bomb_explosion";
    }
    return "attack_elimination";
  }

  if (input.killCount <= 2) {
    return "defense_timeout_no_plant";
  }
  if (input.tacticalResult === "rotate_success" || input.tacticalResult === "trade_even") {
    return "defense_defuse";
  }
  return "defense_elimination";
}

function toRoundWinMethod(roundWinType: string | undefined): RoundWinMethod {
  switch (roundWinType) {
    case "attack_elimination":
    case "attack_bomb_explosion":
    case "defense_elimination":
    case "defense_defuse":
    case "defense_timeout_no_plant":
      return roundWinType;
    default:
      return "unknown";
  }
}

function deriveCasualtyDensity(killCount: number): RoundCasualtyDensity {
  if (killCount <= 2) {
    return "low";
  }
  if (killCount <= 4) {
    return "medium";
  }
  if (killCount <= 7) {
    return "high";
  }
  return "extreme";
}

function resolvePlayerHighlight(agentId: string, frame: LiveRoundFrame | null): OverlayRosterPlayerViewModel["highlight"] {
  if (!frame) {
    return "default";
  }
  if (frame.highlightMvpAgentId === agentId) {
    return "mvp";
  }
  if (frame.killLedger.some((entry) => entry.actorAgentId === agentId)) {
    return "impact";
  }
  if (frame.killLedger.some((entry) => entry.targetAgentId === agentId)) {
    return "target";
  }
  return "default";
}

function readSideLabel(currentRound: LiveReplayRound | null, teamId: string): string {
  const sideAssignment = currentRound?.tacticalRound?.sideAssignment;
  if (!sideAssignment) {
    return "边别待定";
  }
  if (sideAssignment.attackingTeamId === teamId) {
    return "进攻方";
  }
  if (sideAssignment.defendingTeamId === teamId) {
    return "防守方";
  }
  return "边别待定";
}

function mapLabelFromProgress(progress: WebRunProgress | null | undefined): string {
  if (progress?.currentMapOrder && progress.mapName) {
    const mapNames = progress.mapName.split(" / ");
    const currentMapName = mapNames[Math.max(0, progress.currentMapOrder - 1)] ?? progress.mapName;
    return `M${progress.currentMapOrder} / ${currentMapName}`;
  }

  return "M1 / DUST2";
}

function roundLabelFromProgress(progress: WebRunProgress | null | undefined, waiting: boolean): string {
  if (progress?.currentRoundNumber) {
    return `第 ${progress.currentRoundNumber} 局`;
  }
  return waiting ? "回合待生成" : "回合即将开始";
}

function formatRunStatusLabel(stageKind: ReplayStageState["kind"], runUiState: RunMatchUiState | null): string {
  if (stageKind === "replay_ready") {
    return runUiState?.progress?.status === "completed" ? "回放就绪" : formatRunStatusLabelFromUi(runUiState);
  }
  return formatRunStatusLabelFromUi(runUiState, stageKind);
}

function formatRunStatusLabelFromUi(runUiState: RunMatchUiState | null, fallbackKind?: ReplayStageState["kind"]): string {
  if (runUiState?.state === "running") {
    return "生成中";
  }
  if (runUiState?.state === "paused") {
    return "已暂停";
  }
  if (runUiState?.state === "stopped") {
    return "已停止跟踪";
  }
  if (runUiState?.state === "failed") {
    return "失败";
  }
  if (runUiState?.state === "success") {
    return "回放就绪";
  }
  if (fallbackKind === "replay_hidden") {
    return "回放保护";
  }
  if (fallbackKind === "waiting") {
    return "待生成";
  }
  return "空闲";
}

function formatRunModeLabel(mode: WebRunProgress["mode"] | null | undefined): string {
  switch (mode) {
    case "phase18_next_round":
      return "下一局";
    case "phase18_current_map":
      return "当前地图";
    case "phase18_full_bo3":
      return "整场 BO3";
    case "phase17_showcase_match":
      return "旧基线";
    default:
      return "Phase 1.8 就绪";
  }
}

function translateToken(value: string): string {
  return ROLE_LABELS[value] ?? normalizeLabel(value);
}

function translateMargin(value: string): string {
  switch (value) {
    case "narrow":
      return "小胜";
    case "standard":
      return "标准胜";
    case "decisive":
      return "决定性胜利";
    default:
      return normalizeLabel(value);
  }
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function translateEvidenceText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const replacements: Array<[RegExp, string]> = [
    [/\bopens space\b/gi, "打开空间"],
    [/\bopen space\b/gi, "打开空间"],
    [/\bthe first[- ]user claim\b/gi, "首位用户主张"],
    [/\bfirst[- ]user claim\b/gi, "首位用户主张"],
    [/\bfirst[- ]user\b/gi, "首位用户"],
    [/\bprove\b/gi, "验证"],
    [/\bsharper\b/gi, "更优"],
    [/\bclaim\b/gi, "主张"],
    [/\bfrom\b/gi, "从"],
    [/\band\b/gi, "并且"],
    [/\bif\b/gi, "如果"],
    [/\bwhen\b/gi, "当"],
    [/\bthen\b/gi, "然后"],
    [/\bopens\b/gi, "打开"],
    [/\bopen\b/gi, "打开"],
    [/\bcloses\b/gi, "收束"],
    [/\bclose\b/gi, "收束"],
    [/\btests\b/gi, "试探"],
    [/\btest\b/gi, "试探"],
    [/\bholds\b/gi, "坚守"],
    [/\bhold\b/gi, "坚守"],
    [/\bpushes\b/gi, "推进"],
    [/\bpush\b/gi, "推进"],
    [/\brotates\b/gi, "转点"],
    [/\brotate\b/gi, "转点"],
    [/\bexecutes\b/gi, "执行"],
    [/\bexecute\b/gi, "执行"],
    [/\bcalls\b/gi, "呼叫"],
    [/\bcall\b/gi, "呼叫"],
    [/\bwaits\b/gi, "等待"],
    [/\bwait\b/gi, "等待"],
    [/\bforces\b/gi, "逼迫"],
    [/\bforce\b/gi, "逼迫"],
    [/\bspots\b/gi, "点位"],
    [/\bangles\b/gi, "枪线"],
    [/\bangle\b/gi, "枪线"],
    [/\battack side\b/gi, "进攻方"],
    [/\bdefense side\b/gi, "防守方"],
    [/\battacking team\b/gi, "进攻方"],
    [/\bdefending team\b/gi, "防守方"],
    [/\battack\b/gi, "进攻"],
    [/\bdefense\b/gi, "防守"],
    [/\bsite a\b/gi, "A点"],
    [/\ba site\b/gi, "A点"],
    [/\bsite b\b/gi, "B点"],
    [/\bb site\b/gi, "B点"],
    [/\bbomb\b/gi, "炸弹"],
    [/\bplant\b/gi, "安放"],
    [/\bdefuse\b/gi, "拆弹"],
    [/\bdetonate\b/gi, "爆炸"],
    [/\beliminate\b/gi, "全歼"],
    [/\bwipe\b/gi, "全歼"],
    [/\bkills?\b/gi, "击杀"],
    [/\brotate\b/gi, "转点"],
    [/\bhold\b/gi, "守住"],
    [/\bpeek\b/gi, "探头"],
    [/\bpush\b/gi, "强推"],
    [/\bhit\b/gi, "进攻"],
    [/\btrade\b/gi, "补枪"],
    [/\bflash\b/gi, "闪光"],
    [/\bsmoke\b/gi, "烟雾"],
    [/\bmolotov\b/gi, "燃烧弹"],
    [/\butility\b/gi, "道具"],
    [/\bentry\b/gi, "破点"],
    [/\bawper\b/gi, "狙击手"],
    [/\bawp\b/gi, "狙击"],
    [/\brifler\b/gi, "步枪手"],
    [/\bsupport\b/gi, "辅助"],
    [/\banchor\b/gi, "据点手"],
    [/\blurker\b/gi, "游走手"],
    [/\bigl\b/gi, "指挥"],
    [/\bconnector\b/gi, "连接区"],
    [/\bmid\b/gi, "中路"],
    [/\blong\b/gi, "长道"],
    [/\bshort\b/gi, "短道"],
    [/\bdefault\b/gi, "默认位"],
    [/\bpressure\b/gi, "压制"],
    [/\bwin condition\b/gi, "胜利条件"],
    [/\bsucceeded\b/gi, "成功"],
    [/\bfailed\b/gi, "失败"],
    [/\bconfidence\b/gi, "置信度"],
    [/\breason\b/gi, "判词"],
    [/\bleverage\b/gi, "高价值"],
    [/\bspace\b/gi, "空间"],
    [/\bcontrol\b/gi, "控制"],
    [/\bexecute\b/gi, "执行"],
    [/\bslow\b/gi, "慢速"],
    [/\bfast\b/gi, "快速"]
  ];

  let output = trimmed;
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

function translateZoneId(value: string): string {
  switch (value.toLowerCase()) {
    case "site_a":
    case "a_site":
    case "a":
      return "A点";
    case "site_b":
    case "b_site":
    case "b":
      return "B点";
    case "mid":
    case "middle":
      return "中路";
    case "connector":
      return "连接区";
    case "long":
      return "长道";
    case "short":
      return "短道";
    case "ramp":
      return "斜坡";
    case "spawn":
      return "出生点";
    default:
      return translateEvidenceText(normalizeLabel(value));
  }
}

function normalizeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : part))
    .join(" ");
}
