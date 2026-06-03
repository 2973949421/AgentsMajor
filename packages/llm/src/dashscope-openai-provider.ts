import type { LlmGateway, LlmMessage, LlmProviderDiagnostics, LlmRequest, LlmResponse, LlmUsage } from "./gateway.js";
import {
  openAiCompatibleProviderId,
  resolveDriverModelConfig,
  type ReasoningEffort,
  type ReasoningMode
} from "./model-registry.js";

export type LlmProviderErrorType = "timeout" | "rate_limited" | "provider_error" | "invalid_response" | "unknown";

export interface DashScopeOpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number[];
  fetchFn?: typeof fetch;
  providerId?: string;
  modelName?: string;
  reasoningMode?: ReasoningMode;
  reasoningEffort?: ReasoningEffort;
}

export class LlmProviderError extends Error {
  readonly errorType: LlmProviderErrorType;
  readonly retryable: boolean;
  readonly providerId: string;
  readonly driverModelId: string;
  readonly modelName: string | undefined;
  readonly statusCode: number | undefined;
  readonly rawText: string | undefined;
  readonly usage: LlmUsage | undefined;
  readonly parseCandidate: string | undefined;
  readonly providerDiagnostics: LlmProviderDiagnostics | undefined;

  constructor(input: {
    message: string;
    errorType: LlmProviderErrorType;
    retryable: boolean;
    driverModelId: string;
    modelName?: string;
    statusCode?: number;
    rawText?: string;
    usage?: LlmUsage;
    parseCandidate?: string;
    providerDiagnostics?: LlmProviderDiagnostics;
  }) {
    super(input.message);
    this.name = "LlmProviderError";
    this.errorType = input.errorType;
    this.retryable = input.retryable;
    this.providerId = openAiCompatibleProviderId;
    this.driverModelId = input.driverModelId;
    this.modelName = input.modelName;
    this.statusCode = input.statusCode;
    this.rawText = input.rawText;
    this.usage = input.usage;
    this.parseCandidate = input.parseCandidate;
    this.providerDiagnostics = input.providerDiagnostics;
  }
}

export class DashScopeOpenAiProvider implements LlmGateway {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number[];
  private readonly fetchFn: typeof fetch;
  private readonly providerId: string;
  private readonly modelName: string | undefined;
  private readonly reasoningMode: ReasoningMode;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly reasoningModeOverride: ReasoningMode | undefined;
  private readonly reasoningEffortOverride: ReasoningEffort | undefined;

  constructor(options: DashScopeOpenAiProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxRetries = options.maxRetries ?? 4;
    this.retryBackoffMs = options.retryBackoffMs ?? [1_000, 3_000, 8_000, 15_000];
    this.fetchFn = options.fetchFn ?? fetch;
    this.providerId = options.providerId ?? openAiCompatibleProviderId;
    this.modelName = options.modelName?.trim();
    this.reasoningModeOverride = options.reasoningMode;
    this.reasoningEffortOverride = options.reasoningEffort;
    this.reasoningMode = options.reasoningMode ?? (this.modelName?.toLowerCase().includes("deepseek") ? "enabled" : "auto");
    this.reasoningEffort = options.reasoningEffort ?? "high";
  }

  async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    const modelConfig = resolveDriverModelConfig(request.driverModelId, this.modelName);
    const messages = request.messages ?? buildDefaultMessages(request);
    const url = `${this.baseUrl}/chat/completions`;
    const modelName = modelConfig.modelName;
    let body = normalizeThinkingBody(compactObject({
      ...buildModelExtraParams({
        modelName,
        reasoningMode: this.reasoningModeOverride ?? modelConfig.reasoningMode ?? this.reasoningMode,
        reasoningEffort: this.reasoningEffortOverride ?? modelConfig.reasoningEffort ?? this.reasoningEffort,
        repair: false
      }),
      ...(request.extraParams ?? {}),
      model: modelName,
      messages,
      stream: false,
      temperature: request.temperature ?? modelConfig.defaultTemperature,
      max_tokens: request.maxOutputTokens ?? modelConfig.defaultMaxOutputTokens,
      response_format: request.responseFormat === "json_object" ? { type: "json_object" } : undefined
    }));

    let latestError: unknown;
    let providerRetryAttempt = 0;
    let expandedBudgetRetryUsed = false;
    while (true) {
      try {
        return await this.sendRequest<TData>({
          url,
          body,
          request,
          modelName
        });
      } catch (error) {
        latestError = error;
        if (!expandedBudgetRetryUsed && shouldRetryWithExpandedJsonBudget(error, request, modelName, body)) {
          expandedBudgetRetryUsed = true;
          body = {
            ...body,
            max_tokens: expandedJsonBudgetForTask(request.task, numberFromUnknown(body.max_tokens))
          };
          continue;
        }

        if (!isRetryableProviderError(error) || providerRetryAttempt >= this.maxRetries) {
          throw error;
        }
        await delay(this.retryBackoffMs[Math.min(providerRetryAttempt, this.retryBackoffMs.length - 1)] ?? 0);
        providerRetryAttempt += 1;
      }
    }

