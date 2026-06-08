import type { Event, Match, Summary, Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  generateCoachPostMatchReviewsIfNeeded,
  readApprovedTeamMemoryOverlay
} from "./coach-review-service.js";
import type { CoachServiceContext, CoachServiceDependencies } from "./coach-timeout-service.js";

describe("coach review service", () => {
  it("reads only approved team memory overlays", async () => {
    const overlay = await readApprovedTeamMemoryOverlay({
      repositories: {
        summaries: {
          getLatestByScope: async () => ({
            payload: {
              kind: "coach_post_match_review",
              status: "approved",
              review: { nextMatchFocus: "retain mid pressure" }
            }
          })
        }
      } as never,
      teamId: "team_a"
    });

    expect(overlay).toEqual({ nextMatchFocus: "retain mid pressure" });
  });

  it("skips post-match review generation when matching review already exists", async () => {
    const calls: string[] = [];
    const context = {
      useLlmCoachPostMatchReviews: true,
      repositories: {
        teams: {
          getById: async (id: string) => ({ id, displayName: id } as Team)
        },
        mapGames: {
          listByMatch: async () => []
        },
        summaries: {
          getById: async () => null,
          getLatestByScope: async (scopeType: string, scopeId: string) =>
            scopeType === "team"
              ? ({
                  payload: {
                    kind: "coach_post_match_review",
                    status: "pending",
                    matchId: "match_1",
                    teamId: scopeId
                  }
                } as Summary)
              : null,
          save: async () => {
            calls.push("save_summary");
          }
        },
        events: {
          listByMatch: async () => [] as Event[]
        },
        agents: {
          listByTeam: async () => []
        }
      },
      stageRunner: {
        runMatchStructuredStage: async () => {
          calls.push("llm");
          throw new Error("LLM should not be called when review already exists.");
        }
      },
      appendEvent: async () => {
        calls.push("event");
        return {} as Event;
      }
    } as unknown as CoachServiceContext;

    await generateCoachPostMatchReviewsIfNeeded({
      context,
      dependencies: dependencies(),
      match: { id: "match_1", teamAId: "team_a", teamBId: "team_b" } as Match
    });

    expect(calls).toEqual([]);
  });
});

function dependencies(): CoachServiceDependencies {
  return {
    readApprovedTeamMemoryOverlay: async () => undefined,
    readMapSemanticContext: () => undefined,
    readJudgeRubricContext: () => undefined,
    readTeamInitialProposal: () => undefined,
    readTeamCoachContext: () => undefined,
    sortAgentsForRound: (agents) => agents
  };
}
