# Phase 2.0-pre HexGrid 回合引擎 Runtime Contract（运行契约）

## 1. 文档定位

本文档是 `HexGrid（蜂巢格）` 新比赛引擎的长期 Runtime Contract（运行契约）。

它不属于 N20，也不属于 N21。它是 N21-N31 共同遵守的上层技术契约，用来回答：

- agent（智能体）每个 phase（阶段）到底能看到什么信息。
- LLM（大语言模型）能输出什么、不能输出什么。
- 代码如何约束地图路径、AP（行动点数）、经济、道具、状态和胜负。
- phase 如何动态推进。
- combat（战斗）如何裁定。
- 经济系统如何接入。
- 前端和报告如何审计整个过程。

后续任何 schema（结构定义）、runtime（运行时）、front-end（前端）、LLM boundary（大语言模型边界）、combat resolver（战斗裁定器）和 report bridge（报告桥接）设计，都必须先对齐本文档。

## 2. 当前已确认原则

### 2.1 Agent 信息输入原则

每个 agent 每个 phase 的 LLM request（大语言模型请求）可以包含：

- 当前地图位置：
  - `cell（蜂巢格）`
  - `region（区域）`
  - `point（点位）`
- 当前可走范围：
  - 本 phase 内理论可达区域。
  - 不可达区域。
  - 路径成本。
- 当前 AP：
  - 本 phase 基础 AP。
  - 已消耗 AP。
  - 剩余 AP。
  - 移动成本和动作成本。
- 本队 round plan（本回合计划）。
- 自己的 role（角色）：
  - IGL（指挥）
  - entry（突破）
  - AWPer（狙击手）
  - support（辅助）
  - anchor（锚点）
  - lurker（摸点/断后）
- 自己负责的商业职责。
- 队友已知位置和任务。
- 当前经济、装备、道具。
- 上一 phase 的自己行动和结果。
- 上一 phase 的队友变化和已知敌方变化。
- 当前 phase 的目标。
- coach（教练）提示或 timeout（暂停）修正。

敌人信息必须严格限制：

- 同一区域发生接触时，可以知道该敌人的瞬时位置。
- 发生交火时，可以知道参与交火敌人的瞬时位置。
- 通过侦察、道具、队友报告确认时，可以知道敌人的瞬时信息。
- 未确认的敌人位置不能提供给 agent。
- 敌人位置信息不是永久透视；敌方转点后，旧信息会衰减或失效。
- 旧信息只能以 `lastSeen（最后可见）`、`confidence（置信度）`、`staleAfterPhase（失效阶段）` 形式存在。
- agent 不能把旧位置当作当前确定位置。

静态地图知识默认开放：

- agent 默认知道整张地图的静态结构。
- agent 默认知道 region/point 名称、常规路线、包点、出生点、常规 timing（时机）。
- agent 默认知道哪些路线适合 AWP（狙击枪）、entry（突破）、support（辅助）、lurk（摸点/断后）。
- 这些是正常 CS 玩家应具备的地图常识。
- 静态地图知识不等于实时敌人信息；敌人位置仍必须来自交火、侦察或队友报告。

路线合理性需要单独表达：

- 代码负责判断路线是否可达。
- LLM 需要解释选择路线的 tacticalIntent（战术意图）和 businessIntent（商业意图）。
- validator（校验器）可以拒绝明显违背角色、经济、队伍计划或地图常识的路线。
- 例如 AWPer 无支援冲近点、低经济完整 execute_site（进点执行）、队伍打 B 但无理由单人跑 A 大，都应进入 routeReasonability（路线合理性）审查。

### 2.2 LLM 输出边界

LLM 只能输出行动草案。

允许输出：

- `actionType（动作类型）`
- `targetCell（目标蜂巢格）`
- `targetRegion（目标区域）`
- `targetPoint（目标点位）`
- `apCostIntent（预期 AP 消耗）`
- `tacticalIntent（CS 战术意图）`
- `businessIntent（商业意图）`
- `utilityIntent（道具意图）`
- `coordinationIntent（协同意图）`
- `riskNotes（风险说明）`
- `fallbackPlan（失败备用方案）`

禁止输出：

- `winner（胜方）`
- `roundWinType（回合胜利方式）`
- `kill ledger（击杀记录）`
- `bomb result（下包/爆炸/拆包结果）`
- `economy change（经济变化）`
- 直接写“我击杀了谁”。
- 直接写“我赢下了这个回合”。
- 修改自己到非法位置。
- 使用自己没有的道具。
- 编造敌人位置。
- 修改 AP、经济、装备、地图结构。

