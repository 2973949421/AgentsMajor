# N38-N41：HexGrid 对局质量打磨连续计划

本文是 N38-N41 的固定执行口径。后续 agent 不得把 N38 重新解释为结构封板，也不得跳过 N38 直接做 Web 展示或新机制。当前目标是认真打磨 HexGrid 对局质量，让真实 LLM、商业攻防、C4 目标行动、战斗裁判、KDA 和 Web 审计形成可信闭环。

本计划的核心判断句：

```text
商业攻防决定为什么打，CS 位置决定怎么打，硬条件决定谁赢。
```

这句话不是展示文案，而是 N38-N41 的工程判断标准。后续修改如果只让页面更好看、字段更多、测试更绿，但不能说明商业攻防如何进入行动、交火和对局事实，就不能算真正贴合 HexGrid 主线。

HexGrid 对局事实链必须按以下顺序理解：

1. 商业计划攻防是比赛核心。
2. 每 round 有一个小主题。
3. 守方围绕小主题和自身资产提出防守自证。
4. 攻方围绕同一小主题和自身资产提出进攻质疑。
5. agent 行动承载各自的自证或质疑。
6. 交火处由战斗裁判判断：守方自证驳回质疑，还是攻方质疑成功。
7. 这个判断和 CS 位置证据共同形成击杀、压制、退让、控图。
8. 最终胜负仍只来自 hard condition（硬胜负条件）。

验收时不能只用“新增字段、接了 UI、测试通过”作为充分证明。N38-N41 每个阶段都要尽量保留一个可抽样解释的 round 样本，说明该阶段如何让上面的事实链更可信。若 real provider（真实供应器）当时不可用，可以用 fixture（夹具）样本替代，但必须保留 provider error / external blocked（外部阻断）证据，不能把失败包装成成功。

## 1. 目标

N35-N37 已经把 round 级商业攻防、战斗商业裁定、KDA 事实来源和 Web 审计骨架接入 HexGrid。但最近 real provider 小地图验收暴露出对局质量问题：

- `bomb_planted` 事件、`bombState.planted` 和最终 hard winner 不一致。
- real LLM 每 agent request 约 37k-39k tokens，成本过高。
- KDA 来源已变干净，但击杀归因仍偏向少数选手，助攻几乎没有。
- 商业攻防内容已经进入 trace，但 Web 和报告仍没有把“文斗”讲清楚。
- DeepSeek 是中文模型，但语义输出经常偏英文。

N38-N41 的目标是按依赖顺序修这些问题：

| 阶段 | 主题 | 目标 |
|---|---|---|
| N38 | Objective Fact Chain Repair（目标行动事实链修复） | 修复 C4 / 下包 / 拆包 / hard winner 一致性 |
| N39 | LLM Cost and Chinese Output Stabilization（调用成本与中文输出稳定） | request 减半，语义字段中文为主 |
| N40 | Role-aware Combat Attribution（角色感知战斗归因） | 枪男更多击杀，IGL/support 更多助攻和控制贡献 |
| N41 | Business Duel Review UX（商业攻防审计体验） | Web 可直接审“小主题 / 自证 / 质疑 / 裁判 / 胜负” |

各阶段和核心口径的关系：

- N38 保证“硬条件决定谁赢”不会被错误状态污染。（已完成第一版）
- N39 保证 LLM 能以更低成本、中文优先地表达自证 / 质疑行动。
- N40 保证“商业攻防 + CS 位置证据”真正进入击杀、助攻、压制和控图事实。
- N41 保证用户不用打开 raw JSON，也能看懂一回合的商业攻防链路。

N38 第一版落地结果：

```text
bomb_planted 事件只在 actor 存活、携带 C4、当前格等于目标格、目标格是合法包点时生成。
bombState reducer 再次校验 actor 必须站在 objective cell，防止绕过事件生成路径。
defuse reducer 校验防守方存活、C4 已下、未拆、且 defender 站在 plantedCellId。
被敌人占住导致 carrier 没能移动到包点时，不再写入虚假的 bomb_planted 成功事件。
```

