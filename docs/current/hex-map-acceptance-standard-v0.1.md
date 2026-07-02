# Hex Map 验收标准 v0.1

## 1. 目的

这份文档固定当前 HexGrid / Finance Major 小样本地图的验收口径。它不是新规则实现计划，也不是继续新增 N 的路线图。

当前项目已经具备：

- P0 round 质量闸门。
- N62D 经济数字到 submitted 金融文本裁剪。
- N63 金融火力进入 combat。
- N64 pressure history / pressure scope。
- N65-full 多人对枪配对与归因审计。

从本标准开始，后续评估一张 map 不再只看单张截图或某个 round 的观感，而是按统一指标判断：

```text
pass：可以继续推进下一阶段。
watch：基本可用，但需要继续观察。
fail：当前主线存在必须修复的问题。
```

## 2. 当前事实基线

截至 N65-full 后，最近多张 real Dust2 有色 map 的共同事实是：

- provider invalid / hard invalid 已经不是主问题。
- `dead_agent_skipped` 已从 action quality 失败中剥离。
- C4 drop / pickup / plant / explosion / defuse 链路已经能被记录。
- N64 pressure audit 已覆盖 combat resolution。
- N65-full 的多人对枪字段已经接入，且未发现 support primary violation / duplicate victim casualty 的硬错误。
- 主要瓶颈从“事实链缺失”转向“整体比赛是否像一张能看的 CS map”。

当前不能把以下现象简单等同为 bug：

- 全歼比例高。
- 单个 round 没下包。
- eco 方主动打非常规。
- full buy 方未必每次都激进。

真正需要警惕的是：

- phase1-5 持续磨蹭，不执行、不接触、不恢复 C4、不制造目标压力。
- 多个 round 长期没有有效交火或 objective pressure。
- 经济系统只影响文本长度，而不影响风险偏好和行动风格。
- 审计只能证明字段存在，但解释不了“为什么这样赢 / 输”。

## 3. 样本口径

快速验收默认使用：

```text
1 张 map
6-9 个 round
```

里程碑验收再扩大到：

```text
3 张 map
18-27 个 round
```

单个 round 只用于定位问题，不作为整体系统是否合格的唯一依据。

## 4. 硬性失败条件

任一条件触发，当前 map 直接判为 `fail`：

- `invalid_round > 0`。
- `provider_degraded > 0`。
- N61 出现 hard fail。
- raw phase0 绕过 submitted gate 进入 N59 judge 或 N63 combat。
- support / IGL 在非唯一 direct candidate 情况下成为 primary killer。
- 同一 victim 在同一 phase 被重复落账 casualty。
- nonlethal / cover blocked / distance blocked contact 因 pressure 被直接打成 kill。
- pressure key 回退到 team / side / region 粗粒度。
- Web / server projection 无法打开最新 trace 或核心审计缺失。

## 5. Round 质量标准

### 5.1 Action degraded

`action_degraded` 不是绝对失败，但必须拆因。

快速验收建议：

```text
action_degraded round 占比 <= 40%
```

以下原因只审计，不计入真实 action degradation：

- `dead_agent_skipped`
- `ap_empty_agent_skipped`

以下原因仍算真实行动问题：

- `move_over_budget`
- `economy_disallows_action`
- `final_phase_future_setup_intent`
- `phase_repeated_round_thesis`
- final phase C4 可恢复 / 可下包但仍写未来铺垫。

### 5.2 Objective stall

用户不反感 `timeout_no_plant` 本身；真正失败的是便秘战术式空转。

判定 `objective_stall` 的重点：

```text
phase3-5 连续没有 execute / plant / recover C4 / deny plant / active duel / meaningful trade。
```

验收目标：

```text
timeout_no_plant <= 25%
objective_stall round <= 25%
```

如果 no plant 来自 T 全部阵亡、C4 unrecovered、CT 成功阻断或合理 save，不直接判失败；如果来自 5 个 phase 都在“为后续创造空间”，应判为 action / objective 问题。

