import type {
  BuyType,
  JudgeResult,
  SideAssignment,
  SubmittedAgentOutput,
  TacticalCollision
} from "@agent-major/shared";

export type EconomyOutputBiasSource =
  | "economy_budget_side_gap"
  | "submitted_evidence_side_gap"
  | "omitted_fields_side_gap"
  | "judge_proof_side_gap"
  | "judge_economy_score_side_gap"
  | "tactical_side_pattern";

export interface EconomyOutputDiagnosticSide {
  side: "attack" | "defense";
  teamId: string;
  buyType: BuyType;
  agentCount: number;
  outputBudgetTotal: number;
  outputBudgetAverage: number;
  submittedEvidenceCount: number;
  omittedFieldCount: number;
  proofScore?: number;
  economyAdjustedScore?: number;
  tacticalResult?: string;
  wonRound: boolean;
}

export interface EconomyOutputDiagnostic {
  roundNumber: number;
  winnerTeamId: string;
  attack: EconomyOutputDiagnosticSide;
  defense: EconomyOutputDiagnosticSide;
  deltas: {
    attackMinusDefenseBudget: number;
    attackMinusDefenseEvidence: number;
    attackMinusDefenseOmittedFields: number;
    attackMinusDefenseProofScore?: number;
    attackMinusDefenseEconomyAdjustedScore?: number;
  };
  dominantBudgetSide?: "attack" | "defense";
  dominantEvidenceSide?: "attack" | "defense";
  dominantProofSide?: "attack" | "defense";
  suspectedBiasSources: EconomyOutputBiasSource[];
}

export function buildEconomyOutputDiagnostic(input: {
  roundNumber: number;
  winnerTeamId: string;
  sideAssignment: SideAssignment;
  teamAId: string;
  teamBId: string;
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  submittedAgentOutputs: SubmittedAgentOutput[];
  judgeResult: JudgeResult;
  tacticalCollision?: TacticalCollision | undefined;
}): EconomyOutputDiagnostic {
  const attack = buildSideDiagnostic({
    side: "attack",
    teamId: input.sideAssignment.attackingTeamId,
    buyType: resolveTeamBuyType(input.sideAssignment.attackingTeamId, input),
    winnerTeamId: input.winnerTeamId,
    submittedAgentOutputs: input.submittedAgentOutputs,
    judgeResult: input.judgeResult,
    tacticalCollision: input.tacticalCollision
  });
  const defense = buildSideDiagnostic({
    side: "defense",
    teamId: input.sideAssignment.defendingTeamId,
    buyType: resolveTeamBuyType(input.sideAssignment.defendingTeamId, input),
    winnerTeamId: input.winnerTeamId,
    submittedAgentOutputs: input.submittedAgentOutputs,
    judgeResult: input.judgeResult,
    tacticalCollision: input.tacticalCollision
  });
  const budgetDelta = roundDiagnosticNumber(attack.outputBudgetTotal - defense.outputBudgetTotal);
  const evidenceDelta = attack.submittedEvidenceCount - defense.submittedEvidenceCount;
  const omittedDelta = attack.omittedFieldCount - defense.omittedFieldCount;
  const proofDelta = subtractOptional(attack.proofScore, defense.proofScore);
  const economyScoreDelta = subtractOptional(attack.economyAdjustedScore, defense.economyAdjustedScore);
  const suspectedBiasSources = new Set<EconomyOutputBiasSource>();

  if (Math.abs(budgetDelta) >= 25) {
    suspectedBiasSources.add("economy_budget_side_gap");
  }
  if (Math.abs(evidenceDelta) >= 3) {
    suspectedBiasSources.add("submitted_evidence_side_gap");
  }
  if (Math.abs(omittedDelta) >= 3) {
    suspectedBiasSources.add("omitted_fields_side_gap");
  }
  if (proofDelta !== undefined && Math.abs(proofDelta) >= 0.75) {
    suspectedBiasSources.add("judge_proof_side_gap");
  }
  if (economyScoreDelta !== undefined && Math.abs(economyScoreDelta) >= 0.75) {
    suspectedBiasSources.add("judge_economy_score_side_gap");
  }
  if (input.tacticalCollision && tacticalResultLeansSide(input.tacticalCollision.result)) {
    suspectedBiasSources.add("tactical_side_pattern");
  }
  const dominantBudgetSide = dominantSideFromDelta(budgetDelta, 25);
  const dominantEvidenceSide = dominantSideFromDelta(evidenceDelta, 3);
  const dominantProofSide = dominantSideFromDelta(proofDelta, 0.75);

  return {
    roundNumber: input.roundNumber,
    winnerTeamId: input.winnerTeamId,
    attack,
    defense,
    deltas: {
      attackMinusDefenseBudget: budgetDelta,
      attackMinusDefenseEvidence: evidenceDelta,
      attackMinusDefenseOmittedFields: omittedDelta,
      ...(proofDelta !== undefined ? { attackMinusDefenseProofScore: proofDelta } : {}),
      ...(economyScoreDelta !== undefined ? { attackMinusDefenseEconomyAdjustedScore: economyScoreDelta } : {})
    },
    ...(dominantBudgetSide ? { dominantBudgetSide } : {}),
    ...(dominantEvidenceSide ? { dominantEvidenceSide } : {}),
    ...(dominantProofSide ? { dominantProofSide } : {}),
    suspectedBiasSources: [...suspectedBiasSources]
  };
}