允许 LLM 写：

- 尝试击杀。
- 寻找对枪机会。
- 尝试压制。
- 尝试补枪。
- 尝试打开突破口。

但实际击杀、伤亡、包状态、胜负结果必须由代码中的 `Combat Resolver（战斗裁定器）` 和 `WinConditionMaterializer（胜负条件物化器）` 裁定。

### 2.3 AP 基础原则

AP 是每个 phase 的行动预算，不是整回合一次性预算。

已确认：

- 每个 agent 每个 phase 的 AP 范围是 `3 -> 0`。
- AP 每个 phase 重置。
- AP 允许小数。
- AP 不默认结转到下一 phase。
- 50x50 蜂巢画布中的“一格”不能直接等于 1 AP。
- 必须设计 `grid distance to AP（格距到行动点）` 汇率。

已确认第一版汇率：

- `10 cells = 1 AP`。
- 50x50 是最大地图画布，不代表每格都是一个行动点。
- 后续可以通过配置调整汇率，但 N21-N24 第一版按 10:1 设计 schema 和测试。

移动 AP 的设计原则：

- 移动成本来自实际蜂巢距离。
- 小范围调整位置不应消耗过高。
- 跨区域移动应明显更贵。
- 第一版不做武器、护甲、道具负载对移动速度的 AP 修正；CS 中可以切刀移动，移动速度先保持一致。
- 经济和装备影响输出强度、可用动作和 combat 输入，但不直接改变基础移动汇率。

AP 外的额外 timing（时机）限制应尽量少：

- phase 内可达范围主要由 pathfinding（寻路）和 AP 计算决定。
- 不额外叠加一套独立的“阶段可达性硬表”，避免规则冗余。
- 例外只包括硬状态：死亡、C4 状态、包点条件、地图不可走格、回合已结束。

第一版动作 AP 成本草案：

| actionType | AP 成本草案 | 说明 |
|---|---:|---|
| `move` | `distanceCells / 10` | 按蜂巢路径距离换算，可为小数 |
| `hold_position` | `0` 或 `0.5` | 免费动作边界待确认 |
| `watch_angle` | `0.5` 或 `1` | 架枪是否算免费动作待确认 |
| `peek` | `1` | 探身寻找对枪机会 |
| `gather_info` | `1` | 主动拿信息 |
| `use_utility` | `1` | 使用一件道具 |
| `map_control` | `1 + moveCost` | 控图通常包含移动和站位 |
| `prepare_trade` | `1` | 准备补枪位置 |
| `seek_duel` | `1` | 主动找对枪 |
| `execute_site` | `2` | 进点执行，通常包含配合和承压 |
| `plant_bomb` | `2` | 可在第 2 或第 3 phase 出现 |
| `defuse_bomb` | `2` | 必须满足 C4 和位置条件 |
| `retake` | `moveCost + 1` | 回防包含移动和进入交火状态 |
| `rotate` | `moveCost` | 转点按路径成本计算 |
| `save` | `moveCost` 或 `1` | 取决于是否需要移动到安全区域 |
| `lurk` | `moveCost + 0.5` | 摸点/断后 |
| `fake` | `1` | 假打制造误导 |
| `boost` | `1` | 双架需队友配合，具体协同后续细化 |
| `drop_weapon` | `0` | 发枪发生在第一 phase 前，不消耗 phase AP |

免费动作仍需单独确认，尤其是 `hold_position`、轻微转向、保持信息和低强度沟通。

### 2.4 标准动作表

第一版标准动作包括：

| actionType | 中文含义 | 说明 |
|---|---|---|
| `hold_position` | 守位 | 保持位置、守住角度或区域 |
| `move` | 移动 | 在合法路径上移动 |
| `watch_angle` | 架枪 | 持续看守一个角度 |
| `peek` | 探身 | 短暂探身寻找信息或对枪机会 |
| `gather_info` | 拿信息 | 获取区域/敌方动向信息 |
| `use_utility` | 使用道具 | 烟、闪、火、雷等 |
| `map_control` | 控图 | 争夺地图空间 |
| `prepare_trade` | 准备补枪 | 为队友建立补枪位置 |
| `seek_duel` | 主动找对枪 | 主动寻找交火机会 |
| `execute_site` | 进点执行 | 配合道具和队友进入包点 |
| `plant_bomb` | 下包 | T 方尝试下 C4 |
| `defuse_bomb` | 拆包 | CT 方尝试拆 C4 |
| `retake` | 回防 | CT 方回防包点 |
| `rotate` | 转点 | 根据局势转移目标区域 |
| `save` | 保枪 | 放弃争夺，保存武器/经济 |
| `lurk` | 摸点/断后 | 脱离主攻或主防阵型，寻找侧翼信息/机会 |
| `fake` | 假打 | 制造进攻方向误导 |
| `boost` | 双架 | 双人配合获得特殊视野或位置优势 |
| `drop_weapon` | 发枪 | 队内经济协作，把武器交给队友 |

