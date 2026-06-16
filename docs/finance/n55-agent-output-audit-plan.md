# N55 真实 LLM 输出人类审计摘要计划

## 1. 目标

N55 修正 N54 暴露出的审计口径问题：系统生成的 `agentOpeningBrief` 只能作为模型输入上下文，不能被主审计视图呈现为 agent 自己的输出。

本轮主目标是让 `/hex-lab/match` 默认展示真实 LLM response artifact 的人工可读摘要：

- 真实输出来源只能是 `hex_llm_response` artifact。
- 摘要从 `rawDraft / rawText / normalized / semanticLanguageAudit` 确定性提取。
- 没有 response artifact 时，必须显示“没有真实模型输出”。
- 系统输入卡默认折叠，并明确标注“非 agent 输出”。

## 2. 成功标准

- 主审计优先显示“真实 LLM 输出摘要”。
- 每条摘要都能追溯 request / response artifact。
- 摘要展示行动、理由、风险、证据引用、规范化、校验、裁判采信。
- fallback、provider error、旧 trace 缺字段不会被包装成 agent 输出。
- raw JSON、artifact id、agent id、cell id、英文枚举默认在技术细节里。
- 不新增 LLM 调用，不改 AP、经济、战斗、KDA 或 hard winner。

## 3. 实现口径

Web server 投影新增 `agentOutputDigests`：

```text
agentId
displayName
phaseIndex
source
rawOutputSummaryZh
declaredActionZh
declaredReasonZh
declaredEvidenceRefs
declaredRiskNotesZh
semanticLanguageSummaryZh
normalizationSummaryZh
validationSummaryZh
judgeAdoptionSummaryZh
technicalRefs
```

`source` 用于区分：

```text
llm_response_artifact
missing_response_artifact
provider_error
fixture_response
old_trace_missing
```

关键禁止项：

- 不用 `agentOpeningBrief.proofOrChallengeZh` 冒充 agent 原始理由。
- 不用 fallback 文案冒充真实模型输出。
- 不让前端编造 agent 没说过的论点。
- 不新增第二次 LLM 总结调用。

## 4. 验收方式

人工验收时打开 `/hex-lab/match`：

1. 选择一个新 real round。
2. 打开审计抽屉。
3. 默认应看到真实 LLM 输出摘要。
4. 若没有 response artifact，应看到“本阶段没有可审计的真实 agent 输出”。
5. 展开“系统输入卡（非 agent 输出）”，应能看到它被明确降级为输入上下文。
6. 展开技术细节，应能追溯 rawDraft、rawText preview、artifact id 和校验原因。

失败现象：

- 主审计仍先展示系统开局卡。
- 系统卡没有标注“非 agent 输出”。
- 没有 response artifact 却显示一段像 agent 输出的话。
- 用户必须读 raw JSON 才知道 agent 说了什么。

