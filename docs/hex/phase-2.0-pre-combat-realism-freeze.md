# Phase 2.0-pre Combat Realism Freeze

## 1. Position

这份文档用于冻结 `Phase 2.0-pre` 当前已经确认的“对局真实性不足”问题，以及对应的后续修复方向。

## 0. N55 后窄范围解冻补丁

2026-06-17 在 N55 phase0 真实开局输出层完成后，用户人工验收又发现一个独立的战斗行为问题：远距离抽象接触可以直接击杀，而近距离贴脸接触有时长期只有压制。该问题不属于金融事实库、LLM 输出或 Web 展示，而属于 combat contact gate（战斗接触门槛）和 casualty gate（伤亡门槛）没有分层。

2026-06-18 二次验收又暴露出新边界：上一版补丁把“显式主动战斗动作”和“距离 0-1”看得过重，导致开阔枪线、包点入口、下包 / 拆包附近、同点位无掩体相对这些 CS 中应当高烈度的接触仍长期只有压制。因此本文件补充一次更窄的解冻：代码层必须识别枪线暴露、无掩体、同点位、目标暴露和移动触发的隐式交火。

本补丁只做窄范围解冻：

```text
观察接触 -> 压制接触 -> 致命接触。
只有致命接触可以产生击杀。
远距离 site_contest / choke_contest / known_enemy / same_region 只能产生观察、压制或退让。
近距离或同点位高强度接触可以产生受伤、退让或击杀。
开阔枪线、同点位无掩体、包点入口、下包 / 拆包附近可以把 move / rotate 升级为 implicit_duel。
有掩体或只是远距离同区域时，仍然阻断致命升级。
support participant（支援贡献者，combat 结构概念）默认只能贡献助攻 / 压制，不轻易成为 killer。
金融采信为 0 时不得伪装成金融裁判胜利。
```

2026-06-18 进一步补充第二个窄修：最新验收样本显示大量接触已经通过 `lethalEligible=true`，但因为双方总分差长期只有 0-3，旧结算仍要求 `margin >= 12` 才击杀，导致高烈度枪线继续停留在压制。现在冻结口径改为：`lethal` 门槛通过后进入对枪结算，`margin >= 3` 可以击杀，`margin 1-2` 至少形成受伤或退让，`margin 0` 时用直接对枪压力作确定性判定；只有双方直接对枪压力完全相等时才继续压制。直接对枪压力只统计非支援贡献者的直接参与者，`move / rotate` 进入隐式交火、主动 peek / execute / retake、同点位 / 开阔枪线 / 包点暴露、entry / star 标签 / AWPer / rifler 角色都会进入审计。非致命接触仍然不能击杀。

仍然不做的大改：

```text
不重写行动生成。
不调 AP、经济、KDA 记账或 hard winner。
不为了更刺激而用随机数制造战损。
不恢复 Node/Sector。
```

实现边界：

