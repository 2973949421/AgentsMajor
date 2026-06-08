import {
  combatResolutionDraftSchema,
  type Agent,
  type AgentOutput,
  type BuyType,
  type CombatResolutionDraft,
  type JudgeResult,
  type JudgeRoundWinType,
  type MapGame,
  type Match,
  type Round,
  type RoundCombatResolution,
  type RoundKeyEvent,
  type RoundKillLedgerEntry,
  type RoundReport,
  type TacticalCollision
} from "@agent-major/shared";

import { sanitizeLlmPayload } from "../llm/llm-output-normalizer.js";
import type { LlmStageRetryMode, LlmStageRunner } from "../llm/llm-stage-runner.js";

export interface ResolveRoundCombatResolutionInput {
  roundId: string;
  roundNumber: number;
  observabilityAttempt: number;
  match: Match;
  mapGame: MapGame;
  round: Round;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  economyDelta: RoundReport["economyDelta"];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  keyEvents: RoundKeyEvent[];
  tacticalCollision: TacticalCollision | undefined;
  retryMode?: LlmStageRetryMode | undefined;
  stageRunner: LlmStageRunner;
  useLlmCombatResolution: boolean;
}

export async function resolveRoundCombatResolution(input: ResolveRoundCombatResolutionInput): Promise<RoundCombatResolution> {
  const deterministic = (source: "deterministic_resolution" | "deterministic_fallback") =>
    buildRoundCombatResolution({ ...input, source });

  if (!input.useLlmCombatResolution) {
    return deterministic("deterministic_resolution");
  }

  const driverModelId = input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "";
  const requestInput = buildCombatResolutionRequestInput(input);
  const validateDraft = (data: unknown): RoundCombatResolution => {
    const draft = combatResolutionDraftSchema.parse(sanitizeLlmPayload(data));
    return materializeCombatDraft({
      draft,
      roundId: input.roundId,
      activeA: input.activeA,
      activeB: input.activeB,
      judgeResult: input.judgeResult
    });
  };

  try {
    const response = await input.stageRunner.runStructuredStage<RoundCombatResolution>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_combat_resolution`,
      stageId: "combat_resolution",
      retryMode: input.retryMode,
      attemptNumber: input.observabilityAttempt,
      task: "combat_resolution",
      schemaName: "CombatResolutionDraft",
      driverModelId,
      requestInput,
      responseFormat: "json_object",
      seed: `combat_resolution:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 2200,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: validateDraft
    });
    return response.data;
  } catch (error) {
    const validationError = error instanceof Error ? error.message : String(error);
    try {
      const repair = await input.stageRunner.runStructuredStage<RoundCombatResolution>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_combat_resolution_repair`,
        stageId: "combat_resolution:repair",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "combat_resolution",
        schemaName: "CombatResolutionDraft",
        driverModelId,
        requestInput: {
          ...requestInput,
          objective: "Repair the combat draft. Keep verdict facts unchanged and return a valid CombatResolutionDraft.",
          validationError
        },
        responseFormat: "json_object",
        seed: `combat_resolution_repair:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 1600,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData: validateDraft
      });
      return repair.data;
    } catch {
      return deterministic("deterministic_fallback");
    }
  }
}

