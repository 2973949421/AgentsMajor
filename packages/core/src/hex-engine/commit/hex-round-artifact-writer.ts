import type { Artifact } from "@agent-major/shared";

import type { ArtifactStore } from "../../ports.js";
import type { HexRoundTrace } from "../round/index.js";

export interface WriteHexRoundTraceArtifactInput {
  artifactStore: ArtifactStore;
  trace: HexRoundTrace;
  tournamentId: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  sourceEventIds: string[];
}

export function writeHexRoundTraceArtifact(input: WriteHexRoundTraceArtifactInput): Promise<Artifact> {
  return input.artifactStore.write({
    ownerType: "round",
    ownerId: input.roundId,
    artifactType: "hex_round_trace",
    relativePath: `hex-round-traces/${input.roundId}.json`,
    content: JSON.stringify(
      {
        schemaVersion: 1,
        source: "hex_round_engine_committed",
        trace: input.trace
      },
      null,
      2
    ),
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    sourceEventIds: input.sourceEventIds
  });
}
