import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import type { LlmGateway, LlmRequest, LlmResponse } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { phase11DemoIds, seedPhase11Demo } from "./demo.js";
import { createPhase18SimulationEngine } from "./engine.js";
import { readMapReplay } from "./map-replay.js";

describe("Phase 1.8 real-LLM pilot engine", () => {
  it("runs a 5v5 round with authoritative agent outputs and judge results", async () => {
    const gateway = new SuccessfulPhase18Gateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    if (!replay) {
      throw new Error("Expected map replay.");
    }

    const firstRound = replay.rounds[0];
    expect(firstRound?.round.teamAActiveAgentIds).toHaveLength(5);
    expect(firstRound?.round.teamBActiveAgentIds).toHaveLength(5);
    expect(firstRound?.roundReport.agentOutputs).toHaveLength(10);
    expect(firstRound?.roundReport.agentOutputs.every((output) => output.action.startsWith("LLM action"))).toBe(true);
    expect(firstRound?.roundReport.judgeResult.reason).toBe("Ghost NAV win condition succeeded; Ghost FUR win condition failed.");
    expect(firstRound?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
    expect(gateway.tasks).toEqual(["team_plan", "team_plan", ...Array<string>(10).fill("agent_action"), "judge"]);

    const firstAgentRequest = gateway.requests.find((request) => request.task === "agent_action");
    const firstAgentInput = firstAgentRequest?.input as { teamId?: string; teamPlan?: { teamId?: string }; opponentTeamPlan?: unknown } | undefined;
    expect(firstAgentInput?.teamPlan?.teamId).toBe(firstAgentInput?.teamId);
    expect(firstAgentInput).not.toHaveProperty("opponentTeamPlan");

    const judgeRequest = gateway.requests.find((request) => request.task === "judge");
    const judgeInput = judgeRequest?.input as
      | {
          sideAssignment?: unknown;
          teamAName?: string;
          teamBName?: string;
          evaluationOrder?: Array<{ teamId: string; teamPlan?: unknown }>;
          agentOutputsByTeam?: Record<string, unknown[]>;
        }
      | undefined;
    expect(judgeInput?.sideAssignment).toBeDefined();
    expect(judgeInput?.teamAName).toBe("Team Alpha");
    expect(judgeInput?.teamBName).toBe("Team Bravo");
    expect(judgeInput?.evaluationOrder).toHaveLength(2);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.teamPlan)).toBe(true);
    expect(judgeInput?.evaluationOrder?.[0]?.teamId).toBe("team_alpha");
    expect(Object.keys(judgeInput?.agentOutputsByTeam ?? {}).sort()).toEqual(["team_alpha", "team_bravo"]);
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost NAV");
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost FUR");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_nav");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_fur");

    const llmCalls = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM llm_calls").get() as { count: number };
    expect(llmCalls.count).toBe(13);
    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_started")).toHaveLength(13);
    expect(events.filter((event) => event.type === "llm_call_completed")).toHaveLength(13);
  });

  it("alternates judge evaluation order to reduce fixed teamA narrative bias", async () => {
    const gateway = new SuccessfulPhase18Gateway();
    const { engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const judgeInputs = gateway.requests
      .filter((request) => request.task === "judge")
      .map((request) => request.input as { evaluationOrder?: Array<{ teamId: string }> });
    expect(judgeInputs[0]?.evaluationOrder?.[0]?.teamId).toBe("team_alpha");
    expect(judgeInputs[1]?.evaluationOrder?.[0]?.teamId).toBe("team_bravo");
  });

  it("stops the round on agent_action failure without partial round facts", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new FailingAgentGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("planned agent failure");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
    expect((await repositories.events.listByRound(`round_${phase11DemoIds.mapGameId}_1`)).filter((event) => !event.type.startsWith("llm_call_"))).toHaveLength(0);

    const llmCalls = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM llm_calls").get() as { count: number };
    expect(llmCalls.count).toBeGreaterThan(0);
    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.some((event) => event.type === "llm_call_failed")).toBe(true);
  });

  it("marks invalid agent_action payloads as failed calls without partial round facts", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new InvalidAgentPayloadGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("Required");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_completed")).toHaveLength(2);
    expect(events.filter((event) => event.type === "llm_call_failed")).toHaveLength(1);

    const llmCall = repositories.sqlite
      .prepare("SELECT input_tokens AS inputTokens, output_tokens AS outputTokens FROM llm_calls WHERE task_type = 'agent_action' LIMIT 1")
      .get() as
      | { inputTokens: number; outputTokens: number }
      | undefined;
    expect(llmCall).toMatchObject({ inputTokens: 10, outputTokens: 12 });
  });

  it("rejects invalid judge payloads without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new InvalidJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("invalid mvpAgentId");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
    expect((await repositories.events.listByRound(`round_${phase11DemoIds.mapGameId}_1`)).filter((event) => !event.type.startsWith("llm_call_"))).toHaveLength(0);

    const llmCalls = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM llm_calls").get() as { count: number };
    expect(llmCalls.count).toBe(13);
  });

  it("rejects a first-pass judge reason that does not explain both teams' win conditions", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new IncompleteJudgeReasonGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "Judge reason must explain how Ghost NAV succeeded and how Ghost FUR failed."
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_completed")).toHaveLength(12);
    expect(events.filter((event) => event.type === "llm_call_failed")).toHaveLength(1);
  });

  it("rejects invalid team plans before player actions without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new InvalidTeamPlanGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("missed directive for active agent");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_failed")).toHaveLength(1);
    expect(events.some((event) => event.type === "llm_call_started")).toBe(true);
  });

  it("retries the same failed round with attempt-scoped LLM call ids instead of event conflicts", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new RetryableJudgeGateway());
    const roundId = `round_${phase11DemoIds.mapGameId}_1`;

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "Judge reason must explain how Ghost NAV succeeded and how Ghost FUR failed."
    );
    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).resolves.toMatchObject({
      id: roundId,
      roundNumber: 1,
      status: "completed"
    });

    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(1);
    const llmCallIds = repositories.sqlite
      .prepare("SELECT id FROM llm_calls WHERE id LIKE ? ORDER BY id")
      .all(`llm_${roundId}_%`) as Array<{ id: string }>;
    expect(llmCallIds.some((row) => row.id.includes("_attempt_1_"))).toBe(true);
    expect(llmCallIds.some((row) => row.id.includes("_attempt_2_"))).toBe(true);

    const startedEvents = repositories.sqlite
      .prepare("SELECT id FROM events WHERE type = 'llm_call_started' AND json_extract(payload_json, '$.roundId') = ? ORDER BY id")
      .all(roundId) as Array<{ id: string }>;
    expect(startedEvents.some((row) => row.id.includes("_attempt_1_"))).toBe(true);
    expect(startedEvents.some((row) => row.id.includes("_attempt_2_"))).toBe(true);
  });

  it("runs judge_review for suspicious high-confidence streaks and accepts a complete review", async () => {
    const gateway = new SuspiciousJudgeGateway("complete_review");
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    for (let index = 0; index < 4; index += 1) {
      await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    }

    expect(gateway.tasks.filter((task) => task === "judge_review")).toHaveLength(1);
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(4);
  });

  it("fails a suspicious judge review that still omits the loser win condition", async () => {
    const gateway = new SuspiciousJudgeGateway("incomplete_review");
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    for (let index = 0; index < 3; index += 1) {
      await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    }

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("Judge review failed anti-bias guardrail");
    expect(gateway.tasks.filter((task) => task === "judge_review")).toHaveLength(1);
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(3);
  });
});