export function buildRoundCombatResolution(input: {
  roundId: string;
  roundNumber: number;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  economyDelta: RoundReport["economyDelta"];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  keyEvents: RoundKeyEvent[];
  tacticalCollision: TacticalCollision | undefined;
  source?: RoundCombatResolution["source"];
}): RoundCombatResolution {
  const teamAId = input.activeA[0]?.teamId;
  const teamBId = input.activeB[0]?.teamId;
  if (!teamAId || !teamBId) {
    throw new Error("Cannot build combat resolution without both active teams.");
  }

  const roundWinType = input.judgeResult.roundWinType ?? "attack_elimination";
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  const activeByTeam = new Map([
    [teamAId, sortAgentsForRound(input.activeA)],
    [teamBId, sortAgentsForRound(input.activeB)]
  ]);
  const attackerAgents = activeByTeam.get(attackerTeamId) ?? [];
  const defenderAgents = activeByTeam.get(defenderTeamId) ?? [];
  const killPlan = determineCombatKillPlan({
    roundId: input.roundId,
    roundWinType
  });
  const attackerWins = input.winnerTeamId === attackerTeamId;
  const attackerDeathCount = Math.min(killPlan.attackerDeaths, Math.max(0, attackerAgents.length - (attackerWins ? 1 : 0)));
  const defenderDeathCount = Math.min(killPlan.defenderDeaths, Math.max(0, defenderAgents.length - (attackerWins ? 0 : 1)));
  const attackersToDie = selectDeathTargets(attackerAgents, attackerDeathCount, input.roundId, "attackers");
  const defendersToDie = selectDeathTargets(defenderAgents, defenderDeathCount, input.roundId, "defenders");
  const deathOrder = buildDeathOrder({
    roundWinType,
    attackerTeamId,
    defenderTeamId,
    attackersToDie,
    defendersToDie
  });
  const keyEvents = [...input.keyEvents];
  const entryZoneId = keyEvents[0]?.zoneId ?? "buyer_mid";
  const pressureZoneId = input.tacticalCollision?.primaryZoneId ?? keyEvents[1]?.zoneId ?? entryZoneId;
  const supportZoneId = keyEvents[1]?.zoneId ?? pressureZoneId;
  const zoneCycle = [entryZoneId, pressureZoneId, supportZoneId, pressureZoneId];
  const aliveByTeam = new Map<string, Agent[]>([
    [teamAId, [...(activeByTeam.get(teamAId) ?? [])]],
    [teamBId, [...(activeByTeam.get(teamBId) ?? [])]]
  ]);
  const killCountsByAgentId = new Map<string, number>();

  const killEvents = deathOrder.map((target, index) => {
    const actorTeamId = target.teamId === teamAId ? teamBId : teamAId;
    const actorPool = aliveByTeam.get(actorTeamId) ?? [];
    const targetPool = aliveByTeam.get(target.teamId) ?? [];
    const targetAgent = targetPool.find((agent) => agent.id === target.id);
    let actor = pickCombatActor({
      candidates: actorPool,
      mvpAgentId: input.judgeResult.mvpAgentId,
      index,
      roundId: input.roundId,
      preferredTeamWon: actorTeamId === input.winnerTeamId
    });
    if (actor?.id === input.judgeResult.mvpAgentId && (killCountsByAgentId.get(actor.id) ?? 0) >= 2) {
      actor =
        pickCombatActor({
          candidates: actorPool.filter((candidate) => candidate.id !== input.judgeResult.mvpAgentId),
          mvpAgentId: input.judgeResult.mvpAgentId,
          index,
          roundId: `${input.roundId}:non_mvp_${index}`,
          preferredTeamWon: actorTeamId === input.winnerTeamId
        }) ?? actor;
    }
    if (!actor || !targetAgent) {
      throw new Error("Cannot build combat resolution without valid alive actor and target agents.");
    }
    killCountsByAgentId.set(actor.id, (killCountsByAgentId.get(actor.id) ?? 0) + 1);

    aliveByTeam.set(target.teamId, targetPool.filter((agent) => agent.id !== targetAgent.id));
    const keyEvent = keyEvents[index] ?? keyEvents.at(-1);
    const keyEventId = index < keyEvents.length ? keyEvents[index]?.id : keyEvent?.id;
    const zoneId = zoneCycle[index % zoneCycle.length] ?? pressureZoneId;
    const tradeType = classifyCombatTradeType({
      index,
      actor,
      mvpAgentId: input.judgeResult.mvpAgentId,
      roundWinType,
      isFinalKill: index === deathOrder.length - 1,
      ...(index > 0 ? { previousActorTeamId: deathOrder[index - 1]?.teamId === teamAId ? teamBId : teamAId } : {}),
      actorTeamId
    });
    return {
      id: `kl_${input.roundId}_${index + 1}`,
      actorAgentId: actor.id,
      actorTeamId: actor.teamId,
      targetAgentId: targetAgent.id,
      targetTeamId: targetAgent.teamId,
      zoneId,
      atMs: 8000 + index * 3600 + stableNumber(`${input.roundId}:kill_${index + 1}:time`, 900),
      impact: buildKillLedgerImpact({
        actor,
        target: targetAgent,
        side: actorTeamId === input.winnerTeamId ? "winner" : "loser",
        roundNumber: input.roundNumber,
        tacticalCollisionResult: input.tacticalCollision?.result ?? null,
        keyEventType: keyEvent?.type ?? null,
        keyEventZoneId: keyEvent?.zoneId ?? null,
        tradeType
      }),
      ...(keyEventId ? { keyEventId } : {}),
      tradeType,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, actor.id)
    };
  });

  const siteZoneId = resolveBombSiteZoneId(input.judgeResult.diagnostic?.mainAttackZoneId ?? pressureZoneId);
  const planter = pickCombatActor({
    candidates: aliveByTeam.get(attackerTeamId) ?? attackerAgents,
    mvpAgentId: input.judgeResult.mvpAgentId,
    index: 0,
    roundId: `${input.roundId}:plant`,
    preferredTeamWon: attackerTeamId === input.winnerTeamId
  }) ?? attackerAgents[0];
  const defuser = pickCombatActor({
    candidates: aliveByTeam.get(defenderTeamId) ?? defenderAgents,
    mvpAgentId: input.judgeResult.mvpAgentId,
    index: 0,
    roundId: `${input.roundId}:defuse`,
    preferredTeamWon: defenderTeamId === input.winnerTeamId
  }) ?? defenderAgents[0];
  const plantEvent =
    roundWinType === "attack_bomb_explosion" || roundWinType === "defense_defuse"
      ? {
          type: "plant" as const,
          siteZoneId,
          ...(planter ? { actorAgentId: planter.id } : {}),
          actorTeamId: attackerTeamId,
          atMs: 42000,
          text: `${planter?.displayName ?? "进攻方"} 在 ${formatKillLedgerZoneLabel(siteZoneId)} 完成下包，这是裁判结算层推断出的爆弹节点。`
        }
      : undefined;
  const defuseEvent =
    roundWinType === "defense_defuse" && defuser
      ? {
          type: "defuse" as const,
          siteZoneId,
          actorAgentId: defuser.id,
          actorTeamId: defenderTeamId,
          atMs: 58500,
          text: `${defuser.displayName} 完成拆包，防守方通过回收点位拿下本局。`
        }
      : undefined;
  const explosionEvent =
    roundWinType === "attack_bomb_explosion"
      ? {
          type: "explosion" as const,
          siteZoneId,
          actorTeamId: attackerTeamId,
          atMs: 61000,
          text: `${formatKillLedgerZoneLabel(siteZoneId)} 被成功引爆，攻方通过爆弹结算拿下本局。`
        }
      : undefined;
  const openingDuel = killEvents[0]
    ? {
        killEventId: killEvents[0].id,
        actorAgentId: killEvents[0].actorAgentId,
        targetAgentId: killEvents[0].targetAgentId,
        zoneId: killEvents[0].zoneId
      }
    : undefined;
  const resolution: RoundCombatResolution = {
    source: input.source ?? (input.judgeResult.judgeInference ? "judge_inference" : "deterministic_resolution"),
    roundWinType,
    killEvents,
    ...(plantEvent ? { plantEvent } : {}),
    ...(defuseEvent ? { defuseEvent } : {}),
    ...(explosionEvent ? { explosionEvent } : {}),
    survivors: {
      teamAAgentIds: (aliveByTeam.get(teamAId) ?? []).map((agent) => agent.id),
      teamBAgentIds: (aliveByTeam.get(teamBId) ?? []).map((agent) => agent.id)
    },
    ...(openingDuel ? { openingDuel } : {}),
    tradeSequence: killEvents.map((kill, index) => ({
      killEventId: kill.id,
      tradeType: kill.tradeType ?? (index === 0 ? "opening" : "trade"),
      summary: `${formatKillLedgerZoneLabel(kill.zoneId)}：${kill.impact}`
    })),
    clutchTag: determineClutchTag({
      roundWinType,
      killEvents,
      mvpAgentId: input.judgeResult.mvpAgentId,
      survivors: {
        teamAAgentIds: (aliveByTeam.get(teamAId) ?? []).map((agent) => agent.id),
        teamBAgentIds: (aliveByTeam.get(teamBId) ?? []).map((agent) => agent.id)
      },
      winnerTeamId: input.winnerTeamId,
      teamAId,
      teamBId
    }),
    mvpEvidence: buildCombatMvpEvidence(input.judgeResult, killEvents, plantEvent, defuseEvent, explosionEvent)
  };

  validateRoundCombatResolution({
    resolution,
    activeA: input.activeA,
    activeB: input.activeB,
    attackerTeamId,
    defenderTeamId,
    winnerTeamId: input.winnerTeamId,
    teamAId,
    teamBId,
    mvpAgentId: input.judgeResult.mvpAgentId
  });
  return resolution;
}

