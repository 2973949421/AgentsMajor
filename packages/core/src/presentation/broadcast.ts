import type { EconomyDelta, MapGame, Match, Round, RoundReport, ScorePair, Team } from "@agent-major/shared";

export type BroadcastItemKind = "caster_line" | "barrage" | "support_rate" | "replay_card";
export type BroadcastTaskKind = BroadcastItemKind | "highlight_detection";
export type GenerationMode = "rule" | "llm" | "fallback_template" | "manual";
export type QualityStatus = "ready" | "fallback" | "needs_review" | "rejected";

export interface BroadcastTeamIdentity {
  id: string;
  displayName: string;
  shortName: string;
}

export interface BroadcastSourceBundle {
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundReport: RoundReport;
  teams: {
    teamA: BroadcastTeamIdentity;
    teamB: BroadcastTeamIdentity;
  };
  sourceEventIds: {
    scoreEventId: string;
    economyEventId: string;
    highlightEventId: string;
    roundReportEventId: string;
    roundCompletedEventId: string;
    killFeedEventIds: string[];
  };
}

export interface BroadcastItem<TPayload = BroadcastItemPayload> {
  id: string;
  kind: BroadcastItemKind;
  tournamentId: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  sourceEventIds: string[];
  generationMode: GenerationMode;
  qualityStatus: QualityStatus;
  payload: TPayload;
  createdAt: string;
}

export type BroadcastItemPayload = CasterLinePayload | BarragePayload | SupportRatePayload | ReplayCardPayload;

export interface CasterLinePayload {
  speakerRole: "main_caster";
  text: string;
  reason: string;
  tags: string[];
}

export interface BarragePayload {
  source: "fallback_template" | "rule";
  messages: BarrageMessage[];
}

export interface BarrageMessage {
  id: string;
  atMs: number;
  text: string;
  intensity: "low" | "medium" | "high";
}

export interface SupportRatePayload {
  teamA: number;
  teamB: number;
  leaderTeamId: string;
  trend: "team_a_up" | "team_b_up" | "stable";
  label: string;
}

export interface ReplayCardPayload {
  title: string;
  summary: string;
  highlightTags: string[];
  jumpTarget: {
    type: "highlight_reveal";
    roundId: string;
    atMs: number;
  };
}

export interface BroadcastQualityResult {
  status: QualityStatus;
  warnings: string[];
}

export interface RoundBroadcastItems {
  casterLine: BroadcastItem<CasterLinePayload>;
  barrage: BroadcastItem<BarragePayload>;
  supportRate: BroadcastItem<SupportRatePayload>;
  replayCard: BroadcastItem<ReplayCardPayload>;
}

export interface RoundBroadcastGenerator {
  build(input: {
    bundle: BroadcastSourceBundle;
    createdAt: string;
  }): Promise<RoundBroadcastItems>;
}

export interface BroadcastEventPayload<TPayload = BroadcastItemPayload> {
  [key: string]: unknown;
  schemaVersion: 1;
  broadcastItemId: string;
  kind: BroadcastItemKind;
  generationMode: GenerationMode;
  qualityStatus: QualityStatus;
  sourceEventIds: string[];
  payload: TPayload;
}

const forbiddenKeyFragments = ["drivermodelid", "providerid", "modelname", "token", "cost"];

export function buildBroadcastSourceBundle(input: {
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundReport: RoundReport;
  teamA: Team;
  teamB: Team;
  sourceEventIds: BroadcastSourceBundle["sourceEventIds"];
}): BroadcastSourceBundle {
  return {
    match: input.match,
    mapGame: input.mapGame,
    round: input.round,
    roundReport: input.roundReport,
    teams: {
      teamA: toBroadcastTeamIdentity(input.teamA),
      teamB: toBroadcastTeamIdentity(input.teamB)
    },
    sourceEventIds: input.sourceEventIds
  };
}