async function createPhase18DemoEngine(llmGateway: LlmGateway) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase18-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase18SimulationEngine({
    repositories,
    llmGateway,
    jobQueue: new UnconfiguredJobQueue()
  });

  await seedPhase11Demo(repositories);
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
  return { repositories, engine };
}

class SuccessfulPhase18Gateway implements LlmGateway {
  readonly requests: Array<LlmRequest<unknown>> = [];
  readonly tasks: string[] = [];

  async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    if (request.task === "team_plan") {
      const input = request.input as {
        teamId: string;
        side: "attack" | "defense";
        activeAgents: Array<{ id: string }>;
      };
      return {
        data: {
          teamId: input.teamId,
          side: input.side,
          primaryIntent: input.side === "attack" ? "coordinated site hit" : "layered site hold",
          primaryZoneId: input.side === "attack" ? "site_a" : "site_b",
          coordinationSummary: "Five players execute one shared timing window.",
          playerDirectives: input.activeAgents.map((agent) => ({
            agentId: agent.id,
            directive: `Follow the ${input.side} plan`
          })),
          winCondition: `${input.teamId} win condition is synchronized utility and trades.`,
          risk: "Losing the first duel breaks spacing.",
          confidence: 0.82,
          fingerprint: `fp_plan_${input.teamId}`
        } as TData,
        usage: {
          promptTokens: 15,
          completionTokens: 10,
          totalTokens: 25
        }
      };
    }

    if (request.task === "agent_action") {
      const input = request.input as { agentId: string; role: string };
      return {
        data: {
          action: `LLM action for ${input.agentId} as ${input.role}`,
          confidence: 0.91,
          fingerprint: `fp_${input.agentId}`
        } as TData,
        usage: {
          promptTokens: 10,
          completionTokens: 12,
          totalTokens: 22
        }
      };
    }

