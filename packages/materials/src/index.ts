import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Repositories } from "@agent-major/db";
import {
  agentRoleTags,
  agentRoles,
  type Agent,
  type AgentBaseProfile,
  type AgentMaterialRef,
  type AgentRole,
  type AgentRoleProfile,
  type AgentRoleTag,
  type DriverModel,
  type Match,
  type Team,
  type Tournament
} from "@agent-major/shared";

export const phase17CanonIds = {
  tournamentId: "agent_major_phase17_showcase",
  matchId: "phase17_match_falcon_7b_vs_vitallmty",
  driverModelId: "driver_fake_phase17",
  teamASlug: "falcon-7b",
  teamBSlug: "vitallmty",
  selectedMapIds: ["DUST2", "INFERNO", "MIRAGE"]
} as const;

export const phase17AllowedMapIds = [...phase17CanonIds.selectedMapIds] as const;

export interface ProcessedMaterials {
  projectRoot: string;
  materialsRoot: string;
  processedRoot: string;
  indexes: {
    teams: Record<string, unknown>;
    entities: Record<string, unknown>;
    aliases: Record<string, unknown>;
    roles: Record<string, unknown>;
    llmBindings: Record<string, unknown>;
  };
  teams: ProcessedMaterialTeam[];
  teamsBySlug: Map<string, ProcessedMaterialTeam>;
  entitiesById: Map<string, ProcessedMaterialEntity>;
  rolesByEntityId: Map<string, RoleIndexEntry>;
  llmBindingsByEntityId: Map<string, LlmBindingIndexEntry>;
  aliasesByTargetId: Map<string, string[]>;
}

export interface ProcessedMaterialTeam {
  slug: string;
  teamId: string;
  displayName: string;
  shortName: string;
  seed: number;
  team: Record<string, unknown>;
  roster: MaterialRoster;
  hooks: Record<string, unknown>;
  players: ProcessedMaterialEntity[];
  coachAssets: ProcessedMaterialEntity[];
}

export interface ProcessedMaterialEntity {
  entityId: string;
  entityType: "player" | "coach";
  teamId: string;
  teamSlug: string;
  slug: string;
  displayName: string;
  role: AgentRole;
  status: string;
  jsonPath: string;
  aliases: string[];
  roleProfile: AgentRoleProfile;
  futureDriverBinding: MaterialFutureDriverBinding;
  raw: Record<string, unknown>;
}

export interface RuntimeTeamSeed {
  team: Team;
  agents: Agent[];
  materialTeam: ProcessedMaterialTeam;
}

export interface RuntimeTeamSeedOptions {
  tournamentId?: string;
  createdAt?: string;
  driverModelId?: string;
  runtimeTeamIdPrefix?: string;
  runtimeAgentIdPrefix?: string;
}

export interface Phase17ShowcaseSeedInput {
  repositories: Repositories;
  projectRoot?: string;
  teamASlug?: string;
  teamBSlug?: string;
  selectedMapIds?: string[];
}

export interface Phase17ShowcaseSeedResult {
  materials: ProcessedMaterials;
  tournament: Tournament;
  match: Match;
  teams: [Team, Team];
  agents: Agent[];
  driverModel: DriverModel;
  selectedMapIds: string[];
}

export interface Phase17ShowcaseSelection {
  teamASlug: string;
  teamBSlug: string;
  selectedMapIds: string[];
}

interface MaterialRoster {
  team_id: string;
  active_players: string[];
  head_coach: string | null;
  roster_version?: string;
  source_snapshot_date?: string;
  canon_notes?: string[];
}

interface TeamIndexEntry {
  seed: number;
  team_id: string;
  team_slug: string;
  agent_team_name: string;
  team_json_path: string;
  roster_json_path: string;
  hooks_json_path: string;
}

interface RoleIndexEntry {
  team_id: string;
  team_slug: string;
  entity_id: string;
  entity_type: "player" | "coach";
  display_name: string;
  role: string;
  cs_role_profile: Record<string, unknown>;
}

interface LlmBindingIndexEntry {
  entity_id: string;
  entity_type: "player" | "coach";
  team_id: string;
  team_slug: string;
  display_name: string;
  role: string;
  role_template_id: string;
  preferred_driver_model_id: string;
  fallback_driver_model_ids: string[];
  task_ids: string[];
  model_profile_ids: string[];
  override_ids?: string[];
  runtime_enabled: boolean;
  json_path: string;
  binding_version?: string;
  binding_scope?: string;
}

interface MaterialFutureTaskBinding {
  task_id: string;
  model_profile_id: string;
  driver_model_id: string;
  fallback_driver_model_ids: string[];
  enabled: false;
}

interface MaterialFutureDriverBinding {
  binding_version: string;
  binding_scope: string;
  runtime_enabled: false;
  role_template_id: string;
  preferred_driver_model_id: string;
  fallback_driver_model_ids: string[];
  task_bindings: MaterialFutureTaskBinding[];
  env_contract_refs: string[];
  override_ids: string[];
}

interface ProcessedLlmAssets {
  bindingVersion: string;
  bindingScope: string;
  envContractRefs: Set<string>;
  validDriverModelIds: Set<string>;
  modelProfileIds: Set<string>;
  roleTemplatesById: Map<string, { role: AgentRole; taskIds: Set<string> }>;
  overridesById: Map<string, { entityId: string; taskIds: Set<string>; modelProfileIds: Set<string> }>;
}

const validPrimaryRoles = new Set<string>(agentRoles);
const validRoleTags = new Set<string>(agentRoleTags);
const phase17AllowedMapIdSet = new Set<string>(phase17AllowedMapIds);
const defaultCreatedAt = "2026-05-01T00:00:00.000Z";

