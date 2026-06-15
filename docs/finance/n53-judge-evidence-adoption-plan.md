# N53：金融裁判证据采信事实化计划

> 实施状态：已完成第一版。N53 已把 evidence adoption（证据采信）写入 combat trace（战斗轨迹）和 Web 中文审计投影。后续 N54 负责用真实 round 样本做人工验收，不在本文件继续扩大范围。

## 1. 目标

本轮做 **N53：金融裁判证据采信事实化**。

N50-N52 解决事实库、专家切片和信息边界。N53 解决最关键的裁判问题：不能只因为字段存在、文本自信或措辞漂亮，就假装金融攻防真正影响了击杀、压制、退让和控图。

最终结果：

- 裁判必须明确采信了哪些证据、拒绝了哪些证据、缺了哪些证据。
- 金融裁定影响 combat 事实时必须有可追溯 evidence refs。
- fallback 文本、空泛文本、未引用证据的宏大判断不能作为正向金融证据。

## 2. 成功标准

N53 第一版已满足：

- 每个 combat resolution 输出：
  - `financeEvidenceAdoption.attack.acceptedEvidenceRefs`
  - `financeEvidenceAdoption.attack.rejectedEvidenceRefs`
  - `financeEvidenceAdoption.attack.missingEvidenceApplied`
  - `financeEvidenceAdoption.defense.acceptedEvidenceRefs`
  - `financeEvidenceAdoption.defense.rejectedEvidenceRefs`
  - `financeEvidenceAdoption.defense.missingEvidenceApplied`
  - `financeEvidenceAdoption.*.scoreCapRefs`
  - `financeReasonZh`
  - `csReasonZh`
- `challenge_landed` 必须说明攻方质疑击中了哪条假设或证据缺口。
- `thesis_defended` 必须说明守方用哪些证据守住了质疑。
- 无证据引用时 finance score 被封顶或降权。
- fallback 行动不能贡献正向 finance evidence。
- 击杀、压制、退让仍由金融裁判 + CS 证据共同产生。
- hard winner 仍只来自 win condition。

## 3. 已知上下文与初步判断

当前问题：

- 现有 trace 可能有 finance verdict 字段，但用户无法确认它是否真的用了证据。
- 字段存在不等于机制生效。
- 如果裁判只是看文本里有没有 financeIntent，就会回到“假大空裁判”。

初步判断：

- 需要把 evidence adoption（证据采信）变成 combat trace 的一等事实。
- Web 只负责展示，不能替裁判解释。

## 4. 范围边界

In scope：

- combat resolver 消费 evidence refs。
- 输出采信 / 拒绝 / 缺失证据。
- 击杀归因读取 finance contribution 和 CS contribution。
- Web 显示中文裁判链。
- 旧 trace 没有采信链时，Web 显示“旧 trace 未记录证据采信链”，不能伪造。

Out of scope：

- 不新增金融数据源。
- 不改 AP / economy / winner。
- 不让前端补裁判理由。
- 不用随机数修比分。

## 5. 技术实现路径

### A. 裁判输入

裁判读取：

```text
financeDuel
agentEvidenceSlice
briefRefId
actionRationaleZh
evidenceRefs
missingEvidence
scoreCaps
CS execution evidence
```

### B. 采信输出

新增或稳定：

```text
acceptedEvidenceRefs
rejectedEvidenceRefs
missingEvidenceApplied
financeVerdict
financeReasonZh
csReasonZh
financeScoreContribution
csScoreContribution
```

### C. 降权规则

降权条件：

- 没有 evidenceRefs。
- 引用不属于当前 agent slice。
- fallback 文本。
- 文本重复 round thesis 但没有行动证据。
- 使用 configured proxy fact 却声称强事实。

## 6. 分阶段执行步骤

1. 冻结基线。
2. 补采信测试：自证守住、质疑成立、证据不足。
3. 接入 evidence refs 到 combat resolver。
4. 实现 accepted / rejected / missing 输出。
5. 约束 fallback 和空泛文本不得正向计分。
6. 更新 kill / suppress / forcedBack 归因说明。
7. Web 展示采信链。
8. 文档和验证。

## 7. 预期改动清单

预计修改：

```text
packages/core/src/hex-engine/combat/hex-combat-resolver.ts
packages/core/src/hex-engine/combat/hex-combat-resolver.test.ts
packages/core/src/hex-engine/round/hex-round-runner.ts
apps/web/app/server-hex-match-lab.ts
apps/web/app/hex-lab/match/hex-match-audit-drawer.tsx
docs/hex/phase-2.0-pre-judge-audit-contract.md
docs/finance/finance-major-prototype-plan.md
```

## 8. 风险、未知项与替代方案

风险：

- 证据采信过严，导致多数交火 finance 未分胜负。
- 证据采信过宽，仍会奖励空话。
- configured proxy fact 与 offline observation 需要区别对待。

替代方案：

- 第一版允许 `contested_no_finance_resolution` 增多，但必须清楚显示原因。
- 对 configured proxy fact 设 score cap，不直接禁止。

禁止尝试：

- 不把字段存在当机制生效。
- 不让 fallback 加正向金融分。
- 不让 LLM 写击杀或 winner。

## 9. 自动化验证

必须运行：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/combat/hex-combat-resolver.test.ts packages/core/src/hex-engine/round/hex-round-runner.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

新增测试：

- 自证守住必须有 acceptedEvidenceRefs。
- 质疑成立必须说明挑战命中的假设。
- fallback 不能贡献正向 finance evidence。
- missingEvidence 会触发 score cap。

## 10. 人工验收流程

成功路径：

1. 跑一个 round。
2. 选择有交火的 phase。
3. 查看裁判链：
   - 哪些证据被采信。
   - 哪些证据被拒绝。
   - 缺哪些证据。
   - 为什么形成击杀 / 压制 / 退让。

失败路径：

- 只看到 `finance_intent_present` 这类机器原因。
- 看不到采信证据。
- fallback 也能赢金融裁判。

边界路径：

- 证据不足时，裁判应显示金融未分胜负，CS 证据仍可产生局部行动结果。

## 11. 阻塞性问题

当前无阻塞。

依赖：

```text
N51/N52 提供 evidence slice 和 brief 引用。
```

## 12. 最小化与回滚策略

- 第一版先把采信链写入 trace。
- 如果影响 KDA 过大，先 audit-only，再启用 kill attribution。
- 不回滚事实库和信息卡。

## 13. 第一版交付物

N53 已交付：

1. 金融证据采信 trace。
2. 裁判中文理由。
3. fallback / missing evidence 降权。
4. 击杀 / 压制 / 退让采信链。
5. Web 展示与测试。

N53 后进入：

```text
N54：中文人类审计与真实样本验收。
```
