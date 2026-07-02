import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const processedRoot = path.join(materialsRoot, "processed");
const teamsRoot = path.join(processedRoot, "teams");
const indexesRoot = path.join(processedRoot, "indexes");
const styleRoot = path.join(processedRoot, "style");
const llmRoot = path.join(processedRoot, "llm");
const runtimeModelRegistryPath = path.resolve(materialsRoot, "..", "..", "packages", "llm", "src", "model-registry.ts");
const sharedEnumsPath = path.resolve(materialsRoot, "..", "..", "packages", "shared", "src", "enums.ts");
const LLM_BINDING_VERSION = "2026-05-03-llm-binding-v1";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadRuntimeDriverModelIds() {
  const source = fs.readFileSync(runtimeModelRegistryPath, "utf8");
  return new Set([...source.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]));
}

function loadSharedEnumValues(exportName) {
  const source = fs.readFileSync(sharedEnumsPath, "utf8");
  const match = new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const;`).exec(source);
  assert(match, `Unable to parse ${exportName} from packages/shared/src/enums.ts.`);
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]));
}

function assertDriverIds(driverIds, validDriverIds, context) {
  for (const driverId of driverIds) {
    assert(validDriverIds.has(driverId), `${context} references unknown driver model id: ${driverId}`);
  }
}

function assertRoleProfileAccepted(roleProfile, context) {
  assert(roleProfile?.primary_role, `${context} must include cs_role_profile.primary_role.`);
  assert(validPrimaryRoles.has(roleProfile.primary_role), `${context} primary_role is not accepted by shared schema: ${roleProfile.primary_role}`);
  for (const roleTag of roleProfile.secondary_roles ?? []) {
    assert(validRoleTags.has(roleTag), `${context} secondary_roles contains unknown role tag: ${roleTag}`);
  }
  for (const roleTag of roleProfile.position_tags ?? []) {
    assert(validRoleTags.has(roleTag), `${context} position_tags contains unknown role tag: ${roleTag}`);
  }
}

function scanForSecretMaterial(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const forbiddenPatterns = [
    /sk-[a-zA-Z0-9_-]{16,}/,
    /Bearer\s+[a-zA-Z0-9._-]{20,}/,
    /"api[_-]?key"\s*:\s*"[^"]{8,}"/i,
    /"token"\s*:\s*"[^"]{12,}"/i,
    /"secret"\s*:\s*"[^"]{12,}"/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(source), `Potential secret material found in ${filePath}`);
  }
}

const validCasterIds = new Set(readJson(path.join(styleRoot, "caster", "reaction-patterns.json")).patterns.map((item) => item.id));
const validBarrageIds = new Set(readJson(path.join(styleRoot, "barrage", "meme-taxonomy.json")).taxonomy.map((item) => item.id));
const validNewsIds = new Set(readJson(path.join(styleRoot, "news", "news-angle-taxonomy.json")).angles.map((item) => item.id));
const validCrossIds = new Set(readJson(path.join(styleRoot, "cross-circle", "transfer-patterns.json")).patterns.map((item) => item.id));

const teamsIndex = readJson(path.join(indexesRoot, "teams.index.json"));
const entitiesIndex = readJson(path.join(indexesRoot, "entities.index.json"));
const aliasesIndex = readJson(path.join(indexesRoot, "aliases.index.json"));
const rolesIndex = readJson(path.join(indexesRoot, "roles.index.json"));
const llmBindingsIndex = readJson(path.join(indexesRoot, "llm-bindings.index.json"));
const llmModelProfilesRegistry = readJson(path.join(llmRoot, "model-profiles.json"));
const llmRoleBindingTemplatesRegistry = readJson(path.join(llmRoot, "role-binding-templates.json"));
const agentBindingOverridesRegistry = readJson(path.join(llmRoot, "agent-binding-overrides.json"));
const validRuntimeDriverIds = loadRuntimeDriverModelIds();
const validPrimaryRoles = loadSharedEnumValues("agentRoles");
const validRoleTags = loadSharedEnumValues("agentRoleTags");
const validModelProfileIds = new Set(llmModelProfilesRegistry.profiles.map((profile) => profile.id));
const validRoleTemplateIds = new Set(llmRoleBindingTemplatesRegistry.templates.map((template) => template.template_id));
const canonicalPlayerRoles = new Set(["igl", "awper", "entry", "lurker", "rifler"]);
const legacyPlayerPrimaryRoles = new Set(["support", "anchor", "flex", "star_rifler", "entry_fragger", "stand_in"]);
const validOverrideIds = new Set(agentBindingOverridesRegistry.overrides.map((override) => override.override_id));

const teamDirs = fs.readdirSync(teamsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
assert(teamDirs.length === 16, `Expected 16 team directories, found ${teamDirs.length}.`);
assert(teamsIndex.teams.length === 16, `Expected 16 teams in teams.index.json, found ${teamsIndex.teams.length}.`);
assert(llmModelProfilesRegistry.version === LLM_BINDING_VERSION, "model-profiles.json has unexpected LLM binding version.");
assert(llmRoleBindingTemplatesRegistry.version === LLM_BINDING_VERSION, "role-binding-templates.json has unexpected LLM binding version.");
assert(agentBindingOverridesRegistry.version === LLM_BINDING_VERSION, "agent-binding-overrides.json has unexpected LLM binding version.");
assert(llmBindingsIndex.version === LLM_BINDING_VERSION, "llm-bindings.index.json has unexpected LLM binding version.");
assert(validRuntimeDriverIds.size > 0, "No runtime driver model ids were parsed from packages/llm/src/model-registry.ts.");

for (const profile of llmModelProfilesRegistry.profiles) {
  assert(profile.runtime_enabled === false, `${profile.id} runtime_enabled must stay false for v1.`);
  assertDriverIds([profile.primary_driver_model_id, ...profile.fallback_driver_model_ids], validRuntimeDriverIds, profile.id);
}

for (const template of llmRoleBindingTemplatesRegistry.templates) {
  assert(template.runtime_enabled === false, `${template.template_id} runtime_enabled must stay false for v1.`);
  assertDriverIds([template.preferred_driver_model_id, ...template.fallback_driver_model_ids], validRuntimeDriverIds, template.template_id);
  for (const binding of template.task_bindings) {
    assert(validModelProfileIds.has(binding.model_profile_id), `${template.template_id} references unknown model profile ${binding.model_profile_id}.`);
    assert(binding.enabled === false, `${template.template_id}:${binding.task_id} must be disabled for v1.`);
    assertDriverIds([binding.driver_model_id, ...binding.fallback_driver_model_ids], validRuntimeDriverIds, `${template.template_id}:${binding.task_id}`);
  }
}

for (const fileName of ["model-profiles.json", "role-binding-templates.json", "agent-binding-overrides.json"]) {
  scanForSecretMaterial(path.join(llmRoot, fileName));
}

function validateFutureDriverBinding(entity) {
  const binding = entity.future_driver_binding;
  assert(binding, `${entity.entity_id} must include future_driver_binding.`);
  assert(binding.binding_version === LLM_BINDING_VERSION, `${entity.entity_id} has unexpected LLM binding version.`);
  assert(binding.binding_scope === "asset_preallocation", `${entity.entity_id} must use asset_preallocation binding scope.`);
  assert(binding.runtime_enabled === false, `${entity.entity_id} runtime_enabled must stay false for v1.`);
  assert(validRoleTemplateIds.has(binding.role_template_id), `${entity.entity_id} references unknown role template ${binding.role_template_id}.`);
  assertDriverIds([binding.preferred_driver_model_id, ...binding.fallback_driver_model_ids], validRuntimeDriverIds, entity.entity_id);
  assert(Array.isArray(binding.task_bindings) && binding.task_bindings.length >= 1, `${entity.entity_id} must include at least one LLM task binding.`);
  assert(Array.isArray(binding.env_contract_refs) && binding.env_contract_refs.includes("DASHSCOPE_API_KEY"), `${entity.entity_id} must reference the LLM env contract names.`);

  for (const taskBinding of binding.task_bindings) {
    assert(taskBinding.enabled === false, `${entity.entity_id}:${taskBinding.task_id} must be disabled for v1.`);
    assert(validModelProfileIds.has(taskBinding.model_profile_id), `${entity.entity_id}:${taskBinding.task_id} references unknown model profile ${taskBinding.model_profile_id}.`);
    assertDriverIds([taskBinding.driver_model_id, ...taskBinding.fallback_driver_model_ids], validRuntimeDriverIds, `${entity.entity_id}:${taskBinding.task_id}`);
  }

  for (const overrideId of binding.override_ids ?? []) {
    assert(validOverrideIds.has(overrideId), `${entity.entity_id} references unknown override ${overrideId}.`);
  }
}

function validateInitialProposal(initialProposal, teamRef) {
  assert(initialProposal.teamId === teamRef.team_id, `${teamRef.team_slug} initial proposal teamId mismatch.`);
  assert(initialProposal.teamSlug === teamRef.team_slug, `${teamRef.team_slug} initial proposal teamSlug mismatch.`);
  assert(typeof initialProposal.proposalId === "string" && initialProposal.proposalId.length > 0, `${teamRef.team_slug} proposalId is required.`);
  assert(typeof initialProposal.version === "string" && initialProposal.version.length > 0, `${teamRef.team_slug} proposal version is required.`);
  for (const field of [
    "displayName",
    "teamThesis",
    "opportunity",
    "product",
    "engineering",
    "business",
    "operations",
    "scaling",
    "moat",
    "frontendSummary"
  ]) {
    assert(
      typeof initialProposal[field] === "string" && initialProposal[field].length > 0,
      `${teamRef.team_slug} initial proposal ${field} is required.`
    );
  }
  for (const field of ["mustHoldClaims", "failureModes", "playerOperatingPrinciples"]) {
    assert(
      Array.isArray(initialProposal[field]) && initialProposal[field].length > 0,
      `${teamRef.team_slug} initial proposal ${field} must be a non-empty array.`
    );
    assert(
      initialProposal[field].every((item) => typeof item === "string" && item.length > 0),
      `${teamRef.team_slug} initial proposal ${field} must contain non-empty strings.`
    );
  }
  assert(initialProposal.coachWindowPolicies && typeof initialProposal.coachWindowPolicies === "object", `${teamRef.team_slug} coachWindowPolicies is required.`);
  for (const key of ["timeout", "postMatchReview"]) {
    assert(
      typeof initialProposal.coachWindowPolicies[key] === "string" && initialProposal.coachWindowPolicies[key].length > 0,
      `${teamRef.team_slug} initial proposal coachWindowPolicies.${key} is required.`
    );
  }
  for (const forbiddenField of [
    "map_slug",
    "proposal_stage",
    "proposal_version",
    "dust2_visible_layer",
    "must_defend",
    "attack_priorities",
    "acceptable_tradeoffs",
    "round_themes",
    "role_assignments",
    "coach_windows",
    "loss_conditions",
    "success_definition"
  ]) {
    assert(initialProposal[forbiddenField] === undefined, `${teamRef.team_slug} initial proposal must not contain legacy map-specific field ${forbiddenField}.`);
  }
}

const entityFileIds = new Set();

for (const teamRef of teamsIndex.teams) {
  const teamDir = path.join(teamsRoot, teamRef.team_slug);
  const teamJsonPath = path.join(teamDir, "team.json");
  const rosterJsonPath = path.join(teamDir, "roster.json");
  const hooksJsonPath = path.join(teamDir, "hooks.json");
  assert(fs.existsSync(teamJsonPath), `Missing ${teamJsonPath}`);
  assert(fs.existsSync(rosterJsonPath), `Missing ${rosterJsonPath}`);
  assert(fs.existsSync(hooksJsonPath), `Missing ${hooksJsonPath}`);
  assert(fs.existsSync(path.join(processedRoot, teamRef.team_json_path.replace(/^processed[\\/]/, ""))), `Missing indexed team path for ${teamRef.team_slug}.`);
  assert(fs.existsSync(path.join(processedRoot, teamRef.roster_json_path.replace(/^processed[\\/]/, ""))), `Missing indexed roster path for ${teamRef.team_slug}.`);
  assert(fs.existsSync(path.join(processedRoot, teamRef.hooks_json_path.replace(/^processed[\\/]/, ""))), `Missing indexed hooks path for ${teamRef.team_slug}.`);

  const teamJson = readJson(teamJsonPath);
  const rosterJson = readJson(rosterJsonPath);
  const hooksJson = readJson(hooksJsonPath);
  const initialProposalJsonPath = teamRef.initial_proposal_json_path
    ? path.join(processedRoot, teamRef.initial_proposal_json_path.replace(/^processed[\\/]/, ""))
    : null;

  assert(teamJson.team_id === teamRef.team_id, `Team id mismatch for ${teamRef.team_slug}.`);
  assert(rosterJson.active_players.length === 5, `${teamRef.team_slug} must have 5 active players.`);
  if (initialProposalJsonPath) {
    assert(fs.existsSync(initialProposalJsonPath), `Missing indexed initial proposal path for ${teamRef.team_slug}.`);
  }
  if (teamJson.processed_paths?.initial_proposal) {
    const teamInitialProposalPath = path.join(processedRoot, String(teamJson.processed_paths.initial_proposal).replace(/^processed[\\/]/, ""));
    assert(fs.existsSync(teamInitialProposalPath), `Missing team.processed_paths.initial_proposal for ${teamRef.team_slug}.`);
    const initialProposalJson = readJson(teamInitialProposalPath);
    validateInitialProposal(initialProposalJson, teamRef);
    if (initialProposalJsonPath) {
      assert(
        teamJson.processed_paths.initial_proposal === teamRef.initial_proposal_json_path,
        `${teamRef.team_slug} initial proposal path mismatch between team.json and teams.index.json.`
      );
    }
  } else {
    assert(
      !initialProposalJsonPath,
      `${teamRef.team_slug} teams.index.json declares initial_proposal_json_path but team.json.processed_paths.initial_proposal is missing.`
    );
  }

  if (["falcon-7b", "vitallmty"].includes(teamRef.team_slug)) {
    assert(Boolean(initialProposalJsonPath), `${teamRef.team_slug} must provide a team-root initial-proposal.json.`);
    const legacyStrategyPath = path.join(teamDir, "strategy.json");
    const legacyMapProposalPath = path.join(teamDir, "maps", "dust2", "initial-proposal.json");
    assert(!fs.existsSync(legacyStrategyPath), `${teamRef.team_slug} legacy strategy.json must be removed.`);
    assert(!fs.existsSync(legacyMapProposalPath), `${teamRef.team_slug} legacy Dust2 initial-proposal.json must be removed.`);
  }

  if (teamRef.team_slug === "phaseclan") {
    assert(rosterJson.head_coach === null, "PhaseClan head_coach must be null until canon confirms a coach.");
  } else {
    assert(typeof rosterJson.head_coach === "string" && rosterJson.head_coach.length > 0, `${teamRef.team_slug} must have a head coach.`);
  }

  for (const id of hooksJson.caster_angle_ids) {
    assert(validCasterIds.has(id), `${teamRef.team_slug} invalid caster angle id: ${id}`);
  }
  for (const id of hooksJson.barrage_angle_ids) {
    assert(validBarrageIds.has(id), `${teamRef.team_slug} invalid barrage angle id: ${id}`);
  }
  for (const id of hooksJson.news_angle_ids) {
    assert(validNewsIds.has(id), `${teamRef.team_slug} invalid news angle id: ${id}`);
  }
  for (const id of hooksJson.cross_circle_angle_ids) {
    assert(validCrossIds.has(id), `${teamRef.team_slug} invalid cross-circle angle id: ${id}`);
  }

  const playersDir = path.join(teamDir, "players");
  const coachDir = path.join(teamDir, "coach");
  const playerFiles = fs.readdirSync(playersDir).filter((file) => file.endsWith(".agent.json"));
  const coachFiles = fs.readdirSync(coachDir).filter((file) => file.endsWith(".agent.json"));
  assert(playerFiles.length === 5, `${teamRef.team_slug} must have 5 player agent json files.`);
  assert(coachFiles.length === 1, `${teamRef.team_slug} must have exactly 1 coach agent json file.`);

  const activeRoleCounts = new Map();

  for (const playerFile of playerFiles) {
    const player = readJson(path.join(playersDir, playerFile));
    entityFileIds.add(player.entity_id);
    assert(rosterJson.active_players.includes(player.entity_id), `${teamRef.team_slug} roster missing player ${player.entity_id}.`);
    assert(player.cs_role_profile?.raw_position, `${player.entity_id} must include cs_role_profile.raw_position.`);
    assert(player.cs_role_profile?.confidence, `${player.entity_id} must include cs_role_profile.confidence.`);
    assert(validPrimaryRoles.has(player.role), `${player.entity_id} role is not accepted by shared schema: ${player.role}`);
    assert(canonicalPlayerRoles.has(player.role), `${player.entity_id} role must use N67 canonical CS role, received ${player.role}.`);
    assert(!legacyPlayerPrimaryRoles.has(player.cs_role_profile.primary_role), `${player.entity_id} primary_role must not use legacy role ${player.cs_role_profile.primary_role}.`);
    activeRoleCounts.set(player.role, (activeRoleCounts.get(player.role) ?? 0) + 1);
    assertRoleProfileAccepted(player.cs_role_profile, player.entity_id);
    validateFutureDriverBinding(player);
  }
  for (const role of canonicalPlayerRoles) {
    assert(activeRoleCounts.get(role) === 1, `${teamRef.team_slug} active roster must include exactly one ${role}; got ${activeRoleCounts.get(role) ?? 0}.`);
  }

  const coach = readJson(path.join(coachDir, coachFiles[0]));
  entityFileIds.add(coach.entity_id);
  assert(coach.cs_role_profile?.raw_position, `${coach.entity_id} must include cs_role_profile.raw_position.`);
  assert(coach.cs_role_profile?.confidence, `${coach.entity_id} must include cs_role_profile.confidence.`);
  assert(validPrimaryRoles.has(coach.role), `${coach.entity_id} role is not accepted by shared schema: ${coach.role}`);
  assertRoleProfileAccepted(coach.cs_role_profile, coach.entity_id);
  validateFutureDriverBinding(coach);
  if (teamRef.team_slug !== "phaseclan") {
    assert(rosterJson.head_coach === coach.entity_id, `${teamRef.team_slug} head_coach does not reference coach file.`);
  }
}

assert(entitiesIndex.entities.length === entityFileIds.size, "entities.index.json size mismatch against entity files.");
assert(rolesIndex.entries.length === entityFileIds.size, "roles.index.json size mismatch against entity files.");
assert(llmBindingsIndex.entities.length === entityFileIds.size, "llm-bindings.index.json size mismatch against entity files.");

const llmIndexEntityIds = new Set(llmBindingsIndex.entities.map((entry) => entry.entity_id));
assert(llmIndexEntityIds.size === llmBindingsIndex.entities.length, "llm-bindings.index.json contains duplicate entity ids.");

for (const entity of entitiesIndex.entities) {
  assert(entityFileIds.has(entity.entity_id), `Entity index references missing file entity ${entity.entity_id}.`);
  assert(fs.existsSync(path.join(processedRoot, entity.json_path.replace(/^processed[\\/]/, ""))), `Entity json_path does not exist for ${entity.entity_id}.`);
  assert(entity.cs_role_profile?.raw_position, `Entity index missing role profile for ${entity.entity_id}.`);
  assert(validPrimaryRoles.has(entity.role), `Entity index ${entity.entity_id} role is not accepted by shared schema: ${entity.role}`);
  if (entity.entity_type === "player") {
    assert(canonicalPlayerRoles.has(entity.role), `Entity index ${entity.entity_id} role must use N67 canonical CS role, received ${entity.role}.`);
    assert(!legacyPlayerPrimaryRoles.has(entity.cs_role_profile.primary_role), `Entity index ${entity.entity_id} primary_role must not use legacy role ${entity.cs_role_profile.primary_role}.`);
  }
  assertRoleProfileAccepted(entity.cs_role_profile, `Entity index ${entity.entity_id}`);
  assert(llmIndexEntityIds.has(entity.entity_id), `llm-bindings.index.json missing ${entity.entity_id}.`);
}

for (const entry of llmBindingsIndex.entities) {
  assert(entityFileIds.has(entry.entity_id), `LLM binding index references missing file entity ${entry.entity_id}.`);
  assert(entry.runtime_enabled === false, `LLM binding index entry ${entry.entity_id} must stay runtime disabled for v1.`);
  assert(validPrimaryRoles.has(entry.role), `LLM binding index entry ${entry.entity_id} role is not accepted by shared schema: ${entry.role}`);
  if (entry.entity_type === "player") {
    assert(canonicalPlayerRoles.has(entry.role), `LLM binding index entry ${entry.entity_id} role must use N67 canonical CS role, received ${entry.role}.`);
  }
  assert(validRoleTemplateIds.has(entry.role_template_id), `LLM binding index entry ${entry.entity_id} references unknown role template.`);
  assertDriverIds([entry.preferred_driver_model_id, ...entry.fallback_driver_model_ids], validRuntimeDriverIds, `LLM binding index ${entry.entity_id}`);
  for (const profileId of entry.model_profile_ids) {
    assert(validModelProfileIds.has(profileId), `LLM binding index entry ${entry.entity_id} references unknown model profile ${profileId}.`);
  }
  for (const overrideId of entry.override_ids ?? []) {
    assert(validOverrideIds.has(overrideId), `LLM binding index entry ${entry.entity_id} references unknown override ${overrideId}.`);
  }
  assert(fs.existsSync(path.join(processedRoot, entry.json_path.replace(/^processed[\\/]/, ""))), `LLM binding json_path does not exist for ${entry.entity_id}.`);
}

for (const entry of rolesIndex.entries) {
  assert(entityFileIds.has(entry.entity_id), `Role index references missing file entity ${entry.entity_id}.`);
  assert(entry.cs_role_profile?.source_path === "raw/teams/agent_major_player_roles.md", `Role index entry ${entry.entity_id} must point to the raw role source.`);
  assert(validPrimaryRoles.has(entry.role), `Role index entry ${entry.entity_id} role is not accepted by shared schema: ${entry.role}`);
  if (entry.entity_type === "player") {
    assert(canonicalPlayerRoles.has(entry.role), `Role index entry ${entry.entity_id} role must use N67 canonical CS role, received ${entry.role}.`);
    assert(!legacyPlayerPrimaryRoles.has(entry.cs_role_profile.primary_role), `Role index ${entry.entity_id} primary_role must not use legacy role ${entry.cs_role_profile.primary_role}.`);
  }
  assertRoleProfileAccepted(entry.cs_role_profile, `Role index ${entry.entity_id}`);
}

for (const entry of aliasesIndex.entries) {
  assert(Array.isArray(entry.target_ids) && entry.target_ids.length >= 1, `Alias entry ${entry.alias} must reference at least one target.`);
}

console.log(`Validated Agent Major materials: 16 teams, ${entitiesIndex.entities.length} entities, ${aliasesIndex.entries.length} alias entries, ${rolesIndex.entries.length} role entries, ${llmBindingsIndex.entities.length} LLM bindings.`);