N39 第一版落地结果：

```text
real provider 不再直接发送完整 HexAgentCommandRequest，而是发送 compact_match payload。
request artifact 同时保存 fullRequest 和 compactRequest，并写入尺寸压缩指标。
response artifact 写入 provider prompt token（若返回）和 semantic language audit。
businessIntent / tacticalIntent / riskNotes 要求中文语义；英文或混合语义记录 language_mismatch。
JSON 字段名、actionType、cell id、phaseId、agentId 继续保持英文代码标识。
```

N40 第一版落地结果：

```text
combat contact builder 从全互联候选改为关键接触保留，默认每 phase 保留最多 12 个关键 contact。
下包、拆包、掉包、包点争夺等 objective contact 优先保留，不被普通上限裁掉。
contact trace 写入 relevanceScore、retentionReasons 和 prunedCandidateCount，说明为什么保留或裁掉候选。
关键 contact 可纳入有限同侧支援者，让 prepare_trade / use_utility / map_control / watch_angle 等协作行动有助攻事实来源。
角色贡献只影响 killer / assister 归因排序：AWPer、star rifler、entry 更容易形成击杀贡献；IGL、support 更容易形成助攻或控图贡献。
role contribution 不写 hard winner，不覆盖商业证据和 CS 证据，不把 fallback 当正向贡献。
```

N41 第一版落地结果：

```text
Web progress projection 新增 businessReview，把 round 小主题、守方自证、攻方质疑、agent 商业职责、phase 行动故事、combat 裁判故事和 hard winner 串成一条可读审计链。
/hex-lab/match 的审计抽屉默认入口改为“商业攻防”，用户不打开 raw JSON 也能先看到本回合在争什么、谁在自证、谁在质疑、交火处怎么判。
LLM / combat / economy / hard winner 仍保留为分层标签，但商业攻防成为主线阅读入口。
前端只消费 trace / RoundReport / projection 中已有事实，不重新计算 winner、AP、combat、KDA 或 C4 状态。
```

## 2. 成功标准

N38 完成后：

- 只要 trace 中出现 `bomb_planted`，同 phase 或最终 phase 的 `bombState.planted` 必须为 `true`。
- `bomb_planted.cellId`、agent 最终格、`bombState.plantedCellId` 必须指向同一个合法 bombsite cell。
- final phase `bombState.planted=true` 时，不得输出 `timeout_no_plant`。
- `move -> plant_bomb` 自动修复必须满足 C4 carrier、alive、bombsite、AP/path 和明确 objective intent。
- 不允许出现“action 成功下包，但 hard winner 按未下包判定”的 trace。

N39 完成后：

- real provider 单 agent prompt token 目标从 37k-39k 降到 15k-22k，至少下降 40%。
- `businessIntent / riskRead / tacticalIntent / expectedContribution` 等语义字段默认要求中文。
- JSON 字段名、枚举、地图点位和 cell id 保持英文或代码标识。
- 英文语义输出必须记录 `language_mismatch` audit，Web 可显示原文和中文解释。
- request 压缩不得删除行动合法性所需的 AP、路径、目标候选、C4 状态、队友占用、lastSeen 摘要和当前商业职责。

N40 完成后：

- combat contact 数量不再出现每回合 80-100 个全互联噪声，默认每 phase 只保留最多 12 个关键接触。
- killer attribution 不再按 participant 顺序或接触网格偏置，而是读取行动、商业职责、CS 位置和角色贡献。
- AWPer / star rifler / entry 更容易拿击杀，但不能硬指定击杀。
- IGL / support 更容易拿助攻、控制贡献、trade setup 贡献。
- assist 不再长期为 0；但每次击杀最多 2 个 assister，且必须来自同侧有效贡献。
- KDA 仍只来自 combat trace，不允许前端猜或报告桥接层猜。

N41 完成后：

