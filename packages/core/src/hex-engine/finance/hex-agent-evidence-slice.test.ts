import { describe, expect, it } from "vitest";

import { buildHexAgentEvidenceSlices, resolveHexFinanceRole, type HexFinanceFactBankSnapshot, type HexFinanceTeamProfile } from "./hex-agent-evidence-slice.js";
import { buildHexRoundFinanceDuel } from "./hex-round-finance-duel.js";

describe("Hex agent evidence slice", () => {
  it("resolves finance roles from team roster before CS fallback", () => {
    const profile = createTeamProfile("team_t", "falcon-7b");
    expect(resolveHexFinanceRole({
      agent: {
        agentId: "agent_karrigan_1",
        teamId: "team_t",
        side: "attack",
        displayName: "karrigan",
        role: "entry"
      },
      teamProfiles: [profile]
    })).toMatchObject({
      financeRole: "portfolio_manager",
      financeRoleCn: "组合经理",
      roleSource: "team_finance_roster"
    });
  });

  it("falls back from CS roles without leaving finance role unknown", () => {
    expect(resolveHexFinanceRole({
      agent: {
        agentId: "fallback_awper",
        teamId: "team_t",
        side: "attack",
        role: "awper"
      },
      teamProfiles: []
    })).toMatchObject({
      financeRole: "macro_strategy",
      roleSource: "cs_role_fallback",
      roleFallbackReason: expect.stringContaining("CS 角色")
    });
  });

  it("builds differentiated slices for ten agents from fact bank and unavailable observations", () => {
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      agents: createAgents()
    });
    const slices = buildHexAgentEvidenceSlices({
      financeDuel,
      agents: createAgents(),
      factBank: createFactBank(),
      teamProfiles: [
        createTeamProfile("team_t", "falcon-7b"),
        createTeamProfile("team_ct", "vitallmty")
      ]
    });

    expect(slices).toHaveLength(10);
    expect(new Set(slices.map((slice) => slice.financeRole))).toEqual(new Set([
      "portfolio_manager",
      "macro_strategy",
      "commodity_supply_demand",
      "company_modeling",
      "risk_trading"
    ]));
    expect(slices.find((slice) => slice.financeRole === "macro_strategy")?.usableFactsZh.join(" ")).toContain("FRED");
    expect(slices.find((slice) => slice.financeRole === "company_modeling")?.usableFactsZh.join(" ")).toContain("BaoStock");
    expect(slices.find((slice) => slice.financeRole === "commodity_supply_demand")?.missingEvidenceZh.join(" ")).toContain("UN Comtrade");
    expect(slices.find((slice) => slice.financeRole === "risk_trading")?.scoreCapRefs.length).toBeGreaterThan(0);

    const attackSlices = slices.filter((slice) => slice.teamId === "team_t");
    expect(new Set(attackSlices.map((slice) => slice.roleQuestionZh)).size).toBe(5);
    expect(new Set(attackSlices.map((slice) => slice.evidenceRefs.join("|"))).size).toBeGreaterThan(1);
  });
});

function createAgents() {
  return [
    { agentId: "agent_karrigan", displayName: "karrigan", teamId: "team_t", side: "attack" as const, role: "igl" },
    { agentId: "agent_m0nesy", displayName: "m0NESY", teamId: "team_t", side: "attack" as const, role: "awper" },
    { agentId: "agent_kyousuke", displayName: "kyousuke", teamId: "team_t", side: "attack" as const, role: "entry" },
    { agentId: "agent_niko", displayName: "NiKo", teamId: "team_t", side: "attack" as const, role: "star_rifler" },
    { agentId: "agent_teses", displayName: "TeSeS", teamId: "team_t", side: "attack" as const, role: "support" },
    { agentId: "agent_apex", displayName: "apEX", teamId: "team_ct", side: "defense" as const, role: "igl" },
    { agentId: "agent_zywoo", displayName: "ZywOo", teamId: "team_ct", side: "defense" as const, role: "awper" },
    { agentId: "agent_flamez", displayName: "flameZ", teamId: "team_ct", side: "defense" as const, role: "entry" },
    { agentId: "agent_ropz", displayName: "ropz", teamId: "team_ct", side: "defense" as const, role: "rifler" },
    { agentId: "agent_mezii", displayName: "mezii", teamId: "team_ct", side: "defense" as const, role: "support" }
  ];
}

function createTeamProfile(teamId: string, teamSlug: string): HexFinanceTeamProfile {
  return {
    teamId,
    teamSlug,
    financeProfile: {
      coachDoctrine: `${teamSlug} 教练要求所有结论写清事实、推断和缺口。`
    },
    financeAgentRoster: [
      { agentSlug: teamSlug === "falcon-7b" ? "karrigan" : "apex", financeRole: "PM / Portfolio Manager", financeRoleCn: "组合经理" },
      { agentSlug: teamSlug === "falcon-7b" ? "m0nesy" : "zywoo", financeRole: "Macro / Strategy", financeRoleCn: "宏观策略专家" },
      { agentSlug: teamSlug === "falcon-7b" ? "kyousuke" : "flamez", financeRole: "Commodity Supply-Demand", financeRoleCn: "供需 / 商品专家" },
      { agentSlug: teamSlug === "falcon-7b" ? "niko" : "ropz", financeRole: "Company / Financial Modeling", financeRoleCn: "公司 / 财务建模专家" },
      { agentSlug: teamSlug === "falcon-7b" ? "teses" : "mezii", financeRole: "Risk / Trading", financeRoleCn: "风控 / 交易专家" }
    ]
  };
}

function createFactBank(): HexFinanceFactBankSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-15T00:00:00.000Z",
    parserVersion: "test",
    mapBindingId: "dust2_nonferrous_test",
    financeMapSlug: "dust2-nonferrous",
    dataMode: "offline_fact_bank_snapshot",
    facts: [
      {
        factId: "FRED001",
        statementZh: "FRED 铜价最近观测上行，只能作为全球价格代理。",
        metricName: "Global price of Copper",
        source: "FRED",
        dataMode: "offline_observation_fact",
        evidenceId: "EVID:FRED:COPPER"
      },
      {
        factId: "FRED002",
        statementZh: "FRED 铝价最近观测上行，只能作为全球价格代理。",
        metricName: "Global price of Aluminum",
        source: "FRED",
        dataMode: "offline_observation_fact",
        evidenceId: "EVID:FRED:ALUMINUM"
      },
      {
        factId: "BAO001",
        statementZh: "BaoStock 紫金矿业区间收益为正，只能作为市场反应代理。",
        metricName: "representative_company_market_proxy",
        source: "BAOSTOCK",
        dataMode: "offline_observation_fact",
        evidenceId: "EVID:BAO:ZIJIN"
      },
      {
        factId: "COM001",
        statementZh: "UN Comtrade 未能采集铜矿砂可用观测。",
        metricName: "china_import_export_proxy",
        source: "UN_COMTRADE",
        dataMode: "unavailable_observation",
        evidenceId: "EVID:UN:260300",
        unavailableReason: "ValueError"
      }
    ]
  };
}
