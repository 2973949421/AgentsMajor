import { describe, expect, it } from "vitest";

import type { HexRoundStartAgentOutputForAction } from "../action/hex-round-start-agent-output.js";
import type { HexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel } from "./hex-round-finance-duel.js";
import { buildSubmittedFinanceOutputs } from "./hex-submitted-finance-output.js";

describe("Hex submitted finance output gate", () => {
  it("derives rifle full submitted budget from economy spend instead of fixed table", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "rifle_buy", "fullBuy", 1200, 5200),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["FRED_BAD", "FRED002", "FRED003"], 0.95)]
    });

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.clippingTier).toBe("rifle_full");
    expect(submitted[0]?.economyClipVersion).toBe("finance_economy_clip_v1");
    expect(submitted[0]?.spend).toBe(5200);
    expect(submitted[0]?.spendUnit).toBe(50);
    expect(submitted[0]?.charsPerSpendUnit).toBe(4);
    expect(submitted[0]?.rawBudgetChars).toBe(416);
    expect(submitted[0]?.submittedBudgetChars).toBe(416);
    expect(submitted[0]?.cutMode).toBe("multi_slice");
    expect(submitted[0]?.combatEffectCap).toBe("possible_kill");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toHaveLength(3);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs).toEqual(["FRED_BAD", "FRED002", "FRED003"]);
    expect(submitted[0]?.submittedStanceCard?.confidence).toBe(0.9);
    expect(submitted[0]?.cappedFields).toContain("stanceCard.confidence");
  });

  it("keeps pistol round as an independent economy clip tier even when buyType is halfBuy", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "pistol_round", "halfBuy", 650, 800),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["FRED002"], 0.7)]
    });

    expect(submitted[0]?.clippingTier).toBe("pistol");
    expect(submitted[0]?.charsPerSpendUnit).toBe(6);
    expect(submitted[0]?.rawBudgetChars).toBe(96);
    expect(submitted[0]?.submittedBudgetChars).toBe(96);
    expect(submitted[0]?.cutMode).toBe("pistol_core_window");
    expect(submitted[0]?.combatEffectCap).toBe("suppression");
  });

  it("does not skip a bad first evidence ref to keep a later accepted ref under force budget", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "force_buy", "forceBuy", 650, 3000),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["UNKNOWN_FIRST", "FRED002"], 0.8)]
    });

    expect(submitted[0]?.clippingTier).toBe("force");
    expect(submitted[0]?.spend).toBe(3000);
    expect(submitted[0]?.rawBudgetChars).toBe(240);
    expect(submitted[0]?.submittedBudgetChars).toBe(240);
    expect(submitted[0]?.cutMode).toBe("multi_slice_lite");
    expect(submitted[0]?.combatEffectCap).toBe("forced_back");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toHaveLength(1);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs).toEqual(["UNKNOWN_FIRST"]);
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.confidence).toBe(0.6);
    expect(submitted[0]?.omittedFields).toContain("coreClaims[0].evidenceRefs:1");
  });

  it("turns save/full-eco stance cards into low-budget audit-only structured outputs", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "full_eco", "save", 360, 600),
      roundStartAgentOutputs: [buildStanceOutput("ct_0", ["FRED002"], 0.9)]
    });

    expect(submitted[0]?.clippingTier).toBe("save");
    expect(submitted[0]?.submittedBudgetChars).toBe(48);
    expect(submitted[0]?.cutMode).toBe("front_cut");
    expect(submitted[0]?.combatEffectCap).toBe("minor_delay");
    expect(submitted[0]?.submittedStanceCard?.coreClaims).toEqual([]);
    expect(submitted[0]?.submittedUsableForJudge).toBe(true);
    expect(submitted[0]?.submittedUsableForCombat).toBe(false);
    expect(submitted[0]?.omittedFields).toContain("coreClaims:3");
    expect(submitted[0]?.submittedOpinionCharCount).toBeLessThanOrEqual(submitted[0]?.submittedBudgetChars ?? 0);
    expect(submitted[0]?.submittedTextSpanRefs.some((span) => span.kind === "omitted")).toBe(true);
  });

  it("uses core_window for half buy instead of hard front cutting paraphrased raw text", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput("ct_0", ["FRED002", "FRED003"], 0.8);
    rawOutput.rawFinanceOpinionZh = "背景铺垫：这段只是说明市场噪音和交易情绪，不应优先提交。核心判断：全球铝镍价格动量偏强，但国内库存和现货升贴水证据不足，因此只能形成有限结构性看多，等待更多确认后再扩大仓位。风险边界：如果库存回升或现货升水转弱，则该判断降权。";

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "half_buy", "halfBuy", 850, 3000),
      roundStartAgentOutputs: [rawOutput]
    });

    expect(submitted[0]?.clippingTier).toBe("half");
    expect(submitted[0]?.submittedBudgetChars).toBe(240);
    expect(submitted[0]?.cutMode).toBe("core_window");
    expect(submitted[0]?.submittedOpinionZh).toContain("核心判断");
    expect(submitted[0]?.submittedTextSpanRefs.some((span) => span.kind === "kept" && span.sourceRef === "rawOpinion:core_window")).toBe(true);
  });

  it("keeps pistol submitted opinion readable instead of anchoring on long machine ids", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput("ct_0", ["EVID:FRED:commodity:PALUMUSDM:commodity_price_momentum_derived:2022-06-01..2026-05-01:PALUMUSDM:58ce0886"], 0.7);
    const firstClaim = rawOutput.stanceCard?.coreClaims[0];
    if (!firstClaim) throw new Error("missing claim");
    firstClaim.claimZh = "核心判断：全球价格动量只能支持有限看多，不能直接证明国内有色股票盈利。";
    firstClaim.reasoningBridge = "推理桥：这些证据只是全球价格代理，仍需要国内库存、现货升贴水和公司利润确认。";
    rawOutput.rawFinanceOpinionZh = `原始观点：先列出机器证据 ${firstClaim.evidenceRefs[0]}，但真正要提交给裁判的人类观点是：${firstClaim.claimZh}${firstClaim.reasoningBridge} 风险边界：如果国内库存回升或现货贴水扩大，则该判断降权。`;

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "pistol_round", "halfBuy", 650, 800),
      roundStartAgentOutputs: [rawOutput]
    });

    expect(submitted[0]?.cutMode).toBe("pistol_core_window");
    expect(submitted[0]?.submittedOpinionZh).toContain("核心判断");
    expect(submitted[0]?.submittedOpinionZh).toContain("有限看多");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("EVID:FRED");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("commodity_price_momentum_derived");
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs[0]).toContain("EVID:FRED");
  });

  it("avoids clipped evidence id suffixes when selecting pistol core windows", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput("ct_0", ["EVID:FRED:commodity:PNICKUSDM:commodity_price_momentum_derived:2022-06-01..2026-05-01:PNICKUSDM:aa95e151"], 0.7);
    const firstClaim = rawOutput.stanceCard?.coreClaims[0];
    if (!firstClaim) throw new Error("missing claim");
    firstClaim.claimZh = "???????????????????????????????????";
    firstClaim.reasoningBridge = "???????????????????????????";
    rawOutput.rawFinanceOpinionZh = "?????? PNICKUSDM:commodity_price_momentum_derived:2022-06-01..2026-05-01:PNICKUSDM:aa95e151?????????????????????????????????????????????????????????????????????????????????????????";

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "pistol_round", "halfBuy", 650, 800),
      roundStartAgentOutputs: [rawOutput]
    });

    expect(submitted[0]?.submittedOpinionZh).toContain("????");
    expect(submitted[0]?.submittedOpinionZh).toContain("????");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("PNICKUSDM:");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("commodity_price_momentum_derived");
  });

  it("keeps pistol challenge submitted opinion readable instead of anchoring on target/evidence ids", () => {
    const financeDuel = buildTestFinanceDuel();
    const challenge = buildChallengeOutput("t_0", "claim_agent_phase18_player_vitallmty_flamez_round1_1", ["EVID:FRED:commodity:PALUMUSDM:commodity_price_momentum_derived:2022-06-01..2026-05-01:PALUMUSDM:58ce0886"]);
    const challengeItem = challenge.challengeCard?.challenges[0];
    if (!challenge.challengeCard || !challengeItem) throw new Error("missing challenge");
    challenge.challengeCard.challengedAssumption = "挑战假设：全球价格动量可以直接推出国内股票超配。";
    challenge.challengeCard.proxyMismatch = "代理错配：全球商品价格不能直接证明国内库存、升贴水和公司利润改善。";
    challengeItem.challengeReasonZh = "挑战理由：对方把全球价格代理误当成国内盈利证据，推理桥断裂。";
    challenge.rawFinanceOpinionZh = `我挑战 ${challenge.challengeCard.targetClaimId}，机器证据是 ${challengeItem.evidenceRefs[0]}。${challenge.challengeCard.challengedAssumption}${challenge.challengeCard.proxyMismatch}${challengeItem.challengeReasonZh}`;

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("t_0", "pistol_round", "halfBuy", 650, 800),
      roundStartAgentOutputs: [challenge]
    });

    expect(submitted[0]?.cutMode).toBe("pistol_core_window");
    expect(submitted[0]?.submittedOpinionZh).toContain("挑战假设");
    expect(submitted[0]?.submittedOpinionZh).toContain("代理错配");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("EVID:FRED");
    expect(submitted[0]?.submittedOpinionZh).not.toContain("claim_agent_phase18");
    expect(submitted[0]?.submittedChallengeCard?.challenges[0]?.evidenceRefs[0]).toContain("EVID:FRED");
  });
  it("uses a readable submitted challenge text without falling back to only the target claim id", () => {
    const financeDuel = buildTestFinanceDuel();
    const stance = buildStanceOutput("ct_0", ["FRED002"], 0.7);
    const challenge = buildChallengeOutput("t_0", "claim_ct_0_1", ["FRED002", "FRED003"]);

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: {
        teams: [],
        warnings: [],
        agents: [
          buildEconomyAgent("ct_0", "rifle_buy", "fullBuy", 1200, 5200),
          buildEconomyAgent("t_0", "half_buy", "halfBuy", 850, 3000)
        ]
      },
      roundStartAgentOutputs: [stance, challenge]
    });

    const submittedChallenge = submitted.find((output) => output.cardKind === "challenge");
    expect(submittedChallenge?.orphanedChallenge).toBeUndefined();
    expect(submittedChallenge?.submittedOpinionZh).toContain("challenge claim_ct_0_1");
    expect(submittedChallenge?.submittedOpinionZh).toContain("proxy mismatch");
    expect(submittedChallenge?.submittedOpinionZh).not.toBe("claim_ct_0_1");
    expect(submittedChallenge?.submittedOpinionZh?.length ?? 0).toBeLessThanOrEqual(submittedChallenge?.submittedBudgetChars ?? 0);
    expect(submittedChallenge?.submittedTextSpanRefs.some((span) => span.kind === "kept" && span.sourceRef === "rawOpinion:core_window")).toBe(true);
    expect(submittedChallenge?.unlocatedSubmittedItems).toEqual([]);
  });

  it("records underfilled raw opinions without padding or adding evidence", () => {
    const financeDuel = buildTestFinanceDuel();
    const rawOutput = buildStanceOutput("ct_0", ["FRED002", "FRED003"], 0.8);
    rawOutput.rawFinanceOpinionZh = "短观点，只够审计。";

    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: buildEconomyContext("ct_0", "rifle_buy", "fullBuy", 1200, 5200),
      roundStartAgentOutputs: [rawOutput]
    });

    expect(submitted[0]?.clippingTier).toBe("rifle_full");
    expect(submitted[0]?.submittedBudgetChars).toBe(416);
    expect(submitted[0]?.rawOpinionCharCount).toBe("短观点，只够审计。".length);
    expect(submitted[0]?.rawOpinionUnderTarget).toBe(true);
    expect(submitted[0]?.rawOpinionUnderfilled).toBe(true);
    expect(submitted[0]?.submittedOpinionCharCount).toBeLessThanOrEqual(submitted[0]?.rawOpinionCharCount ?? 0);
    expect(submitted[0]?.submittedOpinionZh).toBe("短观点，只够审计。");
    expect(submitted[0]?.submittedStanceCard?.coreClaims[0]?.evidenceRefs).toEqual(["FRED002", "FRED003"]);
  });

  it("marks a challenge orphaned when the target claim was clipped out of submitted stance", () => {
    const financeDuel = buildTestFinanceDuel();
    const submitted = buildSubmittedFinanceOutputs({
      financeDuel,
      economyContext: {
        teams: [],
        warnings: [],
        agents: [
          buildEconomyAgent("ct_0", "full_eco", "save", 360, 600),
          buildEconomyAgent("t_0", "rifle_buy", "fullBuy", 1200, 5200)
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
  outputBudget: number,
  spend: number
): HexRoundEconomyContext {
  return {
    teams: [],
    warnings: [],
    agents: [buildEconomyAgent(agentId, economyPosture, buyType, outputBudget, spend)]
  };
}

function buildEconomyAgent(
  agentId: string,
  economyPosture: string,
  buyType: string,
  outputBudget: number,
  spend: number
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
    tokenBankAfterSpend: Math.max(0, 10000 - spend),
    spend,
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
