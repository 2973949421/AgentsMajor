import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readMapReplay, readMatchReplay, type MapReplay, type MatchReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { phase18CanonIds } from "@agent-major/materials";

export const defaultMapGameId = `map_${phase18CanonIds.matchId}_1`;
export const defaultMatchId = phase18CanonIds.matchId;

let sqliteWarningFilterInstalled = false;

export async function loadMapReplay(mapGameId: string = defaultMapGameId): Promise<MapReplay | null> {
  const sqlitePath = resolve(getProjectRoot(), defaultSqlitePath);
  if (!existsSync(sqlitePath)) {
    return null;
  }

  installSqliteWarningFilter();
  const repositories = createSqliteRepositories(sqlitePath);
  try {
    return await readMapReplay(repositories, mapGameId);
  } finally {
    repositories.close();
  }
}

export async function loadMatchReplay(matchId: string = defaultMatchId): Promise<MatchReplay | null> {
  const sqlitePath = resolve(getProjectRoot(), defaultSqlitePath);
  if (!existsSync(sqlitePath)) {
    return null;
  }

  installSqliteWarningFilter();
  const repositories = createSqliteRepositories(sqlitePath);
  try {
    return await readMatchReplay(repositories, matchId);
  } finally {
    repositories.close();
  }
}

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "pnpm-workspace.yaml"))) {
    return cwd;
  }

  return resolve(cwd, "../..");
}

function installSqliteWarningFilter(): void {
  if (sqliteWarningFilterInstalled) {
    return;
  }

  const mutableProcess = process as NodeJS.Process & {
    emitWarning: (...args: unknown[]) => void;
  };
  const originalEmitWarning = mutableProcess.emitWarning.bind(process);
  mutableProcess.emitWarning = (...args: unknown[]) => {
    const warning = args[0];
    const message = typeof warning === "string" ? warning : warning instanceof Error ? warning.message : "";
    if (message.includes("SQLite is an experimental feature")) {
      return;
    }

    originalEmitWarning(...args);
  };
  sqliteWarningFilterInstalled = true;
}
