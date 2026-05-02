import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import type { Artifact, ArtifactStore, ArtifactWriteInput } from "@agent-major/core";
import type { ArtifactRepository } from "@agent-major/db";

export class ServerLocalArtifactStore implements ArtifactStore {
  private readonly artifactRoot: string;

  constructor(
    private readonly projectRoot: string,
    private readonly artifacts: ArtifactRepository
  ) {
    this.artifactRoot = resolve(projectRoot, "data", "artifacts");
  }

  async write(input: ArtifactWriteInput): Promise<Artifact> {
    const targetPath = resolve(this.artifactRoot, input.relativePath);
    if (!isInsideDirectory(targetPath, this.artifactRoot)) {
      throw new Error(`Artifact path escapes artifact root: ${input.relativePath}`);
    }

    const content = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    const checksum = createHash("sha256").update(content).digest("hex");
    if (!existsSync(dirname(targetPath))) {
      mkdirSync(dirname(targetPath), { recursive: true });
    }
    writeFileSync(targetPath, content);

    const artifact: Artifact = removeUndefined({
      id: `art_${safeId(input.ownerId)}_${safeId(input.artifactType)}_${checksum.slice(0, 12)}`,
      artifactType: input.artifactType,
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      mapGameId: input.mapGameId,
      roundId: input.roundId,
      agentId: input.agentId,
      uri: `local:${relative(this.projectRoot, targetPath).replace(/\\/g, "/")}`,
      mimeType: "application/json",
      sizeBytes: content.byteLength,
      checksum,
      status: "ready",
      sourceEventIds: input.sourceEventIds,
      createdAt: new Date().toISOString()
    });
    await this.artifacts.save(artifact);
    return artifact;
  }

  async readText(artifactId: string): Promise<string> {
    const artifact = await this.artifacts.getById(artifactId);
    if (!artifact?.uri.startsWith("local:")) {
      throw new Error(`Unsupported artifact: ${artifactId}`);
    }

    const targetPath = resolve(this.projectRoot, artifact.uri.slice("local:".length));
    if (!isInsideDirectory(targetPath, this.artifactRoot)) {
      throw new Error(`Artifact URI escapes artifact root: ${artifact.uri}`);
    }

    return readFileSync(targetPath, "utf8");
  }
}

function isInsideDirectory(targetPath: string, parentPath: string): boolean {
  const normalizedTarget = resolve(targetPath).toLowerCase();
  const normalizedParent = resolve(parentPath).toLowerCase();
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}\\`);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined")) as T;
}
