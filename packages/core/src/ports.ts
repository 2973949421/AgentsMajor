import type { Artifact, Event } from "@agent-major/shared";

export interface ArtifactWriteInput {
  ownerType: string;
  ownerId: string;
  artifactType: string;
  relativePath: string;
  content: string | Uint8Array;
  tournamentId?: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
  agentId?: string;
  sourceEventIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactStore {
  write(input: ArtifactWriteInput): Promise<Artifact>;
  readText(artifactId: string): Promise<string>;
}

export interface RateLimitRequest {
  scope: string;
  estimatedTokens?: number;
  costUnits?: number;
}

export interface RateLimiter {
  acquire(request: RateLimitRequest): Promise<void>;
}

export interface EventPublisher {
  publish(event: Event): Promise<void>;
}
