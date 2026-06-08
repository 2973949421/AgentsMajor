import type { LlmGateway } from "@agent-major/llm";
import type {
  Agent,
  AgentActionDecision,
  AgentOutput,
  MapGame,
  Match,
  Round,
  Team,
  TeamRoundPlanDecision
} from "@agent-major/shared";

import type { RoundRetryMode } from "./engine.js";
import type { AgentBuyDecision, TeamEconomyPlan } from "../economy/economy-output-service.js";
import type { LlmStageRunner } from "../llm/llm-stage-runner.js";
import type { SideContext } from "../match/map-rules.js";

export interface AgentActionPipelineCoachTimeout {
  teamId: string;
  correction: {
    playerAdjustments: Array<{ agentId: string; adjustment: string }>;
  };
}

export interface AgentActionPipelineInput {
  match: Match;
  agents: Agent[];
  round: Round;
  observabilityAttempt: number;
  mapGame: MapGame;
  sideContext: SideContext;
  teamA: Team;
  teamB: Team;
  buyDecisionByAgent: Map<string, AgentBuyDecision>;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  coachTimeout?: AgentActionPipelineCoachTimeout;
  retryMode?: RoundRetryMode | undefined;
  stageRunner: LlmStageRunner;
  llmGateway: LlmGateway;
  useLlmAgentActions?: boolean | undefined;
}

export interface AgentActionSideInput {
  agent: Agent;
}

export interface AgentActionPipelineDependencies {
  buildRequestInput(input: AgentActionPipelineInput & AgentActionSideInput): unknown | Promise<unknown>;
  validateResponseData(data: unknown): AgentActionDecision;
  buildFallbackAction(input: AgentActionPipelineInput & AgentActionSideInput & { responseData: { fingerprint?: string } }): AgentActionDecision;
  normalizeActionDecision(decision: AgentActionDecision): AgentActionDecision;
  buildOutput(input: AgentActionPipelineInput & AgentActionSideInput & { actionDetail: AgentActionDecision; fingerprint?: string }): AgentOutput;
}

const llmThinkingDisabledParams = {
  thinking: { type: "disabled" }
} satisfies Record<string, unknown>;

export async function runAgentActionPipeline(
  input: AgentActionPipelineInput,
  dependencies: AgentActionPipelineDependencies
): Promise<AgentOutput[]> {
  const outputs: AgentOutput[] = [];
  for (const agent of input.agents) {
    const sideInput = { ...input, agent } satisfies AgentActionPipelineInput & AgentActionSideInput;
    const requestInput = await dependencies.buildRequestInput(sideInput);
    const response = input.useLlmAgentActions
      ? await input.stageRunner.runStructuredStage<AgentActionDecision>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_agent_${safeId(agent.id)}_agent_action`,
          stageId: `agent_action:${agent.id}`,
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "agent_action",
          schemaName: "AgentActionDecision",
          driverModelId: agent.driverModelId,
          requestInput,
          responseFormat: "json_object",
          seed: `${input.round.id}:${agent.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 1400,
          extraParams: llmThinkingDisabledParams,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.round.roundNumber,
          agent,
          validateResponseData: dependencies.validateResponseData
        })
      : await input.llmGateway.generateStructured<{ fingerprint?: string }, unknown>({
          task: "agent_action",
          driverModelId: agent.driverModelId,
          input: requestInput,
          schemaName: "AgentOutput",
          seed: `${input.round.id}:${agent.id}`,
          modelTier: "cheap",
          temperature: 0
        });
    const responseData = response.data as AgentActionDecision & { fingerprint?: string };
    const fallbackAction = dependencies.buildFallbackAction({
      ...sideInput,
      responseData
    });
    const actionDetail = dependencies.normalizeActionDecision(input.useLlmAgentActions ? responseData : fallbackAction);
    outputs.push(
      dependencies.buildOutput({
        ...sideInput,
        actionDetail,
        ...(responseData.fingerprint ? { fingerprint: responseData.fingerprint } : {})
      })
    );
  }

  return outputs;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
