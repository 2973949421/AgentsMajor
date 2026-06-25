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
    expect(submitted[0]?.rawOpinionLinkStatus).toBe("linked");
    expect(submitted[0]?.submittedOpinionZh).toContain("price momentum claim 1");
    expect(submitted[0]?.submittedTextSpanRefs.some((span) => span.kind === "kept")).toBe(true);
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
    expect(submitted[0]?.submittedOpinionZh).toBeUndefined();
    expect(submitted[0]?.submittedTextSpanRefs.some((span) => span.kind === "omitted")).toBe(true);
  });

  it("falls back to an economy-budget raw excerpt when structured terms are paraphrased", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput("ct_0", ["FRED002", "FRED003"], 0.8);
    rawOutput.rawFinanceOpinionZh = "原始观点：全球铝镍价格动量偏强，但国内库存和现货升贴水证据不足，因此只能形成有限结构性看多，等待更多确认后再扩大仓位。";

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "half_buy", "halfBuy", 650),
      roundStartAgentOutputs: [rawOutput]
    });

    expect(submitted[0]?.clippingTier).toBe("standard");
    expect(submitted[0]?.submittedOpinionZh).toContain("原始观点");
    expect(submitted[0]?.submittedTextSpanRefs[0]).toMatchObject({
      start: 0,
      kind: "kept",
      sourceRef: "rawOpinion:budget_excerpt"
    });
    expect(submitted[0]?.rawOpinionLinkStatus).toBe("partial");
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
    expect(challenge?.submittedTextSpanRefs.some((span) => span.kind === "blocked")).toBe(true);
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
    claimZh: `price momentum claim ${index + 1}`,
    evidenceRefs: index === 0 ? evidenceRefs : [`FRED00${index + 4}`],
    reasoningBridge: "commodity price momentum is only a portfolio clue and still needs equity transmission boundaries.",
    confidence,
    unsupportedIfEvidenceRejected: true
  }));
  const rawFinanceOpinionZh = coreClaims
    .map((claim) => `${claim.claimId}: ${claim.claimZh}; evidence ${claim.evidenceRefs.join(", ")}; bridge ${claim.reasoningBridge}`)
    .join("\n");
  return {
    outputId: `round_start_${agentId}`,
    agentId,
    usableForPhaseAction: true,
    rawFinanceOpinionZh,
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
      decisionQuestionZh: "Should A-share nonferrous metals be overweight over 1-3 months?",
      direction: "structural",
      target: "A-share nonferrous",
      horizon: "1-3 months",
      confidence,
      positionSuggestion: "moderate_overweight",
      coreClaims,
      riskBoundaries: ["inventory evidence missing caps confidence."],
      invalidatingConditions: ["commodity price momentum fades."],
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
  const rawFinanceOpinionZh = `challenge ${targetClaimId}: the assumption that commodity price momentum directly proves equity overweight has a proxy mismatch; evidence ${evidenceRefs.join(", ")}; challenge reason proxy mismatch.`;
  return {
    outputId: `round_start_${agentId}`,
    agentId,
    usableForPhaseAction: true,
    rawFinanceOpinionZh,
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
      challengedAssumption: "commodity price momentum can directly prove equity overweight.",
      evidenceRefs,
      proxyMismatch: "commodity price proxy cannot directly prove equity earnings transmission.",
      confidenceReduction: 0.4,
      challenges: [{
        challengeId: `challenge_${agentId}_1`,
        targetClaimId,
        challengeType: "proxy_mismatch",
        evidenceRefs,
        challengeReasonZh: "proxy mismatch",
        expectedEffect: "reduce confidence"
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
