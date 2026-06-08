import { describe, expect, it } from "vitest";

import { createLlmStageRunner, type StructuredStageInput } from "./llm-stage-runner.js";
import { PHASE20_PRE_PROMPT_CONTRACT_ID } from "../phase18/phase20-pre-prompt-contract.js";

describe("llm stage runner", () => {
  it("delegates structured stage calls without changing the stage contract", async () => {
    let captured: StructuredStageInput<string> | undefined;
    const runner = createLlmStageRunner({
      runStructuredStage: async <TData>(input: StructuredStageInput<TData>) => {
        captured = input as unknown as StructuredStageInput<string>;
        return {
          data: "ok" as TData,
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2
          }
        };
      }
    });

    const response = await runner.runStructuredStage<string>({
      callId: "llm_round_1_judge_verdict",
      stageId: "judge_verdict",
      attemptNumber: 1,
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision",
      driverModelId: "driver_test",
      requestInput: { roundNumber: 1 },
      responseFormat: "json_object",
      seed: "judge:1",
      modelTier: "cheap",
      temperature: 0,
      match: { id: "match_1" } as never,
      mapGame: { id: "map_1" } as never,
      round: { id: "round_1" } as never,
      roundNumber: 1
    });

    expect(response.data).toBe("ok");
    expect(captured).toMatchObject({
      callId: "llm_round_1_judge_verdict",
      stageId: "judge_verdict",
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision"
    });
  });

  it("marks stale started calls and reruns the stage with a fresh call id when resuming", async () => {
    const store = createFakeRepositoryStore();
    const staleCallId = "llm_round_1_attempt_1_agent_agent_a_agent_action";
    await store.repositories.events.append({
      id: "evt_stale_stage_started",
      type: "round_generation_stage_started",
      category: "runtime_control",
      tournamentId: "tournament_1",
      matchId: "match_1",
      mapGameId: "map_1",
      payload: {
        schemaVersion: 1,
        attemptNumber: 1,
        callId: staleCallId,
        stageId: "agent_action:agent_a",
        taskType: "agent_action",
        schemaName: "AgentActionDecision",
        roundId: "round_1",
        roundNumber: 1,
        agentId: "agent_a",
        promptContractId: PHASE20_PRE_PROMPT_CONTRACT_ID
      },
      globalSequence: 1,
      scopeType: "map",
      scopeId: "map_1",
      sequenceInScope: 1,
      sourceModule: "test",
      createdAt: "2026-05-01T00:00:00.000Z"
    } as never);
    await store.repositories.llmCalls.save({
      id: staleCallId,
      tournamentId: "tournament_1",
      matchId: "match_1",
      roundId: "round_1",
      agentId: "agent_a",
      driverModelId: "driver_test",
      taskType: "agent_action",
      promptContractId: PHASE20_PRE_PROMPT_CONTRACT_ID,
      requestArtifactId: "art_request_stale",
      status: "started",
      createdAt: "2026-05-01T00:00:00.000Z"
    });

    const runner = createLlmStageRunner({
      repositories: store.repositories as never,
      llmGateway: {
        generateStructured: async () => ({
          data: { ok: true },
          rawText: "{\"ok\":true}",
          usage: {
            promptTokens: 3,
            completionTokens: 2,
            totalTokens: 5
          }
        })
      } as never,
      buildMessages: () => [{ role: "user", content: "Return JSON." }],
      assertNoMojibakePayload: () => undefined
    });

    const response = await runner.runStructuredStage<{ ok: boolean }>({
      callId: staleCallId,
      stageId: "agent_action:agent_a",
      retryMode: "resume_from_stage",
      attemptNumber: 1,
      task: "agent_action",
      schemaName: "AgentActionDecision",
      driverModelId: "driver_test",
      requestInput: { roundNumber: 1 },
      responseFormat: "json_object",
      seed: "round_1:agent_a",
      modelTier: "cheap",
      temperature: 0,
      match: { id: "match_1", tournamentId: "tournament_1" } as never,
      mapGame: { id: "map_1" } as never,
      round: { id: "round_1" } as never,
      roundNumber: 1,
      agent: { id: "agent_a" } as never,
      validateResponseData: (data) => data as { ok: boolean }
    });

    expect(response.data).toEqual({ ok: true });
    expect(store.llmCalls.get(staleCallId)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("stale_started_call_after_process_interrupt")
    });
    const completedResumeCall = [...store.llmCalls.values()].find((call) => String(call.id).includes("_resume_"));
    expect(completedResumeCall).toMatchObject({
      status: "completed",
      taskType: "agent_action"
    });
    expect(store.events.some((event) => event.type === "llm_call_stale_marked_failed")).toBe(true);
    expect(store.events.some((event) => event.type === "round_generation_stage_stale_recovered")).toBe(true);
  });
});

function createFakeRepositoryStore() {
  const events: Array<Record<string, unknown>> = [];
  const llmCalls = new Map<string, Record<string, unknown>>();
  const repositories = {
    events: {
      getMaxGlobalSequence: async () =>
        events.reduce((max, event) => Math.max(max, typeof event.globalSequence === "number" ? event.globalSequence : 0), 0),
      getMaxSequenceInScope: async (scopeType: string, scopeId: string) =>
        events
          .filter((event) => event.scopeType === scopeType && event.scopeId === scopeId)
          .reduce((max, event) => Math.max(max, typeof event.sequenceInScope === "number" ? event.sequenceInScope : 0), 0),
      append: async (event: Record<string, unknown>) => {
        events.push(event);
        return event;
      },
      listByMatch: async (matchId: string) => events.filter((event) => event.matchId === matchId)
    },
    llmCalls: {
      getById: async (id: string) => llmCalls.get(id) ?? null,
      save: async (call: Record<string, unknown>) => {
        llmCalls.set(String(call.id), call);
      }
    }
  };

  return {
    events,
    llmCalls,
    repositories
  };
}
