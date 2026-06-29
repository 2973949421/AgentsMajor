import { describe, expect, it } from "vitest";

import {
  advanceHexCombatPressureHistoryForPhase,
  buildHexCombatPressureAudit,
  createHexCombatPressureHistory,
  getPrimaryPressureKey,
  updateHexCombatPressureHistoryFromResolutions
} from "./hex-combat-pressure.js";
import type { HexCombatContact, HexCombatPressureAudit, HexCombatResolution } from "./hex-combat-types.js";

const baseContact: HexCombatContact = {
  contactId: "contact_1",
  phaseId: "first_contact",
  phaseIndex: 1,
  participants: [],
  attackAgentIds: ["t_0"],
  defenseAgentIds: ["ct_0"],
  triggerReasons: ["active_pressure"],
  regionIds: ["a_long"],
  pointIds: ["long_doors"],
  duelPairs: [
    {
      duelPairId: "duel_pair_1_t_0_ct_0",
      primaryAgentId: "t_0",
      targetAgentId: "ct_0",
      side: "attack",
      laneId: "lane_1",
      pressureKey: "duelPair:duel_pair_1_t_0_ct_0",
      directnessScore: 72,
      lethalGateStatus: "passed",
      reasons: ["active_pressure"],
      contributorAgentIds: []
    }
  ],
  fireLanes: [
    {
      laneId: "lane_1",
      contactId: "contact_1",
      attackAgentId: "t_0",
      defenseAgentId: "ct_0",
      regionIds: ["a_long"],
      pointIds: ["long_doors"],
      exposureFlags: ["open_sight_no_cover"]
    }
  ],
  pressureScope: {
    pressureKey: "fireLane:lane_1",
    scopeKind: "fire_lane",
    laneScope: "lane_1",
    attributionDuelPairKey: "duelPair:duel_pair_1_t_0_ct_0",
    reasons: ["n64b_pressure_scope_fire_lane"]
  },
  primaryPressureKey: "fireLane:lane_1",
  pressureKeys: ["fireLane:lane_1", "duelPair:duel_pair_1_t_0_ct_0"],
  lethalEligible: true,
  openSightNoCover: true,
  lineOfFireExposure: true
};

