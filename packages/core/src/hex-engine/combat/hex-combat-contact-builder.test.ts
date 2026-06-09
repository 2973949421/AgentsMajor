import { describe, expect, it } from "vitest";

import { advanceHexPhaseMemory } from "../state/index.js";
import { buildHexCombatContacts } from "./hex-combat-contact-builder.js";
import {
  buildCombatAction,
  findCellsInRegion,
  findCellsWithSharedPoint,
  initializeCombatMemory,
  loadOfficialDust2HexMap
} from "./hex-combat-test-helpers.js";

describe("Hex combat contact builder", () => {
  it("does not create contact for distant passive agents in different regions", () => {
    const asset = loadOfficialDust2HexMap();
    const tCell = findCellsInRegion(asset, "t_spawn", 1)[0]!;
    const ctCell = findCellsInRegion(asset, "ct_spawn", 1)[0]!;
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: tCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: ctCell.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0" }),
      buildCombatAction({ memory, agentId: "ct_0" })
    ];

    expect(buildHexCombatContacts({ asset, memory, actions })).toEqual([]);
  });

  it("creates contact for alive attack and defense agents in the same region", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site" }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "peek" })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.triggerReasons).toEqual(expect.arrayContaining(["same_region", "active_pressure"]));
    expect(contacts[0]?.attackAgentIds).toEqual(["t_0"]);
    expect(contacts[0]?.defenseAgentIds).toEqual(["ct_0"]);
  });

  it("creates contact for shared point overlap", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsWithSharedPoint(asset);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "map_control" }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "watch_angle" })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });

    expect(contacts[0]?.triggerReasons).toContain("shared_point");
  });

  it("does not let lastSeen alone create deterministic contact", () => {
    const asset = loadOfficialDust2HexMap();
    const tCell = findCellsInRegion(asset, "t_spawn", 1)[0]!;
    const ctCell = findCellsInRegion(asset, "ct_spawn", 1)[0]!;
    const initialMemory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: tCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: ctCell.cellId }
    ]);
    const spotted = advanceHexPhaseMemory({
      asset,
      previousMemory: initialMemory,
      nextPhaseId: "first_contact",
      events: [
        {
          type: "enemy_spotted",
          observerAgentId: "t_0",
          enemyAgentId: "ct_0",
          enemyTeamId: "ct",
          enemyCellId: ctCell.cellId,
          source: "spotted_event"
        }
      ]
    });
    const demoted = advanceHexPhaseMemory({
      asset,
      previousMemory: spotted,
      nextPhaseId: "mid_round_decision",
      events: []
    });
    const actions = [
      buildCombatAction({ memory: demoted, agentId: "t_0" }),
      buildCombatAction({ memory: demoted, agentId: "ct_0" })
    ];

    expect(demoted.agents.find((agent) => agent.agentId === "t_0")?.lastSeenEnemies).toHaveLength(1);
    expect(buildHexCombatContacts({ asset, memory: demoted, actions })).toEqual([]);
  });

  it("excludes dead agents from contact", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "b_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    memory.agents = memory.agents.map((agent) => (agent.agentId === "ct_0" ? { ...agent, lifeStatus: "dead" as const, apRemaining: 0 } : agent));
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site" }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "peek", valid: false })
    ];

    expect(buildHexCombatContacts({ asset, memory, actions })).toEqual([]);
  });
});
