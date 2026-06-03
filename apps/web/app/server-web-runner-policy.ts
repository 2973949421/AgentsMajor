import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { findProjectRoot } from "./server-project-root";
import { loadRootLocalEnv, type EnvRecord } from "./server-local-env";
import type { WebRunMode } from "./server-run-progress";

export type WebRunnerDisabledReason =
  | "web_runner_disabled"
  | "web_runner_production_disabled"
  | "web_runner_production_requires_token"
  | "web_runner_remote_requires_token";

export interface PublicWebRunnerPolicy {
  enabled: boolean;
  disabledReason?: WebRunnerDisabledReason;
  requiresToken: boolean;
  allowRemote: boolean;
}

interface PrivateWebRunnerPolicy extends PublicWebRunnerPolicy {
  adminToken?: string;
}

export interface WebRunnerRequestBody {
  action?: unknown;
  mode?: unknown;
  retryMode?: unknown;
  resetScope?: unknown;
  confirmReset?: unknown;
  adminToken?: unknown;
  runId?: unknown;
}

export type WebRunnerRequestValidation =
  | { ok: true; action: "run"; mode: WebRunMode; retryMode: WebRunRetryMode }
  | { ok: true; action: "reset"; resetScope: WebRunResetScope }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type WebRunResetScope = "round" | "map" | "match";
export type WebRunRetryMode = "full_round" | "resume_from_stage";

export type WebRunnerAccessValidation =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function getPublicWebRunnerPolicy(
  projectRoot = findProjectRoot(process.cwd()),
  baseEnv: EnvRecord = process.env
): PublicWebRunnerPolicy {
  const policy = loadPrivateWebRunnerPolicy(projectRoot, baseEnv);
  return {
    enabled: policy.enabled,
    ...(policy.disabledReason ? { disabledReason: policy.disabledReason } : {}),
    requiresToken: policy.requiresToken,
    allowRemote: policy.allowRemote
  };
}

export function validateWebRunnerRequest(
  request: Request,
  body: WebRunnerRequestBody,
  projectRoot = findProjectRoot(process.cwd()),
  baseEnv: EnvRecord = process.env
): WebRunnerRequestValidation {
  const access = validateWebRunnerAccess(request, body, projectRoot, baseEnv);
  if (!access.ok) {
    return access;
  }

  if (body.confirmReset !== true) {
    return {
      ok: false,
      status: 400,
      error: "Web runner requires explicit confirmReset=true because Phase runs may reset completed local fixtures."
    };
  }

  const action = parseAction(body.action);
  if (action === "reset") {
    const resetScope = parseResetScope(body.resetScope);
    if (!resetScope) {
      return { ok: false, status: 400, error: "Unsupported reset scope." };
    }
    return { ok: true, action, resetScope };
  }

  const mode = parseMode(body.mode);
  if (!mode) {
    return { ok: false, status: 400, error: "Unsupported run mode." };
  }

  return { ok: true, action: "run", mode, retryMode: parseRetryMode(body.retryMode) };
}

export function validateWebRunnerAccess(
  request: Request,
  body: Pick<WebRunnerRequestBody, "adminToken">,
  projectRoot = findProjectRoot(process.cwd()),
  baseEnv: EnvRecord = process.env
): WebRunnerAccessValidation {
  const policy = loadPrivateWebRunnerPolicy(projectRoot, baseEnv);
  if (!policy.enabled) {
    return {
      ok: false,
      status: 403,
      error: `Web runner is disabled: ${policy.disabledReason ?? "not_allowed"}.`
    };
  }

  if (!policy.allowRemote && !isLocalRequest(request)) {
    return {
      ok: false,
      status: 403,
      error: "Web runner only accepts localhost requests unless AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE=true."
    };
  }

  if (policy.adminToken && !tokenMatches(policy.adminToken, getRequestToken(request, body))) {
    return { ok: false, status: 401, error: "Invalid web runner token." };
  }

  return { ok: true };
}

function parseAction(value: unknown): "run" | "reset" {
  return value === "reset" ? "reset" : "run";
}

function parseMode(value: unknown): WebRunMode | null {
  if (
    value === "phase17_showcase_match" ||
    value === "phase18_next_round" ||
    value === "phase18_current_map" ||
    value === "phase18_keep_generating_map" ||
    value === "phase18_full_bo3"
  ) {
    return value;
  }

  return null;
}

function parseRetryMode(value: unknown): WebRunRetryMode {
  return value === "resume_from_stage" ? "resume_from_stage" : "full_round";
}

function parseResetScope(value: unknown): WebRunResetScope | null {
  if (value === "round" || value === "map" || value === "match") {
    return value;
  }

  return null;
}

function loadPrivateWebRunnerPolicy(projectRoot: string, baseEnv: EnvRecord): PrivateWebRunnerPolicy {
  const env = loadRootLocalEnv(projectRoot, baseEnv);
  const enabled = isTruthy(env.AGENT_MAJOR_WEB_RUNNER_ENABLED);
  const allowProduction = isTruthy(env.AGENT_MAJOR_WEB_RUNNER_ALLOW_PRODUCTION);
  const allowRemote = isTruthy(env.AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE);
  const adminToken = env.AGENT_MAJOR_WEB_RUNNER_TOKEN?.trim() || undefined;
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();

  if (!enabled) {
    return disabledPolicy("web_runner_disabled", adminToken, allowRemote);
  }

  if (nodeEnv === "production" && !allowProduction) {
    return disabledPolicy("web_runner_production_disabled", adminToken, allowRemote);
  }

  if (nodeEnv === "production" && !adminToken) {
    return disabledPolicy("web_runner_production_requires_token", adminToken, allowRemote);
  }

  if (allowRemote && !adminToken) {
    return disabledPolicy("web_runner_remote_requires_token", adminToken, allowRemote);
  }

  return {
    enabled: true,
    requiresToken: Boolean(adminToken),
    allowRemote,
    ...(adminToken ? { adminToken } : {})
  };
}

function disabledPolicy(
  disabledReason: WebRunnerDisabledReason,
  adminToken: string | undefined,
  allowRemote: boolean
): PrivateWebRunnerPolicy {
  return {
    enabled: false,
    disabledReason,
    requiresToken: Boolean(adminToken),
    allowRemote
  };
}

function getRequestToken(request: Request, body: WebRunnerRequestBody): string | undefined {
  const bodyToken = typeof body.adminToken === "string" ? body.adminToken.trim() : "";
  if (bodyToken) {
    return bodyToken;
  }

  const headerToken = request.headers.get("x-agent-major-run-token")?.trim();
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get("authorization")?.trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return match?.[1]?.trim();
}

function tokenMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function isLocalRequest(request: Request): boolean {
  const requestUrl = safeUrl(request.url);
  const hostHeader = request.headers.get("host");
  const originHeader = request.headers.get("origin");
  const requestHostLocal = isLocalHostname(requestUrl?.hostname) || isLocalHostname(hostHeaderToHostname(hostHeader));
  const originLocal = !originHeader || isLocalHostname(safeUrl(originHeader)?.hostname);
  return requestHostLocal && originLocal;
}

function hostHeaderToHostname(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("[")) {
    const closingIndex = value.indexOf("]");
    return closingIndex > 1 ? value.slice(1, closingIndex) : undefined;
  }

  return value.split(":")[0];
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLocalHostname(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
