import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type {
  Agent,
  Artifact,
  DriverModel,
  EconomyState,
  Event,
  Job,
  LlmCall,
  MapGame,
  Match,
  Round,
  RoundReport,
  Summary,
  Team,
  TimelineEvent,
  Tournament
} from "@agent-major/shared";
import {
  agentSchema,
  artifactSchema,
  driverModelSchema,
  economyStateSchema,
  eventSchema,
  jobSchema,
  llmCallSchema,
  mapGameSchema,
  matchSchema,
  roundReportSchema,
  roundSchema,
  summarySchema,
  teamSchema,
  timelineEventSchema,
  tournamentSchema
} from "@agent-major/shared";

import { defaultSqlitePath } from "./connection.js";

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  setAllowBareNamedParameters?(enabled: boolean): void;
  setAllowUnknownNamedParameters?(enabled: boolean): void;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (filePath: string) => SqliteDatabase;
};

type Row = Record<string, unknown>;

export interface Repository<TEntity> {
  getById(id: string): Promise<TEntity | null>;
  save(entity: TEntity): Promise<void>;
}

export interface TournamentRepository extends Repository<Tournament> {}
export interface TeamRepository extends Repository<Team> {
  listByTournament(tournamentId: string): Promise<Team[]>;
}
export interface AgentRepository extends Repository<Agent> {
  listByTeam(teamId: string): Promise<Agent[]>;
  listByTeamIds(teamIds: string[]): Promise<Agent[]>;
}
export interface DriverModelRepository extends Repository<DriverModel> {}
export interface MatchRepository extends Repository<Match> {}
export interface MapGameRepository extends Repository<MapGame> {
  listByMatch(matchId: string): Promise<MapGame[]>;
}
export interface RoundRepository extends Repository<Round> {
  getByMapGameAndRoundNumber(mapGameId: string, roundNumber: number): Promise<Round | null>;
  listByMapGame(mapGameId: string): Promise<Round[]>;
}
export interface RoundReportRepository extends Repository<RoundReport> {
  getByRoundId(roundId: string): Promise<RoundReport | null>;
  listByMapGame(mapGameId: string): Promise<RoundReport[]>;
}
export interface EconomyStateRepository extends Repository<EconomyState> {
  getLatestByAgent(agentId: string, mapGameId: string): Promise<EconomyState | null>;
  listByRound(roundId: string): Promise<EconomyState[]>;
  listLatestByMapGame(mapGameId: string): Promise<EconomyState[]>;
}
export interface EventRepository extends Repository<Event> {
  append(event: Event): Promise<Event>;
  getMaxGlobalSequence(): Promise<number>;
  getMaxSequenceInScope(scopeType: Event["scopeType"], scopeId: string): Promise<number>;
  listByRound(roundId: string): Promise<Event[]>;
  listByMapGame(mapGameId: string): Promise<Event[]>;
  listByMatch(matchId: string): Promise<Event[]>;
  listByIds(ids: string[]): Promise<Event[]>;
}
export interface TimelineEventRepository extends Repository<TimelineEvent> {
  listByRound(roundId: string): Promise<TimelineEvent[]>;
  listByMapGame(mapGameId: string): Promise<TimelineEvent[]>;
  deleteByRound(roundId: string): Promise<void>;
}
export interface SummaryRepository extends Repository<Summary> {
  getLatestByScope(scopeType: Summary["scopeType"], scopeId: string): Promise<Summary | null>;
}
export interface ArtifactRepository extends Repository<Artifact> {}
export interface LlmCallRepository extends Repository<LlmCall> {}
export interface JobRepository extends Repository<Job> {}

export interface Repositories {
  tournaments: TournamentRepository;
  teams: TeamRepository;
  agents: AgentRepository;
  driverModels: DriverModelRepository;
  matches: MatchRepository;
  mapGames: MapGameRepository;
  rounds: RoundRepository;
  roundReports: RoundReportRepository;
  economyStates: EconomyStateRepository;
  events: EventRepository;
  timelineEvents: TimelineEventRepository;
  summaries: SummaryRepository;
  artifacts: ArtifactRepository;
  llmCalls: LlmCallRepository;
  jobs: JobRepository;
}

export interface SqliteRepositoryBundle extends Repositories {
  readonly sqlite: SqliteDatabase;
  transaction<T>(work: () => T | Promise<T>): Promise<T>;
  close(): void;
}

export function createSqliteRepositories(filePath = defaultSqlitePath): SqliteRepositoryBundle {
  const parentDir = dirname(filePath);
  if (parentDir !== ".") {
    mkdirSync(parentDir, { recursive: true });
  }

  const rawSqlite = new DatabaseSync(filePath);
  const sqlite: SqliteDatabase = {
    exec: (sql) => rawSqlite.exec(sql),
    prepare: (sql) => {
      const statement = rawSqlite.prepare(sql);
      statement.setAllowBareNamedParameters?.(true);
      statement.setAllowUnknownNamedParameters?.(true);
      return statement;
    },
    close: () => rawSqlite.close()
  };
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 10000");
  ensureSqliteSchema(sqlite);

  return {
    sqlite,
    close: () => sqlite.close(),
    transaction: async <T>(work: () => T | Promise<T>): Promise<T> => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await work();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          // Keep the original failure as the actionable error for callers.
        }
        throw error;
      }
    },
    tournaments: new TournamentSqliteRepository(sqlite),
    teams: new TeamSqliteRepository(sqlite),
    agents: new AgentSqliteRepository(sqlite),
    driverModels: new DriverModelSqliteRepository(sqlite),
    matches: new MatchSqliteRepository(sqlite),
    mapGames: new MapGameSqliteRepository(sqlite),
    rounds: new RoundSqliteRepository(sqlite),
    roundReports: new RoundReportSqliteRepository(sqlite),
    economyStates: new EconomyStateSqliteRepository(sqlite),
    events: new EventSqliteRepository(sqlite),
    timelineEvents: new TimelineEventSqliteRepository(sqlite),
    summaries: new SummarySqliteRepository(sqlite),
    artifacts: new ArtifactSqliteRepository(sqlite),
    llmCalls: new LlmCallSqliteRepository(sqlite),
    jobs: new JobSqliteRepository(sqlite)
  };
}