动作表不能无限扩张。新增动作必须证明它无法由已有动作组合表达。

### 2.5 Phase 动态推进

默认最多 5 个 phase：

1. `default_opening（默认展开）`
2. `first_contact（第一接触）`
3. `mid_round_decision（中盘决策）`
4. `execute_or_retake（进点/回防）`
5. `post_plant_or_clutch（守包/拆包/残局）`

已确认：

- 回合最早可以在第 2 phase 结束。
- 回合最晚应在第 5 phase 结束。
- 下包不必等到第 5 phase。
- 第 2 或第 3 phase 就可能进入下包尝试。
- 如果提前下包，后续 phase 应切换为守包/回防/拆包逻辑。
- phase 是动态的，但数量限制是 `2-5`。

后续必须实现 `phase transition algorithm（阶段转换算法）`：

- 若一方全灭，立即结束回合。
- 若 T 方取得可下包位置且 C4 携带者具备 AP，可进入下包分支。
- 若 C4 已下包，后续 phase 优先进入守包/回防/拆包。
- 若 T 方失去有效进攻条件，可能进入保枪或时间失败分支。
- 若 CT 方失去拆包条件，可能进入守包成功或保枪分支。
- 下包后应自动转入残局/守包/拆包/回防为主的后续 phase，而不是继续普通中盘逻辑。
- 超时胜利应减少出现；正式 CS 中时间快结束通常会演化为保枪或拼死争夺，而不是经济均衡状态下无事实依据地超时。
- 保枪必须有事实依据，例如 T 已下包、CT 远距离 2v5 回防困难，或残局经济收益明显高于无望回防。
- 保枪成果转换为保枪存活方的固定额外经济收益；具体数值后续计算并写入经济契约。

### 2.6 状态继承

每个 phase 结束后必须写入下一 phase 可继承状态：

- agent 当前 cell/region/point。
- agent 生命状态：
  - `alive（存活）`
  - `wounded（受伤）`
  - `dead（死亡）`
- 当前武器。
- 当前道具剩余。
- 当前 AP 消耗摘要。
- 已知敌人信息。
- lastSeen 敌人信息及其置信度。
- 当前风险。
- 是否携带 C4。
- C4 是否已下包。
- C4 所在位置。
- 已发生交火。
- 已造成或受到伤害。
- 本 phase 行动是否成功。
- 商业计划执行情况。

第一版不使用精确 HP 数值。

原因：

- 每滴血级别的状态会过早增加复杂度。
- `alive/wounded/dead（三态）` 更容易审计。
- 后续可增加第四态，但不走逐点 HP 模拟。

### 2.7 Combat 裁定原则

Combat Resolver（战斗裁定器）不是纯 CS 枪法模拟，也不是纯文本裁判。

它必须体现 Agent Major 的本质：CS 空间中的商业计划、角色分工、攻守论证和执行质量对抗。

已确认的权重方向：

- 商业模式 / 攻守论证 / 计划漏洞 / 角色职责兑现：60%-70%。
- CS 动作、地图地理、道具、人数、装备等：40%-30%。
- Combat 本质不是纯枪法模拟，而是商业计划在 CS 空间中的对抗落点。

Combat 输入至少包括：

- 双方所在 cell 距离。
- 是否同一区域/相邻区域。
- 是否有视野。
- 掩体优势。
- 门口、狭道、高低差等空间优势。
- 人数与补枪位置。
- 武器等级。
- 道具影响。
- 经济状态。
- agent role。
- 队友 trade（补枪）能力。
- 是否被闪/烟/火影响。
- 是否符合本队商业计划。
- 攻方是否找到守方商业漏洞。
- 守方是否防住攻方质疑。
- LLM 行动意图质量。
- AP 和行动路径是否支持该交火。
- 攻方是否抓住守方商业计划漏洞。
- 守方是否顶住攻方商业质疑。
- 行动是否把本队商业职责真正带入当前点位对抗。

