import { z } from "zod";
import {
  agentRoles,
  agentStates,
  buyTypes,
  eventCategories,
  eventScopeTypes,
  eventTypes,
  mapGameStatuses,
  matchRoundNames,
  matchStatuses,
  playbackScopes,
  roundPhases,
  roundStatuses,
  runControlStates,
  timelineEventKinds,
  tournamentFormats,
  tournamentStatuses
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

export const agentBaseProfileSchema = z.object({
  personalitySummary: z.string().min(1),
  tacticalSummary: z.string().min(1),
  styleTags: stringArray,
  strengthSummary: z.string().optional(),
  weaknessSummary: z.string().optional()
});
export type AgentBaseProfile = z.infer<typeof agentBaseProfileSchema>;

export const agentSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  driverModelId: z.string().min(1),
  parameterProfileId: z.string().optional(),
  role: z.enum(agentRoles),
  displayName: z.string().min(1),
  baseProfile: agentBaseProfileSchema,
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

export const judgeResultSchema = z.object({
  winnerTeamId: z.string().min(1),
  loserTeamId: z.string().min(1),
  margin: z.enum(["narrow", "standard", "decisive"]),
  reason: z.string().min(1),
  mvpAgentId: z.string().min(1),
  confidence: z.number().min(0).max(1)
});
export type JudgeResult = z.infer<typeof judgeResultSchema>;

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
  keyEvents: z.array(roundKeyEventSchema),
  economyDelta: economyDeltaSchema,
  tokenSubmission: tokenSubmissionSchema,
  highlightTags: z.array(z.string()).optional(),
  summary: z.string().min(1),
  eventProjection: eventProjectionSchema,
  createdAt: isoDateString
});
export type RoundReport = z.infer<typeof roundReportSchema>;

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
