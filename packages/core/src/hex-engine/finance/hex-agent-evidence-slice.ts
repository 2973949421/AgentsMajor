import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HexAgentEconomyContext, HexRoundEconomyContext } from "../economy/index.js";
import type { HexSide } from "../state/index.js";
import type { HexFinanceScoreCap, HexRoundFinanceDuel } from "./hex-round-finance-duel.js";

export type HexFinanceRole =
  | "portfolio_manager"
  | "macro_strategy"
  | "commodity_supply_demand"
  | "company_modeling"
  | "risk_trading";

export type HexFinanceRoleSource =
  | "team_finance_roster"
  | "agent_finance_role"
  | "cs_role_fallback"
  | "roster_slot_fallback";

export interface HexFinanceFactBankFact {
  factId: string;
  statementZh: string;
  metricName: string;
  source: string;
  sourceType?: string;
  collector?: string;
  evidenceId?: string;
  confidence?: number;
  dataMode: string;
  commodity?: string;
  companyName?: string;
  primaryExposure?: string;
  unavailableReason?: string;
}

export interface HexFinanceFactBankSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  parserVersion: string;
  mapBindingId: string;
  financeMapSlug: string;
  dataMode: string;
  facts: HexFinanceFactBankFact[];
}

export interface HexFinanceTeamProfile {
  teamId?: string;
  teamSlug?: string;
  displayName?: string;
  financeAgentRoster?: Array<{
    agentSlug?: string;
    financeRole?: string;
    financeRoleCn?: string;
    responsibility?: string;
  }>;
  financeProfile?: {
    coachDoctrine?: string;
  };
  teamCore?: {
    coachDoctrine?: string;
  };
}

export interface HexAgentEvidenceSlice {
  sliceId: string;
  agentId: string;
  teamId: string;
  side: HexSide;
  financeRole: HexFinanceRole;
  financeRoleCn: string;
  roleSource: HexFinanceRoleSource;
  roleFallbackReason?: string;
  roleQuestionZh: string;
  usableFactsZh: string[];
  evidenceRefs: string[];
  missingEvidenceZh: string[];
  scoreCapRefs: string[];
  actionBoundaryZh: string;
  coachConstraintZh: string;
}

export interface BuildHexAgentEvidenceSlicesInput {
  financeDuel: HexRoundFinanceDuel;
  agents: Array<{
    agentId: string;
    teamId: string;
    side: HexSide;
    displayName?: string | undefined;
    role?: string | undefined;
    roleLabel?: string | undefined;
  }>;
  economyContext?: HexRoundEconomyContext | undefined;
  factBank?: HexFinanceFactBankSnapshot | undefined;
  teamProfiles?: HexFinanceTeamProfile[] | undefined;
  workspaceRoot?: string | undefined;
}

const financeRoleLabels: Record<HexFinanceRole, string> = {
  portfolio_manager: "组合经理",
  macro_strategy: "宏观策略专家",
  commodity_supply_demand: "供需 / 商品专家",
  company_modeling: "公司 / 财务建模专家",
  risk_trading: "风控 / 交易专家"
};

const rosterFallbackRoles: HexFinanceRole[] = [
  "portfolio_manager",
  "macro_strategy",
  "commodity_supply_demand",
  "company_modeling",
  "risk_trading"
];

let cachedDefaultFactBank: HexFinanceFactBankSnapshot | undefined;
let cachedDefaultTeamProfiles: HexFinanceTeamProfile[] | undefined;

export function buildHexAgentEvidenceSlices(input: BuildHexAgentEvidenceSlicesInput): HexAgentEvidenceSlice[] {
  const factBank = input.factBank ?? loadDefaultFinanceFactBank(input.workspaceRoot);
  const teamProfiles = input.teamProfiles ?? loadDefaultFinanceTeamProfiles(input.workspaceRoot);
  const teamAgentIndexes = new Map<string, number>();
  return input.agents.map((agent) => {
    const teamIndex = teamAgentIndexes.get(agent.teamId) ?? 0;
    teamAgentIndexes.set(agent.teamId, teamIndex + 1);
    const role = resolveHexFinanceRole({ agent, teamIndex, teamProfiles });
    const facts = selectFactsForRole(role.financeRole, factBank, input.financeDuel);
    const economy = input.economyContext?.agents.find((candidate) => candidate.agentId === agent.agentId);
    const scoreCaps = selectScoreCapsForRole(role.financeRole, input.financeDuel.evidence.scoreCaps);
    const missingEvidence = selectMissingEvidenceForRole(role.financeRole, input.financeDuel, factBank);
    const teamProfile = findTeamProfile(teamProfiles, agent.teamId);
    const coachConstraintZh = getCoachConstraintZh(teamProfile);
    return {
      sliceId: `finance_slice_${input.financeDuel.roundNumber}_${agent.agentId}`,
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      financeRole: role.financeRole,
      financeRoleCn: role.financeRoleCn,
      roleSource: role.roleSource,
      ...(role.roleFallbackReason ? { roleFallbackReason: role.roleFallbackReason } : {}),
      roleQuestionZh: buildRoleQuestionZh({
        role: role.financeRole,
        side: agent.side,
        financeDuel: input.financeDuel,
        economy
      }),
      usableFactsZh: facts.map((fact) => fact.statementZh).slice(0, 3),
      evidenceRefs: facts.map((fact) => fact.evidenceId ?? fact.factId).slice(0, 5),
      missingEvidenceZh: missingEvidence.slice(0, 4),
      scoreCapRefs: scoreCaps.map((cap) => `${cap.condition}: ${cap.reason}`).slice(0, 3),
      actionBoundaryZh: buildActionBoundaryZh({
        role: role.financeRole,
        side: agent.side,
        economy
      }),
      coachConstraintZh
    };
  });
}

