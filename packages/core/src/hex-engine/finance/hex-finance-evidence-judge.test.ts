import { describe, expect, it } from "vitest";

import type { HexFinanceChallengeCard, HexFinanceStanceCard, HexRoundStartAgentOutputForAction } from "../action/hex-round-start-agent-output.js";
import type { HexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel } from "./hex-round-finance-duel.js";
import { judgeHexFinanceEvidence } from "./hex-finance-evidence-judge.js";
import { buildSubmittedFinanceOutputs } from "./hex-submitted-finance-output.js";

describe("Hex finance evidence judge", () => {
  it("lets a stance survive only when a claim has accepted evidence and a reasoning bridge", () => {
    const financeDuel = buildTestFinanceDuel();
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "commodity_price_momentum",
          evidenceRefs: ["FRED002"]
        })
      ]
    });

    expect(result.financialResult).toBe("stance_survives");
    expect(result.defense.acceptedEvidenceRefs).toContain("FRED002");
    expect(result.defense.acceptedClaims).toContain("claim_ct_0_1");
    expect(result.stanceScore).toBeGreaterThan(result.challengeScore);
  });

  it("normalizes safe claim type aliases before checking fact metadata", () => {
    const financeDuel = buildTestFinanceDuel();
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "commodity_price_signal",
          evidenceRefs: ["FRED002"]
        })
      ]
    });

    expect(result.financialResult).toBe("stance_survives");
    expect(result.defense.acceptedEvidenceRefs).toContain("FRED002");
    expect(result.defense.auditReasons).toContain("claim_ct_0_1:normalized_claim_type:commodity_price_signal:commodity_price_momentum");
  });
  it("rejects unavailable observations and claim types blocked by fact metadata", () => {
    const financeDuel = buildTestFinanceDuel();
    financeDuel.evidence.facts.push({
      factId: "UNAVAIL001",
      statement: "测试不可用事实。",
      metricName: "unavailable_test_fact",
      source: "TEST",
      sourceType: "fixture",
      evidenceId: "EVID:TEST:UNAVAIL001",
      confidence: 0,
      dataMode: "unavailable_observation",
      allowedClaimTypes: ["commodity_price_momentum"],
      notAllowedClaimTypes: []
    } as never);
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "china_supply_demand",
          evidenceRefs: ["FRED002", "UNAVAIL001"]
        })
      ]
    });

    expect(result.financialResult).toBe("no_financial_win_allowed");
    expect(result.defense.acceptedEvidenceRefs).toEqual([]);
    expect(result.defense.rejectedEvidenceRefs).toEqual(expect.arrayContaining([
      "FRED002:claim_type_not_allowed:china_supply_demand",
      "UNAVAIL001:unavailable_observation_not_positive_fact"
    ]));
    expect(result.defense.missingEvidenceApplied).toContain("UNAVAIL001");
  });

  it("does not let a generic missing-data challenge become a financial win", () => {
    const financeDuel = buildTestFinanceDuel();
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "commodity_price_momentum",
          evidenceRefs: ["FRED002"]
        }),
        buildChallengeOutput({
          challengeReasonZh: "数据不足，所以不能判断。",
          expectedEffect: "数据不足。",
          proxyMismatch: "数据不足。",
          evidenceRefs: ["FRED002"]
        })
      ]
    });

    expect(result.financialResult).toBe("stance_survives");
    expect(result.attack.acceptedChallenges).toEqual([]);
    expect(result.attack.rejectedChallenges).toContain("challenge_t_0_1:generic_missing_data_not_specific");
  });

  it("does not let repeated missing-evidence-only challenges break a stance", () => {
    const financeDuel = buildTestFinanceDuel();
    const missingOnlyChallenges = Array.from({ length: 5 }, (_, index) => buildChallengeOutput({
      challengeId: `challenge_t_0_missing_${index}`,
      challengeReasonZh: "该 claim 缺少 china_supply_demand_proxy 库存或国内供需代理，只能降低置信度。",
      expectedEffect: "触发 china_supply_demand_proxy 评分上限，不能直接判挑战方获胜。",
      proxyMismatch: "缺少 china_supply_demand_proxy，无法把全球价格动量直接外推为国内供需改善。",
      evidenceRefs: []
    }));
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "commodity_price_momentum",
          evidenceRefs: ["FRED002"]
        }),
        ...missingOnlyChallenges
      ]
    });

    expect(result.financialResult).not.toBe("challenge_breaks_stance");
    expect(result.attack.challengeScore).toBeLessThanOrEqual(35);
    expect(result.attack.auditReasons).toContain("challenge_t_0_missing_0:missing_only_challenge_capped");
    expect(result.attack.scoreCapRefs).toContain("challenge_t_0_missing_0:missing_only_challenge");
    expect(result.attack.acceptedEvidenceRefs).toEqual([]);
  });
  it("lets a specific evidence-bound challenge break a weak stance", () => {
    const financeDuel = buildTestFinanceDuel();
    const result = judgeHexFinanceEvidence({
      financeDuel,
      roundStartAgentOutputs: [
        buildStanceOutput({
          claimType: "commodity_price_momentum",
          evidenceRefs: ["FRED002"]
        }),
        buildChallengeOutput({
          challengeId: "challenge_t_0_1",
          challengeReasonZh: "该 claim 只用全球价格动量支持全有色配置，存在 proxy_mismatch，不能直接推出 A 股盈利传导。",
          expectedEffect: "降低 commodity_to_equity_transmission 的置信度。",
          proxyMismatch: "FRED 商品价格只能说明全球价格动量，不能确认 A 股有色盈利传导。",
          evidenceRefs: ["FRED002", "FRED003", "FRED004"]
        }),
        buildChallengeOutput({
          challengeId: "challenge_t_0_2",
          challengeReasonZh: "该 claim 没有说明权益相对沪深300传导路径，reasoning_bridge_break 限制超配结论。",
          expectedEffect: "触发 equity_transmission_proxy 评分上限。",
          proxyMismatch: "商品价格代理与 A 股相对配置之间缺少权益传导证据。",
          evidenceRefs: ["FRED002", "FRED003"]
        })
      ]
    });

    expect(result.financialResult).toBe("challenge_breaks_stance");
    expect(result.attack.acceptedChallenges).toEqual(expect.arrayContaining(["challenge_t_0_1", "challenge_t_0_2"]));
    expect(result.attack.acceptedEvidenceRefs).toEqual(expect.arrayContaining(["FRED002", "FRED003"]));
    expect(result.challengeScore).toBeGreaterThan(result.stanceScore);
    expect(result.challengeScore).toBeLessThanOrEqual(70);
    expect(result.attack.auditReasons).toContain("score_cap_applied:70");
  });
  it("judges submitted finance outputs instead of raw clipped evidence", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput({
      claimType: "commodity_price_momentum",
      evidenceRefs: ["UNKNOWN_FIRST", "FRED002"]
    });
    const submittedFinanceOutputs = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext([
        buildEconomyAgent("ct_0", "force_buy", "forceBuy", 650)
      ]),
      roundStartAgentOutputs: [rawOutput]
    });

    const result = judgeHexFinanceEvidence({
      financeDuel,
      submittedFinanceOutputs,
      roundStartAgentOutputs: [rawOutput]
    });

    expect(result.auditReasons).toContain("judge_input:submitted_finance_outputs");
    expect(result.defense.auditReasons).toContain("judge_input:submitted_finance_outputs");
    expect(result.defense.acceptedEvidenceRefs).not.toContain("FRED002");
    expect(result.defense.rejectedEvidenceRefs).toContain("UNKNOWN_FIRST:unknown_evidence_ref");
  });

  it("keeps orphaned challenge cards as audit-only failures without retargeting", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawStance = buildStanceOutput({
      claimType: "commodity_price_momentum",
      evidenceRefs: ["FRED002"]
    });
    const rawChallenge = buildChallengeOutput({
      challengeReasonZh: "该 claim 的权益传导路径不成立。",
      expectedEffect: "降低 stance 置信度。",
      proxyMismatch: "商品价格动量不能自动推出 A 股盈利传导。",
      evidenceRefs: ["FRED002"]
    });
    const submittedFinanceOutputs = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext([
        buildEconomyAgent("ct_0", "full_eco", "save", 360),
        buildEconomyAgent("t_0", "rifle_buy", "fullBuy", 1200)
      ]),
      roundStartAgentOutputs: [rawStance, rawChallenge]
    });

    const submittedChallenge = submittedFinanceOutputs.find((output) => output.cardKind === "challenge");
    const result = judgeHexFinanceEvidence({
      financeDuel,
      submittedFinanceOutputs
    });

    expect(submittedChallenge?.orphanedChallenge).toBe(true);
    expect(result.attack.acceptedChallenges).toEqual([]);
    expect(result.attack.rejectedChallenges).toContain("challenge_t_0_1:orphaned_challenge_target_clipped_out");
    expect(result.attack.rejectionReasons).toContain("orphaned_challenge_target_clipped_out");
  });
});

