# N54：中文人类审计与真实样本验收计划

## 1. 目标

本轮做 **N54：中文人类审计与真实样本验收**。

N50-N53 已经把离线事实库、专家证据切片、信息 / 行动边界、金融裁判采信链接入 HexGrid。N54 不再新增底层裁判机制，而是验证并打磨“人能不能读懂真实对局”：

- 默认审计必须是中文摘要，而不是英文枚举、artifact id、cell id 和 raw JSON。
- 必须新跑 1-3 个 real round 样本，不只复用旧日志。
- 样本报告必须证明链路：小主题 -> 自证 / 质疑 -> 10 人信息卡 -> phase 行动 -> 证据采信 -> combat 事实 -> hard winner。
- 如果真实样本质量不达标，必须如实记录失败原因，不包装成功。

## 2. 成功标准

完成后必须满足：

- `/hex-lab/match` 审计抽屉默认进入中文可读链路。
- 主视图优先展示：
  - 本 round 小主题。
  - 守方自证。
  - 攻方质疑。
  - 10 名选手专家信息卡。
  - 当前 phase 行动与引用信息卡。
  - 裁判采信 / 未采信 / 缺失证据影响。
  - 金融裁判中文理由。
  - CS 执行中文理由。
  - hard winner 中文解释。
- raw artifact id、agent id、cell id、英文 enum、raw JSON 默认折叠在“技术细节”。
- 新跑 1-3 个 real round，并生成验收报告。
- 验收报告必须区分：
  - real provider 成功样本。
  - provider error / external blocked。
  - action rejected / fallback。
  - 证据采信不足。
  - 旧 trace 字段缺失。
- 不改 AP、economy、combat 权重、hard winner、KDA 归因规则。
- 不让前端编造裁判理由或比赛事实。

## 3. 已知上下文与初步判断

当前状态：

- N20-N53 已完成第一版。
- 当前下一步是 N54。
- 工作区有无关 live replay 改动和 `.next-dev` 日志，N54 不触碰。
- `server-hex-match-lab.ts` 已有 `humanAudit` 投影。
- `hex-match-audit-drawer.tsx` 已有金融攻防、LLM、战斗、经济、硬胜负标签。
- N53 已让 combat summary 暴露 `financeEvidenceAdoption`、`financeReasonZh`、`csReasonZh`。

初步判断：

- N54 是验收与展示收口，不应继续改底层裁判。
- 最大风险是“字段有了，但用户仍然只能读机器日志”。
- 新 real 样本可能失败；失败本身也要进入报告，不能算实现失败，除非页面无法清楚解释失败。

## 4. 范围边界

In scope：

- 调整审计抽屉默认阅读顺序。
- 补中文标签和中文失败解释。
- 折叠技术字段。
- 补 Web 测试锁定中文主视图。
- 新跑 1-3 个 real round。
- 写 N54 验收报告。
- 更新 current / priority / finance 文档状态。

Out of scope：

- 不新增金融数据源。
- 不重新拉 API。
- 不改 N50 fact bank。
- 不改 N51 evidence slice。
- 不改 N52 action boundary。
- 不改 N53 evidence adoption scoring。
- 不改 DB schema。
- 不恢复 Node/Sector。
- 不改 Phase18 replay / live replay。
- 不做大 UI 重构。

## 5. 技术实现路径

### A. Web 中文审计主视图

调整 `hex-match-audit-drawer.tsx`：

- “金融攻防”标签作为默认人类审计入口。
- 主卡片顺序固定为：
  1. 回合主题与双方观点。
  2. N54 样本质量摘要。
  3. 10 人开局信息卡。
  4. 当前 phase 行动。
  5. 战斗裁判采信链。
  6. hard winner。
  7. 技术细节折叠。
- 技术字段只出现在 `<details>` 内：
  - request / response artifact id。
  - raw enum。
  - raw reason。
  - raw JSON。
  - agentId / cellId / briefRefId。

### B. 中文投影补强

调整 `server-hex-match-lab.ts`：

- `humanAudit` 增加：
  - `roundValidationSummaryZh`
  - `phaseValidationSummaryZh`
  - `sampleQualityWarningsZh`
- 对旧 trace 缺字段统一显示：
  - “旧 trace 未记录开局信息卡”
  - “旧 trace 未记录证据采信链”
  - “旧 trace 未记录中文 CS 理由”