- 用户不打开 raw JSON，也能理解一回合在争什么。
- Web 明确展示小主题、守方自证、攻方质疑、选手职责、LLM 原文、规范化行动、系统修复、战斗商业裁判、CS 证据、hard winner。
- 商业攻防解释必须是中文优先。
- Web 不重新计算 winner、AP、combat、KDA 或 C4 状态。
- 至少能用一个 real round 样本说明：小主题是什么、守方如何自证、攻方如何质疑、agent 提交了什么行动、战斗裁判如何判、这些判断如何产生击杀 / 压制 / 退让 / 控图，以及最终 hard winner 为什么成立。

N41 第一版的验收重点不是 UI 装饰，而是阅读路径：商业攻防标签必须先解释 round story，再解释 phase action story，再解释 combat business story，最后回到 hard condition。Raw JSON 只能作为排查入口，不能再是理解回合的主要入口。

## 3. 已知上下文与初步判断

当前主线状态：

- HexGrid 是 Phase 2.0-pre 新比赛事实主线。
- N20-N34c 已完成 Hex map/path/state/action/combat/economy/round commit/map runner/Web 验收/旧 Node 清理。
- N35 已接入 `HexRoundBusinessDuel`：每张 Dust2 map 6 个小主题，上下半场复用并攻防互换。
- N36-N37 已接入 combat business verdict、击杀归因字段、LLM 稳定识别和 Web 审计骨架。
- Phase18 replay/live replay 只保留兼容播放线。
- Node/Sector runtime 已退役，不允许作为 Hex 缺口补丁来源。

最近 real 小地图盲测发现：

- R6 / R10 出现 `plant_bomb valid=true` 和 `bomb_planted` 事件，但最终 `bombState.planted=false` 且 winner 是 `timeout_no_plant`。
- 每回合 combat resolution 过多，绝大多数是 `contested_no_business_resolution`。
- KDA 击杀集中在少数选手，助攻为 0。
- LLM 输出能给方向，但结构仍依赖大量 repair。
- 语义输出偏英文，影响中文商业攻防审计。

初步判断：

- N38 必须先做，否则事实链不可信。
- N39 必须在继续扩大 real 验收前做，否则成本和语言不稳定会持续污染样本。
- N40 必须在 N38/N39 后做，否则 KDA 与 combat 噪声会继续误导对局真实性判断。
- N41 放在最后，因为 Web 应展示已修正的事实，而不是美化错误事实。
- N38-N41 不应被理解为 UI 美化链路，而是商业攻防事实链修复链路。UI 只是最后把事实讲清楚。

## 4. 范围边界

In scope：

- N38：C4、下包、拆包、objective window、bombState reducer、hard win condition 一致性。
- N39：real LLM request 压缩、中文语义输出约束、语言 mismatch 审计。
- N40：角色感知战斗归因、assist/control contribution、contact builder 收敛。
- N41：Web 商业攻防审计主线与中文解释。
- 每个 N 至少产出一个可解释样本或 fixture，说明它如何改善“商业攻防 -> 行动 -> 交火裁判 -> 对局事实”的链路。
- 测试、文档、人工 real 小样本验收。

Out of scope：

- 不恢复 Node/Sector。
- 不削减 Phase18 replay/live replay。
- 不做完整 16 队赛事。
- 不做新闻、奖项、生态建设。
- 不改 DB 大 schema。
- 不改 hard winner 原则。
- 不让 LLM 写 winner、kill、damage、economyDelta 或 DB fact。
- 不让前端伪造 HP、枪械、伤害、敌人真实位置或胜负。
- 不用随机数修比分或制造精彩效果。

## 5. 技术实现路径

### N38：目标行动事实链修复

核心模块：

- `packages/core/src/hex-engine/round/**`
- `packages/core/src/hex-engine/state/**`
- `packages/core/src/hex-engine/action/**`
- `packages/core/src/hex-engine/win-condition/**`
- `apps/web/app/server-hex-match-lab.ts`

实现要求：