export function summarizeCombatResolution(resolution: RoundCombatResolution): string {
  const killCount = resolution.killEvents.length;
  const opening = resolution.openingDuel
    ? `首个接触发生在 ${formatKillLedgerZoneLabel(resolution.openingDuel.zoneId)}`
    : "首个接触点未单独标记";
  const bomb =
    resolution.defuseEvent?.text ??
    resolution.explosionEvent?.text ??
    resolution.plantEvent?.text ??
    "本局主要通过击杀或时间控制结算";
  return `${opening}，共 ${killCount} 个击杀片段；${bomb}。`;
}

export function formatKillLedgerZoneLabel(zoneId: string): string {
  const labels: Record<string, string> = {
    buyer_mid: "中路",
    conversion_site_a: "A 点",
    conversion_site_b: "B 点",
    retention_connector: "A 小",
    token_economy: "B 洞",
    pricing_ramp: "A 大",
    spawn_a: "进攻方出生点",
    spawn_b: "防守方出生点",
    utility_slope: "斜坡"
  };
  return labels[zoneId] ?? zoneId.replaceAll("_", " ");
}

function buildCombatResolutionRequestInput(input: {
  roundId: string;
  roundNumber: number;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  keyEvents: RoundKeyEvent[];
  tacticalCollision: TacticalCollision | undefined;
}): Record<string, unknown> {
  const teamAId = input.activeA[0]?.teamId ?? "";
  const teamBId = input.activeB[0]?.teamId ?? "";
  const roundWinType = input.judgeResult.roundWinType ?? "attack_elimination";
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  return {
    objective: "Create a bounded combat draft for this round. The code validator is final authority.",
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    verdict: {
      winnerTeamId: input.winnerTeamId,
      loserTeamId: input.loserTeamId,
      roundWinType,
      mvpAgentId: input.judgeResult.mvpAgentId,
      margin: input.judgeResult.margin,
      diagnostic: input.judgeResult.diagnostic
    },
    attackerTeamId,
    defenderTeamId,
    teamAId,
    teamBId,
    activeRosters: {
      teamA: input.activeA.map((agent) => ({ id: agent.id, teamId: agent.teamId, displayName: agent.displayName, role: agent.role })),
      teamB: input.activeB.map((agent) => ({ id: agent.id, teamId: agent.teamId, displayName: agent.displayName, role: agent.role }))
    },
    agentOutputs: input.agentOutputs.map((output) => ({
      id: output.id,
      agentId: output.agentId,
      teamId: output.teamId,
      role: output.role,
      actionDetail: output.actionDetail
    })),
    keyEvents: input.keyEvents,
    tacticalCollision: input.tacticalCollision,
    hardRules: [
      "同一 targetAgentId 只能死亡一次。",
      "actorAgentId 和 targetAgentId 必须来自 activeRosters 且属于不同队伍。",
      "survivors 必须等于 active roster 减去 killEvents.targetAgentId。",
      "roundWinType 决定爆弹事件，不允许叙事和事件矛盾。",
      "one_v_x 只有 MVP 是胜方唯一存活者时才允许。",
      "MVP 不应常规性拿 4-5 杀。"
    ]
  };
}

