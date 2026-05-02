import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tournaments = sqliteTable("tournaments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  format: text("format").notNull(),
  championTeamId: text("champion_team_id"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at")
});

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    displayName: text("display_name").notNull(),
    shortName: text("short_name").notNull(),
    seed: integer("seed").notNull(),
    sourceJson: text("source_json", { mode: "json" }),
    teamProfileId: text("team_profile_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at")
  },
  (table) => ({
    tournamentIdx: index("teams_tournament_idx").on(table.tournamentId)
  })
);

export const driverModels = sqliteTable("driver_models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  capabilitiesJson: text("capabilities_json", { mode: "json" }).notNull(),
  limitsJson: text("limits_json", { mode: "json" }),
  defaultUseCaseJson: text("default_use_case_json", { mode: "json" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at")
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull().references(() => teams.id),
    driverModelId: text("driver_model_id").notNull().references(() => driverModels.id),
    parameterProfileId: text("parameter_profile_id"),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    baseProfileJson: text("base_profile_json", { mode: "json" }).notNull(),
    currentState: text("current_state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at")
  },
  (table) => ({
    teamIdx: index("agents_team_idx").on(table.teamId),
    driverModelIdx: index("agents_driver_model_idx").on(table.driverModelId)
  })
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    roundName: text("round_name").notNull(),
    teamAId: text("team_a_id").notNull().references(() => teams.id),
    teamBId: text("team_b_id").notNull().references(() => teams.id),
    status: text("status").notNull(),
    bestOf: integer("best_of").notNull(),
    teamAMapsWon: integer("team_a_maps_won").notNull().default(0),
    teamBMapsWon: integer("team_b_maps_won").notNull().default(0),
    winnerTeamId: text("winner_team_id").references(() => teams.id),
    scheduledOrder: integer("scheduled_order").notNull(),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at")
  },
  (table) => ({
    tournamentIdx: index("matches_tournament_idx").on(table.tournamentId)
  })
);

export const mapGames = sqliteTable(
  "map_games",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull().references(() => matches.id),
    mapName: text("map_name").notNull(),
    order: integer("map_order").notNull(),
    status: text("status").notNull(),
    runControlState: text("run_control_state"),
    teamAScore: integer("team_a_score").notNull().default(0),
    teamBScore: integer("team_b_score").notNull().default(0),
    currentRoundNumber: integer("current_round_number").notNull().default(0),
    winnerTeamId: text("winner_team_id").references(() => teams.id),
    summaryId: text("summary_id"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at")
  },
  (table) => ({
    matchIdx: index("map_games_match_idx").on(table.matchId),
    orderUnique: uniqueIndex("map_games_match_order_unique").on(table.matchId, table.order)
  })
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    mapGameId: text("map_game_id").notNull().references(() => mapGames.id),
    roundNumber: integer("round_number").notNull(),
    status: text("status").notNull(),
    phase: text("phase"),
    teamABuyType: text("team_a_buy_type"),
    teamBBuyType: text("team_b_buy_type"),
    teamAActiveAgentIdsJson: text("team_a_active_agent_ids_json", { mode: "json" }).notNull(),
    teamBActiveAgentIdsJson: text("team_b_active_agent_ids_json", { mode: "json" }).notNull(),
    winnerTeamId: text("winner_team_id").references(() => teams.id),
    roundReportId: text("round_report_id"),
    startedAt: text("started_at"),
    completedAt: text("completed_at")
  },
  (table) => ({
    mapIdx: index("rounds_map_idx").on(table.mapGameId),
    roundUnique: uniqueIndex("rounds_map_number_unique").on(table.mapGameId, table.roundNumber)
  })
);

export const roundReports = sqliteTable("round_reports", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  matchId: text("match_id").notNull().references(() => matches.id),
  mapGameId: text("map_game_id").notNull().references(() => mapGames.id),
  roundId: text("round_id").notNull().references(() => rounds.id),
  roundNumber: integer("round_number").notNull(),
  mapName: text("map_name").notNull(),
  winnerTeamId: text("winner_team_id").notNull().references(() => teams.id),
  scoreBeforeRoundJson: text("score_before_round_json", { mode: "json" }).notNull(),
  scoreAfterRoundJson: text("score_after_round_json", { mode: "json" }).notNull(),
  judgeResultJson: text("judge_result_json", { mode: "json" }).notNull(),
  agentOutputsJson: text("agent_outputs_json", { mode: "json" }).notNull(),
  keyEventsJson: text("key_events_json", { mode: "json" }).notNull(),
  economyDeltaJson: text("economy_delta_json", { mode: "json" }).notNull(),
  tokenSubmissionJson: text("token_submission_json", { mode: "json" }).notNull(),
  highlightTagsJson: text("highlight_tags_json", { mode: "json" }),
  tacticalContextJson: text("tactical_context_json", { mode: "json" }),
  summary: text("summary").notNull(),
  eventProjectionJson: text("event_projection_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull()
});

