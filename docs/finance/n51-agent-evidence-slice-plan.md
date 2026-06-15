# N51：专家证据切片与开局信息卡差异化计划

## 1. 目标

本轮做 **N51：专家证据切片与开局信息卡差异化**。

N50 解决离线金融事实库。N51 解决另一个根问题：同一队伍 5 名 agent 的开局信息卡高度重复，金融角色经常无法体现，导致 PM、宏观、商品、公司、风控输出像同一个模板。

最终结果：

- 将 N50 fact bank（事实库）切成专家可用的 evidence slice（证据切片）。
- 每名 agent 获得符合自身金融职责的开局信息卡。
- 同队 5 人不能复制同一句自证 / 质疑。
- Web 能看到每名 agent 拿到哪些证据、负责什么问题。

## 2. 成功标准

N51 完成后必须满足：

- 每个 round 都能生成 10 份 `agentEvidenceSlice`。
- 五类角色至少覆盖：
  - PM / IGL：组合观点、配置权重、风险收益。
  - Macro / AWPer：宏观、全球价格锚、周期位置。
  - Commodity / entry：供需、品种、进出口线索。
  - Company / star rifler：公司池、行情、估值代理、盈利弹性。
  - Risk / support：反证、missingEvidence、仓位、止损、scoreCaps。
- `agentOpeningBrief` 必须引用自己的 evidence slice，而不是只复制 team thesis。
- 同一队伍 5 张信息卡的 `roleQuestionZh / usableFactsZh / evidenceRefs` 不应完全相同。
- finance role 不能默认为 `unknown`；缺失时必须从 `finance_agent_profile`、CS role 或安全 fallback 推断并记录原因。
- 不新增 agent 临场 API 调用。
- 不改战斗裁判、AP、economy、hard winner。

## 3. 已知上下文与初步判断

当前问题：

- N49 已生成 `roundOpeningBrief` 和 `agentOpeningBrief`，但内容主要来自 side thesis / challenge。
- 当前 agent role 映射不足，导致 role 可能是 `unknown`。
- 当前 `financeDuel.agentAssignments` 没有足够证据差异，Web 暴露为“同队复制”。

初步判断：

- 这不是 LLM 随机性问题，而是系统给每个 agent 的输入本来就太相似。
- N51 应在 prompt 前解决分工，不应期待 LLM 自己创造差异。

## 4. 范围边界

In scope：

- 新增 `agentEvidenceSlice` 生成逻辑。
- 从 team asset 的 `financeAgentRoster` 读取角色；缺失时用 CS role fallback。
- 改造 `agentOpeningBrief` 生成。
- Web 展示 agent 证据切片摘要。
- 增加重复度和角色识别测试。

Out of scope：

- 不拉取新 API。
- 不改变事实库格式主契约。
- 不改 combat scorer。
- 不改 Web 大布局。
- 不让前端编造差异化内容。

## 5. 技术实现路径

### A. 角色解析

角色来源优先级：

```text
finance_agent_profile.financeRole
finance_agent_profile.role
cs_role_profile
player role
安全 fallback
```

fallback 必须记录：

```text
roleFallbackReason
```

### B. 证据切片

从 N50 fact bank 和 round evidence pack 中按角色选择事实：

```text
PM：综合 FRED + BaoStock + scoreCaps，形成配置强度和风险收益问题。
Macro：FRED 全球金属价格、宏观变量、价格趋势。
Commodity：UN Comtrade 贸易线索；不可用时明确写贸易 / 库存证据缺失。
Company：BaoStock 公司、估值、市场反应。
Risk：missingEvidence、scoreCaps、UN unavailable、反证、止损。
```

AKShare 第一版只允许保留为 `registered_collector_not_used`，不能进入最终事实切片。

### C. 开局信息卡

`agentOpeningBrief` 增加或稳定：

