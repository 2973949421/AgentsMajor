import { describe, expect, it } from "vitest";
import {
  attackPlanSchema,
  defenseDeploymentSchema,
  economyStateSchema,
  eventSchema,
  roundReportSchema,
  sideAssignmentCreatedPayloadSchema,
  sideAssignmentSchema,
  simulationRunSchema,
  siteExecuteResolvedPayloadSchema,
  summarySchema,
  tacticalCollisionSchema,
  tacticalPlanSubmittedPayloadSchema,
  timelineEventSchema,
  tournamentSchema,
  zoneDeploymentCommittedPayloadSchema,
  agentSchema
} from "./schemas.js";

const now = "2026-05-01T00:00:00.000Z";

describe("shared contracts", () => {
  it("parses a minimal tournament", () => {
    expect(
      tournamentSchema.parse({
        id: "t_001",
        name: "Agent Major",
        status: "draft",
        format: "single_elimination_16",
        createdAt: now
      })
    ).toMatchObject({ id: "t_001" });
  });

  it("requires Agent.driverModelId", () => {
    expect(() =>
      agentSchema.parse({
        id: "agent_001",
        teamId: "team_001",
        role: "star_rifler",
        displayName: "Ghost Star",
        baseProfile: {
          personalitySummary: "Aggressive star",
          tacticalSummary: "Takes high-impact actions",
          styleTags: ["aggressive"]
        },
        currentState: "ready",
        createdAt: now
      })
    ).toThrow();
  });

  it("requires Event.payload.schemaVersion", () => {
    expect(() =>
      eventSchema.parse({
        id: "evt_001",
        type: "round_started",
        category: "simulation",
        tournamentId: "t_001",
        payload: {},
        globalSequence: 1,
        scopeType: "round",
        scopeId: "round_001",
        sequenceInScope: 1,
        createdAt: now
      })
    ).toThrow();
  });

  it("requires TimelineEvent.sourceEventIds", () => {
    expect(() =>
      timelineEventSchema.parse({
        id: "tl_001",
        tournamentId: "t_001",
        sourceEventIds: [],
        atMs: 0,
        kind: "round_intro",
        payload: {},
        playbackScope: "round",
        playbackScopeId: "round_001",
        sequenceIndex: 0,
        createdAt: now
      })
    ).toThrow();
  });

  it("requires EconomyState to be Agent-level", () => {
    expect(() =>
      economyStateSchema.parse({
        id: "eco_001",
        teamId: "team_001",
        mapGameId: "map_001",
        tokenBank: 8000,
        buyType: "halfBuy",
        lossStreak: 0,
        timeoutsRemaining: 1,
        createdAt: now
      })
    ).toThrow();
  });

  it("parses a map summary with source events", () => {
    expect(
      summarySchema.parse({
        id: "sum_map_001",
        summaryType: "map",
        scopeType: "map",
        scopeId: "map_001",
        mapGameId: "map_001",
        title: "DUST2 map summary",
        content: "Team A closed the map after overtime.",
        sourceEventIds: ["evt_map_completed"],
        createdAt: now
      })
    ).toMatchObject({ id: "sum_map_001", summaryType: "map" });
  });

  it("parses Phase 1.6 tactical contracts and event payloads", () => {
    const sideAssignment = sideAssignmentSchema.parse({
      roundId: "round_001",
      roundNumber: 1,
      attackingTeamId: "team_a",
      defendingTeamId: "team_b",
      half: "first_half",
      sideSwitched: false
    });
    const attackPlan = attackPlanSchema.parse({
      teamId: "team_a",
      primaryTargetZoneId: "conversion_site_a",
      secondaryTargetZoneId: "conversion_site_b",
      approach: "fake_then_rotate",
      feintZoneId: "conversion_site_a",
      resourceAllocationByZone: [{ zoneId: "conversion_site_b", weight: 100, activeAgentIds: ["agent_a"], intent: "attack_execute" }],
      activeAgentIds: ["agent_a"],
      intentSummary: "fake A then rotate B"
    });
    const defenseDeployment = defenseDeploymentSchema.parse({
      teamId: "team_b",
      setup: "heavy_a",
      heavyZoneId: "conversion_site_a",
      weakZoneIds: ["conversion_site_b"],
      resourceAllocationByZone: [{ zoneId: "conversion_site_a", weight: 100, activeAgentIds: ["agent_b"], intent: "defense_anchor" }],
      anchorAgentIds: ["agent_b"],
      rotatePolicy: "hold_sites",
      deploymentSummary: "heavy A"
    });
    const collision = tacticalCollisionSchema.parse({
      primaryZoneId: "conversion_site_b",
      attackApproach: "fake_then_rotate",
      defenseSetup: "heavy_a",
      result: "fake_success",
      attackScore: 72,
      defenseScore: 70,
      decisiveReason: "fake condition matched"
    });

    expect(sideAssignmentCreatedPayloadSchema.parse({ schemaVersion: 1, sideAssignment, source: "phase16_side_rule" })).toMatchObject({
      source: "phase16_side_rule"
    });
    expect(
      tacticalPlanSubmittedPayloadSchema.parse({
        schemaVersion: 1,
        visibility: "restricted",
        teamId: attackPlan.teamId,
        roundId: sideAssignment.roundId,
        publicSummary: attackPlan.intentSummary,
        attackPlanSummary: {
          primaryTargetZoneId: attackPlan.primaryTargetZoneId,
          secondaryTargetZoneId: attackPlan.secondaryTargetZoneId,
          approach: attackPlan.approach,
          feintRevealed: false
        },
        sourceEventIds: ["evt_side"]
      })
    ).toMatchObject({ visibility: "restricted" });
    expect(
      zoneDeploymentCommittedPayloadSchema.parse({
        schemaVersion: 1,
        visibility: "restricted",
        teamId: defenseDeployment.teamId,
        roundId: sideAssignment.roundId,
        publicSummary: defenseDeployment.deploymentSummary,
        defenseDeploymentSummary: {
          setup: defenseDeployment.setup,
          heavyZoneId: defenseDeployment.heavyZoneId,
          weakZoneIds: defenseDeployment.weakZoneIds,
          rotatePolicy: defenseDeployment.rotatePolicy
        },
        sourceEventIds: ["evt_side"]
      })
    ).toMatchObject({ visibility: "restricted" });
    expect(
      siteExecuteResolvedPayloadSchema.parse({
        schemaVersion: 1,
        visibility: "public_after_round",
        roundId: sideAssignment.roundId,
        collision,
        revealedAttackPlan: {
          teamId: attackPlan.teamId,
          primaryTargetZoneId: attackPlan.primaryTargetZoneId,
          secondaryTargetZoneId: attackPlan.secondaryTargetZoneId,
          approach: attackPlan.approach,
          feintRevealed: true,
          publicSummary: attackPlan.intentSummary
        },
        revealedDefenseDeployment: {
          teamId: defenseDeployment.teamId,
          setup: defenseDeployment.setup,
          heavyZoneId: defenseDeployment.heavyZoneId,
          weakZoneIds: defenseDeployment.weakZoneIds,
          rotatePolicy: defenseDeployment.rotatePolicy,
          publicSummary: defenseDeployment.deploymentSummary
        },
        sourceEventIds: ["evt_plan", "evt_deploy", "evt_judge"]
      })
    ).toMatchObject({ visibility: "public_after_round" });

    expect(() =>
      attackPlanSchema.parse({
        ...attackPlan,
        resourceAllocationByZone: [
          { zoneId: "conversion_site_a", weight: 40, activeAgentIds: ["agent_a"], intent: "attack_execute" },
          { zoneId: "buyer_mid", weight: 40, activeAgentIds: ["agent_a"], intent: "info_control" }
        ]
      })
    ).toThrow();
  });

  it("parses Hex experimental mode, events, and committed trace source", () => {
    expect(
      simulationRunSchema.parse({
        id: "run_hex_map_001",
        fixtureId: "fixture_hex_map",
        status: "running",
        requestedMode: "phase20_hex_map_experimental",
        runtimeMatchId: "match_001",
        runtimeMapGameId: "map_001",
        baselineCompletedRounds: 0,
        estimatedTotalRounds: 40,
        expectedTotalCalls: 0,
        latestCommittedRoundNumber: 0,
        hasFreshReplay: false,
        createdAt: now
      })
    ).toMatchObject({ requestedMode: "phase20_hex_map_experimental" });

    expect(
      eventSchema.parse({
        id: "evt_hex_round_started",
        type: "hex_round_experimental_started",
        category: "simulation",
        tournamentId: "t_001",
        matchId: "match_001",
        mapGameId: "map_001",
        roundId: "round_001",
        payload: { schemaVersion: 1 },
        globalSequence: 1,
        scopeType: "round",
        scopeId: "round_001",
        sequenceInScope: 1,
        createdAt: now
      })
    ).toMatchObject({ type: "hex_round_experimental_started" });

    expect(
      eventSchema.parse({
        id: "evt_hex_map_completed",
        type: "hex_map_experimental_completed",
        category: "simulation",
        tournamentId: "t_001",
        matchId: "match_001",
        mapGameId: "map_001",
        payload: { schemaVersion: 1, status: "completed" },
        globalSequence: 2,
        scopeType: "map",
        scopeId: "map_001",
        sequenceInScope: 1,
        createdAt: now
      })
    ).toMatchObject({ type: "hex_map_experimental_completed" });

    expect(
      roundReportSchema.parse({
        id: "report_hex_001",
        tournamentId: "t_001",
        matchId: "match_001",
        mapGameId: "map_001",
        roundId: "round_001",
        roundNumber: 1,
        mapName: "Dust2",
        winnerTeamId: "team_a",
        scoreBeforeRound: { teamA: 0, teamB: 0 },
        scoreAfterRound: { teamA: 1, teamB: 0 },
        judgeResult: {
          winnerTeamId: "team_a",
          loserTeamId: "team_b",
          margin: "standard",
          roundWinType: "defense_timeout_no_plant",
          reason: "Hex hard condition",
          mvpAgentId: "agent_a",
          confidence: 0.72
        },
        agentOutputs: [],
        keyEvents: [],
        economyDelta: {
          agents: [],
          teamTotals: { teamA: 0, teamB: 0 }
        },
        tokenSubmission: {
          activeAgentIds: [],
          submittedOutputIds: [],
          totalOutputBudget: 0,
          outputGate: { applied: false, reason: "Hex trace reference" }
        },
        nodeTraceArtifactId: "art_hex_trace",
        nodeTraceSource: "hex_round_engine_committed",
        summary: "Hex committed round",
        eventProjection: {
          coreEventsLinkedByRoundReport: [],
          broadcastEventsCreated: []
        },
        createdAt: now
      })
    ).toMatchObject({ nodeTraceSource: "hex_round_engine_committed" });
  });
});