export function ensureSqliteSchema(sqlite: SqliteDatabase): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS tournaments (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  format text NOT NULL,
  champion_team_id text,
  created_at text NOT NULL,
  started_at text,
  completed_at text
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY NOT NULL,
  tournament_id text NOT NULL REFERENCES tournaments(id),
  display_name text NOT NULL,
  short_name text NOT NULL,
  seed integer NOT NULL,
  source_json text,
  team_profile_id text,
  created_at text NOT NULL,
  updated_at text
);
CREATE TABLE IF NOT EXISTS driver_models (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  model_name text NOT NULL,
  capabilities_json text NOT NULL,
  limits_json text,
  default_use_case_json text,
  enabled integer DEFAULT 1 NOT NULL,
  created_at text NOT NULL,
  updated_at text
);
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL,
  team_id text NOT NULL REFERENCES teams(id),
  driver_model_id text NOT NULL REFERENCES driver_models(id),
  parameter_profile_id text,
  role text NOT NULL,
  display_name text NOT NULL,
  base_profile_json text NOT NULL,
  current_state text NOT NULL,
  created_at text NOT NULL,
  updated_at text
);
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY NOT NULL,
  tournament_id text NOT NULL REFERENCES tournaments(id),
  round_name text NOT NULL,
  team_a_id text NOT NULL REFERENCES teams(id),
  team_b_id text NOT NULL REFERENCES teams(id),
  status text NOT NULL,
  best_of integer NOT NULL,
  team_a_maps_won integer DEFAULT 0 NOT NULL,
  team_b_maps_won integer DEFAULT 0 NOT NULL,
  winner_team_id text REFERENCES teams(id),
  scheduled_order integer NOT NULL,
  created_at text NOT NULL,
  started_at text,
  completed_at text
);
CREATE TABLE IF NOT EXISTS map_games (
  id text PRIMARY KEY NOT NULL,
  match_id text NOT NULL REFERENCES matches(id),
  map_name text NOT NULL,
  map_order integer NOT NULL,
  status text NOT NULL,
  run_control_state text,
  team_a_score integer DEFAULT 0 NOT NULL,
  team_b_score integer DEFAULT 0 NOT NULL,
  current_round_number integer DEFAULT 0 NOT NULL,
  winner_team_id text REFERENCES teams(id),
  summary_id text,
  created_at text NOT NULL,
  started_at text,
  completed_at text
);
CREATE TABLE IF NOT EXISTS rounds (
  id text PRIMARY KEY NOT NULL,
  map_game_id text NOT NULL REFERENCES map_games(id),
  round_number integer NOT NULL,
  status text NOT NULL,
  phase text,
  team_a_buy_type text,
  team_b_buy_type text,
  team_a_active_agent_ids_json text NOT NULL,
  team_b_active_agent_ids_json text NOT NULL,
  winner_team_id text REFERENCES teams(id),
  round_report_id text,
  started_at text,
  completed_at text
);
CREATE TABLE IF NOT EXISTS round_reports (
  id text PRIMARY KEY NOT NULL,
  tournament_id text NOT NULL REFERENCES tournaments(id),
  match_id text NOT NULL REFERENCES matches(id),
  map_game_id text NOT NULL REFERENCES map_games(id),
  round_id text NOT NULL REFERENCES rounds(id),
  round_number integer NOT NULL,
  map_name text NOT NULL,
  winner_team_id text NOT NULL REFERENCES teams(id),
  score_before_round_json text NOT NULL,
  score_after_round_json text NOT NULL,
  judge_result_json text NOT NULL,
  agent_outputs_json text NOT NULL,
  key_events_json text NOT NULL,
  economy_delta_json text NOT NULL,
  token_submission_json text NOT NULL,
  highlight_tags_json text,
  tactical_context_json text,
  summary text NOT NULL,
  event_projection_json text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS economy_states (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL REFERENCES agents(id),
  team_id text NOT NULL REFERENCES teams(id),
  map_game_id text NOT NULL REFERENCES map_games(id),
  round_id text REFERENCES rounds(id),
  phase text,
  token_bank integer NOT NULL,
  buy_type text NOT NULL,
  loss_streak integer NOT NULL,
  timeouts_remaining integer NOT NULL,
  visible_context_budget integer,
  output_budget integer,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  category text NOT NULL,
  tournament_id text NOT NULL REFERENCES tournaments(id),
  match_id text REFERENCES matches(id),
  map_game_id text REFERENCES map_games(id),
  round_id text REFERENCES rounds(id),
  payload_json text NOT NULL,
  global_sequence integer NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  sequence_in_scope integer NOT NULL,
  timeline_ms integer,
  source_module text,
  created_at text NOT NULL,
  updated_at text,
  deleted_at text,
  deleted_reason text
);
CREATE TABLE IF NOT EXISTS timeline_events (
  id text PRIMARY KEY NOT NULL,
  tournament_id text NOT NULL REFERENCES tournaments(id),
  match_id text REFERENCES matches(id),
  map_game_id text REFERENCES map_games(id),
  round_id text REFERENCES rounds(id),
  source_event_ids_json text NOT NULL,
  at_ms integer NOT NULL,
  duration_ms integer,
  kind text NOT NULL,
  payload_json text NOT NULL,
  playback_scope text NOT NULL,
  playback_scope_id text NOT NULL,
  sequence_index integer NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS summaries (
  id text PRIMARY KEY NOT NULL,
  summary_type text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  tournament_id text REFERENCES tournaments(id),
  match_id text REFERENCES matches(id),
  map_game_id text REFERENCES map_games(id),
  round_id text REFERENCES rounds(id),
  title text NOT NULL,
  content text NOT NULL,
  payload_json text,
  source_event_ids_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text
);
CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY NOT NULL,
  artifact_type text NOT NULL,
  tournament_id text REFERENCES tournaments(id),
  match_id text REFERENCES matches(id),
  map_game_id text REFERENCES map_games(id),
  round_id text REFERENCES rounds(id),
  agent_id text REFERENCES agents(id),
  uri text NOT NULL,
  mime_type text,
  size_bytes integer,
  checksum text,
  status text NOT NULL,
  source_event_ids_json text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id text PRIMARY KEY NOT NULL,
  tournament_id text REFERENCES tournaments(id),
  match_id text REFERENCES matches(id),
  round_id text REFERENCES rounds(id),
  agent_id text REFERENCES agents(id),
  driver_model_id text NOT NULL REFERENCES driver_models(id),
  task_type text NOT NULL,
  prompt_hash text,
  request_artifact_id text REFERENCES artifacts(id),
  response_artifact_id text REFERENCES artifacts(id),
  input_tokens integer,
  output_tokens integer,
  estimated_cost real,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  priority integer NOT NULL,
  payload_json text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  run_after text,
  locked_at text,
  completed_at text,
  error_json text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id text PRIMARY KEY NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  payload_json text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS teams_tournament_idx ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS agents_team_idx ON agents(team_id);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches(tournament_id);
CREATE UNIQUE INDEX IF NOT EXISTS map_games_match_order_unique ON map_games(match_id, map_order);
CREATE UNIQUE INDEX IF NOT EXISTS rounds_map_number_unique ON rounds(map_game_id, round_number);
CREATE UNIQUE INDEX IF NOT EXISTS events_global_sequence_unique ON events(global_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS events_scope_sequence_unique ON events(scope_type, scope_id, sequence_in_scope);
CREATE INDEX IF NOT EXISTS timeline_events_round_idx ON timeline_events(round_id, sequence_index);
CREATE INDEX IF NOT EXISTS economy_states_agent_round_idx ON economy_states(agent_id, round_id);
CREATE INDEX IF NOT EXISTS summaries_scope_idx ON summaries(scope_type, scope_id, created_at);
`);
  ensureSqliteColumn(sqlite, "round_reports", "tactical_context_json", "text");
}

function ensureSqliteColumn(sqlite: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

class TournamentSqliteRepository implements TournamentRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Tournament | null> {
    const row = this.sqlite.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as Row | undefined;
    return row ? tournamentSchema.parse(mapTournament(row)) : null;
  }

  async save(entity: Tournament): Promise<void> {
    const item = tournamentSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO tournaments (id, name, status, format, champion_team_id, created_at, started_at, completed_at)
         VALUES (@id, @name, @status, @format, @championTeamId, @createdAt, @startedAt, @completedAt)
         ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, status = excluded.status, format = excluded.format, champion_team_id = excluded.champion_team_id,
         created_at = excluded.created_at, started_at = excluded.started_at, completed_at = excluded.completed_at`
      )
      .run(toNullable(item));
  }
}