Combat 输出不能直接写最终 round winner，但可以输出：

- 局部交火胜负。
- 击杀/受伤结果。
- 压制、逼退、交换、被迫保守等非击杀结果。
- 区域控制变化。
- 商业计划证据。
- 角色职责兑现情况。
- 下一 phase 信息变化。

### 2.8 Audited Variance（可审计微随机）

已确认采用 audited variance（可审计微随机），但必须受严格限制。

它不是随机翻盘，也不是随机决定胜负。

设计原则：

- 主体裁定仍由商业计划、经济、地理、道具、角色、行动证据决定。
- 只有双方证据接近时才允许微随机介入。
- 明显优势不能被微随机推翻。
- 微随机必须记录进 trace（轨迹）。
- 微随机必须可复现。
- 微随机必须可关闭。
- 前端必须显示 variance（波动）影响了多少。

第一版建议：

- 默认 deterministic（确定性）评分。
- 若局部证据差距在阈值内，启用小幅 audited variance。
- variance 只影响局部 combat 输出，不直接决定 round winner。
- `randomSeed（随机种子）`、`varianceApplied（是否应用波动）`、`varianceDelta（波动幅度）` 必须写入报告。

禁止：

- 80:20 被随机翻成 20:80。
- 用随机数修比分。
- 用随机数制造模板翻盘。
- 隐藏随机影响。

### 2.9 经济系统接入

保留当前经济系统原则：

- 队内共享经济信息。
- 每个 agent 只能花自己的钱。
- 队友可以发枪。
- 经济以 round 为单位继承。
- 当前经济状态持续影响购买、道具、开局站位和战术选择。
- 第一版不模拟具体枪械细节，仍以 output token（输出额度）/商业输出强度作为主要抽象。
- 发枪发生在第一 phase 前，属于正式对局前买枪阶段，不消耗 AP。
- 开局进入第一 phase 时，发枪结果必须已经确定。

经济主要影响：

- 输出 token（输出额度）和武器质量抽象。
- 道具能力。
- 护甲能力。
- 可选 actionType。
- 商业模式输出强度。
- Combat 输入。
- 保枪/发枪/强起/eco 的决策。

经济不能：

- 直接决定 winner。
- 跳过 combat。
- 修改地图合法性。
- 让 agent 使用不存在的装备和道具。

发枪示例：

- 队伍 A 成员资金充足。
- 关键角色 B 需要更长 output token 承担核心商业输出。
- A 可以在第一 phase 前向 B 发枪。
- 系统在回合开始前完成资源分配。
- 第一 phase 的 agent 状态直接看到发枪后的结果。

保枪收益：

- 当前没有实际枪械逐件保留，因此保枪成果先转换为固定额外经济收益。
- 固定额外收益数值待单独确认。
- 保枪必须由事实触发，不能作为逃避正常回合裁定的默认出口。

### 2.10 商业底色与攻守论证

每个 action 都必须包含 `businessIntent（商业意图）`。

businessIntent 可以短，但不能缺失。

商业计划的作用：

- 判断攻方是否找到守方漏洞。
- 判断守方是否防住攻方质疑。
- 判断某个点位/阶段的小规模对抗谁占优。
- 影响 Combat Resolver 的局部裁定。
- 影响行动质量和风险解释。

商业计划不能：

- 直接裁定整回合 winner。
- 直接伪造击杀。
- 直接无视地图、AP、经济和道具。

最终胜负仍由 CS 硬条件裁定。

### 2.11 LLM 调用粒度

目标设计：

- 每个 agent 每个 phase 调用一次 LLM。
- 10 个 agent。
- 2-5 个 phase。
- 单回合 agent action LLM 调用量理论范围：20-50 次。

这个成本可以接受。

但禁止无效空跑：

- 死亡 agent 不调用行动 LLM。
- 无可行动空间且只需保留状态时，可以使用代码 fallback。
- AP 为 0 且没有可用动作时，不应调用。
- 当前 phase 已满足 hard end condition（硬结束条件）时，不继续调用后续 agent。

每次 LLM 调用必须可审计：

- request artifact。
- response artifact。
- accepted/rejected draft。
- fallback reason。
- validator result。
- AP 校验结果。

### 2.12 前端与报告要求

未来 `Hex Lab（蜂巢实验台）` 至少需要两个页面：

