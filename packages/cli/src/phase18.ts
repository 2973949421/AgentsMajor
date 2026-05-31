import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase18SimulationEngine, PHASE20_PRE_PROMPT_CONTRACT_ID, readMatchReplay, type MatchReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { DashScopeOpenAiProvider, defaultDriverModels, loadAgentMajorLlmConfig } from "@agent-major/llm";
import {
  buildPhase18RuntimeMatchId,
  loadProcessedMaterials,
  phase18CanonIds,
  phase20PrePilotMapIds,
  seedPhase18ShowcaseMatch,
  type ProcessedMaterials
} from "@agent-major/materials";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import type { SimulationRun } from "@agent-major/shared";

import { ensureDataDirectories } from "./data-init.js";
import { exportMatchReplay } from "./export-match-replay.js";
import { loadLocalEnv, type EnvRecord } from "./local-env.js";
import { LocalArtifactStore } from "./local-artifact-store.js";

export type Phase18Command = "round" | "map" | "match" | "replay" | "export";

export interface Phase18CommandOptions {
  runId?: string;
}

export interface Phase18CommandResult {
  command: Phase18Command;
  lines: string[];
  exportPath?: string;
}

const estimatedMaxRoundsPerMap = 18;
const phase18CallsPerRound = 14;

