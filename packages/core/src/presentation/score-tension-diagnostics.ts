import type { ScorePair, Team } from "@agent-major/shared";

export type RoundSideWinner = "attack" | "defense" | "unknown";

export type ScoreTensionLevel =
  | "warning"
  | "strong"
  | "map_final_gap"
  | "side_bias_warning"
  | "side_bias_strong"
  | "map_final_side_bias"
  | "score_pattern_warning"
  | "score_pattern_strong";

export type ScorePatternType = "regular_tie_loop" | "overtime_tie_loop" | "leader_chased_down" | "side_switch_run";

export type ScorePatternPossibleSource = "economy" | "output" | "judge" | "side" | "retry";

export interface ScoreTensionRoundOutcome {
  winnerTeamId?: string | undefined;
  winnerSide?: RoundSideWinner | undefined;
}

export interface MapSideProfile {
  mapName: string;
  sideLean: "balanced" | "attack_leaning" | "defense_leaning";
  expectedAttackWinRateRange: readonly [number, number];
}

export interface ScoreTensionDiagnostic {
  level: ScoreTensionLevel;
  teamStreakLevel?: ScoreTensionLevel | undefined;
  sideBiasLevel?: ScoreTensionLevel | undefined;
  scoreDiff: number;
  latestWinnerTeamId?: string | undefined;
  winningStreak: number;
  latestWinnerSide?: RoundSideWinner | undefined;
  sideWinningStreak: number;
  attackWins: number;
  defenseWins: number;
  attackWinRate: number;
  defenseWinRate: number;
  dominantSide?: "attack" | "defense" | undefined;
  mapSideProfile: MapSideProfile;
  sideBiasSuspected: boolean;
  scorePatternSuspected: boolean;
  patternType?: ScorePatternType | undefined;
  latestTieScore?: string | undefined;
  overtimeCycleCount?: number | undefined;
  possibleSources?: ScorePatternPossibleSource[] | undefined;
  instruction: string;
}

export type ScoreTensionGuardrailContext =
  | {
      level: "warning" | "strong";
      diagnosticLevel: string;
      scoreBeforeRound: ScorePair;
      scoreDiff: number;
      teamStreakLevel?: string;
      sideBiasLevel?: string;
      latestWinnerTeamId?: string;
      latestWinnerName?: string;
      winningStreak: number;
      latestWinnerSide?: "attack" | "defense" | "unknown";
      sideWinningStreak: number;
      attackWins: number;
      defenseWins: number;
      attackWinRate: number;
      defenseWinRate: number;
      dominantSide?: string;
      mapSideProfile?: unknown;
      sideBiasSuspected: boolean;
      scorePatternSuspected: boolean;
      reviewRequired: boolean;
      reviewReason?: string;
      patternType?: string;
      latestTieScore?: string;
      overtimeCycleCount?: number;
      possibleSources?: string[];
      instruction: string;
    }
  | undefined;

export const defaultMapSideProfiles: Record<string, MapSideProfile> = {
  dust2: {
    mapName: "dust2",
    sideLean: "attack_leaning",
    expectedAttackWinRateRange: [0.5, 0.62]
  }
};

export function inferWinnerSide(input: {
  winnerTeamId?: string | undefined;
  attackingTeamId?: string | undefined;
  defendingTeamId?: string | undefined;
  roundWinType?: string | undefined;
  tacticalResult?: string | undefined;
}): RoundSideWinner {
  if (input.winnerTeamId && input.attackingTeamId && input.winnerTeamId === input.attackingTeamId) {
    return "attack";
  }
  if (input.winnerTeamId && input.defendingTeamId && input.winnerTeamId === input.defendingTeamId) {
    return "defense";
  }
  if (input.roundWinType?.startsWith("attack_")) {
    return "attack";
  }
  if (input.roundWinType?.startsWith("defense_")) {
    return "defense";
  }
  if (input.tacticalResult === "attack_breakthrough" || input.tacticalResult === "fake_success") {
    return "attack";
  }
  if (input.tacticalResult === "defense_hold" || input.tacticalResult === "rotate_success") {
    return "defense";
  }

  return "unknown";
}