class TeamSqliteRepository implements TeamRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Team | null> {
    const row = this.sqlite.prepare("SELECT * FROM teams WHERE id = ?").get(id) as Row | undefined;
    return row ? teamSchema.parse(mapTeam(row)) : null;
  }

  async listByTournament(tournamentId: string): Promise<Team[]> {
    return (this.sqlite.prepare("SELECT * FROM teams WHERE tournament_id = ? ORDER BY seed ASC").all(tournamentId) as Row[])
      .map((row) => teamSchema.parse(mapTeam(row)));
  }

  async save(entity: Team): Promise<void> {
    const item = teamSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO teams (id, tournament_id, display_name, short_name, seed, source_json, team_profile_id, created_at, updated_at)
         VALUES (@id, @tournamentId, @displayName, @shortName, @seed, @sourceJson, @teamProfileId, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
         tournament_id = excluded.tournament_id, display_name = excluded.display_name, short_name = excluded.short_name,
         seed = excluded.seed, source_json = excluded.source_json, team_profile_id = excluded.team_profile_id,
         created_at = excluded.created_at, updated_at = excluded.updated_at`
      )
      .run(toNullable({ ...item, sourceJson: stringifyOptional(item.source) }));
  }
}

class DriverModelSqliteRepository implements DriverModelRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<DriverModel | null> {
    const row = this.sqlite.prepare("SELECT * FROM driver_models WHERE id = ?").get(id) as Row | undefined;
    return row ? driverModelSchema.parse(mapDriverModel(row)) : null;
  }

  async save(entity: DriverModel): Promise<void> {
    const item = driverModelSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO driver_models (id, provider, model_name, capabilities_json, limits_json, default_use_case_json, enabled, created_at, updated_at)
         VALUES (@id, @provider, @modelName, @capabilitiesJson, @limitsJson, @defaultUseCaseJson, @enabled, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider, model_name = excluded.model_name, capabilities_json = excluded.capabilities_json,
         limits_json = excluded.limits_json, default_use_case_json = excluded.default_use_case_json,
         enabled = excluded.enabled, created_at = excluded.created_at, updated_at = excluded.updated_at`
      )
      .run(
        toNullable({
          ...item,
          capabilitiesJson: JSON.stringify(item.capabilities),
          limitsJson: stringifyOptional(item.limits),
          defaultUseCaseJson: stringifyOptional(item.defaultUseCase),
          enabled: item.enabled ? 1 : 0
        })
      );
  }
}

class AgentSqliteRepository implements AgentRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Agent | null> {
    const row = this.sqlite.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return row ? agentSchema.parse(mapAgent(row)) : null;
  }

  async listByTeam(teamId: string): Promise<Agent[]> {
    return (this.sqlite.prepare("SELECT * FROM agents WHERE team_id = ? ORDER BY role ASC, id ASC").all(teamId) as Row[]).map(
      (row) => agentSchema.parse(mapAgent(row))
    );
  }

  async listByTeamIds(teamIds: string[]): Promise<Agent[]> {
    if (teamIds.length === 0) {
      return [];
    }

    const placeholders = teamIds.map(() => "?").join(",");
    return (this.sqlite.prepare(`SELECT * FROM agents WHERE team_id IN (${placeholders}) ORDER BY team_id ASC, id ASC`).all(...teamIds) as Row[])
      .map((row) => agentSchema.parse(mapAgent(row)));
  }

  async save(entity: Agent): Promise<void> {
    const item = agentSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO agents (id, team_id, driver_model_id, parameter_profile_id, role, display_name, base_profile_json, current_state, created_at, updated_at)
         VALUES (@id, @teamId, @driverModelId, @parameterProfileId, @role, @displayName, @baseProfileJson, @currentState, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
         team_id = excluded.team_id, driver_model_id = excluded.driver_model_id, parameter_profile_id = excluded.parameter_profile_id,
         role = excluded.role, display_name = excluded.display_name, base_profile_json = excluded.base_profile_json,
         current_state = excluded.current_state, created_at = excluded.created_at, updated_at = excluded.updated_at`
      )
      .run(toNullable({ ...item, baseProfileJson: JSON.stringify(item.baseProfile) }));
  }
}

class MatchSqliteRepository implements MatchRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Match | null> {
    const row = this.sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(id) as Row | undefined;
    return row ? matchSchema.parse(mapMatch(row)) : null;
  }

  async save(entity: Match): Promise<void> {
    const item = matchSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO matches (id, tournament_id, round_name, team_a_id, team_b_id, status, best_of, team_a_maps_won, team_b_maps_won, winner_team_id, scheduled_order, created_at, started_at, completed_at)
         VALUES (@id, @tournamentId, @roundName, @teamAId, @teamBId, @status, @bestOf, @teamAMapsWon, @teamBMapsWon, @winnerTeamId, @scheduledOrder, @createdAt, @startedAt, @completedAt)
         ON CONFLICT(id) DO UPDATE SET
         tournament_id = excluded.tournament_id, round_name = excluded.round_name, team_a_id = excluded.team_a_id,
         team_b_id = excluded.team_b_id, status = excluded.status, best_of = excluded.best_of,
         team_a_maps_won = excluded.team_a_maps_won, team_b_maps_won = excluded.team_b_maps_won,
         winner_team_id = excluded.winner_team_id, scheduled_order = excluded.scheduled_order,
         created_at = excluded.created_at, started_at = excluded.started_at, completed_at = excluded.completed_at`
      )
      .run(toNullable(item));
  }
}

