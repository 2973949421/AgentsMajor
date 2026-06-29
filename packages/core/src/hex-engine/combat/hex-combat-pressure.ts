import type {
  HexCombatAdvantage,
  HexCombatContact,
  HexCombatPressureAudit,
  HexCombatResolution,
  HexCombatScoreboard,
  HexCombatVerdict
} from "./hex-combat-types.js";

export interface HexCombatPressureState {
  pressureKey: string;
  phaseIndex: number;
  lastSeenPhaseIndex: number;
  streak: number;
  accumulatedPressure: number;
  lastAdvantage: HexCombatAdvantage;
  lastVerdict: HexCombatVerdict;
  lastContactId: string;
  resetReasons: string[];
}

export type HexCombatPressureHistory = Record<string, HexCombatPressureState>;

const absentPhaseDecay = 4;
const maxAccumulatedPressure = 12;
const lethalPressureDeltaCap = 6;
const nonLethalPressureDeltaCap = 4;

export function createHexCombatPressureHistory(): HexCombatPressureHistory {
  return {};
}

export function getPrimaryPressureKey(contact: HexCombatContact): string | undefined {
  const primaryPair = [...(contact.duelPairs ?? [])]
    .filter((pair) => isGranularPressureKey(pair.pressureKey))
    .sort((left, right) => right.directnessScore - left.directnessScore || left.duelPairId.localeCompare(right.duelPairId))[0];
  if (primaryPair) {
    return primaryPair.pressureKey;
  }
  return (contact.pressureKeys ?? []).find(isGranularPressureKey);
}

export function advanceHexCombatPressureHistoryForPhase(
  history: HexCombatPressureHistory,
  contacts: readonly HexCombatContact[],
  phaseIndex: number
): HexCombatPressureHistory {
  const currentKeys = new Set(contacts.map(getPrimaryPressureKey).filter((key): key is string => Boolean(key)));
  const next: HexCombatPressureHistory = {};
  for (const state of Object.values(history)) {
    if (currentKeys.has(state.pressureKey)) {
      next[state.pressureKey] = clonePressureState(state);
      continue;
    }
    const absentPhaseCount = phaseIndex - state.lastSeenPhaseIndex;
    if (absentPhaseCount >= 2) {
      continue;
    }
    next[state.pressureKey] = {
      ...clonePressureState(state),
      phaseIndex,
      accumulatedPressure: Math.max(0, state.accumulatedPressure - absentPhaseDecay),
      resetReasons: uniqueStrings([...state.resetReasons, "n64_pressure_decay_absent_phase"])
    };
  }
  return next;
}

export function buildHexCombatPressureAudit(input: {
  contact: HexCombatContact;
  state?: HexCombatPressureState;
  advantage: HexCombatAdvantage;
}): HexCombatPressureAudit | undefined {
  const pressureKey = getPrimaryPressureKey(input.contact);
  if (!pressureKey) {
    return undefined;
  }
  const previousPressure = input.state?.accumulatedPressure ?? 0;
  const pressureDelta = scoreContactPressureDelta(input.contact);
  const currentPressure = Math.min(maxAccumulatedPressure, previousPressure + pressureDelta);
  const streak = input.state ? input.state.streak + 1 : 1;
  const lethalAllowed = Boolean(input.contact.lethalEligible) && !input.contact.coverBlockedLethal;
  const cap = lethalAllowed ? lethalPressureDeltaCap : nonLethalPressureDeltaCap;
  const escalationReasons = [
    "n64_pressure_key_audit",
    ...scoreContactPressureReasons(input.contact),
    ...(lethalAllowed ? ["n64_lethal_pressure_allowed_by_gate"] : ["n64_lethal_pressure_blocked_by_gate"]),
    ...(streak <= 1 ? ["n64_pressure_observed_first_contact_no_score_delta"] : [])
  ];
  const appliedScoreDelta = input.advantage === "contested" || streak <= 1
    ? 0
    : Math.min(cap, Math.max(0, currentPressure - 2));
  if (input.advantage === "contested") {
    escalationReasons.push("n64_pressure_not_applied_without_score_advantage");
  }
  return {
    pressureKey,
    previousPressure,
    pressureDelta,
    currentPressure,
    streak,
    appliedScoreDelta,
    decayApplied: 0,
    resetReasons: [...(input.state?.resetReasons ?? [])],
    escalationReasons: uniqueStrings(escalationReasons)
  };
}