export function buildRoundBroadcastItems(input: { bundle: BroadcastSourceBundle; createdAt: string }): RoundBroadcastItems {
  const { bundle, createdAt } = input;
  const casterSourceEventIds = [bundle.sourceEventIds.roundReportEventId];
  const supportSourceEventIds = [bundle.sourceEventIds.scoreEventId, bundle.sourceEventIds.economyEventId, bundle.sourceEventIds.roundReportEventId];
  const highlightSourceEventIds = [bundle.sourceEventIds.highlightEventId, bundle.sourceEventIds.roundReportEventId];
  const barrageSourceEventIds =
    bundle.sourceEventIds.killFeedEventIds.length > 0 ? bundle.sourceEventIds.killFeedEventIds : [bundle.sourceEventIds.roundReportEventId];

  return {
    casterLine: createBroadcastItem({
      bundle,
      kind: "caster_line",
      sourceEventIds: casterSourceEventIds,
      generationMode: "fallback_template",
      fallbackStatus: "fallback",
      payload: buildCasterLinePayload(bundle),
      createdAt
    }),
    barrage: createBroadcastItem({
      bundle,
      kind: "barrage",
      sourceEventIds: barrageSourceEventIds,
      generationMode: "fallback_template",
      fallbackStatus: "fallback",
      payload: buildBarragePayload(bundle),
      createdAt
    }),
    supportRate: createBroadcastItem({
      bundle,
      kind: "support_rate",
      sourceEventIds: supportSourceEventIds,
      generationMode: "rule",
      fallbackStatus: "ready",
      payload: buildSupportRatePayload(bundle),
      createdAt
    }),
    replayCard: createBroadcastItem({
      bundle,
      kind: "replay_card",
      sourceEventIds: highlightSourceEventIds,
      generationMode: "rule",
      fallbackStatus: "ready",
      payload: buildReplayCardPayload(bundle),
      createdAt
    })
  };
}

export function buildCasterLineBroadcastItem(input: {
  bundle: BroadcastSourceBundle;
  sourceEventIds?: string[];
  generationMode: GenerationMode;
  fallbackStatus: QualityStatus;
  payload: CasterLinePayload;
  createdAt: string;
}): BroadcastItem<CasterLinePayload> {
  return createBroadcastItem({
    bundle: input.bundle,
    kind: "caster_line",
    sourceEventIds: input.sourceEventIds ?? [input.bundle.sourceEventIds.roundReportEventId],
    generationMode: input.generationMode,
    fallbackStatus: input.fallbackStatus,
    payload: input.payload,
    createdAt: input.createdAt
  });
}

export function runBroadcastQualityGate(input: {
  item: Omit<BroadcastItem<unknown>, "qualityStatus"> & { qualityStatus?: QualityStatus };
  roundReport: RoundReport;
  fallbackStatus: QualityStatus;
}): BroadcastQualityResult {
  const warnings: string[] = [];

  if (input.item.sourceEventIds.length === 0) {
    warnings.push("missing_source_event_ids");
  }

  const forbiddenPath = findForbiddenPayloadKey(input.item.payload);
  if (forbiddenPath) {
    warnings.push(`forbidden_payload_key:${forbiddenPath}`);
  }

  const factMismatch = findFactMismatch(input.item.payload, input.roundReport);
  if (factMismatch) {
    warnings.push(factMismatch);
  }

  if (warnings.some((warning) => warning.startsWith("missing_") || warning.startsWith("forbidden_") || warning.startsWith("fact_"))) {
    return { status: "rejected", warnings };
  }

  return { status: input.fallbackStatus, warnings };
}

export function isDisplayableBroadcastItem(item: BroadcastItem): boolean {
  return item.qualityStatus === "ready" || item.qualityStatus === "fallback";
}

export function toBroadcastEventPayload<TPayload extends BroadcastItemPayload>(item: BroadcastItem<TPayload>): BroadcastEventPayload<TPayload> {
  return {
    schemaVersion: 1,
    broadcastItemId: item.id,
    kind: item.kind,
    generationMode: item.generationMode,
    qualityStatus: item.qualityStatus,
    sourceEventIds: item.sourceEventIds,
    payload: item.payload
  };
}

function createBroadcastItem<TPayload extends BroadcastItemPayload>(input: {
  bundle: BroadcastSourceBundle;
  kind: BroadcastItemKind;
  sourceEventIds: string[];
  generationMode: GenerationMode;
  fallbackStatus: QualityStatus;
  payload: TPayload;
  createdAt: string;
}): BroadcastItem<TPayload> {
  const draft = {
    id: `bi_${input.bundle.round.id}_${input.kind}`,
    kind: input.kind,
    tournamentId: input.bundle.match.tournamentId,
    matchId: input.bundle.match.id,
    mapGameId: input.bundle.mapGame.id,
    roundId: input.bundle.round.id,
    sourceEventIds: input.sourceEventIds,
    generationMode: input.generationMode,
    payload: input.payload,
    createdAt: input.createdAt
  };
  const quality = runBroadcastQualityGate({
    item: draft,
    roundReport: input.bundle.roundReport,
    fallbackStatus: input.fallbackStatus
  });

  return { ...draft, qualityStatus: quality.status };
}

function buildCasterLinePayload(bundle: BroadcastSourceBundle): CasterLinePayload {
  return {
    speakerRole: "main_caster",
    text: bundle.roundReport.summary,
    reason: bundle.roundReport.judgeResult.reason,
    tags: bundle.roundReport.highlightTags ?? []
  };
}

