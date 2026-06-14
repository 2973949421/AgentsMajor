import { describe, expect, it } from "vitest";

import {
  buildHexRoundFinanceDuel,
  getHexAgentFinanceAssignment,
  getHexRoundFinanceTopic,
  type HexRoundFinanceEvidenceAggregate
} from "./hex-round-finance-duel.js";

describe("Hex round finance duel", () => {
  it("builds a round finance duel from the Dust2 nonferrous evidence pack", () => {
    const duel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      agents: createAgents()
    });

    expect(duel.source).toBe("hex_round_finance_duel");
    expect(duel.topic.roundKey).toBe("global_metal_price_signal");
    expect(duel.defenseThesis.teamId).toBe("team_ct");
    expect(duel.attackChallenge.teamId).toBe("team_t");
    expect(duel.evidence.promptFacts.length).toBeGreaterThan(0);
    expect(duel.defenseThesis.riskBoundary).toContain("评分上限");
    expect(duel.agentAssignments).toHaveLength(10);
    expect(getHexAgentFinanceAssignment({ financeDuel: duel, agentId: "t_0" })?.linkedChallengeId).toBe(duel.attackChallenge.challengeId);
  });

  it("reuses the same six topics after side swap without binding topics to fixed teams", () => {
    const aggregate = createAggregate();
    const roundOne = getHexRoundFinanceTopic({ roundNumber: 1, evidenceAggregate: aggregate });
    const roundSeven = getHexRoundFinanceTopic({ roundNumber: 7, evidenceAggregate: aggregate });
    const duel = buildHexRoundFinanceDuel({
      roundNumber: 7,
      attackTeamId: "team_ct",
      defenseTeamId: "team_t",
      agents: createAgents().map((agent) => ({
        ...agent,
        side: agent.side === "attack" ? "defense" : "attack"
      })),
      evidenceAggregate: aggregate
    });

    expect(roundSeven.pack.roundKey).toBe(roundOne.pack.roundKey);
    expect(roundSeven.halfIndex).toBe(1);
    expect(roundSeven.mirrorRoundNumber).toBe(1);
    expect(duel.attackTeamId).toBe("team_ct");
    expect(duel.defenseTeamId).toBe("team_t");
    expect(duel.topic.roundKey).toBe("topic_1");
  });

  it("fails clearly when the generated evidence pack is missing", () => {
    expect(() => buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      agents: createAgents(),
      workspaceRoot: "B:/definitely_missing_workspace"
    })).toThrow(/hex_finance_duel_missing_evidence_pack/);
  });
});

function createAgents() {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "team_t",
      side: "attack" as const,
      role: index === 0 ? "portfolio_manager" : "sector_specialist"
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "team_ct",
      side: "defense" as const,
      role: index === 0 ? "risk_controller" : "industry_analyst"
    }))
  ];
}

function createAggregate(): HexRoundFinanceEvidenceAggregate {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-14T00:00:00.000Z",
    generator: "test",
    mapBindingId: "dust2_nonferrous_test",
    financeMapSlug: "dust2-nonferrous",
    dataMode: "fixture",
    sideSwapPolicy: {
      topicCycleRoundCount: 6
    },
    packs: Array.from({ length: 6 }, (_, index) => {
      const roundNumber = index + 1;
      return {
        schemaVersion: 1,
        generatedAt: "2026-06-14T00:00:00.000Z",
        generator: "test",
        dataMode: "fixture",
        mapBindingId: "dust2_nonferrous_test",
        financeMapSlug: "dust2-nonferrous",
        roundNumber,
        roundKey: `topic_${roundNumber}`,
        topicTitle: `主题 ${roundNumber}`,
        defenseThesisFocus: `守方自证 ${roundNumber}`,
        attackChallengeFocus: `攻方质疑 ${roundNumber}`,
        requiredSources: ["fred"],
        optionalSources: [],
        facts: [{
          factId: "F001",
          statement: `代理事实 ${roundNumber}`,
          metricName: "test_metric",
          source: "FRED",
          sourceType: "official_api",
          evidenceId: `EVID:${roundNumber}`,
          confidence: 0.9,
          dataMode: "configured_proxy_fact"
        }],
        missingEvidence: ["domestic_inventory"],
        scoreCaps: [{
          condition: "proxy_fact_boundary",
          maxScore: 70,
          reason: "测试评分上限"
        }],
        promptFacts: [{
          factId: "F001",
          shortText: `提示事实 ${roundNumber}`,
          evidenceId: `EVID:${roundNumber}`
        }],
        judgeLedger: {
          allowedClaims: ["允许低置信结论"],
          cappedClaims: ["缺少库存证据"],
          prohibitedClaims: ["不得重仓"]
        },
        sourceWarnings: []
      };
    })
  };
}
