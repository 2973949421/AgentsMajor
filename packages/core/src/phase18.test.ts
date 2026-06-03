import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ArtifactRepository } from "@agent-major/db";
import { createSqliteRepositories } from "@agent-major/db";
import type { LlmGateway, LlmRequest, LlmResponse } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import type { Artifact } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { phase11DemoIds, seedPhase11Demo } from "./demo.js";
import { createPhase18SimulationEngine } from "./engine.js";
import { normalizeKnownTacticalZoneId } from "./llm-output-normalizer.js";
import { readMapReplay } from "./map-replay.js";
import {
  PHASE20_PRE_PROMPT_CONTRACT_ID,
  PHASE20_PRE_PROMPT_TASKS,
  buildPhase20PrePromptHashSource,
  buildPhase20PreStructuredMessages
} from "./phase20-pre-prompt-contract.js";
import type { ArtifactStore, ArtifactWriteInput } from "./ports.js";

describe("Phase 1.8 real-LLM pilot engine", () => {
  it("normalizes recent real LLM zone aliases before schema validation", () => {
    expect(normalizeKnownTacticalZoneId("zone_a_small")).toBe("conversion_site_a");
    expect(normalizeKnownTacticalZoneId("zone_b_short")).toBe("conversion_site_b");
    expect(normalizeKnownTacticalZoneId("zone_b_site")).toBe("conversion_site_b");
    expect(normalizeKnownTacticalZoneId("zone_pricing_ramp")).toBe("pricing_ramp");
    expect(normalizeKnownTacticalZoneId("zone_a_pricing_ramp")).toBe("pricing_ramp");
  });

  it("versions the Phase 2.0-pre prompt contract across all structured task messages and hash source", () => {
    const schemaNameByTask: Record<(typeof PHASE20_PRE_PROMPT_TASKS)[number], string> = {
      team_plan: "TeamRoundPlanDecision",
      agent_action: "AgentActionDecision",
      judge_verdict: "JudgeVerdictDecision",
      judge_narrative: "JudgeNarrativeDecision",
      judge_review: "JudgeResult",
      combat_resolution: "CombatResolutionDraft",
      coach_timeout: "CoachTimeoutCorrection",
      coach_post_match_review: "CoachPostMatchReview"
    };

    for (const task of PHASE20_PRE_PROMPT_TASKS) {
      const messages = buildPhase20PreStructuredMessages({
        task,
        schemaName: schemaNameByTask[task],
        requestInput: { roundNumber: 1 },
        contextSummary: "上下文摘要：测试。"
      });

      expect(messages[0]?.content).toContain(PHASE20_PRE_PROMPT_CONTRACT_ID);
      expect(messages[0]?.content).toContain("只输出严格合法的 JSON");
      expect(messages[0]?.content).toContain("自然语言内容默认使用中文");
      expect(messages[0]?.content).toContain("agent_action 是计划性行动，不是 combat ledger");
      expect(messages[1]?.content).toContain(`Prompt Contract：${PHASE20_PRE_PROMPT_CONTRACT_ID}`);
    }

    const currentHashSource = buildPhase20PrePromptHashSource({
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision",
      requestInput: { roundNumber: 1 }
    });
    const nextHashSource = buildPhase20PrePromptHashSource({
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision",
      requestInput: { roundNumber: 1 },
      promptContractId: "phase20pre-prompt-contract-v9"
    });

    expect(currentHashSource).toContain(PHASE20_PRE_PROMPT_CONTRACT_ID);
    expect(nextHashSource).toContain("phase20pre-prompt-contract-v9");
    expect(nextHashSource).not.toBe(currentHashSource);
  });

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
    expect(Object.keys(firstRound?.roundReport.llmTeamPlans ?? {}).sort()).toEqual(["team_ghost_fur", "team_ghost_nav"]);
    expect(firstRound?.roundReport.agentOutputs).toHaveLength(10);
    expect(firstRound?.roundReport.killLedger).toBeDefined();
    expect(firstRound?.roundReport.killLedger?.length).toBeGreaterThanOrEqual(5);
    expect(firstRound?.roundReport.killLedger?.length).toBeLessThanOrEqual(10);
    expect(
      firstRound?.roundReport.killLedger?.every(
        (entry) => Boolean(entry.actorAgentId && entry.targetAgentId && entry.actorTeamId !== entry.targetTeamId)
      )
    ).toBe(true);
    expect(
      firstRound?.roundReport.agentOutputs.every((output) =>
        output.actionDetail?.roundObjective.startsWith("本回合目标")
      )
    ).toBe(true);
    expect(firstRound?.roundReport.judgeResult.reason).toContain("攻方全歼胜");
    expect(firstRound?.roundReport.judgeResult.reason).toContain("成功");
    expect(firstRound?.roundReport.judgeResult.reason).toContain("失败");
    expect(firstRound?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
    expect(firstRound?.roundReport.judgeResult.roundWinType).toBe("attack_elimination");
    expect(firstRound?.roundReport.judgeResult.attackWinConditionMet).toBe(true);
    expect(firstRound?.roundReport.judgeResult.defenseWinConditionMet).toBe(false);
    expect(firstRound?.roundReport.judgeResult.diagnostic).toMatchObject({
      currentSubTheme: "ICP",
      mainAttackZoneId: "buyer_mid",
      mainDefenseZoneId: "conversion_site_a"
    });
    expect(firstRound?.roundReport.judgeDiagnostic).toEqual(firstRound?.roundReport.judgeResult.diagnostic);
    expect(firstRound?.roundReport.tokenSubmission.outputGate.applied).toBe(true);
    expect(firstRound?.roundReport.tokenSubmission.submittedOutputs).toHaveLength(10);
    expect(firstRound?.roundReport.tokenSubmission.submittedOutputs?.every((output) => output.submissionKind === "submitted_output")).toBe(true);
    expect(firstRound?.roundReport.tokenSubmission.submittedOutputIds.every((id) => id.startsWith("sub_out_"))).toBe(true);
    expect(firstRound?.roundReport.agentOutputs.every((output) => !output.id.startsWith("sub_"))).toBe(true);
    expect(firstRound?.roundReport.economyDelta.teamEconomyPostures).toEqual({
      teamA: "pistol_round",
      teamB: "pistol_round"
    });
    expect(firstRound?.roundReport.summary).toContain("手枪局");
    expect(firstRound?.roundReport.summary).not.toMatch(/\uFFFD/u);
    expect(firstRound?.roundReport.summary).not.toContain("Tactical:");
    expect(gateway.tasks).toEqual([
      "team_plan",
      "team_plan",
      ...Array<string>(10).fill("agent_action"),
      "judge_verdict",
      "judge_narrative"
    ]);

    const teamPlanRequest = gateway.requests.find((request) => request.task === "team_plan");
    const teamPlanInput = teamPlanRequest?.input as
      | {
          mapSemanticContext?: { proposition?: { mapTheme?: string } };
          judgeRubricContext?: { coreJudgmentAxis?: string };
          initialProposal?: { teamThesis?: string; mustHoldClaims?: string[] };
          coachContext?: { displayName?: string };
          activeAgents?: Array<{ id?: string; role?: string; baseProfile?: unknown; profileSummary?: string }>;
        }
      | undefined;
    expect(teamPlanInput?.mapSemanticContext?.proposition?.mapTheme).toBe("opportunity_positioning");
    expect(teamPlanInput?.judgeRubricContext?.coreJudgmentAxis).toBe("opportunity_truth");
    expect(teamPlanInput?.initialProposal?.teamThesis).toContain("first-user");
    expect(teamPlanInput?.initialProposal?.mustHoldClaims?.length).toBeGreaterThan(0);
    expect(teamPlanInput?.coachContext?.displayName).toContain("Ghost");
    expect(JSON.stringify(teamPlanInput).length).toBeLessThan(12_000);
    expect(teamPlanInput?.activeAgents?.every((agent) => agent.id && agent.role)).toBe(true);
    expect(teamPlanInput?.activeAgents?.some((agent) => "baseProfile" in agent)).toBe(false);
    expect(teamPlanRequest?.messages?.[0]?.content).toContain("JSON");
    expect(teamPlanRequest?.messages?.[1]?.content).toContain("地图主题：opportunity_positioning");
    expect(teamPlanRequest?.messages?.[1]?.content).toContain("队伍唯一方案：");
    expect(teamPlanRequest?.extraParams).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });

    const firstAgentRequest = gateway.requests.find((request) => request.task === "agent_action");
    const firstAgentInput = firstAgentRequest?.input as
      | {
          teamId?: string;
          teamPlan?: { teamId?: string };
          opponentTeamPlan?: unknown;
          mapSemanticContext?: { proposition?: { coreQuestion?: string } };
          initialProposal?: unknown;
          proposalAnchor?: { teamThesis?: string; playerOperatingPrinciples?: string[] };
          coachContext?: { dutySummary?: string };
        }
      | undefined;
    expect(firstAgentInput?.teamPlan?.teamId).toBe(firstAgentInput?.teamId);
    expect(firstAgentInput).not.toHaveProperty("opponentTeamPlan");
    expect(firstAgentInput).not.toHaveProperty("initialProposal");
    expect(firstAgentInput?.mapSemanticContext?.proposition?.coreQuestion).toContain("deserve");
    expect(firstAgentInput?.proposalAnchor?.teamThesis).toContain("first-user");
    expect(firstAgentInput?.proposalAnchor?.playerOperatingPrinciples?.length).toBeGreaterThan(0);
    expect(firstAgentInput?.coachContext?.dutySummary).toContain("timeout");
    expect(firstAgentRequest?.messages?.[1]?.content).toContain("核心问题：");
    expect(firstAgentRequest?.messages?.[1]?.content).toContain("选手指令：");
    expect(firstAgentRequest?.extraParams).toEqual({ thinking: { type: "disabled" } });

    const judgeRequest = gateway.requests.find((request) => request.task === "judge_verdict");
    const judgeInput = judgeRequest?.input as
      | {
          mapSemanticContext?: { proposition?: { mapTheme?: string } };
          judgeRubricContext?: { coreJudgmentAxis?: string };
          sideAssignment?: unknown;
          defenderThesisContext?: { defenderTeamThesis?: string; attackerChallengeBrief?: string; defendingTeamId?: string };
          teamAName?: string;
          teamBName?: string;
          evaluationOrder?: Array<{ teamId: string; teamPlan?: unknown; initialProposalSummary?: unknown; coachContext?: unknown }>;
          judgeEvidenceDigest?: Record<string, { items: Array<{ agentId?: string; evidence?: string[] }>; maxEvidencePerItem?: number }>;
        }
      | undefined;
    expect(judgeRequest?.extraParams).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(judgeInput?.mapSemanticContext?.proposition?.mapTheme).toBe("opportunity_positioning");
    expect(judgeInput?.judgeRubricContext?.coreJudgmentAxis).toBe("opportunity_truth");
    expect(judgeInput?.sideAssignment).toBeDefined();
    expect(judgeInput?.defenderThesisContext?.defenderTeamThesis).toContain("system stability");
    expect(judgeInput?.defenderThesisContext?.attackerChallengeBrief).toContain("challenge");
    expect(judgeInput?.defenderThesisContext?.defendingTeamId).toBe("team_bravo");
    expect(judgeInput?.teamAName).toBe("Team Alpha");
    expect(judgeInput?.teamBName).toBe("Team Bravo");
    expect(judgeInput?.evaluationOrder).toHaveLength(2);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.teamPlan)).toBe(true);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.initialProposalSummary)).toBe(true);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.coachContext)).toBe(true);
    expect(JSON.stringify(judgeInput?.evaluationOrder ?? [])).not.toContain("frontendSummary");
    expect(JSON.stringify(judgeInput?.evaluationOrder ?? [])).not.toContain("personaSummary");
    expect(judgeInput?.evaluationOrder?.[0]?.teamId).toBe("team_alpha");
    expect(JSON.stringify(judgeInput)).not.toContain("agentOutputsByTeam");
    expect(Object.keys(judgeInput?.judgeEvidenceDigest ?? {}).sort()).toEqual(["team_alpha", "team_bravo"]);
    const alphaDigest = judgeInput?.judgeEvidenceDigest?.team_alpha;
    const bravoDigest = judgeInput?.judgeEvidenceDigest?.team_bravo;
    expect(alphaDigest).toBeDefined();
    expect(bravoDigest).toBeDefined();
    if (!alphaDigest || !bravoDigest) {
      throw new Error("Expected both judge evidence digests.");
    }
    expect(alphaDigest.items).toHaveLength(bravoDigest.items.length);
    expect(alphaDigest.maxEvidencePerItem).toBe(2);
    expect(alphaDigest.items.every((item) => (item.evidence?.length ?? 0) <= 2)).toBe(true);
    expect(JSON.stringify(judgeInput?.judgeEvidenceDigest)).not.toContain("agent_nav");
    expect(JSON.stringify(judgeInput?.judgeEvidenceDigest)).not.toContain("agent_fur");
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost NAV");
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost FUR");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_nav");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_fur");
    expect(judgeRequest?.messages?.[1]?.content).toContain("裁判轴：opportunity_truth");
    expect(judgeRequest?.messages?.[1]?.content).toContain("反偏置约束：");
    const judgeNarrativeRequest = gateway.requests.find((request) => request.task === "judge_narrative");
    const judgeNarrativeInput = judgeNarrativeRequest?.input as { originalJudgeInput?: Record<string, unknown> } | undefined;
    const compactNarrativeContext = JSON.stringify(judgeNarrativeInput?.originalJudgeInput ?? {});
    expect(judgeNarrativeRequest?.extraParams).toEqual({ thinking: { type: "disabled" } });
    expect(compactNarrativeContext.length).toBeLessThan(4_000);
    expect(compactNarrativeContext).not.toContain("defenderThesisContext");
    expect(compactNarrativeContext).not.toContain("rubricProfile");
    expect(compactNarrativeContext).not.toContain("evaluationOrder");
    expect(gateway.requests.every((request) => request.messages?.[0]?.content.includes(PHASE20_PRE_PROMPT_CONTRACT_ID))).toBe(true);
    expect(gateway.tasks).not.toContain("combat_resolution");
    const roundEvents = await repositories.events.listByRound(firstRound?.round.id ?? "");
    expect(roundEvents.filter((event) => event.type === "kill_feed_created")).toHaveLength(firstRound?.roundReport.killLedger?.length ?? 0);
    const scoreMaterializedEvent = roundEvents.find((event) => event.type === "judge_evidence_score_materialized");
    expect(scoreMaterializedEvent?.payload).toMatchObject({
      scorecardSource: "evidence_materialized_from_draft",
      winnerFromScore: firstRound?.roundReport.judgeResult.winnerTeamId
    });

    const llmCalls = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM llm_calls").get() as { count: number };
    expect(llmCalls.count).toBe(14);
    const contractCalls = repositories.sqlite
      .prepare("SELECT COUNT(*) AS count FROM llm_calls WHERE prompt_contract_id = ?")
      .get(PHASE20_PRE_PROMPT_CONTRACT_ID) as { count: number };
    expect(contractCalls.count).toBe(14);
    const linkedArtifactCalls = repositories.sqlite
      .prepare("SELECT COUNT(*) AS count FROM llm_calls WHERE request_artifact_id IS NOT NULL AND response_artifact_id IS NOT NULL")
      .get() as { count: number };
    expect(linkedArtifactCalls.count).toBe(14);
    const llmArtifacts = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE artifact_type LIKE 'llm_%'").get() as {
      count: number;
    };
    expect(llmArtifacts.count).toBe(28);
    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_started")).toHaveLength(14);
    expect(events.filter((event) => event.type === "llm_call_completed")).toHaveLength(14);
    expect(
      events
        .filter((event) => event.type === "llm_call_started")
        .every((event) => (event.payload as { promptContractId?: string }).promptContractId === PHASE20_PRE_PROMPT_CONTRACT_ID)
    ).toBe(true);
  });

  it("reuses validated round stage drafts when resuming from a failed stage", async () => {
    const gateway = new FailFirstJudgeNarrativeGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId, retryMode: "resume_from_stage" })).rejects.toThrow(
      "planned judge narrative failure"
    );
    const firstAttemptTaskCount = gateway.tasks.length;
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId, retryMode: "resume_from_stage" });

    const secondAttemptTasks = gateway.tasks.slice(firstAttemptTaskCount);
    expect(secondAttemptTasks).not.toContain("team_plan");
    expect(secondAttemptTasks).not.toContain("agent_action");
    expect(secondAttemptTasks).not.toContain("judge_verdict");
    expect(secondAttemptTasks).toContain("judge_narrative");
    const stageEvents = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(stageEvents.filter((event) => event.type === "round_generation_stage_validated").length).toBeGreaterThan(0);
    expect(stageEvents.filter((event) => event.type === "round_generation_stage_reused").length).toBeGreaterThan(0);
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(1);
  });

  it("uses a local narrative fallback when the final judge narrative exhausts reasoning", async () => {
    const gateway = new ReasoningExhaustedJudgeNarrativeGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    if (!replay) {
      throw new Error("Expected map replay after local judge narrative fallback.");
    }
    const firstRound = replay.rounds[0];
    expect(firstRound?.roundReport.judgeResult.reason).toContain("第 1 回合");
    expect(firstRound?.roundReport.judgeResult.judgeInference?.source).toBe("judge_inference");
    expect(firstRound?.roundReport.judgeResult.judgeInference?.boundary).toContain("不是 agent_action 原始事实");
    expect(gateway.requests.filter((request) => request.task === "judge_narrative")).toHaveLength(1);
    const failedCall = repositories.sqlite
      .prepare("SELECT status, error FROM llm_calls WHERE task_type = 'judge_narrative' LIMIT 1")
      .get() as { status: string; error: string | null };
    expect(failedCall.status).toBe("failed");
    expect(failedCall.error).toContain("reasoning_exhausted_empty_content");
  });

  it("retries team_plan without thinking when reasoning exhausts final content", async () => {
    const gateway = new ReasoningExhaustedTeamPlanGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    expect(replay?.rounds).toHaveLength(1);
    const teamPlanRequests = gateway.requests.filter((request) => request.task === "team_plan");
    expect(teamPlanRequests).toHaveLength(3);
    expect(teamPlanRequests[0]?.extraParams).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(teamPlanRequests[1]?.extraParams).toEqual({ thinking: { type: "disabled" } });

    const failedPrimary = repositories.sqlite
      .prepare("SELECT status, error FROM llm_calls WHERE task_type = 'team_plan' AND id NOT LIKE '%no_thinking' AND status = 'failed' LIMIT 1")
      .get() as { status: string; error: string | null };
    expect(failedPrimary.status).toBe("failed");
    expect(failedPrimary.error).toContain("reasoning_exhausted_empty_content");

    const completedFallback = repositories.sqlite
      .prepare("SELECT status FROM llm_calls WHERE task_type = 'team_plan' AND id LIKE '%no_thinking' LIMIT 1")
      .get() as { status: string };
    expect(completedFallback.status).toBe("completed");
  });

  it("retries judge_verdict without thinking when reasoning exhausts final content", async () => {
    const gateway = new ReasoningExhaustedJudgeVerdictGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    expect(replay?.rounds).toHaveLength(1);
    const judgeRequests = gateway.requests.filter((request) => request.task === "judge_verdict");
    expect(judgeRequests).toHaveLength(2);
    expect(judgeRequests[0]?.extraParams).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(judgeRequests[1]?.extraParams).toEqual({ thinking: { type: "disabled" } });

    const failedPrimary = repositories.sqlite
      .prepare("SELECT status, error FROM llm_calls WHERE task_type = 'judge_verdict' AND id NOT LIKE '%no_thinking' AND status = 'failed' LIMIT 1")
      .get() as { status: string; error: string | null };
    expect(failedPrimary.status).toBe("failed");
    expect(failedPrimary.error).toContain("reasoning_exhausted_empty_content");

    const completedFallback = repositories.sqlite
      .prepare("SELECT status FROM llm_calls WHERE task_type = 'judge_verdict' AND id LIKE '%no_thinking' LIMIT 1")
      .get() as { status: string };
    expect(completedFallback.status).toBe("completed");
  });

  it("alternates judge evaluation order to reduce fixed teamA narrative bias", async () => {
    const gateway = new SuccessfulPhase18Gateway();
    const { engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const judgeInputs = gateway.requests
      .filter((request) => request.task === "judge_verdict")
      .map((request) => request.input as { evaluationOrder?: Array<{ teamId: string }> });
    expect(judgeInputs[0]?.evaluationOrder?.[0]?.teamId).toBe("team_alpha");
    expect(judgeInputs[1]?.evaluationOrder?.[0]?.teamId).toBe("team_bravo");
  });

  it("keeps post-pistol economy away from save-versus-all-force defaults", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new SuccessfulPhase18Gateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const secondRoundReport = replay?.rounds[1]?.roundReport;
    const teamPostures = secondRoundReport?.economyDelta.teamEconomyPostures;
    const agentsByTeam = new Map<string, NonNullable<typeof secondRoundReport>["economyDelta"]["agents"]>();

    for (const row of secondRoundReport?.economyDelta.agents ?? []) {
      const existing = agentsByTeam.get(row.teamId) ?? [];
      existing.push(row);
      agentsByTeam.set(row.teamId, existing);
    }

    expect(secondRoundReport?.economyDelta.teamNetDelta).toBeDefined();
    expect(Object.values(teamPostures ?? {})).not.toContain("save_play");
    expect(Object.values(teamPostures ?? {})).toContain("bonus_round");
    expect([...agentsByTeam.values()].some((rows) => rows.every((row) => row.buyType === "forceBuy"))).toBe(false);
  });

  it("normalizes common judge margin synonyms without weakening winner validation", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ClearMarginJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.margin).toBe("standard");
    expect(replay?.rounds[0]?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
  });

  it("normalizes observed judge zone relation aliases before schema validation", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(
      new CustomRelationTypeJudgeGateway("direct_collision")
    );

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.zoneRelation?.relationType).toBe("same_focus");
  });

  it("downgrades unknown judge zone relation aliases instead of blocking the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(
      new CustomRelationTypeJudgeGateway("offensive_focus_creates_pressure")
    );

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const zoneRelation = replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.zoneRelation;

    expect(zoneRelation?.relationType).toBe("cross_hit");
    expect(zoneRelation?.relationSummary).toContain("offensive_focus_creates_pressure");
  });

  it("rejects missing judge diagnostics without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new MissingDiagnosticJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "Judge diagnostic is required"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects incomplete judge diagnostic fields without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new PartialDiagnosticJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("decisiveEvidence");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects invalid judge diagnostic map zones without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new InvalidDiagnosticZoneJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "mainAttackZoneId is not a valid map zone"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects judge reasons that conflict with diagnostic zone focus", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ConflictingDiagnosticJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "Judge reason and diagnostic zone focus conflict"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("allows judge reasons to mention auxiliary zones when the diagnostic focus is still present", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new AuxiliaryZoneJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judgeResult = replay?.rounds[0]?.roundReport.judgeResult;

    expect(judgeResult?.diagnostic?.mainAttackZoneId).toBe("conversion_site_a");
    expect(judgeResult?.diagnostic?.mainDefenseZoneId).toBe("conversion_site_a");
    expect(judgeResult?.reason).toContain("pricing_ramp");
    expect(judgeResult?.reason).toContain("buyer_mid");
  });

  it("accepts DeepSeek B-zone wording while auxiliary routes are also mentioned", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new DeepSeekBZoneAuxiliaryJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judgeResult = replay?.rounds[0]?.roundReport.judgeResult;

    expect(judgeResult?.diagnostic?.mainAttackZoneId).toBe("conversion_site_b");
    expect(judgeResult?.diagnostic?.mainDefenseZoneId).toBe("conversion_site_b");
    expect(judgeResult?.reason).toContain("B区");
    expect(judgeResult?.reason).toContain("中路");
    expect(judgeResult?.reason).toContain("B洞");
  });

  it("accepts semantic zone relationship explanations without fixed bridge phrases", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new SemanticZoneBridgeJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const reason = replay?.rounds[0]?.roundReport.judgeResult.reason ?? "";

    expect(reason).toContain("buyer_mid");
    expect(reason).toContain("conversion_site_a");
    expect(reason).not.toContain("主攻落点");
    expect(reason).not.toContain("守方命题焦点");
  });

  it("rejects judges that treat zone relation as an automatic win rule", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ZoneDeterminismShortcutJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "automatic win/loss rule"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("accepts zone mismatch explanations that connect to proof failure instead of automatic victory", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ZoneMismatchProofFailureJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic).toMatchObject({
      mainAttackZoneId: "buyer_mid",
      mainDefenseZoneId: "conversion_site_a"
    });
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("防守焦点脱离");
  });

  it("accepts defense wins where zone mismatch means the attack did not test the core proposition", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new DefenseZoneMismatchProofFailureJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.roundWinType).toBe("defense_elimination");
    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.mainAttackZoneId).toBe("buyer_mid");
    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.mainDefenseZoneId).toBe("conversion_site_a");
  });

  it("accepts sanitized Team Alpha and Team Bravo labels in judge diagnostic fields", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new SanitizedTeamLabelDiagnosticJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.attackedOpportunityGap).toBeTruthy();
  });

  it("accepts DeepSeek diagnostic wording that uses gap and breakthrough cues", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new DeepSeekDiagnosticWordingJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.attackedOpportunityGap).toContain("击穿");
    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.defendedCoreProposition).toContain("主攻");
  });

  it("expands thin DeepSeek diagnostic gap wording with attack/defense context", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ThinDeepSeekOpportunityGapJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const attackedGap = replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.attackedOpportunityGap;

    expect(attackedGap).toContain("攻防互动");
    expect(attackedGap).toContain("过度聚焦B区");
    expect(attackedGap).toContain("打开缺口");
  });

  it("rejects direct no-coverage zone shortcut proof as deterministic judging", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new DirectNoCoverageShortcutJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "automatic win/loss rule"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("accepts judge micro-combat details when they are marked as judge inference", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new UnsupportedMicroCombatJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.judgeInference?.source).toBe("judge_inference");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("清点包点");
  });

  it("does not run judge_review for valid judge inference combat narration", async () => {
    const gateway = new RepairableInvalidJudgeGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds).toHaveLength(1);
    expect(gateway.tasks).toContain("judge_verdict");
    expect(gateway.tasks).not.toContain("judge_review");
  });

  it("accepts judge evidence that quotes planned micro-combat requirements as unsupported by the fact layer", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new GuardedMicroCombatEvidenceJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.decisiveEvidence).toContain("combat ledger");
    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.decisiveEvidence).toContain("没有");
  });

  it("accepts compact Chinese display zone aliases in judge decisive evidence", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new CompactDisplayZoneEvidenceJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.mainAttackZoneId).toBe("conversion_site_b");
    expect(replay?.rounds[0]?.roundReport.judgeResult.diagnostic?.decisiveEvidence).toContain("B点");
  });

  it("allows result-like micro-combat wording in agent_action but keeps judge evidence clean", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new UnsupportedMicroCombatAgentActionGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => agentOutputText(output).includes("击杀转化"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).not.toContain("击杀转化");
  });

  it("accepts judge micro-combat wording when judgeInference marks it as judge inference", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new AgentActionSupportedMicroCombatJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.judgeInference?.boundary).toContain("裁判推断");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("清点动作");
  });

  it("rejects judge micro-combat wording without an explicit inference boundary", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new UnlabeledMicroCombatJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "judgeInference.boundary must mark combat details as judge inference"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("accepts intent-only agent_action language when the judge keeps evidence at plan level", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new IntentOnlyAgentActionGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => agentOutputText(output).includes("准备清点"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).not.toContain("清点");
  });

  it("allows timing and preparation wording in agent_action without treating it as combat fact", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new TimingIntentAgentActionGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => agentOutputText(output).includes("前3秒"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => agentOutputText(output).includes("准备关键击杀"))).toBe(true);
  });

  it("accepts decisive margins when the judge gives strong non-micro evidence", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new StrongDecisiveJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.margin).toBe("decisive");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("决定性");
  });

  it("accepts decisive margins when the judge uses full-elimination wording", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new FullEliminationDecisiveJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.margin).toBe("decisive");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("全歼");
  });

  it("rejects mojibake LLM responses before committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new CorruptedJudgeRawTextGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "LLM context encoding is corrupted in judge_verdict raw response"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects mojibake inside parsed judge data before committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new CorruptedJudgeDataGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "LLM context encoding is corrupted in judge_verdict structured response"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("accepts Chinese judge reasons that explain winner success and loser failure paths", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ChineseJudgeReasonGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("成功");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("未能");
    expect(replay?.rounds[0]?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
  });

  it("normalizes mixed-language judge reasons to Chinese-first phrasing", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new MixedLanguageJudgeReasonGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const reason = replay?.rounds[0]?.roundReport.judgeResult.reason ?? "";

    expect(reason).toContain("未能证明");
    expect(reason).toContain("其用户是真实存在的");
    expect(reason).not.toContain("failed to prove");
    expect(reason).not.toContain("rather than aspirational");
  });

  it("normalizes object-shaped playerDirectives in team plans before validation", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ObjectDirectiveTeamPlanGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const firstRound = replay?.rounds[0];
    const navPlan = firstRound?.roundReport.llmTeamPlans?.team_ghost_nav;
    const furPlan = firstRound?.roundReport.llmTeamPlans?.team_ghost_fur;

    expect(Array.isArray(navPlan?.playerDirectives)).toBe(true);
    expect(navPlan?.playerDirectives).toHaveLength(5);
    expect(furPlan?.playerDirectives).toHaveLength(5);
    expect(firstRound?.roundReport.agentOutputs).toHaveLength(10);
  });

  it("maps ordered player placeholders in repaired team_plan directives to active agent ids", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new OrderedPlaceholderTeamPlanGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const firstRound = replay?.rounds[0];
    const plans = Object.values(firstRound?.roundReport.llmTeamPlans ?? {});
    const activeAgentIds = new Set([...(firstRound?.round.teamAActiveAgentIds ?? []), ...(firstRound?.round.teamBActiveAgentIds ?? [])]);

    expect(plans).toHaveLength(2);
    expect(plans.flatMap((plan) => plan.playerDirectives.map((directive) => directive.agentId))).not.toContain("player1");
    expect(plans.every((plan) => plan.playerDirectives.every((directive) => activeAgentIds.has(directive.agentId)))).toBe(true);
    expect(firstRound?.roundReport.agentOutputs).toHaveLength(10);
  });

  it("omits null optional fields in team plans before validation", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new NullOptionalTeamPlanGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const plans = Object.values(replay?.rounds[0]?.roundReport.llmTeamPlans ?? {});

    expect(plans).toHaveLength(2);
    expect(plans.every((plan) => plan.secondaryZoneId === undefined)).toBe(true);
    expect(plans.every((plan) => plan.economyIntent?.defaultPosture)).toBe(true);
    expect(plans.every((plan) => plan.economyIntent?.summary)).toBe(true);
    expect(plans.every((plan) => plan.economyIntent?.acceptBonus === undefined)).toBe(true);
    expect(plans.every((plan) => plan.economyIntent?.buyIntentByAgent?.every((intent) => intent.note === undefined))).toBe(true);
  });

  it("derives team plan economy from engine state and normalizes known zone aliases", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new AliasedEconomyTeamPlanGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const plans = Object.values(replay?.rounds[0]?.roundReport.llmTeamPlans ?? {});

    expect(plans).toHaveLength(2);
    expect(plans.every((plan) => plan.primaryZoneId === "conversion_site_b")).toBe(true);
    expect(plans.every((plan) => plan.secondaryZoneId === "buyer_mid")).toBe(true);
    expect(plans.every((plan) => plan.economyIntent?.defaultPosture === "pistol_round")).toBe(true);
    expect(
      plans.every((plan) => plan.economyIntent?.buyIntentByAgent?.every((intent) => intent.targetPosture === "pistol_round"))
    ).toBe(true);
  });

  it("code-completes missing judge scorecards from valid v6 verdict facts", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new MissingScorecardJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judgeScorecard = replay?.rounds[0]?.roundReport.judgeResult.judgeScorecard;

    expect(judgeScorecard?.scorecardSource).toBe("evidence_materialized_from_draft");
    expect(judgeScorecard?.winnerFromScore).toBe(replay?.rounds[0]?.roundReport.judgeResult.winnerTeamId);
    expect(judgeScorecard?.marginFromScore).toBe(replay?.rounds[0]?.roundReport.judgeResult.margin);
    expect(judgeScorecard?.defenderThesisContext?.defendingTeamId).toBe("team_ghost_fur");
    expect(judgeScorecard?.defenderThesisContext?.attackerChallengeBrief).toContain("challenge");
  });

  it("materializes judge system facts from semantic drafts instead of trusting LLM labels", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new SemanticJudgeDraftGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judge = replay?.rounds[0]?.roundReport.judgeResult;

    expect(judge?.diagnostic?.currentSubTheme).toBe("ICP");
    expect(judge?.diagnostic?.mainAttackZoneId).toBe("conversion_site_b");
    expect(judge?.diagnostic?.zoneRelation?.attackZoneId).toBe("conversion_site_b");
    expect(judge?.judgeScorecard?.scorecardSource).toBe("evidence_materialized_from_draft");
  });

  it("keeps judge verdict repair input compact and avoids copying full rubric context", async () => {
    const gateway = new CompactJudgeRepairGateway();
    const { engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const judgeRequests = gateway.requests.filter((request) => request.task === "judge_verdict");
    const repairInput = judgeRequests[1]?.input as Record<string, unknown> | undefined;

    expect(judgeRequests).toHaveLength(2);
    expect(repairInput).toBeDefined();
    expect(repairInput?.originalJudgeInput).toBeUndefined();
    expect(repairInput?.mapSemanticContext).toBeUndefined();
    expect(repairInput?.judgeRubricContext).toBeUndefined();
    expect(repairInput?.defenderThesisContext).toBeDefined();
    expect(JSON.stringify(repairInput).length).toBeLessThan(7000);
    expect(String((repairInput?.outputShape as { scorecardPolicy?: string } | undefined)?.scorecardPolicy)).toContain("omitting judgeScorecard");
  });

  it("normalizes judge zone aliases and derives margin from scorecard", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ZoneAliasAndMarginJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judge = replay?.rounds[0]?.roundReport.judgeResult;

    expect(judge?.diagnostic?.mainAttackZoneId).toBe("conversion_site_a");
    expect(judge?.diagnostic?.mainDefenseZoneId).toBe("buyer_mid");
    expect(judge?.diagnostic?.zoneRelation?.attackZoneId).toBe("conversion_site_a");
    expect(judge?.diagnostic?.zoneRelation?.defenseZoneId).toBe("buyer_mid");
    expect(judge?.margin).toBe("decisive");
    expect(judge?.judgeScorecard?.llmProposedMargin).toBe("narrow");
    expect(judge?.judgeScorecard?.scorecardSource).toBe("evidence_materialized_from_draft");
    expect(judge?.judgeScorecard?.teamScores[judge.winnerTeamId]?.objectiveScore.evidenceSource).toBe("team_plan");
  });

  it("normalizes observed bomb-site judge aliases before repair is needed", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new BombSiteAliasJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judge = replay?.rounds[0]?.roundReport.judgeResult;

    expect(judge?.diagnostic?.mainAttackZoneId).toBe("conversion_site_b");
    expect(judge?.diagnostic?.mainDefenseZoneId).toBe("conversion_site_a");
    expect(judge?.diagnostic?.zoneRelation?.attackZoneId).toBe("conversion_site_b");
    expect(judge?.diagnostic?.zoneRelation?.defenseZoneId).toBe("conversion_site_a");
  });

  it("normalizes object-shaped coach timeout payloads before validation", async () => {
    const gateway = new ObjectCoachTimeoutGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    expect(gateway.tasks.filter((task) => task === "coach_timeout")).toHaveLength(1);
    expect(gateway.requests.find((request) => request.task === "coach_timeout")?.extraParams).toEqual({ thinking: { type: "disabled" } });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const sixthRound = replay?.rounds[5];
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection).toMatchObject({
      teamId: "team_ghost_fur",
      triggerRoundNumber: 5
    });
    expect(typeof sixthRound?.roundReport.appliedCoachTimeoutCorrection?.zonePriorityShift).toBe("string");
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.zonePriorityShift).toContain("提高");
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.zonePriorityShift).toContain("平衡约束");
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.teamDirective).not.toContain("五名选手全部");
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.nextRoundObjective).not.toContain("唯一主");
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.playerAdjustments).toHaveLength(5);
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

  it("rejects legacy repaired agent_action payloads that downgrade back to action", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new LegacyActionAgentPayloadGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("roundObjective");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects mojibake inside structured repair artifacts before committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new MojibakeRepairAgentGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("repair original response");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it.each(["NiKo", "star_rifler", "agent_star"])("materializes judge MVP aliases instead of hard failing: %s", async (mvpAlias) => {
    const { repositories, engine } = await createPhase18DemoEngine(new MvpAliasJudgeGateway(mvpAlias));

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).resolves.toMatchObject({
      roundNumber: 1,
      status: "completed"
    });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const judge = replay?.rounds[0]?.roundReport.judgeResult;
    expect(judge?.mvpAgentId).not.toBe(mvpAlias);
    const winnerAgents = await repositories.agents.listByTeam(judge?.winnerTeamId ?? "");
    expect(winnerAgents.map((agent) => agent.id)).toContain(judge?.mvpAgentId);

    const llmCalls = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM llm_calls").get() as { count: number };
    expect(llmCalls.count).toBe(14);
  });

  it("rejects a first-pass judge reason that does not explain both teams' win conditions", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new IncompleteJudgeReasonGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "Judge reason must explain how Ghost NAV succeeded and how Ghost FUR failed."
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.filter((event) => event.type === "llm_call_completed")).toHaveLength(14);
    expect(events.filter((event) => event.type === "llm_call_failed")).toHaveLength(0);
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

  it("initializes two tactical timeouts per team when the map starts", async () => {
    const { repositories } = await createPhase18DemoEngine(new SuccessfulPhase18Gateway());

    const coachStates = await repositories.teamMapCoachStates.listByMapGame(phase11DemoIds.mapGameId);
    expect(coachStates).toHaveLength(2);
    expect(coachStates.every((state) => state.timeoutsRemaining === 2)).toBe(true);
  });

  it("creates a timeout correction only for the just-lost team and applies it to the next round", async () => {
    const gateway = new ConsecutiveLossTimeoutGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    expect(gateway.tasks.filter((task) => task === "coach_timeout")).toHaveLength(0);
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    expect(gateway.tasks.filter((task) => task === "coach_timeout")).toHaveLength(0);
    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });

    expect(gateway.tasks.filter((task) => task === "coach_timeout")).toHaveLength(1);
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const sixthRound = replay?.rounds[5];
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection).toMatchObject({
      teamId: "team_ghost_fur",
      triggerRoundNumber: 5
    });
    expect(sixthRound?.roundReport.appliedCoachTimeoutCorrection?.teamDirective).toContain("平衡约束");
    expect(replay?.timeoutsRemainingByTeam.team_ghost_nav).toBe(2);
    expect(replay?.timeoutsRemainingByTeam.team_ghost_fur).toBe(1);
  });

  it("creates one pending post-match review per team after the BO3 ends", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new SuccessfulPhase18Gateway());
    await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
    const match = await repositories.matches.getById(phase11DemoIds.matchId);
    const completedMatch = {
      ...match!,
      status: "completed" as const
    };
    await repositories.matches.save(completedMatch);
    await (
      engine as unknown as {
        generateCoachPostMatchReviewsIfNeeded: (input: typeof completedMatch) => Promise<void>;
      }
    ).generateCoachPostMatchReviewsIfNeeded(completedMatch);

    expect(completedMatch.status).toBe("completed");
    const teamAReview = await repositories.summaries.getLatestByScope("team", "team_ghost_nav");
    const teamBReview = await repositories.summaries.getLatestByScope("team", "team_ghost_fur");
    const teamAReviewPayload = teamAReview?.payload as { kind?: string; status?: string; matchId?: string } | undefined;
    const teamBReviewPayload = teamBReview?.payload as { kind?: string; status?: string; matchId?: string } | undefined;

    expect(teamAReviewPayload).toMatchObject({
      kind: "coach_post_match_review",
      status: "pending",
      matchId: phase11DemoIds.matchId
    });
    expect(teamBReviewPayload).toMatchObject({
      kind: "coach_post_match_review",
      status: "pending",
      matchId: phase11DemoIds.matchId
    });
  });
});