```text
Prompt 只负责让 agent 的局内行动更像想赢的 CS 选手：清点、抢枪线、补枪、换人、护包、拆包、转点或保枪。
Code 才负责判定枪线、暴露、掩体、致命接触和伤亡事实。
phase0 / roundStartAgentOutput 是本局材料依据。
phase1+ 是局内行动执行，只能短句引用 phase0，不能复述完整金融材料。
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
- 支援贡献者 / IGL 会补枪
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

## 10. fork-p1-cs-tactical-realism Narrow Patch

This fork is not a casualty-threshold change and does not unlock full combat resolver rewrites. It only improves the tactical inputs before combat:

```text
prior-round tactical summary -> current playbook selection -> anti-repeat penalty -> economy-aware route selection -> role route assignment -> Web tactical audit
```

Allowed changes:

- The round runner may read previous Hex trace `tacticalAudit` summaries for current route selection.
- `HexRoundTacticalPlan` may record anti-repeat reasons, economy adjustments, previous-round signals, anti-repeat regions / points, and role route assignments.
- The action request and compact request may pass only the current agent's role route and anti-repeat constraints to the LLM.
- The Web audit may display why the tactic was selected, which route was penalized, and how roles were split.

Still forbidden:

- Changing combat kill / wound thresholds.
- Letting the LLM write kills, deaths, hard winner, or KDA.
- Letting the frontend fabricate tactical facts.
- Treating a bad round as a credible match sample.

## 11. fork-p1-kill-attribution-realism Narrow Patch

该 fork 只修击杀归因集中问题，不改变接触门槛、伤亡门槛、hard winner、KDA 记账来源或金融裁判。

允许实施：

```text
round 内记录每个 agent 的击杀归因历史。
刚拿过击杀、尤其连续拿过击杀的 agent，在后续同局 contact 中降低 killer 优先级。
上一 phase 刚拿过击杀的 agent 继续降低主杀优先级。
IGL / 支援贡献者这类 setup 语境默认转为 assist / suppression，不轻易成为 killer。
当 setup 角色是唯一有效直接候选时，仍允许 fallback 为 killer，并必须写入审计原因。
```

仍然禁止：

```text
不按固定 quota 平均分配击杀。
不让 LLM 或前端写 killer / victim / assister。
不改变 lethal gate、kill threshold、combat verdict 或 hard winner。
不把支援贡献者直接踢出 contact；只限制其主杀归因权重。`phaseAttributionHistory` 只能由去重后最终落账的 combat resolutions 更新，不能记录同 phase 内随后会被 dedupe 删除的 casualty。
```

验收重点：

```text
同一局内不应长期由同一名 IGL / 支援贡献者或刚杀过人的 agent 收割所有击杀。
击杀归因应优先给直接对枪者，setup 角色更多进入助攻原因。
审计中必须能看到 recent_kill_deprioritized、last_phase_kill_deprioritized、role_setup_limited_to_assist 或 sole_direct_candidate_allowed。
```

## 12. N61 后行动急迫感、C4 收敛与主动交火窄修

本补丁不改变 combat kill threshold、lethal gate、KDA、经济或 hard winner。它只修有效 round 中“行动 accepted 但战术空转”的上游输入：

```text
phaseClock 进入 action request，让 agent 知道 totalPhases=5、remainingPhases 和 isFinalPhase。
C4 carrier 在 late / final 阶段的 route candidate 更偏向合法包点、包点路径和直接执行。
同一 round 内已访问 cell / region / point 会进入折返降权，防止 C4 在非包点之间来回跑。
危险 move 可被 normalizer 安全修复为 plant_bomb / defuse_bomb / retake / execute_site / seek_duel / peek，并写入 repairedFields。
每 round 对 spawn_t / spawn_ct 用稳定 seed 洗牌分配 5 个不重叠出生点，保证复盘可复现且不同 round 不死板。
```

验收重点：

```text
final 阶段 attack 未下包时，不再继续写“为后续准备”。
C4 中后期朝包点或包点路径收敛。
`no_active_combat_action` 不应继续因为危险区域纯 move 而大量出现。
出生点同 round 可复现、不同 round 有变化、同队不重叠。
```

仍然禁止：

```text
不伪造 plant。
不让 LLM 或前端写 kill / damage / winner。
不借行动急迫感修改金融裁判、经济、KDA 或 hard winner。
```
## 13. N62-N65 Post-review Combat Scope

GPT Pro 静态审查后的 combat 口径修正如下：N60 的安全隔离不能理解为“金融永远只做解释层”。正确目标是：Finance Judge 不直接写 kill / winner，但 N62 经济裁剪后的 submitted finance card 经 N59 采信后，必须在 N63 形成 `financeFirepowerScore` 并进入 combat 主评分。

修订后的解冻顺序固定为：

```text
N62：补 phase0 金融经济裁剪提交门，combat 不直接读 raw。
N63：financeFirepowerScore 进入 combat（已完成第一版）；内部拆为 pressureScore / lethalScore / totalScore / appliedToCombatScore / blockedLethalScore / caps；phase0 有效观点火力 60-70%，phase1+ CS 执行 30-40%。
N65-lite：在 N64 前先生成最小 duelPair / fireLane / objectiveExposure 与 pressureKey，防止压力继续累积在 side-level。
N64：基于 pressureKey 做持续对枪压力收敛；同点位、包点入口、开阔枪线连续接触不能无限纯压制。
N65-full：完整 N 对 N / 1 对 N 对枪配对；用 duel pairs / fire lanes 表达多人混战，不再只做 side-level winner + 单 target + 单 killer。
```

N63 的硬边界：

```text
financialResult != combat result。
no accepted evidence：financeFirepowerScore.pressureScore / lethalScore 均为 0，不得产生金融火力。
eco / full_eco submitted card 即使 raw 很强，也必须按 combatEffectCap 限制 lethalScore。
cover_blocks_lethal / distance_exceeds_lethal_gate 仍阻断 kill，金融火力不能穿掩体杀人。
kill 仍必须通过 contact gate、lethal gate、casualty gate。
```

N65-lite 的最低结构：

```text
ContactCandidate：agentA、agentB、contactType、distance、lineOfSight、coverState、actionMatch、roleMatch、lethalEligible、pressureEligible。
DuelPair：pairId、primaryAgentId、targetAgentId、laneId、objectiveId、directnessScore、lethalGateStatus、pressureKey。
pressureKey 只能来自 duelPairId / fireLaneId / objectiveExposureId / cellContactId，不能只用 team / side / region。
```

N64 的压力规则：

```text
pressure accumulation 必须基于 N65-lite pressureKey。
reset：pair 不再 contact、LoS 被 cover / smoke / wall 切断、任一方 forced_back 成功、任一方 rotate 离开 fire lane、victim 已 casualty、new round starts。
decay：contact 断开 1 phase，pressure -X；contact 断开 2 phase，pressure 清零。
wound 第一版只作为 audit-only intermediate effect，不引入 HP / injury 状态机。
tactical bad choice 进入 actionQualityWarning / urgencyFailure，通常不导致 invalid_round；例如 final phase T 有 C4 在包点却不 plant，应正常输 timeout/no_plant，而不是让回合无效。
```

N64 implementation note（2026-06-28）：当前实现只按 N65-lite pressureKey 在同一 contact 链路内累积压力；缺席 1 phase 衰减，缺席 2 phase 清零，forced_back 降低压力，casualty 清理 key；pressure delta 不能绕过 lethal / casualty gate。N64b-2 只补 contested pressure tie-break：`contested_suppression` 不再一律拒绝 pressure；若同一 cell_contact / objective_exposure / fire_lane 连续接触、streak >= 2 且 pre-pressure scoreboard 有轻微领先方，可应用受限 delta。非致命或 cover / distance blocked 只能推动 suppression / forced_back，不允许 kill。

N65-full implementation note（2026-06-29）：当前实现保留 N65-lite 的 granular pressure key，不按 side / region 合并。contact builder 会把同一 pressure scope 下的多个 direct pair 合并为 multi-pair contact，并写入 `combatShape`、`primaryDuelPairId`、`secondaryDuelPairIds`、`supportContributorAgentIds`、`outnumberedAgentIds` 与 `multiPairReasons`。resolver 只用这些字段调整 killer / assist / suppression 归因排序，不降低 lethal gate 或 casualty gate；N61 检查 支援贡献者 primary violation、duplicate victim casualty、missing primary duel 和 pressure key regression。
N65-full 的硬边界：

```text
1v1：按 financeFirepower + tacticalExecution + lethal gate 判主 duel。
1vN：单人若无 cover / escape / strong firepower，应触发 surrounded pressure，更容易 forced_back / wound_pressure / killed。
NvN：按距离、枪线、同点位、包点入口和角色动作生成 duel pairs / fire lanes；多余贡献转为 assist / suppression。
支援贡献者 / IGL fallback killer 必须同时满足：lethal gate passed、direct contact exists、no entry/rifler/AWPer direct candidate、actionType 不是纯 gather_info / rotate / map_control，并写明 sole_direct_candidate_allowed。
AWPer long-range kill 必须满足：open line、distance in AWP lethal band、cover not blocking lethal、actionType in watch_angle / peek / seek_duel。
每个 victim 每 phase 最多最终落账一次 casualty；attribution history 只记录 dedupe 后结果。
不允许随机制造战损，不允许 LLM 或前端写 casualty。
```

## N63a 状态补充（2026-06-26）

- N59 裁判结果现在记录 `acceptedEvidenceRefsByItemId`，把被采信的 claim / challenge 映射到实际 accepted evidence refs。
- N63 金融火力现在只从当前 contact participant 的 submitted card + N59 item-evidence 映射取证据；缺映射时不会退回 side-level 平均分配。
- Web 审计已把 `rawFinanceOpinionZh` 改称“模型输出的可提交原文”，完整 LLM response 只在 artifact 可读时作为技术细节核对。
- N61 验收脚本已支持 `{ source, trace }` wrapper，并增加 N63a 映射缺失 / 火力未应用检查。

## N64 / N65 v0.1 冻结与后续表现路线

N64 / N65 已经完成当前 v0.1 范围：pressure audit 覆盖、pressure scope 稳定化、contested pressure tie-break、multi-pair contact 和支援贡献者 / IGL 主杀限制均已接入。根据 2-7 map 与最近 5 张 map 的验收，当前不继续解冻 combat pressure 或多人归因。

冻结后的允许修复：

```text
安全 bug。
N61 误判。
审计字段缺失。
Web 投影无法读取已有事实。
同 victim 同 phase 最终重复落账等硬错误。
```

冻结后的禁止修复：

```text
不继续调 pressure 数值。
不继续扩 N65 多人归因。
不降低 lethal gate / casualty gate。
不通过随机制造战损恢复老 Phase18 的趣味性。
不把 side / region 粗 pressure 拉回主链路。
```

下一阶段的战斗相关方向不是继续改 combat gate，而是通过 N67 行动 / 目标 / 经济行为制造更真实的接触机会，再通过 N68 可信表现方差增强合法接触中的选手差异。换句话说：先让职业队像职业队那样走位、执行、保枪、赌点、爆点，再考虑选手状态如何影响合法对枪结果。

## N67 implementation note（2026-07-02）

N67 第一版已经接入行动层，不解冻 combat gate：

```text
objectivePressure 进入 action request / compact request，用于提示 phase3-5 的 C4、包点、回防、拆包、主动对枪、补枪或保枪决策。
economyActionStyle 进入行动候选排序，表达 eco / force / full buy 的打法倾向，但不写死战术模板。
C4 dropped / carrier / bombsite objective 会影响路线候选；掉包恢复只对附近、可达或职责相关 T 加权。
低经济主动动作只在 late / objective 强上下文中有限放行；execute_site、plant、defuse 仍受既有 validator 和状态约束。
objectiveBehaviorAudit 只作为中后期空转、C4 recovery 和经济打法的审计信号，不改变 hard winner、KDA、combat lethal gate 或 casualty gate。
```

## N67-role implementation note（2026-07-02）

N67-role 只统一角色口径，不解冻 combat gate：

```text
局内 CS 主角色：IGL / AWPer / rifler / lurker / entry。
star：英文前缀或标签，不是第六主角色。
support / anchor / flex / stand_in：旧资产兼容为标签或状态，不再作为主角色。
supportContributorAgentIds / supportParticipant：combat 支援贡献结构字段，不是选手身份。
金融专家角色：独立于 CS 主角色，不混入 combat 主角色判断。新生成 active roster 应让每队五名上场选手各占一个主角色；展示层主角色保持英文。
```

归因规则保持：支援贡献者 / IGL 只有在唯一有效直接候选时才可 fallback killer，并必须写明 `sole_direct_candidate_allowed`；本轮不改变 lethal gate、casualty gate、N64/N65、经济或 hard winner。