## 6. C4 与胜负结构

本项目不人为控制胜负类型比例。

允许：

- 全歼超过 50%。
- attack elimination、defense elimination、bomb explosion、defuse、timeout 自然浮动。
- 不同经济局带来不同打法和不同胜负路径。

快速验收参考：

```text
plant-related round >= 40%
timeout_no_plant <= 25%
C4 dropped 后应能审计 dropped cell / pickup / unrecovered reason
```

如果一张 map 中 C4 多次掉落但无人恢复，必须能在 Web 和 trace 中看到原因：

- carrier 死亡。
- dropped cell。
- 附近 T 是否尝试恢复。
- final phase 是否 unrecovered。

## 7. 战斗密度与伤亡标准

目标不是无脑增加击杀，而是让 round 有可观战的对抗密度。

快速验收目标：

```text
平均每 round casualty：3-6 人
平均每 round combat resolution：12-25 个
contested_suppression 允许存在，但不能长期替代所有结果
```

低于目标时，优先检查：

- action 是否没有制造接触。
- route 是否长期绕路或折返。
- C4 / objective 是否断链。
- pressure streak 是否太少。

高于目标时，优先检查：

- lethal gate 是否被绕过。
- cover / distance 是否失效。
- multi-pair 是否过度合并。
- support 是否抢主杀。

## 8. N64 / N65 冻结口径

N64 / N65 到 v0.1 为止冻结。

允许继续修：

- 明确的安全 bug。
- 审计字段缺失。
- N61 误判。
- Web 投影读不到已有事实。

不继续做：

- pressure 数值反复微调。
- 多人归因继续扩规则。
- 通过降低 kill threshold 制造效果。
- 把 side / region 粗粒度 pressure 拉回主链路。

如果后续 map 仍然不够精彩，优先看 action / objective / economy behavior，不再先调 N64 / N65。

## 9. 经济系统验收

经济系统不只验收 submitted 字数。

必须满足：

- raw 不直接进入 judge / combat。
- submitted budget 能由 spend / buy pattern / cut mode 解释。
- N59 accepted evidence 与 N63 finance firepower 可审计。
- eco / save / pistol / force / half / rifle / AWP 的风险偏好有差异。

重要原则：

```text
不要做刻板模板。
```

职业 CS 直觉示例：

- T eco 可以抱团爆一个点。
- CT eco 可以非常规前压、赌点、叠点或打 AB go。
- CT full 可以偏守点，也可以控图反清。
- T full 不一定每回合慢控，也可以快提速。
- force buy 花得狠时可以更激进，但火力上限仍受经济 cap 限制。

验收口径：

```text
经济影响行动风格，而不是决定固定脚本。
```

失败表现：

- 所有买型都同一套慢控。
- eco 永远缩着不动。
- full buy 永远无脑冲。
- LLM 文本自称高火力就绕过系统 cap。

## 10. Web 审计标准

当前 Web 审计台 v0.1 可接受，不做大重构。

最低要求：

- 能看到 round quality。
- 能看到 hard winner。
- 能看到 C4 carrier / dropped / pickup / plant / defuse。
- 能看到 submitted finance adoption。
- 能看到 finance firepower / CS execution。
- 能看到 pressure key / pressure audit。
- 能看到 multi-pair 主对枪、次级对枪、support contributor 和 attribution reason。
- 能看到 action quality warning 和 urgency failure。

Web 不需要在 v0.1 做成正式转播画面，但不能只靠 raw JSON 才能理解比赛。

## 11. Trace 播放 Tick 标准

当前 trace 播放大致是：

```text
round -> phase -> 刷新一次位置
```

这会让观感接近“每 phase 一跳”，不符合 CS 观战节奏。

目标播放口径改为：

```text
round -> phase -> phase 内移动 tick
```

### 11.1 Tick 生成规则

对每个 phase：

