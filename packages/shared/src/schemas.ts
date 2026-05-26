import { z } from "zod";
import {
  agentRoles,
  agentRoleTags,
  agentStates,
  attackApproaches,
  buyTypes,
  defenseSetups,
  eventCategories,
  eventScopeTypes,
  eventTypes,
  mapGameStatuses,
  matchRoundNames,
  matchStatuses,
  playbackScopes,
  roundPhases,
  roundStatuses,
  rotatePolicies,
  runControlStates,
  sideAssignmentHalves,
  simulationRunModes,
  simulationRunStatuses,
  tacticalCollisionResults,
  tacticalEventVisibilities,
  timelineEventKinds,
  tournamentFormats,
  tournamentStatuses,
  zoneResourceIntents
} from "./enums.js";

const isoDateString = z.string().min(1);
const optionalIsoDateString = isoDateString.optional();
const stringArray = z.array(z.string());
export const schemaVersionedPayloadSchema = z.object({ schemaVersion: z.number().int().positive() }).catchall(z.unknown());

export const tournamentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(tournamentStatuses),
  format: z.enum(tournamentFormats),
  championTeamId: z.string().optional(),
  createdAt: isoDateString,
  startedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString
});
export type Tournament = z.infer<typeof tournamentSchema>;

export const teamSchema = z.object({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  displayName: z.string().min(1),
  shortName: z.string().min(1),
  seed: z.number().int().positive(),
  source: z.unknown().optional(),
  teamProfileId: z.string().optional(),
  createdAt: isoDateString,
  updatedAt: optionalIsoDateString
});
export type Team = z.infer<typeof teamSchema>;

export const teamInitialProposalSchema = z.object({
  proposalId: z.string().min(1),
  version: z.string().min(1),
  teamId: z.string().min(1),
  teamSlug: z.string().min(1),
  displayName: z.string().min(1),
  teamThesis: z.string().min(1),
  opportunity: z.string().min(1),
  product: z.string().min(1),
  engineering: z.string().min(1),
  business: z.string().min(1),
  operations: z.string().min(1),
  scaling: z.string().min(1),
  moat: z.string().min(1),
  mustHoldClaims: stringArray,
  failureModes: stringArray,
  playerOperatingPrinciples: stringArray,
  coachWindowPolicies: z.object({
    timeout: z.string().min(1),
    postMatchReview: z.string().min(1)
  }),
  frontendSummary: z.string().min(1)
});
export type TeamInitialProposal = z.infer<typeof teamInitialProposalSchema>;

export const teamInitialProposalSummarySchema = z.object({
  proposalId: z.string().min(1),
  version: z.string().min(1),
  teamThesis: z.string().min(1),
  opportunity: z.string().min(1),
  product: z.string().min(1),
  engineering: z.string().min(1),
  business: z.string().min(1),
  operations: z.string().min(1),
  scaling: z.string().min(1),
  moat: z.string().min(1),
  mustHoldClaims: stringArray,
  failureModes: stringArray,
  frontendSummary: z.string().min(1)
});
export type TeamInitialProposalSummary = z.infer<typeof teamInitialProposalSummarySchema>;

export const teamProposalAnchorSchema = z.object({
  teamThesis: z.string().min(1),
  mustHoldClaims: stringArray,
  playerOperatingPrinciples: stringArray
});
export type TeamProposalAnchor = z.infer<typeof teamProposalAnchorSchema>;

export const agentBaseProfileSchema = z.object({
  personalitySummary: z.string().min(1),
  tacticalSummary: z.string().min(1),
  styleTags: stringArray,
  strengthSummary: z.string().optional(),
  weaknessSummary: z.string().optional()
});
export type AgentBaseProfile = z.infer<typeof agentBaseProfileSchema>;

export const agentRoleProfileSchema = z.object({
  sourcePath: z.string().min(1),
  sourceTeamName: z.string().min(1),
  memberType: z.enum(["player", "coach"]),
  rawPosition: z.string().min(1),
  rawPositionParts: stringArray,
  primaryRole: z.enum(agentRoles),
  secondaryRoles: z.array(z.enum(agentRoleTags)),
  positionTags: z.array(z.enum(agentRoleTags)),
  confidence: z.string().min(1),
  notes: z.string().optional(),
  agentMajorResponsibilities: stringArray
});
export type AgentRoleProfile = z.infer<typeof agentRoleProfileSchema>;

