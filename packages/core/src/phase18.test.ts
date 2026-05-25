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
    expect(firstRound?.roundReport.agentOutputs.every((output) => output.action.startsWith("LLM action"))).toBe(true);
    expect(firstRound?.roundReport.judgeResult.reason).toBe("Ghost NAV 胜利条件成立; Ghost FUR 胜利条件失守.");
    expect(firstRound?.roundReport.judgeResult.reason).not.toContain("win condition");
    expect(firstRound?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
    expect(firstRound?.roundReport.summary).toContain("全甲全弹");
    expect(firstRound?.roundReport.summary).not.toMatch(/\uFFFD/u);
    expect(firstRound?.roundReport.summary).not.toContain("Tactical:");
    expect(gateway.tasks).toEqual(["team_plan", "team_plan", ...Array<string>(10).fill("agent_action"), "judge"]);

    const teamPlanRequest = gateway.requests.find((request) => request.task === "team_plan");
    const teamPlanInput = teamPlanRequest?.input as
      | {
          mapSemanticContext?: { proposition?: { mapTheme?: string } };
          judgeRubricContext?: { coreJudgmentAxis?: string };
          initialProposal?: { teamThesis?: string; mustHoldClaims?: string[] };
          coachContext?: { displayName?: string };
        }
      | undefined;
    expect(teamPlanInput?.mapSemanticContext?.proposition?.mapTheme).toBe("opportunity_positioning");
    expect(teamPlanInput?.judgeRubricContext?.coreJudgmentAxis).toBe("opportunity_truth");
    expect(teamPlanInput?.initialProposal?.teamThesis).toContain("first-user");
    expect(teamPlanInput?.initialProposal?.mustHoldClaims?.length).toBeGreaterThan(0);
    expect(teamPlanInput?.coachContext?.displayName).toContain("Ghost");
    expect(teamPlanRequest?.messages?.[0]?.content).toContain("json");
    expect(teamPlanRequest?.messages?.[1]?.content).toContain("地图主题：opportunity_positioning");
    expect(teamPlanRequest?.messages?.[1]?.content).toContain("队伍唯一方案：");

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

    const judgeRequest = gateway.requests.find((request) => request.task === "judge");
    const judgeInput = judgeRequest?.input as
      | {
          mapSemanticContext?: { proposition?: { mapTheme?: string } };
          judgeRubricContext?: { coreJudgmentAxis?: string };
          sideAssignment?: unknown;
          teamAName?: string;
          teamBName?: string;
          evaluationOrder?: Array<{ teamId: string; teamPlan?: unknown; initialProposalSummary?: unknown; coachContext?: unknown }>;
          agentOutputsByTeam?: Record<string, unknown[]>;
        }
      | undefined;
    expect(judgeInput?.mapSemanticContext?.proposition?.mapTheme).toBe("opportunity_positioning");
    expect(judgeInput?.judgeRubricContext?.coreJudgmentAxis).toBe("opportunity_truth");
    expect(judgeInput?.sideAssignment).toBeDefined();
    expect(judgeInput?.teamAName).toBe("Team Alpha");
    expect(judgeInput?.teamBName).toBe("Team Bravo");
    expect(judgeInput?.evaluationOrder).toHaveLength(2);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.teamPlan)).toBe(true);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.initialProposalSummary)).toBe(true);
    expect(judgeInput?.evaluationOrder?.every((entry) => entry.coachContext)).toBe(true);
    expect(judgeInput?.evaluationOrder?.[0]?.teamId).toBe("team_alpha");
    expect(Object.keys(judgeInput?.agentOutputsByTeam ?? {}).sort()).toEqual(["team_alpha", "team_bravo"]);
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost NAV");
    expect(JSON.stringify(judgeInput)).not.toContain("Ghost FUR");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_nav");
    expect(JSON.stringify(judgeInput)).not.toContain("team_ghost_fur");
    expect(judgeRequest?.messages?.[1]?.content).toContain("裁判轴：opportunity_truth");
    expect(judgeRequest?.messages?.[1]?.content).toContain("反偏置约束：");
    const killFeedEvents = await repositories.events.listByRound(firstRound?.round.id ?? "");
    expect(killFeedEvents.filter((event) => event.type === "kill_feed_created")).toHaveLength(firstRound?.roundReport.killLedger?.length ?? 0);

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

  it("normalizes common judge margin synonyms without weakening winner validation", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new ClearMarginJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.margin).toBe("standard");
    expect(replay?.rounds[0]?.roundReport.judgeResult.winnerTeamId).toBe("team_ghost_nav");
  });

  it("fills missing judge diagnostic evidence from the judge reason", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new PartialDiagnosticJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    const diagnostic = replay?.rounds[0]?.roundReport.judgeResult.diagnostic;

    expect(diagnostic?.decisiveEvidence).toContain("胜利条件成立");
    expect(diagnostic?.decisiveEvidence).toContain("胜利条件失守");
    expect(replay?.rounds[0]?.roundReport.judgeDiagnostic?.decisiveEvidence).toBe(diagnostic?.decisiveEvidence);
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
    await engine.runCurrentMatch({
      matchId: phase11DemoIds.matchId,
      selectedMapIds: ["DUST2", "INFERNO", "MIRAGE"]
    });
    const match = await repositories.matches.getById(phase11DemoIds.matchId);

    expect(match?.status).toBe("completed");
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

async function createPhase18DemoEngine(llmGateway: LlmGateway) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase18-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase18SimulationEngine({
    repositories,
    llmGateway,
    jobQueue: new UnconfiguredJobQueue(),
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
          displayZoneNames: { buyer_mid: "Mid", conversion_site_a: "A Site" },
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

    return this.buildJudgeResponse(request.input as JudgeRequestInput, buildPromptJudgeReason(request.input as JudgeRequestInput)) as LlmResponse<TData>;
  }

  protected buildJudgeResponse<TData = unknown>(
    input: JudgeRequestInput,
    reason: string,
    confidence = 0.88,
    margin: string = "standard"
  ): LlmResponse<TData> {
    return {
      data: {
        winnerTeamId: input.teamAId,
        loserTeamId: input.teamBId,
        margin,
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

class ClearMarginJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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

class PartialDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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

class ChineseJudgeReasonGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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
    if (request.task !== "judge") {
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

class ConsecutiveLossTimeoutGateway extends SuccessfulPhase18Gateway {
  private judgeCalls = 0;

  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
      return super.generateStructured(request);
    }

    this.requests.push(request as LlmRequest<unknown>);
    this.tasks.push(request.task);
    this.judgeCalls += 1;
    const input = request.input as JudgeRequestInput;
    if (this.judgeCalls <= 2) {
      return {
        data: {
          winnerTeamId: input.teamBId,
          loserTeamId: input.teamAId,
          margin: "standard",
          reason: `${input.teamBName ?? input.teamBId} win condition succeeded; ${input.teamAName ?? input.teamAId} win condition failed.`,
          mvpAgentId: input.activeTeamBAgentIds[0],
          confidence: 0.86
        } as TData,
        usage: {
          promptTokens: 30,
          completionTokens: 20,
          totalTokens: 50
        }
      };
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