    if (request.task === "judge_review") {
      const input = request.input as { originalJudgeInput: JudgeRequestInput };
      return this.buildJudgeResponse(input.originalJudgeInput, buildPromptJudgeReason(input.originalJudgeInput)) as LlmResponse<TData>;
    }

    return this.buildJudgeResponse(request.input as JudgeRequestInput, buildPromptJudgeReason(request.input as JudgeRequestInput)) as LlmResponse<TData>;
  }

  protected buildJudgeResponse<TData = unknown>(input: JudgeRequestInput, reason: string, confidence = 0.88): LlmResponse<TData> {
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

interface JudgeRequestInput {
  teamAId: string;
  teamBId: string;
  teamAName?: string;
  teamBName?: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
}

class InvalidTeamPlanGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "team_plan") {
      const input = request.input as {
        teamId: string;
        side: "attack" | "defense";
        activeAgents: Array<{ id: string }>;
      };
      return {
        data: {
          teamId: input.teamId,
          side: input.side,
          primaryIntent: "invalid partial plan",
          primaryZoneId: "site_a",
          coordinationSummary: "Missing several player directives.",
          playerDirectives: input.activeAgents.slice(0, 2).map((agent) => ({ agentId: agent.id, directive: "partial" })),
          winCondition: "Partial plan wins somehow.",
          risk: "Invalid coverage.",
          confidence: 0.4
        } as TData,
        usage: {
          promptTokens: 15,
          completionTokens: 10,
          totalTokens: 25
        }
      };
    }

    return super.generateStructured(request);
  }
}

class SuspiciousJudgeGateway extends SuccessfulPhase18Gateway {
  constructor(private readonly reviewMode: "complete_review" | "incomplete_review") {
    super();
  }

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      return this.buildJudgeResponse(
        request.input as JudgeRequestInput,
        buildPromptJudgeReason(request.input as JudgeRequestInput),
        0.92
      ) as LlmResponse<TData>;
    }

    if (request.task === "judge_review") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { originalJudgeInput: JudgeRequestInput };
      const reason =
        this.reviewMode === "complete_review"
          ? buildDetailedPromptJudgeReason(input.originalJudgeInput)
          : buildPromptJudgeReason(input.originalJudgeInput);
      return this.buildJudgeResponse(input.originalJudgeInput, reason, 0.9) as LlmResponse<TData>;
    }

    return super.generateStructured(request);
  }
}

class FailingAgentGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action" && String((request.input as { agentId: string }).agentId).includes("nav_entry")) {
      throw new Error("planned agent failure");
    }

    return super.generateStructured(request);
  }
}

class InvalidAgentPayloadGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action") {
      return {
        data: {
          actionDecision: "push_site_A"
        } as TData,
        usage: {
          promptTokens: 10,
          completionTokens: 12,
          totalTokens: 22
        }
      };
    }

    return super.generateStructured(request);
  }
}

class InvalidJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
      return super.generateStructured(request);
    }

    const input = request.input as { teamAId: string; teamBId: string };
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        reason: "Invalid judge payload",
        mvpAgentId: "agent_missing",
        confidence: 0.5
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class IncompleteJudgeReasonGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
      return super.generateStructured(request);
    }

    return this.buildJudgeResponse(request.input as JudgeRequestInput, buildIncompletePromptJudgeReason(request.input as JudgeRequestInput)) as LlmResponse<TData>;
  }
}

class RetryableJudgeGateway extends SuccessfulPhase18Gateway {
  private judgeCalls = 0;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    this.judgeCalls += 1;
    const input = request.input as JudgeRequestInput;
    const reason = this.judgeCalls === 1 ? buildIncompletePromptJudgeReason(input) : buildPromptJudgeReason(input);
    return this.buildJudgeResponse(input, reason) as LlmResponse<TData>;
  }
}

function buildPromptJudgeReason(input: JudgeRequestInput): string {
  return `${input.teamAName ?? input.teamAId} win condition succeeded; ${input.teamBName ?? input.teamBId} win condition failed.`;
}

function buildDetailedPromptJudgeReason(input: JudgeRequestInput): string {
  return `${input.teamAName ?? input.teamAId} win condition succeeded through synchronized utility and trades; ${
    input.teamBName ?? input.teamBId
  } failed to keep synchronized utility and trades after losing the first duel and breaking spacing.`;
}

function buildIncompletePromptJudgeReason(input: JudgeRequestInput): string {
  return `${input.teamAName ?? input.teamAId} wins by cleaner trading.`;
}