export function buildScoreTensionDiagnostic(input: {
  score: { teamA: number; teamB: number };
  scoreHistory?: Array<{ teamA: number; teamB: number }> | undefined;
  outcomes: ScoreTensionRoundOutcome[];
  mapCompleted?: boolean | undefined;
  mapName?: string | undefined;
  sideProfile?: MapSideProfile | undefined;
}): ScoreTensionDiagnostic | undefined {
  const mapSideProfile = input.sideProfile ?? resolveMapSideProfile(input.mapName);
  const latestOutcome = input.outcomes.at(-1);
  const latestWinnerTeamId = latestOutcome?.winnerTeamId;
  const latestWinnerSide = latestOutcome?.winnerSide && latestOutcome.winnerSide !== "unknown" ? latestOutcome.winnerSide : undefined;
  const winningStreak = countLatestStreak(input.outcomes, (outcome) => outcome.winnerTeamId, latestWinnerTeamId);
  const sideWinningStreak = countLatestStreak(
    input.outcomes,
    (outcome) => (outcome.winnerSide && outcome.winnerSide !== "unknown" ? outcome.winnerSide : undefined),
    latestWinnerSide
  );
  const attackWins = input.outcomes.filter((outcome) => outcome.winnerSide === "attack").length;
  const defenseWins = input.outcomes.filter((outcome) => outcome.winnerSide === "defense").length;
  const sideKnownRounds = attackWins + defenseWins;
  const attackWinRate = sideKnownRounds > 0 ? roundRate(attackWins / sideKnownRounds) : 0;
  const defenseWinRate = sideKnownRounds > 0 ? roundRate(defenseWins / sideKnownRounds) : 0;
  const dominantSide = attackWins === defenseWins ? undefined : attackWins > defenseWins ? "attack" : "defense";
  const scoreDiff = Math.abs(input.score.teamA - input.score.teamB);
  const teamStreakLevel =
    input.mapCompleted && scoreDiff >= 5
      ? "map_final_gap"
      : winningStreak >= 4 || scoreDiff >= 4
        ? "strong"
        : winningStreak >= 3
          ? "warning"
          : undefined;
  const sideBiasLevel = pickMoreSevereLevel(
    sideWinningStreak >= 4
      ? "side_bias_strong"
      : sideWinningStreak >= 3
        ? "side_bias_warning"
        : undefined,
    buildSideRateLevel({
      attackWinRate,
      defenseWinRate,
      sideKnownRounds,
      mapCompleted: input.mapCompleted,
      mapSideProfile
    })
  );
  const scorePattern = buildScorePatternDiagnostic({
    score: input.score,
    scoreHistory: input.scoreHistory,
    outcomes: input.outcomes,
    sideWinningStreak
  });
  const level = pickMoreSevereLevel(pickMoreSevereLevel(teamStreakLevel, sideBiasLevel), scorePattern.level);
  if (!level) {
    return undefined;
  }

  const sideBiasSuspected = Boolean(sideBiasLevel);
  const scorePatternSuspected = Boolean(scorePattern.level);
  return {
    level,
    ...(teamStreakLevel ? { teamStreakLevel } : {}),
    ...(sideBiasLevel ? { sideBiasLevel } : {}),
    scoreDiff,
    ...(latestWinnerTeamId ? { latestWinnerTeamId } : {}),
    winningStreak,
    ...(latestWinnerSide ? { latestWinnerSide } : {}),
    sideWinningStreak,
    attackWins,
    defenseWins,
    attackWinRate,
    defenseWinRate,
    ...(dominantSide ? { dominantSide } : {}),
    mapSideProfile,
    sideBiasSuspected,
    scorePatternSuspected,
    ...(scorePattern.patternType ? { patternType: scorePattern.patternType } : {}),
    ...(scorePattern.latestTieScore ? { latestTieScore: scorePattern.latestTieScore } : {}),
    ...(typeof scorePattern.overtimeCycleCount === "number" ? { overtimeCycleCount: scorePattern.overtimeCycleCount } : {}),
    ...(scorePattern.possibleSources ? { possibleSources: scorePattern.possibleSources } : {}),
    instruction: buildInstruction({
      level,
      sideBiasLevel,
      scorePatternLevel: scorePattern.level,
      patternType: scorePattern.patternType,
      latestTieScore: scorePattern.latestTieScore,
      latestWinnerSide,
      sideWinningStreak,
      winningStreak,
      dominantSide,
      attackWinRate,
      defenseWinRate,
      mapSideProfile
    })
  };
}

