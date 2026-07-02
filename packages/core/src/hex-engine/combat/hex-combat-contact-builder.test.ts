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
    expect(contacts[0]?.duelPairs).toHaveLength(1);
    expect(contacts[0]?.fireLanes).toHaveLength(1);
    const pair = contacts[0]?.duelPairs[0];
    expect(pair).toMatchObject({ primaryAgentId: "t_0", targetAgentId: "ct_0", lethalGateStatus: "passed" });
    expect(pair?.laneId).toBe(contacts[0]?.fireLanes[0]?.laneId);
    expect(pair?.pressureKey).toBe(`duelPair:${pair?.duelPairId}`);
    expect(contacts[0]?.primaryPressureKey).toBe(contacts[0]?.pressureScope?.pressureKey);
    expect(contacts[0]?.primaryPressureKey).not.toBe(pair?.pressureKey);
    expect(contacts[0]?.pressureScope?.attributionDuelPairKey).toBe(pair?.pressureKey);
    expect(contacts[0]?.pressureKeys).toEqual(expect.arrayContaining([contacts[0]?.primaryPressureKey, pair?.pressureKey]));
    expect(contacts[0]?.primaryPressureKey).not.toMatch(/^(attack|defense|a_site|same_region)$/);
  });

  it("keeps primary pressure scope stable when the same lane changes duelists", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const firstMemory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const secondMemory = initializeCombatMemory(asset, [
      { agentId: "t_1", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const firstContacts = buildHexCombatContacts({
      asset,
      memory: firstMemory,
      actions: [
        buildCombatAction({ memory: firstMemory, agentId: "t_0", actionType: "execute_site" }),
        buildCombatAction({ memory: firstMemory, agentId: "ct_0", actionType: "peek" })
      ]
    });
    const secondContacts = buildHexCombatContacts({
      asset,
      memory: secondMemory,
      actions: [
        buildCombatAction({ memory: secondMemory, agentId: "t_1", actionType: "execute_site" }),
        buildCombatAction({ memory: secondMemory, agentId: "ct_0", actionType: "peek" })
      ]
    });

    expect(firstContacts[0]?.primaryPressureKey).toBe(secondContacts[0]?.primaryPressureKey);
    expect(firstContacts[0]?.pressureScope?.scopeKind).toBe(secondContacts[0]?.pressureScope?.scopeKind);
    expect(firstContacts[0]?.duelPairs[0]?.duelPairId).not.toBe(secondContacts[0]?.duelPairs[0]?.duelPairId);
    expect(firstContacts[0]?.pressureScope?.attributionDuelPairKey).not.toBe(secondContacts[0]?.pressureScope?.attributionDuelPairKey);
  });
  it("keeps pressureKey stable for the same pair and lane across phases", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const firstContacts = buildHexCombatContacts({
      asset,
      memory,
      actions: [
        buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site" }),
        buildCombatAction({ memory, agentId: "ct_0", actionType: "peek" })
      ]
    });
    const nextMemory = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "first_contact",
      events: []
    });
    const nextContacts = buildHexCombatContacts({
      asset,
      memory: nextMemory,
      actions: [
        buildCombatAction({ memory: nextMemory, agentId: "t_0", actionType: "execute_site" }),
        buildCombatAction({ memory: nextMemory, agentId: "ct_0", actionType: "peek" })
      ]
    });

    expect(firstContacts[0]?.contactId).not.toBe(nextContacts[0]?.contactId);
    expect(firstContacts[0]?.pressureKeys[0]).toBe(nextContacts[0]?.pressureKeys[0]);
    expect(firstContacts[0]?.duelPairs[0]?.duelPairId).toBe(nextContacts[0]?.duelPairs[0]?.duelPairId);
    expect(firstContacts[0]?.fireLanes[0]?.laneId).toBe(nextContacts[0]?.fireLanes[0]?.laneId);
    expect(firstContacts[0]?.pressureKeys[0]).not.toContain("duel_pair_0_");
    expect(nextContacts[0]?.pressureKeys[0]).not.toContain("duel_pair_1_");
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

  it("keeps only key contacts from a noisy same-region 5v5 mesh", () => {
    const asset = loadOfficialDust2HexMap();
    const cells = findCellsInRegion(asset, "mid_top_mid", 10);
    const placements = [
      ...cells.slice(0, 5).map((cell, index) => ({ agentId: `t_${index}`, side: "attack" as const, cellId: cell.cellId })),
      ...cells.slice(5, 10).map((cell, index) => ({ agentId: `ct_${index}`, side: "defense" as const, cellId: cell.cellId }))
    ];
    const memory = initializeCombatMemory(asset, placements);
    const actions = placements.map((placement) => buildCombatAction({
      memory,
      agentId: placement.agentId,
      actionType: placement.side === "attack" ? "map_control" : "watch_angle"
    }));

    const contacts = buildHexCombatContacts({ asset, memory, actions });

    expect(contacts.length).toBeLessThanOrEqual(12);
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.some((contact) => (contact.prunedCandidateCount ?? 0) > 0)).toBe(true);
    expect(contacts.every((contact) => (contact.retentionReasons ?? []).length > 0)).toBe(true);
  });

  it("adds nearby same-side support participants to key contact for assist attribution", () => {
    const asset = loadOfficialDust2HexMap();
    const [entryCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: entryCell!.cellId },
      { agentId: "t_support", side: "attack", cellId: supportCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_entry", actionType: "execute_site", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "t_support", actionType: "prepare_trade", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_anchor", actionType: "peek" })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });
    const contact = contacts.find((candidate) => candidate.attackAgentIds.includes("t_entry") && candidate.attackAgentIds.includes("t_support"));

    expect(contact).toBeDefined();
    expect(contact?.triggerReasons).toEqual(expect.arrayContaining(["support_contact", "trade_setup"]));
    expect(contact?.participants.find((participant) => participant.agentId === "t_support")?.supportParticipant).toBe(true);
    expect(contact?.duelPairs[0]?.primaryAgentId).not.toBe("t_support");
    expect(contact?.duelPairs[0]?.contributorAgentIds).toContain("t_support");
  });
  it("groups two attackers against one defender into one many_v_one contact", () => {
    const asset = loadOfficialDust2HexMap();
    const [entryCell, tradeCell, defenseCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: entryCell!.cellId },
      { agentId: "t_trade", side: "attack", cellId: tradeCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_entry", actionType: "execute_site", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "t_trade", actionType: "peek", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_anchor", actionType: "peek" })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });
    const contact = contacts.find((candidate) => candidate.attackAgentIds.includes("t_entry") && candidate.attackAgentIds.includes("t_trade") && candidate.defenseAgentIds.includes("ct_anchor"));

    expect(contact).toBeDefined();
    expect(contact?.combatShape).toBe("many_v_one");
    expect(contact?.duelPairs.length).toBeGreaterThanOrEqual(2);
    expect(contact?.primaryDuelPairId).toBe(contact?.duelPairs[0]?.duelPairId);
    expect(contact?.secondaryDuelPairIds?.length).toBeGreaterThanOrEqual(1);
    expect(contact?.surroundedSide).toBe("defense");
    expect(contact?.pressureKeys.some((key) => key.startsWith("objective_exposure:") || key.startsWith("cell_contact:") || key.startsWith("fireLane:"))).toBe(true);
  });

  it("groups one attacker against two defenders into one one_v_many contact", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, firstDefenseCell, secondDefenseCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: firstDefenseCell!.cellId },
      { agentId: "ct_rotator", side: "defense", cellId: secondDefenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_entry", actionType: "execute_site", targetCellId: firstDefenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_anchor", actionType: "peek", targetCellId: attackCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_rotator", actionType: "peek", targetCellId: attackCell!.cellId })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });
    const contact = contacts.find((candidate) => candidate.attackAgentIds.includes("t_entry") && candidate.defenseAgentIds.includes("ct_anchor") && candidate.defenseAgentIds.includes("ct_rotator"));

    expect(contact).toBeDefined();
    expect(contact?.combatShape).toBe("one_v_many");
    expect(contact?.duelPairs.length).toBeGreaterThanOrEqual(2);
    expect(contact?.surroundedSide).toBe("attack");
  });

  it("groups two attackers and two defenders into one many_v_many contact", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, tradeCell, firstDefenseCell, secondDefenseCell] = findCellsInRegion(asset, "a_site", 4);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: attackCell!.cellId },
      { agentId: "t_trade", side: "attack", cellId: tradeCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: firstDefenseCell!.cellId },
      { agentId: "ct_rotator", side: "defense", cellId: secondDefenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_entry", actionType: "execute_site", targetCellId: firstDefenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "t_trade", actionType: "peek", targetCellId: firstDefenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_anchor", actionType: "peek", targetCellId: attackCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_rotator", actionType: "peek", targetCellId: attackCell!.cellId })
    ];

    const contacts = buildHexCombatContacts({ asset, memory, actions });
    const contact = contacts.find((candidate) => candidate.attackAgentIds.includes("t_entry") && candidate.attackAgentIds.includes("t_trade") && candidate.defenseAgentIds.includes("ct_anchor") && candidate.defenseAgentIds.includes("ct_rotator"));

    expect(contact).toBeDefined();
    expect(contact?.combatShape).toBe("many_v_many");
    expect(contact?.duelPairs.length).toBeGreaterThanOrEqual(2);
    expect(contact?.secondaryDuelPairIds?.length).toBeGreaterThanOrEqual(1);
    expect(contact?.surroundedSide).toBeUndefined();
  });
});
