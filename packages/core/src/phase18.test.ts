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

  it("rejects direct no-coverage zone shortcut proof as deterministic judging", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new DirectNoCoverageShortcutJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "automatic win/loss rule"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("rejects unsupported judge micro-combat details without committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new UnsupportedMicroCombatJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "unsupported micro-combat detail"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("repairs one invalid first-pass judge before failing the round", async () => {
    const gateway = new RepairableInvalidJudgeGateway();
    const { repositories, engine } = await createPhase18DemoEngine(gateway);

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds).toHaveLength(1);
    expect(gateway.tasks).toContain("judge");
    expect(gateway.tasks).toContain("judge_review");
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

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => output.action.includes("击杀转化"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).not.toContain("击杀转化");
  });

  it("rejects judge micro-combat wording even when agent_action mentions the action intent", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new AgentActionSupportedMicroCombatJudgeGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "unsupported micro-combat detail"
    );
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
  });

  it("accepts intent-only agent_action language when the judge keeps evidence at plan level", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new IntentOnlyAgentActionGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => output.action.includes("准备清点"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).not.toContain("清点");
  });

  it("allows timing and preparation wording in agent_action without treating it as combat fact", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new TimingIntentAgentActionGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => output.action.includes("前3秒"))).toBe(true);
    expect(replay?.rounds[0]?.roundReport.agentOutputs.some((output) => output.action.includes("准备关键击杀"))).toBe(true);
  });

  it("accepts decisive margins when the judge gives strong non-micro evidence", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new StrongDecisiveJudgeGateway());

    await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);

    expect(replay?.rounds[0]?.roundReport.judgeResult.margin).toBe("decisive");
    expect(replay?.rounds[0]?.roundReport.judgeResult.reason).toContain("决定性");
  });

  it("rejects mojibake LLM responses before committing the round", async () => {
    const { repositories, engine } = await createPhase18DemoEngine(new CorruptedJudgeRawTextGateway());

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow(
      "LLM context encoding is corrupted in judge raw response"
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
    margin: string = "standard",
    winnerTeamId = input.teamAId,
    loserTeamId = input.teamBId
  ): LlmResponse<TData> {
    const outcome = resolveFixtureJudgeOutcome(input, winnerTeamId);
    const normalizedReason = ensureZoneBridge(reason, outcome.roundWinType, input);
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

class MissingDiagnosticJudgeGateway extends SuccessfulPhase18Gateway {
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
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: buildPromptJudgeReason(input),
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
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
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: `${input.teamAName ?? input.teamAId} 围绕 A Site 成功推进；${input.teamBName ?? input.teamBId} 未能守住核心成立点。`,
        mvpAgentId: input.activeTeamAAgentIds[0],
        confidence: 0.88,
        diagnostic: {
          ...buildJudgeDiagnostic(input, buildPromptJudgeReason(input)),
          mainAttackZoneId: "buyer_mid",
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

class AuxiliaryZoneJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "conversion_site_a",
          mainDefenseZoneId: "conversion_site_a",
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

class SemanticZoneBridgeJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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
    if (request.task !== "judge") {
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
    if (request.task !== "judge") {
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
        diagnostic: {
          ...buildJudgeDiagnostic(input, reason),
          mainAttackZoneId: "buyer_mid",
          mainDefenseZoneId: "conversion_site_a",
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
    if (request.task !== "judge") {
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
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            `${input.teamAName ?? input.teamAId} 试图攻击 ${input.teamBName ?? input.teamBId} 在 ${zones.attackZoneId} 的防守漏洞，` +
            `但该缺口没有触及守方以 ${zones.defenseZoneId} 为核心的用户定义边界，因此不能证明攻方切口成立。`,
          defendedCoreProposition:
            `${input.teamBName ?? input.teamBId} 守住了以 ${zones.defenseZoneId} 为核心的用户定义成立点，因为其计划与回合结果都没有被 ${zones.attackZoneId} 试探转移。`,
          mainAttackZoneId: zones.attackZoneId,
          mainDefenseZoneId: zones.defenseZoneId,
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
    if (request.task !== "judge") {
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
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            "Team Alpha 攻击了 Team Bravo 在 B 点用户验证上的机会缺口，因为 Team Bravo 未能把核心用户判断收束到可被本回合防守验证的场景。",
          defendedCoreProposition:
            "Team Bravo 未能守住核心成立点，因为其队伍计划与选手行动没有解释为什么 B 点试探不影响用户定义边界。",
          mainAttackZoneId: zones.attackZoneId,
          mainDefenseZoneId: zones.attackZoneId,
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

class DirectNoCoverageShortcutJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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
    if (request.task !== "judge" && request.task !== "judge_review") {
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

class RepairableInvalidJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge") {
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
    if (request.task !== "judge") {
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
    if (request.task !== "judge") {
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
        diagnostic: {
          currentSubTheme: "ICP",
          attackedOpportunityGap:
            `${input.teamAName ?? input.teamAId} 攻击 ${input.teamBName ?? input.teamBId} 在 B点 的用户定义缺口，因为其试图证明该区域存在高频协作场景。`,
          defendedCoreProposition:
            `${input.teamBName ?? input.teamBId} 守住了 B点 代表的核心成立点，因为其计划与回合结果都没有被攻方速度压垮。`,
          mainAttackZoneId: "conversion_site_b",
          mainDefenseZoneId: "conversion_site_b",
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
          action: "执行 A 点清点，确认主攻区控制",
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
    if (request.task !== "judge" && request.task !== "judge_review") {
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
        action: "完成 A 点清点并击杀转化，架死回防路径",
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
}

class IntentOnlyAgentActionGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "agent_action") {
      this.requests.push(request as LlmRequest<unknown>);
      this.tasks.push(request.task);
      const input = request.input as { agentId: string };
      return {
        data: {
          action: "准备清点 A 点入口并观察回防信息，等待队伍计划确认后支援主攻区",
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
    if (request.task !== "judge") {
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
          action: "根据前3秒信息快速决定是否转点，并准备关键击杀机会但不声明已完成结果",
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
    return super.generateStructured(request);
  }
}

class StrongDecisiveJudgeGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
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

class CorruptedJudgeRawTextGateway extends SuccessfulPhase18Gateway {
  override async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task !== "judge") {
      return super.generateStructured(request);
    }

    const response = await super.generateStructured<TData, TInput>(request);
    return {
      ...response,
      rawText: "鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦 鍦"
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
  mapSemanticContext?: {
    proposition?: Record<string, unknown>;
  };
  sideAssignment?: {
    attackingTeamId: string;
    defendingTeamId: string;
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
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
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
    decisiveEvidence: `${winnerName} 与 ${loserName} 的 team_plan、agent_action 和回合结果都围绕 ${zones.attackZoneId} 到 ${zones.defenseZoneId} 的攻守关系展开；最终判词是：${reason}`
  };
}

function buildDetailedPromptJudgeReason(input: JudgeRequestInput): string {
  return `本局胜利方式是攻方全歼胜。${input.teamAName ?? input.teamAId} win condition succeeded through synchronized utility and trades; ${
    input.teamBName ?? input.teamBId
  } failed to keep synchronized utility and trades after losing the first duel and breaking spacing. 主攻落点在中路，守方命题焦点在 A 点，因为 buyer_mid 是攻方先打开的验证入口，而 conversion_site_a 是守方最终失守的核心证明区。`;
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