export const agentMaterialRefSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.enum(["player", "coach"]),
  teamSlug: z.string().min(1),
  jsonPath: z.string().min(1),
  aliases: stringArray.optional(),
  bindingVersion: z.string().optional(),
  bindingScope: z.string().optional(),
  runtimeEnabled: z.literal(false),
  roleTemplateId: z.string().optional()
});
export type AgentMaterialRef = z.infer<typeof agentMaterialRefSchema>;

export const agentSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  driverModelId: z.string().min(1),
  parameterProfileId: z.string().optional(),
  role: z.enum(agentRoles),
  secondaryRoles: z.array(z.enum(agentRoleTags)).optional(),
  displayName: z.string().min(1),
  baseProfile: agentBaseProfileSchema,
  roleProfile: agentRoleProfileSchema.optional(),
  materialRef: agentMaterialRefSchema.optional(),
  currentState: z.enum(agentStates),
  createdAt: isoDateString,
  updatedAt: optionalIsoDateString
});
export type Agent = z.infer<typeof agentSchema>;

export const driverModelSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  modelName: z.string().min(1),
  capabilities: stringArray,
  limits: z.unknown().optional(),
  defaultUseCase: stringArray.optional(),
  enabled: z.boolean(),
  createdAt: isoDateString,
  updatedAt: optionalIsoDateString
});
export type DriverModel = z.infer<typeof driverModelSchema>;

export const matchSchema = z.object({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  roundName: z.enum(matchRoundNames),
  teamAId: z.string().min(1),
  teamBId: z.string().min(1),
  status: z.enum(matchStatuses),
  bestOf: z.literal(3),
  teamAMapsWon: z.number().int().nonnegative(),
  teamBMapsWon: z.number().int().nonnegative(),
  winnerTeamId: z.string().optional(),
  scheduledOrder: z.number().int().positive(),
  createdAt: isoDateString,
  startedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString
});
export type Match = z.infer<typeof matchSchema>;

export const simulationRunSchema = z.object({
  id: z.string().min(1),
  fixtureId: z.string().min(1),
  status: z.enum(simulationRunStatuses),
  requestedMode: z.enum(simulationRunModes),
  runtimeMatchId: z.string().min(1),
  runtimeMapGameId: z.string().optional(),
  baselineCompletedRounds: z.number().int().nonnegative(),
  estimatedTotalRounds: z.number().int().nonnegative(),
  expectedTotalCalls: z.number().int().nonnegative(),
  latestCommittedRoundNumber: z.number().int().nonnegative(),
  hasFreshReplay: z.boolean(),
  latestError: z.string().optional(),
  createdAt: isoDateString,
  startedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString
});
export type SimulationRun = z.infer<typeof simulationRunSchema>;

export const mapGameSchema = z.object({
  id: z.string().min(1),
  matchId: z.string().min(1),
  mapName: z.string().min(1),
  order: z.number().int().positive(),
  status: z.enum(mapGameStatuses),
  runControlState: z.enum(runControlStates).optional(),
  teamAScore: z.number().int().nonnegative(),
  teamBScore: z.number().int().nonnegative(),
  currentRoundNumber: z.number().int().nonnegative(),
  winnerTeamId: z.string().optional(),
  summaryId: z.string().optional(),
  createdAt: isoDateString,
  startedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString
});
export type MapGame = z.infer<typeof mapGameSchema>;

export const summarySchema = z.object({
  id: z.string().min(1),
  summaryType: z.enum(["round", "map", "match", "tournament", "team_memory"]),
  scopeType: z.enum(["round", "map", "match", "tournament", "team"]),
  scopeId: z.string().min(1),
  tournamentId: z.string().optional(),
  matchId: z.string().optional(),
  mapGameId: z.string().optional(),
  roundId: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(1),
  payload: z.unknown().optional(),
  sourceEventIds: stringArray,
  createdAt: isoDateString,
  updatedAt: optionalIsoDateString
});
export type Summary = z.infer<typeof summarySchema>;

export const roundSchema = z.object({
  id: z.string().min(1),
  mapGameId: z.string().min(1),
  roundNumber: z.number().int().positive(),
  status: z.enum(roundStatuses),
  phase: z.enum(roundPhases).optional(),
  teamABuyType: z.enum(buyTypes).optional(),
  teamBBuyType: z.enum(buyTypes).optional(),
  teamAActiveAgentIds: stringArray,
  teamBActiveAgentIds: stringArray,
  winnerTeamId: z.string().optional(),
  roundReportId: z.string().optional(),
  startedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString
});
export type Round = z.infer<typeof roundSchema>;

