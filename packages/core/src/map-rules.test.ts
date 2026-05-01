import { describe, expect, it } from "vitest";

import { evaluateMapState, getSideContext, plannedDemoWinnerSide } from "./map-rules.js";

describe("Phase 1.2 map rules", () => {
  it("completes regular MR6 when a team reaches 7", () => {
    expect(evaluateMapState({ teamA: 7, teamB: 4 }, 11)).toEqual({
      state: "completed",
      phase: "regular",
      winnerSide: "teamA"
    });
  });

  it("enters overtime at 6-6 after 12 regular rounds", () => {
    expect(evaluateMapState({ teamA: 6, teamB: 6 }, 12)).toEqual({
      state: "overtime",
      phase: "overtime"
    });
  });

  it("completes the first MR3 overtime period at 4-2", () => {
    expect(evaluateMapState({ teamA: 10, teamB: 8 }, 18)).toEqual({
      state: "completed",
      phase: "overtime",
      winnerSide: "teamA"
    });
  });

  it("switches side context after round 6 and every 3 overtime rounds", () => {
    expect(getSideContext(6).activeSide).toBe("teamA");
    expect(getSideContext(7).activeSide).toBe("teamB");
    expect(getSideContext(13).activeSide).toBe("teamA");
    expect(getSideContext(16).activeSide).toBe("teamB");
  });

  it("drives the deterministic demo to 6-6 then 4-2 overtime", () => {
    const winners = Array.from({ length: 18 }, (_, index) => plannedDemoWinnerSide(index + 1));
    expect(winners.slice(0, 12).filter((winner) => winner === "teamA")).toHaveLength(6);
    expect(winners.slice(0, 12).filter((winner) => winner === "teamB")).toHaveLength(6);
    expect(winners.slice(12)).toEqual(["teamA", "teamB", "teamA", "teamB", "teamA", "teamA"]);
  });
});
