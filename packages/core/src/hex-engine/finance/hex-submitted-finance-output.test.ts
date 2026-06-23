import { describe, expect, it } from "vitest";

import type { HexRoundStartAgentOutputForAction } from "../action/hex-round-start-agent-output.js";
import type { HexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel } from "./hex-round-finance-duel.js";
import { buildSubmittedFinanceOutputs } from "./hex-submitted-finance-output.js";

describe("Hex submitted finance output gate", () => {
  it("keeps full-buy stance claims within the high budget and caps at possible_kill", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "rifle_buy", "fullBuy", 1200),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["FRED_BAD", "FRED002", "FRED003"], 0.95)]
    });

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.clippingTier).toBe("full");
    expect(submitted[0]?.combatEffectCap).toBe("possible_kill");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toHaveLength(3);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs).toEqual(["FRED_BAD", "FRED002", "FRED003"]);
    expect(submitted[0]?.submittedStanceCard?.confidence).toBe(0.9);
    expect(submitted[0]?.cappedFields).toContain("stanceCard.confidence");
  });

  it("does not skip a bad first evidence ref to keep a later accepted ref under force budget", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "force_buy", "forceBuy", 650),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["UNKNOWN_FIRST", "FRED002"], 0.8)]
    });

    expect(submitted[0]?.clippingTier).toBe("force");
    expect(submitted[0]?.combatEffectCap).toBe("forced_back");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toHaveLength(1);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs).toEqual(["UNKNOWN_FIRST"]);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.confidence).toBe(0.6);
    expect(submitted[0]?.omittedFields).toContain("coreClaims[0].evidenceRefs:1");
  });

  it("turns save/full-eco stance cards into audit-only submitted outputs", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "full_eco", "save", 360),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["FRED002"], 0.9)]
    });

    expect(submitted[0]?.clippingTier).toBe("save");
    expect(submitted[0]?.combatEffectCap).toBe("minor_delay");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toEqual([]);
    expect(submitted[0]?.submittedUsableForJudge).toBe(true);
    expect(submitted[0]?.submittedUsableForCombat).toBe(false);
    expect(submitted[0]?.omittedFields).toContain("coreClaims:3");
  });

  it("marks a challenge orphaned when the target claim was clipped out of submitted stance", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: {
        teams: [],
        warnings: [],
        agents: [
          buildEconomyAgent("ct_0", "full_eco", "save", 360),
          buildEconomyAgent("t_0", "rifle_buy", "fullBuy", 1200)
        ]
      },
      roundStartAgentOutputs: [
        buildStanceOutput("ct_0", ["FRED002"], 0.7),
        buildChallengeOutput("t_0", "claim_ct_0_1", ["FRED002", "FRED003"])
      ]
    });

    const challenge = submitted.find((output) => output.cardKind === "challenge");
    expect(challenge?.orphanedChallenge).toBe(true);
    expect(challenge?.submittedUsableForJudge).toBe(true);
    expect(challenge?.submittedUsableForCombat).toBe(false);
    expect(challenge?.submittedChallengeCard?.targetClaimId).toBe("claim_ct_0_1");
    expect(challenge?.gateSummary).toContain("orphaned_challenge");
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

function buildEconomyContext(
  agentId: string,
  economyPosture: string,
  buyType: string,
  outputBudget: number
): HexRoundEconomyContext {
  return {
    teams: [],
    warnings: [],
    agents: [buildEconomyAgent(agentId, economyPosture, buyType, outputBudget)]
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

function buildStanceOutput(agentId: string, evidenceRefs: string[], confidence: number): HexRoundStartAgentOutputForAction {
  const coreClaims = [0, 1, 2].map((index) => ({
    claimId: `claim_${agentId}_${index + 1}`,
    claimType: "commodity_price_momentum",
    claimZh: `第 ${index + 1} 条商品价格动量 claim。`,
    evidenceRefs: index === 0 ? evidenceRefs : [`FRED00${index + 4}`],
    reasoningBridge: "商品价格动量只能作为配置线索，仍需权益传导约束。",
    confidence,
    unsupportedIfEvidenceRejected: true
  }));
  return {
    outputId: `round_start_${agentId}`,
    agentId,
    usableForPhaseAction: true,
    openingStatementZh: "raw stance",
    evidenceRefs,
    riskBoundaryZh: "risk",
    buyConstraintAppliedZh: "buy",
    phaseActionCarryoverZh: "carry",
    source: "fixture_response",
    cardKind: "stance",
    stanceCard: {
      cardId: `stance_${agentId}`,
      agentId,
      teamSide: "defense",
      decisionQuestionZh: "未来 1-3 个月 A 股有色是否应相对超配？",
      direction: "structural",
      target: "A 股有色",
      horizon: "1-3 months",
      confidence,
      positionSuggestion: "moderate_overweight",
      coreClaims,
      riskBoundaries: ["缺失库存证据则降权。"],
      invalidatingConditions: ["商品价格动量回落。"],
      auditSummaryZh: "raw stance card"
    },
    cardSummaryZh: "raw stance card",
    allowedPhaseRefs: {
      claimIds: coreClaims.map((claim) => claim.claimId),
      challengeIds: []
    }
  };
}

function buildChallengeOutput(agentId: string, targetClaimId: string, evidenceRefs: string[]): HexRoundStartAgentOutputForAction {
  return {
    outputId: `round_start_${agentId}`,
    agentId,
    usableForPhaseAction: true,
    openingStatementZh: "raw challenge",
    evidenceRefs,
    riskBoundaryZh: "risk",
    buyConstraintAppliedZh: "buy",
    phaseActionCarryoverZh: "carry",
    source: "fixture_response",
    cardKind: "challenge",
    challengeCard: {
      cardId: `challenge_${agentId}`,
      agentId,
      teamSide: "attack",
      targetClaimId,
      challengeType: "proxy_mismatch",
      challengedAssumption: "商品价格动量可以直接推出权益超配。",
      evidenceRefs,
      proxyMismatch: "商品价格代理不能直接证明权益盈利传导。",
      confidenceReduction: 0.4,
      challenges: [{
        challengeId: `challenge_${agentId}_1`,
        targetClaimId,
        challengeType: "proxy_mismatch",
        evidenceRefs,
        challengeReasonZh: "代理错配。",
        expectedEffect: "降低置信度。"
      }],
      auditSummaryZh: "raw challenge card"
    },
    cardSummaryZh: "raw challenge card",
    allowedPhaseRefs: {
      claimIds: [],
      challengeIds: [`challenge_${agentId}_1`]
    }
  };
}
