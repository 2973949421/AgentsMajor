# N52：回合信息层 / 局内行动层硬隔离计划

## 1. 目标

本轮做 **N52：回合信息层 / 局内行动层硬隔离**。

N49 已经提出信息层和行动层分离，但最新审计说明仍可能出现 phase action 复述整段金融论点，或者把地图行动和金融作文混写。N52 要把这条边界变成硬契约和测试，而不是 UI 文案建议。

最终结果：

- 每 round 的金融信息在开局信息卡中确定。
- phase 内 agent 只输出局势行动、目标、风险和引用卡片。
- phase action 不能重新生成完整自证 / 质疑。
- 重复 round thesis 会进入警告或拒绝路径。

## 2. 成功标准

N52 完成后必须满足：

- compact request 不再携带完整 financeDuel 长文本，只携带当前 agent 的 `agentOpeningBrief` 摘要。
- phase action 输出必须包含 `briefRefId` 或等效引用。
- `businessIntent` 作为 legacy 字段时，只能表示本阶段行动理由，不能承载完整金融论文。
- phase 输出重复完整自证 / 质疑时，记录 `phase_repeated_round_thesis`。
- 多次 phase 不应生成新的 round-level finance thesis。
- 不新增额外 LLM 调用。
- 不改变裁判结果，只改变信息边界。

## 3. 已知上下文与初步判断

当前问题：

- 模型可能在每个 phase 重新写“金融观点”，造成上下文污染。
- 审计时用户看不清“开局观点”和“局内行动”边界。
- 同时处理信息和行动会让 agent 输出更像泛泛作文。

初步判断：

- 需要从 request、schema、validator、audit 四层同时约束。
- 单靠 prompt 提醒不够。

## 4. 范围边界

In scope：

- 修改 compact action request。
- 增加 `briefRefId` / `actionRationaleZh` 稳定策略。
- 增加重复 thesis 检测。
- 更新 prompt contract。
- Web 显示 action 引用的开局信息卡。

Out of scope：

- 不重做 financeDuel。
- 不改 evidence slice。
- 不改 combat scorer。
- 不改 Web 大布局。

## 5. 技术实现路径

### A. Request 边界

phase request 只给：

```text
当前局势
当前 agent opening brief 摘要
targetCandidates
AP / C4 / lastSeen
occupied / reserved cells
```

不再给：

```text
完整 financeDuel 长文本
全队完整开局信息卡
长篇历史 phase 文本
```

### B. 输出契约

输出字段：

```text
actionType
targetCellId
briefRefId
actionRationaleZh
riskNotes
```

兼容字段：

```text
businessIntent = 本阶段行动理由
```

### C. 重复检测

检测：

- phase 输出包含 defenseThesis / attackChallenge 大段重复。
- 语义长度明显超过行动理由边界。
- 没有引用 brief 却重写金融结论。

处理：

```text
phase_repeated_round_thesis warning
必要时 fallback / rejected
```

## 6. 分阶段执行步骤

1. 冻结基线
   检查工作区。

2. 补 request 测试
   确认 compact request 不包含完整 financeDuel 长文本。

3. 补 output 测试
   确认 `briefRefId` 可被接受和追踪。

4. 实现 request 裁剪
   只发送当前 agent 的信息卡和局势。

5. 实现重复 thesis 检测
   写入 warning / audit。

6. Web 展示引用关系
   phase action 显示“引用了哪张开局信息卡”。

7. 更新文档与验证。

## 7. 预期改动清单

预计修改：

```text
packages/core/src/hex-engine/action/hex-agent-command-boundary.ts
packages/core/src/hex-engine/action/hex-agent-command-harness.ts
apps/web/app/server-hex-match-lab.ts
apps/web/app/hex-lab/match/hex-match-audit-drawer.tsx
docs/hex/phase-2.0-pre-prompt-contract.md
docs/finance/finance-major-prototype-plan.md
```

## 8. 风险、未知项与替代方案

风险：

- request 太短，模型不知道金融任务。
- 检测太严，把正常短引用误判为重复。

替代方案：

- 保留守方 / 攻方一句话摘要，但不传完整长文本。
- 重复检测第一版只 warning，不直接 hard fail。

禁止尝试：

- 不让 phase action 重新写 round thesis。
- 不为了中文好看隐藏 raw action。

## 9. 自动化验证

必须运行：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/action/hex-agent-command-boundary.test.ts packages/core/src/hex-engine/action/hex-agent-command-harness.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

新增测试：

- compact request 不含完整 financeDuel。
- phase action 必须能引用 brief。
- 重复完整 thesis 触发 audit warning。

## 10. 人工验收流程

成功路径：

1. 跑一个 real round。
2. 打开任意 phase action。
3. 应看到行动、目标、风险、引用的信息卡。
4. 不应看到每 phase 重写完整金融论文。

失败路径：

- phase 里仍大段复述守方自证 / 攻方质疑。
- 看不到 brief 引用。

边界路径：

- 旧 trace 没有 briefRefId 时，显示旧 trace 未记录，页面不崩。

## 11. 阻塞性问题

当前无阻塞。

依赖：

```text
N51 提供稳定 agentOpeningBrief / slice。
```

## 12. 最小化与回滚策略

- 先 warning，后续再考虑 hard fail。
- 如果 real 输出质量下降，恢复一句话 summary，不恢复完整长文本。

## 13. 下一步交付物

N52 交付：

1. compact request 边界。
2. brief 引用输出。
3. 重复 thesis 审计。
4. Web 引用展示。
5. 测试与文档。

N52 后进入：

```text
N53：金融裁判证据采信事实化。
```
