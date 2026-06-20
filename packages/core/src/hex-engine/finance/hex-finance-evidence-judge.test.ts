import { describe, expect, it } from "vitest";

import type { HexFinanceChallengeCard, HexFinanceStanceCard, HexRoundStartAgentOutputForAction } from "../action/hex-round-start-agent-output.js";
import { buildHexRoundFinanceDuel } from "./hex-round-finance-duel.js";
import { judgeHexFinanceEvidence } from "./hex-finance-evidence-judge.js";

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
