import { describe, expect, it } from "vitest";

import { buildScoreTensionDiagnostic, inferWinnerSide } from "./score-tension-diagnostics.js";

describe("score tension diagnostics", () => {
  it("detects same-side attack streak separately from same-team streak", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      score: { teamA: 2, teamB: 2 },
      outcomes: [
        { winnerTeamId: "team_a", winnerSide: "attack" },
        { winnerTeamId: "team_b", winnerSide: "attack" },
        { winnerTeamId: "team_a", winnerSide: "attack" }
      ]
    });

    expect(diagnostic).toMatchObject({
      level: "side_bias_warning",
      winningStreak: 1,
      sideWinningStreak: 3,
      attackWins: 3,
      defenseWins: 0,
      sideBiasSuspected: true
    });
  });

  it("marks strong side bias after four same-side wins", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      score: { teamA: 3, teamB: 3 },
      outcomes: [
        { winnerTeamId: "team_a", winnerSide: "defense" },
        { winnerTeamId: "team_b", winnerSide: "defense" },
        { winnerTeamId: "team_a", winnerSide: "defense" },
        { winnerTeamId: "team_b", winnerSide: "defense" }
      ]
    });

    expect(diagnostic?.level).toBe("side_bias_strong");
    expect(diagnostic?.latestWinnerSide).toBe("defense");
    expect(diagnostic?.sideWinningStreak).toBe(4);
  });

  it("keeps side-bias suspicion when same-team streak is equally severe", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      score: { teamA: 8, teamB: 2 },
      outcomes: [
        { winnerTeamId: "team_a", winnerSide: "attack" },
        { winnerTeamId: "team_a", winnerSide: "attack" },
        { winnerTeamId: "team_a", winnerSide: "attack" },
        { winnerTeamId: "team_a", winnerSide: "attack" }
      ]
    });

    expect(diagnostic).toMatchObject({
      level: "strong",
      teamStreakLevel: "strong",
      sideBiasLevel: "side_bias_strong",
      sideBiasSuspected: true
    });
  });

  it("detects aggregate attack-side bias at 12:6 on Dust2", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      mapName: "dust2",
      score: { teamA: 9, teamB: 9 },
      outcomes: [
        ...Array.from({ length: 6 }).flatMap((_, index) => [
          { winnerTeamId: index % 2 === 0 ? "team_a" : "team_b", winnerSide: "attack" as const },
          { winnerTeamId: index % 2 === 0 ? "team_b" : "team_a", winnerSide: "attack" as const },
          { winnerTeamId: index % 2 === 0 ? "team_a" : "team_b", winnerSide: "defense" as const }
        ])
      ]
    });

    expect(diagnostic).toMatchObject({
      level: "score_pattern_strong",
      sideBiasLevel: "side_bias_warning",
      attackWins: 12,
      defenseWins: 6,
      attackWinRate: 0.667,
      dominantSide: "attack",
      sideBiasSuspected: true,
      scorePatternSuspected: true,
      latestTieScore: "9:9"
    });
  });

  it("detects aggregate defense-side bias symmetrically", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      mapName: "dust2",
      score: { teamA: 9, teamB: 9 },
      outcomes: [
        ...Array.from({ length: 6 }).flatMap((_, index) => [
          { winnerTeamId: index % 2 === 0 ? "team_a" : "team_b", winnerSide: "defense" as const },
          { winnerTeamId: index % 2 === 0 ? "team_b" : "team_a", winnerSide: "defense" as const },
          { winnerTeamId: index % 2 === 0 ? "team_a" : "team_b", winnerSide: "attack" as const }
        ])
      ]
    });

    expect(diagnostic).toMatchObject({
      level: "score_pattern_strong",
      sideBiasLevel: "side_bias_warning",
      attackWins: 6,
      defenseWins: 12,
      defenseWinRate: 0.667,
      dominantSide: "defense",
      sideBiasSuspected: true,
      scorePatternSuspected: true,
      latestTieScore: "9:9"
    });
  });

  it("detects regular tie-loop score patterns at 6:6", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      score: { teamA: 6, teamB: 6 },
      outcomes: Array.from({ length: 12 }, (_, index) => ({
        winnerTeamId: index % 2 === 0 ? "team_a" : "team_b",
        winnerSide: index % 2 === 0 ? ("attack" as const) : ("defense" as const)
      }))
    });

    expect(diagnostic).toMatchObject({
      level: "score_pattern_warning",
      scorePatternSuspected: true,
      patternType: "regular_tie_loop",
      latestTieScore: "6:6",
      overtimeCycleCount: 0
    });
  });

  it("detects overtime tie-loop score patterns at 9:9 and 12:12", () => {
    const outcomes = Array.from({ length: 24 }, (_, index) => ({
      winnerTeamId: index % 2 === 0 ? "team_a" : "team_b",
      winnerSide: index % 3 === 0 ? ("attack" as const) : ("defense" as const)
    }));

    expect(
      buildScoreTensionDiagnostic({
        score: { teamA: 9, teamB: 9 },
        outcomes: outcomes.slice(0, 18)
      })
    ).toMatchObject({
      level: "score_pattern_strong",
      scorePatternSuspected: true,
      patternType: "overtime_tie_loop",
      latestTieScore: "9:9",
      overtimeCycleCount: 1
    });

    expect(
      buildScoreTensionDiagnostic({
        score: { teamA: 12, teamB: 12 },
        outcomes
      })
    ).toMatchObject({
      level: "score_pattern_strong",
      scorePatternSuspected: true,
      patternType: "overtime_tie_loop",
      latestTieScore: "12:12",
      overtimeCycleCount: 2
    });
  });

  it("keeps template-score suspicion after a map leaves 12:12 and ends 16:13", () => {
    const diagnostic = buildScoreTensionDiagnostic({
      mapName: "dust2",
      score: { teamA: 16, teamB: 13 },
      mapCompleted: true,
      scoreHistory: [
        { teamA: 6, teamB: 6 },
        { teamA: 9, teamB: 9 },
        { teamA: 12, teamB: 12 },
        { teamA: 16, teamB: 13 }
      ],
      outcomes: Array.from({ length: 29 }, (_, index) => ({
        winnerTeamId: index % 2 === 0 ? "team_a" : "team_b",
        winnerSide: index < 22 ? ("attack" as const) : ("defense" as const)
      }))
    });

    expect(diagnostic).toMatchObject({
      sideBiasLevel: "map_final_side_bias",
      scorePatternSuspected: true,
      sideBiasSuspected: true,
      latestTieScore: "12:12",
      overtimeCycleCount: 2,
      attackWins: 22,
      defenseWins: 7
    });
  });

  it("infers winner side from side assignment before falling back to win type", () => {
    expect(
      inferWinnerSide({
        winnerTeamId: "team_a",
        attackingTeamId: "team_a",
        defendingTeamId: "team_b",
        roundWinType: "defense_elimination"
      })
    ).toBe("attack");

    expect(inferWinnerSide({ roundWinType: "defense_defuse" })).toBe("defense");
  });
});
