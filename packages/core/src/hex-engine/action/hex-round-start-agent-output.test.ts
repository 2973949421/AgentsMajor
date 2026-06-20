import { describe, expect, it } from "vitest";

import {
  buildClaimCatalogFromStanceCard,
  collectRoundStartAllowedPhaseRefIds,
  isUsableRoundStartAgentOutput,
  normalizeHexRoundStartAgentOutputDraft,
  type HexRoundStartAgentOutputForAction
} from "./hex-round-start-agent-output.js";

const decisionQuestionZh = "未来 1-3 个月 A 股有色相对沪深300是否应超配？";

describe("Hex round-start agent output", () => {
  it("normalizes a valid stanceCard with whitelisted evidence refs", () => {
    const normalized = normalizeHexRoundStartAgentOutputDraft({
      cardKind: "stance",
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
});