- `/hex-lab/editor`
  - 用于编辑地图。
  - 50x50 蜂巢画布。
  - Dust2 底图叠加。
  - 可比赛格选择。
  - 在已成型地图区域内划分 region（大区块）。
  - 在 region 内标注 point（点位）。
  - 标注 bombsite（包点）、spawn（出生点）、choke（狭道）、cover（掩体）、route hint（路线提示）。
  - 支持画笔、橡皮擦、区域填色、点位命名、合法性校验。
  - 保存/加载 JSON。
- `/hex-lab/match`
  - 用于观测比赛。
  - 展示 10 个 player（选手）基础情况，参考旧引擎的选手面板。
  - 展示地图点位和每个 phase 状态。
  - 展示每个 phase。
  - 展示每个 agent 的位置、AP、行动草案。
  - AP 纳入选手状态面板。
  - phase 展示为进度条。
  - 已知敌人和 lastSeen（最后可见）敌人使用特殊标记。
  - 展示被拒原因和 fallback。
  - 展示 combat 裁定证据。
  - 展示经济变化。
  - 展示最终 hard win condition。
  - 展示 LLM 调用情况、调用进度、request/response 摘要、accepted/rejected draft。

报告必须包含：

- 每个 agent 每个 phase 的 request/response 摘要。
- 当前 cell/region/point。
- AP 消耗。
- action validator 结果。
- combat evidence。
- audited variance 记录。
- economy state。
- businessIntent。
- hard win condition。

## 3. 根本原则封板确认

以下原则已经确认，不应在 N21-N31 的普通计划中反复回滚讨论。若要推翻，必须单独更新本文档并说明原因。

1. 采用 `audited variance（可审计微随机）`。
   - 只在证据接近时介入。
   - 必须可复现、可关闭、可展示。
   - 不允许用随机数修比分或制造无证据翻盘。

2. Combat（战斗）核心方向确认。
   - 商业模式 / 攻守论证 / 计划漏洞 / 角色职责兑现占 `60%-70%`。
   - CS 地理 / 道具 / 人数 / 装备 / 动作执行占 `40%-30%`。
   - 商业计划不直接裁定整回合 winner（胜方），但会显著影响局部 combat 裁定。

3. AP（行动点数）大方向确认。
   - 第一版 `10 cells = 1 AP`。
   - 每 phase（阶段）重置。
   - 范围 `3 -> 0`。
   - 允许小数。
   - 后续通过测试和实际跑局校准，不在 N21 前继续深挖。

4. LLM（大语言模型）调用粒度确认。
   - 目标是每 agent（智能体）每 phase 调一次。
   - 死亡、AP 为 0、回合已结束、没有有效行动时不空跑。
   - LLM 只输出行动草案，不输出击杀、经济变化或最终胜负。

5. 旧 Node/Sector 删除态度确认。
   - 旧 NodeGraph（节点图）/ SectorMap（区块图）路线已经冻结。
   - 不再扩展旧路线。
   - 按 N29/N30/N31 分阶段删除旧 Node/Sector 实验层。

6. 前端优先级确认。
   - `/hex-lab/editor` 优先级很高。
   - 先让用户能画 50x50 HexGrid（蜂巢格）地图、划 region（区域）、标 point（点位）、包点和出生点。
   - `/hex-lab/match` 随 runtime（运行时）推进逐步完善。

7. 实现策略确认。
   - 不做低配简化版来骗过流程。
   - 允许先搭理想结构的数据骨架，再通过实现、测试和真实跑局持续 debug（调试）。
   - 后续细节通过可审计 trace（轨迹）和测试校准，而不是在纸面上无限推演。

基于以上确认，当前 Runtime Contract 第一版已经足够支撑进入 N21：HexGrid Schema（蜂巢格结构）。

## 4. 实现校准项

以下内容不阻塞 N21，但需要在 N21-N31 的实现、测试和人工验收中逐步校准并回写本文档：

- 免费动作边界：`hold_position`、轻微转向、低强度沟通是否消耗 AP。
- 每个 actionType 的最终 AP 成本。
- phase transition algorithm 的精确条件。
- Combat Resolver 的初始评分公式。
- audited variance 的阈值和最大波动幅度。
- 经济系统到 Hex 装备/道具的字段映射。
- 发枪的具体触发条件和资源转移字段。
- 保枪固定额外经济收益的具体数值。
- C4 下包/拆包 AP 和 phase 条件。
- `wounded（受伤）` 对战斗和道具使用的影响。
- Hex trace 和 RoundReport 的最终字段结构。

