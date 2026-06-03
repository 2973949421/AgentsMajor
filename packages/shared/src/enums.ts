export const tournamentStatuses = ["draft", "running", "completed", "archived"] as const;
export type TournamentStatus = (typeof tournamentStatuses)[number];

export const tournamentFormats = ["single_elimination_16"] as const;
export type TournamentFormat = (typeof tournamentFormats)[number];

export const matchStatuses = ["scheduled", "veto", "running", "completed", "failed", "cancelled"] as const;
export type MatchStatus = (typeof matchStatuses)[number];

export const matchRoundNames = ["round_of_16", "quarterfinal", "semifinal", "final"] as const;
export type MatchRoundName = (typeof matchRoundNames)[number];

export const mapGameStatuses = ["scheduled", "running", "completed", "overtime", "failed", "cancelled"] as const;
export type MapGameStatus = (typeof mapGameStatuses)[number];

export const roundStatuses = ["scheduled", "running", "judging", "completed", "failed"] as const;
export type RoundStatus = (typeof roundStatuses)[number];

export const roundPhases = ["buying", "generating", "output_gate", "judging", "reporting", "committing"] as const;
export type RoundPhase = (typeof roundPhases)[number];

export const runControlStates = [
  "idle",
  "running_map",
  "review_window",
  "operator_pause",
  "technical_pause",
  "map_review_window",
  "waiting_for_next_map"
] as const;
export type RunControlState = (typeof runControlStates)[number];

export const simulationRunStatuses = ["scheduled", "running", "completed", "failed", "discarded"] as const;
export type SimulationRunStatus = (typeof simulationRunStatuses)[number];

export const simulationRunModes = ["phase18_next_round", "phase18_current_map", "phase18_keep_generating_map", "phase18_full_bo3"] as const;
export type SimulationRunMode = (typeof simulationRunModes)[number];

export const agentRoles = ["coach", "igl", "awper", "entry", "star_rifler", "lurker", "support", "rifler", "stand_in"] as const;
export type AgentRole = (typeof agentRoles)[number];

export const agentRoleTags = ["anchor", "awper", "closer", "coach", "entry", "flex", "igl", "lurker", "rifler", "stand_in", "star_rifler", "support", "system_architect"] as const;
export type AgentRoleTag = (typeof agentRoleTags)[number];

export const agentStates = ["ready", "active", "down", "hot", "cold", "lowEco", "clutch", "boosted", "tilted", "resting"] as const;
export type AgentState = (typeof agentStates)[number];

export const buyTypes = ["fullBuy", "halfBuy", "eco", "forceBuy", "save"] as const;
export type BuyType = (typeof buyTypes)[number];

export const economyPostures = [
  "pistol_round",
  "full_eco",
  "eco",
  "pistol_armor_force",
  "light_buy",
  "force_buy",
  "half_buy",
  "bonus_round",
  "rifle_buy",
  "awp_buy",
  "double_awp",
  "broken_buy",
  "save_play"
] as const;
export type EconomyPosture = (typeof economyPostures)[number];

export const loadoutPackages = [
  "pistol_round_pack",
  "pistol_eco_pack",
  "pistol_armor_force_pack",
  "smg_force_pack",
  "rifle_low_t_pack",
  "rifle_low_ct_pack",
  "rifle_full_t_pack",
  "rifle_full_ct_pack",
  "awp_pack",
  "bonus_carry_pack",
  "save_support_pack",
  "broken_buy_pack"
] as const;
export type LoadoutPackage = (typeof loadoutPackages)[number];

export const sideAssignmentHalves = ["first_half", "second_half", "overtime"] as const;
export type SideAssignmentHalf = (typeof sideAssignmentHalves)[number];

export const zoneResourceIntents = [
  "attack_execute",
  "attack_feint",
  "info_control",
  "defense_anchor",
  "defense_rotate",
  "economy_pressure"
] as const;
export type ZoneResourceIntent = (typeof zoneResourceIntents)[number];

