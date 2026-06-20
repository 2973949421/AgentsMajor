"use client";

import type {
  HexMatchLabPhaseSummary,
  HexMatchLabRoundTraceDetail
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

type AuditTab = "business" | "llm" | "combat" | "economy" | "winner" | "raw";
type FinanceEvidenceAdoptionSide = NonNullable<NonNullable<HexMatchLabPhaseSummary["combats"][number]["financeEvidenceAdoption"]>["attack"]>;

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
          <h2>金融决策审计</h2>
        </div>
        <button type="button" onClick={props.onClose}>关闭</button>
      </div>

      <div className={styles.drawerBody}>
        <BusinessAudit trace={props.trace} phase={props.phase} />
      </div>
    </aside>
  );
}

type HexMatchLabHumanAudit = NonNullable<HexMatchLabRoundTraceDetail["humanAudit"]>;
type HexMatchLabRoundStartOutputDigest = HexMatchLabHumanAudit["roundStartOutputDigests"][number];
type HexMatchLabAgentOutputDigest = HexMatchLabHumanAudit["agentOutputDigests"][number];
type HexMatchLabPhaseStory = HexMatchLabHumanAudit["phaseStories"][number];

function PlayerFinanceAudit(props: {
  humanAudit: HexMatchLabHumanAudit;
  phaseStory: HexMatchLabPhaseStory | undefined;
}) {
  const selectedOutputDigests = props.humanAudit.agentOutputDigests.filter((digest) =>
    props.phaseStory ? digest.phaseIndex === props.phaseStory.phaseIndex : true
  );
  const actionDigestsByAgentId = new Map<string, HexMatchLabAgentOutputDigest[]>();
  for (const digest of selectedOutputDigests) {
    const list = actionDigestsByAgentId.get(digest.agentId) ?? [];
    list.push(digest);
    actionDigestsByAgentId.set(digest.agentId, list);
  }

  return (
    <div className={styles.auditStack}>
      <article className={styles.auditCard}>
        <h3>按选手折叠的金融决策审计</h3>
        <p>主视图只展示真实 agent 输出：Phase0 结构化立场卡 / 挑战卡、买型裁剪、以及当前 phase 的局内行动输出；系统输入卡默认折叠，不冒充选手发言。</p>
        {props.phaseStory ? <p>当前查看：Phase {props.phaseStory.phaseIndex}</p> : <p>未选中具体 phase，展示已记录的局内行动输出。</p>}
      </article>

      {props.humanAudit.roundStartOutputDigests.length > 0 ? (
        props.humanAudit.roundStartOutputDigests.map((output) => (
          <details key={output.outputId} className={styles.auditCard}>
            <summary>
              <strong>{output.displayName}</strong>
              {" / "}
              {output.teamSide ?? "未知阵营"}
              {" / "}
              {output.financeRoleCn ?? output.financeRole ?? "金融角色未记录"}
              {" / 买型："}
              {formatBuyType(output)}
            </summary>
            <div className={styles.auditStack}>
              <section>
                <h4>Phase0 真实{output.cardKind === "stance" ? "立场卡" : output.cardKind === "challenge" ? "挑战卡" : "结构化卡片"}</h4>
                <p>{output.cardSummaryZh || output.rawOutputSummaryZh || "该选手没有可展示的真实 phase0 卡片。"}</p>
                <RoundStartCardSummary output={output} />
                <p><strong>买型裁剪：</strong>{output.buyConstraintAppliedZh || "未记录买型裁剪。"}</p>
                <p><strong>风险边界：</strong>{output.riskBoundaryZh || "未记录风险边界。"}</p>
                <p><strong>后续引用：</strong>{output.phaseActionCarryoverZh || "未记录后续行动引用方式。"}</p>
                {output.evidenceRefs.length > 0 ? (
                  <p><strong>证据引用：</strong>{output.evidenceRefs.join("、")}</p>
                ) : <p><strong>证据引用：</strong>未记录。</p>}
              </section>

              <section>
                <h4>Phase1+ 局内行动输出</h4>
                <PlayerPhaseOutputs digests={actionDigestsByAgentId.get(output.agentId) ?? []} />
              </section>

              <details>
                <summary>真实输出技术细节</summary>
                <ul>
                  <li>source：{output.source}</li>
                  <li>outputId：{output.outputId}</li>
                  <li>request artifact：{output.requestArtifactId ?? "未记录"}</li>
                  <li>response artifact：{output.responseArtifactId ?? "未记录"}</li>
                  <li>cardKind：{output.cardKind ?? "旧 trace 未记录"}</li>
                  <li>allowed claim refs：{output.allowedPhaseRefs?.claimIds.join("、") || "无"}</li>
                  <li>allowed challenge refs：{output.allowedPhaseRefs?.challengeIds.join("、") || "无"}</li>
                  <li>normalization：{output.normalizationSummaryZh}</li>
                  <li>validation：{output.validationSummaryZh}</li>
                  {output.technicalRefs.errors.length > 0 ? (
                    <li>errors：{output.technicalRefs.errors.join("；")}</li>
                  ) : null}
                </ul>
              </details>
            </div>
          </details>
        ))
      ) : (
        <article className={styles.auditCard}>
          <h3>本局没有可消费的真实 phase0 结构化卡片</h3>
          <p>没有 response artifact、结构校验失败或旧 trace 缺字段时，系统不会用输入卡、降级文案或前端推测冒充 agent 输出。</p>
        </article>
      )}

      {props.humanAudit.roundStartOutputFailures.length > 0 ? (
        <details className={styles.auditCard}>
          <summary>phase0 卡片失败（不进入后续行动层）</summary>
          <ul>
            {props.humanAudit.roundStartOutputFailures.map((failure) => (
              <li key={failure.outputId}>
                <strong>{failure.displayName}</strong>：{failure.validationSummaryZh || failure.rawOutputSummaryZh}
                {failure.technicalRefs.errors.length > 0 ? `（${failure.technicalRefs.errors.join("；")}）` : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className={styles.auditCard}>
        <summary>系统输入材料（折叠，非 agent 输出）</summary>
        <p>这些是后端给模型的输入上下文，不是选手自己说的话；主审计不会用它们冒充真实输出。</p>
        <ul>
          {props.humanAudit.agentOpeningBriefs.map((brief) => (
            <li key={brief.briefId}>
              <strong>{brief.displayName}</strong>：{brief.roundTaskZh}；{brief.proofOrChallengeZh}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function RoundStartCardSummary(props: { output: HexMatchLabRoundStartOutputDigest }) {
  const { output } = props;
  if (output.stanceCard) {
    return (
      <div>
        <p>
          <strong>立场：</strong>{output.stanceCard.direction}；
          <strong>标的：</strong>{output.stanceCard.target}；
          <strong>周期：</strong>{output.stanceCard.horizon}；
          <strong>置信度：</strong>{formatPercent(output.stanceCard.confidence)}
        </p>
        <p><strong>仓位建议：</strong>{output.stanceCard.positionSuggestion}</p>
        <p><strong>审计摘要：</strong>{output.stanceCard.auditSummaryZh}</p>
        <ul>
          {output.stanceCard.coreClaims.map((claim) => (
            <li key={claim.claimId}>
              <strong>{claim.claimId}</strong> / {claim.claimType}：{claim.claimZh}
              <br />
              <span>证据：{claim.evidenceRefs.join("、") || "未记录"}</span>
              <br />
              <span>推理桥：{claim.reasoningBridge}</span>
            </li>
          ))}
        </ul>
        {output.stanceCard.invalidatingConditions.length > 0 ? (
          <p><strong>失效条件：</strong>{output.stanceCard.invalidatingConditions.join("；")}</p>
        ) : null}
      </div>
    );
  }
  if (output.challengeCard) {
    return (
      <div>
        <p>
          <strong>目标 claim：</strong>{output.challengeCard.targetClaimId}；
          <strong>挑战类型：</strong>{output.challengeCard.challengeType}；
          <strong>置信度压降：</strong>{formatPercent(output.challengeCard.confidenceReduction)}
        </p>
        <p><strong>被挑战假设：</strong>{output.challengeCard.challengedAssumption}</p>
        <p><strong>代理错配：</strong>{output.challengeCard.proxyMismatch}</p>
        <p><strong>审计摘要：</strong>{output.challengeCard.auditSummaryZh}</p>
        <ul>
          {output.challengeCard.challenges.map((challenge) => (
            <li key={challenge.challengeId}>
              <strong>{challenge.challengeId}</strong> → {challenge.targetClaimId} / {challenge.challengeType}：{challenge.challengeReasonZh}
              <br />
              <span>证据：{challenge.evidenceRefs.join("、") || "未记录"}</span>
              <br />
              <span>预期影响：{challenge.expectedEffect}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <p>旧 trace 未记录 stanceCard / challengeCard，不能作为 N58 结构化卡片审计。</p>;
}

function PlayerPhaseOutputs(props: { digests: HexMatchLabAgentOutputDigest[] }) {
  if (props.digests.length === 0) {
    return <p>当前 phase 没有该选手的真实行动输出。</p>;
  }

  return (
    <ul>
      {props.digests.map((digest) => (
        <li key={`${digest.agentId}-${digest.phaseIndex}-${digest.responseArtifactId ?? digest.source}`}>
          <strong>{digest.phaseLabel ?? `Phase ${digest.phaseIndex}`}：</strong>
          {isConsumableAgentDigest(digest) ? (
            <>
              <span>{digest.declaredActionZh}</span>
              <p>{digest.declaredReasonZh}</p>
              {digest.declaredRiskNotesZh.length > 0 ? <p>风险：{digest.declaredRiskNotesZh.join("；")}</p> : null}
              {digest.declaredEvidenceRefs.length > 0 ? <p>证据：{digest.declaredEvidenceRefs.join("、")}</p> : null}
              <p>{digest.normalizationSummaryZh}</p>
              <p>{digest.validationSummaryZh}</p>
              <p>{digest.judgeAdoptionSummaryZh}</p>
            </>
          ) : (
            <span>{digest.rawOutputSummaryZh || "本阶段没有可审计的真实 agent 输出。"}</span>
          )}
          <details>
            <summary>行动技术细节</summary>
            <ul>
              <li>source：{digest.source}</li>
              <li>request artifact：{digest.requestArtifactId ?? "未记录"}</li>
              <li>response artifact：{digest.responseArtifactId ?? "未记录"}</li>
              <li>actionType：{digest.technicalRefs.actionType ?? "未记录"}</li>
              <li>targetCellId：{digest.technicalRefs.targetCellId ?? "未记录"}</li>
              <li>roundStartOutputId：{digest.technicalRefs.roundStartOutputId ?? "未记录"}</li>
              <li>phase0RefId：{digest.technicalRefs.phase0RefId ?? "未记录"}</li>
              <li>rawText：{digest.technicalRefs.rawTextPreview ?? "未记录"}</li>
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}

function isConsumableAgentDigest(digest: HexMatchLabAgentOutputDigest): boolean {
  return digest.source === "llm_response_artifact" || digest.source === "fixture_response";
}

function formatBuyType(output: HexMatchLabRoundStartOutputDigest): string {
  const buyType = output.buyType ?? "未记录";
  return output.resourceTier ? `${buyType} / ${output.resourceTier}` : buyType;
}

function BusinessAudit(props: { trace: HexMatchLabRoundTraceDetail | undefined; phase: HexMatchLabPhaseSummary | undefined }) {
  const humanAudit = props.trace?.humanAudit;
  if (humanAudit) {
    const phaseStory = humanAudit.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? humanAudit.phaseStories[0];
    return <PlayerFinanceAudit humanAudit={humanAudit} phaseStory={phaseStory} />;
  }
  if (props.trace?.humanAudit) {
    const legacyHumanAudit = props.trace.humanAudit;
    const phaseStory = legacyHumanAudit.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? legacyHumanAudit.phaseStories[0];
    const selectedOutputDigests = legacyHumanAudit.agentOutputDigests.filter((digest) =>
      phaseStory ? digest.phaseIndex === phaseStory.phaseIndex : true
    );
    return (
      <div className={styles.auditStack}>
        <article className={styles.auditCard}>
          <h3>{legacyHumanAudit.roundStoryZh}</h3>
          {legacyHumanAudit.allowedStanceZh && legacyHumanAudit.allowedStanceZh.length > 0 ? (
            <p><strong>允许立场：</strong>{legacyHumanAudit.allowedStanceZh.join(" / ")}</p>
          ) : null}
          {legacyHumanAudit.requiredEvidenceSchemaZh && legacyHumanAudit.requiredEvidenceSchemaZh.length > 0 ? (
            <>
              <h4>必需证据结构</h4>
              <ul>
                {legacyHumanAudit.requiredEvidenceSchemaZh.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {legacyHumanAudit.challengePolicyZh ? <p><strong>挑战规则：</strong>{legacyHumanAudit.challengePolicyZh}</p> : null}
          <p>{legacyHumanAudit.defenseSummaryZh}</p>
          <p>{legacyHumanAudit.attackSummaryZh}</p>
          <p>{legacyHumanAudit.evidenceBoundaryZh}</p>
          <p>{legacyHumanAudit.roundValidationSummaryZh}</p>
          {legacyHumanAudit.sampleQualityWarningsZh.length > 0 ? (
            <ul>
              {legacyHumanAudit.sampleQualityWarningsZh.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : <p>当前 round 未发现 N54 样本质量警告。</p>}
        </article>

        <article className={styles.auditCard}>
          <h3>本局真实开局输出</h3>
          <p className={styles.guardText}>这里只展示可消费的 round-start（开局真实输出层）模型输出摘要；provider 失败、结构无效或非法证据引用不会计入这里。</p>
          {legacyHumanAudit.roundStartOutputDigests.length > 0 ? (
            <ul>
              {legacyHumanAudit.roundStartOutputDigests.map((output) => (
                <li key={output.outputId}>
                  <strong>{output.displayName}</strong> / {output.teamSide ?? "side unknown"} / {output.financeRoleCn ?? output.financeRole ?? "角色未记录"}：
                  {output.openingStatementZh}
                  <br />
                  <span>买型裁剪：{output.buyConstraintAppliedZh}</span>
                  <br />
                  <span>后续行动引用：{output.phaseActionCarryoverZh}</span>
                  <br />
                  <span>风险边界：{output.riskBoundaryZh}</span>
                  <br />
                  <span>证据引用：{output.evidenceRefs.join("、") || "未记录可识别证据"}</span>
                  <br />
                  <span>{output.normalizationSummaryZh}</span>
                  <br />
                  <span>{output.validationSummaryZh}</span>
                  <details>
                    <summary>真实开局输出技术细节</summary>
                    <p>source: {output.source}</p>
                    <p>buy type: {output.buyType ?? "未记录"}</p>
                    <p>resource tier: {output.resourceTier ?? "未记录"}</p>
                    <p>request artifact: {output.requestArtifactId ?? "未记录"}</p>
                    <p>response artifact: {output.responseArtifactId ?? "未记录"}</p>
                    <p>errors: {output.technicalRefs.errors.join("；") || "无"}</p>
                    <p>repaired fields: {output.technicalRefs.repairedFields.join("；") || "无"}</p>
                    <p>provider: {output.technicalRefs.providerMode ?? "未记录"}</p>
                    <p>model: {output.technicalRefs.modelId ?? "未记录"}</p>
                    {output.technicalRefs.rawTextPreview ? <p>raw text preview: {output.technicalRefs.rawTextPreview}</p> : null}
                    {output.technicalRefs.rawDraftPreview ? <p>raw draft preview: {output.technicalRefs.rawDraftPreview}</p> : null}
                    {output.technicalRefs.normalizedDraftPreview ? <p>normalized draft preview: {output.technicalRefs.normalizedDraftPreview}</p> : null}
                  </details>
                </li>
              ))}
            </ul>
          ) : <p>旧 trace 未记录本局真实开局输出，或本 round 没有可消费真实开局输出。</p>}
        </article>

        <article className={styles.auditCard}>
          <h3>开局输出失败</h3>
          <p className={styles.guardText}>这里展示不可消费的开局输出：它们会保留审计痕迹，但不会进入后续 phase 行动，也不会冒充 agent 真实输出。</p>
          {legacyHumanAudit.roundStartOutputFailures.length > 0 ? (
            <ul>
              {legacyHumanAudit.roundStartOutputFailures.map((output) => (
                <li key={output.outputId}>
                  <strong>{output.displayName}</strong> / {output.teamSide ?? "side unknown"}：
                  {output.rawOutputSummaryZh}
                  <br />
                  <span>{output.validationSummaryZh}</span>
                  <br />
                  <span>失败原因：{output.technicalRefs.errors.join("；") || "未记录具体错误"}</span>
                  <details>
                    <summary>失败输出技术细节</summary>
                    <p>source: {output.source}</p>
                    <p>usableForPhaseAction: {String(output.usableForPhaseAction)}</p>
                    <p>request artifact: {output.requestArtifactId ?? "未记录"}</p>
                    <p>response artifact: {output.responseArtifactId ?? "未记录"}</p>
                    <p>raw draft preview: {output.technicalRefs.rawDraftPreview ?? "未记录"}</p>
                    <p>normalized draft preview: {output.technicalRefs.normalizedDraftPreview ?? "未记录"}</p>
                  </details>
                </li>
              ))}
            </ul>
          ) : <p>当前 round 没有开局输出失败记录。</p>}
        </article>

        <article className={styles.auditCard}>
          <h3>真实 LLM 输出摘要</h3>
          <p className={styles.guardText}>这里展示 response artifact 中真实模型输出的微处理版本；没有 response artifact 时不会用系统输入卡或降级文案冒充。</p>
          {selectedOutputDigests.length > 0 ? (
            <ul>
              {selectedOutputDigests.map((digest) => (
                <li key={`${digest.phaseIndex}_${digest.agentId}_${digest.responseArtifactId ?? digest.source}`}>
                  <strong>{digest.displayName}</strong> / {digest.teamSide ?? "side unknown"}：
                  {digest.rawOutputSummaryZh}
                  <br />
                  <span>{digest.declaredActionZh}</span>
                  <br />
                  <span>理由：{digest.declaredReasonZh}</span>
                  <br />
                  <span>风险：{digest.declaredRiskNotesZh.join("；") || "模型未记录风险说明"}</span>
                  <br />
                  <span>证据引用：{digest.declaredEvidenceRefs.join("、") || "模型未引用可识别证据"}</span>
                  <br />
                  <span>{digest.normalizationSummaryZh}</span>
                  <br />
                  <span>{digest.validationSummaryZh}</span>
                  <br />
                  <span>{digest.judgeAdoptionSummaryZh}</span>
                  <details>
                    <summary>真实输出技术细节</summary>
                    <p>source: {digest.source}</p>
                    <p>request artifact: {digest.requestArtifactId ?? "未记录"}</p>
                    <p>response artifact: {digest.responseArtifactId ?? "未记录"}</p>
                    <p>action type: {digest.technicalRefs.actionType ?? "未记录"}</p>
                    <p>target cell: {digest.technicalRefs.targetCellId ?? "未记录"}</p>
                    <p>brief ref: {digest.technicalRefs.briefRefId ?? "未记录"}</p>
                    <p>{digest.semanticLanguageSummaryZh}</p>
                    {digest.technicalRefs.responseReadError ? <p>读取错误：{digest.technicalRefs.responseReadError}</p> : null}
                    {digest.technicalRefs.rawTextPreview ? <p>raw text preview: {digest.technicalRefs.rawTextPreview}</p> : null}
                    {digest.technicalRefs.rawDraftPreview ? <p>raw draft preview: {digest.technicalRefs.rawDraftPreview}</p> : null}
                    {digest.technicalRefs.normalizedDraftPreview ? <p>normalized draft preview: {digest.technicalRefs.normalizedDraftPreview}</p> : null}
                  </details>
                </li>
              ))}
            </ul>
          ) : <p>本阶段没有可审计的真实 agent 输出。</p>}
        </article>

        <details className={styles.auditCard}>
          <summary>开局输出输入材料（系统卡，非 agent 输出）</summary>
          <p className={styles.guardText}>以下内容由系统根据 financeDuel、证据切片和经济上下文确定性生成，只是模型输入上下文，不是 agent 自己说的话。</p>
          <ul>
            {legacyHumanAudit.agentOpeningBriefs.map((brief) => (
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
        </details>

        {phaseStory ? (
          <article className={styles.auditCard}>
            <h3>{phaseStory.phaseLabel ?? `P${phaseStory.phaseIndex}`}：本阶段行动</h3>
            <p>{phaseStory.summaryZh}</p>
            <p>{phaseStory.phaseValidationSummaryZh}</p>
            <h4>行动与引用真实开局输出</h4>
            {phaseStory.actionStories.length > 0 ? (
              <ul>
                {phaseStory.actionStories.map((action) => (
                  <li key={`${phaseStory.phaseIndex}_${action.agentId}`}>
                    <strong>{action.displayName}</strong>：{action.actionSummaryZh}
                    {action.repairSummaryZh ? `；${action.repairSummaryZh}` : ""}
                    <details>
                      <summary>行动技术细节</summary>
                      <p>真实开局输出: {action.roundStartOutputRef ?? "旧 trace 未记录"}</p>
                      <p>opening brief: {action.openingBriefRef ?? "旧 trace 未记录"}</p>
                      <p>target cell: {action.technicalRefs.targetCellId ?? "未记录"}</p>
                      <p>request artifact: {action.technicalRefs.requestArtifactId ?? "未记录"}</p>
                      <p>response artifact: {action.technicalRefs.responseArtifactId ?? "未记录"}</p>
                      <p>round-start output id: {action.technicalRefs.roundStartOutputId ?? "未记录"}</p>
                      <p>validation errors: {action.technicalRefs.validationErrors.join("; ") || "无"}</p>
                      <p>repaired fields: {action.technicalRefs.repairedFields.join("; ") || "无"}</p>
                    </details>
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
                    {combat.acceptedEvidenceZh.length > 0 ? (
                      <span> 采信证据：{combat.acceptedEvidenceZh.join("；")}</span>
                    ) : null}
                    {combat.rejectedEvidenceZh.length > 0 ? (
                      <span> 未采信证据：{combat.rejectedEvidenceZh.join("；")}</span>
                    ) : null}
                    {combat.missingEvidenceZh.length > 0 ? (
                      <span> 缺失证据影响：{combat.missingEvidenceZh.join("；")}</span>
                    ) : null}
                    {combat.reasonsZh.length > 0 ? (
                      <span> 理由：{combat.reasonsZh.join("；")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p>当前阶段没有战斗裁定。</p>}
          </article>
        ) : null}

        {legacyHumanAudit.winnerSummaryZh ? (
          <article className={styles.auditCard}>
            <h3>硬胜负</h3>
            <p>{legacyHumanAudit.winnerSummaryZh}</p>
          </article>
        ) : null}

        <details className={styles.auditCard}>
          <summary>技术细节</summary>
          <p>request artifacts: {legacyHumanAudit.technicalRefs.requestArtifactIds.join(", ") || "未记录"}</p>
          <p>response artifacts: {legacyHumanAudit.technicalRefs.responseArtifactIds.join(", ") || "未记录"}</p>
          <p>raw reason count: {legacyHumanAudit.technicalRefs.rawReasonCount}</p>
          <pre className={styles.rawJson}>{JSON.stringify({ humanAudit: legacyHumanAudit, selectedPhase: props.phase }, null, 2)}</pre>
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
          <h3>立场方任务</h3>
          <p>{financeReview.roundStory.defenseSummary}</p>
          <p>关键假设: {props.trace?.financeDuel?.defenseThesis.keyAssumptions.join("; ") || "无"}</p>
          <p>证据编号: {props.trace?.financeDuel?.defenseThesis.evidenceRefs.join("; ") || "无"}</p>
          <p>风险边界: {props.trace?.financeDuel?.defenseThesis.riskBoundary || "无"}</p>
        </article>

        <article className={styles.auditCard}>
          <h3>挑战方任务</h3>
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
  if (!review) return <p className={styles.emptyInline}>当前 trace 未记录金融决策审计主线。</p>;
  const phaseStory = review.phaseStories.find((story) => story.phaseIndex === props.phase?.phaseIndex) ?? review.phaseStories[0];
  return (
    <div className={styles.auditStack}>
      <article className={styles.auditCard}>
        <p className={styles.guardText}>旧商业轨迹，只读兼容；当前主线应使用金融决策 trace。</p>
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
          <p>立场方任务: {financeDuel.defenseThesis.thesis}</p>
          <p>挑战方任务: {financeDuel.attackChallenge.thesis}</p>
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
          <h3>战斗裁定</h3>
          <p>金融裁定: {formatFinanceVerdict(combat.financeVerdict)}</p>
          <p>{formatN59JudgeSummary(combat.financeEvidenceAdoption)}</p>
          <p>{formatCombatEffects(combat.financeEvidenceAdoption)}</p>
          <p>接触强度: {formatContactThreat(combat)}</p>
          <p>战斗结论: {combat.killAttributions.length > 0 ? "形成击杀" : combat.suppressions.length > 0 ? "形成压制" : "未形成击杀或压制"}</p>
          <p>
            击杀归因: {combat.killAttributions.map((item) =>
              `${item.killerAgentId ?? "未分配"} 击倒 ${item.targetAgentId}${item.assisterAgentIds.length > 0 ? `，助攻 ${item.assisterAgentIds.join("、")}` : ""}`
            ).join("；") || "无"}
          </p>
          <p>
            采信证据: {formatAdoptionSide(combat.financeEvidenceAdoption?.attack, "挑战方")}；{formatAdoptionSide(combat.financeEvidenceAdoption?.defense, "立场方")}
          </p>
          <p>
            未采信证据: {formatRejectedEvidence(combat.financeEvidenceAdoption?.attack, "挑战方")}；{formatRejectedEvidence(combat.financeEvidenceAdoption?.defense, "立场方")}
          </p>
          <p>
            缺失证据影响: {formatMissingEvidence(combat.financeEvidenceAdoption?.attack, "挑战方")}；{formatMissingEvidence(combat.financeEvidenceAdoption?.defense, "立场方")}
          </p>
          <p>
            claim / challenge 采信: {formatClaimsAndChallenges(combat.financeEvidenceAdoption)}
          </p>
          <p>金融裁判理由: {combat.financeReasonZh.join("；") || "旧 trace 未记录证据采信链"}</p>
          <p>CS 执行理由: {combat.csReasonZh.join("；") || "未记录中文 CS 理由"}</p>
          <details>
            <summary>战斗技术细节</summary>
            <p>contact id: {combat.contactId}</p>
            <p>{combat.advantage ?? "unknown"} / {combat.verdict ?? "no verdict"}</p>
            <p>兼容商业裁定: {combat.businessVerdict ?? "未记录"}</p>
            <p>participants: {combat.participants.join(", ")}</p>
            <p>casualties: {combat.casualties.join(", ") || "none"}</p>
            <p>接触保留原因: {combat.contactRetentionReasons.join("; ") || "未记录"}{combat.prunedCandidateCount ? `；本 phase 裁剪候选 ${combat.prunedCandidateCount} 个` : ""}</p>
            <p>归因理由: {combat.killAttributions.flatMap((item) => [...item.attributionReasons, ...item.targetSelectionReasons]).join("; ") || "无"}</p>
            <p>致命门槛通过原因: {combat.lethalGateReasons.map(formatTechnicalReason).join("; ") || "无"}</p>
            <p>致命门槛阻断原因: {combat.lethalGateBlockedReasons.map(formatTechnicalReason).join("; ") || "无"}</p>
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
          </details>
        </article>
      ))}
      {combats.length === 0 ? <p className={styles.emptyInline}>当前 phase 没有 combat resolution。</p> : null}
    </div>
  );
}

function formatN59JudgeSummary(adoption: HexMatchLabPhaseSummary["combats"][number]["financeEvidenceAdoption"]): string {
  const side = adoption?.attack ?? adoption?.defense;
  if (!side?.financialResult) return "N59 证据裁判：旧 trace 未记录。";
  const result = side.financialResult === "challenge_breaks_stance"
    ? "挑战方击中具体主张"
    : side.financialResult === "stance_survives"
      ? "立场方证据链暂时守住"
      : side.financialResult === "no_financial_win_allowed"
        ? "无正向采信证据，禁止金融胜负"
        : "金融证据未拉开差距";
  return `N59 证据裁判：${result}；立场分 ${side.stanceScore ?? 0}，挑战分 ${side.challengeScore ?? 0}。`;
}

function formatCombatEffects(adoption: HexMatchLabPhaseSummary["combats"][number]["financeEvidenceAdoption"]): string {
  const effects = adoption?.attack?.combatEffectAllowed ?? adoption?.defense?.combatEffectAllowed ?? [];
  if (effects.length === 0) return "金融投影权限：旧 trace 未记录。";
  return `金融投影权限：${effects.map(formatCombatEffect).join("、")}。`;
}

function formatCombatEffect(effect: string): string {
  const labels: Record<string, string> = {
    no_effect: "不提供金融加成",
    minor_delay: "轻微延缓",
    pressure: "压制",
    force_reposition: "迫使换位",
    map_control: "控图",
    possible_kill: "允许投影为击杀"
  };
  return labels[effect] ?? effect;
}

function formatClaimsAndChallenges(adoption: HexMatchLabPhaseSummary["combats"][number]["financeEvidenceAdoption"]): string {
  if (!adoption) return "旧 trace 未记录";
  const claims = adoption.defense.acceptedClaims.length > 0 ? `立场 claim ${adoption.defense.acceptedClaims.join("、")}` : "立场无采信 claim";
  const challenges = adoption.attack.acceptedChallenges.length > 0 ? `挑战 ${adoption.attack.acceptedChallenges.join("、")}` : "挑战无采信 challenge";
  return `${claims}；${challenges}`;
}
function formatContactThreat(combat: HexMatchLabPhaseSummary["combats"][number]): string {
  const label = combat.contactThreatLevel === "lethal"
    ? "致命接触"
    : combat.contactThreatLevel === "suppression"
      ? "压制接触"
      : combat.contactThreatLevel === "observation"
        ? "观察接触"
        : "旧 trace 未记录";
  const details = [
    combat.lineOfFireExposure ? "枪线暴露" : undefined,
    combat.openSightNoCover ? "开阔无掩体" : undefined,
    combat.samePointExposure ? "同点位暴露" : undefined,
    combat.objectiveExposure ? "包点/下包/拆包暴露" : undefined,
    combat.implicitDuelFromMovement ? "移动触发隐式交火" : undefined,
    combat.coverBlockedLethal ? "掩体阻断致命升级" : undefined
  ].filter((item): item is string => Boolean(item));
  const suffix = details.length > 0 ? `；${details.join("、")}` : "";
  return combat.lethalEligible ? `${label}，允许伤亡判定${suffix}` : `${label}，不允许直接击杀${suffix}`;
}

function formatTechnicalReason(reason: string): string {
  const labels: Record<string, string> = {
    close_active_duel: "近距离主动交火",
    shared_point_active_duel: "同点位主动交火",
    objective_actor_close_pressure: "下包/拆包目标承受近距离压力",
    line_of_fire_exposure: "枪线暴露",
    open_sight_no_cover: "开阔无掩体",
    same_point_exposure: "同点位暴露",
    objective_exposure: "包点/入口暴露",
    implicit_duel_from_movement: "移动触发隐式交火",
    cover_blocks_lethal: "掩体阻断致命升级",
    no_active_combat_action: "缺少主动交火动作",
    unknown_cell_distance: "缺少可审计距离",
    distance_exceeds_lethal_gate: "距离超过致命门槛",
    abstract_contact_only: "只有抽象区域或目标争夺",
    no_close_or_shared_fight: "没有近距离或同点位交火"
  };
  return labels[reason] ?? reason;
}

function formatAdoptionSide(
  side: FinanceEvidenceAdoptionSide | undefined,
  label: string
): string {
  if (!side) return `${label}旧 trace 未记录`;
  return side.acceptedEvidenceRefs.length > 0 ? `${label}${side.acceptedEvidenceRefs.join("、")}` : `${label}无正向采信`;
}

function formatRejectedEvidence(
  side: FinanceEvidenceAdoptionSide | undefined,
  label: string
): string {
  if (!side) return `${label}旧 trace 未记录`;
  return side.rejectedEvidenceRefs.length > 0 ? `${label}${side.rejectedEvidenceRefs.join("、")}` : `${label}无`;
}

function formatMissingEvidence(
  side: FinanceEvidenceAdoptionSide | undefined,
  label: string
): string {
  if (!side) return `${label}旧 trace 未记录`;
  return side.missingEvidenceApplied.length > 0 ? `${label}${side.missingEvidenceApplied.join("、")}` : `${label}无`;
}

function formatFinanceVerdict(value: string | undefined): string {
  if (value === "challenge_landed") return "挑战方击中关键主张";
  if (value === "thesis_defended") return "立场方判断暂时守住";
  if (value === "contested_no_finance_resolution") return "金融决策未分胜负";
  return value ?? "未记录";
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
  if (tab === "business") return "金融决策";
  if (tab === "llm") return "LLM 调用";
  if (tab === "combat") return "战斗裁定";
  if (tab === "economy") return "经济证据";
  if (tab === "winner") return "硬胜负";
  return "原始 JSON";
}