function buildTestFinanceDuel() {
  return buildHexRoundFinanceDuel({
    roundNumber: 1,
    attackTeamId: "t",
    defenseTeamId: "ct",
    agents: [
      { agentId: "t_0", teamId: "t", side: "attack", role: "entry" },
      { agentId: "ct_0", teamId: "ct", side: "defense", role: "anchor" }
    ]
  });
}

function buildEconomyContext(agents: HexRoundEconomyContext["agents"]): HexRoundEconomyContext {
  return {
    teams: [],
    warnings: [],
    agents
  };
}

function buildEconomyAgent(
  agentId: string,
  economyPosture: string,
  buyType: string,
  outputBudget: number
): HexRoundEconomyContext["agents"][number] {
  return {
    agentId,
    teamId: agentId.startsWith("ct") ? "ct" : "t",
    side: agentId.startsWith("ct") ? "defense" : "attack",
    economyPosture: economyPosture as never,
    buyType: buyType as never,
    loadoutPackage: "test_pack" as never,
    tokenBankBefore: 10000,
    tokenBankAfterDrop: 10000,
    tokenBankAfterSpend: 5000,
    spend: 5000,
    outputBudget,
    dropSent: 0,
    dropReceived: 0,
    resourceTier: "high",
    utilityTier: "high",
    allowedActionTypes: [],
    constraints: [],
    notes: []
  };
}
function buildStanceOutput(input: {
  claimType: string;
  evidenceRefs: string[];
}): HexRoundStartAgentOutputForAction {
  const stanceCard: HexFinanceStanceCard = {
    cardId: "stance_ct_0",
    agentId: "ct_0",
    teamSide: "defense",
    decisionQuestionZh: "未来 1-3 个月 A 股有色是否应相对超配？",
    direction: "conditional_bullish",
    target: "A 股有色",
    horizon: "1-3 months",
    confidence: 0.62,
    positionSuggestion: "moderate_overweight",
    coreClaims: [{
      claimId: "claim_ct_0_1",
      claimType: input.claimType,
      claimZh: "商品价格动量支持有色配置线索。",
      evidenceRefs: input.evidenceRefs,
      reasoningBridge: "全球价格动量需要通过权益传导和估值约束后，才能支持 A 股有色配置。",
      confidence: 0.62,
      unsupportedIfEvidenceRejected: true
    }],
    riskBoundaries: ["缺少库存或权益传导证据时只能降权。"],
    invalidatingConditions: ["商品价格动量回落。"],
    auditSummaryZh: "ct_0 输出结构化立场卡。"
  };
  return {
    outputId: "round_start_ct_0",
    agentId: "ct_0",
    usableForPhaseAction: true,
    openingStatementZh: stanceCard.auditSummaryZh,
    evidenceRefs: input.evidenceRefs,
    riskBoundaryZh: stanceCard.riskBoundaries.join("；"),
    buyConstraintAppliedZh: "买型允许中等强度配置表达。",
    phaseActionCarryoverZh: "后续 phase 只能引用 claim_ct_0_1。",
    source: "fixture_response",
    cardKind: "stance",
    stanceCard,
    cardSummaryZh: stanceCard.auditSummaryZh,
    allowedPhaseRefs: {
      claimIds: ["claim_ct_0_1"],
      challengeIds: []
    }
  };
}