function buildSideDiagnostic(input: {
  side: "attack" | "defense";
  teamId: string;
  buyType: BuyType;
  winnerTeamId: string;
  submittedAgentOutputs: SubmittedAgentOutput[];
  judgeResult: JudgeResult;
  tacticalCollision?: TacticalCollision | undefined;
}): EconomyOutputDiagnosticSide {
  const outputs = input.submittedAgentOutputs.filter((output) => output.teamId === input.teamId);
  const outputBudgetTotal = outputs.reduce((sum, output) => sum + output.outputBudget, 0);
  const score = input.judgeResult.judgeScorecard?.teamScores[input.teamId];
  return {
    side: input.side,
    teamId: input.teamId,
    buyType: input.buyType,
    agentCount: outputs.length,
    outputBudgetTotal,
    outputBudgetAverage: outputs.length > 0 ? roundDiagnosticNumber(outputBudgetTotal / outputs.length) : 0,
    submittedEvidenceCount: outputs.reduce((sum, output) => sum + countSubmittedEvidenceFields(output), 0),
    omittedFieldCount: outputs.reduce((sum, output) => sum + output.omittedFields.length, 0),
    ...(score ? { proofScore: score.proofScore.score, economyAdjustedScore: score.economyAdjustedScore.score } : {}),
    ...(input.tacticalCollision ? { tacticalResult: input.tacticalCollision.result } : {}),
    wonRound: input.teamId === input.winnerTeamId
  };
}

function countSubmittedEvidenceFields(output: SubmittedAgentOutput): number {
  const detail = output.actionDetail;
  return [
    output.action,
    detail?.roundObjective,
    detail?.executionPlan,
    detail?.coordinationPlan,
    detail?.roleResponsibilityUsage,
    detail?.riskRead,
    detail?.contingencyPlan,
    detail?.expectedContribution,
    output.gateSummary
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function resolveTeamBuyType(
  teamId: string,
  input: {
    teamAId: string;
    teamBId: string;
    teamABuyType: BuyType;
    teamBBuyType: BuyType;
  }
): BuyType {
  if (teamId === input.teamAId) {
    return input.teamABuyType;
  }
  if (teamId === input.teamBId) {
    return input.teamBBuyType;
  }
  return input.teamABuyType;
}

function subtractOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  return roundDiagnosticNumber(left - right);
}

function dominantSideFromDelta(delta: number | undefined, threshold: number): "attack" | "defense" | undefined {
  if (delta === undefined || Math.abs(delta) < threshold) {
    return undefined;
  }
  return delta > 0 ? "attack" : "defense";
}

function tacticalResultLeansSide(result: TacticalCollision["result"]): "attack" | "defense" | undefined {
  switch (result) {
    case "attack_breakthrough":
    case "fake_success":
    case "economy_steal":
      return "attack";
    case "defense_hold":
    case "rotate_success":
      return "defense";
    default:
      return undefined;
  }
}

function roundDiagnosticNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