class MapGameSqliteRepository implements MapGameRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<MapGame | null> {
    const row = this.sqlite.prepare("SELECT * FROM map_games WHERE id = ?").get(id) as Row | undefined;
    return row ? mapGameSchema.parse(mapMapGame(row)) : null;
  }

  async listByMatch(matchId: string): Promise<MapGame[]> {
    return (this.sqlite.prepare("SELECT * FROM map_games WHERE match_id = ? ORDER BY map_order ASC").all(matchId) as Row[]).map(
      (row) => mapGameSchema.parse(mapMapGame(row))
    );
  }

  async save(entity: MapGame): Promise<void> {
    const item = mapGameSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO map_games (id, match_id, map_name, map_order, status, run_control_state, team_a_score, team_b_score, current_round_number, winner_team_id, summary_id, created_at, started_at, completed_at)
         VALUES (@id, @matchId, @mapName, @order, @status, @runControlState, @teamAScore, @teamBScore, @currentRoundNumber, @winnerTeamId, @summaryId, @createdAt, @startedAt, @completedAt)
         ON CONFLICT(id) DO UPDATE SET
         match_id = excluded.match_id, map_name = excluded.map_name, map_order = excluded.map_order,
         status = excluded.status, run_control_state = excluded.run_control_state, team_a_score = excluded.team_a_score,
         team_b_score = excluded.team_b_score, current_round_number = excluded.current_round_number,
         winner_team_id = excluded.winner_team_id, summary_id = excluded.summary_id,
         created_at = excluded.created_at, started_at = excluded.started_at, completed_at = excluded.completed_at`
      )
      .run(toNullable(item));
  }
}

class RoundSqliteRepository implements RoundRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Round | null> {
    const row = this.sqlite.prepare("SELECT * FROM rounds WHERE id = ?").get(id) as Row | undefined;
    return row ? roundSchema.parse(mapRound(row)) : null;
  }

  async getByMapGameAndRoundNumber(mapGameId: string, roundNumber: number): Promise<Round | null> {
    const row = this.sqlite
      .prepare("SELECT * FROM rounds WHERE map_game_id = ? AND round_number = ?")
      .get(mapGameId, roundNumber) as Row | undefined;
    return row ? roundSchema.parse(mapRound(row)) : null;
  }

  async listByMapGame(mapGameId: string): Promise<Round[]> {
    return (this.sqlite.prepare("SELECT * FROM rounds WHERE map_game_id = ? ORDER BY round_number ASC").all(mapGameId) as Row[]).map(
      (row) => roundSchema.parse(mapRound(row))
    );
  }

  async save(entity: Round): Promise<void> {
    const item = roundSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO rounds (id, map_game_id, round_number, status, phase, team_a_buy_type, team_b_buy_type, team_a_active_agent_ids_json, team_b_active_agent_ids_json, winner_team_id, round_report_id, started_at, completed_at)
         VALUES (@id, @mapGameId, @roundNumber, @status, @phase, @teamABuyType, @teamBBuyType, @teamAActiveAgentIdsJson, @teamBActiveAgentIdsJson, @winnerTeamId, @roundReportId, @startedAt, @completedAt)
         ON CONFLICT(id) DO UPDATE SET
         map_game_id = excluded.map_game_id, round_number = excluded.round_number, status = excluded.status,
         phase = excluded.phase, team_a_buy_type = excluded.team_a_buy_type, team_b_buy_type = excluded.team_b_buy_type,
         team_a_active_agent_ids_json = excluded.team_a_active_agent_ids_json, team_b_active_agent_ids_json = excluded.team_b_active_agent_ids_json,
         winner_team_id = excluded.winner_team_id, round_report_id = excluded.round_report_id,
         started_at = excluded.started_at, completed_at = excluded.completed_at`
      )
      .run(
        toNullable({
          ...item,
          teamAActiveAgentIdsJson: JSON.stringify(item.teamAActiveAgentIds),
          teamBActiveAgentIdsJson: JSON.stringify(item.teamBActiveAgentIds)
        })
      );
  }
}