class TestArtifactStore implements ArtifactStore {
  private counter = 0;
  private readonly contents = new Map<string, string>();

  constructor(private readonly artifacts: ArtifactRepository) {}

  async write(input: ArtifactWriteInput): Promise<Artifact> {
    this.counter += 1;
    const content = typeof input.content === "string" ? input.content : Buffer.from(input.content).toString("utf8");
    const artifact: Artifact = {
      id: `art_test_${this.counter}`,
      artifactType: input.artifactType,
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      mapGameId: input.mapGameId,
      roundId: input.roundId,
      agentId: input.agentId,
      uri: `memory:${input.relativePath}`,
      mimeType: "application/json",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      status: "ready",
      sourceEventIds: input.sourceEventIds,
      createdAt: new Date().toISOString()
    };
    await this.artifacts.save(artifact);
    this.contents.set(artifact.id, content);
    return artifact;
  }

  async readText(artifactId: string): Promise<string> {
    const content = this.contents.get(artifactId);
    if (content === undefined) {
      throw new Error(`Unknown test artifact: ${artifactId}`);
    }
    return content;
  }
}

async function createPhase18DemoEngine(llmGateway: LlmGateway) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase18-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase18SimulationEngine({
    repositories,
    llmGateway,
    jobQueue: new UnconfiguredJobQueue(),
    artifactStore: new TestArtifactStore(repositories.artifacts),
    phase18MapSemanticsByMapName: {
      DUST2: {
        proposition: {
          mapTheme: "opportunity_positioning",
          coreQuestion: "Does this project deserve to exist right now?",
          attackFocus: ["fake demand", "weak pain"],
          defenseFocus: ["core user", "core pain"],
          regulationRoundThemes: [{ round: "R1", theme: "ICP", judgment: "Who is the first user?" }],
          overtimeRoundThemes: [{ round: "OT1", theme: "ICP+Pain", judgment: "Whose opportunity is more real?" }],
          coachWindows: ["timeout", "post_match_review"],
          displayZoneNames: {
            buyer_mid: "Mid",
            conversion_site_a: "A Site",
            conversion_site_b: "B 点",
            retention_connector: "A 小"
          },
          frontendMinimumFields: ["current subtheme", "main attack zone", "main defense zone"]
        },
        judgeRubric: {
          coreJudgmentAxis: "opportunity_truth",
          coreQuestion: "Does this project deserve to exist right now?",
          axes: [{ key: "ICP_clarity", question: "Is the first user clear?" }],
          roundJudgmentFlow: ["confirm subtheme", "check attack hit", "check defense hold"],
          reasonMustCover: ["subtheme", "attack gap", "defense core"],
          biasGuardrails: ["team order bias", "fame bias"],
          coachConsumptionWindows: ["timeout", "post_match_review"]
        }
      }
    }
  });

  await seedPhase11Demo(repositories);
  const seededMatch = await repositories.matches.getById(phase11DemoIds.matchId);
  if (!seededMatch) {
    throw new Error("Expected seeded match.");
  }
  const [teamA, teamB] = await Promise.all([
    repositories.teams.getById(seededMatch.teamAId),
    repositories.teams.getById(seededMatch.teamBId)
  ]);
  if (!teamA || !teamB) {
    throw new Error("Expected seeded teams.");
  }
  await repositories.teams.save({
    ...teamA,
    source: {
      materialInitialProposal: {
        proposalId: "proposal_team_alpha_core_v1",
        version: "v1",
        teamId: teamA.id,
        teamSlug: "team-alpha",
        displayName: teamA.displayName,
        teamThesis: "first-user clarity before system spread",
        opportunity: "prove the first user and the first painful workflow earlier than the opponent",
        product: "ship a narrow proof surface before broad platform coverage",
        engineering: "concentrate engineering effort on the decisive proof path",
        business: "monetize from the highest urgency entry wedge first",
        operations: "route field learning back into the single decisive motion",
        scaling: "scale after the first-user loop is stable",
        moat: "moat comes from repeated proof in the highest-value lane",
        mustHoldClaims: ["first-user clarity", "narrow proof wedge"],
        failureModes: ["slow pivot"],
        playerOperatingPrinciples: [
          "IGL: call the decisive proof lane early.",
          "Entry: open the first-user pressure point.",
          "AWPer: hold the proof angle that blocks the defense reset.",
          "Rifler: convert the first opening into stable space.",
          "Support: keep the structure from breaking during conversion."
        ],
        coachWindowPolicies: {
          timeout: "tighten the first-user proof lane",
          postMatchReview: "record which proof lane survived the whole BO3"
        },
        frontendSummary: "Focus on first-user proof before widening the system."
      },
      headCoachProfile: {
        displayName: "Blade Ghost",
        dutySummary: "timeout correction / post-match review",
        personaSummary: "reset the team during pressure"
      }
    }
  });
  await repositories.teams.save({
    ...teamB,
    source: {
      materialInitialProposal: {
        proposalId: "proposal_team_bravo_core_v1",
        version: "v1",
        teamId: teamB.id,
        teamSlug: "team-bravo",
        displayName: teamB.displayName,
        teamThesis: "system stability before aggressive expansion",
        opportunity: "prove the system can hold under pressure before expanding scope",
        product: "prefer reliable closed-loop surfaces over premature breadth",
        engineering: "stabilize critical execution paths before adding branches",
        business: "protect conversion certainty before chasing wider reach",
        operations: "use consistent process to keep the defense coherent",
        scaling: "scale after the stable loop survives repeated pressure",
        moat: "moat comes from reliable execution under attack",
        mustHoldClaims: ["system stability", "reliable closure"],
        failureModes: ["over-forcing"],
        playerOperatingPrinciples: [
          "IGL: hold the structure before chasing side ideas.",
          "Entry: test pressure without breaking the back line.",
          "AWPer: deny the decisive opening lane.",
          "Lurker: validate side pressure without exposing the core.",
          "Support: keep the closure path intact during rotations."
        ],
        coachWindowPolicies: {
          timeout: "restore closure discipline",
          postMatchReview: "record which stability claim failed across the BO3"
        },
        frontendSummary: "Protect system stability and close the round cleanly."
      },
      headCoachProfile: {
        displayName: "Sidde Ghost",
        dutySummary: "timeout correction / post-match review",
        personaSummary: "stabilize tempo and trade discipline"
      }
    }
  });
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
  return { repositories, engine };
}