这些内容不应阻止 schema 起步，但每次落地具体值时都要有测试、trace 或人工验收依据。

## 5. 后续执行规则

- N21-N31 的每个计划必须引用本文档。
- 如果实现中发现本文档不适配，应先更新 Runtime Contract，再改 schema/runtime。
- 不允许在单个 N 阶段里绕过本文档直接新增比赛规则。
- 不允许复活旧 Node/Sector 规则来填补 Hex 规则空缺。
- 不允许把 LLM 输出直接当事实提交。
- 不允许用随机数修比分。

## 6. 旧实验新引擎与 HexEngine 边界

当前仓库中已经存在一套实验新引擎：

- `packages/core/src/node-engine/`
- Node Lab（节点实验台）
- `node-graph.json`
- `sector-map.json`
- node round experimental commit（节点单回合实验提交）
- node map experimental runner（节点地图实验运行器）
- local node judge（局部节点裁判）
- node action shadow（节点行动影子模式）
- sector display（区块展示）

这套系统不是旧 `Phase18`，但也不是未来 HexGrid（蜂巢格）终局方向。它属于中间实验层。

### 6.1 过渡期判断

旧实验新引擎不能继续作为第二条主线扩张。

它可以作为经验来源：

- artifact（产物）记录。
- request/response（请求/响应）审计。
- fallback（降级）记录。
- real/fixture provider（真实/夹具供应方）切换经验。
- Web progress（运行进度）展示经验。
- RoundReport bridge（回合报告桥接）经验。
- economy/output（经济/输出）系统接入经验。
- team context（队伍上下文）和 coach context（教练上下文）接入经验。
- LLM boundary（大语言模型边界）校验思想。

它不能作为未来主线 runtime（运行时）：

- 不能继续扩 `node-graph.json`。
- 不能继续扩 `sector-map.json`。
- 不能继续扩 `local-node-judge`。
- 不能继续把 AP 建在 node edge（节点边）上。
- 不能把 HexGrid 套在 node-engine 外层当壳。
- 不能让 node trace（节点轨迹）和 hex trace（蜂巢轨迹）混成同一种报告语义。

### 6.2 目录与 import 边界

N21 起必须采用清晰目录隔离：

- Hex 主线 runtime 放在 `packages/core/src/hex-engine/`。
- Hex 结构定义可放在 `packages/shared/src/hex-schemas.ts` 或后续拆分的 shared hex 目录。
- Hex 地图资产放在 `data/materials/processed/maps/<mapSlug>/hex/`。
- Hex 前端实验台使用 `/hex-lab/*`。

禁止：

- 在 `packages/core/src/node-engine/` 中新增 HexGrid 主线逻辑。
- 从 `hex-engine` import（导入）旧 `node-engine/action`、`node-engine/judge`、`node-engine/graph`、`node-engine/sector` runtime 模块。
- 从 Hex schema 复用旧 node/sector schema 作为主结构。
- 让 Hex pathfinding（寻路）依赖 `node-graph.json`。
- 让 Hex AP 依赖旧 node edge 成本。
- 让 Hex combat 依赖 `local-node-judge` 作为主裁定器。

允许：

- 复制并改写 artifact/audit/fallback 的实现思路。
- 复用 economy/output、team context、coach context 的非 node/sector 业务能力。
- 通过 adapter（适配器）读取旧 round/report 经验，但不得把旧 node trace 当 Hex trace。
- 在测试中对比旧 node/sector 输出，但不能让它成为 Hex runtime 依赖。

### 6.3 删除里程碑

删除不是立即执行，但必须保持方向明确：

- N21-N24：冻结旧 Node/Sector，不新增功能，不删除仍可运行路径。
- N25-N28：Hex runtime 逐步建立，仍不得 import 旧 node/sector runtime。
- N29：Hex 单回合能提交后，删除 Node Lab 主入口和旧 sector UI 主控。
- N30：Hex Dust2 完整地图能跑完后，删除旧 node/sector runtime 依赖。
- N31：删除旧 `node-engine` 中不再被引用的 action/judge/graph/sector 模块，并清理旧 Dust2 node/sector 资产。

如果 Hex 路线某阶段失败：

- 回退当前 Hex 阶段。
- 保留可审计失败证据。
- 不复活旧 Node/Sector 主线。
- 不把新规则补回 `node-engine`。
