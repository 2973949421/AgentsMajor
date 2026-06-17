# Phase 2.0-pre Combat Realism Freeze

## 1. Position

这份文档用于冻结 `Phase 2.0-pre` 当前已经确认的“对局真实性不足”问题，以及对应的后续修复方向。

## 0. N55 后窄范围解冻补丁

2026-06-17 在 N55 phase0 真实开局输出层完成后，用户人工验收又发现一个独立的战斗行为问题：远距离抽象接触可以直接击杀，而近距离贴脸接触有时长期只有压制。该问题不属于金融事实库、LLM 输出或 Web 展示，而属于 combat contact gate（战斗接触门槛）和 casualty gate（伤亡门槛）没有分层。

本补丁只做窄范围解冻：

```text
观察接触 -> 压制接触 -> 致命接触。
只有致命接触可以产生击杀。
远距离 site_contest / choke_contest / known_enemy / same_region 只能产生观察、压制或退让。
近距离或同点位高强度接触可以产生受伤、退让或击杀。
support participant 默认只能贡献助攻 / 压制，不轻易成为 killer。
金融采信为 0 时不得伪装成金融裁判胜利。
```

仍然不做的大改：

```text
不重写行动生成。
不调 AP、经济、KDA 记账或 hard winner。
不为了更刺激而用随机数制造战损。
不恢复 Node/Sector。
```

冻结含义：

```text
当前先不继续深修 combat realism，不在本阶段直接重写 killLedger 合成逻辑。
先把问题、证据、修复入口、解冻条件固定下来；
等经济系统、裁判约束、攻守胜法表达等上游条件补一版后，再回到这里正式实施。
```

这不是取消问题，而是防止在上游条件未完成时过早修复，导致：

- 修出更复杂的模板
- 前端观感变好但底层事实仍然不真实
- 击杀链和 judge / economy / round semantics 再次脱节

## 2. Freeze Scope

当前冻结的不是：

- `killLedger` 是否存在
- 悬浮栏 K/D 是否能读到
- `latestKill` 是否还显示 `未知`
- `killCount / casualtyDensity` 是否已经切到 ledger

这些链路已经基本接上，属于“结构正确性”问题，当前已阶段性解决。

当前冻结的是：

- 回合击杀关系不真实
- 交火像固定配对，而不像 5v5 网络式接触
- 区域推进、击杀顺序、参与面过于模板化

一句话概括：

```text
当前问题不再是“有没有 kill ledger”，而是“kill ledger 本身不像真实比赛”。
```

## 3. Confirmed Evidence

以最近有效 run `phase18_run_mou1748o` 为证据，已提交 8 个回合。

从实际 `killLedger` 统计看，存在极强的固定对位模式：

- `vitallmty_flamez -> falcon_7b_kyousuke`：8 次
- `falcon_7b_kyousuke -> vitallmty_flamez`：8 次
- `vitallmty_zywoo -> falcon_7b_niko`：8 次
- `falcon_7b_niko -> vitallmty_zywoo`：8 次
- `vitallmty_apex -> falcon_7b_m0nesy`：8 次
- `falcon_7b_m0nesy -> vitallmty_apex`：8 次
- `vitallmty_ropz -> falcon_7b_karrigan`：7 次
- `falcon_7b_karrigan -> vitallmty_ropz`：4 次
- `falcon_7b_teses -> vitallmty_mezii`：1 次

这说明当前回合交火不是“多人混战”，而是接近：

```text
固定排序后的 5 个 1v1 对位脚本
```

同时还能看到两个次级模板症状：

1. 时间戳高度固定  
   常见为 `8000 / 12200 / 16400 / 20600 / ...`

2. 区域推进高度固定  
   常见为：
   - 第一杀在 `buyer_mid`
   - 后续连续落在 `conversion_site_a` 或 `conversion_site_b`

因此，当前“假感”已经有充分证据，不是主观误判。

## 4. Root Cause

根因已经在代码层面定位清楚，核心入口在：

- [engine.ts](/B:/sharewithlight/LegendProject/AgentsMajor/packages/core/src/engine.ts:2506)

当前 `buildRoundKillLedger(...)` 的主要结构是：

1. 先把胜方选手和败方选手分别排序
2. 构造：
   - `winnerTargetPool = [...loserAgents]`
   - `loserTargetPool = [...winnerAgents]`
3. 再通过：
   - `winnerActorIndex++`
   - `winnerTargetIndex++`
   - `loserActorIndex++`
   - `loserTargetIndex++`
   顺序取人

这会天然产生：

- 胜方第 1 人总打败方第 1 人
- 胜方第 2 人总打败方第 2 人
- 败方也反过来一样

所以当前问题不是“前端算错了”，也不是“回放读错了”，而是：

```text
combat synthesis 本身就是按固定索引配对生成击杀。
```

## 5. Why We Freeze It Now

当前不立即深修，是因为这个问题依赖三个尚未完全收口的上游条件：

### 5.1 Economy

经济系统还没有从“轻语义标签”升级为真正影响：

- 谁敢接触
- 谁承担换人
- 谁更可能存活
- 全起 / 强起 / 半起 / ECO 对战损密度的真实影响

如果现在强行修 realism，大概率只能做出“更复杂的模板击杀链”。

### 5.2 Judge And Win Semantics

裁判约束和攻守胜法虽然已经在展示层更清晰，但还没有完全压进战斗事实生成。

如果现在先改击杀真实性，容易出现：

- 战斗更热闹
- 但判词与回合事实再次脱节