describe("Hex combat pressure", () => {
  it("builds pressure only from granular N65-lite keys", () => {
    expect(getPrimaryPressureKey(baseContact)).toBe("fireLane:lane_1");
    const { pressureScope: _pressureScope, primaryPressureKey: _primaryPressureKey, ...legacyContact } = baseContact;
    expect(getPrimaryPressureKey({ ...legacyContact, duelPairs: [], pressureKeys: ["attack"] })).toBeUndefined();
  });

  it("records first contact without applying score delta, then applies pressure on a streak", () => {
    const firstAudit = buildHexCombatPressureAudit({ contact: baseContact, advantage: "attack" });
    expect(firstAudit?.streak).toBe(1);
    expect(firstAudit?.appliedScoreDelta).toBe(0);

    const secondAudit = buildHexCombatPressureAudit({
      contact: { ...baseContact, phaseIndex: 2 },
      advantage: "attack",
      state: {
        pressureKey: "fireLane:lane_1",
        phaseIndex: 1,
        lastSeenPhaseIndex: 1,
        streak: 1,
        accumulatedPressure: firstAudit?.currentPressure ?? 0,
        lastAdvantage: "attack",
        lastVerdict: "contested_suppression",
        lastContactId: "contact_1",
        resetReasons: []
      }
    });
    expect(secondAudit?.streak).toBe(2);
    expect(secondAudit?.appliedScoreDelta).toBeGreaterThan(0);
  });

  it("applies contested pressure when a repeated scope has a deterministic score side", () => {
    const audit = buildHexCombatPressureAudit({
      contact: baseContact,
      advantage: "contested",
      verdict: "contested_suppression",
      scoreboard: buildScoreboard(50.5, 50),
      state: {
        pressureKey: "fireLane:lane_1",
        phaseIndex: 1,
        lastSeenPhaseIndex: 1,
        streak: 1,
        accumulatedPressure: 4,
        lastAdvantage: "contested",
        lastVerdict: "contested_suppression",
        lastContactId: "contact_1",
        resetReasons: []
      }
    });

    expect(audit?.streak).toBe(2);
    expect(audit?.pressureAppliedToSide).toBe("attack");
    expect(audit?.appliedScoreDelta).toBeGreaterThan(0);
    expect(audit?.escalationReasons).toContain("n64_contested_pressure_tiebreak_applied");
    expect(audit?.notAppliedReasons).toEqual([]);
  });

  it("does not apply contested pressure when scores are exactly tied", () => {
    const audit = buildHexCombatPressureAudit({
      contact: baseContact,
      advantage: "contested",
      verdict: "contested_suppression",
      scoreboard: buildScoreboard(50, 50),
      state: {
        pressureKey: "fireLane:lane_1",
        phaseIndex: 1,
        lastSeenPhaseIndex: 1,
        streak: 1,
        accumulatedPressure: 4,
        lastAdvantage: "contested",
        lastVerdict: "contested_suppression",
        lastContactId: "contact_1",
        resetReasons: []
      }
    });

    expect(audit?.pressureAppliedToSide).toBeUndefined();
    expect(audit?.appliedScoreDelta).toBe(0);
    expect(audit?.notAppliedReasons).toContain("n64_pressure_not_applied_without_deterministic_side");
  });
  it("decays absent keys for one phase and removes them after two phases", () => {
    const history = createHexCombatPressureHistory();
    history["fireLane:lane_1"] = {
      pressureKey: "fireLane:lane_1",
      phaseIndex: 1,
      lastSeenPhaseIndex: 1,
      streak: 2,
      accumulatedPressure: 8,
      lastAdvantage: "attack",
      lastVerdict: "contested_suppression",
      lastContactId: "contact_1",
      resetReasons: []
    };

    const decayed = advanceHexCombatPressureHistoryForPhase(history, [], 2);
    expect(decayed["fireLane:lane_1"]?.accumulatedPressure).toBe(4);
    expect(decayed["fireLane:lane_1"]?.resetReasons).toContain("n64_pressure_decay_absent_phase");

    const cleared = advanceHexCombatPressureHistoryForPhase(decayed, [], 3);
    expect(cleared["fireLane:lane_1"]).toBeUndefined();
  });

  it("updates history from deduped resolutions and clears it on casualty", () => {
    const pressure: HexCombatPressureAudit = {
      pressureKey: "fireLane:lane_1",
      previousPressure: 4,
      pressureDelta: 3,
      currentPressure: 7,
      streak: 2,
      appliedScoreDelta: 4,
      decayApplied: 0,
      resetReasons: [],
      escalationReasons: []
    };
    const stored = updateHexCombatPressureHistoryFromResolutions(createHexCombatPressureHistory(), [
      buildResolution({ pressure, verdict: "contested_suppression" })
    ]);
    expect(stored[pressure.pressureKey]?.accumulatedPressure).toBe(7);

    const cleared = updateHexCombatPressureHistoryFromResolutions(stored, [
      buildResolution({ pressure, verdict: "kill", casualty: true })
    ]);
    expect(cleared[pressure.pressureKey]).toBeUndefined();
  });
});

function buildScoreboard(attackTotal: number, defenseTotal: number) {
  return {
    attack: {
      businessScore: 0,
      csScore: attackTotal,
      totalScore: attackTotal,
      reasons: []
    },
    defense: {
      businessScore: 0,
      csScore: defenseTotal,
      totalScore: defenseTotal,
      reasons: []
    },
    neutralScore: 100 - Math.abs(attackTotal - defenseTotal)
  };
}
function buildResolution(input: { pressure: HexCombatPressureAudit; verdict: "kill" | "wound_or_forced_back" | "contested_suppression"; casualty?: boolean }): HexCombatResolution {
  return {
    contactId: "contact_1",
    phaseId: "first_contact",
    phaseIndex: 1,
    pressureKeys: [input.pressure.pressureKey],
    advantage: "attack",
    verdict: input.verdict,
    casualties: input.casualty ? [{ agentId: "ct_0" }] : [],
    suppressions: [],
    audit: { pressure: input.pressure }
  } as unknown as HexCombatResolution;
}
