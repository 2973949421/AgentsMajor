export type NodeLabMapVariant = "draft" | "official";
export type NodeLabProviderMode = "fixture" | "real";
export type NodeLabScope = "round" | "map";

export interface NodeLabRunRequest {
  scope?: NodeLabScope;
  providerMode?: NodeLabProviderMode;
  mapGameId?: string;
  maxRounds?: number;
  maxLlmCalls?: number;
}

export interface NodeLabRunResult {
  ok: false;
  error: string;
  retired: true;
  replacementPath: "/hex-lab/match";
}

export function normalizeNodeLabRunRequest(_input: unknown): NodeLabRunRequest {
  return {};
}

export async function runNodeLab(_input: NodeLabRunRequest = {}): Promise<NodeLabRunResult> {
  return retiredNodeLabResult();
}

export async function readNodeLabProgress(): Promise<NodeLabRunResult> {
  return retiredNodeLabResult();
}

export function retiredNodeLabResult(): NodeLabRunResult {
  return {
    ok: false,
    error: "Node Lab 已退役。请使用 /hex-lab/match 进行 HexGrid 验收。",
    retired: true,
    replacementPath: "/hex-lab/match"
  };
}