export async function runPhase18Command(
  command: Phase18Command,
  projectRoot = findProjectRoot(process.cwd()),
  env: EnvRecord = process.env,
  options: Phase18CommandOptions = {}
): Promise<Phase18CommandResult> {
  ensureDataDirectories(projectRoot);
  const materials = loadProcessedMaterials(projectRoot);
  const mergedEnv = loadLocalEnv(projectRoot, ".env.local", env);
  const llmConfig = loadAgentMajorLlmConfig(mergedEnv);
  if (!llmConfig.enabled) {
    return {
      command,
      lines: [`Phase 1.8 real player/judge LLM: disabled (${llmConfig.disabledReason ?? "not_configured"})`]
    };
  }

  const driverModel = requireDriverModel(llmConfig.phase18DriverModelId);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase18SimulationEngine({
      repositories,
      llmGateway: new DashScopeOpenAiProvider({
        baseUrl: llmConfig.baseUrl ?? "",
        apiKey: llmConfig.apiKey ?? "",
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries
      }),
      jobQueue: new UnconfiguredJobQueue(),
      artifactStore: new LocalArtifactStore(projectRoot, repositories.artifacts),
      phase18MapSemanticsByMapName: buildPhase18MapSemantics(materials)
    });

    let selectedRun: SimulationRun | null = null;
    if (command === "round" || command === "map" || command === "match") {
      const seed = await ensureRunnablePhase18Fixture({
        repositories,
        projectRoot,
        driverModel,
        engine,
        resetCompleted: true,
        resetBeforeRun: false,
        runId: options.runId,
        mode: command
      });
      selectedRun = await repositories.simulationRuns.getById(seed.runId);

      try {
        if (command === "match") {
          await engine.runCurrentMatch({ matchId: seed.matchId, selectedMapIds: seed.selectedMapIds });
        } else {
          const mapGameId = await selectCurrentPhase18MapGameId(repositories, seed.matchId);
          await engine.runCurrentMap({
            mapGameId,
            ...(command === "round" ? { mode: "debug", maxRounds: 1 } : {})
          });
        }
        await finalizePhase18Run(repositories, seed.runId, "completed");
      } catch (error) {
        await finalizePhase18Run(repositories, seed.runId, "failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
    } else {
      selectedRun = await resolvePhase18CliRun(repositories, options.runId);
    }

    const llmStatusLine = `Phase 1.8 real player/judge LLM: enabled (${driverModel.id})`;
    if (!selectedRun) {
      return {
        command,
        lines: [llmStatusLine, "No Phase 1.8 run found. Run `pnpm phase18:round` or `pnpm phase18:match` first."]
      };
    }

    const replay = await readMatchReplay(repositories, selectedRun.runtimeMatchId);
    if (!replay || replay.mapGames.length === 0) {
      return {
        command,
        lines: [llmStatusLine, `Run ${selectedRun.id} exists, but no replay facts have been committed yet.`]
      };
    }
    if (command === "export" && !isCompletedMatchReplay(replay)) {
      return {
        command,
        lines: [llmStatusLine, "Phase 1.8 match replay is incomplete. Run `pnpm phase18:match` to complete the BO3 before export."]
      };
    }

    const lines = [llmStatusLine, `Run: ${selectedRun.id}`, ...formatMatchReplayLines(replay)];
    if (command === "export") {
      const exportPath = exportMatchReplay(projectRoot, replay);
      return {
        command,
        exportPath,
        lines: [...lines, `Exported JSON: ${exportPath}`]
      };
    }

    return { command, lines };
  } finally {
    repositories.close();
  }
}

export async function ensureRunnablePhase18Fixture(input: {
  repositories: ReturnType<typeof createSqliteRepositories>;
  projectRoot: string;
  driverModel: ReturnType<typeof requireDriverModel>;
  engine: ReturnType<typeof createPhase18SimulationEngine>;
  resetCompleted: boolean;
  resetBeforeRun: boolean;
  runId: string | undefined;
  mode: "round" | "map" | "match";
}): Promise<{ runId: string; matchId: string; runtimeMatchId: string; selectedMapIds: string[] }> {
  const selectedMapIds = [...phase20PrePilotMapIds];
  const now = new Date().toISOString();
  const requestedMode = input.mode;
  const existingRun = await resolvePhase18CliRun(input.repositories, input.runId);
  if (existingRun && isCliRunContractBlocked(input.repositories, existingRun)) {
    throw new Error(
      `Phase 1.8 run ${existingRun.id} uses an old or mixed prompt contract and cannot be continued. Create a fresh ${PHASE20_PRE_PROMPT_CONTRACT_ID} run.`
    );
  }
  const existingRunFacts = existingRun ? await readPhase18CliFacts(input.repositories, existingRun.runtimeMatchId) : null;
  const existingRunHasRemainingMap = existingRun ? hasRemainingPhase18Map(input.repositories, existingRun.runtimeMatchId) : false;
  const reusableRun =
    !input.resetBeforeRun &&
    existingRun &&
    existingRun.status !== "discarded" &&
    existingRunFacts?.runtimeMatchStatus !== "completed" &&
    existingRunHasRemainingMap &&
    (existingRun.status === "scheduled" ||
      existingRun.status === "running" ||
      existingRun.status === "failed" ||
      existingRun.status === "completed")
      ? existingRun
      : null;
  const runId = reusableRun?.id ?? createPhase18RunId();
  const runtimeMatchId = reusableRun?.runtimeMatchId ?? buildPhase18RuntimeMatchId(runId, phase18CanonIds.fixtureId);
  let existingMatch = await input.repositories.matches.getById(runtimeMatchId);
  let ensuredSelectedMapIds: string[] = selectedMapIds;
  if (!existingMatch) {
    const seed = await seedPhase18ShowcaseMatch({
      repositories: input.repositories,
      projectRoot: input.projectRoot,
      driverModel: input.driverModel,
      runtimeMatchId,
      selectedMapIds
    });
    await input.engine.startMatch({ matchId: seed.match.id });
    await input.engine.completeVeto({ matchId: seed.match.id, selectedMapIds: seed.selectedMapIds });
    existingMatch = seed.match;
    ensuredSelectedMapIds = seed.selectedMapIds;
  }

  const existingMaps = await input.repositories.mapGames.listByMatch(existingMatch.id);
  if (!fixtureMatchesSelectedMaps(existingMaps, ensuredSelectedMapIds)) {
    throw new Error(`Phase 1.8 run ${runId} has stale map selection and can no longer be continued.`);
  }

  if (existingMatch.status !== "running" || existingMaps.length === 0) {
    await input.engine.startMatch({ matchId: existingMatch.id });
    await input.engine.completeVeto({ matchId: existingMatch.id, selectedMapIds: ensuredSelectedMapIds });
  }

  const facts = await readPhase18CliFacts(input.repositories, runtimeMatchId);
  const remainingRounds = await estimatePhase18RemainingRounds(input.repositories, runtimeMatchId, requestedMode);
  const run: SimulationRun = {
    id: runId,
    fixtureId: phase18CanonIds.fixtureId,
    status: "running",
    requestedMode: mapCommandToSimulationRunMode(requestedMode),
    promptContractId: reusableRun?.promptContractId ?? PHASE20_PRE_PROMPT_CONTRACT_ID,
    runtimeMatchId,
    ...(facts.mapGameId ? { runtimeMapGameId: facts.mapGameId } : reusableRun?.runtimeMapGameId ? { runtimeMapGameId: reusableRun.runtimeMapGameId } : {}),
    baselineCompletedRounds: facts.completedRounds,
    estimatedTotalRounds: facts.completedRounds + remainingRounds,
    expectedTotalCalls: remainingRounds * phase18CallsPerRound,
    latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
    hasFreshReplay: facts.hasFreshReplay,
    latestError: undefined,
    createdAt: reusableRun?.createdAt ?? now,
    startedAt: now,
    completedAt: undefined
  };
  await input.repositories.simulationRuns.save(run);

  return { runId, matchId: existingMatch.id, runtimeMatchId, selectedMapIds: ensuredSelectedMapIds };
}

export async function selectCurrentPhase18MapGameId(
  repositories: ReturnType<typeof createSqliteRepositories>,
  matchId: string
): Promise<string> {
  const match = await repositories.matches.getById(matchId);
  if (!match) {
    throw new Error(`Phase 1.8 match not found: ${matchId}`);
  }

  const nextMap = (await repositories.mapGames.listByMatch(match.id))
    .sort((left, right) => left.order - right.order)
    .find((mapGame) => mapGame.status !== "completed");
  if (!nextMap) {
    throw new Error("Phase 1.8 has no remaining map to run.");
  }

  return nextMap.id;
}

function fixtureMatchesSelectedMaps(
  maps: Array<{ mapName: string; order: number }>,
  selectedMapIds: string[]
): boolean {
  const orderedMapNames = [...maps].sort((left, right) => left.order - right.order).map((mapGame) => mapGame.mapName.toUpperCase());
  return orderedMapNames.length === selectedMapIds.length && orderedMapNames.every((mapName, index) => mapName === selectedMapIds[index]);
}

function buildPhase18MapSemantics(materials: ProcessedMaterials): Record<string, Record<string, unknown>> {
  const output: Record<string, Record<string, unknown>> = {};
  for (const map of materials.maps) {
    if (!map.proposition && !map.judgeRubric) {
      continue;
    }

    output[map.slug.toUpperCase()] = {
      ...(map.proposition
        ? {
            proposition: {
              mapTheme: map.proposition.mapTheme,
              coreQuestion: map.proposition.coreQuestion,
              attackFocus: map.proposition.attackFocus,
              defenseFocus: map.proposition.defenseFocus,
              regulationRoundThemes: map.proposition.regulationRoundThemes,
              overtimeRoundThemes: map.proposition.overtimeRoundThemes,
              coachWindows: map.proposition.coachWindows,
              displayZoneNames: map.proposition.displayZoneNames,
              frontendMinimumFields: map.proposition.frontendMinimumFields
            }
          }
        : {}),
      ...(map.judgeRubric
        ? {
            judgeRubric: {
              coreJudgmentAxis: map.judgeRubric.coreJudgmentAxis,
              coreQuestion: map.judgeRubric.coreQuestion,
              axes: map.judgeRubric.axes,
              roundJudgmentFlow: map.judgeRubric.roundJudgmentFlow,
              reasonMustCover: map.judgeRubric.reasonMustCover,
              biasGuardrails: map.judgeRubric.biasGuardrails,
              coachConsumptionWindows: map.judgeRubric.coachConsumptionWindows
            }
          }
        : {})
    };
  }

  return output;
}

function requireDriverModel(driverModelId: string) {
  const driverModel = defaultDriverModels.find((item) => item.id === driverModelId);
  if (!driverModel) {
    throw new Error(`Phase 1.8 requires a known driver model id. Received: ${driverModelId}`);
  }

  return driverModel;
}

function formatMatchReplayLines(replay: MatchReplay): string[] {
  const payload = replay.matchSummary?.payload as { mvpAgentId?: string; deciderMapId?: string } | undefined;
  return [
    `Match ${replay.match.id} ${replay.match.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.match.winnerTeamId ?? "pending"}`,
    `Maps: ${replay.match.teamAMapsWon}-${replay.match.teamBMapsWon}`,
    `Replay-ready maps: ${replay.maps.length} | Scheduled maps: ${replay.mapGames.length}`,
    `Events: ${replay.eventCounts.match} match | ${replay.eventCounts.map} map | ${replay.eventCounts.round} round | ${replay.eventCounts.timeline} timeline`,
    `MVP: ${payload?.mvpAgentId ?? "pending"} | Decider: ${payload?.deciderMapId ?? "pending"}`,
    `Summary: ${replay.matchSummary?.content ?? "Match summary pending."}`,
    "Map ledger:",
    ...[...replay.mapGames]
      .sort((left, right) => left.order - right.order)
      .map(
        (mapGame) =>
          `- M${mapGame.order} ${mapGame.mapName} ${mapGame.status} R${mapGame.currentRoundNumber} winner=${mapGame.winnerTeamId ?? "pending"} score=${mapGame.teamAScore}-${mapGame.teamBScore}`
      )
  ];
}

function isCompletedMatchReplay(replay: MatchReplay): boolean {
  return replay.match.status === "completed" && replay.matchSummary !== null && replay.maps.length === replay.match.teamAMapsWon + replay.match.teamBMapsWon;
}

async function resolvePhase18CliRun(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId?: string
): Promise<SimulationRun | null> {
  if (runId) {
    return repositories.simulationRuns.getById(runId);
  }

  const runs = await repositories.simulationRuns.listByFixtureId(phase18CanonIds.fixtureId);
  return runs.find((run) => run.status !== "discarded") ?? null;
}

async function estimatePhase18RemainingRounds(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runtimeMatchId: string,
  mode: "round" | "map" | "match"
): Promise<number> {
  if (mode === "round") {
    return 1;
  }

  const mapRows = repositories.sqlite
    .prepare(
      `SELECT map_order AS mapOrder, status, current_round_number AS currentRoundNumber
       FROM map_games
       WHERE match_id = ?
       ORDER BY map_order ASC`
    )
    .all(runtimeMatchId) as Array<{
      mapOrder?: unknown;
      status?: unknown;
      currentRoundNumber?: unknown;
    }>;
  const maps = mapRows.map((row) => ({
    mapOrder: typeof row.mapOrder === "number" ? row.mapOrder : 0,
    status: typeof row.status === "string" ? row.status : "scheduled",
    currentRoundNumber: typeof row.currentRoundNumber === "number" ? row.currentRoundNumber : 0
  }));
  const currentMap = maps.find((mapGame) => mapGame.status !== "completed") ?? maps.at(-1);
  const currentMapRemaining = currentMap ? Math.max(1, estimatedMaxRoundsPerMap - currentMap.currentRoundNumber) : estimatedMaxRoundsPerMap;

  if (mode === "map") {
    return currentMapRemaining;
  }

  const completedMaps = maps.filter((mapGame) => mapGame.status === "completed").length;
  return currentMapRemaining + Math.max(0, phase20PrePilotMapIds.length - completedMaps - 1) * estimatedMaxRoundsPerMap;
}

function hasRemainingPhase18Map(repositories: ReturnType<typeof createSqliteRepositories>, runtimeMatchId: string): boolean {
  const row = repositories.sqlite
    .prepare("SELECT COUNT(*) AS count FROM map_games WHERE match_id = ? AND status <> 'completed'")
    .get(runtimeMatchId) as { count?: unknown } | undefined;
  return typeof row?.count === "number" && row.count > 0;
}

async function readPhase18CliFacts(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runtimeMatchId: string
): Promise<{
  runtimeMatchStatus: string | null;
  mapGameId: string | null;
  completedRounds: number;
  latestCommittedRoundNumber: number;
  hasFreshReplay: boolean;
}> {
  const match = await repositories.matches.getById(runtimeMatchId);
  const countRow = repositories.sqlite
    .prepare("SELECT COUNT(*) AS count FROM round_reports WHERE match_id = ?")
    .get(runtimeMatchId) as { count?: unknown } | undefined;
  const mapRows = repositories.sqlite
    .prepare(
      `SELECT id, map_order AS mapOrder, status
       FROM map_games
       WHERE match_id = ?
       ORDER BY map_order ASC`
    )
    .all(runtimeMatchId) as Array<{ id?: unknown; mapOrder?: unknown; status?: unknown }>;
  const currentMap =
    mapRows
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        mapOrder: typeof row.mapOrder === "number" ? row.mapOrder : 0,
        status: typeof row.status === "string" ? row.status : "scheduled"
      }))
      .find((mapGame) => mapGame.status !== "completed") ??
    mapRows
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        mapOrder: typeof row.mapOrder === "number" ? row.mapOrder : 0,
        status: typeof row.status === "string" ? row.status : "scheduled"
      }))
      .at(-1) ??
    null;
  const latestRow =
    currentMap && currentMap.id
      ? ((repositories.sqlite
          .prepare("SELECT COALESCE(MAX(round_number), 0) AS value FROM round_reports WHERE map_game_id = ?")
          .get(currentMap.id) as { value?: unknown } | undefined) ?? undefined)
      : undefined;
  const completedRounds = typeof countRow?.count === "number" ? countRow.count : 0;

  return {
    runtimeMatchStatus: match?.status ?? null,
    mapGameId: currentMap?.id || null,
    completedRounds,
    latestCommittedRoundNumber: typeof latestRow?.value === "number" ? latestRow.value : 0,
    hasFreshReplay: completedRounds > 0
  };
}