class RoundReportSqliteRepository implements RoundReportRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<RoundReport | null> {
    const row = this.sqlite.prepare("SELECT * FROM round_reports WHERE id = ?").get(id) as Row | undefined;
    return row ? roundReportSchema.parse(mapRoundReport(row)) : null;
  }

  async getByRoundId(roundId: string): Promise<RoundReport | null> {
    const row = this.sqlite.prepare("SELECT * FROM round_reports WHERE round_id = ?").get(roundId) as Row | undefined;
    return row ? roundReportSchema.parse(mapRoundReport(row)) : null;
  }

  async listByMapGame(mapGameId: string): Promise<RoundReport[]> {
    return (this.sqlite.prepare("SELECT * FROM round_reports WHERE map_game_id = ? ORDER BY round_number ASC").all(mapGameId) as Row[]).map(
      (row) => roundReportSchema.parse(mapRoundReport(row))
    );
  }

  async save(entity: RoundReport): Promise<void> {
    const item = roundReportSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO round_reports (id, tournament_id, match_id, map_game_id, round_id, round_number, map_name, winner_team_id, score_before_round_json, score_after_round_json, judge_result_json, agent_outputs_json, key_events_json, economy_delta_json, token_submission_json, highlight_tags_json, tactical_context_json, summary, event_projection_json, created_at)
         VALUES (@id, @tournamentId, @matchId, @mapGameId, @roundId, @roundNumber, @mapName, @winnerTeamId, @scoreBeforeRoundJson, @scoreAfterRoundJson, @judgeResultJson, @agentOutputsJson, @keyEventsJson, @economyDeltaJson, @tokenSubmissionJson, @highlightTagsJson, @tacticalContextJson, @summary, @eventProjectionJson, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         tournament_id = excluded.tournament_id, match_id = excluded.match_id, map_game_id = excluded.map_game_id,
         round_id = excluded.round_id, round_number = excluded.round_number, map_name = excluded.map_name,
         winner_team_id = excluded.winner_team_id, score_before_round_json = excluded.score_before_round_json,
         score_after_round_json = excluded.score_after_round_json, judge_result_json = excluded.judge_result_json,
         agent_outputs_json = excluded.agent_outputs_json, key_events_json = excluded.key_events_json,
         economy_delta_json = excluded.economy_delta_json, token_submission_json = excluded.token_submission_json,
         highlight_tags_json = excluded.highlight_tags_json, tactical_context_json = excluded.tactical_context_json, summary = excluded.summary,
         event_projection_json = excluded.event_projection_json, created_at = excluded.created_at`
      )
      .run(
        toNullable({
          ...item,
          scoreBeforeRoundJson: JSON.stringify(item.scoreBeforeRound),
          scoreAfterRoundJson: JSON.stringify(item.scoreAfterRound),
          judgeResultJson: JSON.stringify(item.judgeResult),
          agentOutputsJson: JSON.stringify(item.agentOutputs),
          keyEventsJson: JSON.stringify(item.keyEvents),
          economyDeltaJson: JSON.stringify(item.economyDelta),
          tokenSubmissionJson: JSON.stringify(item.tokenSubmission),
          highlightTagsJson: stringifyOptional(item.highlightTags),
          tacticalContextJson: stringifyOptional(item.tacticalContext),
          eventProjectionJson: JSON.stringify(item.eventProjection)
        })
      );
  }
}

class EconomyStateSqliteRepository implements EconomyStateRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<EconomyState | null> {
    const row = this.sqlite.prepare("SELECT * FROM economy_states WHERE id = ?").get(id) as Row | undefined;
    return row ? economyStateSchema.parse(mapEconomyState(row)) : null;
  }

  async getLatestByAgent(agentId: string, mapGameId: string): Promise<EconomyState | null> {
    const row = this.sqlite
      .prepare("SELECT * FROM economy_states WHERE agent_id = ? AND map_game_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(agentId, mapGameId) as Row | undefined;
    return row ? economyStateSchema.parse(mapEconomyState(row)) : null;
  }

  async listByRound(roundId: string): Promise<EconomyState[]> {
    return (this.sqlite.prepare("SELECT * FROM economy_states WHERE round_id = ? ORDER BY agent_id ASC").all(roundId) as Row[]).map(
      (row) => economyStateSchema.parse(mapEconomyState(row))
    );
  }

  async listLatestByMapGame(mapGameId: string): Promise<EconomyState[]> {
    return (this.sqlite.prepare("SELECT * FROM economy_states WHERE map_game_id = ? ORDER BY created_at ASC, agent_id ASC").all(mapGameId) as Row[])
      .map((row) => economyStateSchema.parse(mapEconomyState(row)));
  }

  async save(entity: EconomyState): Promise<void> {
    const item = economyStateSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO economy_states (id, agent_id, team_id, map_game_id, round_id, phase, token_bank, buy_type, loss_streak, timeouts_remaining, visible_context_budget, output_budget, created_at)
         VALUES (@id, @agentId, @teamId, @mapGameId, @roundId, @phase, @tokenBank, @buyType, @lossStreak, @timeoutsRemaining, @visibleContextBudget, @outputBudget, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         agent_id = excluded.agent_id, team_id = excluded.team_id, map_game_id = excluded.map_game_id,
         round_id = excluded.round_id, phase = excluded.phase, token_bank = excluded.token_bank,
         buy_type = excluded.buy_type, loss_streak = excluded.loss_streak, timeouts_remaining = excluded.timeouts_remaining,
         visible_context_budget = excluded.visible_context_budget, output_budget = excluded.output_budget,
         created_at = excluded.created_at`
      )
      .run(toNullable(item));
  }
}

class EventSqliteRepository implements EventRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Event | null> {
    const row = this.sqlite.prepare("SELECT * FROM events WHERE id = ?").get(id) as Row | undefined;
    return row ? eventSchema.parse(mapEvent(row)) : null;
  }

  async append(event: Event): Promise<Event> {
    const item = eventSchema.parse(event);
    await this.save(item);
    const stored = await this.getById(item.id);
    if (!stored) {
      throw new Error(`Event append did not persist event: ${item.id}`);
    }

    return stored;
  }

  async getMaxGlobalSequence(): Promise<number> {
    const row = this.sqlite.prepare("SELECT COALESCE(MAX(global_sequence), 0) AS value FROM events").get() as { value: number };
    return row.value;
  }

  async getMaxSequenceInScope(scopeType: Event["scopeType"], scopeId: string): Promise<number> {
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(sequence_in_scope), 0) AS value FROM events WHERE scope_type = ? AND scope_id = ?")
      .get(scopeType, scopeId) as { value: number };
    return row.value;
  }

  async listByRound(roundId: string): Promise<Event[]> {
    return (this.sqlite.prepare("SELECT * FROM events WHERE round_id = ? ORDER BY global_sequence ASC").all(roundId) as Row[]).map((row) =>
      eventSchema.parse(mapEvent(row))
    );
  }

  async listByMapGame(mapGameId: string): Promise<Event[]> {
    return (this.sqlite.prepare("SELECT * FROM events WHERE map_game_id = ? ORDER BY global_sequence ASC").all(mapGameId) as Row[]).map((row) =>
      eventSchema.parse(mapEvent(row))
    );
  }

  async listByMatch(matchId: string): Promise<Event[]> {
    return (this.sqlite.prepare("SELECT * FROM events WHERE match_id = ? ORDER BY global_sequence ASC").all(matchId) as Row[]).map((row) =>
      eventSchema.parse(mapEvent(row))
    );
  }

  async listByIds(ids: string[]): Promise<Event[]> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(",");
    return (this.sqlite.prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY global_sequence ASC`).all(...ids) as Row[]).map(
      (row) => eventSchema.parse(mapEvent(row))
    );
  }

  async save(entity: Event): Promise<void> {
    const item = eventSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO events (id, type, category, tournament_id, match_id, map_game_id, round_id, payload_json, global_sequence, scope_type, scope_id, sequence_in_scope, timeline_ms, source_module, created_at, updated_at, deleted_at, deleted_reason)
         VALUES (@id, @type, @category, @tournamentId, @matchId, @mapGameId, @roundId, @payloadJson, @globalSequence, @scopeType, @scopeId, @sequenceInScope, @timelineMs, @sourceModule, @createdAt, @updatedAt, @deletedAt, @deletedReason)`
      )
      .run(toNullable({ ...item, payloadJson: JSON.stringify(item.payload) }));
    const stored = await this.getById(item.id);
    if (!stored) {
      throw new Error(`Event save did not persist event: ${item.id}`);
    }
    assertSameLogicalEvent(stored, item);
  }
}

