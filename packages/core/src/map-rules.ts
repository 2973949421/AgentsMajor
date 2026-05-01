import type { ScorePair } from "@agent-major/shared";

export const mr6MapRules = {
  regularRounds: 12,
  roundsPerHalf: 6,
  mapWinScore: 7,
  overtimeRoundsPerHalf: 3,
  overtimeMaxRounds: 6,
  overtimeWinScore: 4,
  safetyRoundCap: 60
} as const;

export type MapStateEvaluation =
  | { state: "running"; phase: "regular" | "overtime" }
  | { state: "overtime"; phase: "overtime" }
  | { state: "completed"; phase: "regular" | "overtime"; winnerSide: "teamA" | "teamB" };

export interface SideContext {
  phase: "regular_first_half" | "regular_second_half" | "overtime";
  activeSide: "teamA" | "teamB";
  reactiveSide: "teamA" | "teamB";
  sideSwitchIndex: number;
}

export function evaluateMapState(score: ScorePair, roundNumber: number): MapStateEvaluation {
  if (roundNumber <= mr6MapRules.regularRounds) {
    if (score.teamA >= mr6MapRules.mapWinScore) {
      return { state: "completed", phase: "regular", winnerSide: "teamA" };
    }
    if (score.teamB >= mr6MapRules.mapWinScore) {
      return { state: "completed", phase: "regular", winnerSide: "teamB" };
    }
    if (roundNumber === mr6MapRules.regularRounds && score.teamA === 6 && score.teamB === 6) {
      return { state: "overtime", phase: "overtime" };
    }

    return { state: "running", phase: "regular" };
  }

  const overtimeRoundNumber = roundNumber - mr6MapRules.regularRounds;
  const overtimeCycle = Math.floor((overtimeRoundNumber - 1) / mr6MapRules.overtimeMaxRounds);
  const cycleStartScore = 6 + overtimeCycle * mr6MapRules.overtimeRoundsPerHalf;
  if (score.teamA >= cycleStartScore + mr6MapRules.overtimeWinScore) {
    return { state: "completed", phase: "overtime", winnerSide: "teamA" };
  }
  if (score.teamB >= cycleStartScore + mr6MapRules.overtimeWinScore) {
    return { state: "completed", phase: "overtime", winnerSide: "teamB" };
  }

  return { state: "overtime", phase: "overtime" };
}

export function getSideContext(roundNumber: number): SideContext {
  if (roundNumber <= mr6MapRules.roundsPerHalf) {
    return {
      phase: "regular_first_half",
      activeSide: "teamA",
      reactiveSide: "teamB",
      sideSwitchIndex: 0
    };
  }

  if (roundNumber <= mr6MapRules.regularRounds) {
    return {
      phase: "regular_second_half",
      activeSide: "teamB",
      reactiveSide: "teamA",
      sideSwitchIndex: 1
    };
  }

  const overtimeRoundNumber = roundNumber - mr6MapRules.regularRounds;
  const sideSwitchIndex = Math.floor((overtimeRoundNumber - 1) / mr6MapRules.overtimeRoundsPerHalf);
  const teamAActive = sideSwitchIndex % 2 === 0;
  return {
    phase: "overtime",
    activeSide: teamAActive ? "teamA" : "teamB",
    reactiveSide: teamAActive ? "teamB" : "teamA",
    sideSwitchIndex: sideSwitchIndex + 2
  };
}

export function plannedDemoWinnerSide(roundNumber: number): "teamA" | "teamB" {
  if (roundNumber <= mr6MapRules.regularRounds) {
    return roundNumber % 2 === 1 ? "teamA" : "teamB";
  }

  const overtimeRoundInCycle = ((roundNumber - mr6MapRules.regularRounds - 1) % mr6MapRules.overtimeMaxRounds) + 1;
  if (overtimeRoundInCycle === 2 || overtimeRoundInCycle === 4) {
    return "teamB";
  }

  return "teamA";
}
