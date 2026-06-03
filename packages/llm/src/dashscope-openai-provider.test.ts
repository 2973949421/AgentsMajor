import { describe, expect, it } from "vitest";

import { DashScopeOpenAiProvider, LlmProviderError } from "./dashscope-openai-provider.js";
import { loadAgentMajorLlmConfig } from "./env.js";
import { envOpenAiCompatibleDriverModelId, resolveDriverModelConfig } from "./model-registry.js";

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
      phase18DriverModelId: "driver_deepseek_v4_flash",
      casterDriverModelId: "driver_deepseek_v4_flash"
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
    expect(resolveDriverModelConfig("driver_deepseek_v4_flash").modelName).toBe("deepseek-v4-flash");
    expect(resolveDriverModelConfig("driver_kimi_k2_5").modelName).toBe("kimi-k2.5");
    expect(resolveDriverModelConfig("driver_qwen_3_6_plus").modelName).toBe("qwen3.6-plus");
    expect(() => resolveDriverModelConfig("driver_missing")).toThrow(/Unknown driver model id/);
  });

  it("supports env-first OpenAI-compatible provider configuration", () => {
    const config = loadAgentMajorLlmConfig({
      AGENT_MAJOR_REAL_LLM_ENABLED: "true",
      AGENT_MAJOR_LLM_PROVIDER: "openai_compatible",
      AGENT_MAJOR_LLM_BASE_URL: "https://opencode.ai/zen/go/v1",
      AGENT_MAJOR_LLM_API_KEY: "local-secret",
      AGENT_MAJOR_LLM_MODEL: "deepseek-v4-flash"
    });

    expect(config).toMatchObject({
      enabled: true,
      providerId: "openai_compatible",
      baseUrl: "https://opencode.ai/zen/go/v1",
      modelName: "deepseek-v4-flash",
      phase18DriverModelId: envOpenAiCompatibleDriverModelId,
      reasoningMode: "enabled",
      reasoningEffort: "high"
    });
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
    expect(seenBodies).toHaveLength(1);
  });

  it("classifies finish_reason length JSON fragments as json_truncated without repair", async () => {
    const seenBodies: unknown[] = [];
    const truncated = "{\n  \"teamId\": \"team-a\",\n  \"side\": \"attack\",\n  \"primaryIntent\": \"hit";
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: truncated, reasoning_content: "reasoning consumed the budget" } }],
            usage: { prompt_tokens: 40, completion_tokens: 11, total_tokens: 51 }
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
        maxOutputTokens: 1200
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as LlmProviderError).message).toContain("json_truncated");
    expect((thrown as LlmProviderError).providerDiagnostics?.finishReason).toBe("length");
    expect(seenBodies).toHaveLength(1);
  });

  it("retries DeepSeek reasoning exhaustion once with an expanded structured JSON budget", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        const firstAttempt = seenBodies.length === 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: firstAttempt ? "length" : "stop",
                message: firstAttempt
                  ? {
                      content: "",
                      reasoning_content: "{\"text\":\"reasoning draft must not be parsed as final json\"}"
                    }
                  : { content: "{\"teamId\":\"team-a\",\"side\":\"attack\"}" }
              }
            ],
            usage: firstAttempt
              ? { prompt_tokens: 5981, completion_tokens: 1599, total_tokens: 7580 }
              : { prompt_tokens: 5981, completion_tokens: 38, total_tokens: 6019 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const response = await provider.generateStructured<{ teamId: string; side: string }>({
      task: "team_plan",
      driverModelId: "driver_deepseek_v4_flash",
      input: { teamId: "team-a", side: "attack" },
      schemaName: "TeamRoundPlanDecision",
      responseFormat: "json_object",
      maxOutputTokens: 1600
    });

    expect(response.data).toEqual({ teamId: "team-a", side: "attack" });
    expect(seenBodies).toHaveLength(2);
    expect(seenBodies[0]).toMatchObject({
      model: "deepseek-v4-flash",
      max_tokens: 1600,
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    expect(seenBodies[1]).toMatchObject({
      model: "deepseek-v4-flash",
      max_tokens: 3200,
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
  });

  it("uses env model names directly and disables thinking for JSON repair", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      modelName: "deepseek-v4-flash",
      reasoningMode: "enabled",
      reasoningEffort: "high",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        const content =
          seenBodies.length === 1
            ? "{\"teamId\":\"team-a\",\"side\":\"attack\",\"primaryIntent\":\"hit B\""
            : "{\"teamId\":\"team-a\",\"side\":\"attack\",\"primaryIntent\":\"hit B\",\"primaryZoneId\":\"site_b\",\"coordinationSummary\":\"一起进点。\",\"playerDirectives\":[{\"agentId\":\"agent-a\",\"directive\":\"先拿信息。\"}],\"winCondition\":\"下包后守住。\",\"risk\":\"被前压打断。\",\"confidence\":0.8}";
        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const response = await provider.generateStructured({
      task: "team_plan",
      driverModelId: envOpenAiCompatibleDriverModelId,
      input: {
        teamId: "team-a",
        side: "attack",
        activeAgents: [{ id: "agent-a" }]
      },
      schemaName: "TeamRoundPlanDecision",
      responseFormat: "json_object",
      maxOutputTokens: 3200
    });

    expect(response.data).toMatchObject({ teamId: "team-a", side: "attack" });
    expect(seenBodies[0]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    expect(seenBodies[1]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      max_tokens: 1600
    });
    const repairPrompt = ((seenBodies[1] as { messages?: Array<{ content?: string }> }).messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    expect(repairPrompt).toContain("allowedAgentIds");
    expect(repairPrompt).toContain("agent-a");
    expect(repairPrompt).toContain("Never use player1");
  });

  it("lets task extraParams disable DeepSeek thinking without sending reasoning_effort", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      modelName: "deepseek-v4-flash",
      reasoningMode: "enabled",
      reasoningEffort: "high",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "{\"text\":\"ok\"}" } }],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    await provider.generateStructured<{ text: string }>({
      task: "agent_action",
      driverModelId: "driver_deepseek_v4_flash",
      input: { agentId: "agent-a" },
      schemaName: "AgentActionDecision",
      responseFormat: "json_object",
      maxOutputTokens: 1400,
      extraParams: { thinking: { type: "disabled" } }
    });

    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" }
    });
    expect(seenBodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("does not expand budgets for disabled finalizer stages", async () => {
    const seenBodies: unknown[] = [];
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      modelName: "deepseek-v4-flash",
      reasoningMode: "enabled",
      reasoningEffort: "high",
      maxRetries: 0,
      fetchFn: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: {
                  content: "",
                  reasoning_content: "reasoning consumed the finalizer budget"
                }
              }
            ],
            usage: { prompt_tokens: 7000, completion_tokens: 1599, total_tokens: 8599 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    let thrown: unknown;
    try {
      await provider.generateStructured({
        task: "judge_narrative",
        driverModelId: "driver_deepseek_v4_flash",
        input: { verdict: { winnerTeamId: "team-a" } },
        schemaName: "JudgeNarrativeDecision",
        responseFormat: "json_object",
        maxOutputTokens: 1600,
        extraParams: { thinking: { type: "disabled" } }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as LlmProviderError).message).toContain("reasoning_exhausted_empty_content");
    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0]).toMatchObject({
      max_tokens: 1600,
      thinking: { type: "disabled" }
    });
  });

  it("classifies DeepSeek empty content with reasoning diagnostics without trusting reasoning_content", async () => {
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: {
                  content: "",
                  reasoning_content: "{\"text\":\"this is only chain-of-thought style reasoning\"}"
                }
              }
            ],
            usage: { prompt_tokens: 5981, completion_tokens: 3599, total_tokens: 9580 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    let thrown: unknown;
    try {
      await provider.generateStructured({
        task: "team_plan",
        driverModelId: "driver_deepseek_v4_flash",
        input: { teamId: "team-a", side: "attack" },
        schemaName: "TeamRoundPlanDecision",
        responseFormat: "json_object",
        maxOutputTokens: 3600
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as LlmProviderError).message).toContain("reasoning_exhausted_empty_content");
    expect((thrown as LlmProviderError).rawText).toBe("");
    expect((thrown as LlmProviderError).providerDiagnostics).toMatchObject({
      finishReason: "length",
      contentLength: 0,
      emptyContentWithReasoning: true,
      providerResponseShape: "openai_chat_completion"
    });
    expect((thrown as LlmProviderError).providerDiagnostics?.reasoningContentLength).toBeGreaterThan(0);
    expect((thrown as LlmProviderError).providerDiagnostics?.reasoningContentPreview).toContain("this is only");
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
