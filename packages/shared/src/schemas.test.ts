import { describe, expect, it } from "vitest";
import {
  actionPointBudgetSchema,
  agentPhaseActionSchema,
  attackPlanSchema,
  defenseDeploymentSchema,
  economyStateSchema,
  eventSchema,
  localNodeVerdictSchema,
  mapNodeGraphSchema,
  roundReportSchema,
  roundNodeStateSnapshotSchema,
  roundPhaseIdSchema,
  sideAssignmentCreatedPayloadSchema,
  sideAssignmentSchema,
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

  it("parses node-round graph contracts", () => {
    const graph = mapNodeGraphSchema.parse({
      asset_id: "map_test_node_graph_v1",
      map_slug: "test_map",
      display_name: "Test Map",
      phase_scope: "phase_2_0_pre",
      purpose: "Test node graph contract.",
      graph_model: {
        node_semantics: "nodes hold state",
        edge_semantics: "edges connect nodes",
        activation_rule: "activate local nodes"
      },
      timing_model: {
        unit: "abstract_phase_step",
        principle: "phase reachability is explicit",
        round_phases: [
          { id: "default_opening", display_name: "默认展开", phase_index: 1, meaning: "opening" },
          { id: "first_contact", display_name: "第一接触", phase_index: 2, meaning: "contact" },
          { id: "mid_round_decision", display_name: "中盘决策", phase_index: 3, meaning: "decision" },
          { id: "execute_or_retake", display_name: "进点 / 回防", phase_index: 4, meaning: "execute" },
          { id: "post_plant_or_clutch", display_name: "守包 / 残局", phase_index: 5, meaning: "clutch" }
        ],
        edge_cost_by_type: {
          local: 0.25,
          site: 0.35,
          route: 0.75,
          transition: 0.9,
          retake: 0.9,
          choke: 1,
          contact: 1,
          risky_route: 0.8,
          risky_contact: 1
        },
        hard_constraints: ["T cannot start in the plant node."],
        side_reachability_by_phase: {
          attack: {
            default_opening: ["t_spawn"],
            first_contact: ["mid"],
            mid_round_decision: ["mid"],
            execute_or_retake: ["a_default"],
            post_plant_or_clutch: ["a_default"]
          },
          defense: {
            default_opening: ["a_default"],
            first_contact: ["mid"],
            mid_round_decision: ["mid"],
            execute_or_retake: ["t_spawn"],
            post_plant_or_clutch: ["t_spawn"]
          }
        },
        route_timing_notes: [
          {
            route_id: "route_a",
            attack_first_contact_nodes: ["mid"],
            attack_site_entry_not_before: "execute_or_retake",
            defense_default_anchor_nodes: ["a_default"],
            note: "T reaches site later than CT."
          }
        ]
      },
      nodes: [
        {
          id: "t_spawn",
          display_name: "T Spawn",
          area: "spawn",
          kind: "spawn",
          parent_zone_id: "spawn_a",
          business_semantics: "opening allocation"
        },
        {
          id: "mid",
          display_name: "Mid",
          area: "mid",
          kind: "lane",
          parent_zone_id: "buyer_mid",
          business_semantics: "information contest"
        },
        {
          id: "a_default",
          display_name: "A Default",
          area: "a_site",
          kind: "plant",
          parent_zone_id: "conversion_site_a",
          business_semantics: "conversion landing"
        }
      ],
      edges: [
        { from: "t_spawn", to: "mid", type: "route", label: "spawn to mid" },
        { from: "mid", to: "a_default", type: "site", label: "mid to site" }
      ],
      primary_routes: [
        {
          id: "route_a",
          display_name: "A route",
          nodes: ["t_spawn", "mid", "a_default"],
          business_semantics: "convert through mid"
        }
      ],
      site_groups: {
        conversion_site_a: ["a_default"]
      }
    });

    expect(graph.nodes).toHaveLength(3);
    expect(() => roundPhaseIdSchema.parse("unknown_phase")).toThrow();
  });

  it("parses node-round runtime snapshots and actions", () => {
    expect(
      actionPointBudgetSchema.parse({
        agentId: "agent_001",
        phaseId: "first_contact",
        baseAp: 3,
        spentAp: 4,
        remainingAp: -1,
        isOverBudget: true
      })
    ).toMatchObject({ isOverBudget: true });

    expect(
      agentPhaseActionSchema.parse({
        agentId: "agent_001",
        teamId: "team_001",
        side: "attack",
        phaseId: "first_contact",
        currentNodeId: "top_mid",
        targetNodeId: "mid",
        actionType: "seek_duel",
        apCost: 1,
        businessIntent: "用中路信息验证 buyer 定义是否成立。",
        riskAssessment: "may expose timing",
        expectedResult: "mid information becomes contested"
      })
    ).toMatchObject({ targetNodeId: "mid" });

    expect(() =>
      agentPhaseActionSchema.parse({
        agentId: "agent_001",
        teamId: "team_001",
        side: "attack",
        phaseId: "first_contact",
        currentNodeId: "top_mid",
        actionType: "seek_duel",
        apCost: 1,
        riskAssessment: "may expose timing",
        expectedResult: "mid information becomes contested"
      })
    ).toThrow();

    expect(
      localNodeVerdictSchema.parse({
        phaseId: "first_contact",
        nodeId: "mid",
        summary: "双方都拿到信息，但没有形成最终胜负。",
        controlAfter: "contested",
        informationAdvantage: "even",
        engagementOccurred: true,
        casualties: [],
        businessPlanValidated: ["buyer 定义战仍然开放"],
        triggersWinConditionCheck: false
      })
    ).toMatchObject({ controlAfter: "contested" });

    expect(
      roundNodeStateSnapshotSchema.parse({
        roundId: "round_001",
        phaseId: "first_contact",
        activeNodeIds: ["mid"],
        nodeStates: [
          {
            nodeId: "mid",
            phaseId: "first_contact",
            attackAgentIds: ["agent_001"],
            defenseAgentIds: ["agent_006"],
            control: "contested",
            businessIntent: "buyer definition under test"
          }
        ],
        actionPointBudgets: [
          {
            agentId: "agent_001",
            phaseId: "first_contact",
            baseAp: 3,
            spentAp: 1,
            remainingAp: 2,
            isOverBudget: false
          }
        ]
      })
    ).toMatchObject({ roundId: "round_001" });
  });
});
