import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DataInitResult {
  root: string;
  directories: string[];
}

const dataDirectories = [
  "data",
  "data/exports",
  "data/exports/matches",
  "data/exports/tournaments",
  "data/tournaments"
];

export function ensureDataDirectories(projectRoot: string): DataInitResult {
  const directories = dataDirectories.map((relativePath) => resolve(projectRoot, relativePath));

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
    const gitkeepPath = resolve(directory, ".gitkeep");

    if (!existsSync(gitkeepPath)) {
      writeFileSync(gitkeepPath, "");
    }
  }

  return { root: projectRoot, directories };
}

function getDefaultProjectRoot(): string {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDirectory, "../../..");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = ensureDataDirectories(getDefaultProjectRoot());
  console.log(`Data directory initialized at ${result.root}`);
  for (const directory of result.directories) {
    console.log(`- ${directory}`);
  }
}