    throw latestError instanceof Error
      ? latestError
      : new LlmProviderError({
          message: "LLM provider failed with an unknown error.",
          errorType: "unknown",
          retryable: false,
          driverModelId: request.driverModelId,
          modelName
        });
  }

  private async sendRequest<TData>(input: {
    url: string;
    body: Record<string, unknown>;
    request: LlmRequest;
    modelName: string;
  }): Promise<LlmResponse<TData>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(input.body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw await this.providerHttpError(response, input.request, input.modelName);
      }

      const json = await safeReadJson(response, input.request, input.modelName);
      const usage = extractUsage(json);
      const maxOutputTokens = numberFromUnknown(input.body.max_tokens) || input.request.maxOutputTokens;
      const extracted = extractMessageContent(json, input.request, input.modelName, usage, maxOutputTokens);
      const rawText = extracted.rawText;
      const providerDiagnostics = extracted.providerDiagnostics;
      if (input.request.responseFormat !== "json_object") {
        return {
          data: rawText as TData,
          usage,
          rawText,
          providerDiagnostics
        };
      }

      try {
        return {
          data: parseJsonContent(rawText, input.request, input.modelName, usage, maxOutputTokens, providerDiagnostics) as TData,
          usage,
          rawText,
          providerDiagnostics
        };
      } catch (error) {
        if (!(error instanceof LlmProviderError)) {
          throw error;
        }
        if (!shouldAttemptStructuredRepair(error, rawText)) {
          throw error;
        }

        const repaired = await this.repairJsonContent<TData>({
          url: input.url,
          request: input.request,
          modelName: input.modelName,
          originalRawText: rawText,
          originalUsage: usage,
          originalProviderDiagnostics: providerDiagnostics,
          parseError: error.message
        });
        return repaired;
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw new LlmProviderError({
          message: "LLM provider request timed out.",
          errorType: "timeout",
          retryable: true,
          driverModelId: input.request.driverModelId,
          modelName: input.modelName
        });
      }

      if (error instanceof LlmProviderError) {
        throw error;
      }

      throw new LlmProviderError({
        message: `LLM provider request failed${describeProviderRequestFailure(error)}.`,
        errorType: "provider_error",
        retryable: true,
        driverModelId: input.request.driverModelId,
        modelName: input.modelName
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async repairJsonContent<TData>(input: {
    url: string;
    request: LlmRequest;
    modelName: string;
    originalRawText: string;
    originalUsage: LlmUsage;
    originalProviderDiagnostics?: LlmProviderDiagnostics;
    parseError: string;
  }): Promise<LlmResponse<TData>> {
    const outputContract = outputContractForSchema(input.request.schemaName);
    const repairHardConstraints = repairHardConstraintsForRequest(input.request);
    const repairSystemContent =
      input.request.schemaName === "JudgeVerdictDecision"
        ? "You repair structured judge verdict outputs. Return only one compact valid json object. Preserve required verdict facts and diagnostic fields. Omit judgeScorecard unless it can be represented as tiny teamScores only. Never copy rubricProfile, defenderThesisContext, original input, markdown, prose, comments, or null optional fields."
        : "You repair structured outputs. Return only one valid json object. Preserve every field required by the named schema. Do not summarize, compress, or downgrade the response. Omit optional fields instead of returning null. Do not include markdown, code fences, prose, comments, or copied input. This is format repair only; do not invent ids or facts.";
    const repairShapeRule =
      input.request.schemaName === "JudgeVerdictDecision"
        ? "Repair rule: keep a compact v6 verdict shape. Do not output full judgeScorecard, rubricProfile, totalScore, scoreDelta, winnerFromScore, marginFromScore, or copied context."
        : "Repair rule: keep the same schema shape. If the source contains long structured fields, fix syntax and escaping only. Do not replace it with a shorter legacy object.";
    const maxRepairTokens = repairBudgetForTask(input.request.task, input.request.maxOutputTokens ?? 0);
    let body = compactObject({
      ...buildModelExtraParams({
        modelName: input.modelName,
        reasoningMode: "disabled",
        reasoningEffort: "low",
        repair: true
      }),
      model: input.modelName,
      messages: [
        {
          role: "system",
          content: repairSystemContent
        },
        {
          role: "user",
          content: [
            `Repair this response into valid JSON for schema ${input.request.schemaName}.`,
            outputContract,
            repairShapeRule,
            "Repair rule: optional fields must be omitted when unknown; never fill optional fields with null, empty strings, or empty objects.",
            repairHardConstraints,
            "Original non-JSON response:",
            input.originalRawText
          ].join("\n")
        }
      ],
      stream: false,
      temperature: 0,
      max_tokens: maxRepairTokens,
      response_format: { type: "json_object" }
    });

    let expandedRepairRetryUsed = false;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await this.fetchFn(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw await this.providerHttpError(response, input.request, input.modelName);
      }

      const json = await safeReadJson(response, input.request, input.modelName);
      const repairUsage = extractUsage(json);
      const repairMaxOutputTokens = numberFromUnknown(body.max_tokens) || maxRepairTokens;
      let repairExtracted: { rawText: string; providerDiagnostics: LlmProviderDiagnostics };
      try {
        repairExtracted = extractMessageContent(json, input.request, input.modelName, repairUsage, repairMaxOutputTokens);
      } catch (error) {
        if (!expandedRepairRetryUsed && shouldRetryWithExpandedJsonBudget(error, input.request, input.modelName, body)) {
          expandedRepairRetryUsed = true;
          body = {
            ...body,
            max_tokens: expandedJsonBudgetForTask(input.request.task, repairMaxOutputTokens)
          };
          continue;
        }
        throw error;
      }

      const repairRawText = repairExtracted.rawText;
      try {
        return {
          data: parseJsonContent(
            repairRawText,
            input.request,
            input.modelName,
            repairUsage,
            repairMaxOutputTokens,
            repairExtracted.providerDiagnostics
          ) as TData,
          usage: combineUsage(input.originalUsage, repairUsage),
          rawText: repairRawText,
          ...(input.originalProviderDiagnostics ? { providerDiagnostics: input.originalProviderDiagnostics } : {}),
          structuredRepair: {
            originalRawText: input.originalRawText,
            repairRawText,
            repairUsage,
            repairProviderDiagnostics: repairExtracted.providerDiagnostics,
            parseError: input.parseError
          }
        };
      } catch (error) {
        if (!expandedRepairRetryUsed && shouldRetryWithExpandedJsonBudget(error, input.request, input.modelName, body)) {
          expandedRepairRetryUsed = true;
          body = {
            ...body,
            max_tokens: expandedJsonBudgetForTask(input.request.task, repairMaxOutputTokens)
          };
          continue;
        }
        if (error instanceof LlmProviderError) {
          throw new LlmProviderError({
            message: error.message,
            errorType: error.errorType,
            retryable: false,
            driverModelId: input.request.driverModelId,
            modelName: input.modelName,
            rawText: input.originalRawText,
            usage: input.originalUsage,
            ...(input.originalProviderDiagnostics ? { providerDiagnostics: input.originalProviderDiagnostics } : {}),
            ...(error.parseCandidate ? { parseCandidate: error.parseCandidate } : {})
          });
        }
        throw error;
      }
    }
  }

  private async providerHttpError(response: Response, request: LlmRequest, modelName: string): Promise<LlmProviderError> {
    const body = sanitizeProviderText(await response.text().catch(() => ""));
    const errorType: LlmProviderErrorType =
      response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_error" : "invalid_response";
    return new LlmProviderError({
      message: `LLM provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
      errorType,
      retryable: response.status === 429 || response.status >= 500,
      driverModelId: request.driverModelId,
      modelName,
      statusCode: response.status
    });
  }
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}

function describeProviderRequestFailure(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name);
    if (error.message) {
      parts.push(error.message);
    }
    const cause = isRecord(error.cause) ? error.cause : undefined;
    const causeCode = cause ? stringField(cause, "code") : undefined;
    const causeMessage = cause ? stringField(cause, "message") : undefined;
    if (causeCode) {
      parts.push(`cause=${causeCode}`);
    }
    if (causeMessage) {
      parts.push(causeMessage);
    }
  } else if (typeof error === "string") {
    parts.push(error);
  }
  const detail = sanitizeProviderText(parts.filter(Boolean).join(" / ")).trim();
  return detail ? `: ${detail.slice(0, 220)}` : "";
}

function buildDefaultMessages(request: LlmRequest): LlmMessage[] {
  if (request.responseFormat === "json_object") {
    const outputContract = outputContractForSchema(request.schemaName);
    return [
      {
        role: "system",
        content:
          "You are a structured generation engine. You may reason internally when the provider supports it, but final message.content must contain only one complete valid json object that matches the requested schema. Do not include markdown, code fences, analysis, or extra commentary. Do not copy the input object unless the output contract asks for the same field. Keep final JSON concise enough to fit the output budget."
      },
      {
        role: "user",
        content: [
          `Respond with a json object for schema ${request.schemaName}.`,
          outputContract,
          JSON.stringify({
            task: request.task,
            schemaName: request.schemaName,
            input: request.input
          })
        ].join("\n")
      }
    ];
  }

  return [
      {
        role: "system",
        content: "You are a structured text generation engine. Follow the user task exactly."
      },
    {
      role: "user",
      content: JSON.stringify({
        task: request.task,
        schemaName: request.schemaName,
        input: request.input
      })
    }
  ];
}

function outputContractForSchema(schemaName: string): string {
  if (schemaName === "AgentActionDecision") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"roundObjective":"<1-2 complete Chinese sentences>","executionPlan":"<1-2 complete Chinese sentences>","coordinationPlan":"<1-2 complete Chinese sentences>","roleResponsibilityUsage":"<1-2 complete Chinese sentences>","riskRead":"<1-2 complete Chinese sentences>","contingencyPlan":"<1-2 complete Chinese sentences>","expectedContribution":"<1-2 complete Chinese sentences>","confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: roundObjective, executionPlan, coordinationPlan, roleResponsibilityUsage, riskRead, contingencyPlan, expectedContribution, confidence.",
      "Optional field: fingerprint.",
      "Do not return the legacy action field. Do not return actionDecision. Do not include roundId, agentId, mapName, role, buyType, sideContext, or other copied input fields.",
      "Each natural-language field must be specific but bounded to 1-2 sentences so the whole object stays valid JSON.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  if (schemaName === "TeamRoundPlanDecision") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"teamId":"<input teamId>","side":"attack|defense","primaryIntent":"<team tactical intent>","primaryZoneId":"<main zone id>","secondaryZoneId":"<optional zone id>","coordinationSummary":"<how the five players coordinate>","playerDirectives":[{"agentId":"<active player id>","directive":"<individual directive aligned to the team plan>"}],"winCondition":"<how this team wins the round>","risk":"<main tactical risk>","confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: teamId, side, primaryIntent, primaryZoneId, coordinationSummary, playerDirectives, winCondition, risk, confidence.",
      "playerDirectives must include exactly one directive for every active player in the input activeAgents list.",
      "Every playerDirectives[].agentId must copy an input activeAgents[].id exactly. Never output player1, player2, agent1, role names, display names, or invented ids.",
      "side must match the input side. confidence must be a number between 0 and 1.",
      "Do not include economyIntent.buyIntentByAgent, targetPosture, or preferredLoadout. The engine derives economy fields from the current economy state.",
      "If economyIntent is included, keep only defaultPosture and summary under 30 Chinese characters.",
      "Keep primaryIntent, coordinationSummary, each directive, winCondition, and risk to one concise Chinese sentence each.",
      "Do not copy the input object. Do not include opponent restricted plans."
    ].join("\n");
  }

  if (schemaName === "JudgeResult") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"winnerTeamId":"<teamAId or teamBId>","loserTeamId":"<the other team id>","margin":"narrow|standard|decisive","roundWinType":"attack_elimination|attack_bomb_explosion|defense_elimination|defense_timeout_no_plant|defense_defuse","attackWinConditionMet":true,"defenseWinConditionMet":false,"reason":"<Chinese judge ruling>","mvpAgentId":"<agent id from the winning active roster>","confidence":0.0,"judgeInference":{"source":"judge_inference","boundary":"<state that combat/result details are judge inference, not agent_action raw facts>","csResolution":"<CS win method resolution>","combatNarrative":"<inferred kills/plant/defuse/clearance if needed>","evidenceBasis":["<team_plan/agent_action/zone/economy basis>"]},"diagnostic":{"currentSubTheme":"<round subtheme>","attackedOpportunityGap":"<attack gap>","defendedCoreProposition":"<defense core>","mainAttackZoneId":"<zone id>","mainDefenseZoneId":"<zone id>","zoneRelation":{"attackZoneId":"<same as mainAttackZoneId>","defenseZoneId":"<same as mainDefenseZoneId>","relationType":"same_focus|cross_hit|split_pressure|failed_probe|rotation_test|weak_side_hit","relationSummary":"<why these zones are related>","outcomeImpact":"<how this relation affected the ruling>"},"decisiveEvidence":"<decisive evidence>"}}',
      "Required fields: winnerTeamId, loserTeamId, margin, roundWinType, attackWinConditionMet, defenseWinConditionMet, reason, mvpAgentId, confidence, judgeInference, diagnostic.",
      "margin must be exactly one of: narrow, standard, decisive. Do not use clear, close, solid, dominant, or other synonyms.",
      "roundWinType must be one of: attack_elimination, attack_bomb_explosion, defense_elimination, defense_timeout_no_plant, defense_defuse.",
      "judgeInference.source must be exactly judge_inference and must mark combat/result details as judge inference rather than agent_action facts.",
      "diagnostic.zoneRelation.attackZoneId must equal diagnostic.mainAttackZoneId; diagnostic.zoneRelation.defenseZoneId must equal diagnostic.mainDefenseZoneId.",
      "reason must explicitly name both teams and explain the winner success path plus the loser failure path.",
      "For stable validation in Chinese, reason should include 成功 and 失败/未能.",
      "For stable validation, include succeeded and failed, or Chinese equivalents 成功 and 失败/未能, in reason.",
      "winnerTeamId must be one of the input team ids. loserTeamId must be the other team id.",
      "mvpAgentId must come from the winning team's active agent id list.",
      "reason must discuss both teams' winCondition and explain why one succeeded while the other failed.",
      "Do not decide from team order, team name fame, current score lead, or first-listed team bias.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  if (schemaName === "JudgeVerdictDecision") {
    return [
      "Output contract:",
      "Return exactly one compact top-level JSON object with these fields:",
      '{"winnerTeamId":"<teamAId or teamBId>","loserTeamId":"<the other team id>","margin":"narrow|standard|decisive","roundWinType":"attack_elimination|attack_bomb_explosion|defense_elimination|defense_timeout_no_plant|defense_defuse","attackWinConditionMet":true,"defenseWinConditionMet":false,"mvpAgentId":"<agent id from winning active roster>","confidence":0.0,"diagnostic":{"currentSubTheme":"<round subtheme>","attackedOpportunityGap":"<attack gap>","defendedCoreProposition":"<defense core>","mainAttackZoneId":"<zone id>","mainDefenseZoneId":"<zone id>","zoneRelation":{"attackZoneId":"<same as mainAttackZoneId>","defenseZoneId":"<same as mainDefenseZoneId>","relationType":"same_focus|cross_hit|split_pressure|failed_probe|rotation_test|weak_side_hit","relationSummary":"<why zones relate>","outcomeImpact":"<how relation affected ruling>"},"decisiveEvidence":"<decisive evidence>"}}',
      "Do not include reason or judgeInference in this schema.",
      "Defender-thesis rule: the current half is judged against defenderThesisContext.defenderTeamThesis. The attacking side challenges the defender's business plan; the defending side defends or refines its own business plan. Do not treat the attacker's own thesis as the round's primary thesis.",
      "Judge scorecard v6: prefer omitting judgeScorecard entirely. Core owns the final scorecard and will materialize it from rubricProfile plus verdict facts.",
      "If you include judgeScorecard, include only a tiny judgeScorecard.teamScores hint. Never include rubricProfile, defenderThesisContext, totalScore, scoreDelta, winnerFromScore, marginFromScore, or copied input.",
      "Use the seven fixed dimensions only: objectiveScore, mapControlScore, submissionQualityScore, coordinationScore, economyAdjustedScore, riskControlScore, proofScore.",
      "If score hints are included, each score must be 0-10 and each evidence string must be at most 18 Chinese characters.",
      "Every scoring hint must explain either attack challenge quality or defense hold quality against defenderThesisContext, not generic writing quality.",
      "Evidence source values are submitted_output, team_plan, economy, zone_relation, map_semantic_context, judge_rubric_context, round_context, or combat_resolution; never use public_history as direct scoring evidence.",
      "diagnostic.attackedOpportunityGap must describe the attacker's challenge against the defender thesis. diagnostic.defendedCoreProposition must describe the defender's must-hold business claim.",
      "Use only canonical zone ids from allowedCanonicalZoneIds/defenderThesisContext; do not output zone_a, zone_a_main, zone_b, or zone_mid.",
      "Optional fields must be omitted when unknown; never return null for optional fields.",
      "margin must be exactly narrow, standard, or decisive.",
      "roundWinType must match winnerTeamId and sideAssignment.",
      "diagnostic.zoneRelation.attackZoneId must equal diagnostic.mainAttackZoneId; diagnostic.zoneRelation.defenseZoneId must equal diagnostic.mainDefenseZoneId."
    ].join("\n");
  }

  if (schemaName === "JudgeNarrativeDecision") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"reason":"<Chinese readable ruling that explains winner success and loser failure without changing verdict>","judgeInference":{"source":"judge_inference","boundary":"<combat/result details are judge inference, not agent_action raw facts>","csResolution":"<CS win method resolution>","combatNarrative":"<inferred combat/result narration consistent with verdict>","evidenceBasis":["<team_plan/agent_action/zone/economy basis>"]}}',
      "Do not include winnerTeamId, loserTeamId, mvpAgentId, roundWinType, margin, or diagnostic in this schema.",
      "reason must obey the locked verdict in the input and must not change winner, win type, MVP, attack zone, or defense zone.",
      "judgeInference.source must be exactly judge_inference."
    ].join("\n");
  }

  if (schemaName === "CombatResolutionDraft") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"roundWinType":"<same as verdict>","killEvents":[{"id":"<stable id>","actorAgentId":"<active agent id>","actorTeamId":"<team id>","targetAgentId":"<active opponent id>","targetTeamId":"<opponent team id>","zoneId":"<zone id>","atMs":8000,"impact":"<Chinese inferred combat impact>","tradeType":"opening|trade|multi_kill|clutch|exit","sourceAgentOutputIds":[]}],"plantEvent":{"type":"plant","siteZoneId":"<site zone id>","actorAgentId":"<attacker id>","actorTeamId":"<attacker team id>","atMs":42000,"text":"<Chinese text>"},"defuseEvent":{"type":"defuse","siteZoneId":"<site zone id>","actorAgentId":"<defender id>","actorTeamId":"<defender team id>","atMs":58000,"text":"<Chinese text>"},"explosionEvent":{"type":"explosion","siteZoneId":"<site zone id>","actorTeamId":"<attacker team id>","atMs":61000,"text":"<Chinese text>"},"survivors":{"teamAAgentIds":["<alive team A ids>"],"teamBAgentIds":["<alive team B ids>"]},"openingDuel":{"killEventId":"<first kill id>","actorAgentId":"<actor id>","targetAgentId":"<target id>","zoneId":"<zone id>"},"tradeSequence":[{"killEventId":"<kill id>","tradeType":"opening|trade|multi_kill|clutch|exit","summary":"<Chinese summary>"}],"clutchTag":"none|one_v_x|retake|save_denial|post_plant_hold","mvpEvidence":"<Chinese MVP evidence>","consistencyNotes":["<optional note>"]}',
      "Omit bomb event fields that are not allowed by roundWinType.",
      "No targetAgentId may appear twice. actor and target must be active opposing agents.",
      "clutchTag one_v_x is only allowed for a real one-player clutch state; otherwise use none."
    ].join("\n");
  }

  if (schemaName === "CoachTimeoutCorrection") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"teamId":"<input teamId>","triggerRoundNumber":1,"triggerReason":"<why timeout triggered>","diagnosedFailure":"<main failure>","nextRoundObjective":"<single next-round objective>","ownCoreToHold":"<what own core must hold>","opponentGapToHit":"<which opponent gap to hit>","zonePriorityShift":"<how zone priority shifts>","teamDirective":"<one team-level directive>","playerAdjustments":[{"agentId":"<active player id>","adjustment":"<one-line adjustment>"}],"expiresAfterRoundNumber":2,"confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: every field except fingerprint.",
      "playerAdjustments must include exactly one adjustment for every active player in the input activeAgents list.",
      "This is a timeout correction card, not a free-form speech transcript.",
      "Do not rewrite the team's whole strategy or map proposition. Only correct the next round.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  if (schemaName === "CoachPostMatchReview") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"teamId":"<input teamId>","matchId":"<input matchId>","keptBeliefs":["<belief>"],"brokenBeliefs":["<belief>"],"effectiveAttacks":["<attack finding>"],"effectiveDefenses":["<defense finding>"],"timeoutQualityReview":"<timeout review>","nextMatchUpgrades":["<upgrade>"],"proposedStrategyPatch":"<short patch summary>","confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: every field except fingerprint.",
      "This is a post-match review artifact for the next match, not a rewrite of the completed match facts.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  return "Output contract: return a JSON object only, using the exact top-level fields required by the named schema.";
}

async function safeReadJson(response: Response, request: LlmRequest, modelName: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LlmProviderError({
      message: "LLM provider returned non-JSON HTTP response.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName
    });
  }
}

function extractMessageContent(
  value: unknown,
  request: LlmRequest,
  modelName: string,
  usage?: LlmUsage,
  maxOutputTokens = request.maxOutputTokens
): { rawText: string; providerDiagnostics: LlmProviderDiagnostics } {
  if (!isRecord(value)) {
    throw invalidShapeError(request, modelName);
  }

  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalidShapeError(request, modelName);
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw invalidShapeError(request, modelName);
  }

  const contentValue = firstChoice.message.content;
  if (typeof contentValue !== "string" && contentValue !== null && typeof contentValue !== "undefined") {
    throw invalidShapeError(request, modelName);
  }

  const rawContent = typeof contentValue === "string" ? contentValue : "";
  const rawText = rawContent.trim();
  const reasoningContent = stringField(firstChoice.message, "reasoning_content") ?? stringField(firstChoice.message, "reasoningContent");
  const finishReason = stringField(firstChoice, "finish_reason") ?? stringField(firstChoice, "finishReason");
  const hitOutputLimit = Boolean(maxOutputTokens && usage && usage.completionTokens >= maxOutputTokens - 1);
  const reasoningContentLength = reasoningContent?.trim().length ?? 0;
  const emptyContentWithReasoning = rawText.length === 0 && reasoningContentLength > 0;
  const providerDiagnostics = compactDiagnostics({
    finishReason,
    contentLength: rawText.length,
    reasoningContentLength,
    reasoningContentPreview: previewProviderText(reasoningContent),
    emptyContentWithReasoning,
    providerResponseShape: "openai_chat_completion"
  });

  if (request.responseFormat === "json_object" && rawText.length === 0) {
    if (emptyContentWithReasoning && (hitOutputLimit || finishReason === "length")) {
      throw new LlmProviderError({
        message: "reasoning_exhausted_empty_content: LLM provider consumed output budget in reasoning_content and returned empty message content.",
        errorType: "invalid_response",
        retryable: false,
        driverModelId: request.driverModelId,
        modelName,
        rawText,
        ...(usage ? { usage } : {}),
        providerDiagnostics
      });
    }

    throw new LlmProviderError({
      message: "provider_empty_content: LLM provider returned empty message content.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName,
      rawText,
      ...(usage ? { usage } : {}),
      providerDiagnostics
    });
  }

  return { rawText, providerDiagnostics };
}

function parseJsonContent(
  rawText: string,
  request: LlmRequest,
  modelName: string,
  usage?: LlmUsage,
  maxOutputTokens = request.maxOutputTokens,
  providerDiagnostics?: LlmProviderDiagnostics
): unknown {
  const candidate = extractJsonObjectCandidate(rawText);
  try {
    return JSON.parse(candidate);
  } catch {
    const likelyTruncated = isLikelyJsonTruncation(candidate, rawText, usage, maxOutputTokens, providerDiagnostics);
    throw new LlmProviderError({
      message: likelyTruncated
        ? "json_truncated: LLM provider returned truncated JSON."
        : "LLM provider returned text that does not parse as JSON.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName,
      rawText,
      ...(usage ? { usage } : {}),
      ...(providerDiagnostics ? { providerDiagnostics } : {}),
      parseCandidate: candidate
    });
  }
}

function isLikelyJsonTruncation(
  candidate: string,
  rawText: string,
  usage: LlmUsage | undefined,
  maxOutputTokens: number | undefined,
  providerDiagnostics?: LlmProviderDiagnostics
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  const finishReason = String(providerDiagnostics?.finishReason ?? "").toLowerCase();
  const hitOutputLimit = Boolean(maxOutputTokens && usage && usage.completionTokens >= maxOutputTokens) || /length|max_tokens|token/.test(finishReason);
  return hitOutputLimit && (!trimmed.endsWith("}") || extractFirstBalancedJsonObject(stripJsonFence(rawText)) === undefined);
}

function extractUsage(value: unknown): LlmUsage {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  const promptTokens = numberField(value.usage, "prompt_tokens");
  const completionTokens = numberField(value.usage, "completion_tokens");
  const totalTokens = numberField(value.usage, "total_tokens") || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function invalidShapeError(request: LlmRequest, modelName: string): LlmProviderError {
  return new LlmProviderError({
    message: "LLM provider returned an unsupported response shape.",
    errorType: "invalid_response",
    retryable: false,
    driverModelId: request.driverModelId,
    modelName
  });
}

function isRetryableProviderError(error: unknown): error is LlmProviderError {
  return error instanceof LlmProviderError && error.retryable;
}

function shouldAttemptStructuredRepair(error: LlmProviderError, rawText: string): boolean {
  if (error.message.includes("json_truncated") || error.message.includes("reasoning_exhausted_empty_content")) {
    return false;
  }
  const trimmed = rawText.trim();
  if (trimmed.length < 8 || trimmed === "{" || trimmed === "[" || trimmed === "{}" || trimmed === "[]") {
    return false;
  }
  return true;
}

function shouldRetryWithExpandedJsonBudget(
  error: unknown,
  request: LlmRequest,
  modelName: string,
  body: Record<string, unknown>
): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }
  if (request.responseFormat !== "json_object" || !isDeepSeekReasoningModel(modelName)) {
    return false;
  }
  if (request.task === "judge_narrative" || hasDisabledThinking(body)) {
    return false;
  }
  if (!error.message.includes("reasoning_exhausted_empty_content") && !error.message.includes("json_truncated")) {
    return false;
  }

  const currentBudget = numberFromUnknown(body.max_tokens);
  return expandedJsonBudgetForTask(request.task, currentBudget) > currentBudget;
}

function hasDisabledThinking(body: Record<string, unknown>): boolean {
  const thinking = isRecord(body.thinking) ? body.thinking : undefined;
  return thinking?.type === "disabled";
}

function normalizeThinkingBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!hasDisabledThinking(body)) {
    return body;
  }
  const { reasoning_effort: _reasoningEffort, ...rest } = body;
  return rest;
}

function expandedJsonBudgetForTask(task: LlmRequest["task"], currentBudget: number): number {
  const taskFloor: Partial<Record<LlmRequest["task"], number>> = {
    team_plan: 3200,
    agent_action: 1800,
    judge: 2200,
    judge_verdict: 2200,
    judge_narrative: 1600,
    judge_review: 2200,
    combat_resolution: 2200,
    coach_timeout: 1600
  };
  const hardCap = 3600;
  const expanded = Math.max(taskFloor[task] ?? 1600, currentBudget * 2, currentBudget + 400);
  return Math.min(expanded, hardCap);
}

function repairBudgetForTask(task: LlmRequest["task"], requestedBudget: number): number {
  const taskBudget: Partial<Record<LlmRequest["task"], number>> = {
    team_plan: 1600,
    agent_action: 1400,
    judge: 1600,
    judge_verdict: 1600,
    judge_narrative: 1200,
    judge_review: 1600,
    combat_resolution: 1600,
    coach_timeout: 1400,
    coach_post_match_review: 1800
  };
  const fallback = taskBudget[task] ?? 1400;
  if (requestedBudget <= 0) {
    return fallback;
  }
  return Math.max(1200, Math.min(fallback, requestedBudget));
}

function buildModelExtraParams(input: {
  modelName: string;
  reasoningMode: ReasoningMode;
  reasoningEffort: ReasoningEffort;
  repair: boolean;
}): Record<string, unknown> {
  if (!isDeepSeekReasoningModel(input.modelName)) {
    return {};
  }

  const mode = input.repair ? "disabled" : input.reasoningMode;
  if (mode === "disabled") {
    return {
      thinking: { type: "disabled" }
    };
  }
  if (mode === "enabled") {
    return {
      thinking: { type: "enabled" },
      reasoning_effort: input.reasoningEffort
    };
  }
  return {};
}

function repairHardConstraintsForRequest(request: LlmRequest): string {
  if (request.schemaName !== "TeamRoundPlanDecision") {
    return "Hard constraints: keep existing ids exactly when present. Do not invent new team, player, zone, or enum ids.";
  }

  const input = isRecord(request.input) ? request.input : {};
  const activeAgents = Array.isArray(input.activeAgents) ? input.activeAgents : [];
  const allowedAgentIds = activeAgents
    .map((agent) => (isRecord(agent) && typeof agent.id === "string" ? agent.id : undefined))
    .filter((id): id is string => Boolean(id));
  const allowedZoneIds = collectAllowedZoneIds(input);
  const constraints = compactObject({
    teamId: typeof input.teamId === "string" ? input.teamId : undefined,
    side: typeof input.side === "string" ? input.side : undefined,
    allowedAgentIds,
    allowedZoneIds
  });

  return [
    "Hard constraints for TeamRoundPlanDecision:",
    JSON.stringify(constraints),
    "Every playerDirectives[].agentId must be copied exactly from allowedAgentIds.",
    "Never use player1, player2, agent1, agent2, star_rifler, role names, display names, or invented ids."
  ].join("\n");
}

function collectAllowedZoneIds(input: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const pushString = (value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.push(value.trim());
    }
  };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key.toLowerCase().includes("zoneid") || key.toLowerCase() === "id") {
        pushString(entry);
      } else if (key.toLowerCase().includes("zone") || key === "mapSemanticContext") {
        visit(entry, depth + 1);
      }
    }
  };
  visit(input, 0);
  return [...new Set(candidates)].slice(0, 12);
}

function isDeepSeekReasoningModel(modelName: string): boolean {
  return modelName.trim().toLowerCase().includes("deepseek");
}

function numberFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : isRecord(error) && error.name === "AbortError";
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function extractJsonObjectCandidate(value: string): string {
  const trimmed = stripJsonFence(value);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const extracted = extractFirstBalancedJsonObject(trimmed);
  return extracted ?? trimmed;
}

function extractFirstBalancedJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1).trim();
      }
    }
  }

  return undefined;
}

function combineUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function previewProviderText(value: string | undefined): string | undefined {
  const sanitized = sanitizeProviderText(value ?? "").trim();
  if (!sanitized) {
    return undefined;
  }
  return sanitized.length > 800 ? `${sanitized.slice(0, 800)}...` : sanitized;
}

function compactDiagnostics(value: Record<string, unknown>): LlmProviderDiagnostics {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined")) as LlmProviderDiagnostics;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
