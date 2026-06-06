import type { Agent, CoachPostMatchReview, CoachTimeoutCorrection } from "@agent-major/shared";

const coachTimeoutBalanceGuardrail = "平衡约束：主区优先，但至少保留一个次级区域的信息锚点或回防锚点，禁止五人全部压向同一单点。";

export function validateCoachTimeoutCorrection(input: {
  correction: CoachTimeoutCorrection;
  teamId: string;
  triggerRoundNumber: number;
  expiresAfterRoundNumber: number;
  activeAgents: Agent[];
}): CoachTimeoutCorrection {
  const activeAgentIds = new Set(input.activeAgents.map((agent) => agent.id));
  const adjustmentIds = input.correction.playerAdjustments.map(
    (adjustment: CoachTimeoutCorrection["playerAdjustments"][number]) => adjustment.agentId
  );
  const adjustmentIdSet = new Set(adjustmentIds);
  if (adjustmentIdSet.size !== adjustmentIds.length) {
    throw new Error(`Coach timeout correction returned duplicate player adjustments for ${input.teamId}`);
  }
  for (const agentId of adjustmentIds) {
    if (!activeAgentIds.has(agentId)) {
      throw new Error(`Coach timeout correction returned adjustment for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!adjustmentIdSet.has(agentId)) {
      throw new Error(`Coach timeout correction missed adjustment for active agent: ${agentId}`);
    }
  }

  const balancedCorrection = constrainCoachTimeoutCorrection(input.correction);
  return {
    ...balancedCorrection,
    teamId: input.teamId,
    triggerRoundNumber: input.triggerRoundNumber,
    expiresAfterRoundNumber: input.expiresAfterRoundNumber
  };
}

export function validateCoachPostMatchReview(input: {
  review: CoachPostMatchReview;
  teamId: string;
  matchId: string;
}): CoachPostMatchReview {
  return {
    ...input.review,
    teamId: input.teamId,
    matchId: input.matchId
  };
}

export function normalizeCoachTimeoutCorrectionPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  const normalizedRecord: Record<string, unknown> = { ...record };
  for (const field of [
    "triggerReason",
    "diagnosedFailure",
    "nextRoundObjective",
    "ownCoreToHold",
    "opponentGapToHit",
    "zonePriorityShift",
    "teamDirective"
  ] satisfies Array<keyof CoachTimeoutCorrection>) {
    const normalizedText = normalizeCoachTimeoutText(record[field]);
    if (normalizedText) {
      normalizedRecord[field] = normalizedText;
    }
  }

  const normalizedAdjustments = normalizeCoachTimeoutPlayerAdjustments(record.playerAdjustments ?? record.playerDirectives);
  if (normalizedAdjustments) {
    normalizedRecord.playerAdjustments = normalizedAdjustments;
  }

  return normalizedRecord;
}

export function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function constrainCoachTimeoutCorrection(correction: CoachTimeoutCorrection): CoachTimeoutCorrection {
  return {
    ...correction,
    nextRoundObjective: softenCoachOverfocusText(correction.nextRoundObjective),
    ownCoreToHold: softenCoachOverfocusText(correction.ownCoreToHold),
    opponentGapToHit: softenCoachOverfocusText(correction.opponentGapToHit),
    zonePriorityShift: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.zonePriorityShift)),
    teamDirective: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.teamDirective)),
    playerAdjustments: correction.playerAdjustments.map((adjustment) => ({
      ...adjustment,
      adjustment: softenCoachOverfocusText(adjustment.adjustment)
    }))
  };
}

function withCoachBalanceGuardrail(text: string): string {
  return text.includes("平衡约束") ? text : `${text} ${coachTimeoutBalanceGuardrail}`;
}

function softenCoachOverfocusText(text: string): string {
  return text
    .replace(/唯一主攻方向/g, "主要进攻方向")
    .replace(/唯一主证明通道/g, "主要证明通道")
    .replace(/唯一决定性证明通道/g, "主要决定性证明通道")
    .replace(/五名选手全部/g, "多数选手")
    .replace(/全员执行/g, "以三人核心执行")
    .replace(/全员默认/g, "主要资源默认")
    .replace(/全部回到/g, "回到")
    .replace(/不分散资源至/g, "避免过度分散资源，同时保留信息位观察")
    .replace(/不参与([^，。；;]+)任何行动/g, "不主动投入$1主战，但保留异常信息响应")
    .replace(/取消所有([^，。；;]+)call/g, "降低$1call 优先级，同时保留异常信息响应");
}

function normalizeCoachTimeoutPlayerAdjustments(
  value: unknown
): CoachTimeoutCorrection["playerAdjustments"] | undefined {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: entry
        };
      }

      const record = readUnknownRecord(entry);
      if (!record) {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: normalizeCoachTimeoutText(entry) ?? String(entry)
        };
      }

      return {
        agentId:
          readStringField(record, ["agentId", "playerId", "id", "agent"]) ?? `unknown_agent_${index + 1}`,
        adjustment:
          normalizeCoachTimeoutText(
            record.adjustment ?? record.directive ?? record.text ?? record.summary ?? record.instruction
          ) ?? "保持当前职责但收紧执行。"
      };
    });
  }

  const adjustmentsRecord = readUnknownRecord(value);
  if (!adjustmentsRecord) {
    return undefined;
  }

  return Object.entries(adjustmentsRecord).map(([agentId, adjustmentValue]) => ({
    agentId,
    adjustment: normalizeCoachTimeoutText(adjustmentValue) ?? String(adjustmentValue)
  }));
}

function normalizeCoachTimeoutText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeCoachTimeoutText(item)).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join("；") : undefined;
  }

  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const directText = readStringField(record, ["text", "summary", "directive", "adjustment", "reason", "focus"]);
  if (directText) {
    return directText;
  }

  const entries = Object.entries(record)
    .map(([key, nestedValue]) => {
      const nestedText = normalizeCoachTimeoutText(nestedValue);
      return nestedText ? `${normalizeCoachTimeoutKeyLabel(key)}：${nestedText}` : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries.join("；") : undefined;
}

function normalizeCoachTimeoutKeyLabel(key: string): string {
  switch (key) {
    case "primary":
      return "主优先";
    case "secondary":
      return "次优先";
    case "raise":
    case "increase":
      return "提高";
    case "lower":
    case "decrease":
      return "降低";
    case "deprioritize":
    case "deemphasize":
      return "降权";
    case "focus":
      return "聚焦";
    case "avoid":
      return "避免";
    case "zone":
    case "zoneId":
      return "区域";
    case "summary":
      return "摘要";
    case "text":
      return "说明";
    case "directive":
      return "指令";
    case "adjustment":
      return "调整";
    default:
      return key;
  }
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