export const economyStates = sqliteTable(
  "economy_states",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    teamId: text("team_id").notNull().references(() => teams.id),
    mapGameId: text("map_game_id").notNull().references(() => mapGames.id),
    roundId: text("round_id").references(() => rounds.id),
    phase: text("phase"),
    tokenBank: integer("token_bank").notNull(),
    buyType: text("buy_type").notNull(),
    lossStreak: integer("loss_streak").notNull(),
    timeoutsRemaining: integer("timeouts_remaining").notNull(),
    visibleContextBudget: integer("visible_context_budget"),
    outputBudget: integer("output_budget"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    agentRoundIdx: index("economy_states_agent_round_idx").on(table.agentId, table.roundId)
  })
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    matchId: text("match_id").references(() => matches.id),
    mapGameId: text("map_game_id").references(() => mapGames.id),
    roundId: text("round_id").references(() => rounds.id),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    globalSequence: integer("global_sequence").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    sequenceInScope: integer("sequence_in_scope").notNull(),
    timelineMs: integer("timeline_ms"),
    sourceModule: text("source_module"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
    deletedReason: text("deleted_reason")
  },
  (table) => ({
    globalSequenceUnique: uniqueIndex("events_global_sequence_unique").on(table.globalSequence),
    scopeSequenceUnique: uniqueIndex("events_scope_sequence_unique").on(
      table.scopeType,
      table.scopeId,
      table.sequenceInScope
    )
  })
);

export const timelineEvents = sqliteTable("timeline_events", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  matchId: text("match_id").references(() => matches.id),
  mapGameId: text("map_game_id").references(() => mapGames.id),
  roundId: text("round_id").references(() => rounds.id),
  sourceEventIdsJson: text("source_event_ids_json", { mode: "json" }).notNull(),
  atMs: integer("at_ms").notNull(),
  durationMs: integer("duration_ms"),
  kind: text("kind").notNull(),
  payloadJson: text("payload_json", { mode: "json" }).notNull(),
  playbackScope: text("playback_scope").notNull(),
  playbackScopeId: text("playback_scope_id").notNull(),
  sequenceIndex: integer("sequence_index").notNull(),
  createdAt: text("created_at").notNull()
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  artifactType: text("artifact_type").notNull(),
  tournamentId: text("tournament_id").references(() => tournaments.id),
  matchId: text("match_id").references(() => matches.id),
  mapGameId: text("map_game_id").references(() => mapGames.id),
  roundId: text("round_id").references(() => rounds.id),
  agentId: text("agent_id").references(() => agents.id),
  uri: text("uri").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  status: text("status").notNull(),
  sourceEventIdsJson: text("source_event_ids_json", { mode: "json" }),
  createdAt: text("created_at").notNull()
});

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").references(() => tournaments.id),
    matchId: text("match_id").references(() => matches.id),
    roundId: text("round_id").references(() => rounds.id),
    agentId: text("agent_id").references(() => agents.id),
    driverModelId: text("driver_model_id").notNull().references(() => driverModels.id),
    taskType: text("task_type").notNull(),
    promptHash: text("prompt_hash"),
    requestArtifactId: text("request_artifact_id").references(() => artifacts.id),
    responseArtifactId: text("response_artifact_id").references(() => artifacts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCost: real("estimated_cost"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    taskIdx: index("llm_calls_task_type_idx").on(table.taskType),
    driverModelIdx: index("llm_calls_driver_model_idx").on(table.driverModelId)
  })
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    priority: integer("priority").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: text("run_after"),
    lockedAt: text("locked_at"),
    completedAt: text("completed_at"),
    errorJson: text("error_json", { mode: "json" }),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    statusRunAfterIdx: index("jobs_status_run_after_idx").on(table.status, table.runAfter)
  })
);

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  payloadJson: text("payload_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull()
});
