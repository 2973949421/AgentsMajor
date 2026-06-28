import { roundReportSchema, type Agent, type MapGame, type Match, type Round, type RoundReport, type Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { outputBudgetForEconomyPosture, type TeamEconomyPlan } from "../../economy/economy-rules.js";
import { buildFixtureHexRoundBusinessDuel } from "../business/index.js";
import { buildHexRoundFinanceDuel } from "../finance/index.js";
import type { HexRoundTrace } from "../round/index.js";
import { buildHexRoundReport } from "./hex-round-report-bridge.js";

describe("Hex round report bridge", () => {
  it("builds a legacy-compatible RoundReport from a Hex trace reference", () => {
    const createdAt = "2026-05-01T00:00:00.000Z";
    const teamA = team("team_a", "Falcon", createdAt);
    const teamB = team("team_b", "Vitallmty", createdAt);
    const agentA = agent("agent_a", teamA.id, "entry", createdAt);
    const agentB = agent("agent_b", teamB.id, "support", createdAt);
    const trace = minimalTrace(agentA, teamA.id, teamB.id);
    const report = buildHexRoundReport({
      id: "report_round_hex_1",
      match: match(teamA.id, teamB.id, createdAt),
      mapGame: mapGame(createdAt),
      round: round(createdAt),
      roundNumber: 1,
      teamA,
      teamB,
      scoreBeforeRound: { teamA: 0, teamB: 0 },
      scoreAfterRound: { teamA: 1, teamB: 0 },
      winnerTeamId: teamA.id,
      loserTeamId: teamB.id,
      roundWinType: "attack_elimination",
      finalWinCondition: trace.finalWinCondition,
      winnerAgents: [agentA],
      activeAgents: [agentA, agentB],
      economyDelta: emptyEconomyDelta(),
      teamEconomyPlans: {
        [teamA.id]: economyPlan(teamA.id, "attack", agentA.id),
        [teamB.id]: economyPlan(teamB.id, "defense", agentB.id)
      },
      hexTraceArtifactId: "artifact_hex_trace_1",
      createdAt,
      eventIds: [
        "evt_round_hex_1_hex_started",
        "evt_round_hex_1_hex_trace_artifact",
        "evt_round_hex_1_hex_committed",
        "evt_round_hex_1_round_report_created",
        "evt_round_hex_1_round_completed"
      ],
      hexTrace: trace
    });

    expect(report.nodeTraceSource).toBe("hex_round_engine_committed");
    expect(report.nodeTraceArtifactId).toBe("artifact_hex_trace_1");
    expect(report.judgeResult.winnerTeamId).toBe(teamA.id);
    expect(report.judgeResult.reason).toBe(trace.finalWinCondition.reason);
    expect(report.agentOutputs).toHaveLength(2);
    expect(report.tokenSubmission.outputGate.applied).toBe(true);
    expect(report.tokenSubmission.submittedOutputs).toHaveLength(2);
    expect(report.tokenSubmission.submittedOutputIds).toEqual(report.agentOutputs.map((output) => output.id));
    expect(report.agentOutputs[0]?.id).toMatch(/^sub_hex_output_/);
    expect(report.tokenSubmission.submittedOutputs?.[0]?.rawOutputId).toBe("hex_output_round_hex_1_agent_a");
    const firstOutput = report.agentOutputs[0];
    expect(firstOutput).toBeDefined();
    expect(firstOutput!.actionDetail).toBeDefined();
    expect(firstOutput!.actionDetail!.riskRead).toBe("No Hex action risk note.");
    expect(roundReportSchema.parse(report)).toEqual(report);
    expect(report.keyEvents[0]?.actorAgentId).toBe(agentA.id);
    expect(report.eventProjection.coreEventsLinkedByRoundReport.map((event) => event.type)).toEqual([
      "hex_round_experimental_started",
      "hex_round_trace_artifact_created",
      "hex_round_experimental_committed",
      "round_report_created",
      "round_completed"
    ]);
  });

  it("clips Hex raw action output through the economy Output Gate before judge-facing report output", () => {
    const createdAt = "2026-05-01T00:00:00.000Z";
    const teamA = team("team_a", "Falcon", createdAt);
    const teamB = team("team_b", "Vitallmty", createdAt);
    const agentA = agent("agent_a", teamA.id, "entry", createdAt);
    const agentB = agent("agent_b", teamB.id, "support", createdAt);
    const trace = minimalTrace(agentA, teamA.id, teamB.id);
    const report = buildHexRoundReport({
      id: "report_round_hex_eco",
      match: match(teamA.id, teamB.id, createdAt),
      mapGame: mapGame(createdAt),
      round: round(createdAt),
      roundNumber: 1,
      teamA,
      teamB,
      scoreBeforeRound: { teamA: 0, teamB: 0 },
      scoreAfterRound: { teamA: 1, teamB: 0 },
      winnerTeamId: teamA.id,
      loserTeamId: teamB.id,
      roundWinType: "attack_elimination",
      finalWinCondition: trace.finalWinCondition,
      winnerAgents: [agentA],
      activeAgents: [agentA, agentB],
      economyDelta: emptyEconomyDelta(),
      teamEconomyPlans: {
        [teamA.id]: economyPlan(teamA.id, "attack", agentA.id, "full_eco"),
        [teamB.id]: economyPlan(teamB.id, "defense", agentB.id, "full_eco")
      },
      hexTraceArtifactId: "artifact_hex_trace_eco",
      createdAt,
      eventIds: [
        "evt_round_hex_eco_hex_started",
        "evt_round_hex_eco_hex_trace_artifact",
        "evt_round_hex_eco_hex_committed",
        "evt_round_hex_eco_round_report_created",
        "evt_round_hex_eco_round_completed"
      ],
      hexTrace: trace
    });

    const submitted = report.tokenSubmission.submittedOutputs?.[0];
    expect(submitted).toBeDefined();
    expect(submitted!.outputBudget).toBe(360);
    expect(submitted!.omittedFields).toEqual(["riskRead", "contingencyPlan", "expectedContribution"]);
    expect(report.agentOutputs[0]?.id).toBe(submitted!.id);
    expect(report.agentOutputs[0]?.actionDetail?.riskRead).not.toBe("No Hex action risk note.");
    expect(report.agentOutputs[0]?.actionDetail?.contingencyPlan).not.toBe("Fallback to validated Hex trace state.");
    expect(report.tokenSubmission.outputGate.reason).toContain("SubmittedOutput");
    expect(roundReportSchema.parse(report)).toEqual(report);
  });
});

function team(id: string, displayName: string, createdAt: string): Team {
  return {
    id,
    tournamentId: "tournament_hex",
    displayName,
    shortName: displayName.slice(0, 3).toUpperCase(),
    seed: id === "team_a" ? 1 : 2,
    createdAt
  };
}

function match(teamAId: string, teamBId: string, createdAt: string): Match {
  return {
    id: "match_hex",
    tournamentId: "tournament_hex",
    roundName: "final",
    teamAId,
    teamBId,
    status: "running",
    bestOf: 3,
    teamAMapsWon: 0,
    teamBMapsWon: 0,
    scheduledOrder: 1,
    createdAt,
    startedAt: createdAt
  };
}

function mapGame(createdAt: string): MapGame {
  return {
    id: "map_dust2",
    matchId: "match_hex",
    mapName: "Dust2",
    order: 1,
    status: "running",
    runControlState: "idle",
    teamAScore: 0,
    teamBScore: 0,
    currentRoundNumber: 0,
    createdAt,
    startedAt: createdAt
  };
}

function round(createdAt: string): Round {
  return {
    id: "round_hex_1",
    mapGameId: "map_dust2",
    roundNumber: 1,
    status: "completed",
    phase: "committing",
    teamAActiveAgentIds: ["agent_a"],
    teamBActiveAgentIds: ["agent_b"],
    winnerTeamId: "team_a",
    roundReportId: "report_round_hex_1",
    startedAt: createdAt,
    completedAt: createdAt
  };
}

function agent(id: string, teamId: string, role: string, createdAt: string): Agent {
  return {
    id,
    teamId,
    driverModelId: "driver_hex",
    role,
    displayName: id,
    baseProfile: {
      personalitySummary: `${id} profile`,
      tacticalSummary: `${id} follows Hex constraints`,
      styleTags: ["hex"]
    },
    currentState: "ready",
    createdAt
  } as Agent;
}

function economyPlan(
  teamId: string,
  side: "attack" | "defense",
  agentId: string,
  posture: TeamEconomyPlan["posture"] = "pistol_round"
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "pistol_round",
    lossCount: 1,
    posture,
    postureReason: "test",
    summaryBuyType: "eco",
    totalCash: 800,
    dropDecisions: [],
    decisions: [
      {
        agentId,
        teamId,
        tokenBankBefore: 800,
        tokenBankAfterDrop: 800,
        buyType: "eco",
        economyPosture: posture,
        loadoutPackage: posture === "full_eco" ? "pistol_eco_pack" : "pistol_round_pack",
        spend: posture === "full_eco" ? 0 : 650,
        outputBudget: outputBudgetForEconomyPosture(posture),
        dropSent: 0,
        dropReceived: 0,
        notes: []
      }
    ]
  };
}