class TimelineEventSqliteRepository implements TimelineEventRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<TimelineEvent | null> {
    const row = this.sqlite.prepare("SELECT * FROM timeline_events WHERE id = ?").get(id) as Row | undefined;
    return row ? timelineEventSchema.parse(mapTimelineEvent(row)) : null;
  }

  async listByRound(roundId: string): Promise<TimelineEvent[]> {
    return (this.sqlite.prepare("SELECT * FROM timeline_events WHERE round_id = ? ORDER BY sequence_index ASC").all(roundId) as Row[]).map(
      (row) => timelineEventSchema.parse(mapTimelineEvent(row))
    );
  }

  async listByMapGame(mapGameId: string): Promise<TimelineEvent[]> {
    return (this.sqlite
      .prepare(
        `SELECT timeline_events.*
         FROM timeline_events
         LEFT JOIN rounds ON rounds.id = timeline_events.round_id
         WHERE timeline_events.map_game_id = ?
         ORDER BY COALESCE(rounds.round_number, 999999) ASC, timeline_events.sequence_index ASC, timeline_events.at_ms ASC, timeline_events.id ASC`
      )
      .all(mapGameId) as Row[]).map((row) => timelineEventSchema.parse(mapTimelineEvent(row)));
  }

  async deleteByRound(roundId: string): Promise<void> {
    this.sqlite.prepare("DELETE FROM timeline_events WHERE round_id = ?").run(roundId);
  }

  async save(entity: TimelineEvent): Promise<void> {
    const item = timelineEventSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO timeline_events (id, tournament_id, match_id, map_game_id, round_id, source_event_ids_json, at_ms, duration_ms, kind, payload_json, playback_scope, playback_scope_id, sequence_index, created_at)
         VALUES (@id, @tournamentId, @matchId, @mapGameId, @roundId, @sourceEventIdsJson, @atMs, @durationMs, @kind, @payloadJson, @playbackScope, @playbackScopeId, @sequenceIndex, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         tournament_id = excluded.tournament_id, match_id = excluded.match_id, map_game_id = excluded.map_game_id,
         round_id = excluded.round_id, source_event_ids_json = excluded.source_event_ids_json,
         at_ms = excluded.at_ms, duration_ms = excluded.duration_ms, kind = excluded.kind,
         payload_json = excluded.payload_json, playback_scope = excluded.playback_scope,
         playback_scope_id = excluded.playback_scope_id, sequence_index = excluded.sequence_index,
         created_at = excluded.created_at`
      )
      .run(toNullable({ ...item, sourceEventIdsJson: JSON.stringify(item.sourceEventIds), payloadJson: JSON.stringify(item.payload) }));
  }
}

class SummarySqliteRepository implements SummaryRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Summary | null> {
    const row = this.sqlite.prepare("SELECT * FROM summaries WHERE id = ?").get(id) as Row | undefined;
    return row ? summarySchema.parse(mapSummary(row)) : null;
  }

  async getLatestByScope(scopeType: Summary["scopeType"], scopeId: string): Promise<Summary | null> {
    const row = this.sqlite
      .prepare("SELECT * FROM summaries WHERE scope_type = ? AND scope_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(scopeType, scopeId) as Row | undefined;
    return row ? summarySchema.parse(mapSummary(row)) : null;
  }

  async save(entity: Summary): Promise<void> {
    const item = summarySchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO summaries (id, summary_type, scope_type, scope_id, tournament_id, match_id, map_game_id, round_id, title, content, payload_json, source_event_ids_json, created_at, updated_at)
         VALUES (@id, @summaryType, @scopeType, @scopeId, @tournamentId, @matchId, @mapGameId, @roundId, @title, @content, @payloadJson, @sourceEventIdsJson, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
         summary_type = excluded.summary_type, scope_type = excluded.scope_type, scope_id = excluded.scope_id,
         tournament_id = excluded.tournament_id, match_id = excluded.match_id, map_game_id = excluded.map_game_id,
         round_id = excluded.round_id, title = excluded.title, content = excluded.content, payload_json = excluded.payload_json,
         source_event_ids_json = excluded.source_event_ids_json, created_at = excluded.created_at, updated_at = excluded.updated_at`
      )
      .run(toNullable({ ...item, payloadJson: stringifyOptional(item.payload), sourceEventIdsJson: JSON.stringify(item.sourceEventIds) }));
  }
}