- 区分原地 plant 和 move + plant。
- `plant_bomb` 的 action target、最终 agent cell、`bomb_planted.cellId`、`bombState.plantedCellId` 必须一致。
- objective window 只能在 combat 后对仍存活且条件合法的 actor 执行。
- 如果 actor 没到合法 bombsite，不能写 `bomb_planted`。
- 如果写入 `bomb_planted`，必须通过同一 reducer 更新 `bombState`。
- win condition 只读取 phase 后的最终 `memoryAfter.bombState`。
- `move_to_plant` repair 必须收窄，不能把普通 move 静默改造成 objective action。

### N39：调用成本与中文输出稳定

核心模块：

- `packages/core/src/hex-engine/action/hex-agent-command-boundary.ts`
- `packages/core/src/hex-engine/action/hex-agent-command-harness.ts`
- `packages/core/src/hex-engine/business/**`
- `docs/hex/phase-2.0-pre-prompt-contract.md`

实现要求：

- 新增 compact request builder 或 compact mode。
- round 级商业攻防只传摘要，不重复塞完整材料。
- phase request 只发当前 agent 必需上下文：
  - 当前职责。
  - 当前 cell / region / point。
  - AP 和可达候选 top N。
  - C4 状态。
  - 队友 occupied/reserved cell 摘要。
  - lastSeen top N，并明确是历史信息。
  - 当前路线变体和目标区域。
- request 保留 artifact id 以便回查完整上下文。
- prompt 明确要求语义字段中文输出。
- 如果语义字段英文过多，记录 `language_mismatch`，不直接包装成中文事实。

### N40：角色感知战斗归因与 contact 收敛

核心模块：

- `packages/core/src/hex-engine/combat/**`
- `packages/core/src/hex-engine/business/**`
- `apps/web/app/server-hex-match-lab.ts`
- `apps/web/app/hex-lab/match/**`

实现要求：

- 从 team material / agent role profile 读取角色：
  - IGL。
  - AWPer。
  - entry。
  - star rifler。
  - rifler。
  - support。
- killer score 加入 role contribution，但不能覆盖商业证据和 CS 证据。
- assist score 加入：
  - 同点位协同。
  - 同目标压制。
  - trade setup。
  - support action。
  - business support action。
- contact builder 收敛为关键接触：
  - carrier vs site anchor。
  - entry vs defender。
  - trade pair。
  - support contact。
  - retake / defuse / dropped C4 contest。
- 每 phase contact 数量应有软上限；超出时按 objective relevance、距离、视野、业务职责排序保留。

### N41：商业攻防审计主线

核心模块：

- `apps/web/app/hex-lab/match/**`
- `apps/web/app/server-hex-match-lab.ts`
- `docs/hex/phase-2.0-pre-judge-audit-contract.md`

实现要求：

- Round 顶部展示：
  - 小主题。
  - 守方自证。
  - 攻方质疑。
  - 当前半场与 mirror round。
- Player card 展示本回合商业职责摘要。
- Combat 审计展示：
  - 交火双方。
  - 守方自证点。
  - 攻方质疑点。
  - `businessVerdict`。
  - 中文解释。
  - CS 证据。
  - killer / target / assist。
- LLM 审计展示：
  - 原始输出。
  - 规范化行动。
  - 修复原因。
  - 被拒原因。
  - 中文解释。
- Raw JSON 默认折叠，不能作为主要验收入口。

## 6. 分阶段执行步骤

1. N38 冻结基线
   记录 `git status --short`，确认 N35-N37 已提交或 diff 清晰隔离。目的：避免在未固化的大工作区里继续叠事实链修复。

2. N38 写失败复现测试
   用 R6 / R10 类 fixture 覆盖：有 `bomb_planted` 事件但最终 `bombState.planted=false` 的矛盾。目的：先锁住硬 bug。

3. N38 修 objective window 和 bombState reducer
   保证 event、agent final cell、bombState、win condition 一致。目的：恢复比赛事实可信度。

4. N38 real 小样本验收
   跑至少 1 个 real round，抽查有 plant action 的 round。目的：确认真实 LLM 样本不再生成矛盾 trace。

5. N39 建立 token 基线
   抽样 3-5 个最新 request artifact，记录 prompt tokens。目的：压缩前后可量化。

