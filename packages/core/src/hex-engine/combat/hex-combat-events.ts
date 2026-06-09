import type { HexPhaseMemoryEvent } from "../state/index.js";
import type { HexCombatParticipant, HexCombatResolutionCore } from "./hex-combat-types.js";

export function materializeHexCombatMemoryEvents(resolution: HexCombatResolutionCore): HexPhaseMemoryEvent[] {
  return [
    ...buildEnemySpottedEvents(resolution.participants),
    ...resolution.casualties.map(
      (casualty): HexPhaseMemoryEvent => ({
        type: "life_status_changed",
        agentId: casualty.agentId,
        lifeStatus: casualty.result === "killed" ? "dead" : "wounded"
      })
    ),
    ...buildActionResultEvents(resolution)
  ];
}

function buildEnemySpottedEvents(participants: HexCombatParticipant[]): HexPhaseMemoryEvent[] {
  const events: HexPhaseMemoryEvent[] = [];
  for (const observer of participants) {
    for (const enemy of participants) {
      if (observer.side === enemy.side) {
        continue;
      }
      events.push({
        type: "enemy_spotted",
        observerAgentId: observer.agentId,
        enemyAgentId: enemy.agentId,
        enemyTeamId: enemy.teamId,
        enemyCellId: enemy.currentCellId,
        source: "combat_contact"
      });
    }
  }
  return events;
}

function buildActionResultEvents(resolution: HexCombatResolutionCore): HexPhaseMemoryEvent[] {
  return resolution.participants.map((participant): HexPhaseMemoryEvent => {
    const casualty = resolution.casualties.find((candidate) => candidate.agentId === participant.agentId);
    const suppression = resolution.suppressions.find((candidate) => candidate.agentId === participant.agentId);
    if (casualty) {
      return {
        type: "action_result",
        agentId: participant.agentId,
        status: casualty.result === "killed" ? "failed" : "partial",
        summary: `Hex combat ${resolution.contactId} marked ${participant.agentId} as ${casualty.result}: ${casualty.reason}.`,
        businessExecutionSummary: resolution.audit.triggerReasons.join(",")
      };
    }
    if (suppression) {
      return {
        type: "action_result",
        agentId: participant.agentId,
        status: "partial",
        summary: `Hex combat ${resolution.contactId} produced ${suppression.result} for ${participant.agentId}: ${suppression.reason}.`,
        businessExecutionSummary: resolution.audit.triggerReasons.join(",")
      };
    }
    return {
      type: "action_result",
      agentId: participant.agentId,
      status: resolution.advantage === "contested" ? "partial" : "success",
      summary: `Hex combat ${resolution.contactId} resolved as ${resolution.verdict} with ${resolution.advantage} advantage.`,
      businessExecutionSummary: resolution.audit.triggerReasons.join(",")
    };
  });
}