function buildAgentActionDecision(input: {
  agentId: string;
  role?: string;
  roundObjective?: string;
  executionPlan?: string;
  coordinationPlan?: string;
  roleResponsibilityUsage?: string;
  riskRead?: string;
  contingencyPlan?: string;
  expectedContribution?: string;
}) {
  const role = input.role ?? "player";
  return {
    roundObjective: input.roundObjective ?? `本回合目标：${input.agentId} 以 ${role} 职责支撑队伍主计划。`,
    executionPlan:
      input.executionPlan ??
      "执行计划：围绕队伍指令建立第一接触、补位和收束节奏，不声明已经完成击杀或清点结果。",
    coordinationPlan:
      input.coordinationPlan ??
      "配合计划：跟随 IGL 的节奏窗口，与相邻队友保持可交易距离，并把资源集中到主攻或主守焦点。",
    roleResponsibilityUsage:
      input.roleResponsibilityUsage ??
      `职责使用：把 ${role} 的长期职责转化为本回合可执行的站位、沟通和风险控制。`,
    riskRead: input.riskRead ?? "风险判断：如果第一波接触没有得到信息，避免单人扩大承诺，等待队伍二次确认。",
    contingencyPlan: input.contingencyPlan ?? "修正方案：若主计划受阻，保留回撤、补枪和重新集结的窗口。",
    expectedContribution: input.expectedContribution ?? "预期贡献：提供可被裁判审计的有效压力、空间控制和队伍协同证据。",
    confidence: 0.91,
    fingerprint: `fp_${input.agentId}`
  };
}

