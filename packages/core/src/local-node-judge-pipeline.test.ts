import type { AgentPhaseAction, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildLocalNodeVerdicts } from "./local-node-judge-pipeline.js";
import { loadMapNodeGraph } from "./node-graph-service.js";

describe("local node judge pipeline", () => {
  it("materializes contested, attack, defense, and neutral node verdicts without final winner", () => {
    const graph = loadMapNodeGraph("dust2");
    const phaseSnapshot = snapshot();
    const verdicts = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot,
      agentActions: actions()
    });

    expect(verdicts.find((verdict) => verdict.nodeId === "mid")?.controlAfter).toBe("contested");
    expect(verdicts.find((verdict) => verdict.nodeId === "top_mid")?.controlAfter).toBe("attack");
    expect(verdicts.find((verdict) => verdict.nodeId === "a_default")?.controlAfter).toBe("defense");
    expect(verdicts.find((verdict) => verdict.nodeId === "green")?.controlAfter).toBe("neutral");
    expect(verdicts.some((verdict) => "winnerTeamId" in verdict)).toBe(false);
    expect(verdicts.some((verdict) => "roundWinType" in verdict)).toBe(false);
  });

  it("marks engagement only when both sides occupy the node", () => {
    const graph = loadMapNodeGraph("dust2");
    const verdicts = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot(),
      agentActions: actions()
    });

    expect(verdicts.find((verdict) => verdict.nodeId === "mid")?.engagementOccurred).toBe(true);
    expect(verdicts.find((verdict) => verdict.nodeId === "top_mid")?.engagementOccurred).toBe(false);
    expect(verdicts.find((verdict) => verdict.nodeId === "a_default")?.engagementOccurred).toBe(false);
  });

  it("carries business intent into local verdict evidence", () => {
    const graph = loadMapNodeGraph("dust2");
    const verdict = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot(),
      agentActions: actions()
    }).find((item) => item.nodeId === "mid")!;

    expect(verdict.businessPlanValidated?.join(" ")).toContain("buyer 定义");
    expect(verdict.resourceChanges).toEqual(expect.arrayContaining(["attack_agent_1:map_control:AP1"]));
  });

  it("only marks win-condition checks for late plant/site/retake nodes", () => {
    const graph = loadMapNodeGraph("dust2");
    const earlyVerdict = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot("first_contact"),
      agentActions: []
    }).find((verdict) => verdict.nodeId === "a_default")!;
    const lateVerdict = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot("execute_or_retake"),
      agentActions: []
    }).find((verdict) => verdict.nodeId === "a_default")!;

    expect(earlyVerdict.triggersWinConditionCheck).toBe(false);
    expect(lateVerdict.triggersWinConditionCheck).toBe(true);
  });

  it("uses llm shadow drafts to enhance summaries without adding final winner fields", () => {
    const graph = loadMapNodeGraph("dust2");
    const verdict = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot(),
      agentActions: actions(),
      mode: "llm_shadow",
      llmDrafts: [
        {
          nodeId: "mid",
          phaseId: "first_contact",
          summary: "LLM shadow: 中路商业碰撞被解释为双方争夺 buyer 定义权。",
          controlAfterCandidate: "contested",
          businessPlanValidated: ["LLM validated buyer narrative"],
          businessPlanBroken: [],
          riskNotes: ["LLM risk note"],
          confidence: 0.8
        }
      ]
    }).find((item) => item.nodeId === "mid")!;

    expect(verdict.summary).toContain("LLM shadow");
    expect(verdict.businessPlanValidated?.join(" ")).toContain("LLM validated");
    expect(verdict.businessPlanBroken?.join(" ")).toContain("LLM risk note");
    expect("winnerTeamId" in verdict).toBe(false);
  });

  it("downgrades llm shadow control candidates that conflict with node occupancy", () => {
    const graph = loadMapNodeGraph("dust2");
    const verdict = buildLocalNodeVerdicts({
      graph,
      phaseSnapshot: snapshot(),
      agentActions: actions(),
      mode: "llm_shadow",
      llmDrafts: [
        {
          nodeId: "a_default",
          phaseId: "first_contact",
          summary: "LLM shadow incorrectly gives attack control.",
          controlAfterCandidate: "attack",
          businessPlanValidated: [],
          businessPlanBroken: [],
          riskNotes: [],
          confidence: 0.7
        }
      ]
    }).find((item) => item.nodeId === "a_default")!;

    expect(verdict.controlAfter).toBe("defense");
    expect(verdict.businessPlanBroken?.join(" ")).toContain("llm_candidate_control_conflict");
  });
});

function snapshot(phaseId: RoundNodeStateSnapshot["phaseId"] = "first_contact"): RoundNodeStateSnapshot {
  return {
    roundId: "round_verdict_1",
    phaseId,
    activeNodeIds: ["mid", "top_mid", "a_default", "green"],
    nodeStates: [
      {
        nodeId: "mid",
        phaseId,
        attackAgentIds: ["attack_agent_1"],
        defenseAgentIds: ["defense_agent_1"],
        control: "contested"
      },
      {
        nodeId: "top_mid",
        phaseId,
        attackAgentIds: ["attack_agent_2"],
        defenseAgentIds: [],
        control: "attack"
      },
      {
        nodeId: "a_default",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: ["defense_agent_2"],
        control: "defense"
      },
      {
        nodeId: "green",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: [],
        control: "neutral"
      }
    ]
  };
}

function actions(): AgentPhaseAction[] {
  return [
    {
      agentId: "attack_agent_1",
      teamId: "team_attack",
      side: "attack",
      phaseId: "first_contact",
      currentNodeId: "top_mid",
      targetNodeId: "mid",
      actionType: "map_control",
      apCost: 1,
      businessIntent: "用中路行动验证 buyer 定义是否成立。",
      riskAssessment: "中路被反抢会暴露节奏。",
      expectedResult: "争取中路信息。"
    },
    {
      agentId: "defense_agent_1",
      teamId: "team_defense",
      side: "defense",
      phaseId: "first_contact",
      currentNodeId: "mid_doors",
      targetNodeId: "mid",
      actionType: "watch_angle",
      apCost: 1,
      businessIntent: "用中门防守验证组织响应速度。",
      riskAssessment: "若被压退会丢信息。",
      expectedResult: "维持中路对抗。"
    }
  ];
}