export const scorePairSchema = z.object({
  teamA: z.number().int().nonnegative(),
  teamB: z.number().int().nonnegative()
});
export type ScorePair = z.infer<typeof scorePairSchema>;

export const agentActionDecisionSchema = z.object({
  action: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1).optional()
});
export type AgentActionDecision = z.infer<typeof agentActionDecisionSchema>;

export const teamRoundPlanDecisionSchema = z.object({
  teamId: z.string().min(1),
  side: z.enum(["attack", "defense"]),
  primaryIntent: z.string().min(1),
  primaryZoneId: z.string().min(1),
  secondaryZoneId: z.string().min(1).optional(),
  coordinationSummary: z.string().min(1),
  playerDirectives: z.array(
    z.object({
      agentId: z.string().min(1),
      directive: z.string().min(1)
    })
  ),
  winCondition: z.string().min(1),
  risk: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1).optional()
});
export type TeamRoundPlanDecision = z.infer<typeof teamRoundPlanDecisionSchema>;

export const agentOutputSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  teamId: z.string().min(1),
  role: z.string().min(1),
  driverModelId: z.string().min(1),
  action: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rawFingerprint: z.string().min(1)
});
export type AgentOutput = z.infer<typeof agentOutputSchema>;

export const coachTimeoutCorrectionSchema = z.object({
  teamId: z.string().min(1),
  triggerRoundNumber: z.number().int().positive(),
  triggerReason: z.string().min(1),
  diagnosedFailure: z.string().min(1),
  nextRoundObjective: z.string().min(1),
  ownCoreToHold: z.string().min(1),
  opponentGapToHit: z.string().min(1),
  zonePriorityShift: z.string().min(1),
  teamDirective: z.string().min(1),
  playerAdjustments: z
    .array(
      z.object({
        agentId: z.string().min(1),
        adjustment: z.string().min(1)
      })
    )
    .min(5),
  expiresAfterRoundNumber: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1).optional()
});
export type CoachTimeoutCorrection = z.infer<typeof coachTimeoutCorrectionSchema>;

export const coachPostMatchReviewSchema = z.object({
  teamId: z.string().min(1),
  matchId: z.string().min(1),
  keptBeliefs: stringArray,
  brokenBeliefs: stringArray,
  effectiveAttacks: stringArray,
  effectiveDefenses: stringArray,
  timeoutQualityReview: z.string().min(1),
  nextMatchUpgrades: stringArray,
  proposedStrategyPatch: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1).optional()
});
export type CoachPostMatchReview = z.infer<typeof coachPostMatchReviewSchema>;

export const judgeDiagnosticSchema = z.object({
  currentSubTheme: z.string().min(1),
  attackedOpportunityGap: z.string().min(1),
  defendedCoreProposition: z.string().min(1),
  mainAttackZoneId: z.string().min(1),
  mainDefenseZoneId: z.string().min(1),
  decisiveEvidence: z.string().min(1)
});
export type JudgeDiagnostic = z.infer<typeof judgeDiagnosticSchema>;

export const judgeRoundWinTypes = [
  "attack_elimination",
  "attack_bomb_explosion",
  "defense_elimination",
  "defense_timeout_no_plant",
  "defense_defuse"
] as const;
export type JudgeRoundWinType = (typeof judgeRoundWinTypes)[number];

export const judgeResultSchema = z.object({
  winnerTeamId: z.string().min(1),
  loserTeamId: z.string().min(1),
  margin: z.enum(["narrow", "standard", "decisive"]),
  roundWinType: z.enum(judgeRoundWinTypes).optional(),
  attackWinConditionMet: z.boolean().optional(),
  defenseWinConditionMet: z.boolean().optional(),
  reason: z.string().min(1),
  mvpAgentId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  diagnostic: judgeDiagnosticSchema.optional()
});
export type JudgeResult = z.infer<typeof judgeResultSchema>;

export const sideAssignmentSchema = z.object({
  roundId: z.string().min(1),
  roundNumber: z.number().int().positive(),
  attackingTeamId: z.string().min(1),
  defendingTeamId: z.string().min(1),
  half: z.enum(sideAssignmentHalves),
  sideSwitched: z.boolean()
});
export type SideAssignment = z.infer<typeof sideAssignmentSchema>;