function agentOutputText(output: {
  action?: string | undefined;
  actionDetail?: {
    roundObjective?: string | undefined;
    executionPlan?: string | undefined;
    coordinationPlan?: string | undefined;
    roleResponsibilityUsage?: string | undefined;
    riskRead?: string | undefined;
    contingencyPlan?: string | undefined;
    expectedContribution?: string | undefined;
  } | undefined;
}) {
  const detail = output.actionDetail;
  return [
    output.action,
    detail?.roundObjective,
    detail?.executionPlan,
    detail?.coordinationPlan,
    detail?.roleResponsibilityUsage,
    detail?.riskRead,
    detail?.contingencyPlan,
    detail?.expectedContribution
  ]
    .filter(Boolean)
    .join("\n");
}

class SuccessfulPhase18Gateway implements LlmGateway {
  readonly requests: Array<LlmRequest<unknown>> = [];
  readonly tasks: string[] = [];
  private readonly judgeNarrativesByRoundId = new Map<
    string,
    { reason: string; judgeInference: ReturnType<typeof buildJudgeInference> }
  >();

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
          ...buildAgentActionDecision({
            agentId: input.agentId,
            role: input.role
          })
        } as TData,
        usage: {
          promptTokens: 10,
          completionTokens: 12,
          totalTokens: 22
        }
      };
    }

    if (request.task === "coach_timeout") {
      const input = request.input as {
        teamId: string;
        triggerRoundNumber: number;
        activeAgents: Array<{ id: string }>;
      };
      return {
        data: {
          teamId: input.teamId,
          triggerRoundNumber: input.triggerRoundNumber,
          triggerReason: "Consecutive losses exposed the same opportunity gap.",
          diagnosedFailure: "The decisive proof lane became too diffuse.",
          nextRoundObjective: "Lock the decisive proof lane one round earlier.",
          ownCoreToHold: "Protect the single decisive proof lane.",
          opponentGapToHit: "Punish the defender's delayed rotation.",
          zonePriorityShift: "Raise A pressure and lower side noise.",
          teamDirective: "All five players refocus on the primary proof lane.",
          playerAdjustments: input.activeAgents.map((agent) => ({
            agentId: agent.id,
            adjustment: `One-line correction for ${agent.id}`
          })),
          expiresAfterRoundNumber: input.triggerRoundNumber + 1,
          confidence: 0.84,
          fingerprint: `fp_timeout_${input.teamId}_${input.triggerRoundNumber}`
        } as TData,
        usage: {
          promptTokens: 22,
          completionTokens: 24,
          totalTokens: 46
        }
      };
    }

    if (request.task === "coach_post_match_review") {
      const input = request.input as { teamId: string; matchId: string };
      return {
        data: {
          teamId: input.teamId,
          matchId: input.matchId,
          keptBeliefs: ["Keep the narrow proof wedge."],
          brokenBeliefs: ["Do not over-invest in side pressure without closure."],
          effectiveAttacks: ["Fast convergence on the decisive proof lane."],
          effectiveDefenses: ["Anchor the core proposition before wide rotation."],
          timeoutQualityReview: "Timeouts restored focus on the primary proof lane.",
          nextMatchUpgrades: ["Tighten opening calls", "Reduce low-value flank testing"],
          proposedStrategyPatch: "Carry the same proof wedge into the next match with faster closure.",
          confidence: 0.81,
          fingerprint: `fp_review_${input.teamId}`
        } as TData,
        usage: {
          promptTokens: 28,
          completionTokens: 30,
          totalTokens: 58
        }
      };
    }

    if (request.task === "judge_review") {
      const input = request.input as { originalJudgeInput: JudgeRequestInput };
      return this.buildJudgeResponse(
        input.originalJudgeInput,
        buildDetailedPromptJudgeReason(input.originalJudgeInput)
      ) as LlmResponse<TData>;
    }

    if (request.task === "judge_narrative") {
      const input = request.input as {
        originalJudgeInput: JudgeRequestInput;
        verdict: {
          roundWinType?: "attack_elimination" | "attack_bomb_explosion" | "defense_elimination" | "defense_timeout_no_plant" | "defense_defuse";
          reason?: string;
          judgeInference?: ReturnType<typeof buildJudgeInference>;
        };
      };
      const stored = this.judgeNarrativesByRoundId.get(input.originalJudgeInput.roundId);
      const reason = input.verdict.reason ?? stored?.reason ?? buildPromptJudgeReason(input.originalJudgeInput);
      return {
        data: {
          reason,
          judgeInference:
            input.verdict.judgeInference ??
            stored?.judgeInference ??
            buildJudgeInference(input.originalJudgeInput, reason, input.verdict.roundWinType ?? "attack_elimination")
        } as TData,
        usage: {
          promptTokens: 24,
          completionTokens: 18,
          totalTokens: 42
        }
      };
    }

    if (request.task === "combat_resolution") {
      const input = request.input as {
        roundId: string;
        verdict: { roundWinType: "attack_elimination" | "attack_bomb_explosion" | "defense_elimination" | "defense_timeout_no_plant" | "defense_defuse"; mvpAgentId: string };
        activeRosters: {
          teamA: Array<{ id: string; teamId: string }>;
          teamB: Array<{ id: string; teamId: string }>;
        };
        attackerTeamId: string;
        defenderTeamId: string;
        teamAId: string;
        teamBId: string;
      };
      return {
        data: buildCombatResolutionDraftFixture(input) as TData,
        usage: {
          promptTokens: 26,
          completionTokens: 20,
          totalTokens: 46
        }
      };
    }

    return this.buildJudgeResponse(request.input as JudgeRequestInput, buildPromptJudgeReason(request.input as JudgeRequestInput)) as LlmResponse<TData>;
  }

  protected buildJudgeResponse<TData = unknown>(
    input: JudgeRequestInput,
    reason: string,
    confidence = 0.88,
    margin: string = "standard",
    winnerTeamId = input.teamAId,
    loserTeamId = input.teamBId
  ): LlmResponse<TData> {
    const outcome = resolveFixtureJudgeOutcome(input, winnerTeamId);
    const normalizedReason = ensureZoneBridge(reason, outcome.roundWinType, input);
    this.judgeNarrativesByRoundId.set(input.roundId, {
      reason: normalizedReason,
      judgeInference: buildJudgeInference(input, normalizedReason, outcome.roundWinType)
    });
    return {
      data: {
        winnerTeamId,
        loserTeamId,
        margin,
        roundWinType: outcome.roundWinType,
        attackWinConditionMet: outcome.attackWinConditionMet,
        defenseWinConditionMet: outcome.defenseWinConditionMet,
        reason: normalizedReason,
        mvpAgentId: outcome.mvpAgentId,
        confidence,
        judgeScorecard: buildJudgeScorecardFixture(input, winnerTeamId, loserTeamId, margin, outcome.roundWinType),
        judgeInference: buildJudgeInference(input, normalizedReason, outcome.roundWinType),
        diagnostic: buildJudgeDiagnostic(input, normalizedReason, winnerTeamId, loserTeamId)
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class FailFirstJudgeNarrativeGateway extends SuccessfulPhase18Gateway {
  private failedNarrative = false;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge_narrative" && !this.failedNarrative) {
      this.failedNarrative = true;
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      throw new Error("planned judge narrative failure");
    }

    return super.generateStructured(request);
  }
}

class ReasoningExhaustedJudgeNarrativeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_narrative") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    throw new Error(
      "reasoning_exhausted_empty_content: LLM provider consumed output budget in reasoning_content and returned empty message content."
    );
  }
}

class ReasoningExhaustedTeamPlanGateway extends SuccessfulPhase18Gateway {
  private failedPrimaryTeamPlan = false;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "team_plan" && !this.failedPrimaryTeamPlan) {
      this.failedPrimaryTeamPlan = true;
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      throw new Error(
        "reasoning_exhausted_empty_content: LLM provider consumed output budget in reasoning_content and returned empty message content."
      );
    }

    return super.generateStructured(request);
  }
}

