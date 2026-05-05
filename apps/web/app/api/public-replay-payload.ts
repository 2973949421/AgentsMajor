const privateReplayKeys = new Set(["agentOutputs", "driverModelId", "rawFingerprint"]);

export function toPublicReplayPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toPublicReplayPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !privateReplayKeys.has(key))
      .map(([key, item]) => [key, toPublicReplayPayload(item)])
  );
}
