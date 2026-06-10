"use client";

import type {
  HexMatchLabPhaseSummary,
  HexMatchLabRoundTraceDetail
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

type AuditTab = "llm" | "combat" | "economy" | "winner" | "raw";

interface HexMatchAuditDrawerProps {
  open: boolean;
  tab: AuditTab;
  trace?: HexMatchLabRoundTraceDetail | undefined;
  phase?: HexMatchLabPhaseSummary | undefined;
  onTabChange: (tab: AuditTab) => void;
  onClose: () => void;
}

export function HexMatchAuditDrawer(props: HexMatchAuditDrawerProps) {
  if (!props.open) return null;
  return (
    <aside className={styles.auditDrawer} aria-label="Hex 审计详情">
      <div className={styles.drawerHeader}>
        <div>
          <span>Audit drawer</span>
          <h2>LLM / Combat / Economy / Hard Winner 审计</h2>
        </div>
        <button type="button" onClick={props.onClose}>关闭</button>
      </div>

      <div className={styles.drawerTabs}>
        {(["llm", "combat", "economy", "winner", "raw"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={props.tab === tab ? styles.drawerTabActive : styles.drawerTab}
            onClick={() => props.onTabChange(tab)}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      <div className={styles.drawerBody}>
        {props.tab === "llm" ? <LlmAudit trace={props.trace} phase={props.phase} /> : null}
        {props.tab === "combat" ? <CombatAudit phase={props.phase} /> : null}
        {props.tab === "economy" ? <EconomyAudit trace={props.trace} /> : null}
        {props.tab === "winner" ? <WinnerAudit trace={props.trace} phase={props.phase} /> : null}
        {props.tab === "raw" ? <RawAudit trace={props.trace} phase={props.phase} /> : null}
      </div>
    </aside>
  );
}

function LlmAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  const audit = props.phase?.llmAudit ?? props.trace?.audit;
  if (!audit) return <p className={styles.emptyInline}>暂无 LLM audit。</p>;
  return (
    <div className={styles.auditStack}>
      <MetricLine label="provider" value={audit.providerMode ?? "unknown"} />
      <MetricLine label="model" value={audit.modelId ?? "未记录"} />
      <MetricLine label="expected / attempted" value={`${audit.expectedCalls} / ${audit.totalLlmCallsAttempted}`} />
      <MetricLine label="accepted / rejected / fallback" value={`${audit.acceptedDrafts} / ${audit.rejectedDrafts} / ${audit.fallbackCount}`} />
      <MetricLine label="request artifacts" value={audit.requestArtifactIds.join(", ") || "当前 trace 未记录"} />
      <MetricLine label="response artifacts" value={audit.responseArtifactIds.join(", ") || "当前 trace 未记录"} />
      <MetricLine label="repaired fields" value={audit.repairedFields.join(", ") || "无"} />
      <MetricLine label="fallback reasons" value={audit.fallbackReasons.join("; ") || "无"} />
      <MetricLine label="provider errors" value={audit.providerErrors.join("; ") || "无"} />
      <p className={styles.guardText}>
        如果 real LLM 被 rejected，这里会显示具体原因。模型输出不会直接进入事实层；winner、kill、damage、economyDelta 都由代码裁定。
      </p>
    </div>
  );
}

function CombatAudit(props: { phase: HexMatchLabPhaseSummary | undefined }) {
  const combats = props.phase?.combats ?? [];
  return (
    <div className={styles.auditStack}>
      {combats.map((combat) => (
        <article key={combat.contactId} className={styles.auditCard}>
          <h3>{combat.contactId}</h3>
          <p>{combat.advantage ?? "unknown"} / {combat.verdict ?? "no verdict"}</p>
          <p>participants: {combat.participants.join(", ")}</p>
          <p>casualties: {combat.casualties.join(", ") || "none"}</p>
          <p>suppression: {combat.suppressions.join(", ") || "none"}</p>
          <p>business A/D {combat.businessScoreAttack ?? 0}/{combat.businessScoreDefense ?? 0}; CS A/D {combat.csScoreAttack ?? 0}/{combat.csScoreDefense ?? 0}</p>
          <p>economy evidence: {combat.economyEvidenceApplied ? "applied" : "not applied"}; variance: {combat.varianceApplied ? "applied" : "off"}</p>
        </article>
      ))}
      {combats.length === 0 ? <p className={styles.emptyInline}>当前 phase 没有 combat resolution。</p> : null}
    </div>
  );
}

function EconomyAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined }) {
  const teams = props.trace?.economySummary ?? [];
  return (
    <div className={styles.auditStack}>
      {teams.map((team) => (
        <article key={team.teamId} className={styles.auditCard}>
          <h3>{team.teamId}</h3>
          <p>{team.side} / {team.posture} / {team.summaryBuyType} / cash {team.totalCash ?? 0}</p>
          <ul>
            {team.agents.map((agent) => (
              <li key={agent.agentId}>
                {agent.agentId}: {agent.buyType} - {agent.resourceTier}/{agent.utilityTier} - output {agent.outputBudget} - drop +{agent.dropReceived ?? 0}
              </li>
            ))}
          </ul>
        </article>
      ))}
      {teams.length === 0 ? <p className={styles.emptyInline}>暂无 economy context。</p> : null}
    </div>
  );
}

function WinnerAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  const condition = props.phase?.winCondition ?? props.trace?.finalHardCondition;
  if (!condition) return <p className={styles.emptyInline}>暂无 hard condition。</p>;
  return (
    <div className={styles.auditStack}>
      <MetricLine label="isRoundOver" value={String(condition.isRoundOver)} />
      <MetricLine label="winnerSide" value={condition.winnerSide ?? "unknown"} />
      <MetricLine label="winnerTeamId" value={condition.winnerTeamId ?? "unknown"} />
      <MetricLine label="roundWinType" value={condition.roundWinType ?? condition.judgeRoundWinType ?? "unknown"} />
      <MetricLine label="reason" value={condition.reason ?? "missing"} />
      <p className={styles.guardText}>最终 winner 只来自 hard condition；本页面不重新计算 winner，LLM draft 也不能写 winner。</p>
    </div>
  );
}

function RawAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  return (
    <pre className={styles.rawJson}>{JSON.stringify({ trace: props.trace, phase: props.phase }, null, 2)}</pre>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <p className={styles.metricLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function tabLabel(tab: AuditTab): string {
  if (tab === "llm") return "LLM";
  if (tab === "combat") return "战斗";
  if (tab === "economy") return "经济";
  if (tab === "winner") return "硬胜负";
  return "Raw";
}