function buildChallengeOutput(input: {
  challengeId?: string;
  challengeReasonZh: string;
  expectedEffect: string;
  proxyMismatch: string;
  evidenceRefs: string[];
}): HexRoundStartAgentOutputForAction {
  const challengeId = input.challengeId ?? "challenge_t_0_1";
  const challengeCard: HexFinanceChallengeCard = {
    cardId: `challenge_card_${challengeId}`,
    agentId: "t_0",
    teamSide: "attack",
    targetClaimId: "claim_ct_0_1",
    challengeType: "proxy_mismatch",
    challengedAssumption: "全球商品价格动量可以直接推出 A 股有色配置。",
    evidenceRefs: input.evidenceRefs,
    proxyMismatch: input.proxyMismatch,
    confidenceReduction: 0.25,
    challenges: [{
      challengeId,
      targetClaimId: "claim_ct_0_1",
      challengeType: "proxy_mismatch",
      evidenceRefs: input.evidenceRefs,
      challengeReasonZh: input.challengeReasonZh,
      expectedEffect: input.expectedEffect
    }],
    auditSummaryZh: "t_0 输出结构化挑战卡。"
  };
  return {
    outputId: `round_start_${challengeId}`,
    agentId: "t_0",
    usableForPhaseAction: true,
    openingStatementZh: challengeCard.auditSummaryZh,
    evidenceRefs: input.evidenceRefs,
    riskBoundaryZh: challengeCard.proxyMismatch,
    buyConstraintAppliedZh: "买型允许挑战核心 claim。",
    phaseActionCarryoverZh: `后续 phase 只能引用 ${challengeId}。`,
    source: "fixture_response",
    cardKind: "challenge",
    challengeCard,
    cardSummaryZh: challengeCard.auditSummaryZh,
    allowedPhaseRefs: {
      claimIds: [],
      challengeIds: [challengeId]
    }
  };
}
