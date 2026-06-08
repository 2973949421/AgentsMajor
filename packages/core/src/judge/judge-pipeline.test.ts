import type { JudgeNarrativeDecision, JudgeResult, JudgeVerdictDecision } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { runJudgePipeline } from "./judge-pipeline.js";
import { createLlmStageRunner } from "../llm/llm-stage-runner.js";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  totalTokens: 2
};

describe("judge pipeline", () => {
  it("runs verdict, narrative and compose without engine callbacks", async () => {
    const calls: string[] = [];
    const verdict = {
      winnerTeamId: "team_a",
      loserTeamId: "team_b",
      roundWinType: "attack_elimination",
      attackWinConditionMet: true,
      defenseWinConditionMet: false,
      margin: "standard",
      mvpAgentId: "agent_a",
      confidence: 0.85,
      diagnostic: {
        currentSubTheme: "测试子命题",
        attackedOpportunityGap: "team_a 找到进攻机会缺口。",
        defendedCoreProposition: "team_b 未能守住核心命题。",
        mainAttackZoneId: "conversion_site_a",
        mainDefenseZoneId: "conversion_site_a",
        zoneRelation: {
          attackZoneId: "conversion_site_a",
          defenseZoneId: "conversion_site_a",
          relationType: "same_focus",
          relationSummary: "双方集中在同一区域。",
          outcomeImpact: "进攻方在同区交锋中取得优势。"
        },
        decisiveEvidence: "team_a 的执行证据更完整。"
      }
    } as JudgeVerdictDecision;
    const narrative = {
      reason: "team_a wins from stronger evidence.",
      judgeInference: {
        source: "judge_inference",
        boundary: "judge inferred combat only.",
        csResolution: "team_a closes the round.",
        combatNarrative: "team_a wins.",
        evidenceBasis: ["verdict"]
      }
    } as JudgeNarrativeDecision;
    const stageRunner = createLlmStageRunner({
      runStructuredStage: async (input) => {
        const stageId = input.stageId ?? "";
        calls.push(stageId);
        if (input.stageId === "judge_verdict") {
          return { data: verdict as never, usage };
        }
        if (input.stageId === "judge_narrative") {
          return { data: narrative as never, usage };
        }
        throw new Error(`Unexpected stage: ${stageId}`);
      }
    });

    const result = await runJudgePipeline({
        judgeRequestInput: { roundNumber: 1 },
        judgePromptContext: {
          requestInput: {
            sideAssignment: {
              roundId: "round_1",
              roundNumber: 1,
              attackingTeamId: "team_a",
              defendingTeamId: "team_b",
              half: "first_half",
              sideSwitched: false
            },
            buyTypesByTeam: {},
            evaluationOrder: [],
            teamAId: "team_a",
            teamBId: "team_b",
            teamAName: "Team A",
            teamBName: "Team B",
            activeTeamAAgentIds: ["agent_a"],
            activeTeamBAgentIds: ["agent_b"],
            judgeEvidenceDigest: {},
            recentPublicRoundSummaries: []
          },
          actualAgentOutputs: [],
          validateAndTranslate: (judgeResult: JudgeResult) => judgeResult,
          translatePromptText: (value: string) => value
        },
        match: { id: "match_1" } as never,
        mapGame: { id: "map_1", mapName: "dust2" } as never,
        round: { id: "round_1" } as never,
        roundNumber: 1,
        observabilityAttempt: 1,
        driverModelId: "driver_test",
        stageRunner,
        sideAssignment: { attackingTeamId: "team_a", defendingTeamId: "team_b" } as never,
        teamA: { id: "team_a", displayName: "Team A", shortName: "A" } as never,
        teamB: { id: "team_b", displayName: "Team B" } as never,
        activeA: [],
        activeB: [],
        agentOutputs: [],
        recentWinnerTeamIds: ["team_a", "team_a", "team_a"],
        useJudgeBiasGuardrail: false
      }
    );

    expect(calls).toEqual(["judge_verdict", "judge_narrative"]);
    expect(result.winnerTeamId).toBe("team_a");
    expect(result.reason).toContain("team_a wins");
  });
});