export function resolveHexFinanceRole(input: {
  agent: BuildHexAgentEvidenceSlicesInput["agents"][number];
  teamIndex?: number | undefined;
  teamProfiles?: HexFinanceTeamProfile[] | undefined;
}): {
  financeRole: HexFinanceRole;
  financeRoleCn: string;
  roleSource: HexFinanceRoleSource;
  roleFallbackReason?: string;
} {
  const teamProfile = findTeamProfile(input.teamProfiles ?? [], input.agent.teamId);
  const rosterRole = resolveRoleFromTeamRoster(input.agent, teamProfile);
  if (rosterRole) {
    return {
      financeRole: rosterRole.financeRole,
      financeRoleCn: rosterRole.financeRoleCn,
      roleSource: "team_finance_roster"
    };
  }
  const directRole = normalizeFinanceRole(input.agent.roleLabel ?? input.agent.role);
  if (directRole && isExplicitFinanceRole(input.agent.roleLabel ?? input.agent.role)) {
    return {
      financeRole: directRole,
      financeRoleCn: financeRoleLabels[directRole],
      roleSource: "agent_finance_role"
    };
  }
  const csRole = normalizeCsRole(input.agent.roleLabel ?? input.agent.role);
  if (csRole) {
    return {
      financeRole: csRole,
      financeRoleCn: financeRoleLabels[csRole],
      roleSource: "cs_role_fallback",
      roleFallbackReason: `由 CS 角色 ${input.agent.roleLabel ?? input.agent.role} 推断金融专家职责。`
    };
  }
  const fallbackRole = rosterFallbackRoles[(input.teamIndex ?? 0) % rosterFallbackRoles.length]!;
  return {
    financeRole: fallbackRole,
    financeRoleCn: financeRoleLabels[fallbackRole],
    roleSource: "roster_slot_fallback",
    roleFallbackReason: `未识别金融角色或 CS 角色，按队内顺序分配 ${financeRoleLabels[fallbackRole]}。`
  };
}

export function loadDefaultFinanceFactBank(workspaceRoot?: string): HexFinanceFactBankSnapshot | undefined {
  if (cachedDefaultFactBank) {
    return cachedDefaultFactBank;
  }
  const root = workspaceRoot ?? findWorkspaceRoot(process.cwd());
  const absolutePath = join(root, "data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json");
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  cachedDefaultFactBank = JSON.parse(readFileSync(absolutePath, "utf8")) as HexFinanceFactBankSnapshot;
  return cachedDefaultFactBank;
}

function loadDefaultFinanceTeamProfiles(workspaceRoot?: string): HexFinanceTeamProfile[] {
  if (cachedDefaultTeamProfiles) {
    return cachedDefaultTeamProfiles;
  }
  const root = workspaceRoot ?? findWorkspaceRoot(process.cwd());
  const teamsRoot = join(root, "data/materials/processed/teams");
  if (!existsSync(teamsRoot)) {
    return [];
  }
  cachedDefaultTeamProfiles = readdirSync(teamsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(teamsRoot, entry.name, "initial-proposal.json"))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as HexFinanceTeamProfile);
  return cachedDefaultTeamProfiles;
}