export function buildScoreTensionGuardrailContext(input: {
  mapName?: string | undefined;
  scoreBeforeRound: ScorePair;
  scoreHistory?: ScorePair[] | undefined;
  recentWinnerTeamIds: string[];
  recentRoundOutcomes?: ScoreTensionRoundOutcome[];
  teamA: Team;
  teamB: Team;
}): ScoreTensionGuardrailContext {
  const outcomes =
    input.recentRoundOutcomes?.length
      ? input.recentRoundOutcomes
      : input.recentWinnerTeamIds.map((winnerTeamId) => ({ winnerTeamId }));
  const diagnostic = buildScoreTensionDiagnostic({
    mapName: input.mapName,
    score: input.scoreBeforeRound,
    scoreHistory: input.scoreHistory,
    outcomes
  });
  if (!diagnostic) {
    return undefined;
  }
  const level = diagnostic.level.includes("warning") ? "warning" : "strong";
  const latestWinnerName =
    diagnostic.latestWinnerTeamId === input.teamA.id
      ? input.teamA.displayName
      : diagnostic.latestWinnerTeamId === input.teamB.id
        ? input.teamB.displayName
        : undefined;
  return {
    level,
    diagnosticLevel: diagnostic.level,
    scoreBeforeRound: input.scoreBeforeRound,
    scoreDiff: diagnostic.scoreDiff,
    ...(diagnostic.teamStreakLevel ? { teamStreakLevel: diagnostic.teamStreakLevel } : {}),
    ...(diagnostic.sideBiasLevel ? { sideBiasLevel: diagnostic.sideBiasLevel } : {}),
    ...(diagnostic.latestWinnerTeamId ? { latestWinnerTeamId: diagnostic.latestWinnerTeamId } : {}),
    ...(latestWinnerName ? { latestWinnerName } : {}),
    winningStreak: diagnostic.winningStreak,
    ...(diagnostic.latestWinnerSide ? { latestWinnerSide: diagnostic.latestWinnerSide } : {}),
    sideWinningStreak: diagnostic.sideWinningStreak,
    attackWins: diagnostic.attackWins,
    defenseWins: diagnostic.defenseWins,
    attackWinRate: diagnostic.attackWinRate,
    defenseWinRate: diagnostic.defenseWinRate,
    ...(diagnostic.dominantSide ? { dominantSide: diagnostic.dominantSide } : {}),
    mapSideProfile: diagnostic.mapSideProfile,
    sideBiasSuspected: diagnostic.sideBiasSuspected,
    scorePatternSuspected: diagnostic.scorePatternSuspected,
    reviewRequired: diagnostic.sideBiasSuspected || diagnostic.scorePatternSuspected,
    ...(diagnostic.scorePatternSuspected || diagnostic.sideBiasSuspected
      ? { reviewReason: diagnostic.scorePatternSuspected ? "score_pattern_review_required" : "side_bias_review_required" }
      : {}),
    ...(diagnostic.patternType ? { patternType: diagnostic.patternType } : {}),
    ...(diagnostic.latestTieScore ? { latestTieScore: diagnostic.latestTieScore } : {}),
    ...(typeof diagnostic.overtimeCycleCount === "number" ? { overtimeCycleCount: diagnostic.overtimeCycleCount } : {}),
    ...(diagnostic.possibleSources ? { possibleSources: diagnostic.possibleSources } : {}),
    instruction: diagnostic.instruction
  };
}

export function resolveMapSideProfile(mapName: string | undefined): MapSideProfile {
  const key = mapName?.trim().toLowerCase();
  return (key ? defaultMapSideProfiles[key] : undefined) ?? {
    mapName: key ?? "unknown",
    sideLean: "balanced",
    expectedAttackWinRateRange: [0.45, 0.55]
  };
}