### 5.3 Tactics-To-Combat Mapping

现在 `team_plan / map proposition / initial-proposal` 对叙事层已有影响，但对：

- 谁先接触
- 谁补枪
- 谁残局
- 谁清场

的硬映射还不够。

在这一层没补强前，直接深修 realism，收益有限。

## 6. Deferred Repair Plan

后续正式解冻时，不从前端入手，而是从 `core combat synthesis` 入手，顺序固定如下：

### Phase A. Remove Fixed Pairing

第一刀先拆掉固定索引配对：

- 不再按 `winnerAgents[i] -> loserAgents[i]`
- 不再按镜像顺序互杀
- 引入更接近网络式接触关系的目标选择

### Phase B. Expand Contact Graph

让回合交火从“对位表”变成“接触网”：

- entry 可能先撞到 2-3 人
- support / IGL 会补枪
- lurker / AWPer 会延后进入
- 残局与转点会改变 target 分布

### Phase C. Bind To Economy

把 buy type 和真实战损挂钩：

- `fullBuy vs fullBuy` 更高概率高战损
- `fullBuy vs eco` 才允许明显低战损
- `forceBuy / halfBuy` 影响参与人数、换人深度与残局长度

### Phase D. Bind To Tactics

把地图与团队语义真正压到 combat facts：

- zone 不再只是换皮
- A/B/中路推进要改变接触顺序
- 不同 `team_plan` 要影响谁先死、谁补枪、谁收尾

## 7. Unfreeze Conditions

只有满足以下条件，才启动正式修复：

1. 经济系统至少有一版能真实影响回合生成
2. 攻守胜法与裁判约束已经稳定
3. `team_plan -> combat facts` 至少有一版硬映射
4. 当前 UI / replay 链路已稳定，不再反复返工基础数据口径

在这些条件未满足前，本问题保持冻结。

## 8. Acceptance Target After Unfreeze

后续正式修这个问题时，验收标准不能再是“有 ledger 就行”，而要满足：

1. 连续多个回合里，不再出现长期固定的 1v1 配对
2. 同一名选手要有机会在不同回合接触对方多名选手
3. 区域变化会真正改变接触顺序，而不是只换 `zoneId`
4. 战损密度与经济局势更一致
5. judge reason、回合摘要、K/D、胜法、战损能够互相解释

## 9. Parallel Non-Frozen Work

下面这些工作可以继续独立推进，不受本冻结影响：

- 选手卡片精简改版
- 胜法标签与战损标签展示优化
- 经济字段的 UI 占位接口
- 中文化与文案整理
- replay / run / reset / progress 等非 realism 基础链路稳定性修复

其中，选手卡片精简建议维持当前口径：

- 姓名
- 位置
- `K/D`（或 `K/D/A` 中的 `A` 暂留 `--`）
- HP 占位
- 总经济

## 10. 2026-05-30 Stability Addendum

最近完整真实样本 `phase18_run_mpqtbys9` 已经证明两件事必须先收口：

- `combat_resolution` 作为 LLM 完整事实草案时失败率过高，不能作为默认运行路径。
- 历史完整 run 必须可重复打开和审计，不能被最新 run 覆盖。

因此 Phase 2.0-pre 当前硬约束补充如下：

- 默认路径不调用 `combat_resolution` LLM；战斗事实由代码 deterministic resolver 生成并通过 validator 校验。
- `combat_resolution` LLM 只能作为显式 opt-in 的草案增强层，且不是最终事实源。
- 草案无效时不再产生每回合 repair 噪音；直接回退 deterministic resolver。
- `plannedDemoWinnerSideForMap()` 只允许显式 demo/test fallback 使用，真实 LLM run 不能静默落入预设赢家。
- `phase18_run_mpqtbys9` 保留为 Phase 2.0-pre 历史基准样本，用于回看、审计和稳定性对照；不得伪修复、覆盖或删除。

这不是正式解冻 combat realism，而是把最不稳定的 LLM combat 链路从默认事实路径中移除。正式解冻仍需满足第 7 节条件。
- 当前回合消费占位

## 10. Final Decision

当前结论固定为：

```text
问题成立，证据充分，入口清楚；
但本轮不立即深修，先冻结；
等经济系统、裁判约束、战术到战斗映射补一版后，再正式解冻处理。
```

## 11. Limited Unfreeze For v4 Stability

`phase20pre-prompt-contract-v5` 允许一次有限解冻，但范围只限于“上游条件补齐 + 代码验收 + 可回退 combat draft”，不是无条件深修节目级击杀真实感。

允许实施：

- 两段式 judge：`judge_verdict` 锁定胜法、区域、MVP 和 diagnostic，`judge_narrative` 只负责解释。
- `combat_resolution` 受限草案：LLM 可以提出非固定 1v1 的击杀链、爆弹事件、存活列表和残局标签。
- 代码校验器作为最终事实边界：校验胜法、生死、重复死亡、存活人数、下包/拆包/爆炸、区域一致性、`one_v_x` 条件和 MVP 击杀上限。
- deterministic fallback：combat draft 或 repair 失败时回退确定性 resolver，round 仍可提交，并标记 `source = deterministic_fallback`。

仍然禁止：

- 让 LLM 绕过代码校验直接写最终 combat facts。
- 前端伪造 HP、枪械、护甲、投掷物或雷达信息。
- 为了观感让 `roundWinType`、judge reason、summary、kill feed 和 combat resolution 互相矛盾。
- 把本次有限解冻扩大成完整枪械/HP/投掷物模拟。
