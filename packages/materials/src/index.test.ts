import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeTeamSeed,
  loadProcessedMaterials,
  normalizeMaterialRoleProfile,
  phase20PrePilotMapIds,
  phase18CanonIds,
  phase17CanonIds,
  seedPhase18ShowcaseMatch,
  seedPhase17ShowcaseMatch
} from "./index.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("processed materials runtime package", () => {
  it("loads 16 teams and validates primary roles against the shared schema", () => {
    const materials = loadProcessedMaterials(projectRoot);
    expect(materials.teams).toHaveLength(16);
    expect(materials.entitiesById.size).toBe(96);
    expect(materials.teamsBySlug.get("falcon-7b")?.players).toHaveLength(5);
    expect(materials.teamsBySlug.get("falcon-7b")?.initialProposal?.proposalId).toBe("proposal_falcon_7b_core_v1");
    expect(materials.teamsBySlug.get("vitallmty")?.initialProposal?.proposalId).toBe("proposal_vitallmty_core_v1");
    expect(materials.teamsBySlug.get("neural-vincere")?.initialProposal).toBeUndefined();
    expect(materials.mapsBySlug.get("dust2")?.proposition?.mapTheme).toBe("opportunity_positioning");
    expect(materials.mapsBySlug.get("dust2")?.judgeRubric?.coreJudgmentAxis).toBe("opportunity_truth");
  });

  it("keeps Falcon-7B and VitaLLMty responsibilities generic and non-empty", () => {
    const materials = loadProcessedMaterials(projectRoot);
    const targetedTeams = [materials.teamsBySlug.get("falcon-7b"), materials.teamsBySlug.get("vitallmty")];
    const forbiddenPattern = /(DUST2|INFERNO|MIRAGE|Dust2|A 大|A 小|B 洞|A 点|B 点|中路)/;

    for (const team of targetedTeams) {
      expect(team).toBeTruthy();
      if (!team) {
        continue;
      }
      for (const entity of [...team.players, ...team.coachAssets]) {
        expect(entity.roleProfile.agentMajorResponsibilities.length).toBeGreaterThan(0);
        for (const responsibility of entity.roleProfile.agentMajorResponsibilities) {
          expect(forbiddenPattern.test(responsibility)).toBe(false);
        }
      }
    }
  });

  it("does not import PhaseClan Coach TBD as a runtime coach when head_coach is null", () => {
    const materials = loadProcessedMaterials(projectRoot);
    const seed = buildRuntimeTeamSeed(materials, "phaseclan");
    expect(seed.materialTeam.coachAssets).toHaveLength(1);
    expect(seed.agents).toHaveLength(5);
    expect(seed.agents.some((agent) => agent.role === "coach")).toBe(false);
  });

  it("fails fast on unknown primary role values", () => {
    expect(() =>
      normalizeMaterialRoleProfile("player_unknown", {
        source_path: "raw/teams/agent_major_player_roles.md",
        source_team_name: "Unknown",
        member_type: "player",
        raw_position: "Unknown Role",
        raw_position_parts: ["Unknown Role"],
        primary_role: "hard_carry",
        secondary_roles: [],
        position_tags: [],
        confidence: "low",
        agent_major_responsibilities: ["test"]
      })
    ).toThrow("unknown primary role");
  });

  it("fails fast when the processed LLM index references an unknown model profile", () => {
    const fixtureRoot = createIsolatedProjectRoot();
    try {
      const indexPath = join(fixtureRoot, "data", "materials", "processed", "indexes", "llm-bindings.index.json");
      const index = readJson(indexPath);
      index.entities[0].model_profile_ids = ["llm_profile_missing"];
      writeJson(indexPath, index);

      expect(() => loadProcessedMaterials(fixtureRoot)).toThrow("unknown model profile");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails fast when a raw future driver binding references an unknown override id", () => {
    const fixtureRoot = createIsolatedProjectRoot();
    try {
      const agentPath = join(fixtureRoot, "data", "materials", "processed", "teams", "falcon-7b", "players", "niko.agent.json");
      const agent = readJson(agentPath);
      agent.future_driver_binding.override_ids = ["llm_override_missing"];
      writeJson(agentPath, agent);

      expect(() => loadProcessedMaterials(fixtureRoot)).toThrow("unknown override");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("seeds the default Phase 1.7 Falcon-7B vs VitaLLMty showcase with fake drivers", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-materials-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      const result = await seedPhase17ShowcaseMatch({ repositories, projectRoot });
      expect(result.match.id).toBe(phase17CanonIds.matchId);
      expect(result.teams.map((team) => team.displayName)).toEqual(["Falcon-7B", "VitaLLMty"]);
      expect(result.selectedMapIds).toEqual(["DUST2", "INFERNO", "MIRAGE"]);
      expect(result.agents).toHaveLength(12);
      expect(new Set(result.agents.map((agent) => agent.driverModelId))).toEqual(new Set([phase17CanonIds.driverModelId]));
      expect(result.agents.every((agent) => agent.materialRef?.runtimeEnabled === false)).toBe(true);
      expect(JSON.stringify(result.agents.map((agent) => agent.materialRef))).not.toContain("preferred_driver_model_id");
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("seeds the default Phase 1.8 Falcon-7B vs VitaLLMty pilot with 10 runtime players and no coaches", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-materials-phase18-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      const driverModel = {
        id: "driver_qwen_3_max_2026_01_23",
        provider: "dashscope_openai_compatible",
        modelName: "qwen3-max-2026-01-23",
        capabilities: ["text_generation", "reasoning"],
        defaultUseCase: ["agent_action", "judge"],
        enabled: true,
        createdAt: "2026-05-02T00:00:00.000Z"
      };
      const result = await seedPhase18ShowcaseMatch({ repositories, projectRoot, driverModel });
      expect(result.match.id).toBe(phase18CanonIds.matchId);
      expect(result.selectedMapIds).toEqual(["DUST2", "INFERNO", "MIRAGE"]);
      expect(result.agents).toHaveLength(10);
      expect(result.agents.some((agent) => agent.role === "coach")).toBe(false);
      expect(new Set(result.agents.map((agent) => agent.driverModelId))).toEqual(new Set([driverModel.id]));
      expect(result.teams[0].teamProfileId).toBe("proposal_falcon_7b_core_v1");
      expect(result.teams[1].teamProfileId).toBe("proposal_vitallmty_core_v1");
      expect((result.teams[0].source as Record<string, unknown>).materialInitialProposal).toBeTruthy();
      expect((result.teams[0].source as Record<string, unknown>).headCoachProfile).toBeTruthy();
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("can seed the current Phase 2.0-pre Dust2-only pilot without changing team assets", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-materials-phase20pre-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      const driverModel = {
        id: "driver_qwen_3_max_2026_01_23",
        provider: "dashscope_openai_compatible",
        modelName: "qwen3-max-2026-01-23",
        capabilities: ["text_generation", "reasoning"],
        defaultUseCase: ["agent_action", "judge"],
        enabled: true,
        createdAt: "2026-05-02T00:00:00.000Z"
      };
      const result = await seedPhase18ShowcaseMatch({
        repositories,
        projectRoot,
        driverModel,
        selectedMapIds: [...phase20PrePilotMapIds]
      });
      expect(result.match.id).toBe(phase18CanonIds.matchId);
      expect(result.selectedMapIds).toEqual(["DUST2"]);
      expect(result.agents).toHaveLength(10);
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createIsolatedProjectRoot(): string {
  const fixtureTempRoot = resolve(projectRoot, ".tmp");
  mkdirSync(fixtureTempRoot, { recursive: true });
  const fixtureRoot = mkdtempSync(join(fixtureTempRoot, "agent-major-materials-fixture-"));
  copyProjectFile(join(projectRoot, "pnpm-workspace.yaml"), join(fixtureRoot, "pnpm-workspace.yaml"));
  mkdirSync(join(fixtureRoot, "data", "materials"), { recursive: true });
  cpSync(join(projectRoot, "data", "materials", "processed"), join(fixtureRoot, "data", "materials", "processed"), { recursive: true });
  copyProjectFile(
    join(projectRoot, "packages", "shared", "src", "enums.ts"),
    join(fixtureRoot, "packages", "shared", "src", "enums.ts")
  );
  copyProjectFile(
    join(projectRoot, "packages", "llm", "src", "model-registry.ts"),
    join(fixtureRoot, "packages", "llm", "src", "model-registry.ts")
  );
  return fixtureRoot;
}

function copyProjectFile(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