function countLatestStreak<T extends string>(
  outcomes: ScoreTensionRoundOutcome[],
  readValue: (outcome: ScoreTensionRoundOutcome) => T | undefined,
  latestValue: T | undefined
): number {
  if (!latestValue) {
    return 0;
  }
  let streak = 0;
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (readValue(outcomes[index] ?? {}) !== latestValue) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function pickMoreSevereLevel(
  teamLevel: ScoreTensionLevel | undefined,
  sideLevel: ScoreTensionLevel | undefined
): ScoreTensionLevel | undefined {
  if (!teamLevel) {
    return sideLevel;
  }
  if (!sideLevel) {
    return teamLevel;
  }
  return severityOf(sideLevel) > severityOf(teamLevel) ? sideLevel : teamLevel;
}

function severityOf(level: ScoreTensionLevel): number {
  switch (level) {
    case "map_final_gap":
    case "map_final_side_bias":
    case "score_pattern_strong":
      return 3;
    case "strong":
    case "side_bias_strong":
      return 2;
    case "warning":
    case "side_bias_warning":
    case "score_pattern_warning":
      return 1;
  }
}

function buildScorePatternDiagnostic(input: {
  score: { teamA: number; teamB: number };
  scoreHistory?: Array<{ teamA: number; teamB: number }> | undefined;
  outcomes: ScoreTensionRoundOutcome[];
  sideWinningStreak: number;
}): {
  level?: ScoreTensionLevel | undefined;
  patternType?: ScorePatternType | undefined;
  latestTieScore?: string | undefined;
  overtimeCycleCount?: number | undefined;
  possibleSources?: ScorePatternPossibleSource[] | undefined;
} {
  const knownRounds = input.outcomes.length;
  const scorePath = [...(input.scoreHistory ?? []), input.score];
  const tiedScores = scorePath.filter((score) => score.teamA === score.teamB && score.teamA >= 6);
  const latestTie = tiedScores.at(-1);
  if (!latestTie || knownRounds < 10) {
    return {};
  }

  const latestTieScore = `${latestTie.teamA}:${latestTie.teamB}`;
  if (latestTie.teamA >= 9 && latestTie.teamA % 3 === 0) {
    return {
      level: "score_pattern_strong",
      patternType: input.sideWinningStreak >= 4 ? "side_switch_run" : "overtime_tie_loop",
      latestTieScore,
      overtimeCycleCount: Math.max(1, Math.floor((latestTie.teamA - 6) / 3)),
      possibleSources: ["economy", "output", "judge", "side", "retry"]
    };
  }
  if (latestTie.teamA === 6) {
    return {
      level: "score_pattern_warning",
      patternType: "regular_tie_loop",
      latestTieScore,
      overtimeCycleCount: 0,
      possibleSources: ["economy", "output", "judge", "side"]
    };
  }
  return {
    level: "score_pattern_warning",
    patternType: "leader_chased_down",
    latestTieScore,
    possibleSources: ["economy", "output", "judge", "retry"]
  };
}

function buildSideRateLevel(input: {
  attackWinRate: number;
  defenseWinRate: number;
  sideKnownRounds: number;
  mapCompleted?: boolean | undefined;
  mapSideProfile: MapSideProfile;
}): ScoreTensionLevel | undefined {
  if (input.sideKnownRounds < 10) {
    return undefined;
  }
  const [expectedAttackMin, expectedAttackMax] = input.mapSideProfile.expectedAttackWinRateRange;
  const attackOutOfRange = input.attackWinRate > expectedAttackMax;
  const defenseOutOfRange = input.attackWinRate < expectedAttackMin;
  const strongAttackBias = input.attackWinRate >= 0.7;
  const strongDefenseBias = input.defenseWinRate >= 0.7;
  if (input.mapCompleted && (strongAttackBias || strongDefenseBias || attackOutOfRange || defenseOutOfRange)) {
    return "map_final_side_bias";
  }
  if (strongAttackBias || strongDefenseBias) {
    return "side_bias_strong";
  }
  if (attackOutOfRange || defenseOutOfRange || input.attackWinRate >= 0.65 || input.defenseWinRate >= 0.65) {
    return "side_bias_warning";
  }
  return undefined;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildInstruction(input: {
  level: ScoreTensionLevel;
  sideBiasLevel?: ScoreTensionLevel | undefined;
  scorePatternLevel?: ScoreTensionLevel | undefined;
  patternType?: ScorePatternType | undefined;
  latestTieScore?: string | undefined;
  latestWinnerSide?: RoundSideWinner | undefined;
  sideWinningStreak: number;
  winningStreak: number;
  dominantSide?: "attack" | "defense" | undefined;
  attackWinRate: number;
  defenseWinRate: number;
  mapSideProfile: MapSideProfile;
}): string {
  if (input.scorePatternLevel) {
    return `Score pattern risk: ${input.latestTieScore ?? "a tied score"} resembles ${input.patternType ?? "a repeated tie pattern"}. Treat this as a diagnostic risk, not a comeback rule; check economy, output budget, judge evidence and side switching before judging the next round.`;
  }
  if (input.sideBiasLevel === "side_bias_strong" || input.sideBiasLevel === "map_final_side_bias") {
    return `Side tension is strong: ${input.dominantSide ?? input.latestWinnerSide ?? "one side"} is over-performing (attack ${input.attackWinRate}, defense ${input.defenseWinRate}) against ${input.mapSideProfile.mapName} expected attack range ${input.mapSideProfile.expectedAttackWinRateRange[0]}-${input.mapSideProfile.expectedAttackWinRateRange[1]}. Require independent evidence that the same side still wins; do not let attack/defense role alone decide the result.`;
  }
  if (input.sideBiasLevel === "side_bias_warning") {
    return `Side tension warning: ${input.dominantSide ?? input.latestWinnerSide ?? "one side"} is trending high (attack ${input.attackWinRate}, defense ${input.defenseWinRate}). Check whether the opposite side has credible counterplay before judging.`;
  }
  if (input.level === "strong" || input.level === "map_final_gap") {
    return `Score tension is strong: explicitly justify why the leading or streaking team still wins (${input.winningStreak} in a row), or why the trailing team's counterplay succeeds. Do not force a comeback; require evidence from plans, economy, positioning, and actions.`;
  }
  return "Score tension warning: check whether the trailing team has credible counterplay. Do not force a winner, but explain the anti-snowball evidence.";
}
