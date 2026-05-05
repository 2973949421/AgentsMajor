-- Phase 1.0 migration draft.
-- This file is a hand-written schema draft aligned with packages/shared contracts.

CREATE TABLE `tournaments` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL,
  `format` text NOT NULL,
  `champion_team_id` text,
  `created_at` text NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE TABLE `teams` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text NOT NULL,
  `display_name` text NOT NULL,
  `short_name` text NOT NULL,
  `seed` integer NOT NULL,
  `source_json` text,
  `team_profile_id` text,
  `created_at` text NOT NULL,
  `updated_at` text
);
--> statement-breakpoint
CREATE TABLE `driver_models` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `model_name` text NOT NULL,
  `capabilities_json` text NOT NULL,
  `limits_json` text,
  `default_use_case_json` text,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text
);
--> statement-breakpoint
CREATE TABLE `agents` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL,
  `driver_model_id` text NOT NULL,
  `parameter_profile_id` text,
  `role` text NOT NULL,
  `display_name` text NOT NULL,
  `base_profile_json` text NOT NULL,
  `current_state` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text
);
--> statement-breakpoint
CREATE TABLE `matches` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text NOT NULL,
  `round_name` text NOT NULL,
  `team_a_id` text NOT NULL,
  `team_b_id` text NOT NULL,
  `status` text NOT NULL,
  `best_of` integer NOT NULL,
  `team_a_maps_won` integer DEFAULT 0 NOT NULL,
  `team_b_maps_won` integer DEFAULT 0 NOT NULL,
  `winner_team_id` text,
  `scheduled_order` integer NOT NULL,
  `created_at` text NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE TABLE `simulation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `fixture_id` text NOT NULL,
  `status` text NOT NULL,
  `requested_mode` text NOT NULL,
  `runtime_match_id` text NOT NULL,
  `runtime_map_game_id` text,
  `baseline_completed_rounds` integer DEFAULT 0 NOT NULL,
  `estimated_total_rounds` integer DEFAULT 0 NOT NULL,
  `expected_total_calls` integer DEFAULT 0 NOT NULL,
  `latest_committed_round_number` integer DEFAULT 0 NOT NULL,
  `has_fresh_replay` integer DEFAULT false NOT NULL,
  `latest_error` text,
  `created_at` text NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE TABLE `map_games` (
  `id` text PRIMARY KEY NOT NULL,
  `match_id` text NOT NULL,
  `map_name` text NOT NULL,
  `map_order` integer NOT NULL,
  `status` text NOT NULL,
  `run_control_state` text,
  `team_a_score` integer DEFAULT 0 NOT NULL,
  `team_b_score` integer DEFAULT 0 NOT NULL,
  `current_round_number` integer DEFAULT 0 NOT NULL,
  `winner_team_id` text,
  `summary_id` text,
  `created_at` text NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE TABLE `rounds` (
  `id` text PRIMARY KEY NOT NULL,
  `map_game_id` text NOT NULL,
  `round_number` integer NOT NULL,
  `status` text NOT NULL,
  `phase` text,
  `team_a_buy_type` text,
  `team_b_buy_type` text,
  `team_a_active_agent_ids_json` text NOT NULL,
  `team_b_active_agent_ids_json` text NOT NULL,
  `winner_team_id` text,
  `round_report_id` text,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE TABLE `round_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text NOT NULL,
  `match_id` text NOT NULL,
  `map_game_id` text NOT NULL,
  `round_id` text NOT NULL,
  `round_number` integer NOT NULL,
  `map_name` text NOT NULL,
  `winner_team_id` text NOT NULL,
  `score_before_round_json` text NOT NULL,
  `score_after_round_json` text NOT NULL,
  `judge_result_json` text NOT NULL,
  `agent_outputs_json` text NOT NULL,
  `key_events_json` text NOT NULL,
  `economy_delta_json` text NOT NULL,
  `token_submission_json` text NOT NULL,
  `highlight_tags_json` text,
  `summary` text NOT NULL,
  `event_projection_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `economy_states` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `team_id` text NOT NULL,
  `map_game_id` text NOT NULL,
  `round_id` text,
  `phase` text,
  `token_bank` integer NOT NULL,
  `buy_type` text NOT NULL,
  `loss_streak` integer NOT NULL,
  `timeouts_remaining` integer NOT NULL,
  `visible_context_budget` integer,
  `output_budget` integer,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `category` text NOT NULL,
  `tournament_id` text NOT NULL,
  `match_id` text,
  `map_game_id` text,
  `round_id` text,
  `payload_json` text NOT NULL,
  `global_sequence` integer NOT NULL,
  `scope_type` text NOT NULL,
  `scope_id` text NOT NULL,
  `sequence_in_scope` integer NOT NULL,
  `timeline_ms` integer,
  `source_module` text,
  `created_at` text NOT NULL,
  `updated_at` text,
  `deleted_at` text,
  `deleted_reason` text
);
--> statement-breakpoint
CREATE TABLE `timeline_events` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text NOT NULL,
  `match_id` text,
  `map_game_id` text,
  `round_id` text,
  `source_event_ids_json` text NOT NULL,
  `at_ms` integer NOT NULL,
  `duration_ms` integer,
  `kind` text NOT NULL,
  `payload_json` text NOT NULL,
  `playback_scope` text NOT NULL,
  `playback_scope_id` text NOT NULL,
  `sequence_index` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_type` text NOT NULL,
  `tournament_id` text,
  `match_id` text,
  `map_game_id` text,
  `round_id` text,
  `agent_id` text,
  `uri` text NOT NULL,
  `mime_type` text,
  `size_bytes` integer,
  `checksum` text,
  `status` text NOT NULL,
  `source_event_ids_json` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text,
  `match_id` text,
  `round_id` text,
  `agent_id` text,
  `driver_model_id` text NOT NULL,
  `task_type` text NOT NULL,
  `prompt_hash` text,
  `request_artifact_id` text,
  `response_artifact_id` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `estimated_cost` real,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `priority` integer NOT NULL,
  `payload_json` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `run_after` text,
  `locked_at` text,
  `completed_at` text,
  `error_json` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text NOT NULL,
  `action` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` text NOT NULL
);