class ArtifactSqliteRepository implements ArtifactRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Artifact | null> {
    const row = this.sqlite.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Row | undefined;
    return row ? artifactSchema.parse(mapArtifact(row)) : null;
  }

  async save(entity: Artifact): Promise<void> {
    const item = artifactSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO artifacts (id, artifact_type, tournament_id, match_id, map_game_id, round_id, agent_id, uri, mime_type, size_bytes, checksum, status, source_event_ids_json, created_at)
         VALUES (@id, @artifactType, @tournamentId, @matchId, @mapGameId, @roundId, @agentId, @uri, @mimeType, @sizeBytes, @checksum, @status, @sourceEventIdsJson, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         artifact_type = excluded.artifact_type, tournament_id = excluded.tournament_id, match_id = excluded.match_id,
         map_game_id = excluded.map_game_id, round_id = excluded.round_id, agent_id = excluded.agent_id,
         uri = excluded.uri, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, checksum = excluded.checksum,
         status = excluded.status, source_event_ids_json = excluded.source_event_ids_json, created_at = excluded.created_at`
      )
      .run(toNullable({ ...item, sourceEventIdsJson: stringifyOptional(item.sourceEventIds) }));
  }
}

class LlmCallSqliteRepository implements LlmCallRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<LlmCall | null> {
    const row = this.sqlite.prepare("SELECT * FROM llm_calls WHERE id = ?").get(id) as Row | undefined;
    return row ? llmCallSchema.parse(mapLlmCall(row)) : null;
  }

  async save(entity: LlmCall): Promise<void> {
    const item = llmCallSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO llm_calls (id, tournament_id, match_id, round_id, agent_id, driver_model_id, task_type, prompt_hash, request_artifact_id, response_artifact_id, input_tokens, output_tokens, estimated_cost, created_at)
         VALUES (@id, @tournamentId, @matchId, @roundId, @agentId, @driverModelId, @taskType, @promptHash, @requestArtifactId, @responseArtifactId, @inputTokens, @outputTokens, @estimatedCost, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         tournament_id = excluded.tournament_id, match_id = excluded.match_id, round_id = excluded.round_id,
         agent_id = excluded.agent_id, driver_model_id = excluded.driver_model_id, task_type = excluded.task_type,
         prompt_hash = excluded.prompt_hash, request_artifact_id = excluded.request_artifact_id,
         response_artifact_id = excluded.response_artifact_id, input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens, estimated_cost = excluded.estimated_cost, created_at = excluded.created_at`
      )
      .run(toNullable(item));
  }
}

class JobSqliteRepository implements JobRepository {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async getById(id: string): Promise<Job | null> {
    const row = this.sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? jobSchema.parse(mapJob(row)) : null;
  }

  async save(entity: Job): Promise<void> {
    const item = jobSchema.parse(entity);
    this.sqlite
      .prepare(
        `INSERT INTO jobs (id, type, status, priority, payload_json, attempts, max_attempts, run_after, locked_at, completed_at, error_json, created_at)
         VALUES (@id, @type, @status, @priority, @payloadJson, @attempts, @maxAttempts, @runAfter, @lockedAt, @completedAt, @errorJson, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, status = excluded.status, priority = excluded.priority, payload_json = excluded.payload_json,
         attempts = excluded.attempts, max_attempts = excluded.max_attempts, run_after = excluded.run_after,
         locked_at = excluded.locked_at, completed_at = excluded.completed_at, error_json = excluded.error_json,
         created_at = excluded.created_at`
      )
      .run(toNullable({ ...item, payloadJson: JSON.stringify(item.payload), errorJson: stringifyOptional(item.error) }));
  }
}

function mapTournament(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    name: asString(row.name),
    status: asString(row.status),
    format: asString(row.format),
    championTeamId: nullableString(row.champion_team_id),
    createdAt: asString(row.created_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at)
  });
}

function mapTeam(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    tournamentId: asString(row.tournament_id),
    displayName: asString(row.display_name),
    shortName: asString(row.short_name),
    seed: asNumber(row.seed),
    source: parseOptionalJson(row.source_json),
    teamProfileId: nullableString(row.team_profile_id),
    createdAt: asString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  });
}

function mapDriverModel(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    provider: asString(row.provider),
    modelName: asString(row.model_name),
    capabilities: parseJson<string[]>(row.capabilities_json),
    limits: parseOptionalJson(row.limits_json),
    defaultUseCase: parseOptionalJson(row.default_use_case_json),
    enabled: Boolean(row.enabled),
    createdAt: asString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  });
}

function mapAgent(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    teamId: asString(row.team_id),
    driverModelId: asString(row.driver_model_id),
    parameterProfileId: nullableString(row.parameter_profile_id),
    role: asString(row.role),
    displayName: asString(row.display_name),
    baseProfile: parseJson(row.base_profile_json),
    currentState: asString(row.current_state),
    createdAt: asString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  });
}

function mapMatch(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    tournamentId: asString(row.tournament_id),
    roundName: asString(row.round_name),
    teamAId: asString(row.team_a_id),
    teamBId: asString(row.team_b_id),
    status: asString(row.status),
    bestOf: asNumber(row.best_of),
    teamAMapsWon: asNumber(row.team_a_maps_won),
    teamBMapsWon: asNumber(row.team_b_maps_won),
    winnerTeamId: nullableString(row.winner_team_id),
    scheduledOrder: asNumber(row.scheduled_order),
    createdAt: asString(row.created_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at)
  });
}

function mapMapGame(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    matchId: asString(row.match_id),
    mapName: asString(row.map_name),
    order: asNumber(row.map_order),
    status: asString(row.status),
    runControlState: nullableString(row.run_control_state),
    teamAScore: asNumber(row.team_a_score),
    teamBScore: asNumber(row.team_b_score),
    currentRoundNumber: asNumber(row.current_round_number),
    winnerTeamId: nullableString(row.winner_team_id),
    summaryId: nullableString(row.summary_id),
    createdAt: asString(row.created_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at)
  });
}

function mapRound(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    mapGameId: asString(row.map_game_id),
    roundNumber: asNumber(row.round_number),
    status: asString(row.status),
    phase: nullableString(row.phase),
    teamABuyType: nullableString(row.team_a_buy_type),
    teamBBuyType: nullableString(row.team_b_buy_type),
    teamAActiveAgentIds: parseJson<string[]>(row.team_a_active_agent_ids_json),
    teamBActiveAgentIds: parseJson<string[]>(row.team_b_active_agent_ids_json),
    winnerTeamId: nullableString(row.winner_team_id),
    roundReportId: nullableString(row.round_report_id),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at)
  });
}

function mapRoundReport(row: Row) {
  return {
    id: asString(row.id),
    tournamentId: asString(row.tournament_id),
    matchId: asString(row.match_id),
    mapGameId: asString(row.map_game_id),
    roundId: asString(row.round_id),
    roundNumber: asNumber(row.round_number),
    mapName: asString(row.map_name),
    winnerTeamId: asString(row.winner_team_id),
    scoreBeforeRound: parseJson(row.score_before_round_json),
    scoreAfterRound: parseJson(row.score_after_round_json),
    judgeResult: parseJson(row.judge_result_json),
    agentOutputs: parseJson(row.agent_outputs_json),
    keyEvents: parseJson(row.key_events_json),
    economyDelta: parseJson(row.economy_delta_json),
    tokenSubmission: parseJson(row.token_submission_json),
    ...optionalObject("highlightTags", parseOptionalJson(row.highlight_tags_json)),
    ...optionalObject("tacticalContext", parseOptionalJson(row.tactical_context_json)),
    summary: asString(row.summary),
    eventProjection: parseJson(row.event_projection_json),
    createdAt: asString(row.created_at)
  };
}

