# N55 收口修正：phase0 真实开局输出层与局内行动隔离

## 1. 目标

本修正不新增 N，归属于 N55 收口。

要解决的问题是：N55 第一版虽然已经把“系统输入卡”和“真实 phase 输出摘要”分开，但比赛运行时仍缺少真实的 phase0 开局输出层。结果是：

- phase0 实际上仍像第一行动阶段。
- agent 容易在局内 phase 里继续混写金融观点和地图行动。
- 审计台虽然能区分输入卡和 phase 输出，却还没有用户要的“本局真实开局输出”。

本修正后的目标结构：

```text
phase0 / round-start：10 名 agent 真实生成本局开局输出
phase1+：只处理行动、目标、接触、交火、风险判断，并短句引用 phase0 输出
Web 审计：先看真实开局输出，再看后续 phase 如何引用它
```

## 2. 成功标准

- 每个新 round 都有 10 条 `roundStartAgentOutputs`。
- 每条输出都来自真实 response artifact 或 fixture response，不能由系统输入卡冒充。
- phase0 输出至少包含：
  - `openingStatementZh`
  - `evidenceRefs`
  - `riskBoundaryZh`
  - `buyConstraintAppliedZh`
  - `phaseActionCarryoverZh`
- phase1+ compact request 只发送：
  - 当前局势
  - 当前 agent 自己的 phase0 输出摘要
  - 极短的 round 主题提示
- phase1+ 如果大段复述 phase0 输出，必须记录 `phase_repeated_round_thesis`，并进入拒绝或降级。
- Web 主审计默认先显示“本局真实开局输出”。
- `agentOpeningBrief` 只能显示为“系统输入卡（非 agent 输出）”。

## 3. 当前实现口径

- 新增 `hex-round-start-agent-output.ts`，负责构造 round-start request、调用 provider、标准化结果、写入 request / response artifact。
- `HexRoundTrace` 新增 `roundStartAgentOutputs`，每 round 持久化 10 名 agent 的真实开局输出。
- `buildHexAgentCommandRequest()` 和 compact request 现在会附带当前 agent 自己的 `roundStartAgentOutput`。
- 阶段行动现在必须带 `roundStartOutputId`；缺失或错写时，系统只会修正到当前 agent 自己的输出，并记录：
  - `repaired_missing_roundStartOutputId`
  - `repaired_invalid_roundStartOutputId`
- `phase_repeated_round_thesis` 现在同时检测对真实开局输出的复述，而不只是系统输入卡。
- Web `humanAudit` 新增 `roundStartOutputDigests`，审计抽屉默认优先展示这层内容。

## 4. 审计展示边界

主视图顺序固定为：

```text
本局真实开局输出
-> 真实 LLM phase 输出摘要
-> 裁判采信链
-> hard winner
-> 开局输出输入材料（系统卡，非 agent 输出）
-> 技术细节
```

硬规则：

- 没有 response artifact 时必须显示“本局没有真实开局输出”，不能补写。
- 系统输入卡只能解释模型收到什么，不能解释 agent 实际说了什么。
- raw JSON、artifact id、agentId、cellId 继续保留在技术细节折叠区。

## 5. 验证要求

自动化：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/action/hex-agent-command-boundary.test.ts packages/core/src/hex-engine/action/hex-agent-command-harness.test.ts
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/round/hex-round-runner.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
cd apps/web
node node_modules/next/dist/bin/next build
```

人工验收：

1. 打开 `/hex-lab/match`。
2. 新建 Dust2 有色验收比赛。
3. 跑一个 real 或 fixture round。
4. 审计抽屉默认先看“本局真实开局输出”。
5. 进入 phase1+，检查行动只做短句引用，不再重写完整金融论文。

## 6. 回滚边界

- 如果 round-start provider 不稳定，允许保留 `provider_error` 状态，但不能用系统输入卡伪造成功。
- 如果 phase1+ 质量下降，可以恢复更短的 round 主题提示，但不能恢复完整金融长文本。
- 如果 Web 展示影响构建，先保留 server projection 和 artifact，再回退 TSX 展示层。