export const zoneResourceAllocationSchema = z.object({
  zoneId: z.string().min(1),
  weight: z.number().int().min(0).max(100),
  activeAgentIds: stringArray,
  intent: z.enum(zoneResourceIntents)
});
export type ZoneResourceAllocation = z.infer<typeof zoneResourceAllocationSchema>;

const normalizedZoneResourceAllocationsSchema = z.array(zoneResourceAllocationSchema).min(1).refine(
  (items) => {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    return Math.abs(total - 100) <= 1;
  },
  { message: "zone resource allocation weights must sum to 100 +/- 1" }
);

export const attackPlanSchema = z.object({
  teamId: z.string().min(1),
  primaryTargetZoneId: z.string().min(1),
  secondaryTargetZoneId: z.string().min(1).optional(),
  approach: z.enum(attackApproaches),
  feintZoneId: z.string().min(1).optional(),
  resourceAllocationByZone: normalizedZoneResourceAllocationsSchema,
  activeAgentIds: stringArray,
  intentSummary: z.string().min(1)
});
export type AttackPlan = z.infer<typeof attackPlanSchema>;

export const defenseDeploymentSchema = z.object({
  teamId: z.string().min(1),
  setup: z.enum(defenseSetups),
  heavyZoneId: z.string().min(1).optional(),
  weakZoneIds: stringArray,
  resourceAllocationByZone: normalizedZoneResourceAllocationsSchema,
  anchorAgentIds: stringArray,
  rotatePolicy: z.enum(rotatePolicies),
  deploymentSummary: z.string().min(1)
});
export type DefenseDeployment = z.infer<typeof defenseDeploymentSchema>;

export const tacticalCollisionSchema = z.object({
  primaryZoneId: z.string().min(1),
  attackApproach: z.enum(attackApproaches),
  defenseSetup: z.enum(defenseSetups),
  result: z.enum(tacticalCollisionResults),
  attackScore: z.number().int(),
  defenseScore: z.number().int(),
  decisiveReason: z.string().min(1)
});
export type TacticalCollision = z.infer<typeof tacticalCollisionSchema>;

export const publicAttackPlanSummarySchema = z.object({
  teamId: z.string().min(1),
  primaryTargetZoneId: z.string().min(1),
  secondaryTargetZoneId: z.string().min(1).optional(),
  approach: z.enum(attackApproaches),
  feintRevealed: z.boolean(),
  publicSummary: z.string().min(1)
});
export type PublicAttackPlanSummary = z.infer<typeof publicAttackPlanSummarySchema>;

export const publicDefenseDeploymentSummarySchema = z.object({
  teamId: z.string().min(1),
  setup: z.enum(defenseSetups),
  heavyZoneId: z.string().min(1).optional(),
  weakZoneIds: stringArray,
  rotatePolicy: z.enum(rotatePolicies),
  publicSummary: z.string().min(1)
});
export type PublicDefenseDeploymentSummary = z.infer<typeof publicDefenseDeploymentSummarySchema>;

export const tacticalRoundContextSchema = z.object({
  sideAssignment: sideAssignmentSchema,
  attackPlan: publicAttackPlanSummarySchema,
  defenseDeployment: publicDefenseDeploymentSummarySchema,
  collision: tacticalCollisionSchema
});
export type TacticalRoundContext = z.infer<typeof tacticalRoundContextSchema>;

export const sideAssignmentCreatedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  sideAssignment: sideAssignmentSchema,
  source: z.literal("phase16_side_rule")
});
export type SideAssignmentCreatedPayload = z.infer<typeof sideAssignmentCreatedPayloadSchema>;

export const tacticalPlanSubmittedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  visibility: z.literal("restricted"),
  teamId: z.string().min(1),
  roundId: z.string().min(1),
  publicSummary: z.string().min(1),
  attackPlanSummary: z.object({
    primaryTargetZoneId: z.string().min(1),
    secondaryTargetZoneId: z.string().min(1).optional(),
    approach: z.enum(attackApproaches),
    feintRevealed: z.literal(false)
  }),
  artifactId: z.string().min(1).optional(),
  sourceEventIds: stringArray.min(1)
});
export type TacticalPlanSubmittedPayload = z.infer<typeof tacticalPlanSubmittedPayloadSchema>;