6. N39 实现 compact request
   分层传递 round/phase/agent 必需上下文。目的：降成本但不丢合法性信息。

7. N39 增加中文输出约束和 language audit
   语义字段中文优先，英文输出可审计。目的：适配中文模型和中文验收。

8. N40 写角色归因测试
   覆盖 AWPer/star rifler/entry 更容易成为 killer，IGL/support 更容易成为 assist/control。目的：防止继续按排序刷杀。

9. N40 收敛 contact builder
   减少无意义 5v5 全互联。目的：降低裁判噪声。

10. N40 增强 assist/control contribution
    让协同不再全部消失在 KDA 之外。目的：提升真实 CS 对抗感。

11. N41 设计 Web 审计投影
    服务端 projection 提供 round business story、combat story、LLM story。目的：前端不临时猜字段。

12. N41 改 Web 展示
    把商业攻防作为主线，不以 raw JSON 为主要入口。目的：用户能直接审文斗。

13. N41 总体验收
    跑 real 小地图，按 N38-N41 成功标准逐项验收。目的：决定是否进入后续结构封板或继续质量打磨。

## 7. 预期改动清单

预计修改：

- `packages/core/src/hex-engine/state/**`
- `packages/core/src/hex-engine/round/**`
- `packages/core/src/hex-engine/action/**`
- `packages/core/src/hex-engine/combat/**`
- `packages/core/src/hex-engine/business/**`
- `apps/web/app/server-hex-match-lab.ts`
- `apps/web/app/hex-lab/match/**`
- `apps/web/tests/hex-match-lab.test.ts`
- `docs/hex/**`
- `docs/current/**`

预计不动：

- `packages/core/src/node-engine/**`，已经退役，不恢复。
- Phase18 replay / live replay。
- DB schema。
- AP 汇率。
- economy 参数。
- hard winner 原则。
- `data/materials/processed/teams/<team-slug>/initial-proposal.*` 的唯一入口规则。

## 8. 风险、未知项与替代方案

风险：

- N38 如果只修事件不修 reducer，仍会出现 trace 矛盾。
- N39 压缩过度会降低 LLM 行动质量。
- N40 角色权重过强会变成“枪男必杀”的假规则。
- N40 contact 收敛过度会让对抗变少。
- N41 如果展示过重，会重新变成文字墙。

控制策略：

- N38 以事实一致性测试为准，不以 Web 显示为准。
- N39 保留 full audit artifact，compact request 只影响发送给 LLM 的摘要。
- N40 角色只影响归因贡献，不直接决定 winner 或 casualty。
- N40 contact 保留 objective / site / C4 / trade 关键接触。
- N41 默认摘要优先，原始 JSON 折叠。

替代方案：

- 如果 N39 compact request 降低行动质量，保留 `audit_full` 和 `compact_match` 两档模式。
- 如果 N40 角色归因争议大，先只输出 role contribution audit，不影响 KDA。
- 如果 N41 Web 展示太重，先展示每 round 的关键 combat 样本，再逐步扩展。

禁止尝试：

- 不用随机数修比分。
- 不为了让 T 下包跳过 C4/bombsite/alive/AP/path 校验。
- 不为了让枪男多杀硬写 killer。
- 不让 LLM 直接写 kill、winner 或 economyDelta。
- 不让前端修正 trace 里的事实错误。
- 不用英文长段落替代中文商业攻防解释。
- 不用“字段已存在”冒充机制已经生效。
- 不用“UI 已展示”冒充裁判链路已经打通。

## 9. 自动化验证

N38 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/round/hex-round-runner.test.ts packages/core/src/hex-engine/state/hex-phase-memory.test.ts packages/core/src/hex-engine/win-condition/hex-win-condition-materializer.test.ts
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/commit/hex-round-experimental-committer.test.ts packages/core/src/hex-engine/map-runner/hex-map-experimental-runner.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

N39 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/action/hex-agent-command-boundary.test.ts packages/core/src/hex-engine/action/hex-agent-command-harness.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