```text
financeRole
financeRoleCn
sliceId
roleQuestionZh
evidenceRefs
usableFactsZh
evidenceBoundaryZh
proofOrChallengeZh
actionHintZh
roleFallbackReason
```

## 6. 分阶段执行步骤

1. 冻结基线
   检查 `git status --short`，排除 live replay 和日志。

2. 补角色解析测试
   覆盖 finance profile、CS role fallback、unknown fallback。

3. 实现 role resolver
   统一输出 `financeRole` 和 fallback reason。

4. 补证据切片测试
   确认每类角色拿到不同证据类型。

5. 实现 `agentEvidenceSlice`
   从 N50 fact bank、round evidence pack、team asset 和 economy context 切出 10 份角色证据。

6. 改造 opening brief
   让信息卡引用 slice。

7. 增加重复度保护
   同队 5 张卡完全相同时测试失败。

8. Web 展示切片摘要
   显示 role、证据编号、问题职责和边界。

9. 文档与验证
   更新 Finance 原型计划与 prompt 契约。

## 7. 预期改动清单

预计修改：

```text
packages/core/src/hex-engine/action/hex-round-opening-brief.ts
packages/core/src/hex-engine/finance/hex-round-finance-duel.ts
apps/web/app/server-hex-match-lab.ts
apps/web/tests/hex-match-lab.test.ts
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-data-asset-contract.md
```

可能新增：

```text
packages/core/src/hex-engine/finance/hex-agent-evidence-slice.ts
packages/core/src/hex-engine/finance/hex-agent-evidence-slice.test.ts
```

## 8. 风险、未知项与替代方案

风险：

- 事实库第一版事实不足，切片可能仍偏薄。
- 角色映射如果太硬，会误读队伍资产。
- Web 展示过多证据编号会变成调试页。

替代方案：

- 事实不足时用 missingEvidence / scoreCaps 形成风控切片，不伪造事实。
- role fallback 保守记录，不强行改 player asset。
- Web 默认显示中文摘要，编号折叠。

禁止尝试：

- 不让 LLM 自己发明角色事实。
- 不用随机文本制造差异。
- 不把同一个 evidenceRefs 原样塞给全队。

## 9. 自动化验证

必须运行：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/action/hex-round-opening-brief.test.ts packages/core/src/hex-engine/finance/hex-round-finance-duel.test.ts
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/finance/hex-agent-evidence-slice.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --fact-bank
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

新增测试：

- 10 名 agent 都有 `agentEvidenceSlice`。
- 同队 5 张信息卡不是完全复制。
- finance role 不应全部 unknown。
- Macro 切片必须可见 FRED 事实。
- Company 切片必须可见 BaoStock 事实。
- Commodity / Risk 必须能消费 UN unavailable 和 missingEvidence。
- missingEvidence 能进入 Risk / support 切片。

## 10. 人工验收流程

成功路径：

1. 跑一个 Dust2 有色 round。
2. 打开 Web 审计。
3. 查看 10 张开局信息卡。
4. 检查 PM / Macro / Commodity / Company / Risk 的问题和证据不同。

失败路径：

- 同队 5 人仍是同一句话。
- role 显示 unknown。
- 每个人引用同一组 evidenceRefs。

边界路径：

- 事实库缺少某类证据时，显示缺失证据和降权边界，而不是编造事实。

## 11. 阻塞性问题

当前无阻塞。

前提：

```text
N50 至少提供 fact bank 或现有 evidence pack 兜底。
```

## 12. 最小化与回滚策略

- 先做 role resolver 和 slice，不改裁判。
- 如果 Web 展示风险高，先只写入 trace。
- 如果切片质量不足，保留信息卡但标记 evidence insufficient。

## 13. 下一步交付物

N51 交付：

1. 专家角色解析。
2. 10 份 agent evidence slice。
3. 差异化 agentOpeningBrief。
4. Web 证据切片摘要。
5. 测试与文档。

N51 后进入：

```text
N52：回合信息层 / 局内行动层硬隔离。
```
