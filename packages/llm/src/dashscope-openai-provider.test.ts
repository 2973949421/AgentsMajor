import { describe, expect, it } from "vitest";

import { DashScopeOpenAiProvider, LlmProviderError } from "./dashscope-openai-provider.js";
import { loadAgentMajorLlmConfig } from "./env.js";
import { resolveDriverModelConfig } from "./model-registry.js";

describe("Phase 1.5 DashScope OpenAI provider", () => {
  it("keeps real LLM disabled unless explicitly enabled and configured", () => {
    expect(loadAgentMajorLlmConfig({}).enabled).toBe(false);
    expect(loadAgentMajorLlmConfig({ AGENT_MAJOR_REAL_LLM_ENABLED: "true", DASHSCOPE_BASE_URL: "https://example.test/v1" }).enabled).toBe(false);
    expect(
      loadAgentMajorLlmConfig({
        AGENT_MAJOR_REAL_LLM_ENABLED: "true",
        DASHSCOPE_BASE_URL: "https://example.test/v1",
        DASHSCOPE_API_KEY: "local-secret"
      })
    ).toMatchObject({
      enabled: true,
      phase18DriverModelId: "driver_qwen_3_max_2026_01_23",
      casterDriverModelId: "driver_qwen_3_max_2026_01_23"
    });
    expect(
      loadAgentMajorLlmConfig({
        AGENT_MAJOR_REAL_LLM_ENABLED: "true",
        AGENT_MAJOR_LLM_PROVIDER: "other-provider",
        DASHSCOPE_BASE_URL: "https://example.test/v1",
        DASHSCOPE_API_KEY: "local-secret"
      })
    ).toMatchObject({ enabled: false, disabledReason: "unsupported_provider", providerId: "other-provider" });
  });

  it("resolves exact configured model names", () => {
    expect(resolveDriverModelConfig("driver_kimi_k2_5").modelName).toBe("kimi-k2.5");
    expect(resolveDriverModelConfig("driver_qwen_3_6_plus").modelName).toBe("qwen3.6-plus");
    expect(() => resolveDriverModelConfig("driver_missing")).toThrow(/Unknown driver model id/);
  });

  it("sends non-streaming OpenAI-compatible requests and parses usage", async () => {
    const seenBodies: unknown[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      seenBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"text\":\"hello\"}" } }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn
    });

    const response = await provider.generateStructured<{ text: string }>({
      task: "broadcast",
      driverModelId: "driver_kimi_k2_5",
      input: { roundId: "round-1" },
      schemaName: "CasterLinePayload",
      responseFormat: "json_object"
    });

    expect(response.data).toEqual({ text: "hello" });
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(seenBodies[0]).toMatchObject({ model: "kimi-k2.5", stream: false });
    expect(
      (seenBodies[0] as { messages?: Array<{ content?: string }> }).messages?.some((message) => /json/i.test(String(message.content)))
    ).toBe(true);
  });

  it("extracts a balanced JSON object from a response with stray prose", async () => {
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Here is the JSON:\n{\"text\":\"hello\",\"confidence\":0.7}\nDone." } }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const response = await provider.generateStructured<{ text: string; confidence: number }>({
      task: "broadcast",
      driverModelId: "driver_kimi_k2_5",
      input: { roundId: "round-1" },
      schemaName: "CasterLinePayload",
      responseFormat: "json_object"
    });

    expect(response.data).toEqual({ text: "hello", confidence: 0.7 });
  });

  it("repairs a non-JSON structured response once and keeps the original text", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        const content = seenBodies.length === 1 ? "I would attack A with all five players." : "{\"text\":\"repaired\"}";
        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const response = await provider.generateStructured<{ text: string }>({
      task: "team_plan",
      driverModelId: "driver_kimi_k2_5",
      input: { teamId: "team-a" },
      schemaName: "TeamRoundPlanDecision",
      responseFormat: "json_object"
    });

    expect(response.data).toEqual({ text: "repaired" });
    expect(response.structuredRepair).toMatchObject({
      originalRawText: "I would attack A with all five players.",
      repairRawText: "{\"text\":\"repaired\"}"
    });
    expect(seenBodies).toHaveLength(2);
  });

  it("classifies output-limit JSON parse failures as json_truncated", async () => {
    const seenBodies: unknown[] = [];
    const truncated = "{\"teamId\":\"team-a\",\"side\":\"attack\",\"primaryIntent\":\"hit B\"";
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: truncated } }],
            usage:
              seenBodies.length === 1
                ? { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
                : { prompt_tokens: 40, completion_tokens: 1200, total_tokens: 1240 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    let thrown: unknown;
    try {
      await provider.generateStructured({
        task: "team_plan",
        driverModelId: "driver_kimi_k2_5",
        input: { teamId: "team-a", side: "attack", activeAgents: [] },
        schemaName: "TeamRoundPlanDecision",
        responseFormat: "json_object",
        maxOutputTokens: 20
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as LlmProviderError).message).toContain("json_truncated");
    expect((thrown as LlmProviderError).rawText).toBe(truncated);
    expect((thrown as LlmProviderError).usage?.completionTokens).toBe(20);
    expect(seenBodies).toHaveLength(2);
  });

  it("retries transient provider failures before returning a structured response", async () => {
    let calls = 0;
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 2,
      retryBackoffMs: [0, 0],
      fetchFn: async () => {
        calls += 1;
        if (calls < 3) {
          return new Response("temporary upstream failure", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"text\":\"recovered\"}" } }],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const response = await provider.generateStructured<{ text: string }>({
      task: "team_plan",
      driverModelId: "driver_kimi_k2_5",
      input: { teamId: "team-a" },
      schemaName: "TeamRoundPlanDecision",
      responseFormat: "json_object"
    });

    expect(calls).toBe(3);
    expect(response.data).toEqual({ text: "recovered" });
  });

  it("defaults real LLM retry budget to four attempts after the first request", () => {
    expect(
      loadAgentMajorLlmConfig({
        AGENT_MAJOR_REAL_LLM_ENABLED: "true",
        DASHSCOPE_BASE_URL: "https://example.test/v1",
        DASHSCOPE_API_KEY: "local-secret"
      }).maxRetries
    ).toBe(4);
  });

  it("includes the exact AgentActionDecision output contract for JSON requests", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(agentActionDecisionFixture()) } }],
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generateStructured({
      task: "agent_action",
      driverModelId: "driver_kimi_k2_5",
      input: { agentId: "agent-1" },
      schemaName: "AgentActionDecision",
      responseFormat: "json_object"
    });

    const promptText = ((seenBodies[0] as { messages?: Array<{ content?: string }> }).messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    expect(promptText).toContain("roundObjective");
    expect(promptText).toContain("executionPlan");
    expect(promptText).toContain("expectedContribution");
    expect(promptText).toContain('"confidence"');
    expect(promptText).toContain("Do not return the legacy action field");
    expect(promptText).not.toContain('{"action"');
  });

  it("includes the v6 JudgeVerdictDecision scorecard contract for JSON requests", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "{\"winnerTeamId\":\"team-a\",\"loserTeamId\":\"team-b\",\"margin\":\"standard\",\"roundWinType\":\"attack_elimination\",\"attackWinConditionMet\":true,\"defenseWinConditionMet\":false,\"mvpAgentId\":\"agent-a\",\"confidence\":0.8,\"diagnostic\":{\"currentSubTheme\":\"ICP\",\"attackedOpportunityGap\":\"gap\",\"defendedCoreProposition\":\"core\",\"mainAttackZoneId\":\"site_a\",\"mainDefenseZoneId\":\"site_a\",\"zoneRelation\":{\"attackZoneId\":\"site_a\",\"defenseZoneId\":\"site_a\",\"relationType\":\"same_focus\",\"relationSummary\":\"same\",\"outcomeImpact\":\"impact\"},\"decisiveEvidence\":\"evidence\"}}"
                }
              }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generateStructured({
      task: "judge_verdict",
      driverModelId: "driver_kimi_k2_5",
      input: { teamAId: "team-a", teamBId: "team-b" },
      schemaName: "JudgeVerdictDecision",
      responseFormat: "json_object"
    });

    const promptText = ((seenBodies[0] as { messages?: Array<{ content?: string }> }).messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    expect(promptText).toContain("judgeScorecard");
    expect(promptText).toContain("objectiveScore");
    expect(promptText).toContain("Defender-thesis rule");
    expect(promptText).toContain("defenderThesisContext.defenderTeamThesis");
    expect(promptText).toContain("attacking side challenges the defender's business plan");
    expect(promptText).toContain("Use only canonical zone ids");
    expect(promptText).toContain("prefer omitting judgeScorecard entirely");
    expect(promptText).toContain("Never include rubricProfile");
    expect(promptText).toContain("never return null for optional fields");
    expect(promptText).not.toMatch(/"winnerTeamId".*"judgeScorecard"/s);
  });

  it("repairs truncated AgentActionDecision JSON without downgrading to legacy action", async () => {
    const seenBodies: unknown[] = [];
    const fixture = agentActionDecisionFixture();
    const truncated = `${JSON.stringify(fixture).slice(0, -1)},`;
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        const content = seenBodies.length === 1 ? truncated : JSON.stringify(fixture);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const response = await provider.generateStructured<typeof fixture>({
      task: "agent_action",
      driverModelId: "driver_kimi_k2_5",
      input: { agentId: "agent-1" },
      schemaName: "AgentActionDecision",
      responseFormat: "json_object",
      maxOutputTokens: 700
    });

    expect(response.data).toMatchObject({
      roundObjective: fixture.roundObjective,
      expectedContribution: fixture.expectedContribution
    });
    expect(response.structuredRepair).toMatchObject({
      originalRawText: truncated,
      repairRawText: JSON.stringify(fixture)
    });
    const repairBody = seenBodies[1] as { max_tokens?: number; messages?: Array<{ content?: string }> };
    expect(repairBody.max_tokens).toBeGreaterThanOrEqual(1200);
    const repairPrompt = (repairBody.messages ?? []).map((message) => message.content ?? "").join("\n");
    expect(repairPrompt).toContain("Preserve every field required");
    expect(repairPrompt).toContain("Do not replace it with a shorter legacy object");
    expect(repairPrompt).toContain("roundObjective");
    expect(repairPrompt).not.toContain('{"action"');
  });

  it("includes team_plan and anti-bias judge JSON contracts", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"teamId\":\"team-a\",\"side\":\"attack\",\"primaryIntent\":\"hit A\",\"primaryZoneId\":\"site_a\",\"coordinationSummary\":\"trade together\",\"playerDirectives\":[],\"winCondition\":\"plant\",\"risk\":\"stack\",\"confidence\":0.8}" } }],
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generateStructured({
      task: "team_plan",
      driverModelId: "driver_kimi_k2_5",
      input: { teamId: "team-a", side: "attack", activeAgents: [] },
      schemaName: "TeamRoundPlanDecision",
      responseFormat: "json_object"
    });

    await provider.generateStructured({
      task: "judge",
      driverModelId: "driver_kimi_k2_5",
      input: { teamAId: "team-a", teamBId: "team-b" },
      schemaName: "JudgeResult",
      responseFormat: "json_object"
    });

    const teamPlanPrompt = ((seenBodies[0] as { messages?: Array<{ content?: string }> }).messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    expect(teamPlanPrompt).toContain("TeamRoundPlanDecision");
    expect(teamPlanPrompt).toContain("playerDirectives");
    expect(teamPlanPrompt).toContain("winCondition");
    expect(teamPlanPrompt).toContain("Do not include economyIntent.buyIntentByAgent, targetPosture, or preferredLoadout");
    expect(teamPlanPrompt).toContain("The engine derives economy fields from the current economy state");
    expect(teamPlanPrompt).not.toContain('"targetPosture"');
    expect(teamPlanPrompt).not.toContain('"preferredLoadout"');

    const judgePrompt = ((seenBodies[1] as { messages?: Array<{ content?: string }> }).messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    expect(judgePrompt).toContain("both teams' winCondition");
    expect(judgePrompt).toContain("Do not decide from team order");
  });

  it("classifies provider and timeout failures without leaking secrets", async () => {
    const providerError = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () => new Response("provider exploded Authorization: Bearer secret-key sk-sp-secret-token", { status: 500 })
    });

    await expect(
      providerError.generateStructured({
        task: "broadcast",
        driverModelId: "driver_kimi_k2_5",
        input: {},
        schemaName: "CasterLinePayload"
      })
    ).rejects.toMatchObject({ errorType: "provider_error", retryable: true });
    await providerError.generateStructured({
      task: "broadcast",
      driverModelId: "driver_kimi_k2_5",
      input: {},
      schemaName: "CasterLinePayload"
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(JSON.stringify(error)).not.toContain("secret-key");
      expect(JSON.stringify(error)).not.toContain("sk-sp-secret-token");
    });

    const timeoutProvider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () => {
        throw new DOMException("Aborted", "AbortError");
      }
    });

    await expect(
      timeoutProvider.generateStructured({
        task: "broadcast",
        driverModelId: "driver_kimi_k2_5",
        input: {},
        schemaName: "CasterLinePayload"
      })
    ).rejects.toMatchObject({ errorType: "timeout", retryable: true });
  });
});

function agentActionDecisionFixture() {
  return {
    roundObjective: "本回合目标：围绕队伍主计划建立第一接触压力。",
    executionPlan: "执行计划：按队伍窗口推进并保持可交易距离。",
    coordinationPlan: "配合计划：等待支援位资源后再扩大承诺。",
    roleResponsibilityUsage: "职责使用：把先手职责转化为可审计的空间压力。",
    riskRead: "风险判断：如果第一波没有信息，不单人扩大承诺。",
    contingencyPlan: "失败修正：主线受阻时回撤等待二次组织。",
    expectedContribution: "预期贡献：提交清晰的进攻压力和协同证据。",
    confidence: 0.82,
    fingerprint: "agent-action-v2-fixture"
  };
}
