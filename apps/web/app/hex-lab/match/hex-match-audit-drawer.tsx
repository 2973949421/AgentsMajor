"use client";

import type {
  HexMatchLabPhaseSummary,
  HexMatchLabRoundTraceDetail
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

type AuditTab = "business" | "llm" | "combat" | "economy" | "winner" | "raw";

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
          <span>中文审计</span>
          <h2>金融攻防 / LLM / 战斗 / 经济 / 硬胜负审计</h2>
        </div>
        <button type="button" onClick={props.onClose}>关闭</button>
      </div>

      <div className={styles.drawerTabs}>
        {(["business", "llm", "combat", "economy", "winner", "raw"] as const).map((tab) => (
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
        {props.tab === "business" ? <BusinessAudit trace={props.trace} phase={props.phase} /> : null}
        {props.tab === "llm" ? <LlmAudit trace={props.trace} phase={props.phase} /> : null}
        {props.tab === "combat" ? <CombatAudit phase={props.phase} /> : null}
        {props.tab === "economy" ? <EconomyAudit trace={props.trace} /> : null}
        {props.tab === "winner" ? <WinnerAudit trace={props.trace} phase={props.phase} /> : null}
        {props.tab === "raw" ? <RawAudit trace={props.trace} phase={props.phase} /> : null}
      </div>
    </aside>
  );
}

function BusinessAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  const humanAudit = props.trace?.humanAudit;
  if (humanAudit) {
    const phaseStory = humanAudit.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? humanAudit.phaseStories[0];
    return (
      <div className={styles.auditStack}>
        <article className={styles.auditCard}>
          <h3>{humanAudit.roundStoryZh}</h3>
          <p>{humanAudit.defenseSummaryZh}</p>
          <p>{humanAudit.attackSummaryZh}</p>
          <p>{humanAudit.evidenceBoundaryZh}</p>
        </article>

        <article className={styles.auditCard}>
          <h3>本局开局信息卡</h3>
          <ul>
            {humanAudit.agentOpeningBriefs.map((brief) => (
              <li key={brief.briefId}>
                <strong>{brief.displayName}</strong> / {brief.teamSide} / {brief.role}：
                {brief.roleQuestionZh ?? brief.roundTaskZh}
                <br />
                <span>{brief.proofOrChallengeZh}</span>
                <br />
                {brief.usableFactsZh.length > 0 ? (
                  <>
                    <span>可用事实：{brief.usableFactsZh.slice(0, 2).join("；")}</span>
                    <br />
                  </>
                ) : null}
                {brief.missingEvidenceZh.length > 0 ? (
                  <>
                    <span>证据缺口：{brief.missingEvidenceZh.slice(0, 2).join("；")}</span>
                    <br />
                  </>
                ) : null}
                <small>{brief.buyConstraintZh} {brief.actionHintZh}</small>
                <details>
                  <summary>证据切片技术细节</summary>
                  <p>slice: {brief.sliceId ?? "旧 trace 未记录"}</p>
                  <p>evidence refs: {brief.evidenceRefs.join(", ") || "未记录"}</p>
                  <p>score caps: {brief.scoreCapRefs.join("; ") || "未记录"}</p>
                  {brief.roleFallbackReason ? <p>role fallback: {brief.roleFallbackReason}</p> : null}
                </details>
              </li>
            ))}
          </ul>
        </article>

        {phaseStory ? (
          <article className={styles.auditCard}>
            <h3>{phaseStory.phaseLabel ?? `P${phaseStory.phaseIndex}`}：本阶段行动</h3>
            <p>{phaseStory.summaryZh}</p>
            <h4>行动与引用开局信息卡</h4>
            {phaseStory.actionStories.length > 0 ? (
              <ul>
                {phaseStory.actionStories.map((action) => (
                  <li key={`${phaseStory.phaseIndex}_${action.agentId}`}>
                    <strong>{action.displayName}</strong>：{action.actionSummaryZh}
                    {action.repairSummaryZh ? `；${action.repairSummaryZh}` : ""}
                  </li>
                ))}
              </ul>
            ) : <p>当前阶段没有 LLM 行动。</p>}
            <h4>战斗裁判</h4>
            {phaseStory.combatStories.length > 0 ? (
              <ul>
                {phaseStory.combatStories.map((combat) => (
                  <li key={combat.contactId}>
                    <strong>{combat.verdictZh}</strong>：{combat.impactZh}
                    {combat.reasonsZh.length > 0 ? (
                      <span> 理由：{combat.reasonsZh.join("；")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p>当前阶段没有战斗裁定。</p>}
          </article>
        ) : null}

        {humanAudit.winnerSummaryZh ? (
          <article className={styles.auditCard}>
            <h3>硬胜负</h3>
            <p>{humanAudit.winnerSummaryZh}</p>
          </article>
        ) : null}

        <details className={styles.auditCard}>
          <summary>技术细节</summary>
          <p>request artifacts: {humanAudit.technicalRefs.requestArtifactIds.join(", ") || "未记录"}</p>
          <p>response artifacts: {humanAudit.technicalRefs.responseArtifactIds.join(", ") || "未记录"}</p>
          <p>raw reason count: {humanAudit.technicalRefs.rawReasonCount}</p>
          <pre className={styles.rawJson}>{JSON.stringify({ humanAudit, selectedPhase: props.phase }, null, 2)}</pre>
        </details>
      </div>
    );
  }
  const financeReview = props.trace?.financeReview;
  if (financeReview) {
    const phaseStory = financeReview.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? financeReview.phaseStories[0];
    return (
      <div className={styles.auditStack}>
        <article className={styles.auditCard}>
          <h3>{financeReview.roundStory.title}</h3>
          <p>{financeReview.roundStory.summary}</p>
          <p>{financeReview.roundStory.mirrorSummary}</p>
          <p>{financeReview.roundStory.evidenceSummary}</p>
        </article>

        <article className={styles.auditCard}>
          <h3>守方投资主张</h3>
          <p>{financeReview.roundStory.defenseSummary}</p>
          <p>关键假设: {props.trace?.financeDuel?.defenseThesis.keyAssumptions.join("; ") || "无"}</p>
          <p>证据编号: {props.trace?.financeDuel?.defenseThesis.evidenceRefs.join("; ") || "无"}</p>
          <p>风险边界: {props.trace?.financeDuel?.defenseThesis.riskBoundary || "无"}</p>
        </article>

        <article className={styles.auditCard}>
          <h3>攻方反证质疑</h3>
          <p>{financeReview.roundStory.attackSummary}</p>
          <p>质疑点: {props.trace?.financeDuel?.attackChallenge.challengePoints.join("; ") || "无"}</p>
          <p>要求守方回答: {props.trace?.financeDuel?.attackChallenge.requiredDefense.join("; ") || "无"}</p>
          <p>缺失证据: {props.trace?.financeDuel?.evidence.missingEvidence.join("; ") || "无"}</p>
        </article>

        {phaseStory ? (
          <article className={styles.auditCard}>
            <h3>{phaseStory.phaseLabel ?? `P${phaseStory.phaseIndex}`}</h3>
            <p>{phaseStory.summary}</p>
            <h4>选手行动承载</h4>
            {phaseStory.actionStories.length > 0 ? (
              <ul>
                {phaseStory.actionStories.map((action) => (
                  <li key={`${phaseStory.phaseIndex}_${action.agentId}`}>
                    <strong>{action.agentId}</strong> / {action.role} / {action.actionType}
                    {action.targetCellId ? ` -> ${action.targetCellId}` : ""}：
                    {action.financeIntent || action.financeTask || "未记录金融意图"}
                    {action.fallbackReason ? `；降级：${action.fallbackReason}` : ""}
                    {action.validationErrors.length > 0 ? `；拒绝：${action.validationErrors.join(", ")}` : ""}
                    <br />
                    <small>{action.rawOutputNote} {action.responseArtifactId ? `response=${action.responseArtifactId}` : ""}</small>
                  </li>
                ))}
              </ul>
            ) : <p>当前阶段没有 LLM 行动。</p>}
            <h4>金融裁判链路</h4>
            {phaseStory.combatStories.length > 0 ? (
              <ul>
                {phaseStory.combatStories.map((combat) => (
                  <li key={combat.contactId}>
                    <strong>{combat.contactId}</strong>：{combat.summary}
                    <br />
                    <small>保留原因：{combat.retentionReasons.join("; ") || "未记录"}；金融理由：{combat.financeReasons.join("; ") || "无"}；CS 理由：{combat.csReasons.join("; ") || "无"}</small>
                  </li>
                ))}
              </ul>
            ) : <p>当前阶段没有战斗裁定。</p>}
          </article>
        ) : null}

        {financeReview.hardWinnerStory ? (
          <article className={styles.auditCard}>
            <h3>硬胜负</h3>
            <p>{financeReview.hardWinnerStory.summary}</p>
            <p className={styles.guardText}>最终胜负只来自 hard condition，不来自 LLM、局部金融裁判或前端计算。</p>
          </article>
        ) : null}
      </div>
    );
  }
  const review = props.trace?.businessReview;
  if (!review) return <p className={styles.emptyInline}>当前 trace 未记录金融攻防审计主线。</p>;
  const phaseStory = review.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? review.phaseStories[0];
  return (
    <div className={styles.auditStack}>
      <article className={styles.auditCard}>
        <p className={styles.guardText}>旧商业轨迹，只读兼容；当前主线应使用金融攻防 trace。</p>
        <h3>{review.roundStory.title}</h3>
        <p>{review.roundStory.summary}</p>
        <p>{review.roundStory.mirrorSummary}</p>
      </article>

      <article className={styles.auditCard}>
        <h3>守方自证</h3>
        <p>{review.roundStory.defenseSummary}</p>
        <p>自证证据: {props.trace?.businessDuel?.defenseProof.claims.join("; ") || "无"}</p>
        <p>证据焦点: {props.trace?.businessDuel?.defenseProof.evidenceFocus.join("; ") || "无"}</p>
      </article>

      <article className={styles.auditCard}>
        <h3>攻方质疑</h3>
        <p>{review.roundStory.attackSummary}</p>
        <p>质疑点: {props.trace?.businessDuel?.attackChallenge.challengePoints.join("; ") || "无"}</p>
        <p>目标失败模式: {props.trace?.businessDuel?.attackChallenge.targetFailureModes.join("; ") || "无"}</p>
      </article>

      {phaseStory ? (
        <article className={styles.auditCard}>
          <h3>{phaseStory.phaseLabel ?? `P${phaseStory.phaseIndex}`}</h3>
          <p>{phaseStory.summary}</p>
          <h4>选手行动承载</h4>
          {phaseStory.actionStories.length > 0 ? (
            <ul>
              {phaseStory.actionStories.map((action) => (
                <li key={`${phaseStory.phaseIndex}_${action.agentId}`}>
                  <strong>{action.agentId}</strong> / {action.role} / {action.actionType}
                  {action.targetCellId ? ` -> ${action.targetCellId}` : ""}：
                  {action.businessIntent || action.businessTask || "未记录商业意图"}
                  {action.fallbackReason ? `；降级：${action.fallbackReason}` : ""}
                  {action.validationErrors.length > 0 ? `；拒绝：${action.validationErrors.join(", ")}` : ""}
                  <br />
                  <small>{action.rawOutputNote} {action.responseArtifactId ? `response=${action.responseArtifactId}` : ""}</small>
                </li>
              ))}
            </ul>
          ) : <p>当前阶段没有 LLM 行动。</p>}
          <h4>战斗裁判链路</h4>
          {phaseStory.combatStories.length > 0 ? (
            <ul>
              {phaseStory.combatStories.map((combat) => (
                <li key={combat.contactId}>
                  <strong>{combat.contactId}</strong>：{combat.summary}
                  <br />
                  <small>保留原因：{combat.retentionReasons.join("; ") || "未记录"}；商业理由：{combat.businessReasons.join("; ") || "无"}；CS 理由：{combat.csReasons.join("; ") || "无"}</small>
                </li>
              ))}
            </ul>
          ) : <p>当前阶段没有战斗裁定。</p>}
        </article>
      ) : null}

      {review.hardWinnerStory ? (
        <article className={styles.auditCard}>
          <h3>硬胜负</h3>
          <p>{review.hardWinnerStory.summary}</p>
          <p className={styles.guardText}>最终胜负只来自 hard condition，不来自 LLM、局部战斗优势或前端计算。</p>
        </article>
      ) : null}
    </div>
  );
}

function LlmAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  const audit = props.phase?.llmAudit ?? props.trace?.audit;
  if (!audit) return <p className={styles.emptyInline}>暂无 LLM audit。</p>;
  const financeDuel = props.trace?.financeDuel;
  const duel = props.trace?.businessDuel;
  return (
    <div className={styles.auditStack}>
      {financeDuel ? (
        <article className={styles.auditCard}>
          <h3>{financeDuel.topicTitle}</h3>
          <p>守方投资主张: {financeDuel.defenseThesis.thesis}</p>
          <p>攻方反证质疑: {financeDuel.attackChallenge.thesis}</p>
          <p>证据编号: {financeDuel.evidence.promptFacts.map((fact) => fact.factId).join(", ") || "无"}</p>
          <p>缺失证据: {financeDuel.evidence.missingEvidence.join(", ") || "无"}</p>
        </article>
      ) : duel ? (
        <article className={styles.auditCard}>
          <h3>{duel.subthemeTitle}</h3>
          <p>{duel.coreQuestion}</p>
          <p>守方自证: {duel.defenseProof.thesis}</p>
          <p>攻方质疑: {duel.attackChallenge.thesis}</p>
          <p>自证证据: {duel.defenseProof.claims.join("; ") || "无"}</p>
          <p>质疑点: {duel.attackChallenge.challengePoints.join("; ") || "无"}</p>
        </article>
      ) : null}
      <MetricLine label="供应器" value={audit.providerMode ?? "unknown"} />
      <MetricLine label="模型" value={audit.modelId ?? "未记录"} />
      <MetricLine label="战术变化" value={audit.strategyVariant ?? "未记录"} />
      <MetricLine label="策略种子" value={audit.roundStrategySeed ?? "未记录"} />
      <MetricLine label="预期 / 实际调用" value={`${audit.expectedCalls} / ${audit.totalLlmCallsAttempted}`} />
      <MetricLine label="接受 / 拒绝 / 降级" value={`${audit.acceptedDrafts} / ${audit.rejectedDrafts} / ${audit.fallbackCount}`} />
      <MetricLine label="紧凑请求数量" value={`${audit.compactRequestCount}`} />
      <MetricLine label="平均请求压缩" value={formatPercent(audit.averageRequestReductionRatio)} />
      <MetricLine label="提示词 token" value={audit.promptTokenTotal !== undefined ? String(audit.promptTokenTotal) : "provider 未返回"} />
      <MetricLine label="语义语言" value={audit.semanticLanguages.join(", ") || "未记录"} />
      <MetricLine label="语言不匹配" value={`${audit.languageMismatchCount}`} />
      <details className={styles.auditCard}>
        <summary>技术细节</summary>
        <MetricLine label="request artifacts" value={audit.requestArtifactIds.join(", ") || "当前 trace 未记录"} />
        <MetricLine label="response artifacts" value={audit.responseArtifactIds.join(", ") || "当前 trace 未记录"} />
        <MetricLine label="repaired fields" value={audit.repairedFields.join(", ") || "无"} />
        <MetricLine label="fallback reasons" value={audit.fallbackReasons.join("; ") || "无"} />
        <MetricLine label="provider errors" value={audit.providerErrors.join("; ") || "无"} />
      </details>
      <p className={styles.guardText}>
        模型只输出行动草案。winner、kill、damage、economyDelta 和 DB fact 都不会从 LLM 直接进入事实层。
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
          <p>金融裁定: {combat.financeVerdict ?? "未记录"}</p>
          <p>兼容商业裁定: {combat.businessVerdict ?? "未记录"}</p>
          <p>participants: {combat.participants.join(", ")}</p>
          <p>casualties: {combat.casualties.join(", ") || "none"}</p>
          <p>接触保留原因: {combat.contactRetentionReasons.join("; ") || "未记录"}{combat.prunedCandidateCount ? `；本 phase 裁剪候选 ${combat.prunedCandidateCount} 个` : ""}</p>
          <p>
            kill attribution: {combat.killAttributions.map((item) =>
              `${item.killerAgentId ?? "unassigned"} -> ${item.targetAgentId}${item.assisterAgentIds.length > 0 ? ` (+${item.assisterAgentIds.join(",")})` : ""}`
            ).join("; ") || "none"}
          </p>
          <p>
            归因理由: {combat.killAttributions.flatMap((item) => [...item.attributionReasons, ...item.targetSelectionReasons]).join("; ") || "无"}
          </p>
          <p>
            角色贡献: {combat.roleContributions.map((item) =>
              `${item.agentId}/${item.roleLabel}/${item.contributionType}:${item.scoreDelta}(${item.reasons.join(",")})`
            ).join("; ") || "未记录"}
          </p>
          <p>suppression: {combat.suppressions.join(", ") || "none"}</p>
          <p>
            site pressure: {combat.sitePressure ? "yes" : "no"};
            plant denied: {combat.plantDenied ? "yes" : "no"};
            trade: {combat.tradeOpportunity ? "yes" : "no"}
          </p>
          <p>finance A/D {combat.financeScoreAttack ?? combat.businessScoreAttack ?? 0}/{combat.financeScoreDefense ?? combat.businessScoreDefense ?? 0}; CS A/D {combat.csScoreAttack ?? 0}/{combat.csScoreDefense ?? 0}</p>
          <p>finance reasons: {combat.financeReasons.join("; ") || "无"}</p>
          <p>compat business reasons: {combat.businessReasons.join("; ") || "无"}</p>
          <p>CS reasons: {combat.csReasons.join("; ") || "无"}</p>
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
                {agent.agentId}: {agent.buyType} - {agent.resourceTier}/{agent.utilityTier} - spend {agent.spend ?? 0} - output {agent.outputBudget} - drop +{agent.dropReceived ?? 0}
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
  if (!condition) return <p className={styles.emptyInline}>暂无 hard winner。</p>;
  return (
    <div className={styles.auditStack}>
      <MetricLine label="round over" value={condition.isRoundOver ? "yes" : "continue"} />
      <MetricLine label="winner side" value={condition.winnerSide ?? "none"} />
      <MetricLine label="winner team" value={condition.winnerTeamId ?? "none"} />
      <MetricLine label="win type" value={condition.roundWinType ?? condition.judgeRoundWinType ?? "none"} />
      <MetricLine label="reason" value={condition.reason ?? "未记录"} />
      <p className={styles.guardText}>最终 winner 只来自 hard condition。前端不重新计算 winner，LLM 也不能写最终胜负。</p>
    </div>
  );
}

function RawAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  return (
    <pre className={styles.rawJson}>
      {JSON.stringify({ selectedPhase: props.phase, selectedTrace: props.trace }, null, 2)}
    </pre>
  );
}

function MetricLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.metricLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "当前 trace 未记录" : `${Math.round(value * 100)}%`;
}

function tabLabel(tab: AuditTab): string {
  if (tab === "business") return "金融攻防";
  if (tab === "llm") return "LLM 调用";
  if (tab === "combat") return "战斗裁定";
  if (tab === "economy") return "经济证据";
  if (tab === "winner") return "硬胜负";
  return "原始 JSON";
}