function materializeCombatDraft(input: {
  draft: CombatResolutionDraft;
  roundId: string;
  activeA: Agent[];
  activeB: Agent[];
  judgeResult: JudgeResult;
}): RoundCombatResolution {
  const teamAId = input.activeA[0]?.teamId;
  const teamBId = input.activeB[0]?.teamId;
  if (!teamAId || !teamBId) {
    throw new Error("Cannot validate combat draft without both active teams.");
  }
  const roundWinType = input.judgeResult.roundWinType ?? input.draft.roundWinType;
  if (input.draft.roundWinType !== roundWinType) {
    throw new Error("Combat draft roundWinType must match judge verdict.");
  }
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.judgeResult.winnerTeamId : input.judgeResult.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  const resolution: RoundCombatResolution = {
    source: "combat_llm_validated",
    roundWinType,
    killEvents: input.draft.killEvents.map((kill, index) => ({
      ...kill,
      id: kill.id || `kl_${input.roundId}_${index + 1}`,
      sourceAgentOutputIds: kill.sourceAgentOutputIds ?? []
    })),
    ...(input.draft.plantEvent ? { plantEvent: input.draft.plantEvent } : {}),
    ...(input.draft.defuseEvent ? { defuseEvent: input.draft.defuseEvent } : {}),
    ...(input.draft.explosionEvent ? { explosionEvent: input.draft.explosionEvent } : {}),
    survivors: input.draft.survivors,
    ...(input.draft.openingDuel ? { openingDuel: input.draft.openingDuel } : {}),
    tradeSequence: input.draft.tradeSequence,
    clutchTag: input.draft.clutchTag ?? "none",
    mvpEvidence: input.draft.mvpEvidence
  };
  validateRoundCombatResolution({
    resolution,
    activeA: input.activeA,
    activeB: input.activeB,
    attackerTeamId,
    defenderTeamId,
    winnerTeamId: input.judgeResult.winnerTeamId,
    teamAId,
    teamBId,
    mvpAgentId: input.judgeResult.mvpAgentId
  });
  return resolution;
}

