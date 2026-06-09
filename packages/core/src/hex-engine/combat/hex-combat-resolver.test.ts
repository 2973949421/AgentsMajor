import { describe, expect, it } from "vitest";

import { buildHexCombatContacts } from "./hex-combat-contact-builder.js";
import { applyHexCombatVariance, resolveHexCombat } from "./hex-combat-resolver.js";
import {
  buildCombatAction,
  findCellsInRegion,
  initializeCombatMemory,
  loadOfficialDust2HexMap
} from "./hex-combat-test-helpers.js";

describe("Hex combat resolver", () => {
  it("lets business evidence dominate the first deterministic combat verdict", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "t_1", side: "attack", cellId: supportCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack execute applies pressure to exploit the defense response gap at A site."
      }),
      buildCombatAction({
        memory,
        agentId: "t_1",
        actionType: "prepare_trade",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack trade support coordinates the same A site pressure."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(resolution.audit.businessWeight).toBe(65);
    expect(resolution.audit.csWeight).toBe(35);
    expect(resolution.scores.attack.businessScore).toBeGreaterThan(resolution.scores.defense.businessScore);
    expect(resolution.advantage).toBe("attack");
    expect(resolution.casualties).toEqual([
      expect.objectContaining({
        agentId: "ct_0",
        result: "killed"
      })
    ]);
  });

  it("does not expose round winner, win type, economy delta, or database facts", () => {
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

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(Object.prototype.hasOwnProperty.call(resolution, "winner")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "roundWinType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "economyDelta")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "dbFact")).toBe(false);
  });

  it("does not let audited variance overturn a decisive margin", () => {
    const result = applyHexCombatVariance({
      attackScore: 92,
      defenseScore: 41,
      varianceMode: "audited",
      seed: "decisive-margin"
    });

    expect(result.audit.varianceApplied).toBe(false);
    expect(result.audit.reason).toBe("margin_too_large");
    expect(result.attackScore).toBe(92);
    expect(result.defenseScore).toBe(41);
  });

  it("applies audited variance reproducibly only for close margins", () => {
    const first = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited",
      seed: "close-margin"
    });
    const second = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited",
      seed: "close-margin"
    });

    expect(first).toEqual(second);
    expect(first.audit.varianceApplied).toBe(true);
    expect(first.audit.varianceDelta).toBeGreaterThanOrEqual(-3);
    expect(first.audit.varianceDelta).toBeLessThanOrEqual(3);
  });

  it("falls back to no variance without an explicit seed", () => {
    const result = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited"
    });

    expect(result.audit.varianceApplied).toBe(false);
    expect(result.audit.reason).toBe("missing_seed");
  });
});
