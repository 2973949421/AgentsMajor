import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const processedRoot = path.join(materialsRoot, "processed");
const teamsRoot = path.join(processedRoot, "teams");
const indexesRoot = path.join(processedRoot, "indexes");
const styleRoot = path.join(processedRoot, "style");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const validCasterIds = new Set(readJson(path.join(styleRoot, "caster", "reaction-patterns.json")).patterns.map((item) => item.id));
const validBarrageIds = new Set(readJson(path.join(styleRoot, "barrage", "meme-taxonomy.json")).taxonomy.map((item) => item.id));
const validNewsIds = new Set(readJson(path.join(styleRoot, "news", "news-angle-taxonomy.json")).angles.map((item) => item.id));
const validCrossIds = new Set(readJson(path.join(styleRoot, "cross-circle", "transfer-patterns.json")).patterns.map((item) => item.id));

const teamsIndex = readJson(path.join(indexesRoot, "teams.index.json"));
const entitiesIndex = readJson(path.join(indexesRoot, "entities.index.json"));
const aliasesIndex = readJson(path.join(indexesRoot, "aliases.index.json"));

const teamDirs = fs.readdirSync(teamsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
assert(teamDirs.length === 16, `Expected 16 team directories, found ${teamDirs.length}.`);
assert(teamsIndex.teams.length === 16, `Expected 16 teams in teams.index.json, found ${teamsIndex.teams.length}.`);

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

  assert(teamJson.team_id === teamRef.team_id, `Team id mismatch for ${teamRef.team_slug}.`);
  assert(rosterJson.active_players.length === 5, `${teamRef.team_slug} must have 5 active players.`);

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

  for (const playerFile of playerFiles) {
    const player = readJson(path.join(playersDir, playerFile));
    entityFileIds.add(player.entity_id);
    assert(rosterJson.active_players.includes(player.entity_id), `${teamRef.team_slug} roster missing player ${player.entity_id}.`);
  }

  const coach = readJson(path.join(coachDir, coachFiles[0]));
  entityFileIds.add(coach.entity_id);
  if (teamRef.team_slug !== "phaseclan") {
    assert(rosterJson.head_coach === coach.entity_id, `${teamRef.team_slug} head_coach does not reference coach file.`);
  }
}

assert(entitiesIndex.entities.length === entityFileIds.size, "entities.index.json size mismatch against entity files.");

for (const entity of entitiesIndex.entities) {
  assert(entityFileIds.has(entity.entity_id), `Entity index references missing file entity ${entity.entity_id}.`);
  assert(fs.existsSync(path.join(processedRoot, entity.json_path.replace(/^processed[\\/]/, ""))), `Entity json_path does not exist for ${entity.entity_id}.`);
}

for (const entry of aliasesIndex.entries) {
  assert(Array.isArray(entry.target_ids) && entry.target_ids.length >= 1, `Alias entry ${entry.alias} must reference at least one target.`);
}

console.log(`Validated Agent Major materials: 16 teams, ${entitiesIndex.entities.length} entities, ${aliasesIndex.entries.length} alias entries.`);
