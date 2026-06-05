import { describe, expect, it } from "vitest";

import {
  buildJudgeNarrativeRepairRequest,
  buildJudgeNarrativeRequest,
  buildJudgeReviewRequest,
  buildJudgeVerdictRepairRequest,
  translateJudgePromptError
} from "./judge-boundary.js";

describe("judge boundary", () => {
  it("builds verdict repair requests with compact system constraints", () => {
    const request = buildJudgeVerdictRepairRequest({
      validationError: "bad margin",
      judgeRequestInput: {
        teamAName: "Falcon",
        teamBName: "Vitallmty"
      },
      judgePromptContext: {
        requestInput: {
          teamAId: "team_a",
          teamBId: "team_b",
          activeTeamAAgentIds: ["a1"],
          activeTeamBAgentIds: ["b1"],
          sideAssignment: {
            attackingTeamId: "team_a",
            defendingTeamId: "team_b"
          },
          defenderThesisContext: {
            attackingTeamId: "team_a",
            defendingTeamId: "team_b",
            half: "first",
            defenderTeamThesis: "hold long",
            defenderMustHoldClaims: ["claim1", "claim2", "claim3", "claim4"],
            defenderPrimaryZoneId: "conversion_site_a",
            attackerChallengeBrief: "attack a",
            attackerPrimaryZoneId: "conversion_site_a",
            roundSubTheme: "A site pressure",
            allowedCanonicalZoneIds: ["conversion_site_a"],
            thesisEvidenceSources: ["e1", "e2", "e3", "e4", "e5"]
          }
        }
      } as never,
      mapGame: { mapName: "dust2" } as never,
      round: { id: "round_1" } as never,
      roundNumber: 3
    }) as Record<string, unknown>;

    expect(request.validationError).toBe("bad margin");
    expect(request.teamAId).toBe("team_a");
    expect(request.teamBName).toBe("Vitallmty");
    expect(request.allowedCanonicalZoneIds).toEqual(["conversion_site_a"]);
    expect(request.outputShape).toEqual(
      expect.objectContaining({
        scorecardPolicy: expect.stringContaining("Core will materialize")
      })
    );
    expect(request.repairRules).toEqual(expect.arrayContaining([expect.stringContaining("不要输出 currentSubTheme")]));
  });

  it("builds narrative and review requests without reopening locked verdict facts", () => {
    const verdict = {
      winnerTeamId: "team_a",
      loserTeamId: "team_b",
      roundWinType: "attack_conversion",
      margin: "standard",
      attackWinConditionMet: true,
      defenseWinConditionMet: false,
      mvpAgentId: "a1",
      confidence: 0.8,
      reason: "team_a wins through A site pressure",
      diagnostic: {
        currentSubTheme: "用户定义战",
        attackedOpportunityGap: "attack gap",
        defendedCoreProposition: "defense hold",
        mainAttackZoneId: "conversion_site_a",
        mainDefenseZoneId: "conversion_site_a",
        decisiveEvidence: "attack evidence"
      }
    } as never;

    const narrativeRequest = buildJudgeNarrativeRequest({
      verdict,
      judgeRequestInput: {
        roundId: "round_1",
        roundNumber: 3,
        mapName: "dust2",
        teamAId: "team_a",
        teamBId: "team_b",
        tacticalCollision: {
          result: "attack_advantage",
          primaryCollisionZoneId: "conversion_site_a",
          attackBaseScore: 7,
          defenseBaseScore: 6,
          scoreDelta: 1,
          reason: "attack finds the gap"
        }
      },
      mapSemanticContext: {
        mapId: "dust2",
        mapName: "Dust2",
        proposition: {
          mapThesis: "test map thesis",
          regulationRoundThemes: ["r1", "r2"]
        }
      },
      judgeRubricContext: {
        rubricId: "dust2_rubric",
        version: "1"
      }
    }) as Record<string, unknown>;

    expect(narrativeRequest.narrativeLocks).toEqual(
      expect.objectContaining({
        winnerTeamId: "team_a",
        roundWinType: "attack_conversion",
        mainAttackZoneId: "conversion_site_a"
      })
    );
    expect(narrativeRequest.verdict).toEqual(expect.objectContaining({ winnerTeamId: "team_a" }));

    const repairRequest = buildJudgeNarrativeRepairRequest({
      requestInput: narrativeRequest,
      validationError: "missing boundary"
    }) as Record<string, unknown>;
    expect(repairRequest.validationError).toBe("missing boundary");
    expect(repairRequest.repairRules).toEqual(expect.arrayContaining([expect.stringContaining("不得改变 verdict")]));

    const reviewRequest = buildJudgeReviewRequest({
      originalJudgeResult: verdict,
      guardrailReason: "winner streak",
      judgeRequestInput: { roundNumber: 3 }
    }) as Record<string, unknown>;
    expect(reviewRequest.guardrailReason).toBe("winner streak");
    expect(reviewRequest.originalJudgeResult).toBe(verdict);
  });

  it("translates judge prompt errors while preserving error name", () => {
    const translated = translateJudgePromptError(new TypeError("bad winner"), {
      translatePromptText: (value: string) => value.replace("bad winner", "错误胜方")
    } as never);

    expect(translated).toBeInstanceOf(Error);
    expect(translated.name).toBe("TypeError");
    expect(translated.message).toBe("错误胜方");
  });
});
