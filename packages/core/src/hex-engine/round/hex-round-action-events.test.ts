import { describe, expect, it } from "vitest";

import type { HexValidatedAgentAction } from "../action/index.js";
import { actionToActionResultEvent } from "./hex-round-action-events.js";

const baseAction: HexValidatedAgentAction = {
  agentId: "t_0",
  teamId: "team_t",
  side: "attack",
  phaseId: "execute_or_retake",
  currentCellId: "h_1_1_l0",
  targetCellId: "h_1_1_l0",
  actionType: "plant_bomb",
  apCost: 0.4,
  pathCellIds: ["h_1_1_l0"],
  verticalLinkIds: [],
  pathSource: "none",
  businessIntent: "在包点执行下包。",
  riskNotes: [],
  valid: true,
  validationErrors: []
};

describe("Hex round action events", () => {
  it("marks an objective action partial when the objective event did not materialize", () => {
    const event = actionToActionResultEvent(baseAction, []);

    expect(event.type).toBe("action_result");
    if (event.type !== "action_result") {
      throw new Error("Expected action_result event");
    }
    expect(event.status).toBe("partial");
    expect(event.summary).toContain("objective_not_completed");
  });

  it("keeps an objective action successful when the matching objective event exists", () => {
    const event = actionToActionResultEvent(baseAction, [
      { type: "bomb_planted", agentId: "t_0", cellId: "h_1_1_l0" }
    ]);

    expect(event.type).toBe("action_result");
    if (event.type !== "action_result") {
      throw new Error("Expected action_result event");
    }
    expect(event.status).toBe("success");
    expect(event.summary).not.toContain("objective_not_completed");
  });
});
