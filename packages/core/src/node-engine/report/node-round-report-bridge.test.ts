import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";
import { createFixtureNodeAgentActionDraftProvider } from "../action/node-agent-action-stage-runner.js";
import { createFixtureNodeLlmDraftProvider } from "../judge/node-llm-stage-runner.js";
import { buildNodeRoundShadowReport } from "./node-round-report-bridge.js";
import {
  runNodeRoundShadow,
  runNodeRoundShadowWithAgentActionLlm,
  runNodeRoundShadowWithNodeLlm,
  type NodeRoundShadowResult
} from "../phase/round-phase-runner.js";

describe("node round report bridge", () => {
  it("converts a shadow result into an auditable shadow report", () => {
    const shadowResult = shadowRound();
    const report = buildNodeRoundShadowReport({
      shadowResult,
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense",
      attackTeamName: "Attack",
      defenseTeamName: "Defense",
      mapName: "Dust2"
    });

    expect(report.source).toBe("node_round_engine_shadow");
    expect(report.status).toBe("complete");
    expect(report.phaseCount).toBe(shadowResult.phases.length);
    expect(report.finalWinCondition?.isRoundOver).toBe(true);
    expect(report.phaseSummaries[0]?.actionCount).toBeGreaterThan(0);
    expect(report.phaseSummaries[0]?.localVerdictCount).toBeGreaterThan(0);
    expect(report.audit.writesDb).toBe(false);
    expect(report.audit.callsLlm).toBe(false);
    expect(report.audit.replacesLegacyRoundPath).toBe(false);
  });

  it("does not pretend to be a legacy RoundReport", () => {
    const report = buildNodeRoundShadowReport({
      shadowResult: shadowRound(),
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect("judgeResult" in report).toBe(false);
    expect("agentOutputs" in report).toBe(false);
    expect("economyDelta" in report).toBe(false);
  });

  it("does not mutate the input shadow result", () => {
    const shadowResult = shadowRound();
    const before = JSON.stringify(shadowResult);

    buildNodeRoundShadowReport({
      shadowResult,
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(JSON.stringify(shadowResult)).toBe(before);
  });

  it("marks a report incomplete when no final win condition exists", () => {
    const shadowResult = shadowRound();
    const { finalWinCondition: _unusedFinalWinCondition, ...shadowWithoutFinal } = shadowResult;
    const incomplete: NodeRoundShadowResult = {
      ...shadowWithoutFinal,
      phases: shadowResult.phases.map((phase) => ({
        ...phase,
        winConditionCheck: {
          ...phase.winConditionCheck,
          isRoundOver: false,
          reason: "test incomplete"
        }
      }))
    };
    const report = buildNodeRoundShadowReport({
      shadowResult: incomplete,
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(report.status).toBe("incomplete");
    expect(report.finalWinCondition).toBeUndefined();
    expect(report.audit.hasFinalWinCondition).toBe(false);
  });

  it("surfaces LLM shadow audit without changing report source", async () => {
    const graph = loadMapNodeGraph("dust2");
    const shadowResult = await runNodeRoundShadowWithNodeLlm({
      roundId: "round_shadow_report_llm_test",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound(),
      nodeLlm: {
        provider: createFixtureNodeLlmDraftProvider(),
        maxLlmCalls: 2
      }
    });
    const report = buildNodeRoundShadowReport({
      shadowResult,
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(report.source).toBe("node_round_engine_shadow");
    expect(report.audit.callsLlm).toBe(true);
    expect(report.audit.llmShadowEnabled).toBe(true);
    expect(report.audit.llmCallsAttempted).toBeGreaterThan(0);
    expect(report.audit.writesDb).toBe(false);
    expect(report.audit.replacesLegacyRoundPath).toBe(false);
  });

  it("surfaces agent action LLM shadow audit without changing report source", async () => {
    const graph = loadMapNodeGraph("dust2");
    const shadowResult = await runNodeRoundShadowWithAgentActionLlm({
      roundId: "round_shadow_report_agent_action_llm_test",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound(),
      agentActionLlm: {
        provider: createFixtureNodeAgentActionDraftProvider(),
        maxLlmCalls: 2
      }
    });
    const report = buildNodeRoundShadowReport({
      shadowResult,
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(report.source).toBe("node_round_engine_shadow");
    expect(report.audit.callsLlm).toBe(true);
    expect(report.audit.agentActionLlmEnabled).toBe(true);
    expect(report.audit.agentActionCallsAttempted).toBeGreaterThan(0);
    expect(report.audit.agentActionDraftAcceptedCount).toBeGreaterThan(0);
    expect(report.audit.writesDb).toBe(false);
    expect(report.audit.replacesLegacyRoundPath).toBe(false);
  });
});

function shadowRound() {
  return runNodeRoundShadow({
    roundId: "round_shadow_report_test",
    roundNumber: 1,
    graph: loadMapNodeGraph("dust2"),
    economyResources: resourcesForRound()
  });
}

function resourcesForRound() {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", "rifle_buy", "rifle_full_t_pack", attackAgents.map((agent) => agent.id)),
      teamPlan("team_defense", "defense", "rifle_buy", "rifle_full_ct_pack", defenseAgents.map((agent) => agent.id))
    ]
  });
}

function teamPlan(
  teamId: string,
  side: "attack" | "defense",
  posture: EconomyPosture,
  loadoutPackage: LoadoutPackage,
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test posture reason",
    summaryBuyType: "fullBuy",
    totalCash: 25000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: 5000,
      tokenBankAfterDrop: 5000,
      buyType: "fullBuy",
      economyPosture: posture,
      loadoutPackage,
      spend: 5000,
      outputBudget: 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function agents(teamId: string, prefix: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_test",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  })) as Agent[];
}
