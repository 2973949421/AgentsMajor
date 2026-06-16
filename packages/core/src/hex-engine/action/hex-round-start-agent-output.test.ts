import { describe, expect, it } from "vitest";

import {
  isUsableRoundStartAgentOutput,
  normalizeHexRoundStartAgentOutputDraft,
  type HexRoundStartAgentOutputForAction
} from "./hex-round-start-agent-output.js";

describe("Hex round-start agent output", () => {
  it("accepts only evidence refs from the system input card whitelist", () => {
    const valid = normalizeHexRoundStartAgentOutputDraft({
      openingStatementZh: "本局根据铜价上行和有限证据边界形成谨慎配置观点，后续只短句引用该判断。",
      evidenceRefs: ["FRED_COPPER"],
      riskBoundaryZh: "全球价格代理不能直接证明中国国内供需。",
      buyConstraintAppliedZh: "fullBuy 允许承担主论证，但不能越过证据缺口。",
      phaseActionCarryoverZh: "后续 phase 只引用铜价代理和风险边界，不重写完整观点。"
    }, {
      allowedEvidenceRefs: ["FRED_COPPER", "FRED_ALUMINUM"]
    });
    const invalid = normalizeHexRoundStartAgentOutputDraft({
      openingStatementZh: "本局根据不存在的证据形成强配置观点。",
      evidenceRefs: ["MADE_UP_FACT"],
      riskBoundaryZh: "忽略证据边界。",
      buyConstraintAppliedZh: "fullBuy 承担主论证。",
      phaseActionCarryoverZh: "后续引用该观点。"
    }, {
      allowedEvidenceRefs: ["FRED_COPPER"]
    });

    expect(valid.errors).toEqual([]);
    expect(valid.draft?.evidenceRefs).toEqual(["FRED_COPPER"]);
    expect(invalid.draft).toBeUndefined();
    expect(invalid.errors).toContain("round_start:rejected_invalid_round_start_evidence_ref:MADE_UP_FACT");
  });

  it("marks only successful fixture or llm response outputs as usable for phase action", () => {
    const baseOutput: HexRoundStartAgentOutputForAction = {
      outputId: "round_start_t_0",
      agentId: "t_0",
      usableForPhaseAction: true,
      openingStatementZh: "本局根据有效证据形成有限判断。",
      evidenceRefs: ["FRED_COPPER"],
      riskBoundaryZh: "证据边界清楚。",
      buyConstraintAppliedZh: "买型允许承担主任务。",
      phaseActionCarryoverZh: "后续短句引用。",
      source: "llm_response_artifact"
    };

    expect(isUsableRoundStartAgentOutput(baseOutput)).toBe(true);
    expect(isUsableRoundStartAgentOutput({
      ...baseOutput,
      usableForPhaseAction: false,
      source: "provider_error"
    })).toBe(false);
    expect(isUsableRoundStartAgentOutput({
      ...baseOutput,
      usableForPhaseAction: false,
      source: "invalid_response"
    })).toBe(false);
  });
});