export function validateRoundKillLedger(input: {
  killLedger: RoundKillLedgerEntry[];
  activeA: Agent[];
  activeB: Agent[];
  winnerTeamId: string;
  loserTeamId: string;
}): RoundKillLedgerEntry[] {
  const activeById = new Map<string, Agent>([...input.activeA, ...input.activeB].map((agent) => [agent.id, agent] as const));
  const allowedTeamIds = new Set([input.winnerTeamId, input.loserTeamId]);

  return input.killLedger.map((entry, index) => {
    const actor = activeById.get(entry.actorAgentId);
    const target = activeById.get(entry.targetAgentId);
    if (!actor || !target) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: unresolved actor or target agent.`);
    }
    if (!allowedTeamIds.has(entry.actorTeamId) || !allowedTeamIds.has(entry.targetTeamId)) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: team ids do not match the round roster.`);
    }
    if (actor.teamId !== entry.actorTeamId || target.teamId !== entry.targetTeamId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: actor or target team mismatch.`);
    }
    if (actor.teamId === target.teamId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: actor and target must belong to opposite teams.`);
    }
    if (!entry.zoneId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: missing zone id.`);
    }
    if (!Number.isFinite(entry.atMs)) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: missing event timestamp.`);
    }

    return {
      ...entry,
      sourceAgentOutputIds: entry.sourceAgentOutputIds ?? []
    };
  });
}

function determineCombatKillPlan(input: {
  roundId: string;
  roundWinType: JudgeRoundWinType;
}): { attackerDeaths: number; defenderDeaths: number } {
  const variance = stableNumber(`${input.roundId}:combat_density`, 3);
  switch (input.roundWinType) {
    case "attack_elimination":
      return { attackerDeaths: Math.min(4, 1 + variance), defenderDeaths: 5 };
    case "attack_bomb_explosion":
      return { attackerDeaths: Math.min(3, variance), defenderDeaths: Math.min(4, 2 + variance) };
    case "defense_elimination":
      return { attackerDeaths: 5, defenderDeaths: Math.min(4, variance) };
    case "defense_defuse":
      return { attackerDeaths: Math.min(5, 3 + variance), defenderDeaths: Math.min(4, 1 + variance) };
    case "defense_timeout_no_plant":
      return { attackerDeaths: Math.min(3, 1 + variance), defenderDeaths: Math.min(2, variance) };
  }
}