N40 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/combat/hex-combat-resolver.test.ts packages/core/src/hex-engine/round/hex-round-runner.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

N41 必跑：

```powershell
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
cd apps/web
node node_modules/next/dist/bin/next build
```

每个 N 还要跑 architecture / schema 基线：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/architecture-boundary.test.ts packages/shared/src/schemas.test.ts
```

## 10. 人工验收流程

N38：

1. 打开 `/hex-lab/match`。
2. 跑 real 单回合或小地图。
3. 找到有 `plant_bomb` 的 round。
4. 检查 action、memoryEvent、bombState、hard winner。
5. 成功现象：下包成功时最终不是 `timeout_no_plant`。
6. 失败现象：仍出现 `bomb_planted` 但 `bombState.planted=false`。

N39：

1. 抽 3 个 request artifact。
2. 对比 prompt token 是否降到 15k-22k 左右。
3. 检查 `businessIntent / riskRead / tacticalIntent` 是否中文为主。
4. 成功现象：成本下降且行动仍可用。
5. 失败现象：成本没降，或压缩后大量 fallback。

N40：

1. 跑 6-10 个 real round。
2. 看 combat resolution 数量是否明显下降。
3. 看 KDA 是否更符合角色。
4. 看 assist 是否出现。
5. 成功现象：枪男更容易击杀，IGL/support 有助攻或控制贡献。
6. 失败现象：IGL 继续因排序刷杀，assist 继续全 0。

N41：

1. 打开 `/hex-lab/match`。
2. 不打开 raw JSON。
3. 只用 Web 页面判断本回合小主题、自证、质疑、裁判和胜负。
4. 成功现象：用户能直接看懂商业文斗链路。
5. 失败现象：仍必须打开 raw JSON 才知道裁判为什么判。
6. 抽样解释一个真实 round：小主题 -> 守方自证 -> 攻方质疑 -> agent 行动 -> 战斗裁判 -> 击杀 / 压制 / 退让 / 控图 -> hard winner。

## 11. 阻塞性问题

当前无产品阻塞。

执行前必须先确认：

- N35-N37 是否已按阶段提交。
- live replay 无关文件和 `.next-dev` 日志不得进入 N38-N41 提交。
- 如果 real provider 不可用，N38/N40 可用 fixture 完成核心事实测试；N39/N41 必须保留 provider error / external blocked 的可审计路径。

## 12. 最小化与回滚策略

- N38 只修目标行动事实链，不改 KDA 或 request。
- N39 只压 request 和语言，不改 combat 裁判。
- N40 只改 contact 与 attribution，不改 hard winner。
- N41 只改展示和投影，不让前端重算事实。
- 每个 N 单独提交。
- 如果某个 N 失败，只回滚该 N，不回滚前序阶段。
- 失败 trace、artifacts、LLM call 和错误信息必须保留。

## 13. 下一步交付物

N38 交付：

- objective window 一致性修复。
- `bomb_planted` / `bombState` / hard winner 回归测试。
- `move_to_plant` repair 边界收窄。
- 一个目标行动事实链样本，说明 hard condition 如何保持最终裁判权。
- N38 文档和单独提交。

N39 交付：

- compact request builder。
- token baseline 与压缩后对比。
- 中文语义输出规则。
- `language_mismatch` audit。
- 一个 LLM 输出样本，展示中文自证 / 质疑行动如何稳定进入规范化 action。
- N39 文档和单独提交。

N40 交付：

- role contribution。
- contact builder 收敛。
- assist/control contribution。
- KDA 角色分工验收。
- 一个 combat 样本，展示商业攻防和 CS 证据如何共同形成击杀、助攻、压制或退让。
- N40 文档和单独提交。

N41 交付：

- round business story Web projection。
- combat business story Web projection。
- LLM 原文/规范化/修复审计展示。
- 中文商业攻防审计主线。
- 一个不依赖 raw JSON 的真实 round 审计样本。
- N41 文档和单独提交。

N41 完成后再评估是否进入结构封板第二轮。结构封板不得在 N38-N41 之前抢跑。