export function resolvePhase17ShowcaseSelection(input: {
  teamASlug?: string;
  teamBSlug?: string;
  selectedMapIds?: string[];
} = {}): Phase17ShowcaseSelection {
  const teamASlug = normalizePhase17TeamSlug(input.teamASlug ?? phase17CanonIds.teamASlug, "teamASlug");
  const teamBSlug = normalizePhase17TeamSlug(input.teamBSlug ?? phase17CanonIds.teamBSlug, "teamBSlug");
  assert(teamASlug !== teamBSlug, `Phase 1.7 showcase requires two distinct team slugs, received ${teamASlug}.`);

  const rawMapIds = input.selectedMapIds && input.selectedMapIds.length > 0 ? input.selectedMapIds : [...phase17AllowedMapIds];
  const selectedMapIds = rawMapIds.map((mapId) => normalizePhase17MapId(mapId));
  assert(selectedMapIds.length === 3, `Phase 1.7 showcase requires exactly 3 maps, received ${selectedMapIds.length}.`);
  assert(new Set(selectedMapIds).size === selectedMapIds.length, "Phase 1.7 showcase maps must be unique.");
  for (const mapId of selectedMapIds) {
    assert(
      phase17AllowedMapIdSet.has(mapId),
      `Phase 1.7 showcase only supports ${phase17AllowedMapIds.join(", ")}. Received ${mapId}.`
    );
  }

  return { teamASlug, teamBSlug, selectedMapIds };
}

