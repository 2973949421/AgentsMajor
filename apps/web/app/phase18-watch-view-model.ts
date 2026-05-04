import type { EconomyRow, LiveReplayAgent, LiveReplayData, LiveReplayMap, LiveReplayRound, LiveRoundFrame, ScorePair } from "./live-replay-model";
import type { ReplayGuardState, RunMatchUiState, WebRunLlmCallProgress, WebRunProgress } from "./run-match-controls";

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
  players: OverlayRosterPlayerViewModel[];
  emptyMessage?: string;
}

export interface OverlayRosterPlayerViewModel {
  id: string;
  displayName: string;
  roleLabel: string;
  metaLabel: string;
  tokenBankLabel: string;
  buyLabel: string;
  statusLabel: string;
  highlight: "default" | "impact" | "target" | "mvp";
}

export interface BottomTickerViewModel {
  briefLabel: string;
  briefValue: string;
  latestKillLabel: string;
  latestKillValue: string;
  latestHighlightLabel: string;
  latestHighlightValue: string;
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

const BUY_LABELS: Record<string, string> = {
  awp_glass: "大狙轻甲",
  force_call: "强起",
  rifle_full: "长枪满配",
  rifle_half: "半甲长枪",
  support_half: "半甲辅助",
  support_kit: "辅助套装"
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
    bo3Label: "BO3",
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
  const players = buildOverlayPlayers({
    replay: input.replay,
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
    players,
    ...(players.length === 0 ? { emptyMessage: "当前还没有已提交的回放局，选手信息会在首局生成后出现。" } : {})
  };
}

export function buildBottomTickerViewModel(input: {
  replay: LiveReplayData | null;
  frame: LiveRoundFrame | null;
  stageState: ReplayStageState;
}): BottomTickerViewModel {
  const latestKill = input.frame?.killFeed.at(-1);
  const supportRate = input.frame?.supportRate;
  const highlightLabel = input.frame?.highlightTags.length
    ? `${input.frame.highlightTags.join(" / ")}${input.frame.highlightMvpName ? ` / MVP ${input.frame.highlightMvpName}` : ""}`
    : supportRate
      ? `${input.replay?.teams.teamA.shortName ?? "F7B"} ${supportRate.teamA}% / ${input.replay?.teams.teamB.shortName ?? "VIT"} ${supportRate.teamB}%`
      : "等待高光与支持率";

  return {
    briefLabel: "局势摘要",
    briefValue: input.frame?.roundSummary ?? input.frame?.casterLine ?? input.stageState.description,
    latestKillLabel: "最新击杀",
    latestKillValue: latestKill
      ? `${latestKill.actorName ?? latestKill.actorAgentId ?? "未知"} -> ${latestKill.targetName ?? latestKill.targetAgentId ?? "未知"}`
      : "当前切片还没有击杀事件",
    latestHighlightLabel: "高光焦点",
    latestHighlightValue: highlightLabel
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
  currentRound: LiveReplayRound | null;
  frame: LiveRoundFrame | null;
  teamId: string;
}): OverlayRosterPlayerViewModel[] {
  if (!input.replay || !input.currentRound) {
    return [];
  }

  const economyPlayers = input.currentRound.roundReport.economyDelta.agents
    .filter((row) => row.teamId === input.teamId)
    .map((row) => toOverlayPlayer(row, input.replay?.agentsById[row.agentId], input.frame));

  if (economyPlayers.length > 0) {
    return economyPlayers.slice(0, 5);
  }

  return Object.values(input.replay.agentsById)
    .filter((agent) => agent.teamId === input.teamId)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .slice(0, 5)
    .map((agent) => toFallbackPlayer(agent));
}

function toOverlayPlayer(row: EconomyRow, agent: LiveReplayAgent | undefined, frame: LiveRoundFrame | null): OverlayRosterPlayerViewModel {
  const highlight = resolvePlayerHighlight(row.agentId, frame);
  return {
    id: row.agentId,
    displayName: row.displayName,
    roleLabel: translateToken(row.role),
    metaLabel: buildCompactMetaLabel(agent),
    tokenBankLabel: `$${row.afterTokenBank}`,
    buyLabel: translateBuyType(row.buyType),
    statusLabel: buildPlayerStatusLabel(row.teamId, frame, highlight),
    highlight
  };
}

function toFallbackPlayer(agent: LiveReplayAgent): OverlayRosterPlayerViewModel {
  return {
    id: agent.id,
    displayName: agent.displayName,
    roleLabel: translateToken(agent.role),
    metaLabel: buildCompactMetaLabel(agent),
    tokenBankLabel: "$--",
    buyLabel: "待购买",
    statusLabel: "待回放",
    highlight: "default"
  };
}

function buildCompactMetaLabel(agent: LiveReplayAgent | undefined): string {
  if (!agent) {
    return "待同步";
  }

  const preferred = agent.secondaryRoles[0] ? translateToken(agent.secondaryRoles[0]) : agent.aliases[0];
  return preferred ?? "角色稳定";
}

function resolvePlayerHighlight(agentId: string, frame: LiveRoundFrame | null): OverlayRosterPlayerViewModel["highlight"] {
  if (!frame) {
    return "default";
  }
  if (frame.highlightMvpAgentId === agentId) {
    return "mvp";
  }
  if (frame.killFeed.some((entry) => entry.actorAgentId === agentId)) {
    return "impact";
  }
  if (frame.killFeed.some((entry) => entry.targetAgentId === agentId)) {
    return "target";
  }
  return "default";
}

function buildPlayerStatusLabel(teamId: string, frame: LiveRoundFrame | null, highlight: OverlayRosterPlayerViewModel["highlight"]): string {
  if (!frame) {
    return "待回放";
  }
  if (highlight === "mvp") {
    return "MVP";
  }
  if (highlight === "impact") {
    return "产生击杀";
  }
  if (highlight === "target") {
    return "被击杀";
  }
  if (frame.resultWinnerTeamId && frame.resultWinnerTeamId === teamId) {
    return "本局胜方";
  }
  return "执行职责";
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

function translateBuyType(value: string): string {
  return BUY_LABELS[value] ?? normalizeLabel(value);
}

function normalizeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : part))
    .join(" ");
}