export const zoneDeploymentCommittedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  visibility: z.literal("restricted"),
  teamId: z.string().min(1),
  roundId: z.string().min(1),
  publicSummary: z.string().min(1),
  defenseDeploymentSummary: z.object({
    setup: z.enum(defenseSetups),
    heavyZoneId: z.string().min(1).optional(),
    weakZoneIds: stringArray,
    rotatePolicy: z.enum(rotatePolicies)
  }),
  artifactId: z.string().min(1).optional(),
  sourceEventIds: stringArray.min(1)
});
export type ZoneDeploymentCommittedPayload = z.infer<typeof zoneDeploymentCommittedPayloadSchema>;

export const siteExecuteResolvedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  visibility: z.literal("public_after_round"),
  roundId: z.string().min(1),
  collision: tacticalCollisionSchema,
  revealedAttackPlan: publicAttackPlanSummarySchema,
  revealedDefenseDeployment: publicDefenseDeploymentSummarySchema,
  sourceEventIds: stringArray.min(1)
});
export type SiteExecuteResolvedPayload = z.infer<typeof siteExecuteResolvedPayloadSchema>;

export const roundKeyEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["entry", "trade", "clutch", "economy_swing", "conversion", "highlight"]),
  actorAgentId: z.string().min(1),
  actorTeamId: z.string().min(1),
  targetAgentId: z.string().optional(),
  targetTeamId: z.string().optional(),
  zoneId: z.string().min(1),
  impact: z.string().min(1),
  sourceAgentOutputIds: stringArray
});
export type RoundKeyEvent = z.infer<typeof roundKeyEventSchema>;

export const roundKillLedgerEntrySchema = z.object({
  id: z.string().min(1),
  actorAgentId: z.string().min(1),
  actorTeamId: z.string().min(1),
  targetAgentId: z.string().min(1),
  targetTeamId: z.string().min(1),
  zoneId: z.string().min(1),
  atMs: z.number().int().nonnegative(),
  impact: z.string().min(1),
  keyEventId: z.string().optional(),
  sourceEventId: z.string().optional(),
  sourceAgentOutputIds: stringArray.optional()
});
export type RoundKillLedgerEntry = z.infer<typeof roundKillLedgerEntrySchema>;

export const agentEconomyDeltaSchema = z.object({
  agentId: z.string().min(1),
  teamId: z.string().min(1),
  beforeTokenBank: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
  reward: z.number().int().nonnegative(),
  afterTokenBank: z.number().int().nonnegative(),
  buyType: z.enum(buyTypes),
  lossStreak: z.number().int().nonnegative()
});
export type AgentEconomyDelta = z.infer<typeof agentEconomyDeltaSchema>;

export const economyDeltaSchema = z.object({
  agents: z.array(agentEconomyDeltaSchema),
  teamTotals: z.object({
    teamA: z.number().int(),
    teamB: z.number().int()
  })
});
export type EconomyDelta = z.infer<typeof economyDeltaSchema>;

export const tokenSubmissionSchema = z.object({
  activeAgentIds: stringArray,
  submittedOutputIds: stringArray,
  totalOutputBudget: z.number().int().nonnegative(),
  outputGate: z.object({
    applied: z.boolean(),
    reason: z.string().min(1)
  })
});
export type TokenSubmission = z.infer<typeof tokenSubmissionSchema>;

export const projectedEventSchema = z.object({
  type: z.enum(eventTypes),
  eventId: z.string().min(1),
  required: z.boolean()
});
export type ProjectedEvent = z.infer<typeof projectedEventSchema>;

export const eventProjectionSchema = z.object({
  coreEventsLinkedByRoundReport: z.array(projectedEventSchema),
  broadcastEventsCreated: z.array(projectedEventSchema)
});
export type EventProjection = z.infer<typeof eventProjectionSchema>;