export const attackApproaches = ["fast_execute", "slow_control", "mid_control_then_execute", "fake_then_rotate", "eco_steal", "default_probe"] as const;
export type AttackApproach = (typeof attackApproaches)[number];

export const defenseSetups = ["heavy_a", "heavy_b", "default_split", "mid_push", "retake_setup", "save_weak_hold"] as const;
export type DefenseSetup = (typeof defenseSetups)[number];

export const rotatePolicies = ["fast_rotate", "hold_sites", "info_first", "save_first"] as const;
export type RotatePolicy = (typeof rotatePolicies)[number];

export const tacticalCollisionResults = ["attack_breakthrough", "defense_hold", "trade_even", "fake_success", "rotate_success", "economy_steal"] as const;
export type TacticalCollisionResult = (typeof tacticalCollisionResults)[number];

export const tacticalEventVisibilities = ["restricted", "public_after_round"] as const;
export type TacticalEventVisibility = (typeof tacticalEventVisibilities)[number];

export const eventCategories = [
  "simulation",
  "system",
  "judge",
  "economy",
  "broadcast",
  "timeline",
  "stats",
  "media",
  "admin",
  "runtime_control"
] as const;
export type EventCategory = (typeof eventCategories)[number];

export const eventTypes = [
  "tournament_created",
  "tournament_started",
  "match_created",
  "match_started",
  "map_veto_completed",
  "map_started",
  "round_started",
  "side_assignment_created",
  "tactical_plan_submitted",
  "zone_deployment_committed",
  "agent_output_submitted",
  "site_execute_resolved",
  "round_completed",
  "map_completed",
  "match_completed",
  "tournament_completed",
  "judge_decision_created",
  "judge_evidence_score_materialized",
  "score_updated",
  "round_report_created",
  "economy_snapshot_created",
  "buy_type_decided",
  "drop_created",
  "economy_updated",
  "timeout_used",
  "coach_timeout_correction_created",
  "coach_post_match_review_created",
  "coach_post_match_review_approved",
  "coach_post_match_review_dismissed",
  "save_called",
  "force_buy_called",
  "output_gate_applied",
  "kill_feed_created",
  "caster_line_created",
  "barrage_created",
  "support_rate_updated",
  "highlight_detected",
  "replay_card_created",
  "stats_updated",
  "rating_updated",
  "award_granted",
  "article_generated",
  "interview_generated",
  "daily_recap_generated",
  "llm_call_started",
  "llm_call_completed",
  "llm_call_failed",
  "round_generation_stage_started",
  "round_generation_stage_validated",
  "round_generation_stage_failed",
  "round_generation_stage_reused",
  "admin_correction_applied",
  "event_revision_created",
  "event_soft_deleted",
  "artifact_saved",
  "review_window_started",
  "review_window_expired",
  "review_pause_requested",
  "operator_pause_started",
  "operator_pause_resolved",
  "technical_pause_started",
  "technical_pause_resolved",
  "web_run_execution_started",
  "web_run_execution_finished",
  "round_generation_attempt_started",
  "round_generation_attempt_finished",
  "round_generation_attempt_retrying",
  "round_generation_attempt_terminal_failed",
  "score_tension_diagnostic",
  "map_review_window_started",
  "map_review_window_confirmed"
] as const;
export type EventType = (typeof eventTypes)[number];

export const timelineEventKinds = [
  "round_intro",
  "scoreboard_update",
  "economy_panel_update",
  "agent_state_update",
  "map_control_update",
  "kill_feed_item",
  "caster_line",
  "barrage_stream",
  "highlight_reveal",
  "round_result",
  "round_outro",
  "pause_marker"
] as const;
export type TimelineEventKind = (typeof timelineEventKinds)[number];

export const playbackScopes = ["round", "map", "match"] as const;
export type PlaybackScope = (typeof playbackScopes)[number];

export const eventScopeTypes = ["tournament", "match", "map", "round"] as const;
export type EventScopeType = (typeof eventScopeTypes)[number];
