import type { Repositories } from "@agent-major/db";
import type {
  Agent,
  EconomyState,
  MapGame,
  Match,
  ScorePair,
  SideAssignment,
  Team
} from "@agent-major/shared";

import {
  decideTeamEconomyPlans,
  initialEconomy,
  isEconomyResetRound,
  roundStartEconomy
} from "../../economy/economy-output-service.js";
import { sortAgentsForRound, type TeamEconomyPlan } from "../../economy/economy-rules.js";
import { getSideContext, type SideContext } from "../../match/map-rules.js";
import { createSideAssignment } from "../../match/tactical-protocol.js";
import type { HexRoundRunnerAgentInput } from "../round/index.js";

export interface LoadDust2HexRoundCommitContextInput {
  repositories: Repositories;
  mapGameId: string;
  createdAt: string;
}

export interface HexRoundCommitContext {
  mapGame: MapGame;
  match: Match;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  activeAgents: Agent[];
  roundNumber: number;
  roundId: string;
  sideContext: SideContext;
  sideAssignment: SideAssignment;
  scoreBeforeRound: ScorePair;
  beforeEconomy: EconomyState[];
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  runnerAgents: HexRoundRunnerAgentInput[];
}

export async function loadDust2HexRoundCommitContext(
  input: LoadDust2HexRoundCommitContextInput
): Promise<HexRoundCommitContext> {
  const mapGame = await required(input.repositories.mapGames.getById(input.mapGameId), `Map game not found: ${input.mapGameId}`);
  if (!isDust2Map(mapGame.mapName)) {
    throw new Error(`phase20_hex_round_experimental only supports Dust2; received mapName=${mapGame.mapName}`);
  }
  if (mapGame.status === "completed") {
    throw new Error(`Cannot commit experimental Hex round on completed map: ${mapGame.id}`);
  }

  const match = await required(input.repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
  const [teamA, teamB] = await Promise.all([
    required(input.repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
    required(input.repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`)
  ]);
  const [teamAAgents, teamBAgents] = await Promise.all([
    input.repositories.agents.listByTeam(teamA.id),
    input.repositories.agents.listByTeam(teamB.id)
  ]);
  const activeA = selectActiveAgents(teamAAgents);
  const activeB = selectActiveAgents(teamBAgents);
  const activeAgents = [...activeA, ...activeB];
  const roundNumber = mapGame.currentRoundNumber + 1;
  const roundId = `round_${mapGame.id}_${roundNumber}`;
  const existingRound = await input.repositories.rounds.getByMapGameAndRoundNumber(mapGame.id, roundNumber);
  if (existingRound) {
    throw new Error(`Round already exists for map ${mapGame.id} R${roundNumber}; Hex experimental commit refuses to overwrite.`);
  }

  const sideContext = getSideContext(roundNumber);
  const sideAssignment = createSideAssignment({
    roundId,
    roundNumber,
    teamAId: teamA.id,
    teamBId: teamB.id,
    sideContext
  });
  const scoreBeforeRound: ScorePair = { teamA: mapGame.teamAScore, teamB: mapGame.teamBScore };
  const beforeEconomy = await buildBeforeEconomy({
    repositories: input.repositories,
    mapGame,
    roundNumber,
    createdAt: input.createdAt,
    activeAgents,
    attackingTeamId: sideAssignment.attackingTeamId
  });
  const previousRoundReports = await input.repositories.roundReports.listByMapGame(mapGame.id);
  const teamEconomyPlans = decideTeamEconomyPlans({
    roundNumber,
    scoreBeforeRound,
    teamA,
    teamB,
    activeA,
    activeB,
    beforeEconomy,
    sideContext,
    previousRoundReport: previousRoundReports.at(-1)
  });

  return {
    mapGame,
    match,
    teamA,
    teamB,
    activeA,
    activeB,
    activeAgents,
    roundNumber,
    roundId,
    sideContext,
    sideAssignment,
    scoreBeforeRound,
    beforeEconomy,
    teamEconomyPlans,
    runnerAgents: buildHexRunnerAgents({
      activeA,
      activeB,
      attackingTeamId: sideAssignment.attackingTeamId
    })
  };
}

async function buildBeforeEconomy(input: {
  repositories: Repositories;
  mapGame: MapGame;
  roundNumber: number;
  createdAt: string;
  activeAgents: Agent[];
  attackingTeamId: string;
}): Promise<EconomyState[]> {
  const latest = await input.repositories.economyStates.listLatestByMapGame(input.mapGame.id);
  const latestByAgentId = new Map(latest.map((state) => [state.agentId, state]));
  return input.activeAgents.map((agent) => {
    const side = agent.teamId === input.attackingTeamId ? "attack" : "defense";
    return isEconomyResetRound(input.roundNumber)
      ? roundStartEconomy({ agent, mapGameId: input.mapGame.id, roundNumber: input.roundNumber, createdAt: input.createdAt, side })
      : (latestByAgentId.get(agent.id) ?? initialEconomy(agent, input.mapGame.id, input.createdAt));
  });
}

function buildHexRunnerAgents(input: {
  activeA: Agent[];
  activeB: Agent[];
  attackingTeamId: string;
}): HexRoundRunnerAgentInput[] {
  const allAgents = [...input.activeA, ...input.activeB];
  let c4Assigned = false;
  return allAgents.map((agent) => {
    const side = agent.teamId === input.attackingTeamId ? "attack" as const : "defense" as const;
    const carryingC4 = side === "attack" && !c4Assigned;
    if (carryingC4) {
      c4Assigned = true;
    }
    return {
      agentId: agent.id,
      teamId: agent.teamId,
      side,
      carryingC4
    };
  });
}

function selectActiveAgents(agents: Agent[]): Agent[] {
  return sortAgentsForRound(agents).filter((agent) => agent.currentState === "ready").slice(0, 5);
}

function isDust2Map(mapName: string): boolean {
  return mapName.toLowerCase().replace(/[^a-z0-9]/g, "") === "dust2";
}

function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  return promise.then((value) => {
    if (!value) {
      throw new Error(message);
    }
    return value;
  });
}