- 对 real provider 失败统一中文解释：
  - provider error
  - external blocked
  - schema rejected
  - fallback
  - missing evidence
  - no accepted evidence

### C. 新真实样本验收

实施时主动新跑 real 小样本：

- 默认跑 1 个 mapGame，最多 3 个 real round。
- 如果第 1 个 round 已经包含完整 N50-N53 字段，则可只保留 1 个成功样本。
- 如果第 1 个 round 失败，继续跑到最多 3 个，用于记录失败分类。
- 不为了样本好看重跑到满意；报告必须记录尝试次数、成功 / 失败原因。

如果当前执行环境因为网络沙箱或外部模型数据出站风险拒绝 real provider，则报告必须标注：

```text
real provider 未通过当前环境验收。
原因是 external blocked / provider error，而不是机制成功。
```

### D. 验收报告

新增或更新：

```text
docs/finance/n54-human-audit-validation-report.md
```

报告固定结构：

- 样本来源：real provider，新跑样本。
- mapGameId / roundNumber / provider mode / model。
- 是否具备完整 N50-N53 字段。
- 小主题、自证、质疑摘要。
- 抽样 2-3 名 agent 的信息卡和行动。
- 抽样 combat 的采信链。
- hard winner 来源。
- 质量结论：
  - 可人工验收。
  - 部分可验收。
  - 不可验收。
- 后续 gap，不在 N54 里偷修。

## 6. 分阶段执行步骤

1. 冻结基线
   执行 `git status --short`，确认 live replay 与 `.next-dev` 不属于本轮。

2. 补 Web 展示测试
   在 `hex-match-lab.test.ts` 锁定金融攻防标签、中文主视图、技术细节折叠、采信链中文标签和旧 trace 缺字段提示。

3. 补 humanAudit 投影字段
   让 server projection 输出 round / phase 验收摘要和样本质量警告，避免前端自己编理由。

4. 调整审计抽屉顺序
   把中文主链路放在最前，raw JSON、artifact id、agent id、cell id 只保留在技术细节中。

5. 补中文失败解释
   对 provider error、external blocked、fallback、missing evidence、no accepted evidence、old trace missing fields 做中文映射。

6. 运行自动化验证
   跑 Web 测试、typecheck，必要时跑 Next build。

7. 新跑 real 小样本
   新建 Dust2 有色验收比赛，跑 1-3 个 real round。失败也记录。

8. 写 N54 验收报告
   记录样本链路、成功 / 失败、已知 gap。

9. 最终验证与提交
   只提交 N54 相关文件，排除 live replay 和 `.next-dev`。

## 7. 预期改动清单

预计修改：

```text
apps/web/app/hex-lab/match/hex-match-audit-drawer.tsx
apps/web/app/hex-lab/match/hex-match-lab-client.tsx
apps/web/app/server-hex-match-lab.ts
apps/web/tests/hex-match-lab.test.ts
docs/finance/n54-human-audit-validation-plan.md
docs/current/current-state.md
docs/current/priority-roadmap.md
docs/finance/finance-major-prototype-plan.md
```

预计新增：

```text
docs/finance/n54-human-audit-validation-report.md
```

预计不动：

```text
packages/core/src/hex-engine/combat/**
packages/core/src/hex-engine/action/**
packages/core/src/hex-engine/finance/**
tools/finance-data/collectors/**
data/materials/generated/finance/fact-bank/**
apps/web/app/live-replay-player.tsx
apps/web/app/live-replay-player.module.css
apps/web/.next-dev-3001.log
apps/web/.next-dev-3001.err.log
```

## 8. 风险、未知项与替代方案

风险：

- real provider 失败，无法生成成功样本。
- Web 中文摘要过度包装，掩盖 raw trace。
- 真实样本显示 N53 采信链质量不足。
- 技术细节折叠后排查不方便。
- 为了验收报告不小心把失败包装成成功。

控制策略：

- provider 失败也写入报告，分类为 external / schema / action / evidence。
- 技术细节完整保留，不删除 raw。
- N54 不修底层裁判质量，只记录 gap。
- 如果 3 个 real round 都失败，N54 可交付“不可验收报告”，但必须说明失败原因和 N55 建议。
- 不重跑到满意，不挑样本造成功。