async function finalizePhase18Run(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId: string,
  status: "completed" | "failed",
  latestError?: string
): Promise<void> {
  const run = await repositories.simulationRuns.getById(runId);
  if (!run) {
    return;
  }

  const facts = await readPhase18CliFacts(repositories, run.runtimeMatchId);
  await repositories.simulationRuns.save({
    ...run,
    status,
    runtimeMapGameId: facts.mapGameId ?? run.runtimeMapGameId,
    latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
    hasFreshReplay: facts.hasFreshReplay,
    latestError,
    completedAt: new Date().toISOString()
  });
}

function mapCommandToSimulationRunMode(command: "round" | "map" | "match"): "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3" {
  switch (command) {
    case "round":
      return "phase18_next_round";
    case "map":
      return "phase18_current_map";
    case "match":
    default:
      return "phase18_full_bo3";
  }
}

function createPhase18RunId(now = Date.now()): string {
  return `phase18_run_${now.toString(36)}`;
}

function isCliRunContractBlocked(repositories: ReturnType<typeof createSqliteRepositories>, run: SimulationRun): boolean {
  const rows = repositories.sqlite
    .prepare(
      `SELECT DISTINCT prompt_contract_id AS promptContractId
       FROM llm_calls
       WHERE match_id = ? AND prompt_contract_id IS NOT NULL`
    )
    .all(run.runtimeMatchId) as Array<{ promptContractId?: unknown }>;
  const contracts = new Set([
    ...(run.promptContractId ? [run.promptContractId] : []),
    ...rows.map((row) => row.promptContractId).filter((value): value is string => typeof value === "string" && value.length > 0)
  ]);
  return contracts.size !== 1 || !contracts.has(PHASE20_PRE_PROMPT_CONTRACT_ID);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const result = await runPhase18Command(parsed.command, undefined, process.env, parsed.options);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseArgs(argv: string[]): { command: Phase18Command; options: Phase18CommandOptions } {
  const [first, ...rest] = argv;
  const command = parseCommand(first);
  const options: Phase18CommandOptions = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const nextToken = rest[index + 1];
    if ((token === "--run-id" || token === "--runId") && typeof nextToken === "string") {
      options.runId = nextToken;
      index += 1;
    }
  }
  return { command, options };
}

function parseCommand(value: string | undefined): Phase18Command {
  if (value === "round" || value === "map" || value === "match" || value === "replay" || value === "export") {
    return value;
  }

  return "round";
}

function findProjectRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return startDirectory;
    }
    current = parent;
  }

  return startDirectory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
