import type { Repositories } from "@agent-major/db";
import type { Agent, DriverModel, Match, Team, Tournament } from "@agent-major/shared";

export const phase11DemoIds = {
  tournamentId: "demo_tournament_phase11",
  matchId: "demo_match_phase11",
  mapGameId: "map_demo_match_phase11_1",
  driverModelId: "driver_fake_phase11"
} as const;

export async function seedPhase11Demo(repositories: Repositories): Promise<{
  tournament: Tournament;
  match: Match;
  teams: [Team, Team];
  agents: Agent[];
  driverModel: DriverModel;
}> {
  const now = "2026-05-01T00:00:00.000Z";
  const tournament: Tournament = {
    id: phase11DemoIds.tournamentId,
    name: "Agent Major Phase 1.1 Demo",
    status: "running",
    format: "single_elimination_16",
    createdAt: now,
    startedAt: now
  };
  const driverModel: DriverModel = {
    id: phase11DemoIds.driverModelId,
    provider: "fake",
    modelName: "fake-provider-phase11",
    capabilities: ["structured_output", "deterministic"],
    defaultUseCase: ["agent_action", "judge", "round_report"],
    enabled: true,
    createdAt: now
  };
  const teamA: Team = {
    id: "team_ghost_nav",
    tournamentId: tournament.id,
    displayName: "Ghost NAV",
    shortName: "NAV",
    seed: 1,
    source: { phase: "1.1-demo" },
    createdAt: now
  };
  const teamB: Team = {
    id: "team_ghost_fur",
    tournamentId: tournament.id,
    displayName: "Ghost FUR",
    shortName: "FUR",
    seed: 2,
    source: { phase: "1.1-demo" },
    createdAt: now
  };
  const match: Match = {
    id: phase11DemoIds.matchId,
    tournamentId: tournament.id,
    roundName: "round_of_16",
    teamAId: teamA.id,
    teamBId: teamB.id,
    status: "scheduled",
    bestOf: 3,
    teamAMapsWon: 0,
    teamBMapsWon: 0,
    scheduledOrder: 1,
    createdAt: now
  };
  const agents: Agent[] = [
    agent("agent_nav_igl", teamA.id, "igl", "NAV IGL", now),
    agent("agent_nav_entry", teamA.id, "entry", "NAV Entry", now),
    agent("agent_nav_star", teamA.id, "star", "NAV Star", now),
    agent("agent_nav_support", teamA.id, "support", "NAV Support", now),
    agent("agent_nav_closer", teamA.id, "closer", "NAV Closer", now),
    agent("agent_fur_igl", teamB.id, "igl", "FUR IGL", now),
    agent("agent_fur_entry", teamB.id, "entry", "FUR Entry", now),
    agent("agent_fur_star", teamB.id, "star", "FUR Star", now),
    agent("agent_fur_support", teamB.id, "support", "FUR Support", now),
    agent("agent_fur_closer", teamB.id, "closer", "FUR Closer", now)
  ];

  await repositories.tournaments.save(tournament);
  await repositories.driverModels.save(driverModel);
  await repositories.teams.save(teamA);
  await repositories.teams.save(teamB);
  await repositories.matches.save(match);
  for (const item of agents) {
    await repositories.agents.save(item);
  }

  return {
    tournament,
    match,
    teams: [teamA, teamB],
    agents,
    driverModel
  };
}

function agent(id: string, teamId: string, role: Agent["role"], displayName: string, createdAt: string): Agent {
  return {
    id,
    teamId,
    driverModelId: phase11DemoIds.driverModelId,
    role,
    displayName,
    baseProfile: {
      personalitySummary: `${displayName} deterministic demo persona.`,
      tacticalSummary: `${displayName} executes stable Phase 1.1 tactics.`,
      styleTags: ["phase11", role]
    },
    currentState: "ready",
    createdAt
  };
}