替代方案：

- 如果 real provider 不可用，先写 blocked 样本报告，但必须标注“不满足 real 成功验收”。
- 如果 Web 改动影响构建，先保留 server projection 和报告，UI 改动回滚到最小。
- 如果中文映射不完整，未覆盖 reason 显示“未翻译技术原因”，并保留 raw。

禁止尝试：

- 不编造真实样本。
- 不隐藏 fallback / rejected / missing evidence。
- 不让前端补裁判事实。
- 不改 hard winner。
- 不用旧 replay 当作新 finance 样本。
- 不因为样本难看而继续改 N53 规则。

## 9. 自动化验证

必须运行：

```powershell
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

如 TSX 或 server projection 改动较多，再跑：

```powershell
cd apps/web
node node_modules/next/dist/bin/next build
```

建议补跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/architecture-boundary.test.ts packages/shared/src/schemas.test.ts
```

新增测试场景：

- 主审计显示中文 round 小主题、自证、质疑。
- 主审计显示 10 人信息卡。
- 主审计显示采信证据、未采信证据、缺失证据影响。
- 技术细节使用 `<details>` 折叠。
- artifact id 默认不作为第一层主内容。
- 旧 trace 缺 N50-N53 字段时显示中文缺失提示。
- provider / fallback / rejected 的中文解释不被隐藏。

## 10. 人工验收流程

成功路径：

1. 打开 `/hex-lab/match`。
2. 新建 Dust2 有色验收比赛。
3. 跑 real round。
4. 打开审计抽屉。
5. 默认先读中文摘要。
6. 检查：
   - 10 人信息卡是否可见。
   - 每个 phase action 是否引用信息卡。
   - combat 是否显示采信 / 未采信 / 缺失证据。
   - 金融裁判理由与 CS 执行理由是否分开。
   - hard winner 是否明确来自硬条件。
7. 展开技术细节，确认 raw artifact / id / enum 仍可追溯。

失败路径：

- 默认仍是一堆英文 enum / artifact id。
- 看不到 10 人信息卡。
- 看不到证据采信链。
- fallback / rejected 被藏起来。
- Web 自己编造 trace 里没有的采信理由。
- 样本报告只写“成功”，不记录真实失败和 gap。

边界路径：

- provider 失败：页面和报告应显示 provider error 或 external blocked。
- 旧 trace：页面显示旧 trace 未记录，不崩。
- 无有效证据采信：页面显示金融未充分采信，不包装成金融胜利。
- 只有 CS 优势：页面显示 CS 执行理由，不伪装成金融采信胜利。

## 11. 阻塞性问题

当前无产品阻塞。

执行时需要注意：

```text
真实样本需要 real provider 可用。
如果 provider 不可用，N54 仍应完成 Web 中文审计整理和失败报告，但不能宣称 real 样本通过。
```

当前执行记录中的阻塞：

```text
沙箱内 real provider 请求被 EACCES 拦截。
外部执行因“真实对局提示词与资产内容会出站到外部 provider”被安全审查拒绝。
```

因此 N54 的代码与 Web 审计可完成，但真实成功样本需要用户在明确批准外部 provider 出站后手动或重新触发。

## 12. 最小化与回滚策略

- 只改 Web 中文展示、server 投影和验收报告。
- 不改 core 裁判。
- 不改行动生成。
- 不改数据源。
- 技术细节完整保留。

回滚策略：

- 如果中文主视图误导，回退该中文映射，保留 raw。
- 如果 UI 改动破坏构建，回退 TSX，保留报告与 server projection。
- 如果 real 样本失败，保留失败报告，不回滚 N50-N53。
- 如果验收报告暴露 N53 采信质量不足，记录为 N55，不在 N54 混修。

## 13. 下一步交付物

N54 交付：

1. 中文默认审计视图。
2. 技术细节折叠保留 raw。
3. provider / fallback / missing evidence 中文失败解释。
4. 新 real round 尝试记录。
5. N54 验收报告。
6. Web 测试与 typecheck。
7. 单独本地提交，排除 live replay 与 `.next-dev`。

N54 后再评估：

```text
N55：如果用户批准真实 provider 出站，则补真实成功样本；否则根据 blocked 报告继续做离线 / fixture 审计质量门槛。
```