export function loadProcessedMaterials(projectRoot = process.cwd()): ProcessedMaterials {
  const root = findProjectRoot(projectRoot);
  const materialsRoot = resolve(root, "data", "materials");
  const processedRoot = join(materialsRoot, "processed");
  const teamsRoot = join(processedRoot, "teams");
  const indexesRoot = join(processedRoot, "indexes");
  assertExists(processedRoot, "processed materials root");

  const teamsIndex = readJsonObject(join(indexesRoot, "teams.index.json"));
  const entitiesIndex = readJsonObject(join(indexesRoot, "entities.index.json"));
  const aliasesIndex = readJsonObject(join(indexesRoot, "aliases.index.json"));
  const rolesIndex = readJsonObject(join(indexesRoot, "roles.index.json"));
  const llmBindingsIndex = readJsonObject(join(indexesRoot, "llm-bindings.index.json"));
  const llmAssets = readProcessedLlmAssets(root, materialsRoot, llmBindingsIndex);

  const teamRefs = readArray<TeamIndexEntry>(teamsIndex.teams, "teams.index.json teams");
  const roleEntries = readArray<RoleIndexEntry>(rolesIndex.entries, "roles.index.json entries");
  const llmBindingEntries = readArray<LlmBindingIndexEntry>(llmBindingsIndex.entities, "llm-bindings.index.json entities");
  const aliasEntries = readArray<Record<string, unknown>>(aliasesIndex.entries, "aliases.index.json entries");
  const teamDirs = readdirSync(teamsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  assert(teamDirs.length === 16, `Expected 16 processed team directories, found ${teamDirs.length}.`);
  assert(teamRefs.length === 16, `Expected 16 teams in teams.index.json, found ${teamRefs.length}.`);

  const rolesByEntityId = new Map<string, RoleIndexEntry>();
  for (const entry of roleEntries) {
    assert(!rolesByEntityId.has(entry.entity_id), `Duplicate role index entity: ${entry.entity_id}.`);
    assertPrimaryRole(entry.role, `roles.index.json:${entry.entity_id}`);
    rolesByEntityId.set(entry.entity_id, entry);
  }

  const llmBindingsByEntityId = new Map<string, LlmBindingIndexEntry>();
  for (const entry of llmBindingEntries) {
    assert(!llmBindingsByEntityId.has(entry.entity_id), `Duplicate LLM binding entity: ${entry.entity_id}.`);
    assert(entry.runtime_enabled === false, `LLM binding index entry ${entry.entity_id} must have runtime_enabled=false.`);
    assertPrimaryRole(entry.role, `llm-bindings.index.json:${entry.entity_id}`);
    assertPrimaryRole(entry.role, `llm-bindings.index.json:${entry.entity_id}.role`);
    const roleTemplate = llmAssets.roleTemplatesById.get(entry.role_template_id);
    assert(roleTemplate, `LLM binding ${entry.entity_id} references unknown role template ${entry.role_template_id}.`);
    assert(roleTemplate.role === entry.role, `LLM binding ${entry.entity_id} role template role mismatch for ${entry.role_template_id}.`);
    assertDriverIds([entry.preferred_driver_model_id, ...entry.fallback_driver_model_ids], llmAssets.validDriverModelIds, `LLM binding ${entry.entity_id}`);
    const allowedTaskIds = allowedTaskIdsForEntity(roleTemplate.taskIds, entry.override_ids ?? [], llmAssets, `LLM binding ${entry.entity_id}`);
    for (const taskId of entry.task_ids) {
      assert(allowedTaskIds.has(taskId), `LLM binding ${entry.entity_id} references unknown task ${taskId} for role template ${entry.role_template_id}.`);
    }
    for (const profileId of entry.model_profile_ids) {
      assert(llmAssets.modelProfileIds.has(profileId), `LLM binding ${entry.entity_id} references unknown model profile ${profileId}.`);
    }
    for (const overrideId of entry.override_ids ?? []) {
      const override = llmAssets.overridesById.get(overrideId);
      assert(override, `LLM binding ${entry.entity_id} references unknown override ${overrideId}.`);
      assert(override.entityId === entry.entity_id, `LLM binding ${entry.entity_id} override ${overrideId} belongs to ${override.entityId}.`);
    }
    if (entry.binding_version) {
      assert(entry.binding_version === llmAssets.bindingVersion, `LLM binding ${entry.entity_id} has unexpected binding version ${entry.binding_version}.`);
    }
    if (entry.binding_scope) {
      assert(entry.binding_scope === llmAssets.bindingScope, `LLM binding ${entry.entity_id} has unexpected binding scope ${entry.binding_scope}.`);
    }
    llmBindingsByEntityId.set(entry.entity_id, entry);
  }

  const aliasesByTargetId = buildAliasesByTargetId(aliasEntries);
  const entitiesById = new Map<string, ProcessedMaterialEntity>();
  const teams: ProcessedMaterialTeam[] = [];

  for (const teamRef of teamRefs) {
    const team = readJsonObject(materialFilePath(materialsRoot, teamRef.team_json_path));
    const roster = readRoster(materialFilePath(materialsRoot, teamRef.roster_json_path), teamRef.team_slug);
    const hooks = readJsonObject(materialFilePath(materialsRoot, teamRef.hooks_json_path));
    const teamId = readString(team.team_id, `${teamRef.team_slug}.team_id`);
    const displayName = readString(team.agent_team_name, `${teamRef.team_slug}.agent_team_name`);
    const teamSlug = readString(team.team_slug, `${teamRef.team_slug}.team_slug`);

    assert(teamId === teamRef.team_id, `Team id mismatch for ${teamRef.team_slug}.`);
    assert(teamSlug === teamRef.team_slug, `Team slug mismatch for ${teamRef.team_slug}.`);
    assertTeamHooks(hooks, teamId, teamRef.team_slug);
    assert(roster.active_players.length === 5, `${teamRef.team_slug} must have exactly 5 active players.`);

    const teamDir = join(teamsRoot, teamRef.team_slug);
    const players = readEntityDirectory(join(teamDir, "players"), teamRef.team_slug, aliasesByTargetId, rolesByEntityId, llmBindingsByEntityId, llmAssets);
    const coachAssets = readEntityDirectory(join(teamDir, "coach"), teamRef.team_slug, aliasesByTargetId, rolesByEntityId, llmBindingsByEntityId, llmAssets);
    assert(players.length === 5, `${teamRef.team_slug} must have exactly 5 player entities.`);
    assert(coachAssets.length === 1, `${teamRef.team_slug} must have exactly 1 coach asset.`);

    for (const playerId of roster.active_players) {
      assert(players.some((player) => player.entityId === playerId), `${teamRef.team_slug} active roster references missing player ${playerId}.`);
    }

    if (teamRef.team_slug === "phaseclan") {
      assert(roster.head_coach === null, "PhaseClan head_coach must be null for Phase 1.7 runtime seeding.");
    } else {
      assert(typeof roster.head_coach === "string", `${teamRef.team_slug} must have a head_coach entity id.`);
      assert(coachAssets.some((coach) => coach.entityId === roster.head_coach), `${teamRef.team_slug} head_coach references missing coach asset.`);
    }

    const materialTeam: ProcessedMaterialTeam = {
      slug: teamRef.team_slug,
      teamId,
      displayName,
      shortName: displayName,
      seed: teamRef.seed,
      team,
      roster,
      hooks,
      players,
      coachAssets
    };
    teams.push(materialTeam);
    for (const entity of [...players, ...coachAssets]) {
      assert(!entitiesById.has(entity.entityId), `Duplicate processed entity id: ${entity.entityId}.`);
      entitiesById.set(entity.entityId, entity);
    }
  }

  assert(roleEntries.length === entitiesById.size, `roles.index.json size ${roleEntries.length} does not match entity file count ${entitiesById.size}.`);
  assert(llmBindingEntries.length === entitiesById.size, `llm-bindings.index.json size ${llmBindingEntries.length} does not match entity file count ${entitiesById.size}.`);

  for (const entity of readArray<Record<string, unknown>>(entitiesIndex.entities, "entities.index.json entities")) {
    const entityId = readString(entity.entity_id, "entities.index.json entity_id");
    assert(entitiesById.has(entityId), `entities.index.json references missing entity ${entityId}.`);
    assertPrimaryRole(readString(entity.role, `${entityId}.role`), `entities.index.json:${entityId}`);
  }
  for (const entityId of new Set([...llmAssets.overridesById.values()].map((override) => override.entityId))) {
    assert(entitiesById.has(entityId), `LLM agent binding override references missing entity ${entityId}.`);
  }

  const teamsBySlug = new Map(teams.map((team) => [team.slug, team]));
  return {
    projectRoot: root,
    materialsRoot,
    processedRoot,
    indexes: {
      teams: teamsIndex,
      entities: entitiesIndex,
      aliases: aliasesIndex,
      roles: rolesIndex,
      llmBindings: llmBindingsIndex
    },
    teams,
    teamsBySlug,
    entitiesById,
    rolesByEntityId,
    llmBindingsByEntityId,
    aliasesByTargetId
  };
}

export function buildRuntimeTeamSeed(
  materials: ProcessedMaterials,
  teamSlug: string,
  options: RuntimeTeamSeedOptions = {}
): RuntimeTeamSeed {
  const materialTeam = materials.teamsBySlug.get(teamSlug);
  assert(materialTeam, `Unknown processed team slug: ${teamSlug}.`);

  const tournamentId = options.tournamentId ?? phase17CanonIds.tournamentId;
  const createdAt = options.createdAt ?? defaultCreatedAt;
  const driverModelId = options.driverModelId ?? phase17CanonIds.driverModelId;
  const runtimeTeamIdPrefix = options.runtimeTeamIdPrefix ?? "team_phase17";
  const runtimeAgentIdPrefix = options.runtimeAgentIdPrefix ?? "agent_phase17";
  const teamId = `${runtimeTeamIdPrefix}_${slugId(teamSlug)}`;
  const team: Team = {
    id: teamId,
    tournamentId,
    displayName: materialTeam.displayName,
    shortName: materialTeam.shortName,
    seed: materialTeam.seed,
    source: {
      phase: "1.7-materials-runtime",
      materialTeamId: materialTeam.teamId,
      materialTeamSlug: materialTeam.slug,
      rosterVersion: materialTeam.roster.roster_version,
      headCoachImported: typeof materialTeam.roster.head_coach === "string"
    },
    createdAt
  };

  const activePlayerEntities = materialTeam.roster.active_players.map((entityId) => requiredEntity(materials, entityId));
  const coachEntities = materialTeam.roster.head_coach ? [requiredEntity(materials, materialTeam.roster.head_coach)] : [];
  const runtimeEntities = [...activePlayerEntities, ...coachEntities];
  const agents = runtimeEntities.map((entity) =>
    buildAgentFromMaterialEntity({
      entity,
      teamId,
      driverModelId,
      runtimeAgentIdPrefix,
      createdAt
    })
  );

  return { team, agents, materialTeam };
}

export async function seedPhase17ShowcaseMatch(input: Phase17ShowcaseSeedInput): Promise<Phase17ShowcaseSeedResult> {
  const { teamASlug, teamBSlug, selectedMapIds } = resolvePhase17ShowcaseSelection(input);
  const materials = loadProcessedMaterials(input.projectRoot);
  const createdAt = defaultCreatedAt;
  const tournament: Tournament = {
    id: phase17CanonIds.tournamentId,
    name: "Agent Major Phase 1.7 Materials Showcase",
    status: "running",
    format: "single_elimination_16",
    createdAt,
    startedAt: createdAt
  };
  const driverModel: DriverModel = {
    id: phase17CanonIds.driverModelId,
    provider: "fake",
    modelName: "fake-provider-phase17",
    capabilities: ["structured_output", "deterministic", "materials_seed"],
    defaultUseCase: ["agent_action", "judge", "round_report"],
    enabled: true,
    createdAt
  };
  const teamASeed = buildRuntimeTeamSeed(materials, teamASlug, { tournamentId: tournament.id, createdAt, driverModelId: driverModel.id });
  const teamBSeed = buildRuntimeTeamSeed(materials, teamBSlug, { tournamentId: tournament.id, createdAt, driverModelId: driverModel.id });
  const match: Match = {
    id: buildPhase17MatchId(teamASlug, teamBSlug),
    tournamentId: tournament.id,
    roundName: "round_of_16",
    teamAId: teamASeed.team.id,
    teamBId: teamBSeed.team.id,
    status: "scheduled",
    bestOf: 3,
    teamAMapsWon: 0,
    teamBMapsWon: 0,
    scheduledOrder: 1,
    createdAt
  };

  await input.repositories.tournaments.save(tournament);
  await input.repositories.driverModels.save(driverModel);
  await input.repositories.teams.save(teamASeed.team);
  await input.repositories.teams.save(teamBSeed.team);
  await input.repositories.matches.save(match);
  for (const agent of [...teamASeed.agents, ...teamBSeed.agents]) {
    await input.repositories.agents.save(agent);
  }

  return {
    materials,
    tournament,
    match,
    teams: [teamASeed.team, teamBSeed.team],
    agents: [...teamASeed.agents, ...teamBSeed.agents],
    driverModel,
    selectedMapIds
  };
}

export function normalizeMaterialRoleProfile(entityId: string, value: unknown): AgentRoleProfile {
  const profile = asRecord(value, `${entityId}.cs_role_profile`);
  const primaryRole = assertPrimaryRole(readString(profile.primary_role, `${entityId}.cs_role_profile.primary_role`), `${entityId}.cs_role_profile.primary_role`);
  const secondaryRoles = readRoleTags(profile.secondary_roles, `${entityId}.cs_role_profile.secondary_roles`);
  const positionTags = readRoleTags(profile.position_tags, `${entityId}.cs_role_profile.position_tags`);
  const notes = readOptionalString(profile.notes);
  return {
    sourcePath: readString(profile.source_path, `${entityId}.cs_role_profile.source_path`),
    sourceTeamName: readString(profile.source_team_name, `${entityId}.cs_role_profile.source_team_name`),
    memberType: readMemberType(profile.member_type, `${entityId}.cs_role_profile.member_type`),
    rawPosition: readString(profile.raw_position, `${entityId}.cs_role_profile.raw_position`),
    rawPositionParts: readStringArray(profile.raw_position_parts, `${entityId}.cs_role_profile.raw_position_parts`),
    primaryRole,
    secondaryRoles,
    positionTags,
    confidence: readString(profile.confidence, `${entityId}.cs_role_profile.confidence`),
    ...(notes ? { notes } : {}),
    agentMajorResponsibilities: readStringArray(profile.agent_major_responsibilities, `${entityId}.cs_role_profile.agent_major_responsibilities`)
  };
}

function readEntityDirectory(
  directory: string,
  teamSlug: string,
  aliasesByTargetId: Map<string, string[]>,
  rolesByEntityId: Map<string, RoleIndexEntry>,
  llmBindingsByEntityId: Map<string, LlmBindingIndexEntry>,
  llmAssets: ProcessedLlmAssets
): ProcessedMaterialEntity[] {
  assertExists(directory, `${teamSlug} entity directory`);
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".agent.json"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => readMaterialEntity(join(directory, fileName), teamSlug, aliasesByTargetId, rolesByEntityId, llmBindingsByEntityId, llmAssets));
}