function selectDeathTargets(agents: Agent[], count: number, roundId: string, label: string): Agent[] {
  if (count <= 0 || agents.length === 0) {
    return [];
  }
  const ordered = sortAgentsForRound(agents);
  const offset = stableNumber(`${roundId}:${label}:offset`, ordered.length);
  return [...ordered.slice(offset), ...ordered.slice(0, offset)].slice(0, Math.min(count, ordered.length));
}

function buildDeathOrder(input: {
  roundWinType: JudgeRoundWinType;
  attackerTeamId: string;
  defenderTeamId: string;
  attackersToDie: Agent[];
  defendersToDie: Agent[];
}): Agent[] {
  const attackerQueue = [...input.attackersToDie];
  const defenderQueue = [...input.defendersToDie];
  const order: Agent[] = [];
  const finalTeamId =
    input.roundWinType === "attack_elimination"
      ? input.defenderTeamId
      : input.roundWinType === "defense_elimination"
        ? input.attackerTeamId
        : undefined;

  while (attackerQueue.length > 0 || defenderQueue.length > 0) {
    const preferDefenderDeath = input.roundWinType.startsWith("attack_") ? order.length % 3 !== 1 : order.length % 3 === 1;
    const next = preferDefenderDeath ? defenderQueue.shift() ?? attackerQueue.shift() : attackerQueue.shift() ?? defenderQueue.shift();
    if (next) {
      order.push(next);
    }
  }

  if (finalTeamId) {
    let finalIndex = -1;
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (order[index]?.teamId === finalTeamId) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex >= 0 && finalIndex !== order.length - 1) {
      const [finalAgent] = order.splice(finalIndex, 1);
      if (finalAgent) {
        order.push(finalAgent);
      }
    }
  }

  return order;
}

function pickCombatActor(input: {
  candidates: Agent[];
  mvpAgentId: string;
  index: number;
  roundId: string;
  preferredTeamWon: boolean;
}): Agent | undefined {
  if (input.candidates.length === 0) {
    return undefined;
  }
  const mvp = input.candidates.find((agent) => agent.id === input.mvpAgentId);
  if (mvp && (input.index === 0 || input.index >= 2 || input.preferredTeamWon)) {
    return mvp;
  }
  const rolePriority = ["entry", "star_rifler", "awper", "rifler", "lurker", "support", "igl"];
  const ordered = [...input.candidates].sort((left, right) => {
    const leftRole = rolePriority.indexOf(left.role);
    const rightRole = rolePriority.indexOf(right.role);
    return (leftRole === -1 ? 99 : leftRole) - (rightRole === -1 ? 99 : rightRole) || left.id.localeCompare(right.id);
  });
  return ordered[(input.index + stableNumber(`${input.roundId}:actor`, ordered.length)) % ordered.length];
}

function classifyCombatTradeType(input: {
  index: number;
  actor: Agent;
  mvpAgentId: string;
  roundWinType: JudgeRoundWinType;
  isFinalKill: boolean;
  previousActorTeamId?: string | undefined;
  actorTeamId: string;
}): NonNullable<RoundKillLedgerEntry["tradeType"]> {
  if (input.index === 0) {
    return "opening";
  }
  if (input.actor.id === input.mvpAgentId && input.isFinalKill) {
    return input.roundWinType === "defense_defuse" ? "clutch" : "multi_kill";
  }
  if (input.previousActorTeamId && input.previousActorTeamId !== input.actorTeamId) {
    return "trade";
  }
  if (input.isFinalKill) {
    return "clutch";
  }
  return "multi_kill";
}

