import { describe, expect, it } from "vitest";

import { buildHexCombatContacts } from "./hex-combat-contact-builder.js";
import { materializeHexCombatMemoryEvents } from "./hex-combat-events.js";
import { resolveHexCombat } from "./hex-combat-resolver.js";
import type { HexCombatResolutionCore } from "./hex-combat-types.js";
import {
  buildCombatAction,
  findCellsInRegion,
  initializeCombatMemory,
  loadOfficialDust2HexMap
} from "./hex-combat-test-helpers.js";

describe("Hex combat memory events", () => {
  it("materializes kill, enemy spotted, and action result events", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack execute applies pressure to exploit the defense gap."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        valid: false,
        businessIntent: ""
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(resolution.memoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "enemy_spotted",
          observerAgentId: "t_0",
          enemyAgentId: "ct_0",
          source: "combat_contact"
        }),
        expect.objectContaining({
          type: "life_status_changed",
          agentId: "ct_0",
          lifeStatus: "dead"
        }),
        expect.objectContaining({
          type: "action_result",
          agentId: "ct_0",
          status: "failed"
        })
      ])
    );
  });

  it("materializes wounded combat casualties without creating round facts", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "b_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site" }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "peek" })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const core: HexCombatResolutionCore = {
      contactId: contact.contactId,
      phaseId: contact.phaseId,
      phaseIndex: contact.phaseIndex,
      participants: contact.participants,
      scores: {
        attack: {
          businessScore: 35,
          csScore: 25,
          totalScore: 60,
          reasons: ["attack:test"]
        },
        defense: {
          businessScore: 30,
          csScore: 22,
          totalScore: 52,
          reasons: ["defense:test"]
        },
        neutralScore: 92
      },
      advantage: "attack",
      verdict: "wound_or_forced_back",
      casualties: [
        {
          agentId: "ct_0",
          teamId: "ct",
          side: "defense",
          result: "wounded",
          reason: "combat_pressure_margin"
        }
      ],
      suppressions: [],
      regionControlHint: "attack",
      audit: {
        businessWeight: 65,
        csWeight: 35,
        triggerReasons: [...contact.triggerReasons],
        variance: {
          mode: "off",
          varianceApplied: false,
          reason: "variance_off",
          beforeAttackScore: 60,
          beforeDefenseScore: 52,
          afterAttackScore: 60,
          afterDefenseScore: 52,
          varianceDelta: 0
        },
        economy: {
          economyEvidenceApplied: false,
          attack: {
            agentIds: ["t_0"],
            resourceTiers: [],
            utilityTiers: [],
            outputBudgetTotal: 0,
            outputBudgetAverage: 0,
            dropReceivedTotal: 0,
            scoreDelta: 0,
            reasons: []
          },
          defense: {
            agentIds: ["ct_0"],
            resourceTiers: [],
            utilityTiers: [],
            outputBudgetTotal: 0,
            outputBudgetAverage: 0,
            dropReceivedTotal: 0,
            scoreDelta: 0,
            reasons: []
          },
          reasons: []
        }
      }
    };

    const events = materializeHexCombatMemoryEvents(core);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "life_status_changed",
          agentId: "ct_0",
          lifeStatus: "wounded"
        })
      ])
    );
    expect(
      events.some((event) =>
        Object.prototype.hasOwnProperty.call(event, "winner")
        || Object.prototype.hasOwnProperty.call(event, "roundWinType")
        || Object.prototype.hasOwnProperty.call(event, "economyDelta")
      )
    ).toBe(false);
  });
});