export const roundReportSchema = z.object({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  matchId: z.string().min(1),
  mapGameId: z.string().min(1),
  roundId: z.string().min(1),
  roundNumber: z.number().int().positive(),
  mapName: z.string().min(1),
  winnerTeamId: z.string().min(1),
  scoreBeforeRound: scorePairSchema,
  scoreAfterRound: scorePairSchema,
  judgeResult: judgeResultSchema,
  agentOutputs: z.array(agentOutputSchema),
  llmTeamPlans: z.record(teamRoundPlanDecisionSchema).optional(),
  appliedCoachTimeoutCorrection: coachTimeoutCorrectionSchema.optional(),
  keyEvents: z.array(roundKeyEventSchema),
  killLedger: z.array(roundKillLedgerEntrySchema).optional(),
  economyDelta: economyDeltaSchema,
  tokenSubmission: tokenSubmissionSchema,
  highlightTags: z.array(z.string()).optional(),
  judgeDiagnostic: judgeDiagnosticSchema.optional(),
  tacticalContext: tacticalRoundContextSchema.optional(),
  summary: z.string().min(1),
  eventProjection: eventProjectionSchema,
  createdAt: isoDateString
});
export type RoundReport = z.infer<typeof roundReportSchema>;

export const teamMapCoachStateSchema = z.object({
  mapGameId: z.string().min(1),
  teamId: z.string().min(1),
  timeoutsRemaining: z.number().int().nonnegative(),
  activeCorrectionArtifactId: z.string().min(1).optional(),
  activeCorrectionExpiresAfterRound: z.number().int().positive().optional(),
  lastTimeoutRoundNumber: z.number().int().positive().optional(),
  updatedAt: isoDateString
});
export type TeamMapCoachState = z.infer<typeof teamMapCoachStateSchema>;

export const economyStateSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  teamId: z.string().min(1),
  mapGameId: z.string().min(1),
  roundId: z.string().optional(),
  phase: z.enum(["before_buy", "after_buy", "after_round"]).optional(),
  tokenBank: z.number().int().nonnegative(),
  buyType: z.enum(buyTypes),
  lossStreak: z.number().int().nonnegative(),
  timeoutsRemaining: z.number().int().nonnegative(),
  visibleContextBudget: z.number().int().nonnegative().optional(),
  outputBudget: z.number().int().nonnegative().optional(),
  createdAt: isoDateString
});
export type EconomyState = z.infer<typeof economyStateSchema>;

export const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(eventTypes),
  category: z.enum(eventCategories),
  tournamentId: z.string().min(1),
  matchId: z.string().optional(),
  mapGameId: z.string().optional(),
  roundId: z.string().optional(),
  payload: schemaVersionedPayloadSchema,
  globalSequence: z.number().int().positive(),
  scopeType: z.enum(eventScopeTypes),
  scopeId: z.string().min(1),
  sequenceInScope: z.number().int().positive(),
  timelineMs: z.number().int().nonnegative().optional(),
  sourceModule: z.string().optional(),
  createdAt: isoDateString,
  updatedAt: optionalIsoDateString,
  deletedAt: optionalIsoDateString,
  deletedReason: z.string().optional()
});
export type Event = z.infer<typeof eventSchema>;

export const timelineEventSchema = z.object({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  matchId: z.string().optional(),
  mapGameId: z.string().optional(),
  roundId: z.string().optional(),
  sourceEventIds: stringArray.min(1),
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  kind: z.enum(timelineEventKinds),
  payload: z.unknown(),
  playbackScope: z.enum(playbackScopes),
  playbackScopeId: z.string().min(1),
  sequenceIndex: z.number().int().nonnegative(),
  createdAt: isoDateString
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const artifactSchema = z.object({
  id: z.string().min(1),
  artifactType: z.string().min(1),
  tournamentId: z.string().optional(),
  matchId: z.string().optional(),
  mapGameId: z.string().optional(),
  roundId: z.string().optional(),
  agentId: z.string().optional(),
  uri: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
  status: z.enum(["pending", "ready", "failed"]),
  sourceEventIds: stringArray.optional(),
  createdAt: isoDateString
});
export type Artifact = z.infer<typeof artifactSchema>;

export const llmCallSchema = z.object({
  id: z.string().min(1),
  tournamentId: z.string().optional(),
  matchId: z.string().optional(),
  roundId: z.string().optional(),
  agentId: z.string().optional(),
  driverModelId: z.string().min(1),
  taskType: z.string().min(1),
  promptHash: z.string().optional(),
  requestArtifactId: z.string().optional(),
  responseArtifactId: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  createdAt: isoDateString
});
export type LlmCall = z.infer<typeof llmCallSchema>;

export const jobSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  priority: z.number().int(),
  payload: z.unknown(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAfter: optionalIsoDateString,
  lockedAt: optionalIsoDateString,
  completedAt: optionalIsoDateString,
  error: z.unknown().optional(),
  createdAt: isoDateString
});
export type Job = z.infer<typeof jobSchema>;