export function applyHexCombatPressureToScoreboard(
  scoreboard: HexCombatScoreboard,
  audit: HexCombatPressureAudit | undefined,
  advantage: HexCombatAdvantage
): HexCombatScoreboard {
  if (!audit || audit.appliedScoreDelta <= 0 || advantage === "contested") {
    return cloneScoreboard(scoreboard);
  }
  const reason = `n64:pressure_delta:${audit.pressureKey}:${audit.appliedScoreDelta}`;
  if (advantage === "attack") {
    return {
      ...cloneScoreboard(scoreboard),
      attack: {
        ...scoreboard.attack,
        totalScore: roundScore(scoreboard.attack.totalScore + audit.appliedScoreDelta),
        reasons: uniqueStrings([...scoreboard.attack.reasons, reason])
      }
    };
  }
  return {
    ...cloneScoreboard(scoreboard),
    defense: {
      ...scoreboard.defense,
      totalScore: roundScore(scoreboard.defense.totalScore + audit.appliedScoreDelta),
      reasons: uniqueStrings([...scoreboard.defense.reasons, reason])
    }
  };
}

export function updateHexCombatPressureHistoryFromResolutions(
  history: HexCombatPressureHistory,
  resolutions: readonly HexCombatResolution[]
): HexCombatPressureHistory {
  const next: HexCombatPressureHistory = Object.fromEntries(
    Object.entries(history).map(([key, value]) => [key, clonePressureState(value)])
  );
  for (const resolution of resolutions) {
    const audit = resolution.audit.pressure;
    const pressureKey = audit?.pressureKey ?? resolution.pressureKeys?.find(isGranularPressureKey);
    if (!pressureKey) {
      continue;
    }
    if (resolution.casualties.length > 0) {
      delete next[pressureKey];
      continue;
    }
    const previousState = next[pressureKey];
    const forcedBack = resolution.suppressions.some((suppression) => suppression.result === "forced_back");
    const currentPressure = forcedBack
      ? Math.floor((audit?.currentPressure ?? previousState?.accumulatedPressure ?? 0) / 2)
      : audit?.currentPressure ?? previousState?.accumulatedPressure ?? 0;
    next[pressureKey] = {
      pressureKey,
      phaseIndex: resolution.phaseIndex,
      lastSeenPhaseIndex: resolution.phaseIndex,
      streak: audit?.streak ?? previousState?.streak ?? 1,
      accumulatedPressure: currentPressure,
      lastAdvantage: resolution.advantage,
      lastVerdict: resolution.verdict,
      lastContactId: resolution.contactId,
      resetReasons: uniqueStrings([
        ...(audit?.resetReasons ?? previousState?.resetReasons ?? []),
        ...(forcedBack ? ["n64_pressure_reduced_after_forced_back"] : [])
      ])
    };
  }
  return next;
}

function scoreContactPressureDelta(contact: HexCombatContact): number {
  let score = 0;
  if (contact.triggerReasons.includes("active_pressure") || contact.triggerReasons.includes("plant_pressure") || contact.triggerReasons.includes("site_contest")) score += 2;
  if (contact.openSightNoCover) score += 2;
  if (contact.samePointExposure) score += 2;
  if (contact.objectiveExposure) score += 2;
  if (contact.lineOfFireExposure) score += 1;
  if (contact.lethalEligible) score += 1;
  if ((contact.duelPairs ?? []).some((pair) => pair.directnessScore >= 55)) score += 1;
  return Math.max(1, Math.min(4, score));
}

function scoreContactPressureReasons(contact: HexCombatContact): string[] {
  return uniqueStrings([
    ...(contact.triggerReasons.includes("active_pressure") ? ["n64_active_duel_pressure"] : []),
    ...(contact.triggerReasons.includes("plant_pressure") ? ["n64_plant_pressure"] : []),
    ...(contact.triggerReasons.includes("site_contest") ? ["n64_site_contest_pressure"] : []),
    ...(contact.openSightNoCover ? ["n64_open_sight_pressure"] : []),
    ...(contact.samePointExposure ? ["n64_same_point_pressure"] : []),
    ...(contact.objectiveExposure ? ["n64_objective_exposure_pressure"] : []),
    ...(contact.lineOfFireExposure ? ["n64_line_of_fire_pressure"] : [])
  ]);
}

function isGranularPressureKey(value: string | undefined): value is string {
  return Boolean(value) && (
    value!.startsWith("duelPair:") ||
    value!.startsWith("fireLane:") ||
    value!.startsWith("objective_exposure:") ||
    value!.startsWith("cell_contact:")
  );
}

function clonePressureState(state: HexCombatPressureState): HexCombatPressureState {
  return {
    ...state,
    resetReasons: [...state.resetReasons]
  };
}

function cloneScoreboard(scoreboard: HexCombatScoreboard): HexCombatScoreboard {
  return {
    attack: {
      ...scoreboard.attack,
      reasons: [...scoreboard.attack.reasons]
    },
    defense: {
      ...scoreboard.defense,
      reasons: [...scoreboard.defense.reasons]
    },
    neutralScore: scoreboard.neutralScore
  };
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