function mapEconomyState(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    agentId: asString(row.agent_id),
    teamId: asString(row.team_id),
    mapGameId: asString(row.map_game_id),
    roundId: nullableString(row.round_id),
    phase: nullableString(row.phase),
    tokenBank: asNumber(row.token_bank),
    buyType: asString(row.buy_type),
    lossStreak: asNumber(row.loss_streak),
    timeoutsRemaining: asNumber(row.timeouts_remaining),
    visibleContextBudget: nullableNumber(row.visible_context_budget),
    outputBudget: nullableNumber(row.output_budget),
    createdAt: asString(row.created_at)
  });
}

function mapEvent(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    type: asString(row.type),
    category: asString(row.category),
    tournamentId: asString(row.tournament_id),
    matchId: nullableString(row.match_id),
    mapGameId: nullableString(row.map_game_id),
    roundId: nullableString(row.round_id),
    payload: parseJson(row.payload_json),
    globalSequence: asNumber(row.global_sequence),
    scopeType: asString(row.scope_type),
    scopeId: asString(row.scope_id),
    sequenceInScope: asNumber(row.sequence_in_scope),
    timelineMs: nullableNumber(row.timeline_ms),
    sourceModule: nullableString(row.source_module),
    createdAt: asString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    deletedAt: nullableString(row.deleted_at),
    deletedReason: nullableString(row.deleted_reason)
  });
}

function assertSameLogicalEvent(existing: Event, incoming: Event): void {
  const existingLogical = logicalEventForConflict(existing);
  const incomingLogical = logicalEventForConflict(incoming);
  if (JSON.stringify(existingLogical) !== JSON.stringify(incomingLogical)) {
    throw new Error(`Event id conflict with different payload or scope: ${incoming.id}`);
  }
}

function logicalEventForConflict(event: Event): Omit<Event, "globalSequence" | "sequenceInScope"> {
  const { globalSequence: _globalSequence, sequenceInScope: _sequenceInScope, ...logicalEvent } = event;
  return logicalEvent;
}

function mapTimelineEvent(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    tournamentId: asString(row.tournament_id),
    matchId: nullableString(row.match_id),
    mapGameId: nullableString(row.map_game_id),
    roundId: nullableString(row.round_id),
    sourceEventIds: parseJson<string[]>(row.source_event_ids_json),
    atMs: asNumber(row.at_ms),
    durationMs: nullableNumber(row.duration_ms),
    kind: asString(row.kind),
    payload: parseJson(row.payload_json),
    playbackScope: asString(row.playback_scope),
    playbackScopeId: asString(row.playback_scope_id),
    sequenceIndex: asNumber(row.sequence_index),
    createdAt: asString(row.created_at)
  });
}

function mapSummary(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    summaryType: asString(row.summary_type),
    scopeType: asString(row.scope_type),
    scopeId: asString(row.scope_id),
    tournamentId: nullableString(row.tournament_id),
    matchId: nullableString(row.match_id),
    mapGameId: nullableString(row.map_game_id),
    roundId: nullableString(row.round_id),
    title: asString(row.title),
    content: asString(row.content),
    payload: parseOptionalJson(row.payload_json),
    sourceEventIds: parseJson<string[]>(row.source_event_ids_json),
    createdAt: asString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  });
}

function mapArtifact(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    artifactType: asString(row.artifact_type),
    tournamentId: nullableString(row.tournament_id),
    matchId: nullableString(row.match_id),
    mapGameId: nullableString(row.map_game_id),
    roundId: nullableString(row.round_id),
    agentId: nullableString(row.agent_id),
    uri: asString(row.uri),
    mimeType: nullableString(row.mime_type),
    sizeBytes: nullableNumber(row.size_bytes),
    checksum: nullableString(row.checksum),
    status: asString(row.status),
    sourceEventIds: parseOptionalJson(row.source_event_ids_json),
    createdAt: asString(row.created_at)
  });
}

function mapLlmCall(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    tournamentId: nullableString(row.tournament_id),
    matchId: nullableString(row.match_id),
    roundId: nullableString(row.round_id),
    agentId: nullableString(row.agent_id),
    driverModelId: asString(row.driver_model_id),
    taskType: asString(row.task_type),
    promptHash: nullableString(row.prompt_hash),
    requestArtifactId: nullableString(row.request_artifact_id),
    responseArtifactId: nullableString(row.response_artifact_id),
    inputTokens: nullableNumber(row.input_tokens),
    outputTokens: nullableNumber(row.output_tokens),
    estimatedCost: nullableNumber(row.estimated_cost),
    createdAt: asString(row.created_at)
  });
}

function mapJob(row: Row) {
  return removeUndefined({
    id: asString(row.id),
    type: asString(row.type),
    status: asString(row.status),
    priority: asNumber(row.priority),
    payload: parseJson(row.payload_json),
    attempts: asNumber(row.attempts),
    maxAttempts: asNumber(row.max_attempts),
    runAfter: nullableString(row.run_after),
    lockedAt: nullableString(row.locked_at),
    completedAt: nullableString(row.completed_at),
    error: parseOptionalJson(row.error_json),
    createdAt: asString(row.created_at)
  });
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string but received ${typeof value}`);
  }

  return value;
}

function asNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number but received ${typeof value}`);
  }

  return value;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseJson<T = unknown>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

function parseOptionalJson<T = unknown>(value: unknown): T | undefined {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  return parseJson<T>(value);
}

function stringifyOptional(value: unknown): string | null {
  return typeof value === "undefined" ? null : JSON.stringify(value);
}

function toNullable<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === "undefined" ? null : entry]));
}

function optionalObject<TKey extends string, TValue>(key: TKey, value: TValue | undefined): Partial<Record<TKey, TValue>> {
  return typeof value === "undefined" ? {} : { [key]: value } as Record<TKey, TValue>;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined")) as T;
}