function readMaterialEntity(
  filePath: string,
  teamSlug: string,
  aliasesByTargetId: Map<string, string[]>,
  rolesByEntityId: Map<string, RoleIndexEntry>,
  llmBindingsByEntityId: Map<string, LlmBindingIndexEntry>,
  llmAssets: ProcessedLlmAssets
): ProcessedMaterialEntity {
  const raw = readJsonObject(filePath);
  const entityId = readString(raw.entity_id, `${filePath}.entity_id`);
  const entityType = readEntityType(raw.entity_type, `${entityId}.entity_type`);
  const teamId = readString(raw.team_id, `${entityId}.team_id`);
  const role = assertPrimaryRole(readString(raw.role, `${entityId}.role`), `${entityId}.role`);
  const displayName = readString(raw.display_name, `${entityId}.display_name`);
  const roleProfile = normalizeMaterialRoleProfile(entityId, raw.cs_role_profile);
  assert(roleProfile.primaryRole === role, `${entityId} role mismatch: role=${role}, cs_role_profile.primary_role=${roleProfile.primaryRole}.`);
  const futureDriverBinding = readFutureDriverBinding(entityId, raw.future_driver_binding, llmAssets);
  const roleIndexEntry = rolesByEntityId.get(entityId);
  const llmBindingIndexEntry = llmBindingsByEntityId.get(entityId);
  assert(roleIndexEntry, `roles.index.json missing ${entityId}.`);
  assert(llmBindingIndexEntry, `llm-bindings.index.json missing ${entityId}.`);
  assert(roleIndexEntry.entity_type === entityType, `roles.index.json entity type mismatch for ${entityId}.`);
  assert(roleIndexEntry.team_id === teamId, `roles.index.json team id mismatch for ${entityId}.`);
  assert(roleIndexEntry.team_slug === teamSlug, `roles.index.json team slug mismatch for ${entityId}.`);
  assert(roleIndexEntry.display_name === displayName, `roles.index.json display name mismatch for ${entityId}.`);
  assert(roleIndexEntry.role === role, `roles.index.json role mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.entity_type === entityType, `llm-bindings.index.json entity type mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.team_id === teamId, `llm-bindings.index.json team id mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.team_slug === teamSlug, `llm-bindings.index.json team slug mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.display_name === displayName, `llm-bindings.index.json display name mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.role === role, `llm-bindings.index.json role mismatch for ${entityId}.`);
  assert(llmBindingIndexEntry.runtime_enabled === false, `${entityId} LLM binding must stay runtime disabled.`);
  assert(futureDriverBinding.role_template_id === llmBindingIndexEntry.role_template_id, `${entityId} role template mismatch between raw agent and LLM binding index.`);
  assert(
    futureDriverBinding.preferred_driver_model_id === llmBindingIndexEntry.preferred_driver_model_id,
    `${entityId} preferred driver mismatch between raw agent and LLM binding index.`
  );
  assert(
    stringSetsEqual(futureDriverBinding.fallback_driver_model_ids, llmBindingIndexEntry.fallback_driver_model_ids),
    `${entityId} fallback driver mismatch between raw agent and LLM binding index.`
  );
  assert(
    stringSetsEqual(
      futureDriverBinding.task_bindings.map((binding) => binding.task_id),
      llmBindingIndexEntry.task_ids
    ),
    `${entityId} task binding mismatch between raw agent and LLM binding index.`
  );
  assert(
    stringSetsEqual(
      uniqueStrings(futureDriverBinding.task_bindings.map((binding) => binding.model_profile_id)),
      uniqueStrings(llmBindingIndexEntry.model_profile_ids)
    ),
    `${entityId} model profile mismatch between raw agent and LLM binding index.`
  );
  assert(
    stringSetsEqual(uniqueStrings(futureDriverBinding.override_ids), uniqueStrings(llmBindingIndexEntry.override_ids ?? [])),
    `${entityId} override mismatch between raw agent and LLM binding index.`
  );

  return {
    entityId,
    entityType,
    teamId,
    teamSlug,
    slug: readString(raw.slug, `${entityId}.slug`),
    displayName,
    role,
    status: readString(raw.status, `${entityId}.status`),
    jsonPath: llmBindingIndexEntry.json_path,
    aliases: uniqueStrings([...readStringArray(raw.aliases, `${entityId}.aliases`), ...(aliasesByTargetId.get(entityId) ?? [])]),
    roleProfile,
    futureDriverBinding,
    raw
  };
}

function buildAgentFromMaterialEntity(input: {
  entity: ProcessedMaterialEntity;
  teamId: string;
  driverModelId: string;
  runtimeAgentIdPrefix: string;
  createdAt: string;
}): Agent {
  const baseProfile = buildBaseProfile(input.entity);
  const materialRef = buildMaterialRef(input.entity);
  const secondaryRoles = input.entity.roleProfile.secondaryRoles.length > 0 ? input.entity.roleProfile.secondaryRoles : undefined;
  return {
    id: `${input.runtimeAgentIdPrefix}_${slugId(input.entity.entityId)}`,
    teamId: input.teamId,
    driverModelId: input.driverModelId,
    role: input.entity.role,
    ...(secondaryRoles ? { secondaryRoles } : {}),
    displayName: input.entity.displayName,
    baseProfile,
    roleProfile: input.entity.roleProfile,
    materialRef,
    currentState: "ready",
    createdAt: input.createdAt
  };
}

function buildBaseProfile(entity: ProcessedMaterialEntity): AgentBaseProfile {
  const futureProfile = asOptionalRecord(entity.raw.future_agent_profile);
  const personaSummary = readOptionalString(futureProfile?.persona_summary) ?? `${entity.displayName} canonical Phase 1.7 materials persona.`;
  const responsibilities = entity.roleProfile.agentMajorResponsibilities.join(" ");
  return {
    personalitySummary: personaSummary,
    tacticalSummary: `${entity.roleProfile.rawPosition}; ${responsibilities || "executes assigned role responsibilities."}`,
    styleTags: uniqueStrings([
      ...readStringArray(entity.raw.persona_tags, `${entity.entityId}.persona_tags`),
      ...readStringArray(entity.raw.playstyle_tags, `${entity.entityId}.playstyle_tags`),
      ...readStringArray(entity.raw.meme_tags, `${entity.entityId}.meme_tags`),
      ...entity.roleProfile.positionTags,
      entity.role
    ])
  };
}

function buildMaterialRef(entity: ProcessedMaterialEntity): AgentMaterialRef {
  const binding = entity.futureDriverBinding;
  return {
    entityId: entity.entityId,
    entityType: entity.entityType,
    teamSlug: entity.teamSlug,
    jsonPath: entity.jsonPath,
    ...(entity.aliases.length > 0 ? { aliases: entity.aliases } : {}),
    bindingVersion: binding.binding_version,
    bindingScope: binding.binding_scope,
    runtimeEnabled: false,
    roleTemplateId: binding.role_template_id
  };
}

function readRoster(filePath: string, teamSlug: string): MaterialRoster {
  const roster = readJsonObject(filePath);
  const headCoach = roster.head_coach;
  const rosterVersion = readOptionalString(roster.roster_version);
  const sourceSnapshotDate = readOptionalString(roster.source_snapshot_date);
  assert(headCoach === null || typeof headCoach === "string", `${teamSlug}.roster.head_coach must be string or null.`);
  return {
    team_id: readString(roster.team_id, `${teamSlug}.roster.team_id`),
    active_players: readStringArray(roster.active_players, `${teamSlug}.roster.active_players`),
    head_coach: headCoach,
    ...(rosterVersion ? { roster_version: rosterVersion } : {}),
    ...(sourceSnapshotDate ? { source_snapshot_date: sourceSnapshotDate } : {}),
    canon_notes: readStringArray(roster.canon_notes, `${teamSlug}.roster.canon_notes`)
  };
}

function assertTeamHooks(hooks: Record<string, unknown>, teamId: string, teamSlug: string): void {
  assert(readString(hooks.team_id, `${teamSlug}.hooks.team_id`) === teamId, `${teamSlug}.hooks.team_id does not match team id.`);
  for (const key of [
    "caster_angle_ids",
    "barrage_angle_ids",
    "news_angle_ids",
    "cross_circle_angle_ids",
    "signature_memes",
    "storyline_triggers",
    "matchup_triggers",
    "win_state_triggers",
    "loss_state_triggers",
    "highlight_triggers"
  ]) {
    const items = readStringArray(hooks[key], `${teamSlug}.hooks.${key}`);
    assert(items.length > 0, `${teamSlug}.hooks.${key} must not be empty.`);
  }
}

function readProcessedLlmAssets(projectRoot: string, materialsRoot: string, llmBindingsIndex: Record<string, unknown>): ProcessedLlmAssets {
  assert(llmBindingsIndex.runtime_enabled === false, "llm-bindings.index.json runtime_enabled must be false.");
  const bindingVersion = readString(llmBindingsIndex.version, "llm-bindings.index.json version");
  const bindingScope = readString(llmBindingsIndex.binding_scope, "llm-bindings.index.json binding_scope");
  const modelProfiles = readJsonObject(materialFilePath(materialsRoot, readString(llmBindingsIndex.model_profiles_path, "llm-bindings.index.json model_profiles_path")));
  const roleTemplates = readJsonObject(
    materialFilePath(materialsRoot, readString(llmBindingsIndex.role_binding_templates_path, "llm-bindings.index.json role_binding_templates_path"))
  );
  const agentOverrides = readJsonObject(
    materialFilePath(materialsRoot, readString(llmBindingsIndex.agent_binding_overrides_path, "llm-bindings.index.json agent_binding_overrides_path"))
  );
  const validDriverModelIds = loadRuntimeDriverModelIds(projectRoot);

  assert(modelProfiles.runtime_enabled === false, "processed LLM model profiles must have runtime_enabled=false.");
  assert(roleTemplates.runtime_enabled === false, "processed LLM role binding templates must have runtime_enabled=false.");
  assert(agentOverrides.runtime_enabled === false, "processed LLM agent binding overrides must have runtime_enabled=false.");
  assert(readString(modelProfiles.version, "llm model profiles version") === bindingVersion, "LLM model profiles version mismatch.");
  assert(readString(roleTemplates.version, "llm role templates version") === bindingVersion, "LLM role templates version mismatch.");
  assert(readString(agentOverrides.version, "llm agent overrides version") === bindingVersion, "LLM agent overrides version mismatch.");
  assert(readString(modelProfiles.binding_scope, "llm model profiles binding_scope") === bindingScope, "LLM model profiles binding scope mismatch.");
  assert(readString(roleTemplates.binding_scope, "llm role templates binding_scope") === bindingScope, "LLM role templates binding scope mismatch.");
  assert(readString(agentOverrides.binding_scope, "llm agent overrides binding_scope") === bindingScope, "LLM agent overrides binding scope mismatch.");
  assert(validDriverModelIds.size > 0, "No runtime driver model ids were found in packages/llm/src/model-registry.ts.");

  const envContractRefs = new Set(readStringArray(modelProfiles.env_contract_refs, "llm model profiles env_contract_refs"));
  assert(envContractRefs.has("DASHSCOPE_API_KEY"), "Processed LLM env contract refs must include DASHSCOPE_API_KEY.");

  const modelProfileIds = new Set<string>();
  for (const profile of readArray<Record<string, unknown>>(modelProfiles.profiles, "llm model profiles")) {
    const profileId = readString(profile.id, "llm model profile id");
    assert(!modelProfileIds.has(profileId), `Duplicate LLM model profile id: ${profileId}.`);
    assert(profile.runtime_enabled === false, `${profileId}.runtime_enabled must be false.`);
    assertDriverIds(
      [readString(profile.primary_driver_model_id, `${profileId}.primary_driver_model_id`), ...readStringArray(profile.fallback_driver_model_ids, `${profileId}.fallback_driver_model_ids`)],
      validDriverModelIds,
      profileId
    );
    modelProfileIds.add(profileId);
  }

  const roleTemplatesById = new Map<string, { role: AgentRole; taskIds: Set<string> }>();
  for (const template of readArray<Record<string, unknown>>(roleTemplates.templates, "llm role templates")) {
    const templateId = readString(template.template_id, "llm role template template_id");
    assert(!roleTemplatesById.has(templateId), `Duplicate LLM role template id: ${templateId}.`);
    const templateRole = assertPrimaryRole(readString(template.role, `${templateId}.role`), `${templateId}.role`);
    assert(template.runtime_enabled === false, `${templateId}.runtime_enabled must be false.`);
    assert(template.enabled === undefined || template.enabled === false, `${templateId}.enabled must be false when present.`);
    assertDriverIds(
      [
        readString(template.preferred_driver_model_id, `${templateId}.preferred_driver_model_id`),
        ...readStringArray(template.fallback_driver_model_ids, `${templateId}.fallback_driver_model_ids`)
      ],
      validDriverModelIds,
      templateId
    );
    const taskIds = new Set<string>();
    for (const taskBinding of readArray<Record<string, unknown>>(template.task_bindings, `${templateId}.task_bindings`)) {
      const taskId = readString(taskBinding.task_id, `${templateId}.task_bindings.task_id`);
      assert(!taskIds.has(taskId), `${templateId} contains duplicate task binding ${taskId}.`);
      assert(taskBinding.enabled === false, `${templateId}.task_bindings enabled must be false.`);
      assert(modelProfileIds.has(readString(taskBinding.model_profile_id, `${templateId}.${taskId}.model_profile_id`)), `${templateId} references unknown model profile in task binding ${taskId}.`);
      assertDriverIds(
        [
          readString(taskBinding.driver_model_id, `${templateId}.${taskId}.driver_model_id`),
          ...readStringArray(taskBinding.fallback_driver_model_ids, `${templateId}.${taskId}.fallback_driver_model_ids`)
        ],
        validDriverModelIds,
        `${templateId}:${taskId}`
      );
      taskIds.add(taskId);
    }
    roleTemplatesById.set(templateId, { role: templateRole, taskIds });
  }

  const overridesById = new Map<string, { entityId: string; taskIds: Set<string>; modelProfileIds: Set<string> }>();
  for (const override of readArray<Record<string, unknown>>(agentOverrides.overrides, "llm agent overrides")) {
    const overrideId = readString(override.override_id, "llm agent override id");
    assert(override.runtime_enabled === false, `${overrideId}.runtime_enabled must be false.`);
    assertPrimaryRole(readString(override.role, `${overrideId}.role`), `${overrideId}.role`);
    const modelProfileIdsForOverride = new Set(readStringArray(override.applied_model_profile_ids, `${overrideId}.applied_model_profile_ids`));
    for (const profileId of modelProfileIdsForOverride) {
      assert(modelProfileIds.has(profileId), `${overrideId} references unknown model profile ${profileId}.`);
    }
    const entityId = readString(override.entity_id, `${overrideId}.entity_id`);
    overridesById.set(overrideId, {
      entityId,
      taskIds: new Set(readStringArray(override.applied_task_ids, `${overrideId}.applied_task_ids`)),
      modelProfileIds: modelProfileIdsForOverride
    });
  }

  return {
    bindingVersion,
    bindingScope,
    envContractRefs,
    validDriverModelIds,
    modelProfileIds,
    roleTemplatesById,
    overridesById
  };
}

function readFutureDriverBinding(entityId: string, value: unknown, llmAssets: ProcessedLlmAssets): MaterialFutureDriverBinding {
  const binding = asRecord(value, `${entityId}.future_driver_binding`);
  assert(binding.runtime_enabled === false, `${entityId}.future_driver_binding.runtime_enabled must be false.`);
  const bindingVersion = readString(binding.binding_version, `${entityId}.future_driver_binding.binding_version`);
  const bindingScope = readString(binding.binding_scope, `${entityId}.future_driver_binding.binding_scope`);
  const roleTemplateId = readString(binding.role_template_id, `${entityId}.future_driver_binding.role_template_id`);
  const roleTemplate = llmAssets.roleTemplatesById.get(roleTemplateId);
  assert(roleTemplate, `${entityId}.future_driver_binding references unknown role template ${roleTemplateId}.`);
  const preferredDriverModelId = readString(binding.preferred_driver_model_id, `${entityId}.future_driver_binding.preferred_driver_model_id`);
  const fallbackDriverModelIds = readStringArray(binding.fallback_driver_model_ids, `${entityId}.future_driver_binding.fallback_driver_model_ids`);
  assert(bindingVersion === llmAssets.bindingVersion, `${entityId}.future_driver_binding has unexpected binding version ${bindingVersion}.`);
  assert(bindingScope === llmAssets.bindingScope, `${entityId}.future_driver_binding has unexpected binding scope ${bindingScope}.`);
  assertDriverIds([preferredDriverModelId, ...fallbackDriverModelIds], llmAssets.validDriverModelIds, `${entityId}.future_driver_binding`);

  const overrideIds = readStringArray(binding.override_ids ?? [], `${entityId}.future_driver_binding.override_ids`);
  for (const overrideId of overrideIds) {
    const override = llmAssets.overridesById.get(overrideId);
    assert(override, `${entityId}.future_driver_binding references unknown override ${overrideId}.`);
    assert(override.entityId === entityId, `${entityId}.future_driver_binding override ${overrideId} belongs to ${override.entityId}.`);
  }
  const allowedTaskIds = allowedTaskIdsForEntity(roleTemplate.taskIds, overrideIds, llmAssets, `${entityId}.future_driver_binding`);

  const taskBindings = readArray<Record<string, unknown>>(binding.task_bindings, `${entityId}.future_driver_binding.task_bindings`).map((taskBinding) => {
    const taskId = readString(taskBinding.task_id, `${entityId}.future_driver_binding.task_bindings.task_id`);
    assert(allowedTaskIds.has(taskId), `${entityId}.future_driver_binding references unknown task ${taskId} for ${roleTemplateId}.`);
    const modelProfileId = readString(taskBinding.model_profile_id, `${entityId}.future_driver_binding.${taskId}.model_profile_id`);
    assert(llmAssets.modelProfileIds.has(modelProfileId), `${entityId}.future_driver_binding references unknown model profile ${modelProfileId}.`);
    const driverModelId = readString(taskBinding.driver_model_id, `${entityId}.future_driver_binding.${taskId}.driver_model_id`);
    const taskFallbackDriverModelIds = readStringArray(
      taskBinding.fallback_driver_model_ids,
      `${entityId}.future_driver_binding.${taskId}.fallback_driver_model_ids`
    );
    assert(taskBinding.enabled === false, `${entityId}.future_driver_binding.${taskId}.enabled must be false.`);
    assertDriverIds([driverModelId, ...taskFallbackDriverModelIds], llmAssets.validDriverModelIds, `${entityId}.future_driver_binding:${taskId}`);
    return {
      task_id: taskId,
      model_profile_id: modelProfileId,
      driver_model_id: driverModelId,
      fallback_driver_model_ids: taskFallbackDriverModelIds,
      enabled: false as const
    };
  });

  const envContractRefs = readStringArray(binding.env_contract_refs, `${entityId}.future_driver_binding.env_contract_refs`);
  assert(envContractRefs.includes("DASHSCOPE_API_KEY"), `${entityId}.future_driver_binding must include DASHSCOPE_API_KEY in env_contract_refs.`);
  for (const envContractRef of envContractRefs) {
    assert(llmAssets.envContractRefs.has(envContractRef), `${entityId}.future_driver_binding references unknown env contract ${envContractRef}.`);
  }

  return {
    binding_version: bindingVersion,
    binding_scope: bindingScope,
    runtime_enabled: false,
    role_template_id: roleTemplateId,
    preferred_driver_model_id: preferredDriverModelId,
    fallback_driver_model_ids: fallbackDriverModelIds,
    task_bindings: taskBindings,
    env_contract_refs: envContractRefs,
    override_ids: overrideIds
  };
}

function requiredEntity(materials: ProcessedMaterials, entityId: string): ProcessedMaterialEntity {
  const entity = materials.entitiesById.get(entityId);
  assert(entity, `Processed entity not found: ${entityId}.`);
  return entity;
}

function buildPhase17MatchId(teamASlug: string, teamBSlug: string): string {
  if (teamASlug === phase17CanonIds.teamASlug && teamBSlug === phase17CanonIds.teamBSlug) {
    return phase17CanonIds.matchId;
  }

  return `phase17_match_${slugId(teamASlug)}_vs_${slugId(teamBSlug)}`;
}

function buildAliasesByTargetId(entries: Record<string, unknown>[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const entry of entries) {
    const alias = readOptionalString(entry.alias);
    const targetIds = readStringArray(entry.target_ids, "aliases.index.json target_ids");
    if (!alias) {
      continue;
    }
    for (const targetId of targetIds) {
      output.set(targetId, uniqueStrings([...(output.get(targetId) ?? []), alias]));
    }
  }
  return output;
}

function materialFilePath(materialsRoot: string, indexedPath: string): string {
  const normalized = indexedPath.replaceAll("\\", "/").replace(/^processed\//, "");
  return join(materialsRoot, "processed", normalized);
}

function findProjectRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
  return resolve(startDirectory);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  assertExists(filePath, "json file");
  const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return asRecord(value, filePath);
}

function assertExists(filePath: string, label: string): void {
  assert(existsSync(filePath), `Missing ${label}: ${filePath}.`);
}

function readArray<T>(value: unknown, label: string): T[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  return value as T[];
}

function readString(value: unknown, label: string): string {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string.`);
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  return value.map((item, index) => readString(item, `${label}[${index}]`));
}