1. 读取本 phase 内每个 agent 的移动路径。
2. 计算本 phase 最大路径步数：

```text
phaseTickCount = max(agentPathLength)
```

3. 每个 tick 同步推进所有 agent：

```text
如果 agent 在该 tick 仍有下一步：移动到下一 cell。
如果 agent 路径已走完：停在最后 cell。
```

示例：

```text
A 本 phase 移动 10 步
B 本 phase 移动 5 步

phase 内生成 10 个 tick
tick 1-5：A / B 都移动
tick 6-10：B 停住，A 继续移动
```

### 11.2 事件挂载

非移动事件按事实挂载到最接近的 tick：

- C4 dropped：挂到 carrier death 或 movement 结束后的对应 tick。
- C4 pickup：挂到 agent 到达 dropped cell 的 tick。
- plant / defuse：挂到对应 action 完成 tick。
- combat resolution：挂到双方进入接触位置后的 tick。

如果 trace 缺少足够细的路径数据，播放器必须 fallback 到 phase 级 tick，并显示“旧 trace 未记录 phase 内移动 tick”，不能伪造路径。

### 11.3 播放验收

前端优化完成后应满足：

- phase 内不再整体瞬移。
- 路径短的 agent 会先停住，路径长的 agent 继续走。
- C4 / combat / plant 事件不会全部挤在 phase 末尾。
- 时间轴仍保留 phase 分段，方便审计。
- 播放器只消费 trace 事实，不反写比赛结果。

## 12. Map 级判定

### Pass

满足：

- 无硬性失败条件。
- casualty 平均 3-6。
- timeout_no_plant <= 25%。
- action_degraded <= 40%，且主要不是真实行动失败。
- objective_stall <= 25%。
- C4 / combat / economy / finance / pressure 审计可读。

### Watch

满足硬门槛，但存在：

- casualty 略低或略高。
- action_degraded 偏高但原因清楚。
- no plant 偏高但不是连续便秘战术。
- economy 行动风格差异不明显。
- N64 pressure / N65 multi-pair 存在但机会少。

### Fail

出现：

- 任一硬性失败条件。
- 多个 round phase3-5 持续空转。
- C4 多次断链且无审计。
- 经济系统无法解释 submitted / action / firepower 差异。
- Web 无法让人工判断 round 为什么赢或输。

## 13. 后续使用方式

每次 real map 验收应输出一份简短报告：

```text
mapId
roundCount
valid / degraded / invalid
winner distribution
casualty avg
combat avg
timeout_no_plant rate
objective_stall count
action_degraded causes
C4 continuity summary
economy behavior notes
N64 / N65 safety metrics
Web readability verdict
final verdict: pass / watch / fail
next action
```

后续是否继续修代码，以这份报告为准，不再只按单张截图或单个 round 体感推进。

## 14. 已知后续修改目标

当前已知后续修改目标按顺序固定为：

```text
N66：Trace Phase 内逐 tick 播放。
N67：Action / Objective / Economy Behavior 校准。
N68：可信选手表现方差。
```

N66 是前端播放体验改造，不改变比赛事实。N67 是当前最重要的后端行为方向，用来解决 action_degraded 偏高、phase 后段空转、C4 恢复不足和经济行为不够职业的问题。N68 是表现力增强，用来在不破坏审计链的前提下恢复老 Phase18 的趣味性和 KDA 随机起伏。


节奏约束：

```text
N66-N68 必须保持 N61-N65 级别的短迭代节奏。
一个 N 只解决一个主问题。
每个 N 完成后用 1 张 map / 6-9 round 快速验收。
不要把 N66 写成完整转播系统，不要把 N67 写成全战术 AI，不要把 N68 写成完整选手模拟器。
```

执行前提：

`	ext
N64 / N65 冻结。
先做 N66，因为它不造成连带影响。
N67 必须以 map 验收报告为输入，不凭单张截图调 prompt。
N68 必须等 N67 后再做，避免用随机爆发掩盖行动空转。
```