function buildBarragePayload(bundle: BroadcastSourceBundle): BarragePayload {
  const tags = bundle.roundReport.highlightTags ?? [];
  const keyEvent = bundle.roundReport.keyEvents[0];
  const messages: BarrageMessage[] = [
    {
      id: `bm_${bundle.round.id}_1`,
      atMs: 18000,
      text: keyEvent ? `关键区开打：${keyEvent.impact}` : "这一回合开始进入控图阶段。",
      intensity: "medium"
    },
    {
      id: `bm_${bundle.round.id}_2`,
      atMs: 36000,
      text: tags.includes("economy_swing") ? "经济区这波很关键。" : "节奏还在拉扯，等一个收束点。",
      intensity: tags.includes("economy_swing") ? "high" : "low"
    },
    {
      id: `bm_${bundle.round.id}_3`,
      atMs: 56000,
      text: `高光标签：${tags.slice(0, 2).join(" / ") || "常规转化"}`,
      intensity: "medium"
    }
  ];

  return { source: "fallback_template", messages };
}

function buildSupportRatePayload(bundle: BroadcastSourceBundle): SupportRatePayload {
  const report = bundle.roundReport;
  const scoreDelta = report.scoreAfterRound.teamA - report.scoreAfterRound.teamB;
  const winnerLean = report.winnerTeamId === bundle.teams.teamA.id ? 7 : -7;
  const economyLean = economyLeanForTeamA(report.economyDelta);
  const rawTeamA = 50 + clamp(scoreDelta * 4, -18, 18) + winnerLean + economyLean;
  const teamA = Math.round(clamp(rawTeamA, 20, 80));
  const teamB = 100 - teamA;
  const leaderTeamId = teamA >= teamB ? bundle.teams.teamA.id : bundle.teams.teamB.id;
  const trend = Math.abs(teamA - teamB) <= 4 ? "stable" : teamA > teamB ? "team_a_up" : "team_b_up";

  return {
    teamA,
    teamB,
    leaderTeamId,
    trend,
    label: `${teamA >= teamB ? bundle.teams.teamA.shortName : bundle.teams.teamB.shortName} 观赛热度领先`
  };
}

function buildReplayCardPayload(bundle: BroadcastSourceBundle): ReplayCardPayload {
  const tags = bundle.roundReport.highlightTags ?? [];
  const titleTag = tags[0] ? formatHighlightTag(tags[0]) : "回合高光";
  return {
    title: `Round ${bundle.round.roundNumber} | ${titleTag}`,
    summary: bundle.roundReport.summary,
    highlightTags: tags,
    jumpTarget: {
      type: "highlight_reveal",
      roundId: bundle.round.id,
      atMs: 54000
    }
  };
}

function toBroadcastTeamIdentity(team: Team): BroadcastTeamIdentity {
  return {
    id: team.id,
    displayName: team.displayName,
    shortName: team.shortName
  };
}

function findForbiddenPayloadKey(value: unknown, path = "payload"): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nested = findForbiddenPayloadKey(item, `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (forbiddenKeyFragments.some((fragment) => normalizedKey.includes(fragment))) {
      return `${path}.${key}`;
    }

    const nested = findForbiddenPayloadKey(nestedValue, `${path}.${key}`);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function findFactMismatch(value: unknown, roundReport: RoundReport, path = "payload"): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nested = findFactMismatch(item, roundReport, `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "winnerTeamId" && typeof nestedValue === "string" && nestedValue !== roundReport.winnerTeamId) {
      return `fact_winner_mismatch:${path}.${key}`;
    }

    if (key === "scoreBeforeRound" && isScorePair(nestedValue) && !scorePairEquals(nestedValue, roundReport.scoreBeforeRound)) {
      return `fact_score_before_mismatch:${path}.${key}`;
    }

    if (key === "scoreAfterRound" && isScorePair(nestedValue) && !scorePairEquals(nestedValue, roundReport.scoreAfterRound)) {
      return `fact_score_after_mismatch:${path}.${key}`;
    }

    const nested = findFactMismatch(nestedValue, roundReport, `${path}.${key}`);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function economyLeanForTeamA(economyDelta: EconomyDelta): number {
  const diff = economyDelta.teamTotals.teamA - economyDelta.teamTotals.teamB;
  if (Math.abs(diff) < 5000) {
    return 0;
  }
  return diff > 0 ? 4 : -4;
}

function formatHighlightTag(tag: string): string {
  return tag
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function isScorePair(value: unknown): value is ScorePair {
  return isRecord(value) && typeof value.teamA === "number" && typeof value.teamB === "number";
}

function scorePairEquals(left: ScorePair, right: ScorePair): boolean {
  return left.teamA === right.teamA && left.teamB === right.teamB;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