class ReasoningExhaustedJudgeVerdictGateway extends SuccessfulPhase18Gateway {
  private failedPrimaryJudgeVerdict = false;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge_verdict" && !this.failedPrimaryJudgeVerdict) {
      this.failedPrimaryJudgeVerdict = true;
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      throw new Error(
        "reasoning_exhausted_empty_content: LLM provider consumed output budget in reasoning_content and returned empty message content."
      );
    }

    return super.generateStructured(request);
  }
}

class MissingDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: buildPromptJudgeReason(input),
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class CustomRelationTypeJudgeGateway extends SuccessfulPhase18Gateway {
  constructor(private readonly relationType: string) {
    super();
  }

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const diagnostic = response.data.diagnostic as { zoneRelation?: Record<string, unknown> } | undefined;
    return {
      ...response,
      data: {
        ...response.data,
        diagnostic: {
          ...diagnostic,
          zoneRelation: {
            ...(diagnostic?.zoneRelation ?? {}),
            relationType: this.relationType
          }
        }
      } as TData
    };
  }
}

class ClearMarginJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    return this.buildJudgeResponse(
      request.input as JudgeRequestInput,
      buildPromptJudgeReason(request.input as JudgeRequestInput),
      0.88,
      "clear"
    ) as LlmResponse<TData>;
  }
}

class ZoneAliasAndMarginJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge_narrative") {
      const input = request.input as { originalJudgeInput: JudgeRequestInput; verdict: { roundWinType?: "attack_elimination" } };
      const reason =
        `本局胜利方式是攻方全歼胜。${input.originalJudgeInput.teamAName ?? input.originalJudgeInput.teamAId} 决定性地成功打穿守方 thesis 的核心缺口；` +
        `${input.originalJudgeInput.teamBName ?? input.originalJudgeInput.teamBId} 失败在于完全未能守住守方商业计划的主命题。`;
      return {
        data: {
          reason,
          judgeInference: buildJudgeInference(input.originalJudgeInput, reason, input.verdict.roundWinType ?? "attack_elimination")
        } as TData,
        usage: {
          promptTokens: 24,
          completionTokens: 18,
          totalTokens: 42
        }
      };
    }
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason = buildPromptJudgeReason(input);
    const dimension = (score: number, evidenceSource: unknown = "round_context") => ({
      score,
      evidence: `${input.teamAName ?? input.teamAId} 对守方 thesis 的 challenge 与 ${input.teamBName ?? input.teamBId} 的防守回应形成清晰分差。`,
      evidenceSource
    });
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "narrow",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: {
          teamScores: {
            [input.teamAId]: {
              objectiveScore: dimension(9, ["roleResponsibilities"]),
              mapControlScore: dimension(9, "zone_relation"),
              submissionQualityScore: dimension(9, "submitted_output"),
              coordinationScore: dimension(9, "team_plan"),
              economyAdjustedScore: dimension(9, "economy"),
              riskControlScore: dimension(9, "riskRead"),
              proofScore: dimension(9, "judge_rubric_context")
            },
            [input.teamBId]: {
              objectiveScore: dimension(5),
              mapControlScore: dimension(5, "zone_relation"),
              submissionQualityScore: dimension(5, "submitted_output"),
              coordinationScore: dimension(5, "team_plan"),
              economyAdjustedScore: dimension(5, "economy"),
              riskControlScore: dimension(5, "round_context"),
              proofScore: dimension(5, "judge_rubric_context")
            }
          },
          decisiveDimensions: ["objectiveScore", "proofScore"],
          roundWinTypeJustification: "攻方 challenge 打穿守方 thesis，胜法与攻方身份一致。"
        },
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "zone_a_main",
          mainDefenseZoneId: "zone_mid",
          zoneRelation: {
            attackZoneId: "zone_a_main",
            defenseZoneId: "zone_mid",
            relationType: "cross_axis_pressure",
            relationSummary: "攻方从 A 点主攻挑战守方中路命题焦点。",
            outcomeImpact: "攻方 challenge 直接打穿守方商业计划的关键防线。"
          }
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class BombSiteAliasJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const input = request.input as JudgeRequestInput;
    return {
      ...response,
      data: {
        ...response.data,
        diagnostic: {
          ...buildJudgeDiagnostic(input, buildPromptJudgeReason(input)),
          mainAttackZoneId: "zone_bomb_site_b",
          mainDefenseZoneId: "zone_bomb_site_a",
          zoneRelation: {
            attackZoneId: "zone_bomb_site_b",
            defenseZoneId: "zone_bomb_site_a",
            relationType: "weak_side_hit",
            relationSummary: "攻方集中B点挑战守方A点命题焦点。",
            outcomeImpact: "区域错位影响本回合裁决。"
          }
        }
      } as TData
    };
  }
}

class PartialDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: buildPromptJudgeReason(input),
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        diagnostic: {
          currentSubTheme: "用户定义战",
          attackedOpportunityGap: "败方核心用户定义不清晰",
          defendedCoreProposition: "胜方守住了第一用户证明",
          mainAttackZoneId: "conversion_site_a",
          mainDefenseZoneId: "buyer_mid"
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class InvalidDiagnosticZoneJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: buildPromptJudgeReason(input),
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, buildPromptJudgeReason(input), "attack_elimination"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, buildPromptJudgeReason(input)),
          mainAttackZoneId: "unknown_zone"
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class ConflictingDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: `${input.teamAName ?? input.teamAId} 围绕 A Site 成功推进；${input.teamBName ?? input.teamBId} 未能守住核心成立点。`,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(
          input,
          `${input.teamAName ?? input.teamAId} 围绕 A Site 成功推进；${input.teamBName ?? input.teamBId} 未能守住核心成立点。`,
          "attack_elimination"
        ),
        diagnostic: {
          ...buildJudgeDiagnostic(input, buildPromptJudgeReason(input)),
          mainAttackZoneId: "buyer_mid",
          mainDefenseZoneId: "buyer_mid",
          zoneRelation: {
            attackZoneId: "buyer_mid",
            defenseZoneId: "buyer_mid",
            relationType: "same_focus",
            relationSummary: "buyer_mid 同时被声明为主攻和主守焦点，供测试判词与诊断焦点冲突。",
            outcomeImpact: "该结构字段本身不决定胜负，冲突应来自 reason 提到 A Site 而诊断焦点没有覆盖。"
          }
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class AuxiliaryZoneJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功围绕 conversion_site_a 执行进攻并打中机会缺口；` +
      `${input.teamBName ?? input.teamBId} 失败在于未能守住 conversion_site_a 的核心成立点。` +
      "判词可以引用 pricing_ramp、buyer_mid 和 retention_connector 作为进攻路径、架枪或信息辅助区域，但这些不是主焦点。";
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "conversion_site_a",
          mainDefenseZoneId: "conversion_site_a",
          zoneRelation: {
            attackZoneId: "conversion_site_a",
            defenseZoneId: "conversion_site_a",
            relationType: "same_focus",
            relationSummary: "conversion_site_a 是双方主焦点，其他区域只作为进攻路径和辅助证据。",
            outcomeImpact: "胜负由双方计划与行动质量解释，不由区域相同自动决定。"
          },
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 的 team_plan 与 agent_action 主体落在 conversion_site_a；` +
            "pricing_ramp、buyer_mid 与 retention_connector 只作为辅助路径证据，不改变主攻/主守焦点。"
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class DeepSeekBZoneAuxiliaryJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 集中精锐快速攻占B区，突破守方中路前压防线；` +
      `${input.teamBName ?? input.teamBId} 的B洞侧翼未能及时回防，导致B区核心成立点失守。`;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "conversion_site_b",
          mainDefenseZoneId: "conversion_site_b",
          zoneRelation: {
            attackZoneId: "conversion_site_b",
            defenseZoneId: "conversion_site_b",
            relationType: "same_focus",
            relationSummary: "B区是双方主焦点；中路与B洞只作为前压和回防路径证据。",
            outcomeImpact: "胜负来自计划执行和回防失败，不由区域相同自动决定。"
          },
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 主体打中B区；中路前压与B洞回防是辅助证据，` +
            `${input.teamBName ?? input.teamBId} 因核心成立点失守而失败。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class SemanticZoneBridgeJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功围绕 ${zones.attackZoneId} 执行同步计划并打中机会缺口；` +
      `${input.teamBName ?? input.teamBId} 失败在于虽然把 ${zones.defenseZoneId} 作为核心成立点防守，但未能用计划和选手行动阻断攻方从 ${zones.attackZoneId} 展开的验证路径。`;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: buildJudgeDiagnostic(input, reason)
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class ZoneDeterminismShortcutJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功执行计划；${input.teamBName ?? input.teamBId} 失败在于未能守住计划。` +
      `因为主攻区 ${zones.attackZoneId} 和主守区 ${zones.defenseZoneId} 不同，所以攻方一定获胜。`;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: buildJudgeDiagnostic(input, reason)
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class ZoneMismatchProofFailureJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方下包爆炸胜。${input.teamAName ?? input.teamAId} 成功通过中路快攻打中机会缺口；` +
      `${input.teamBName ?? input.teamBId} 失败在于主守区与实际被攻击区错位，导致其核心命题未被真正检验，防守焦点脱离了攻方提出的替代方案失效证据链。`;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_bomb_explosion",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.83,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_bomb_explosion"),
        judgeInference: buildJudgeInference(input, reason, "attack_bomb_explosion"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "buyer_mid",
          mainDefenseZoneId: "conversion_site_a",
          zoneRelation: {
            attackZoneId: "buyer_mid",
            defenseZoneId: "conversion_site_a",
            relationType: "cross_hit",
            relationSummary: "buyer_mid 是攻方验证入口，conversion_site_a 是守方核心证明区，二者构成本局攻守错位。",
            outcomeImpact: "该错位需要结合计划与行动解释为防守焦点脱离，而不是区域不同自动给攻方胜利。"
          },
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 的 team_plan 与 agent_action 指向 buyer_mid；` +
            `${input.teamBName ?? input.teamBId} 的防守计划集中在 conversion_site_a，回合结果直接证伪其防守命题，但不是因为区域不同就自动获胜。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class DefenseZoneMismatchProofFailureJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      `本局胜利方式是防守方全歼胜。${input.teamAName ?? input.teamAId} 试图通过 ${zones.attackZoneId} 快攻验证核心用户切口，` +
      `${input.teamBName ?? input.teamBId} 成功守住 ${zones.defenseZoneId} 代表的核心命题焦点；由于攻方未在 ${zones.defenseZoneId} 挑战守方的核心用户定义，` +
      `守方维持命题焦点未被转移，回合结果说明攻方未能建立有效验证。`;
    return {
      data: {
        winnerTeamId: input.teamBId,
        loserTeamId: input.teamAId,
        margin: "standard",
        roundWinType: "defense_elimination",
        attackWinConditionMet: false,
        defenseWinConditionMet: true,
        reason,
        mvpAgentId: input.activeTeamBAgentIds[0],
        confidence: 0.86,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamBId, input.teamAId, "standard", "defense_elimination"),
        judgeInference: buildJudgeInference(input, reason, "defense_elimination"),
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            `${input.teamAName ?? input.teamAId} 试图攻击 ${input.teamBName ?? input.teamBId} 在 ${zones.attackZoneId} 的防守漏洞，` +
            `但该缺口没有触及守方以 ${zones.defenseZoneId} 为核心的用户定义边界，因此不能证明攻方切口成立。`,
          defendedCoreProposition:
            `${input.teamBName ?? input.teamBId} 守住了以 ${zones.defenseZoneId} 为核心的用户定义成立点，因为其计划与回合结果都没有被 ${zones.attackZoneId} 试探转移。`,
          mainAttackZoneId: zones.attackZoneId,
          mainDefenseZoneId: zones.defenseZoneId,
          zoneRelation: {
            attackZoneId: zones.attackZoneId,
            defenseZoneId: zones.defenseZoneId,
            relationType: "failed_probe",
            relationSummary: `${zones.attackZoneId} 是攻方试探入口，${zones.defenseZoneId} 是守方核心证明区，攻方没有把试探转化为核心挑战。`,
            outcomeImpact: "守方获胜来自攻方未能触达核心命题以及守方计划保持稳定，不是区域错开自动决定。"
          },
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 的 team_plan 与 agent_action 指向 ${zones.attackZoneId}；` +
            `${input.teamBName ?? input.teamBId} 的命题焦点在 ${zones.defenseZoneId}，回合以 defense_elimination 结束，说明攻方没有把试探转化为对核心命题的有效挑战。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class SanitizedTeamLabelDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      "本局胜利方式是攻方全歼胜。Team Alpha 成功让 team_plan 与 agent_action 指向同一主攻区并打中机会缺口；" +
      "Team Bravo 失败在于其防守命题没有回应该主攻区，因此商业判断被回合结果证伪。";
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.82,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            "Team Alpha 攻击了 Team Bravo 在 B 点用户验证上的机会缺口，因为 Team Bravo 未能把核心用户判断收束到可被本回合防守验证的场景。",
          defendedCoreProposition:
            "Team Bravo 未能守住核心成立点，因为其队伍计划与选手行动没有解释为什么 B 点试探不影响用户定义边界。",
          mainAttackZoneId: zones.attackZoneId,
          mainDefenseZoneId: zones.attackZoneId,
          zoneRelation: {
            attackZoneId: zones.attackZoneId,
            defenseZoneId: zones.attackZoneId,
            relationType: "same_focus",
            relationSummary: `${zones.attackZoneId} 同时承载攻方验证和守方证明焦点。`,
            outcomeImpact: "Team Alpha 的成功来自计划与行动证据，而不是区域相同自动决定。"
          },
          decisiveEvidence:
            `Team Alpha 与 Team Bravo 的 team_plan、agent_action 和 roundWinType 都围绕 ${zones.attackZoneId} 展开，回合结果支持攻方判断。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class DeepSeekDiagnosticWordingJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const diagnostic = response.data.diagnostic as Record<string, unknown>;
    return {
      ...response,
      data: {
        ...response.data,
        diagnostic: {
          ...diagnostic,
          attackedOpportunityGap: "攻方瞄准了对手在用户定义防护上的漏洞，以静默快速执行击穿了防守间隙。",
          defendedCoreProposition: "守方试图通过A点锚点验证对手方向，但实际主攻压力转向中路，核心成立点失守。"
        }
      } as TData
    };
  }
}

class ThinDeepSeekOpportunityGapJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const diagnostic = response.data.diagnostic as Record<string, unknown>;
    return {
      ...response,
      data: {
        ...response.data,
        diagnostic: {
          ...diagnostic,
          attackedOpportunityGap: "利用可能过度聚焦B区的倾向，从A区快速爆弹打开缺口"
        }
      } as TData
    };
  }
}

class DirectNoCoverageShortcutJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功执行 ${zones.attackZoneId} 计划；` +
      `${input.teamBName ?? input.teamBId} 的主守区是 ${zones.defenseZoneId}，失败在于没有覆盖 ${zones.attackZoneId}，所以直接证明攻方成功。`;
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.82,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamAId, input.teamBId, "standard", "attack_elimination"),
        judgeInference: buildJudgeInference(input, reason, "attack_elimination"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: zones.attackZoneId,
          mainDefenseZoneId: zones.defenseZoneId,
          decisiveEvidence:
            `${input.teamBName ?? input.teamBId} 主守 ${zones.defenseZoneId} 但未覆盖 ${zones.attackZoneId}，所以直接证明 ${input.teamAName ?? input.teamAId} 获胜。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class UnsupportedMicroCombatJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict" && request.task !== "judge_review") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input =
      request.task === "judge_review"
        ? (request.input as { originalJudgeInput: JudgeRequestInput }).originalJudgeInput
        : (request.input as JudgeRequestInput);
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功打中机会缺口，三秒内清点包点并封锁回防路径；` +
      `${input.teamBName ?? input.teamBId} 失败在于未能守住核心成立点。`;
    return this.buildJudgeResponse(input, reason) as LlmResponse<TData>;
  }
}

class UnlabeledMicroCombatJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const response = this.buildJudgeResponse<Record<string, unknown>>(
      input,
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功清点包点并封锁回防路径；` +
        `${input.teamBName ?? input.teamBId} 失败在于未能守住核心成立点。`
    );
    return {
      ...response,
      data: {
        ...response.data,
        judgeInference: {
          source: "judge_inference",
          boundary: "这些内容来自结算说明。",
          csResolution: "攻方拿下本局。",
          combatNarrative: "攻方清点包点并封锁回防路径。",
          evidenceBasis: ["team_plan", "agent_action"]
        }
      } as TData
    };
  }
}

class RepairableInvalidJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge_verdict") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as JudgeRequestInput;
      const reason =
        `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 三秒内清点包点并封锁回防路径；` +
        `${input.teamBName ?? input.teamBId} 失败在于未能守住核心成立点。`;
      return this.buildJudgeResponse(input, reason) as LlmResponse<TData>;
    }
    if (request.task !== "judge_review") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as { originalJudgeInput: JudgeRequestInput };
    const originalInput = input.originalJudgeInput;
    const reason =
      `本局胜利方式是攻方全歼胜。${originalInput.teamAName ?? originalInput.teamAId} 成功让 team_plan 与 agent_action 意图保持一致并打中机会缺口；` +
      `${originalInput.teamBName ?? originalInput.teamBId} 失败在于其计划、买型和主守区没有回应该缺口。`;
    return this.buildJudgeResponse(originalInput, reason) as LlmResponse<TData>;
  }
}

class GuardedMicroCombatEvidenceJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const zones = resolveFixtureZones(input);
    const reason =
      `本局胜利方式是防守方全歼胜。${input.teamBName ?? input.teamBId} 成功守住 ${zones.defenseZoneId} 的核心命题；` +
      `${input.teamAName ?? input.teamAId} 失败在于其计划要求 20 秒内完成安包并消灭至少两名 CT，但当前事实层不能证明这些微观战斗目标已经发生。`;
    return {
      data: {
        winnerTeamId: input.teamBId,
        loserTeamId: input.teamAId,
        margin: "standard",
        roundWinType: "defense_elimination",
        attackWinConditionMet: false,
        defenseWinConditionMet: true,
        reason,
        mvpAgentId: input.activeTeamBAgentIds[0],
        confidence: 0.84,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamBId, input.teamAId, "standard", "defense_elimination"),
        judgeInference: buildJudgeInference(input, reason, "defense_elimination"),
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason, input.teamBId, input.teamAId),
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 的 teamPlan 要求 20 秒内完成安包并消灭至少两名 CT；` +
            `但 agent_action 仅显示 fast_execute 意图，没有 combat ledger 支持其完成清点、安包或击杀。` +
            `${input.teamBName ?? input.teamBId} 的防守计划与 ${zones.defenseZoneId} 主守区一致，回合结果为 defense_elimination。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class CompactDisplayZoneEvidenceJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是防守方全歼胜。${input.teamBName ?? input.teamBId} 成功围绕 B点 建立防守命题；` +
      `${input.teamAName ?? input.teamAId} 失败在于其 B点 快攻只验证了速度，没有证明用户场景成立。`;
    return {
      data: {
        winnerTeamId: input.teamBId,
        loserTeamId: input.teamAId,
        margin: "standard",
        roundWinType: "defense_elimination",
        attackWinConditionMet: false,
        defenseWinConditionMet: true,
        reason,
        mvpAgentId: input.activeTeamBAgentIds[0],
        confidence: 0.84,
        judgeScorecard: buildJudgeScorecardFixture(input, input.teamBId, input.teamAId, "standard", "defense_elimination"),
        judgeInference: buildJudgeInference(input, reason, "defense_elimination"),
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            `${input.teamAName ?? input.teamAId} 攻击 ${input.teamBName ?? input.teamBId} 在 B点 的用户定义缺口，因为其试图证明该区域存在高频协作场景。`,
          defendedCoreProposition:
            `${input.teamBName ?? input.teamBId} 守住了 B点 代表的核心成立点，因为其计划与回合结果都没有被攻方速度压垮。`,
          mainAttackZoneId: "conversion_site_b",
          mainDefenseZoneId: "conversion_site_b",
          zoneRelation: {
            attackZoneId: "conversion_site_b",
            defenseZoneId: "conversion_site_b",
            relationType: "same_focus",
            relationSummary: "conversion_site_b 对应前端 B点 展示名，是双方本回合共同焦点。",
            outcomeImpact: "防守方胜利来自其计划和行动守住 B点，不是区域相同自动决定。"
          },
          decisiveEvidence:
            `${input.teamAName ?? input.teamAId} 的 team_plan 与 agent_action 都指向 B点；` +
            `${input.teamBName ?? input.teamBId} 的防守也围绕 B点 展开，roundWinType 为 defense_elimination。`
        }
      } as TData,
      usage: {
        promptTokens: 30,
        completionTokens: 20,
        totalTokens: 50
      }
    };
  }
}

class AgentActionSupportedMicroCombatJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { agentId: string };
      return {
        data: {
          ...buildAgentActionDecision({
            agentId: input.agentId,
            executionPlan: "执行 A 点清点，确认主攻区控制，并把该动作作为计划意图提交给队伍。",
            expectedContribution: "预期贡献：让裁判看到 agent_action 中已有的 A 点清点动作计划。"
          })
        } as TData,
        usage: {
          promptTokens: 10,
          completionTokens: 12,
          totalTokens: 22
        }
      };
    }
    if (request.task !== "judge_verdict" && request.task !== "judge_review") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input =
      request.task === "judge_review"
        ? (request.input as { originalJudgeInput: JudgeRequestInput }).originalJudgeInput
        : (request.input as JudgeRequestInput);
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功执行 agent_action 中已有的 A 点清点动作并打中机会缺口；` +
      `${input.teamBName ?? input.teamBId} 失败在于未能守住核心成立点。`;
    return this.buildJudgeResponse(input, reason) as LlmResponse<TData>;
  }
}

class UnsupportedMicroCombatAgentActionGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "agent_action") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as { agentId: string };
    return {
      data: {
        ...buildAgentActionDecision({
          agentId: input.agentId,
          executionPlan: "完成 A 点清点并击杀转化，架死回防路径。",
          riskRead: "风险判断：这里故意保留结果式微观战斗措辞，用于验证 judge 不应把它当成已发生事实。"
        })
      } as TData,
      usage: {
        promptTokens: 10,
        completionTokens: 12,
        totalTokens: 22
      }
    };
  }
}

class IntentOnlyAgentActionGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { agentId: string };
      return {
        data: {
          ...buildAgentActionDecision({
            agentId: input.agentId,
            executionPlan: "准备清点 A 点入口并观察回防信息，等待队伍计划确认后支援主攻区。",
            expectedContribution: "预期贡献：只提交意图层面的主攻区支援，不声明清点已经完成。"
          })
        } as TData,
        usage: {
          promptTokens: 10,
          completionTokens: 12,
          totalTokens: 22
        }
      };
    }
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功让 team_plan 与 agent_action 的意图保持一致，并打中机会缺口；` +
      `${input.teamBName ?? input.teamBId} 失败在于其计划、买型和主守区没有回应该缺口。`;
    return this.buildJudgeResponse(input, reason) as LlmResponse<TData>;
  }
}

class TimingIntentAgentActionGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { agentId: string };
      return {
        data: {
          ...buildAgentActionDecision({
            agentId: input.agentId,
            executionPlan: "根据前3秒信息快速决定是否转点，并准备关键击杀机会但不声明已完成结果。",
            contingencyPlan: "修正方案：如果前3秒没有形成可用信息，立即回到队伍主计划并等待补位。"
          })
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

class StrongDecisiveJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方下包爆炸胜。${input.teamAName ?? input.teamAId} 成功以全队一致的 team_plan 与 agent_action 打中 conversion_site_a 机会缺口，` +
      `${input.teamBName ?? input.teamBId} 失败在于其计划、行动、买型与主守区全部未能回应该缺口；这些证据明确且决定性地证明胜方商业判断成立。`;
    return this.buildJudgeResponse(input, reason, 0.88, "decisive") as LlmResponse<TData>;
  }
}

class FullEliminationDecisiveJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    const reason =
      `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 成功用 team_plan 与 agent_action 打中 conversion_site_a 机会缺口，` +
      `${input.teamBName ?? input.teamBId} 的防线被全歼，核心成立点失守。`;
    return this.buildJudgeResponse(input, reason, 0.88, "decisive") as LlmResponse<TData>;
  }
}

class CorruptedJudgeRawTextGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<TData, TInput>(request);
    return {
      ...response,
      rawText: MOJIBAKE_SAMPLE
    };
  }
}

class CorruptedJudgeDataGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<TData, TInput>(request);
    return {
      ...response,
      data: {
        ...(response.data as Record<string, unknown>),
        reason: MOJIBAKE_SAMPLE,
        diagnostic: {
          ...((response.data as { diagnostic?: Record<string, unknown> }).diagnostic ?? {}),
          currentSubTheme: MOJIBAKE_SAMPLE,
          decisiveEvidence: MOJIBAKE_SAMPLE
        }
      } as TData,
      rawText: JSON.stringify({
        ...(response.data as Record<string, unknown>),
        reason: "clean raw text; parsed provider data is corrupted"
      })
    };
  }
}

const MOJIBAKE_SAMPLE =
  "\u93C8\u6D16\u934A\u9422\u93B4\u9239\u9286\u9346\u9405\u7039\u934F\u93CD\u9365\u9352\u6D93\u9239\u9286";

class ChineseJudgeReasonGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return this.buildJudgeResponse(
      input,
      `${input.teamAName ?? input.teamAId} 成功执行计划并打中机会缺口；${input.teamBName ?? input.teamBId} 未能守住计划中的核心成立点。`
      ) as LlmResponse<TData>;
  }
}

class MixedLanguageJudgeReasonGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as JudgeRequestInput;
    return this.buildJudgeResponse(
      input,
      `当前子命题是‘用户定义战’。${input.teamAName ?? input.teamAId} 成功守住核心成立点；${input.teamBName ?? input.teamBId} failed to prove their user is real rather than aspirational.`
    ) as LlmResponse<TData>;
  }
}

class ObjectDirectiveTeamPlanGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "team_plan") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as {
      teamId: string;
      side: "attack" | "defense";
      activeAgents: Array<{ id: string }>;
    };

    return {
      data: {
        teamId: input.teamId,
        side: input.side,
        primaryIntent: input.side === "attack" ? "集中资源打穿主攻缺口" : "守住唯一核心成立点",
        primaryZoneId: input.side === "attack" ? "site_a" : "site_b",
        coordinationSummary: "全队围绕同一判断窗口协同推进。",
        playerDirectives: Object.fromEntries(
          input.activeAgents.map((agent) => [
            agent.id,
            `Object-style directive for ${agent.id} on ${input.side}`
          ])
        ),
        winCondition: `${input.teamId} win condition is disciplined coordination.`,
        risk: "Over-rotating breaks structure.",
        confidence: 0.79,
        fingerprint: `fp_object_plan_${input.teamId}`
      } as TData,
      usage: {
        promptTokens: 17,
        completionTokens: 14,
        totalTokens: 31
      }
    };
  }
}

class OrderedPlaceholderTeamPlanGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "team_plan") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as {
      teamId: string;
      side: "attack" | "defense";
      activeAgents: Array<{ id: string }>;
    };

    return {
      data: {
        teamId: input.teamId,
        side: input.side,
        primaryIntent: input.side === "attack" ? "集中资源打穿主攻缺口" : "守住唯一核心成立点",
        primaryZoneId: input.side === "attack" ? "site_a" : "site_b",
        coordinationSummary: "全队围绕同一判断窗口协同推进。",
        playerDirectives: input.activeAgents.map((_agent, index) => ({
          agentId: `player${index + 1}`,
          directive: `按第 ${index + 1} 顺位执行团队计划。`
        })),
        winCondition: `${input.teamId} 通过协同执行赢下本回合。`,
        risk: "首波信息不足会打断协同节奏。",
        confidence: 0.79,
        fingerprint: `fp_placeholder_plan_${input.teamId}`
      } as TData,
      rawText: "repaired team plan with player1-player5 placeholders",
      structuredRepair: {
        originalRawText: "{\"teamId\":\"truncated\"",
        repairRawText: "repaired team plan with player1-player5 placeholders",
        repairUsage: {
          promptTokens: 24,
          completionTokens: 16,
          totalTokens: 40
        },
        parseError: "json_truncated: LLM provider returned truncated JSON."
      },
      usage: {
        promptTokens: 24,
        completionTokens: 16,
        totalTokens: 40
      }
    };
  }
}

class NullOptionalTeamPlanGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "team_plan") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    return {
      ...response,
      data: {
        ...response.data,
        secondaryZoneId: null,
        economyIntent: {
          acceptBonus: null,
          preserveAwp: null,
          forceBuyAllowed: null,
          savePriorityAgentIds: null,
          preferredDropTargets: null,
          buyIntentByAgent: (request.input as { activeAgents: Array<{ id: string }> }).activeAgents.map((agent) => ({
            agentId: agent.id,
            targetPosture: null,
            preferredLoadout: null,
            note: null
          }))
        }
      } as TData
    };
  }
}

class AliasedEconomyTeamPlanGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "team_plan") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const input = request.input as { activeAgents: Array<{ id: string }> };
    return {
      ...response,
      data: {
        ...response.data,
        primaryZoneId: "zone_bomb_site_b",
        secondaryZoneId: "zone_mid",
        economyIntent: {
          defaultPosture: "halfBuy",
          summary: "模型经济别名",
          buyIntentByAgent: input.activeAgents.map((agent) => ({
            agentId: agent.id,
            targetPosture: "pistol_retain",
            preferredLoadout: "invented_pack",
            note: "模型返回的经济硬字段应被引擎忽略。"
          }))
        }
      } as TData
    };
  }
}

class CompactJudgeRepairGateway extends SuccessfulPhase18Gateway {
  private judgeCalls = 0;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    this.judgeCalls += 1;
    const input = request.input as JudgeRequestInput;
    if (this.judgeCalls === 1) {
      return {
        data: {
          winnerTeamId: input.teamAId,
          loserTeamId: input.teamBId,
          margin: "standard",
          roundWinType: "attack_elimination",
          attackWinConditionMet: true,
          defenseWinConditionMet: false,
          mvpAgentId: input.activeTeamAAgentIds[0],
          confidence: 0.82
        } as TData,
        usage: {
          promptTokens: 30,
          completionTokens: 14,
          totalTokens: 44
        }
      };
    }

    return this.buildJudgeResponse(input, buildPromptJudgeReason(input)) as LlmResponse<TData>;
  }
}

interface JudgeRequestInput {
  roundId: string;
  teamAId: string;
  teamBId: string;
  teamAName?: string;
  teamBName?: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
  mapSemanticContext?: {
    proposition?: Record<string, unknown>;
  };
  sideAssignment?: {
    attackingTeamId: string;
    defendingTeamId: string;
    half?: "first_half" | "second_half" | "overtime";
  };
  defenderThesisContext?: {
    attackingTeamId: string;
    defendingTeamId: string;
    half: "first_half" | "second_half" | "overtime";
    defenderTeamThesis: string;
    defenderMustHoldClaims: string[];
    defenderPrimaryZoneId: string;
    attackerChallengeBrief: string;
    attackerPrimaryZoneId: string;
    roundSubTheme: string;
    allowedCanonicalZoneIds: string[];
    thesisEvidenceSources: string[];
    dimensionRequirements: Record<string, { challengeRequirement: string; defenseRequirement: string }>;
  };
  rubricProfile?: {
    profileId: string;
    baseVersion: "baseJudgeRubric-v1";
    dimensions: string[];
    dimensionWeights: Record<string, number>;
    mapAdjustment: {
      source: "judgeRubricContext";
      applied: boolean;
      summary: string;
      emphasizedDimensions: string[];
    };
    roundAdjustment: {
      source: "currentSubTheme";
      subTheme: string;
      summary: string;
      emphasizedDimensions: string[];
    };
    evidenceRequirements: string[];
    forbiddenBiases: string[];
  };
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
    if (request.task === "judge_verdict") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as JudgeRequestInput;
      return this.buildJudgeResponse(input, buildVagueSuspiciousJudgeReason(input), 0.92) as LlmResponse<TData>;
    }

    if (request.task === "judge_review") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { originalJudgeInput: JudgeRequestInput };
      const reason =
        this.reviewMode === "complete_review"
          ? buildDetailedPromptJudgeReason(input.originalJudgeInput)
          : buildVagueSuspiciousJudgeReason(input.originalJudgeInput);
      return this.buildJudgeResponse(input.originalJudgeInput, reason, 0.9) as LlmResponse<TData>;
    }

    return super.generateStructured(request);
  }
}

class ConsecutiveLossTimeoutGateway extends SuccessfulPhase18Gateway {
  private judgeCalls = 0;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    this.judgeCalls += 1;
    const input = request.input as JudgeRequestInput;
    if (this.judgeCalls <= 2) {
      return this.buildJudgeResponse(
        input,
        buildPromptJudgeReason(input, input.teamBId, input.teamAId),
        0.86,
        "standard",
        input.teamBId,
        input.teamAId
      ) as LlmResponse<TData>;
    }

    return this.buildJudgeResponse(input, buildPromptJudgeReason(input), 0.87) as LlmResponse<TData>;
  }
}

class ObjectCoachTimeoutGateway extends ConsecutiveLossTimeoutGateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "coach_timeout") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as {
      teamId: string;
      triggerRoundNumber: number;
      activeAgents: Array<{ id: string }>;
    };
    return {
      data: {
        teamId: input.teamId,
        triggerRoundNumber: input.triggerRoundNumber,
        triggerReason: {
          summary: "连续失分暴露了同一机会缺口。"
        },
        diagnosedFailure: {
          focus: "决定性证据通道过于分散。"
        },
        nextRoundObjective: {
          text: "下一回合更早锁定唯一主证明通道。"
        },
        ownCoreToHold: {
          primary: "守住唯一决定性证明通道"
        },
        opponentGapToHit: {
          raise: "惩罚守方延迟回防",
          lower: "减少侧翼噪音"
        },
        zonePriorityShift: {
          raise: ["A 区压力", "中路信息同步"],
          deemphasize: "低价值侧翼试探"
        },
        teamDirective: {
          summary: "五名选手全部回到主证明通道。"
        },
        playerAdjustments: Object.fromEntries(
          input.activeAgents.map((agent) => [
            agent.id,
            {
              adjustment: `针对 ${agent.id} 的单句修正`
            }
          ])
        ),
        expiresAfterRoundNumber: input.triggerRoundNumber + 1,
        confidence: 0.83,
        fingerprint: `fp_object_timeout_${input.teamId}_${input.triggerRoundNumber}`
      } as TData,
      usage: {
        promptTokens: 24,
        completionTokens: 28,
        totalTokens: 52
      }
    };
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

class LegacyActionAgentPayloadGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "agent_action") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    return {
      data: {
        action: "legacy short action",
        confidence: 0.84,
        fingerprint: "legacy-action-repair"
      } as TData,
      rawText: "{\"action\":\"legacy short action\",\"confidence\":0.84,\"fingerprint\":\"legacy-action-repair\"}",
      structuredRepair: {
        originalRawText: "{\"roundObjective\":\"truncated\"",
        repairRawText: "{\"action\":\"legacy short action\",\"confidence\":0.84,\"fingerprint\":\"legacy-action-repair\"}",
        repairUsage: {
          promptTokens: 20,
          completionTokens: 8,
          totalTokens: 28
        },
        parseError: "LLM provider returned text that does not parse as JSON."
      },
      usage: {
        promptTokens: 30,
        completionTokens: 12,
        totalTokens: 42
      }
    };
  }
}

class MojibakeRepairAgentGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "agent_action") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    const input = request.input as { agentId: string; role: string };
    const data = buildAgentActionDecision({ agentId: input.agentId, role: input.role });
    return {
      data: data as TData,
      rawText: JSON.stringify(data),
      structuredRepair: {
        originalRawText: "涓鍦鐐鍚瀹鎴绔鍏鏍鐢鎵妫棰鍥鍒 鎴愬姛 鏈兘",
        repairRawText: JSON.stringify(data),
        repairUsage: {
          promptTokens: 20,
          completionTokens: 8,
          totalTokens: 28
        },
        parseError: "LLM provider returned text that does not parse as JSON."
      },
      usage: {
        promptTokens: 30,
        completionTokens: 12,
        totalTokens: 42
      }
    };
  }
}

class MvpAliasJudgeGateway extends SuccessfulPhase18Gateway {
  constructor(private readonly mvpAlias: string) {
    super();
  }

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    return {
      ...response,
      data: {
        ...response.data,
        mvpAgentId: this.mvpAlias
      } as TData
    };
  }
}

class MissingScorecardJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    const { judgeScorecard: _judgeScorecard, ...dataWithoutScorecard } = response.data;
    return {
      ...response,
      data: dataWithoutScorecard as TData
    };
  }
}

class SemanticJudgeDraftGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge_narrative") {
      const input = request.input as { originalJudgeInput: JudgeRequestInput; verdict: { roundWinType?: "attack_elimination" } };
      const reason =
        `${input.originalJudgeInput.teamAName ?? input.originalJudgeInput.teamAId} 成功从 B 点用户验证入口击中机会缺口；` +
        `${input.originalJudgeInput.teamBName ?? input.originalJudgeInput.teamBId} 失败在于没有守住 B 点对应的核心成立点。`;
      return {
        data: {
          reason,
          judgeInference: buildJudgeInference(input.originalJudgeInput, reason, input.verdict.roundWinType ?? "attack_elimination")
        } as TData,
        usage: {
          promptTokens: 24,
          completionTokens: 18,
          totalTokens: 42
        }
      };
    }
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    const input = request.input as JudgeRequestInput;
    const response = await super.generateStructured<Record<string, unknown>, TInput>(request);
    return {
      ...response,
      data: {
        winnerPromptTeamId: "team_alpha",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        confidence: 0.83,
        winnerReason: "Team Alpha 击中 Team Bravo 的用户定义验证缺口。",
        loserFailureReason: "Team Bravo 没有守住 B 点对应的核心成立点。",
        attackedOpportunityGapText: "攻方从 B 点验证入口切入机会缺口。",
        defendedCorePropositionText: "守方核心成立点被 B 点验证入口击穿。",
        decisiveEvidenceText:
          "Team Alpha 的 team_plan 与 agent_action 都围绕 conversion_site_b 的用户验证入口推进，Team Bravo 未能在 conversion_site_b 守住核心成立点。",
        zoneFocusCandidates: ["zone_b_site"],
        diagnostic: {
          currentSubTheme: "用户定义验证战",
          mainAttackZoneId: "zone_b_site",
          decisiveEvidence:
            "Team Alpha 的 team_plan 与 agent_action 都围绕 conversion_site_b 的用户验证入口推进，Team Bravo 未能在 conversion_site_b 守住核心成立点。"
        }
      } as TData
    };
  }
}

class IncompleteJudgeReasonGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
      return super.generateStructured(request);
    }

    return this.buildJudgeResponse(request.input as JudgeRequestInput, buildIncompletePromptJudgeReason(request.input as JudgeRequestInput)) as LlmResponse<TData>;
  }
}

class RetryableJudgeGateway extends SuccessfulPhase18Gateway {
  private judgeCalls = 0;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge_verdict") {
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

function buildPromptJudgeReason(
  input: JudgeRequestInput,
  winnerTeamId = input.teamAId,
  loserTeamId = input.teamBId
): string {
  const outcome = resolveFixtureJudgeOutcome(input, winnerTeamId);
  const winnerName = formatFixtureTeamName(input, winnerTeamId);
  const loserName = formatFixtureTeamName(input, loserTeamId);
  const zones = resolveFixtureZones(input);

  if (outcome.roundWinType === "defense_elimination") {
    return `本局胜利方式是守方全歼胜。${winnerName} 成功守住核心成立点并阻断对手验证入口；${loserName} 失败在于未能把机会缺口转化为有效突破。主攻落点在${zones.attackZoneLabel}，守方命题焦点在${zones.defenseZoneLabel}，因为攻方试图从 ${zones.attackZoneId} 打开验证入口，但守方把 ${zones.defenseZoneId} 维持为未被击穿的核心证明区。`;
  }

  return `本局胜利方式是攻方全歼胜。${winnerName} 成功打中对手的机会缺口；${loserName} 失败在于未能守住核心成立点。主攻落点在${zones.attackZoneLabel}，守方命题焦点在${zones.defenseZoneLabel}，因为攻方先在 ${zones.attackZoneId} 打开验证入口，再把 ${zones.defenseZoneId} 作为守方必须捍卫的核心证明区。`;
}

function ensureZoneBridge(
  reason: string,
  roundWinType: "attack_elimination" | "defense_elimination" = "attack_elimination",
  input?: JudgeRequestInput
): string {
  const zones = resolveFixtureZones(input);
  return reason.includes("主攻落点") && reason.includes("守方命题焦点")
    ? reason
    : roundWinType === "defense_elimination"
      ? `${reason} 主攻落点在${zones.attackZoneLabel}，守方命题焦点在${zones.defenseZoneLabel}，因为 ${zones.attackZoneId} 是攻方试图打开的验证入口，而 ${zones.defenseZoneId} 是守方成功保住的核心证明区。`
      : `${reason} 主攻落点在${zones.attackZoneLabel}，守方命题焦点在${zones.defenseZoneLabel}，因为 ${zones.attackZoneId} 是攻方先打开的验证入口，而 ${zones.defenseZoneId} 是守方最终失守的核心证明区。`;
}

function buildJudgeDiagnostic(
  input: JudgeRequestInput,
  reason: string,
  winnerTeamId = input.teamAId,
  loserTeamId = input.teamBId
) {
  const outcome = resolveFixtureJudgeOutcome(input, winnerTeamId);
  const winnerName = formatFixtureTeamName(input, winnerTeamId);
  const loserName = formatFixtureTeamName(input, loserTeamId);
  const zones = resolveFixtureZones(input);
  return {
    currentSubTheme: "ICP",
    attackedOpportunityGap:
      outcome.roundWinType === "defense_elimination"
        ? `${loserName} 试图攻击 ${winnerName} 在第一用户定义上的缺口，但未能把 ${zones.attackZoneId} 的验证入口转化为对 ${zones.defenseZoneId} 的有效突破。`
        : `${winnerName} 攻击了 ${loserName} 在第一用户定义上的缺口，因为对手未能把核心用户判断收束到单一高价值场景。`,
    defendedCoreProposition:
      outcome.roundWinType === "defense_elimination"
        ? `${winnerName} 守住了第一用户证明这一核心成立点，因为其始终把 ${zones.defenseZoneId} 维持为未被击穿的核心证明区。`
        : `${winnerName} 守住了第一用户证明这一核心成立点，因为其进攻与验证动作都围绕同一主命题持续推进。`,
    mainAttackZoneId: zones.attackZoneId,
    mainDefenseZoneId: zones.defenseZoneId,
    zoneRelation: {
      attackZoneId: zones.attackZoneId,
      defenseZoneId: zones.defenseZoneId,
      relationType: zones.attackZoneId === zones.defenseZoneId ? "same_focus" : "cross_hit",
      relationSummary: `${zones.attackZoneId} 是攻方验证入口，${zones.defenseZoneId} 是守方核心证明区，二者共同决定本回合裁判焦点。`,
      outcomeImpact: `${winnerName} 的成功与 ${loserName} 的失败都由这组攻守区域关系解释，而不是由区域相同或不同自动决定。`
    },
    decisiveEvidence: `${winnerName} 与 ${loserName} 的 team_plan、agent_action 和回合结果都围绕 ${zones.attackZoneId} 到 ${zones.defenseZoneId} 的攻守关系展开；最终判词是：${reason}`
  };
}

function buildJudgeScorecardFixture(
  input: JudgeRequestInput,
  winnerTeamId = input.teamAId,
  loserTeamId = input.teamBId,
  margin: string = "standard",
  roundWinType:
    | "attack_elimination"
    | "attack_bomb_explosion"
    | "defense_elimination"
    | "defense_timeout_no_plant"
    | "defense_defuse" = "attack_elimination"
) {
  const rubricProfile = input.rubricProfile ?? buildFallbackRubricProfileFixture(input);
  const scoreDelta = margin === "decisive" ? 2.1 : margin === "narrow" ? 0.5 : 1.15;
  const winnerTotal = margin === "decisive" ? 7.8 : margin === "narrow" ? 6.6 : 7.1;
  const loserTotal = Number((winnerTotal - scoreDelta).toFixed(2));
  const teamScores = {
    [winnerTeamId]: buildJudgeTeamScoreFixture(input, winnerTeamId, winnerTotal),
    [loserTeamId]: buildJudgeTeamScoreFixture(input, loserTeamId, loserTotal)
  };
  return {
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    rubricProfile,
    teamScores,
    scoreDelta,
    winnerFromScore: winnerTeamId,
    marginFromScore: margin,
    decisiveDimensions: ["objectiveScore", "proofScore"],
    roundWinTypeJustification: `${roundWinType} 与评分胜方一致。`
  };
}

function buildFallbackRubricProfileFixture(input: JudgeRequestInput) {
  const dimensions = [
    "objectiveScore",
    "mapControlScore",
    "submissionQualityScore",
    "coordinationScore",
    "economyAdjustedScore",
    "riskControlScore",
    "proofScore"
  ];
  return {
    profileId: `rubric_fixture_${input.roundId}`,
    baseVersion: "baseJudgeRubric-v1" as const,
    dimensions,
    dimensionWeights: Object.fromEntries(dimensions.map((dimension) => [dimension, Number((1 / 7).toFixed(4))])),
    mapAdjustment: {
      source: "judgeRubricContext" as const,
      applied: true,
      summary: "测试地图修正：强调地图控制和命题证明。",
      emphasizedDimensions: ["mapControlScore", "proofScore"]
    },
    roundAdjustment: {
      source: "currentSubTheme" as const,
      subTheme: "ICP",
      summary: "测试回合修正：检查目标完成与命题证明。",
      emphasizedDimensions: ["objectiveScore", "proofScore"]
    },
    evidenceRequirements: ["必须引用双方 team_plan 和 SubmittedOutput。"],
    forbiddenBiases: ["历史连胜偏置", "防守命题天然成立偏置"]
  };
}

function buildJudgeTeamScoreFixture(input: JudgeRequestInput, teamId: string, totalScore: number) {
  const side = teamId === input.sideAssignment?.attackingTeamId ? "attack" : "defense";
  const dimension = (source: string) => ({
    score: totalScore,
    evidence: `${formatFixtureTeamName(input, teamId)} 在测试夹具中基于 team_plan、SubmittedOutput 和当前回合证据得到 ${totalScore} 分。`,
    evidenceSource: source
  });
  return {
    teamId,
    side,
    objectiveScore: dimension("round_context"),
    mapControlScore: dimension("zone_relation"),
    submissionQualityScore: dimension("submitted_output"),
    coordinationScore: dimension("team_plan"),
    economyAdjustedScore: dimension("economy"),
    riskControlScore: dimension("round_context"),
    proofScore: dimension("judge_rubric_context"),
    totalScore
  };
}

function buildJudgeInference(
  input: JudgeRequestInput,
  reason: string,
  roundWinType:
    | "attack_elimination"
    | "attack_bomb_explosion"
    | "defense_elimination"
    | "defense_timeout_no_plant"
    | "defense_defuse"
) {
  const defenseWin = roundWinType.startsWith("defense_");
  return {
    source: "judge_inference" as const,
    boundary: "击杀、清点、回防、全歼等结果叙事属于裁判推断，不是 agent_action 原始事实。",
    csResolution: defenseWin ? "防守方通过全歼、拆包或时间控制拿下本局。" : "攻方通过全歼、下包爆炸或进攻收束拿下本局。",
    combatNarrative: `裁判基于 team_plan、agent_action、区域关系和胜法推断本局战斗结果：${reason}`,
    evidenceBasis: [
      `${input.teamAName ?? input.teamAId} 与 ${input.teamBName ?? input.teamBId} 的 team_plan`,
      "10 名选手的 agent_action v2",
      "diagnostic.zoneRelation"
    ]
  };
}

function buildCombatResolutionDraftFixture(input: {
  roundId: string;
  verdict: {
    roundWinType: "attack_elimination" | "attack_bomb_explosion" | "defense_elimination" | "defense_timeout_no_plant" | "defense_defuse";
    mvpAgentId: string;
  };
  activeRosters: {
    teamA: Array<{ id: string; teamId: string }>;
    teamB: Array<{ id: string; teamId: string }>;
  };
  attackerTeamId: string;
  defenderTeamId: string;
  teamAId: string;
  teamBId: string;
}) {
  const teamA = input.activeRosters.teamA;
  const teamB = input.activeRosters.teamB;
  const attackers = input.attackerTeamId === input.teamAId ? teamA : teamB;
  const defenders = input.defenderTeamId === input.teamAId ? teamA : teamB;
  const attackerDeaths = input.verdict.roundWinType === "defense_elimination" ? 5 : input.verdict.roundWinType === "defense_defuse" ? 3 : 1;
  const defenderDeaths = input.verdict.roundWinType === "attack_elimination" ? 5 : input.verdict.roundWinType === "attack_bomb_explosion" ? 3 : 1;
  const deathTargets = [
    ...defenders.slice(0, defenderDeaths),
    ...attackers.slice(0, attackerDeaths)
  ];
  const killEvents = deathTargets.map((target, index) => {
    const actorPool = target.teamId === input.teamAId ? teamB : teamA;
    const actor = actorPool[index % actorPool.length] ?? actorPool[0];
    if (!actor) {
      throw new Error("Combat fixture requires an actor.");
    }
    return {
      id: `kl_${input.roundId}_${index + 1}`,
      actorAgentId: actor.id,
      actorTeamId: actor.teamId,
      targetAgentId: target.id,
      targetTeamId: target.teamId,
      zoneId: index === 0 ? "buyer_mid" : "conversion_site_a",
      atMs: 8000 + index * 3500,
      impact: `${actor.id} 在测试战斗草案中击败 ${target.id}。`,
      tradeType: index === 0 ? "opening" as const : "trade" as const,
      sourceAgentOutputIds: []
    };
  });
  const deadIds = new Set(killEvents.map((kill) => kill.targetAgentId));
  const plantEvent =
    input.verdict.roundWinType === "attack_bomb_explosion" || input.verdict.roundWinType === "defense_defuse"
      ? {
          type: "plant" as const,
          siteZoneId: "conversion_site_a",
          actorAgentId: attackers[0]?.id,
          actorTeamId: input.attackerTeamId,
          atMs: 42000,
          text: "测试草案：攻方完成下包。"
        }
      : undefined;
  const defuseEvent =
    input.verdict.roundWinType === "defense_defuse"
      ? {
          type: "defuse" as const,
          siteZoneId: "conversion_site_a",
          actorAgentId: defenders[0]?.id,
          actorTeamId: input.defenderTeamId,
          atMs: 58000,
          text: "测试草案：防守方完成拆包。"
        }
      : undefined;
  const explosionEvent =
    input.verdict.roundWinType === "attack_bomb_explosion"
      ? {
          type: "explosion" as const,
          siteZoneId: "conversion_site_a",
          actorTeamId: input.attackerTeamId,
          atMs: 61000,
          text: "测试草案：炸弹爆炸。"
        }
      : undefined;
  return {
    roundWinType: input.verdict.roundWinType,
    killEvents,
    ...(plantEvent ? { plantEvent } : {}),
    ...(defuseEvent ? { defuseEvent } : {}),
    ...(explosionEvent ? { explosionEvent } : {}),
    survivors: {
      teamAAgentIds: teamA.map((agent) => agent.id).filter((id) => !deadIds.has(id)),
      teamBAgentIds: teamB.map((agent) => agent.id).filter((id) => !deadIds.has(id))
    },
    ...(killEvents[0]
      ? {
          openingDuel: {
            killEventId: killEvents[0].id,
            actorAgentId: killEvents[0].actorAgentId,
            targetAgentId: killEvents[0].targetAgentId,
            zoneId: killEvents[0].zoneId
          }
        }
      : {}),
    tradeSequence: killEvents.map((kill) => ({
      killEventId: kill.id,
      tradeType: kill.tradeType,
      summary: kill.impact
    })),
    clutchTag: input.verdict.roundWinType === "defense_defuse" ? "retake" : input.verdict.roundWinType === "attack_bomb_explosion" ? "post_plant_hold" : "none",
    mvpEvidence: `测试草案：MVP ${input.verdict.mvpAgentId} 的证据来自 verdict。`
  };
}

function buildDetailedPromptJudgeReason(input: JudgeRequestInput): string {
  return `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} win condition succeeded through synchronized utility and trades; ${
    input.teamBName ?? input.teamBId
  } failed to keep synchronized utility and trades after losing the first duel and breaking spacing. 主攻落点在中路，守方命题焦点在 A 点，因为 buyer_mid 是攻方先打开的验证入口，而 conversion_site_a 是守方最终失守的核心证明区。`;
}

function buildVagueSuspiciousJudgeReason(input: JudgeRequestInput): string {
  return `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} 的胜利条件成立并成功拿下回合；${
    input.teamBName ?? input.teamBId
  } 的胜利条件失守，未能回应胜方压力。主攻落点在主区，守方命题焦点在核心区，因为双方焦点只体现为泛化压力，没有解释具体计划失败。`;
}

function buildIncompletePromptJudgeReason(input: JudgeRequestInput): string {
  return `${input.teamAName ?? input.teamAId} wins by cleaner trading.`;
}

function resolveFixtureJudgeOutcome(input: JudgeRequestInput, winnerTeamId: string) {
  const winnerIsDefender = input.sideAssignment?.defendingTeamId === winnerTeamId;
  const winnerIsAttacker = input.sideAssignment?.attackingTeamId === winnerTeamId || !winnerIsDefender;

  return {
    roundWinType: winnerIsDefender ? "defense_elimination" as const : "attack_elimination" as const,
    attackWinConditionMet: winnerIsAttacker && !winnerIsDefender,
    defenseWinConditionMet: winnerIsDefender,
    mvpAgentId: winnerTeamId === input.teamAId ? input.activeTeamAAgentIds[0] : input.activeTeamBAgentIds[0]
  };
}

function resolveFixtureZones(input?: JudgeRequestInput) {
  const proposition = asRecord(input?.mapSemanticContext?.proposition);
  const displayZoneNames = asRecord(proposition?.displayZoneNames) ?? asRecord(proposition?.display_zone_names);
  const zoneSemantics = asRecord(proposition?.zoneSemantics) ?? asRecord(proposition?.zone_semantics);
  const zoneIds = [...new Set([...Object.keys(displayZoneNames ?? {}), ...Object.keys(zoneSemantics ?? {})])];
  const attackZoneId = zoneIds.includes("buyer_mid") ? "buyer_mid" : zoneIds[0] ?? "buyer_mid";
  const defenseZoneId =
    zoneIds.includes("conversion_site_a")
      ? "conversion_site_a"
      : zoneIds.find((zoneId) => zoneId !== attackZoneId) ?? attackZoneId;

  return {
    attackZoneId,
    defenseZoneId,
    attackZoneLabel: readZoneLabel(displayZoneNames, zoneSemantics, attackZoneId),
    defenseZoneLabel: readZoneLabel(displayZoneNames, zoneSemantics, defenseZoneId)
  };
}

function formatFixtureTeamName(input: JudgeRequestInput, teamId: string): string {
  if (teamId === input.teamAId) {
    return input.teamAName ?? input.teamAId;
  }
  if (teamId === input.teamBId) {
    return input.teamBName ?? input.teamBId;
  }
  return teamId;
}

function readZoneLabel(
  displayZoneNames: Record<string, unknown> | undefined,
  zoneSemantics: Record<string, unknown> | undefined,
  zoneId: string
): string {
  const displayName = displayZoneNames?.[zoneId];
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName;
  }

  const semantics = asRecord(zoneSemantics?.[zoneId]);
  const semanticDisplayName = semantics?.displayName;
  if (typeof semanticDisplayName === "string" && semanticDisplayName.trim().length > 0) {
    return semanticDisplayName;
  }

  return zoneId;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

