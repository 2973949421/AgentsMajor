# N54：中文人类审计与真实样本验收计划

## 1. 目标

本轮做 **N54：中文人类审计与真实样本验收**。

N50-N53 会把事实库、专家切片、信息边界、裁判采信链接好。N54 的目标不是再加机制，而是用真实样本证明用户能读懂比赛：10 名选手本局拿到什么信息、提交什么行动、裁判采信什么证据、为什么形成击杀 / 压制 / 退让、最终胜负为什么来自硬条件。

## 2. 成功标准

N54 完成后必须满足：

- Web 默认审计为中文摘要，不以英文枚举、artifact id、cell id 为主。
- 每个 round 能展示：
  - 小主题。
  - 守方自证。
  - 攻方质疑。
  - 10 名选手证据切片。
  - phase 行动。
  - 裁判采信链。
  - hard winner。
- 提供 1-3 个真实 round 样本说明。
- 样本必须展示从“证据 -> 开局信息卡 -> 行动 -> 裁判 -> combat fact / winner”的链路。
- 技术细节保留折叠，不丢 raw trace。
- 不因为展示好看而隐藏 fallback、rejected、missing evidence。

## 3. 已知上下文与初步判断

当前问题：

- 用户不想看一堆英文和编码。
- 只看字段名无法判断机制是否生效。
- 需要真实 round 样本，而不是测试通过声明。

初步判断：

- N54 应作为验收 N，不继续增加底层规则。
- 如果 N54 暴露质量问题，应记录为后续 N，而不是在 N54 混改裁判。

## 4. 范围边界

In scope：

- Web 中文审计整理。
- 真实样本抽样说明。
- artifact / raw JSON 折叠。
- 验收报告。

Out of scope：

- 不改数据源。
- 不改裁判权重。
- 不改 AP / economy / winner。
- 不重做 UI 大布局。

## 5. 技术实现路径

### A. 中文审计结构

默认展示：

```text
本局主题
双方观点
10 人信息卡
阶段行动
裁判采信
战斗事实
硬胜负
```

技术细节折叠：

```text
artifact id
agent id
cell id
raw enum
raw JSON
```

### B. 样本验收报告

新增或更新验收文档，记录：

```text
round id
topic
defense thesis
attack challenge
sample agent briefs
sample actions
judge adoption
combat outcome
winner condition
known gaps
```

## 6. 分阶段执行步骤

1. 冻结基线。
2. 检查 Web 审计当前展示顺序。
3. 将中文摘要设为默认主视图。
4. 折叠技术字段。
5. 跑 1-3 个真实 round 或 fixture fallback 样本。
6. 写验收报告。
7. 更新文档和测试。

## 7. 预期改动清单

预计修改：

```text
apps/web/app/hex-lab/match/hex-match-audit-drawer.tsx
apps/web/app/server-hex-match-lab.ts
apps/web/tests/hex-match-lab.test.ts
docs/finance/
```

可能新增：

```text
docs/finance/n54-human-audit-validation-report.md
```

## 8. 风险、未知项与替代方案

风险：

- Web 摘要过度翻译，丢失技术事实。
- 真实 provider 不稳定。
- 样本质量仍不达标。

替代方案：

- 技术细节完整保留。
- provider 不可用时先用 fixture，但必须标注不是 real 样本。
- 质量不达标时记录 gap，不包装成功。

禁止尝试：

- 不编造样本。
- 不隐藏失败。
- 不让前端补裁判事实。

## 9. 自动化验证

必须运行：

```powershell
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

如 Web 改动较大：

```powershell
cd apps/web
node node_modules/next/dist/bin/next build
```

新增测试：

- 主审计显示中文小主题、双方观点、证据采信。
- raw artifact id 默认折叠。
- 缺失证据和 fallback 不被隐藏。

## 10. 人工验收流程

成功路径：

1. 打开 `/hex-lab/match`。
2. 跑一个金融验收 round。
3. 打开审计抽屉。
4. 先读中文摘要，不需要先看 raw id。
5. 展开技术细节可以追溯 artifact。

失败路径：

- 主视图还是英文枚举和编码。
- 看不到 10 人信息卡。
- 看不到证据采信链。
- 失败被包装成成功。

边界路径：

- 旧 trace 没有 N50-N53 字段时，显示旧 trace 未记录，不崩。

## 11. 阻塞性问题

当前无阻塞。

依赖：

```text
N50-N53 的字段和事实链。
```

## 12. 最小化与回滚策略

- 只改展示顺序和验收报告。
- 不改底层裁判。
- 如果中文摘要有误，回退对应映射，保留 raw。

## 13. 下一步交付物

N54 交付：

1. 中文默认审计视图。
2. 技术细节折叠。
3. 真实样本验收报告。
4. Web 测试。

N54 后再评估：

```text
N55：根据真实样本决定是否扩大到第二张行业地图，或继续修金融裁判质量。
```
