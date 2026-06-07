import { describe, expect, it } from "vitest";

import { buildNodeLlmJudgeRequest, normalizeLocalNodeJudgeDrafts } from "./node-llm-boundary.js";
import { loadMapNodeGraph } from "./node-graph-service.js";

describe("node LLM boundary", () => {
  it("builds a compact local judge request without final winner fields", () => {
    const graph = loadMapNodeGraph("dust2");
    const request = buildNodeLlmJudgeRequest({
      graph,
      phaseSnapshot: {
        roundId: "round_node_llm_boundary",
        phaseId: "first_contact",
        activeNodeIds: ["long_corner"],
        nodeStates: [
          {
            nodeId: "long_corner",
            phaseId: "first_contact",
            attackAgentIds: ["attack_1"],
            defenseAgentIds: ["defense_1"],
            control: "contested",
            businessIntent: "test business intent"
          }
        ]
      },
      agentActions: [
        {
          agentId: "attack_1",
          teamId: "team_attack",
          side: "attack",
          phaseId: "first_contact",
          currentNodeId: "long_doors",
          targetNodeId: "long_corner",
          actionType: "map_control",
          apCost: 1,
          businessIntent: "validate wedge",
          riskAssessment: "risk",
          expectedResult: "result"
        }
      ]
    });
    const { forbiddenFields: _forbiddenFields, instructions: _instructions, ...requestBody } = request;
    const serialized = JSON.stringify(requestBody);

    expect(request.schemaName).toBe("LocalNodeJudgeDraft");
    expect(request.allowedNodeIds).toEqual(["long_corner"]);
    expect(serialized).not.toContain("winnerTeamId");
    expect(serialized).not.toContain("roundWinType");
    expect(request.forbiddenFields).toContain("winnerTeamId");
  });

  it("rejects drafts with unknown node ids", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = normalizeLocalNodeJudgeDrafts({
      rawDrafts: [{ nodeId: "made_up_node", phaseId: "first_contact", controlAfterCandidate: "attack", summary: "bad" }],
      graph,
      phaseId: "first_contact",
      allowedNodeIds: ["long_corner"]
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.errors.join(" ")).toContain("invalid nodeId");
  });

  it("ignores forbidden fields while accepting otherwise valid drafts", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = normalizeLocalNodeJudgeDrafts({
      rawDrafts: [
        {
          nodeId: "long_corner",
          phaseId: "first_contact",
          controlAfterCandidate: "contested",
          summary: "valid local summary",
          businessPlanValidated: ["validated"],
          businessPlanBroken: [],
          riskNotes: ["risk"],
          confidence: 0.8,
          winnerTeamId: "team_attack",
          roundWinType: "elimination"
        }
      ],
      graph,
      phaseId: "first_contact",
      allowedNodeIds: ["long_corner"]
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.ignoredFields).toContain("winnerTeamId");
    expect(result.ignoredFields).toContain("roundWinType");
  });
});