function emptyEconomyDelta(): RoundReport["economyDelta"] {
  return {
    agents: [],
    teamTotals: { teamA: 0, teamB: 0 },
    teamNetDelta: { teamA: 0, teamB: 0 },
    teamLossCounts: { teamA: 0, teamB: 1 },
    teamEconomyPostures: { teamA: "pistol_round", teamB: "pistol_round" }
  };
}

function minimalTrace(agentA: Agent, attackTeamId: string, defenseTeamId: string): HexRoundTrace {
  return {
    schemaVersion: 1,
    source: "hex_round_engine_trace",
    roundId: "round_hex_1",
    roundNumber: 1,
    mapSlug: "dust2",
    attackTeamId,
    defenseTeamId,
    businessDuel: buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId,
      defenseTeamId,
      agents: [
        { agentId: agentA.id, teamId: agentA.teamId, side: "attack" }
      ]
    }),
    financeDuel: buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId,
      defenseTeamId,
      agents: [
        { agentId: agentA.id, teamId: agentA.teamId, side: "attack", role: agentA.role }
      ]
    }),
    economyContext: { teams: [], agents: [], warnings: [] },
    roundStartAgentOutputs: [],
    submittedFinanceOutputs: [],
    phases: [
      {
        phaseId: "first_contact",
        phaseIndex: 1,
        memoryBefore: {} as HexRoundTrace["phases"][number]["memoryBefore"],
        commandResult: {
          actions: [
            {
              agentId: agentA.id,
              teamId: agentA.teamId,
              side: "attack",
              phaseId: "first_contact",
              currentCellId: "h_1_1_l0",
              targetCellId: "h_1_2_l0",
              actionType: "seek_duel",
              apCost: 0.1,
              pathCellIds: ["h_1_1_l0", "h_1_2_l0"],
              verticalLinkIds: [],
              pathSource: "pathfinding",
              businessIntent: "Test business pressure through first contact.",
              riskNotes: [],
              confidence: 0.8,
              valid: true,
              validationErrors: []
            }
          ],
          acceptedActions: [],
          fallbackActions: [],
          rejectedDrafts: [],
          audits: [],
          totalCallsAttempted: 1,
          fallbackCount: 0
        },
        combatContacts: [],
        combatResolutions: [],
        memoryEvents: [],
        memoryAfter: {} as HexRoundTrace["phases"][number]["memoryAfter"],
        winCondition: {
          isRoundOver: true,
          winnerSide: "attack",
          winnerTeamId: attackTeamId,
          loserTeamId: defenseTeamId,
          roundWinType: "attack_elimination",
          judgeRoundWinType: "attack_elimination",
          reason: "Hex hard condition: all defense agents are dead.",
          evidence: ["defenseAlive=0"],
          phaseId: "first_contact",
          phaseIndex: 1
        }
      }
    ],
    finalWinCondition: {
      isRoundOver: true,
      winnerSide: "attack",
      winnerTeamId: attackTeamId,
      loserTeamId: defenseTeamId,
      roundWinType: "attack_elimination",
      judgeRoundWinType: "attack_elimination",
      reason: "Hex hard condition: all defense agents are dead.",
      evidence: ["defenseAlive=0"],
      phaseId: "first_contact",
      phaseIndex: 1
    },
    audit: {
      providerMode: "fixture",
      modelId: "fixture_hex_agent_command",
      totalLlmCallsAttempted: 1,
      fallbackCount: 0,
      roundStartLlmCallsAttempted: 0,
      combatResolutionCount: 0,
      rejectedEventCount: 0,
      roundStrategySeed: "fixture_round_1_seed",
      strategyVariant: "a_short_split / site_anchor",
      roundQualityStatus: "valid",
      roundQualityReasons: [],
      roundQualitySummaryZh: "Round quality gate passed.",
      roundQualityCounts: {
        usableRoundStartCount: 10,
        usableStanceCount: 5,
        usableChallengeCount: 5,
        roundStartProviderErrorCount: 0,
        roundStartInvalidCount: 0,
        rawActionFallbackCount: 0,
        totalActionFallbackCount: 0,
        benignSkippedFallbackCount: 0,
        maxPhaseFallbackCount: 0,
        consecutiveDegradedPhaseCount: 0,
        phaseActionProviderErrorCount: 0
      },
      c4ContinuityAudit: {
        c4CarrierKilledCount: 0,
        c4DroppedCount: 0,
        c4PickupCount: 0,
        c4PlantInterruptedCount: 0,
        c4DroppedUnrecoveredAtFinal: false,
        c4ContinuityReasons: []
      },
      tacticalAudit: {
        selectedVariant: "a_short_split / site_anchor",
        selectedAttackVariant: "a_short_split",
        selectedDefenseVariant: "site_anchor",
        c4SitePreference: "a",
        selectionReasons: [],
        previousRoundSignals: [],
        antiRepeatPenalties: [],
        antiRepeatRegions: [],
        antiRepeatPoints: [],
        economyAdjustment: [],
        routeDiversityWarnings: [],
        attackFocusRegions: [],
        defenseFocusRegions: [],
        attackAvoidRegions: [],
        defenseAvoidRegions: [],
        roleRouteAssignments: []
      }
    }
  };
}