function resolveRoleFromTeamRoster(
  agent: BuildHexAgentEvidenceSlicesInput["agents"][number],
  teamProfile: HexFinanceTeamProfile | undefined
): { financeRole: HexFinanceRole; financeRoleCn: string } | undefined {
  for (const item of teamProfile?.financeAgentRoster ?? []) {
    const slug = normalizeKey(item.agentSlug);
    if (!slug) continue;
    const agentKeys = [
      normalizeKey(agent.displayName),
      normalizeKey(agent.agentId)
    ];
    if (agentKeys.some((key) => key.includes(slug))) {
      const financeRole = normalizeFinanceRole(item.financeRole);
      if (financeRole) {
        return {
          financeRole,
          financeRoleCn: item.financeRoleCn?.trim() || financeRoleLabels[financeRole]
        };
      }
    }
  }
  return undefined;
}

function selectFactsForRole(
  role: HexFinanceRole,
  factBank: HexFinanceFactBankSnapshot | undefined,
  financeDuel: HexRoundFinanceDuel
): HexFinanceFactBankFact[] {
  const facts = factBank?.facts ?? [];
  const fred = facts.filter((fact) => fact.source.toUpperCase() === "FRED" && fact.dataMode === "offline_observation_fact");
  const bao = facts.filter((fact) => fact.source.toUpperCase() === "BAOSTOCK" && fact.dataMode === "offline_observation_fact");
  const un = facts.filter((fact) => fact.source.toUpperCase() === "UN_COMTRADE");
  if (role === "portfolio_manager") {
    return [...fred.slice(0, 2), ...bao.slice(0, 2), ...fallbackPromptFacts(financeDuel).slice(0, 1)];
  }
  if (role === "macro_strategy") {
    return fred.length > 0 ? fred.slice(0, 4) : fallbackPromptFacts(financeDuel).slice(0, 2);
  }
  if (role === "commodity_supply_demand") {
    return [...un.slice(0, 3), ...fred.slice(0, 2), ...fallbackPromptFacts(financeDuel).slice(0, 1)];
  }
  if (role === "company_modeling") {
    return bao.length > 0 ? bao.slice(0, 5) : fallbackPromptFacts(financeDuel).slice(0, 2);
  }
  return [...un.slice(0, 2), ...fallbackScoreCapFacts(financeDuel).slice(0, 2), ...bao.slice(0, 1)];
}

function selectMissingEvidenceForRole(
  role: HexFinanceRole,
  financeDuel: HexRoundFinanceDuel,
  factBank: HexFinanceFactBankSnapshot | undefined
): string[] {
  const unavailable = (factBank?.facts ?? [])
    .filter((fact) => fact.dataMode === "unavailable_observation")
    .map((fact) => fact.statementZh);
  const base = financeDuel.evidence.missingEvidence.map((item) => `缺失证据：${item}`);
  if (role === "commodity_supply_demand" || role === "risk_trading") {
    return [...unavailable, ...base];
  }
  if (role === "company_modeling") {
    return base.filter((item) => /公司|财报|利润|估值|现金流/.test(item));
  }
  if (role === "macro_strategy") {
    return base.filter((item) => /宏观|美元|利率|库存|现货|价格/.test(item));
  }
  return base;
}

function selectScoreCapsForRole(role: HexFinanceRole, caps: HexFinanceScoreCap[]): HexFinanceScoreCap[] {
  if (role === "risk_trading") {
    return caps;
  }
  if (role === "commodity_supply_demand") {
    return caps.filter((cap) => /库存|贸易|供需|代理|proxy/i.test(`${cap.condition} ${cap.reason}`));
  }
  if (role === "company_modeling") {
    return caps.filter((cap) => /公司|财报|估值|盈利/i.test(`${cap.condition} ${cap.reason}`));
  }
  return caps.slice(0, 2);
}

function buildRoleQuestionZh(input: {
  role: HexFinanceRole;
  side: HexSide;
  financeDuel: HexRoundFinanceDuel;
  economy?: HexAgentEconomyContext | undefined;
}): string {
  const sideVerb = input.side === "defense" ? "形成并守住有限投资立场" : "挑战具体主张和证据链断点";
  const target = input.financeDuel.decisionQuestion.question;
  const buy = input.economy ? `当前买型 ${input.economy.buyType}，` : "";
  if (input.role === "portfolio_manager") {
    return `${buy}围绕决策题“${target}”，判断是否能形成可执行配置强度，并${sideVerb}。`;
  }
  if (input.role === "macro_strategy") {
    return `${buy}用全球价格和宏观周期线索检验决策题是否有方向基础。`;
  }
  if (input.role === "commodity_supply_demand") {
    return `${buy}专门检查供需、贸易或库存线索是否足以支撑某个允许立场。`;
  }
  if (input.role === "company_modeling") {
    return `${buy}把决策题落到代表公司行情、估值和利润弹性代理。`;
  }
  return `${buy}专门寻找反证、scoreCaps、止损和仓位降级边界；缺失证据只能降权，不能直接赢。`;
}

