import { describe, expect, it } from "vitest";

import {
  buildClaimCatalogFromStanceCard,
  collectRoundStartAllowedPhaseRefIds,
  isUsableRoundStartAgentOutput,
  normalizeHexRoundStartAgentOutputDraft,
  runHexRoundStartAgentOutputHarness,
  type HexRoundStartAgentOutputForAction
} from "./hex-round-start-agent-output.js";

const decisionQuestionZh = "未来 1-3 个月 A 股有色相对沪深300是否应超配？";

describe("Hex round-start agent output", () => {
  it("normalizes a valid stanceCard with whitelisted evidence refs", () => {
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "stance",
      rawFinanceOpinionZh: "????????????????FRED_COPPER ????????????????????????????????????",
      stanceCard: {
        cardId: "stance_ct_0",
        agentId: "ct_0",
        teamSide: "defense",
        decisionQuestionZh,
        direction: "structural",
        target: "铜暴露有色资产",
        horizon: "1-3 months",
        confidence: 0.62,
        positionSuggestion: "中等仓位结构性超配。",
        coreClaims: [{
          claimId: "claim_ct_0_1",
          claimType: "commodity_price_signal",
          claimZh: "铜价动量偏强，支持铜暴露资产相对占优。",
          evidenceRefs: ["FRED_COPPER"],
          reasoningBridge: "价格动量只能支持商品线索，不能直接证明所有有色公司盈利改善。",
          confidence: 0.62,
          unsupportedIfEvidenceRejected: true
        }],
        riskBoundaries: ["库存和国内需求证据不足时需要降权。"],
        invalidatingConditions: ["铜价动量回落或公司池相对收益转弱。"],
        auditSummaryZh: "ct_0 给出结构性立场，证据绑定到 FRED_COPPER。"
      }
    }, {
      allowedEvidenceRefs: ["FRED_COPPER", "FRED_ALUMINUM"],
      allowedStance: ["bullish", "bearish", "neutral", "structural", "conditional_bullish", "conditional_bearish", "no_trade"],
      expectedCardKind: "stance",
      agentId: "ct_0",
      teamSide: "defense",
      decisionQuestionZh
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.draft?.cardKind).toBe("stance");
    expect(normalized.draft?.stanceCard?.coreClaims[0]?.claimId).toBe("claim_ct_0_1");
    expect(normalized.draft?.allowedPhaseRefs.claimIds).toEqual(["claim_ct_0_1"]);
  });

  it("rejects stanceCard evidence refs outside the system input card whitelist", () => {
    const invalid = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "stance",
      stanceCard: {
        cardId: "stance_ct_0",
        agentId: "ct_0",
        teamSide: "defense",
        decisionQuestionZh,
        direction: "structural",
        target: "全有色板块",
        horizon: "1-3 months",
        confidence: 0.7,
        positionSuggestion: "高仓位超配。",
        coreClaims: [{
          claimId: "claim_ct_0_1",
          claimType: "commodity_price_signal",
          claimZh: "用不存在证据证明全有色强超配。",
          evidenceRefs: ["MADE_UP_FACT"],
          reasoningBridge: "不存在的证据不应通过校验。",
          confidence: 0.7,
          unsupportedIfEvidenceRejected: true
        }],
        riskBoundaries: ["忽略证据边界。"],
        invalidatingConditions: ["无。"],
        auditSummaryZh: "非法证据引用。"
      }
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"],
      allowedStance: ["structural"],
      expectedCardKind: "stance",
      agentId: "ct_0",
      teamSide: "defense",
      decisionQuestionZh
    });

    expect(invalid.draft).toBeUndefined();
    expect(invalid.errors).toContain("round_start:rejected_invalid_round_start_evidence_ref:MADE_UP_FACT");
  });

  it("normalizes challengeCard only when targetClaimId exists in the stance claim catalog", () => {
    const claimCatalog = [{
      claimId: "claim_ct_0_1",
      claimType: "commodity_price_signal",
      claimZh: "铜价动量偏强，支持铜暴露资产相对占优。",
      stanceAgentId: "ct_0",
      evidenceRefs: ["FRED_COPPER"],
      reasoningBridge: "价格动量是商品线索，不是全行业盈利确认。"
    }];
    const valid = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "challenge",
      rawFinanceOpinionZh: "?????????? claim_ct_0_1?FRED_COPPER ????????????????????????????????",
      challengeCard: {
        cardId: "challenge_t_0",
        agentId: "t_0",
        teamSide: "attack",
        targetClaimId: "claim_ct_0_1",
        challengeType: "proxy_mismatch",
        challengedAssumption: "铜价上涨可以直接推出全有色超配。",
        evidenceRefs: ["FRED_COPPER"],
        proxyMismatch: "铜价动量最多支持铜子方向，不能直接支持全行业权益超配。",
        confidenceReduction: 0.2,
        challenges: [{
          challengeId: "challenge_t_0_1",
          targetClaimId: "claim_ct_0_1",
          challengeType: "proxy_mismatch",
          evidenceRefs: ["FRED_COPPER"],
          challengeReasonZh: "代理事实与全行业权益结论之间的推理桥不足。",
          expectedEffect: "降低置信度并限制战斗投影强度。"
        }],
        auditSummaryZh: "t_0 挑战 claim_ct_0_1 的代理错配。"
      }
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"],
      expectedCardKind: "challenge",
      agentId: "t_0",
      teamSide: "attack",
      decisionQuestionZh,
      claimCatalog
    });
    const invalid = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "challenge",
      challengeCard: {
        cardId: "challenge_t_1",
        agentId: "t_1",
        teamSide: "attack",
        targetClaimId: "claim_not_exists",
        challengeType: "evidence_gap",
        challengedAssumption: "泛泛数据不足。",
        evidenceRefs: ["FRED_COPPER"],
        proxyMismatch: "未绑定真实 claim。",
        confidenceReduction: 0.2,
        challenges: [{
          challengeId: "challenge_t_1_1",
          targetClaimId: "claim_not_exists",
          challengeType: "evidence_gap",
          evidenceRefs: ["FRED_COPPER"],
          challengeReasonZh: "没有真实目标 claim。",
          expectedEffect: "应拒绝。"
        }],
        auditSummaryZh: "非法 targetClaimId。"
      }
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"],
      expectedCardKind: "challenge",
      agentId: "t_1",
      teamSide: "attack",
      decisionQuestionZh,
      claimCatalog
    });

    expect(valid.errors).toEqual([]);
    expect(valid.draft?.allowedPhaseRefs.challengeIds).toEqual(["challenge_t_0_1"]);
    expect(invalid.draft).toBeUndefined();
    expect(invalid.errors.some((error) => error.startsWith("round_start:invalid_targetClaimId"))).toBe(true);
  });

  it("allows challenge cards to cite evidence from the visible target claim catalog", () => {
    const claimCatalog = [{
      claimId: "claim_ct_0_1",
      claimType: "commodity_price_signal",
      claimZh: "铝和镍价格动量偏强，支持有限多头。",
      stanceAgentId: "ct_0",
      evidenceRefs: ["FRED_ALUMINUM", "FRED_NICKEL"],
      reasoningBridge: "价格动量只能支持商品层面的有限判断。"
    }];
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "challenge",
      rawFinanceOpinionZh: "我挑战 claim_ct_0_1：对方引用 FRED_ALUMINUM 和 FRED_NICKEL 只能证明商品价格动量，不能直接推出 A 股有色超配。",
      challengeCard: {
        cardId: "challenge_t_catalog_ref",
        agentId: "t_catalog_ref",
        teamSide: "attack",
        targetClaimId: "claim_ct_0_1",
        challengeType: "proxy_mismatch",
        challengedAssumption: "商品价格动量可以直接推出 A 股有色超配。",
        evidenceRefs: ["FRED_ALUMINUM", "FRED_NICKEL"],
        proxyMismatch: "目标 claim 自己的 FRED 证据只能支持商品价格动量，不能直接支持权益配置。",
        confidenceReduction: 0.2,
        challenges: [{
          challengeId: "challenge_t_catalog_ref_1",
          targetClaimId: "claim_ct_0_1",
          challengeType: "proxy_mismatch",
          evidenceRefs: ["FRED_ALUMINUM", "FRED_NICKEL"],
          challengeReasonZh: "引用目标 claim 已公开证据指出代理错配。",
          expectedEffect: "降低置信度并限制金融投影强度。"
        }],
        auditSummaryZh: "挑战目标 claim 的代理错配。"
      }
    }, {
      allowedEvidenceRefs: ["BAOSTOCK_EQUITY"],
      expectedCardKind: "challenge",
      agentId: "t_catalog_ref",
      teamSide: "attack",
      decisionQuestionZh,
      claimCatalog
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.draft?.challengeCard?.evidenceRefs).toEqual(["FRED_ALUMINUM", "FRED_NICKEL"]);
  });
  it("marks only successful structured fixture or llm response outputs as usable for phase action", () => {
    const baseOutput: HexRoundStartAgentOutputForAction = {
      outputId: "round_start_ct_0",
      agentId: "ct_0",
      usableForPhaseAction: true,
      openingStatementZh: "结构化立场卡摘要。",
      evidenceRefs: ["FRED_COPPER"],
      riskBoundaryZh: "证据边界清楚。",
      buyConstraintAppliedZh: "买型允许承担主任务。",
      phaseActionCarryoverZh: "后续短句引用 claim。",
      source: "llm_response_artifact",
      cardKind: "stance",
      allowedPhaseRefs: {
        claimIds: ["claim_ct_0_1"],
        challengeIds: []
      }
    };

    expect(isUsableRoundStartAgentOutput(baseOutput)).toBe(true);
    expect(collectRoundStartAllowedPhaseRefIds(baseOutput)).toEqual(["claim_ct_0_1"]);
    expect(isUsableRoundStartAgentOutput({
      ...baseOutput,
      usableForPhaseAction: false,
      source: "provider_error"
    })).toBe(false);
    expect(isUsableRoundStartAgentOutput({
      ...baseOutput,
      cardKind: undefined,
      allowedPhaseRefs: undefined
    })).toBe(false);
  });

  it("builds a challenge claim catalog only from normalized stanceCard claims", () => {
    const catalog = buildClaimCatalogFromStanceCard({
      cardId: "stance_ct_0",
      agentId: "ct_0",
      teamSide: "defense",
      decisionQuestionZh,
      direction: "structural",
      target: "铜暴露有色资产",
      horizon: "1-3 months",
      confidence: 0.62,
      positionSuggestion: "中等仓位结构性超配。",
      coreClaims: [{
        claimId: "claim_ct_0_1",
        claimType: "commodity_price_signal",
        claimZh: "铜价动量偏强。",
        evidenceRefs: ["FRED_COPPER"],
        reasoningBridge: "价格动量支持商品线索。",
        confidence: 0.62,
        unsupportedIfEvidenceRejected: true
      }],
      riskBoundaries: ["库存缺口降权。"],
      invalidatingConditions: ["价格动量转弱。"],
      auditSummaryZh: "结构化立场卡。"
    });

    expect(catalog).toEqual([{
      claimId: "claim_ct_0_1",
      claimType: "commodity_price_signal",
      claimZh: "铜价动量偏强。",
      stanceAgentId: "ct_0",
      evidenceRefs: ["FRED_COPPER"],
      reasoningBridge: "价格动量支持商品线索。"
    }]);
  });

  it("repairs safe real-provider stance aliases without inventing evidence", () => {
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "stance",
      rawOpinionZh: "??????????????????????????????????????????????????",
      stanceCard: {
        cardId: "stance_ct_alias",
        agentId: "ct_alias",
        teamSide: "defense",
        stance: "structural",
        timeWindow: "1-3个月",
        confidenceScore: 55,
        positionBoundary: "只做结构性小仓位，等待库存证据确认。",
        coreClaims: [{
          claimId: "claim_ct_alias_1",
          claimType: "commodity_price_signal",
          claimText: "铜价和铝价动量支持有限结构性配置。",
          evidenceRefs: ["FRED_COPPER", "FRED_ALUMINUM"],
          reasoningBridge: "价格动量只能支持商品线索，不能直接证明全行业盈利。",
          confidenceScore: 55,
          unsupportedIfEvidenceRejected: true
        }],
        riskRewardBoundary: "缺库存与供给证据时只能降权。",
        triggerConditions: ["商品动量转弱", "公司池相对收益转弱"]
      },
      cardSummaryZh: "结构性有限立场，证据不足时降权。"
    }, {
      allowedEvidenceRefs: ["FRED_COPPER", "FRED_ALUMINUM"],
      allowedStance: ["structural"],
      expectedCardKind: "stance",
      agentId: "ct_alias",
      teamSide: "defense",
      decisionQuestionZh
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.draft?.stanceCard?.direction).toBe("structural");
    expect(normalized.draft?.stanceCard?.confidence).toBe(0.55);
    expect(normalized.draft?.stanceCard?.coreClaims[0]?.claimZh).toBe("铜价和铝价动量支持有限结构性配置。");
    expect(normalized.repairedFields).toContain("repaired_stance_direction_from_stance");
    expect(normalized.repairedFields).toContain("repaired_claimZh:claim_ct_alias_1_from_claimText");
  });

  it("keeps rejecting aliased stance claims that do not cite evidence", () => {
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "stance",
      stanceCard: {
        cardId: "stance_ct_bad",
        agentId: "ct_bad",
        teamSide: "defense",
        stance: "structural",
        target: "有色配置",
        timeWindow: "1-3个月",
        positionBoundary: "小仓位。",
        coreClaims: [{
          claimId: "claim_ct_bad_1",
          claimType: "missing_evidence_policy",
          claimText: "如果缺少库存证据就降权。",
          reasoningBridge: "这是风险边界，不是正向证据。",
          confidenceScore: 50,
          unsupportedIfEvidenceRejected: true
        }],
        riskRewardBoundary: "缺库存证据时降权。",
        triggerConditions: ["库存证据缺失"]
      },
      cardSummaryZh: "缺证据的 claim 不应通过。"
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"],
      allowedStance: ["structural"],
      expectedCardKind: "stance",
      agentId: "ct_bad",
      teamSide: "defense",
      decisionQuestionZh
    });

    expect(normalized.draft).toBeUndefined();
    expect(normalized.errors).toContain("round_start:missing_claimEvidenceRefs:claim_ct_bad_1");
  });

  it("repairs safe real-provider challenge aliases into one concrete challenge", () => {
    const claimCatalog = [{
      claimId: "claim_ct_0_1",
      claimType: "commodity_price_signal",
      claimZh: "铜价动量偏强，支持铜暴露资产相对占优。",
      stanceAgentId: "ct_0",
      evidenceRefs: ["FRED_COPPER"],
      reasoningBridge: "价格动量是商品线索，不是全行业盈利确认。"
    }];
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "challenge",
      financeOpinionZh: "?????????????????????? FRED_COPPER ???????????????????????",
      challengeCard: {
        cardId: "challenge_t_alias",
        agentId: "t_alias",
        teamSide: "attack",
        targetClaimId: "claim_ct_0_1",
        challengeType: "proxy_mismatch",
        observedEvidence: ["FRED_COPPER"],
        inference: "对方把铜价动量外推为全行业超配。",
        disconfirmingSignal: "该证据最多支持铜子方向，不能直接支持全有色。",
        confidenceReduction: 20,
        positionBoundary: "限制为压制或降权，不能直接形成金融胜利。"
      },
      cardSummaryZh: "挑战一个真实 claim 的代理错配。"
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"],
      expectedCardKind: "challenge",
      agentId: "t_alias",
      teamSide: "attack",
      decisionQuestionZh,
      claimCatalog
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.draft?.challengeCard?.confidenceReduction).toBe(0.2);
    expect(normalized.draft?.challengeCard?.challenges[0]?.targetClaimId).toBe("claim_ct_0_1");
    expect(normalized.repairedFields).toContain("repaired_challenge_evidenceRefs_from_observedEvidence");
    expect(normalized.repairedFields).toContain("repaired_challenges_from_top_level");
  });

  it("skips challenge provider calls when stance side produces no valid claim catalog", async () => {
    let providerCalls = 0;
    const brief = (agentId: string, teamSide: "attack" | "defense") => ({
      briefId: `opening_1_${agentId}`,
      agentId,
      displayName: agentId,
      teamId: teamSide,
      teamSide,
      role: "测试角色",
      financeRole: "test",
      financeRoleCn: "测试",
      evidenceRefs: ["FRED_COPPER"],
      roundTaskZh: "测试任务",
      proofOrChallengeZh: "测试证明或挑战",
      evidenceBoundaryZh: "只能使用白名单证据。",
      buyConstraintZh: "小仓位。",
      actionHintZh: "局内只引用 claim。"
    });
    const outputs = await runHexRoundStartAgentOutputHarness({
      roundId: "round_test_no_claim_catalog",
      roundOpeningBrief: {
        schemaVersion: 1,
        source: "hex_round_opening_brief",
        roundNumber: 1,
        topicTitle: "测试 round",
        decisionQuestionZh,
        allowedStance: ["structural"],
        challengePolicyZh: "挑战必须绑定 claim。",
        requiredEvidenceSchema: [],
        defenseSummaryZh: "立场方",
        attackSummaryZh: "挑战方",
        evidenceBoundaryZh: "只能使用白名单证据。",
        agentEvidenceSlices: [],
        agentBriefs: [brief("ct_invalid", "defense"), brief("t_skipped", "attack")]
      },
      providerMode: "real",
      modelId: "test_model",
      provider: (request) => {
        providerCalls += 1;
        expect(request.cardKind).toBe("stance");
        return {
          providerMode: "real",
          modelId: "test_model",
          rawDraft: {
            cardKind: "stance",
            rawFinanceOpinionZh: "??????????? BAD_FACT?????????",
            stanceCard: {
              cardId: "stance_ct_invalid",
              agentId: "ct_invalid",
              teamSide: "defense",
              direction: "structural",
              target: "有色配置",
              horizon: "1-3个月",
              confidence: 0.5,
              positionSuggestion: "小仓位。",
              coreClaims: [{
                claimId: "claim_ct_invalid_1",
                claimType: "commodity_price_signal",
                claimZh: "引用非法证据的 claim。",
                evidenceRefs: ["BAD_FACT"],
                reasoningBridge: "非法证据不能通过。",
                confidence: 0.5,
                unsupportedIfEvidenceRejected: true
              }],
              riskBoundaries: ["非法证据。"],
              invalidatingConditions: ["非法证据。"],
              auditSummaryZh: "应失败。"
            },
            cardSummaryZh: "应失败。"
          }
        };
      }
    });

    expect(providerCalls).toBe(1);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.source).toBe("invalid_response");
    expect(outputs[1]?.source).toBe("invalid_response");
    expect(outputs[1]?.technicalRefs.errors).toContain("round_start:no_valid_claim_catalog");
  });
});
