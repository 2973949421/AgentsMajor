import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { describe, expect, it } from "vitest";

import { buildRoundTacticalPlan, runDust2HexRound } from "./hex-round-runner.js";

describe("Hex round runner", () => {
  it("generates a complete fixture trace with a hard final win condition", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_1",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans()
    });

    expect(trace.source).toBe("hex_round_engine_trace");
    expect(trace.phases.length).toBeGreaterThanOrEqual(2);
    expect(trace.phases.length).toBeLessThanOrEqual(5);
    expect(trace.finalWinCondition.isRoundOver).toBe(true);
    expect(trace.finalWinCondition.winnerTeamId).toBeDefined();
    expect(trace.audit.providerMode).toBe("fixture");
    expect(trace.audit.totalLlmCallsAttempted).toBeGreaterThan(0);
    expect(trace.phases.every((phase) => phase.commandResult.actions.length === 10)).toBe(true);
    expect(trace.phases.flatMap((phase) => phase.commandResult.actions).every((action) => action.pathCellIds.length > 0)).toBe(true);
  });

  it("falls back on provider errors without letting forbidden drafts become facts", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_error",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans(),
      maxLlmCallsPerPhase: 2,
      provider: () => {
        throw new Error("fixture_provider_down");
      },
      providerMode: "fixture"
    });

    expect(trace.finalWinCondition.isRoundOver).toBe(true);
    expect(trace.audit.fallbackCount).toBeGreaterThan(0);
    expect(JSON.stringify(trace.finalWinCondition)).not.toContain("winnerFromDraft");
  });

  it("resets AP at the start of each phase while preserving the previous phase snapshot", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_ap_reset",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans(),
      provider: (request) => ({
        providerMode: "fixture",
        modelId: "move_fixture",
        rawDraft: {
          agentId: request.agent.agentId,
          phaseId: request.phaseId,
          currentCellId: request.agent.currentCellId,
          targetCellId: request.targetCandidates[0]?.targetCellId ?? request.agent.currentCellId,
          actionType: request.targetCandidates[0] ? "move" : "hold_position",
          businessIntent: "move fixture advances to the first legal candidate to prove AP reset between phases."
        }
      }),
      providerMode: "fixture",
      maxLlmCallsPerPhase: 10
    });

    expect(trace.phases[0]?.memoryAfter.agents.some((agent) => agent.apSpent > 0)).toBe(true);
    const secondPhase = trace.phases[1];
    expect(secondPhase).toBeDefined();
    expect(secondPhase?.memoryBefore.agents.every((agent) => agent.apSpent === 0 && agent.apRemaining === agent.apBudget)).toBe(true);
  });

  it("uses unique spawn cells for the initial setup snapshot", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_unique_spawn",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans()
    });

    const starts = trace.phases[0]!.memoryBefore.agents.map((agent) => agent.currentCellId);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("rotates deterministic tactical plans by round number", () => {
    expect(buildRoundTacticalPlan(1).attackVariant).not.toBe(buildRoundTacticalPlan(2).attackVariant);
    expect(buildRoundTacticalPlan(1).c4SitePreference).not.toBe(buildRoundTacticalPlan(2).c4SitePreference);
  });

  it("applies a surviving plant action after movement and combat resolution", async () => {
    const asset = loadOfficialDust2HexMap();
    const bombsite = findCellWithFlag(asset, "bombsite_a");
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_objective_window",
      roundNumber: 3,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents().map((agent) =>
        agent.agentId === "t_0"
          ? { ...agent, carryingC4: true, startCellId: bombsite.cellId }
          : { ...agent, carryingC4: false }
      ),
      teamEconomyPlans: buildEconomyPlans(),
      provider: (request) => ({
        providerMode: "fixture",
        modelId: "plant_window_fixture",
        rawDraft: {
          agentId: request.agent.agentId,
          phaseId: request.phaseId,
          currentCellId: request.agent.currentCellId,
          targetCellId: request.agent.agentId === "t_0" ? bombsite.cellId : request.agent.currentCellId,
          actionType: request.agent.agentId === "t_0" ? "plant_bomb" : "hold_position",
          businessIntent: request.agent.agentId === "t_0"
            ? "Plant the C4 on the A bombsite after reaching the objective window."
            : "Hold current position and preserve the round setup."
        }
      }),
      providerMode: "fixture",
      maxLlmCallsPerPhase: 10
    });

    const firstPhase = trace.phases[0];
    expect(firstPhase?.commandResult.actions.find((action) => action.agentId === "t_0")?.actionType).toBe("plant_bomb");
    expect(firstPhase?.memoryEvents.some((event) => event.type === "bomb_planted")).toBe(true);
    expect(firstPhase?.memoryAfter.bombState.planted).toBe(true);
    expect(firstPhase?.memoryAfter.bombState.plantedCellId).toBe(bombsite.cellId);
  });
});

function createAgents() {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "team_t",
      side: "attack" as const,
      carryingC4: index === 0
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "team_ct",
      side: "defense" as const
    }))
  ];
}

function buildEconomyPlans(): Record<string, TeamEconomyPlan> {
  return {
    team_t: buildPlan("team_t", "attack"),
    team_ct: buildPlan("team_ct", "defense")
  };
}

function buildPlan(teamId: string, side: "attack" | "defense"): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "pistol_round",
    lossCount: 0,
    posture: "pistol_round",
    postureReason: "runner fixture",
    summaryBuyType: "halfBuy",
    totalCash: 4000,
    dropDecisions: [],
    decisions: Array.from({ length: 5 }, (_, index) => ({
      agentId: teamId === "team_t" ? `t_${index}` : `ct_${index}`,
      teamId,
      tokenBankBefore: 800,
      tokenBankAfterDrop: 800,
      buyType: "halfBuy" as const,
      economyPosture: "pistol_round" as const,
      loadoutPackage: "pistol_round_pack" as const,
      spend: 650,
      outputBudget: 650,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function findCellWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell {
  const cell = asset.cells.find((candidate) => candidate.playable && candidate.flags.includes(flag));
  if (!cell) {
    throw new Error(`Missing ${flag}`);
  }
  return cell;
}