function buildActionBoundaryZh(input: {
  role: HexFinanceRole;
  side: HexSide;
  economy?: HexAgentEconomyContext | undefined;
}): string {
  const sideText = input.side === "defense" ? "作为立场方优先保护已声明的证据边界" : "作为挑战方优先验证对方主张的薄弱环节";
  const resourceText = input.economy
    ? `资源层级 ${input.economy.resourceTier}，本阶段行动不能超过买型允许的论证强度。`
    : "经济上下文未记录，按保守论证强度处理。";
  if (input.role === "risk_trading") {
    return `${sideText}；重点暴露不可证实、不可执行或仓位过重的结论。${resourceText}`;
  }
  if (input.role === "company_modeling") {
    return `${sideText}；重点把观点落到公司和估值代理，不允许直接声称完整基本面确认。${resourceText}`;
  }
  return `${sideText}；行动理由必须引用本证据切片，不要重写整段金融论点。${resourceText}`;
}

function getCoachConstraintZh(teamProfile: HexFinanceTeamProfile | undefined): string {
  return teamProfile?.financeProfile?.coachDoctrine
    ?? teamProfile?.teamCore?.coachDoctrine
    ?? "教练纪律未记录；默认要求区分可观察事实、推断结论和缺失证据。";
}

function findTeamProfile(teamProfiles: HexFinanceTeamProfile[], teamId: string): HexFinanceTeamProfile | undefined {
  const normalizedTeamId = normalizeKey(teamId);
  return teamProfiles.find((profile) => {
    const candidates = [
      normalizeKey(profile.teamId),
      normalizeKey(profile.teamSlug),
      normalizeKey(profile.displayName)
    ].filter(Boolean);
    return candidates.some((candidate) => normalizedTeamId.includes(candidate) || candidate.includes(normalizedTeamId));
  });
}

function normalizeFinanceRole(value: unknown): HexFinanceRole | undefined {
  const text = normalizeKey(value);
  if (!text) return undefined;
  if (text.includes("portfolio") || text.includes("pm") || text.includes("igl") || text.includes("combination") || text.includes("组合")) return "portfolio_manager";
  if (text.includes("macro") || text.includes("strategy") || text.includes("awper") || text.includes("宏观")) return "macro_strategy";
  if (text.includes("commodity") || text.includes("supply") || text.includes("demand") || text.includes("entry") || text.includes("供需") || text.includes("商品")) return "commodity_supply_demand";
  if (text.includes("company") || text.includes("model") || text.includes("star") || text.includes("rifler") || text.includes("公司") || text.includes("建模")) return "company_modeling";
  if (text.includes("risk") || text.includes("trading") || text.includes("support") || text.includes("lurker") || text.includes("风控") || text.includes("交易")) return "risk_trading";
  return undefined;
}

function normalizeCsRole(value: unknown): HexFinanceRole | undefined {
  const text = normalizeKey(value);
  if (!text) return undefined;
  if (text.includes("igl")) return "portfolio_manager";
  if (text.includes("awper") || text.includes("awp")) return "macro_strategy";
  if (text.includes("entry")) return "commodity_supply_demand";
  if (text.includes("star") || text.includes("rifler")) return "company_modeling";
  if (text.includes("support") || text.includes("lurker")) return "risk_trading";
  return undefined;
}

function isExplicitFinanceRole(value: unknown): boolean {
  const text = normalizeKey(value);
  return /portfolio|macro|commodity|supply|demand|company|model|risk|trading|组合|宏观|供需|商品|公司|建模|风控|交易/.test(text);
}

function fallbackPromptFacts(financeDuel: HexRoundFinanceDuel): HexFinanceFactBankFact[] {
  return financeDuel.evidence.promptFacts.map((fact) => ({
    factId: fact.factId,
    statementZh: fact.shortText,
    metricName: "round_prompt_fact",
    source: "FINANCE_EVIDENCE_PACK",
    evidenceId: fact.evidenceId,
    dataMode: "configured_proxy_fact"
  }));
}

function fallbackScoreCapFacts(financeDuel: HexRoundFinanceDuel): HexFinanceFactBankFact[] {
  return financeDuel.evidence.scoreCaps.map((cap, index) => ({
    factId: `SCORECAP${index + 1}`,
    statementZh: `评分上限：${cap.condition}，最高 ${cap.maxScore}。原因：${cap.reason}`,
    metricName: "score_cap",
    source: "FINANCE_EVIDENCE_POLICY",
    evidenceId: `SCORECAP:${cap.condition}`,
    dataMode: "score_cap"
  }));
}

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "") : "";
}

function findWorkspaceRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
  return resolve(startDirectory);
}
