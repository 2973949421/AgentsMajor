import { describe, expect, it } from "vitest";

import {
  shouldAttemptJudgeRepair,
  shouldRetryStructuredJsonWithoutThinking,
  shouldUseLocalJudgeNarrativeFallback
} from "./judge-validation.js";

describe("judge validation", () => {
  it("classifies repairable judge schema and diagnostic errors", () => {
    expect(shouldAttemptJudgeRepair("Judge diagnostic is required.")).toBe(true);
    expect(shouldAttemptJudgeRepair("roundWinType invalid_enum_value")).toBe(true);
    expect(shouldAttemptJudgeRepair("provider timeout")).toBe(false);
  });

  it("classifies reasoning exhaustion as no-thinking retry and narrative fallback", () => {
    expect(shouldRetryStructuredJsonWithoutThinking("reasoning_exhausted_empty_content")).toBe(true);
    expect(shouldUseLocalJudgeNarrativeFallback("json_truncated")).toBe(true);
    expect(shouldRetryStructuredJsonWithoutThinking("schema_validation")).toBe(false);
  });
});
