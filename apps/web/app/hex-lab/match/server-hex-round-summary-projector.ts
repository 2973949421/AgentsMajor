export function buildRoundQualityWarning(input: {
  roundQualityStatus?: string | undefined;
  roundQualitySummaryZh?: string | undefined;
}): string | undefined {
  if (!input.roundQualityStatus || input.roundQualityStatus === "valid") return undefined;
  return `${input.roundQualitySummaryZh ?? "? round ????????"} ???????????????????`;
}