function readRoleTags(value: unknown, label: string): AgentRoleTag[] {
  return readStringArray(value, label).map((item) => {
    assert(validRoleTags.has(item), `${label} contains unknown role tag: ${item}.`);
    return item as AgentRoleTag;
  });
}

function readEntityType(value: unknown, label: string): "player" | "coach" {
  assert(value === "player" || value === "coach", `${label} must be player or coach.`);
  return value;
}

function readMemberType(value: unknown, label: string): "player" | "coach" {
  assert(value === "player" || value === "coach", `${label} must be player or coach.`);
  return value;
}

function assertPrimaryRole(value: string, label: string): AgentRole {
  assert(validPrimaryRoles.has(value), `${label} contains unknown primary role: ${value}.`);
  return value as AgentRole;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function loadRuntimeDriverModelIds(projectRoot: string): Set<string> {
  const registryPath = resolve(projectRoot, "packages", "llm", "src", "model-registry.ts");
  const source = readFileSync(registryPath, "utf8");
  return new Set([...source.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]).filter((id): id is string => typeof id === "string" && id.length > 0));
}

function assertDriverIds(driverIds: string[], validDriverModelIds: Set<string>, context: string): void {
  for (const driverId of driverIds) {
    assert(validDriverModelIds.has(driverId), `${context} references unknown driver model id: ${driverId}.`);
  }
}

function stringSetsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return new Set(left).size === left.length && left.every((item) => rightSet.has(item));
}

function allowedTaskIdsForEntity(
  baseTaskIds: Set<string>,
  overrideIds: string[],
  llmAssets: ProcessedLlmAssets,
  context: string
): Set<string> {
  const allowedTaskIds = new Set(baseTaskIds);
  for (const overrideId of overrideIds) {
    const override = llmAssets.overridesById.get(overrideId);
    assert(override, `${context} references unknown override ${overrideId}.`);
    for (const taskId of override.taskIds) {
      allowedTaskIds.add(taskId);
    }
  }

  return allowedTaskIds;
}

function normalizePhase17TeamSlug(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  assert(normalized.length > 0, `${label} must be a non-empty string.`);
  return normalized;
}

function normalizePhase17MapId(value: string): string {
  const normalized = value.trim().toUpperCase();
  assert(normalized.length > 0, "Phase 1.7 showcase map ids must be non-empty strings.");
  return normalized;
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
