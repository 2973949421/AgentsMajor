import type { JudgeRoundWinType } from "@agent-major/shared";
import type { HexRoundMemory, HexSide } from "../state/index.js";
import type { HexCombatResolution } from "../combat/index.js";

export type HexRoundWinType =
  | "attack_elimination"
  | "defense_elimination"
  | "bomb_exploded"
  | "defuse"
  | "timeout_no_plant";

export interface HexWinConditionResult {
  isRoundOver: boolean;
  winnerSide?: HexSide;
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: HexRoundWinType;
  judgeRoundWinType?: JudgeRoundWinType;
  reason: string;
  evidence: string[];
  phaseId: HexRoundMemory["phaseId"];
  phaseIndex: number;
}

export interface MaterializeHexWinConditionInput {
  memory: HexRoundMemory;
  phaseId: HexRoundMemory["phaseId"];
  phaseIndex: number;
  combatResolutions?: HexCombatResolution[];
  maxPhaseIndex: number;
  attackTeamId: string;
  defenseTeamId: string;
}

export function materializeHexWinCondition(input: MaterializeHexWinConditionInput): HexWinConditionResult {
  const attackAlive = input.memory.agents.filter((agent) => agent.side === "attack" && agent.lifeStatus !== "dead");
  const defenseAlive = input.memory.agents.filter((agent) => agent.side === "defense" && agent.lifeStatus !== "dead");
  const combatEvidence = (input.combatResolutions ?? []).map((resolution) => resolution.contactId);

  if (attackAlive.length === 0 && defenseAlive.length > 0) {
    return roundOver(input, {
      winnerSide: "defense",
      roundWinType: "defense_elimination",
      judgeRoundWinType: "defense_elimination",
      reason: "Hex hard condition: all attack agents are dead.",
      evidence: [`attackAlive=0`, `defenseAlive=${defenseAlive.length}`, ...combatEvidence]
    });
  }

  if (defenseAlive.length === 0 && attackAlive.length > 0) {
    return roundOver(input, {
      winnerSide: "attack",
      roundWinType: "attack_elimination",
      judgeRoundWinType: "attack_elimination",
      reason: "Hex hard condition: all defense agents are dead.",
      evidence: [`attackAlive=${attackAlive.length}`, `defenseAlive=0`, ...combatEvidence]
    });
  }

  if (input.memory.bombState.defused) {
    return roundOver(input, {
      winnerSide: "defense",
      roundWinType: "defuse",
      judgeRoundWinType: "defense_defuse",
      reason: "Hex hard condition: C4 was defused by defense.",
      evidence: [
        `planted=${input.memory.bombState.planted}`,
        `plantedCellId=${input.memory.bombState.plantedCellId ?? "unknown"}`,
        ...combatEvidence
      ]
    });
  }

  if (input.phaseIndex >= input.maxPhaseIndex) {
    if (input.memory.bombState.planted) {
      return roundOver(input, {
        winnerSide: "attack",
        roundWinType: "bomb_exploded",
        judgeRoundWinType: "attack_bomb_explosion",
        reason: "Hex hard condition: final phase ended with planted C4 not defused.",
        evidence: [`plantedCellId=${input.memory.bombState.plantedCellId ?? "unknown"}`, ...combatEvidence]
      });
    }

    return roundOver(input, {
      winnerSide: "defense",
      roundWinType: "timeout_no_plant",
      judgeRoundWinType: "defense_timeout_no_plant",
      reason: "Hex hard condition: final phase ended without a planted C4.",
      evidence: [`phaseIndex=${input.phaseIndex}`, `maxPhaseIndex=${input.maxPhaseIndex}`, ...combatEvidence]
    });
  }

  return {
    isRoundOver: false,
    reason: "No Hex hard win condition reached in this phase.",
    evidence: [`attackAlive=${attackAlive.length}`, `defenseAlive=${defenseAlive.length}`, ...combatEvidence],
    phaseId: input.phaseId,
    phaseIndex: input.phaseIndex
  };
}

function roundOver(
  input: MaterializeHexWinConditionInput,
  result: {
    winnerSide: HexSide;
    roundWinType: HexRoundWinType;
    judgeRoundWinType: JudgeRoundWinType;
    reason: string;
    evidence: string[];
  }
): HexWinConditionResult {
  const winnerTeamId = result.winnerSide === "attack" ? input.attackTeamId : input.defenseTeamId;
  const loserTeamId = result.winnerSide === "attack" ? input.defenseTeamId : input.attackTeamId;
  return {
    isRoundOver: true,
    winnerSide: result.winnerSide,
    winnerTeamId,
    loserTeamId,
    roundWinType: result.roundWinType,
    judgeRoundWinType: result.judgeRoundWinType,
    reason: result.reason,
    evidence: result.evidence,
    phaseId: input.phaseId,
    phaseIndex: input.phaseIndex
  };
}
