import { describe, expect, it } from "vitest";

import { buildCompactTeamPlanRequestInput } from "./phase18-context-boundary.js";

describe("phase18 context boundary", () => {
  it("keeps the essential map, team, agent, economy, and rubric context for team_plan", () => {
    const request = buildCompactTeamPlanRequestInput({
      context: {
        phase18MapSemanticsByMapName: {
          DUST2: {
            proposition: {
              mapTheme: "机会缺口验证",
              coreQuestion: "谁能围绕核心用户痛点证明方案成立？",
              attackFocus: ["buyer_mid"],
              defenseFocus: ["conversion_site_b"],
              displayZoneNames: {
                buyer_mid: "中路买方路径",
                conversion_site_b: "B 点转化区"
              }
            },
            judgeRubric: {
              coreJudgmentAxis: "围绕核心用户验证",
              reasonMustCover: ["攻守焦点", "证据"],
              biasGuardrails: ["不得按名气判胜"]
            }
          }
        }
      },
      round: { id: "round_1", roundNumber: 1 } as any,
      mapGame: { mapName: "dust2" } as any,
      team: {
        id: "team_a",
        displayName: "Team A",
        source: {
          materialInitialProposal: {
            proposalId: "proposal_a",
            version: "v1",
            teamThesis: "围绕核心用户痛点做验证",
            opportunity: "痛点明确",
            product: "产品路径",
            engineering: "工程路径",
            business: "商业路径",
            operations: "运营路径",
            scaling: "规模路径",
            moat: "壁垒",
            mustHoldClaims: ["核心用户成立"],
            failureModes: ["证据不足"],
            playerOperatingPrinciples: ["rifler 保持证据链"],
            frontendSummary: "强标签应只进入 team_plan compact，不进入 judge prestige"
          },
          headCoachProfile: {
            displayName: "Coach A",
            dutySummary: "控制暂停质量",
            style: "冷静"
          }
        }
      } as any,
      opponent: { id: "team_b", displayName: "Team B" } as any,
      activeAgents: [
        {
          id: "agent_1",
          displayName: "Agent 1",
          role: "rifler",
          secondaryRoles: ["support"],
          roleProfile: { agentMajorResponsibilities: ["保持证据链"] },
          baseProfile: { summary: "稳定执行" }
        } as any
      ],
      side: "attack",
      sideAssignment: {
        roundId: "round_1",
        roundNumber: 1,
        attackingTeamId: "team_a",
        defendingTeamId: "team_b",
        half: "first_half",
        sideSwitched: false
      },
      scoreBeforeRound: { teamA: 0, teamB: 0 },
      buyType: "fullBuy",
      teamEconomyPlan: {
        teamId: "team_a",
        posture: "rifle_buy",
        postureReason: "完整购买",
        phase: "pistol_round",
        lossCount: 0,
        decisions: [
          {
            agentId: "agent_1",
            buyType: "fullBuy",
            economyPosture: "rifle_buy",
            loadoutPackage: "rifle_full_t_pack"
          }
        ],
        dropDecisions: []
      } as any,
      beforeEconomy: [{ agentId: "agent_1", teamId: "team_a", tokenBank: 8000 }] as any,
      recentPublicRoundSummaries: ["上一回合摘要"],
      competitiveParityNote: "双方证据长度保持均衡"
    });

    expect(request).toMatchObject({
      mapName: "dust2",
      teamId: "team_a",
      opponentTeamId: "team_b",
      side: "attack",
      economyPosture: "rifle_buy",
      allowedAgentIds: ["agent_1"]
    });
    expect(request.mapSemanticContext).toBeTruthy();
    expect(request.judgeRubricContext).toBeTruthy();
    expect(request.activeAgents).toEqual([
      expect.objectContaining({
        id: "agent_1",
        currentPosture: "rifle_buy",
        loadoutPackage: "rifle_full_t_pack"
      })
    ]);
  });
});
