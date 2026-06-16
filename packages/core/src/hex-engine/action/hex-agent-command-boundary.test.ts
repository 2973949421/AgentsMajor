import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { buildFixtureHexRoundBusinessDuel } from "../business/index.js";
import { buildHexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel } from "../finance/index.js";
import { initializeHexRoundMemory } from "../state/index.js";
import {
  auditHexAgentDraftSemanticLanguage,
  buildHexAgentCommandRequest,
  buildHexAgentCompactCommandRequest,
  calculateHexAgentCommandRequestSizeMetrics,
  normalizeHexAgentActionDraft
} from "./hex-agent-command-boundary.js";
import { buildHexRoundOpeningBrief } from "./hex-round-opening-brief.js";

describe("Hex agent command boundary", () => {
  it("builds a compact request from phase memory without treating last-seen as current truth", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    memory.agents[0]!.lastSeenEnemies = [
      {
        enemyAgentId: "ct_0",
        enemyTeamId: "ct",
        cellId: memory.agents[5]!.currentCellId,
        pointIds: [],
        source: "spotted_event",
        seenAtPhaseIndex: 0,
        confidence: 0.65,
        lastSeenPhaseIndex: 0,
        stale: false,
        historical: true
      }
    ];

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    expect(request.agent.agentId).toBe("t_0");
    expect(request.reachableCells.length).toBeGreaterThan(0);
    expect(request.phaseObjective.objective).toContain("Leave spawn");
    expect(request.targetCandidates.length).toBeGreaterThan(0);
    expect(request.targetCandidates.every((candidate) => candidate.targetCellId !== request.agent.currentCellId)).toBe(true);
    expect(request.lastSeenEnemies[0]?.note).toBe("historical_last_seen_not_current_truth");
    expect(request.constraints.some((line) => line.includes("Do not output winner"))).toBe(true);
    expect(request.constraints.some((line) => line.includes("move action must change position"))).toBe(true);
  });

  it("normalizes a valid draft and records forbidden fields as ignored", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.reachableCells[0]!.cellId,
        actionType: "move",
        businessIntent: "t_0 uses movement to test the team business plan pressure route.",
        winner: "t",
        kills: ["ct_0"]
      }
    });

    expect(result.errors).toEqual([]);
    expect(result.repairedFields).toEqual([]);
    expect(result.draft?.targetCellId).toBe(request.reachableCells[0]!.cellId);
    expect(result.ignoredFields).toEqual(expect.arrayContaining(["winner", "kills"]));
  });

  it("repairs request-owned agent, phase, and current cell fields without relaxing action facts", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "model_repeated_the_wrong_agent",
        phaseId: "model_repeated_the_wrong_phase",
        currentCellId: "model_repeated_the_wrong_cell",
        targetCellId: request.reachableCells[0]!.cellId,
        actionType: "move",
        businessIntent: "t_0 uses a repaired context draft to keep the business plan moving."
      }
    });

    expect(result.errors).toEqual([]);
    expect(result.repairedFields).toEqual(expect.arrayContaining(["repaired_agentId", "repaired_phaseId", "repaired_currentCellId"]));
    expect(result.draft?.agentId).toBe(request.agent.agentId);
    expect(result.draft?.phaseId).toBe(request.phaseId);
    expect(result.draft?.currentCellId).toBe(request.agent.currentCellId);
  });

  it("adds compact economy context when provided", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "eco", "eco", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      economyContext
    });

    expect(request.economy?.economyPosture).toBe("rifle_buy");
    expect(request.economy?.resourceTier).toBe("high");
    expect(request.economy?.economyAllowedActionTypes).toContain("execute_site");
    expect(request.constraints.some((line) => line.includes("Economy context is already resolved"))).toBe(true);
  });

  it("adds round business duel context and the current agent assignment", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 7,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side
      }))
    });

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      businessDuel
    });

    expect(request.businessDuel?.subthemeId).toBe("dust2_business_subtheme_1");
    expect(request.businessDuel?.halfIndex).toBe(1);
    expect(request.businessDuel?.mirrorRoundNumber).toBe(1);
    expect(request.businessAssignment?.agentId).toBe("t_0");
    expect(request.businessAssignment?.linkedChallengeId).toBe(businessDuel.attackChallenge.challengeId);
    expect(request.constraints.some((line) => line.includes("businessAssignment"))).toBe(true);
  });

  it("builds a compact real-provider payload without sending full reachable cells", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side
      }))
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      businessDuel
    });

    const compact = buildHexAgentCompactCommandRequest(request);
    const metrics = calculateHexAgentCommandRequestSizeMetrics({
      fullRequest: request,
      compactRequest: compact
    });

    expect(compact.requestMode).toBe("compact_match");
    expect(compact.outputLanguage).toBe("zh-CN");
    expect("reachableCells" in compact).toBe(false);
    expect(compact.targetCandidates.length).toBeLessThanOrEqual(8);
    expect(compact.businessDuel?.subthemeTitle).toBe(request.businessDuel?.subthemeTitle);
    expect(compact.businessDuel?.agentAssignment?.businessTask).toBe(request.businessAssignment?.businessTask);
    expect(compact.outputSchema.semanticFieldsMustUseChinese).toEqual(["businessIntent", "actionRationaleZh", "tacticalIntent", "riskNotes"]);
    expect(compact.outputSchema.codeIdentifiersRemainEnglish).toContain("targetCellId");
    expect(metrics.compactRequestCharLength).toBeLessThan(metrics.fullRequestCharLength);
    expect(metrics.estimatedReductionRatio).toBeGreaterThan(0.4);
  });

  it("prefers finance duel context over legacy business context in compact requests", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side
      }))
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      businessDuel,
      financeDuel
    });
    const compact = buildHexAgentCompactCommandRequest(request);

    expect(request.financeDuel?.topicKey).toBe("global_metal_price_signal");
    expect(request.financeAssignment?.agentId).toBe("t_0");
    expect(request.agentOpeningBrief?.briefId).toBe("opening_1_t_0");
    expect(request.agentOpeningBrief?.roundTaskZh).toContain("质疑");
    expect(compact.financeDuel?.topicKey).toBe("global_metal_price_signal");
    expect(compact.financeDuel?.defenseSummaryZh).toContain("守方自证");
    expect(compact.financeDuel?.attackSummaryZh).toContain("攻方质疑");
    expect(compact.financeDuel?.defenseSummaryZh).not.toContain(financeDuel.defenseThesis.thesis);
    expect(compact.financeDuel?.attackSummaryZh).not.toContain(financeDuel.attackChallenge.thesis);
    expect(compact.agentOpeningBrief?.briefId).toBe(request.agentOpeningBrief?.briefId);
    expect(compact.agentOpeningBrief?.sliceId).toBeDefined();
    expect(compact.agentOpeningBrief?.financeRoleCn).toBeDefined();
    expect(compact.agentOpeningBrief?.usableFactsZh?.length).toBeGreaterThan(0);
    expect(JSON.stringify(compact)).not.toContain("promptFacts");
    expect(JSON.stringify(compact)).not.toContain("\"scoreCaps\"");
    expect(compact.businessDuel).toBeUndefined();
    expect(compact.hardConstraints.some((line) => line.includes("businessIntent"))).toBe(true);
  });

  it("repairs missing and invalid brief references to the current opening brief", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      financeDuel
    });
    const missing = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        businessIntent: "引用开局信息卡的配置边界，移动到候选点位验证风险，不重写整段金融主张。"
      }
    });
    const invalid = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: "opening_wrong_agent",
        businessIntent: "引用开局信息卡的配置边界，移动到候选点位验证风险，不重写整段金融主张。"
      }
    });

    expect(missing.errors).toEqual([]);
    expect(missing.draft?.briefRefId).toBe(request.agentOpeningBrief?.briefId);
    expect(missing.repairedFields).toContain("repaired_missing_briefRefId");
    expect(invalid.errors).toEqual([]);
    expect(invalid.draft?.briefRefId).toBe(request.agentOpeningBrief?.briefId);
    expect(invalid.repairedFields).toContain("repaired_invalid_briefRefId");
  });

  it("attaches round-start outputs to phase requests and repairs missing output references", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "eco", "eco", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const roundOpeningBrief = buildHexRoundOpeningBrief({
      financeDuel,
      economyContext,
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const roundStartAgentOutputs = roundOpeningBrief.agentBriefs.map((brief) => ({
      outputId: `round_start_${brief.agentId}`,
      agentId: brief.agentId,
      usableForPhaseAction: true,
      openingStatementZh: `${brief.roleQuestionZh ?? brief.roundTaskZh}，本局先给出开局判断。`,
      evidenceRefs: [...(brief.evidenceRefs ?? [])],
      riskBoundaryZh: brief.evidenceBoundaryZh,
      buyConstraintAppliedZh: brief.buyConstraintZh,
      phaseActionCarryoverZh: "后续 phase 只需短句引用本局开局输出并执行地图行动。",
      source: "fixture_response" as const
    }));

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      financeDuel,
      economyContext,
      roundStartAgentOutputs
    });
    const compact = buildHexAgentCompactCommandRequest(request);
    const repaired = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        businessIntent: "短句引用本局开局输出，执行本阶段移动验证。",
        actionRationaleZh: "继续推进到候选点位。",
        roundStartOutputId: "wrong_output_id"
      }
    });

    expect(request.roundStartAgentOutput?.outputId).toBe("round_start_t_0");
    expect(compact.roundStartAgentOutput?.outputId).toBe("round_start_t_0");
    expect(compact.hardConstraints.some((line) => line.includes("roundStartOutputId"))).toBe(true);
    expect(repaired.errors).toEqual([]);
    expect(repaired.draft?.roundStartOutputId).toBe("round_start_t_0");
    expect(repaired.repairedFields).toContain("repaired_invalid_roundStartOutputId");
  });

  it("does not attach failed round-start outputs to phase requests or preserve invalid output references", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const failedRoundStartOutput = {
      outputId: "round_start_t_0",
      agentId: "t_0",
      usableForPhaseAction: false,
      openingStatementZh: "本局没有可采信的真实开局输出。",
      evidenceRefs: [],
      riskBoundaryZh: "provider 失败。",
      buyConstraintAppliedZh: "provider 失败。",
      phaseActionCarryoverZh: "不能引用失败开局输出。",
      source: "provider_error" as const
    };
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      financeDuel,
      roundStartAgentOutputs: [failedRoundStartOutput]
    });
    const compact = buildHexAgentCompactCommandRequest(request);
    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        roundStartOutputId: "round_start_t_0",
        businessIntent: "执行本阶段移动验证，不引用失败开局输出。",
        actionRationaleZh: "只做地图行动。"
      }
    });

    expect(request.roundStartAgentOutput).toBeUndefined();
    expect(compact.roundStartAgentOutput).toBeUndefined();
    expect(result.draft).toBeUndefined();
    expect(result.errors).toContain("draft:invalid_roundStartOutputId");
  });

  it("rejects phase action drafts that repeat the full opening thesis or exceed action bounds", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      financeDuel
    });
    const shortReference = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        businessIntent: "引用开局卡的配置边界，推进到候选点位验证风险。",
        actionRationaleZh: "只做本阶段移动和风险验证。"
      }
    });
    const repeated = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        businessIntent: `${request.agentOpeningBrief?.proofOrChallengeZh ?? ""} ${request.agentOpeningBrief?.evidenceBoundaryZh ?? ""}`
      }
    });
    const tooLong = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        businessIntent: "引用开局卡，但本阶段仍然输出一大段不必要的金融作文。".repeat(12)
      }
    });

    expect(shortReference.errors).toEqual([]);
    expect(shortReference.draft?.briefRefId).toBe(request.agentOpeningBrief?.briefId);
    expect(repeated.draft).toBeUndefined();
    expect(repeated.errors).toContain("phase_repeated_round_thesis");
    expect(tooLong.draft).toBeUndefined();
    expect(tooLong.errors).toContain("phase_action_reason_too_long");
  });

  it("rejects phase action drafts that restate the real round-start output", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "eco", "eco", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      financeDuel,
      economyContext,
      roundStartAgentOutputs: [{
        outputId: "round_start_t_0",
        agentId: "t_0",
        usableForPhaseAction: true,
        openingStatementZh: "本局基于全球有色价格上行，只能给出有限置信度配置结论，同时承认国内库存和贸易证据缺口。",
        evidenceRefs: ["FRED_COPPER", "FRED_ALUMINUM"],
        riskBoundaryZh: "不能把全球价格代理直接当作中国国内供需事实。",
        buyConstraintAppliedZh: "full buy 允许承担主攻判断，但不能越过证据边界。",
        phaseActionCarryoverZh: "后续只可短句引用，不可整段复述。",
        source: "fixture_response" as const
      }]
    });
    const repeated = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.targetCandidates[0]!.targetCellId,
        actionType: "move",
        briefRefId: request.agentOpeningBrief?.briefId,
        roundStartOutputId: "round_start_t_0",
        businessIntent: "本局基于全球有色价格上行，只能给出有限置信度配置结论，同时承认国内库存和贸易证据缺口。不能把全球价格代理直接当作中国国内供需事实。",
        actionRationaleZh: "后续只可短句引用，不可整段复述。"
      }
    });

    expect(repeated.draft).toBeUndefined();
    expect(repeated.errors).toContain("phase_repeated_round_thesis");
  });

  it("builds deterministic round opening briefs for all agents without extra LLM calls", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "eco", "eco", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });

    const brief = buildHexRoundOpeningBrief({
      financeDuel,
      economyContext,
      agents: memory.agents.map((agent) => ({
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side,
        role: agent.agentId === "t_0" ? "portfolio_manager" : "sector_specialist"
      }))
    });

    expect(brief.agentBriefs).toHaveLength(10);
    expect(brief.agentEvidenceSlices).toHaveLength(10);
    expect(brief.defenseSummaryZh).toContain("守方自证");
    expect(brief.attackSummaryZh).toContain("攻方质疑");
    expect(brief.agentBriefs.find((item) => item.agentId === "t_0")?.proofOrChallengeZh).toContain(financeDuel.attackChallenge.thesis);
    expect(brief.agentBriefs.find((item) => item.agentId === "ct_0")?.buyConstraintZh).toContain("资源 low");
    expect(brief.agentBriefs.find((item) => item.agentId === "t_0")?.sliceId).toBeDefined();
    expect(brief.agentBriefs.find((item) => item.agentId === "t_0")?.roleQuestionZh).toContain("配置");
  });

  it("includes occupied and reserved cells while deprioritizing blocked target candidates", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const occupiedCellId = memory.agents[1]!.currentCellId;
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      occupiedCellIds: [occupiedCellId],
      reservedCellIds: ["h_99_99_l0"]
    });

    expect(request.occupiedCellIds).toContain(occupiedCellId);
    expect(request.reservedCellIds).toContain("h_99_99_l0");
    expect(request.constraints.some((line) => line.includes("occupiedCellIds"))).toBe(true);
    expect(request.targetCandidates[0]?.targetCellId).not.toBe(occupiedCellId);
  });

  it("still rejects malformed action facts before validation", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "unknown",
        phaseId: "wrong_phase",
        currentCellId: "wrong_cell",
        targetCellId: "",
        actionType: "teleport",
        businessIntent: ""
      }
    });

    expect(result.draft).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "draft:missing_targetCellId",
        "draft:invalid_actionType",
        "draft:missing_businessIntent"
      ])
    );
    expect(result.repairedFields).toEqual(expect.arrayContaining(["repaired_agentId", "repaired_phaseId", "repaired_currentCellId"]));
  });

  it("repairs a single-element actions array into one stable action draft", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        actions: [{
          agentId: "t_0",
          phaseId: request.phaseId,
          currentCellId: request.agent.currentCellId,
          targetCellId: request.reachableCells[0]!.cellId,
          actionType: "move",
          businessIntent: "t_0 carries the attack challenge through a stable single action array."
        }]
      }
    });

    expect(result.errors).toEqual([]);
    expect(result.repairedFields).toContain("repaired_single_action_array");
    expect(result.draft?.targetCellId).toBe(request.reachableCells[0]!.cellId);
  });

  it("rejects multi-action arrays instead of choosing one at random", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        actions: [
          { targetCellId: request.reachableCells[0]!.cellId, actionType: "move", businessIntent: "first" },
          { targetCellId: request.reachableCells[1]!.cellId, actionType: "move", businessIntent: "second" }
        ]
      }
    });

    expect(result.draft).toBeUndefined();
    expect(result.errors).toContain("draft:multiple_actions_not_allowed");
  });

  it("fails garbled model text instead of treating it as a synonym", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.reachableCells[0]!.cellId,
        actionType: "move",
        businessIntent: "中文�损坏"
      }
    });

    expect(result.draft).toBeUndefined();
    expect(result.errors).toContain("draft:garbled_text");
  });

  it("audits natural-language fields for Chinese without flagging code identifiers", () => {
    const zh = auditHexAgentDraftSemanticLanguage({
      agentId: "t_0",
      phaseId: "default_opening",
      currentCellId: "h_01_01_l0",
      targetCellId: "h_02_01_l0",
      actionType: "move",
      businessIntent: "用中路推进质疑对手的渠道护城河，并为队友制造交叉火力。",
      actionRationaleZh: "引用开局信息卡，选择能验证风险边界的点位。",
      tacticalIntent: "靠近 A 小道入口但不把 lastSeen 当作真实位置。",
      riskNotes: ["避免进入队友预占格"]
    });
    const en = auditHexAgentDraftSemanticLanguage({
      agentId: "t_0",
      phaseId: "default_opening",
      currentCellId: "h_01_01_l0",
      targetCellId: "h_02_01_l0",
      actionType: "move",
      businessIntent: "pressure the channel moat with a fast mid route",
      tacticalIntent: "keep safe spacing from h_01_01_l0",
      riskNotes: ["avoid friendly reserved cell"]
    });

    expect(zh.semanticLanguage).toBe("zh");
    expect(zh.languageMismatch).toBe(false);
    expect(en.semanticLanguage).toBe("en");
    expect(en.languageMismatch).toBe(true);
    expect(zh.inspectedSemanticFields).toEqual(["businessIntent", "actionRationaleZh", "tacticalIntent", "riskNotes.0"]);
    expect(en.inspectedSemanticFields).toEqual(["businessIntent", "tacticalIntent", "riskNotes.0"]);
  });
});

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function createAgents(asset: HexMapAsset) {
  const tCells = findCellsWithFlag(asset, "spawn_t");
  const ctCells = findCellsWithFlag(asset, "spawn_ct");
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "t",
      side: "attack" as const,
      startCellId: tCells[index % tCells.length]!.cellId,
      carryingC4: index === 0
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "ct",
      side: "defense" as const,
      startCellId: ctCells[index % ctCells.length]!.cellId
    }))
  ];
}

function findCellsWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell[] {
  const cells = asset.cells.filter((cell) => cell.playable && cell.flags.includes(flag));
  if (cells.length === 0) {
    throw new Error(`Missing ${flag}`);
  }
  return cells;
}

function buildPlan(
  teamId: string,
  posture: TeamEconomyPlan["posture"],
  buyType: TeamEconomyPlan["summaryBuyType"],
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side: teamId === "ct" ? "defense" : "attack",
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test plan",
    summaryBuyType: buyType,
    totalCash: 20000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: buyType === "eco" ? 1000 : 6000,
      tokenBankAfterDrop: buyType === "eco" ? 1000 : 6000,
      buyType,
      economyPosture: posture,
      loadoutPackage: buyType === "eco" ? "pistol_round_pack" : "rifle_full_t_pack",
      spend: buyType === "eco" ? 800 : 4500,
      outputBudget: buyType === "eco" ? 420 : 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}