function validateRoundCombatResolution(input: {
  resolution: RoundCombatResolution;
  activeA: Agent[];
  activeB: Agent[];
  attackerTeamId: string;
  defenderTeamId: string;
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
  mvpAgentId: string;
}): void {
  const activeIdsByTeam = new Map([
    [input.teamAId, new Set(input.activeA.map((agent) => agent.id))],
    [input.teamBId, new Set(input.activeB.map((agent) => agent.id))]
  ]);
  const deadIdsByTeam = new Map<string, Set<string>>([
    [input.teamAId, new Set<string>()],
    [input.teamBId, new Set<string>()]
  ]);
  for (const kill of input.resolution.killEvents) {
    if (deadIdsByTeam.get(kill.targetTeamId)?.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: ${kill.targetAgentId} died more than once.`);
    }
    if (!activeIdsByTeam.get(kill.targetTeamId)?.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: target ${kill.targetAgentId} is not active.`);
    }
    deadIdsByTeam.get(kill.targetTeamId)?.add(kill.targetAgentId);
  }
  const attackerDeaths = deadIdsByTeam.get(input.attackerTeamId)?.size ?? 0;
  const defenderDeaths = deadIdsByTeam.get(input.defenderTeamId)?.size ?? 0;
  const hasPlant = Boolean(input.resolution.plantEvent);
  const hasDefuse = Boolean(input.resolution.defuseEvent);
  const hasExplosion = Boolean(input.resolution.explosionEvent);

  const attackerCount = activeIdsByTeam.get(input.attackerTeamId)?.size ?? 0;
  const defenderCount = activeIdsByTeam.get(input.defenderTeamId)?.size ?? 0;

  if (input.resolution.roundWinType === "attack_elimination" && defenderDeaths !== defenderCount) {
    throw new Error("Invalid combat resolution: attack_elimination requires all defenders dead.");
  }
  if (input.resolution.roundWinType === "defense_elimination" && attackerDeaths !== attackerCount) {
    throw new Error("Invalid combat resolution: defense_elimination requires all attackers dead.");
  }
  if (input.resolution.roundWinType === "attack_bomb_explosion" && (!hasPlant || !hasExplosion || hasDefuse)) {
    throw new Error("Invalid combat resolution: attack_bomb_explosion requires plant and explosion without defuse.");
  }
  if (input.resolution.roundWinType === "defense_defuse" && (!hasPlant || !hasDefuse || hasExplosion)) {
    throw new Error("Invalid combat resolution: defense_defuse requires plant and defuse without explosion.");
  }
  if (input.resolution.roundWinType === "defense_timeout_no_plant" && (hasPlant || hasDefuse || hasExplosion)) {
    throw new Error("Invalid combat resolution: defense_timeout_no_plant cannot contain bomb events.");
  }
  const survivorIds = new Set([...input.resolution.survivors.teamAAgentIds, ...input.resolution.survivors.teamBAgentIds]);
  for (const [teamId, activeIds] of activeIdsByTeam) {
    const expectedSurvivors = [...activeIds].filter((agentId) => !deadIdsByTeam.get(teamId)?.has(agentId)).sort();
    const actualSurvivors = (teamId === input.teamAId ? input.resolution.survivors.teamAAgentIds : input.resolution.survivors.teamBAgentIds).sort();
    if (JSON.stringify(expectedSurvivors) !== JSON.stringify(actualSurvivors)) {
      throw new Error(`Invalid combat resolution: survivor list does not match kill events for ${teamId}.`);
    }
  }
  if (input.resolution.clutchTag === "one_v_x") {
    const winnerSurvivors = input.winnerTeamId === input.teamAId ? input.resolution.survivors.teamAAgentIds : input.resolution.survivors.teamBAgentIds;
    if (winnerSurvivors.length !== 1 || winnerSurvivors[0] !== input.mvpAgentId) {
      throw new Error("Invalid combat resolution: one_v_x requires MVP to be the sole winning survivor.");
    }
  }
  const mvpKills = input.resolution.killEvents.filter((kill) => kill.actorAgentId === input.mvpAgentId).length;
  if (mvpKills > 3 && input.resolution.clutchTag !== "one_v_x") {
    throw new Error("Invalid combat resolution: MVP kill count is too high without a real clutch.");
  }
  for (const kill of input.resolution.killEvents) {
    if (survivorIds.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: dead target ${kill.targetAgentId} is listed as survivor.`);
    }
  }
}

function resolveBombSiteZoneId(zoneId: string): string {
  if (zoneId === "conversion_site_b" || zoneId === "token_economy") {
    return "conversion_site_b";
  }
  return "conversion_site_a";
}

function determineClutchTag(input: {
  roundWinType: JudgeRoundWinType;
  killEvents: RoundKillLedgerEntry[];
  mvpAgentId: string;
  survivors: RoundCombatResolution["survivors"];
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
}): NonNullable<RoundCombatResolution["clutchTag"]> {
  if (input.roundWinType === "defense_defuse") {
    return "retake";
  }
  if (input.roundWinType === "attack_bomb_explosion") {
    return "post_plant_hold";
  }
  const winnerSurvivors = input.winnerTeamId === input.teamAId ? input.survivors.teamAAgentIds : input.survivors.teamBAgentIds;
  const mvpKills = input.killEvents.filter((kill) => kill.actorAgentId === input.mvpAgentId).length;
  if (winnerSurvivors.length === 1 && winnerSurvivors[0] === input.mvpAgentId && mvpKills >= 2) {
    return "one_v_x";
  }
  return "none";
}

function buildCombatMvpEvidence(
  judgeResult: JudgeResult,
  killEvents: RoundKillLedgerEntry[],
  plantEvent: RoundCombatResolution["plantEvent"],
  defuseEvent: RoundCombatResolution["defuseEvent"],
  explosionEvent: RoundCombatResolution["explosionEvent"]
): string {
  const mvpKills = killEvents.filter((kill) => kill.actorAgentId === judgeResult.mvpAgentId).length;
  const bombLine = defuseEvent
    ? "并且防守方完成拆包"
    : explosionEvent
      ? "并且攻方守到炸弹爆炸"
      : plantEvent
        ? "并且本局存在下包节点"
        : "本局不依赖爆弹节点";
  return `MVP ${judgeResult.mvpAgentId} 在战斗映射中贡献 ${mvpKills} 次击杀，${bombLine}；该结论来自裁判结算层，不是 agent_action 原始事实。`;
}

function buildKillLedgerImpact(input: {
  actor: Agent;
  target: Agent;
  side: "winner" | "loser";
  roundNumber: number;
  tacticalCollisionResult: TacticalCollision["result"] | null;
  keyEventType: RoundKeyEvent["type"] | null;
  keyEventZoneId: string | null;
  tradeType?: NonNullable<RoundKillLedgerEntry["tradeType"]>;
}): string {
  const zoneLabel = formatKillLedgerZoneLabel(input.keyEventZoneId ?? "buyer_mid");
  const tradeLabel =
    input.tradeType === "opening"
      ? "首杀"
      : input.tradeType === "trade"
        ? "补枪"
        : input.tradeType === "multi_kill"
          ? "连续击杀"
          : input.tradeType === "clutch"
            ? "残局收束"
            : "退场击杀";
  const emphasis =
    input.side === "winner"
      ? input.keyEventType === "entry"
        ? "打开突破口"
        : input.keyEventType === "clutch"
          ? "完成收束"
          : "延续优势"
      : input.tacticalCollisionResult === "rotate_success"
        ? "拖住回防"
        : input.tacticalCollisionResult === "defense_hold"
          ? "守住点位"
          : "制造交换";
  return `${input.actor.displayName} 在 ${zoneLabel} ${emphasis}，对 ${input.target.displayName} 完成${tradeLabel}；这是裁判结算层映射出的战斗片段。`;
}

function sortAgentsForRound(agents: Agent[]): Agent[] {
  const rank = new Map<Agent["role"], number>([
    ["entry", 0],
    ["star_rifler", 1],
    ["awper", 2],
    ["igl", 3],
    ["rifler", 4],
    ["lurker", 5],
    ["support", 6],
    ["stand_in", 7],
    ["coach", 8]
  ]);
  return [...agents].sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99) || left.id.localeCompare(right.id));
}

function sourceOutputIds(outputs: AgentOutput[], agentId: string): string[] {
  return outputs.filter((output) => output.agentId === agentId).map((output) => output.id);
}

function stableNumber(input: string, modulo: number): number {
  const hex = stableHex(input).slice(0, 8);
  return Number.parseInt(hex, 16) % modulo;
}

function stableHex(input: string): string {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
