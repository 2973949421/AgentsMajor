# P / Phase 双线交付框架

## 1. 文档定位

这份文档定义 Agent Major 后续如何同时推进两条线：

```text
P 线（Priority Track）：
  模块优先级、契约文档、边界冻结。

Phase 线（Delivery Phase）：
  工程落地阶段、可运行成果、验收循环。
```

它解决的问题是：

```text
后续到底按 P0-P4 推进，还是按 Phase 0-4 推进？
哪些事情必须先补文档？
哪些事情可以先写代码？
每个阶段应该交付什么？
如何保证可复现、可审查、可修改？
P4 这种后期内容现在应该如何处理？
```

核心结论：

```text
P0-P4 是设计模块优先级。
Phase 0-4 是工程交付阶段。
二者互相勾稽，但不一一对应。
P2.1 完成后，进入“代码主线，文档随行”。
```

## 2. 两条线的职责

### 2.1 P 线：优先级模块

P 线回答：

```text
系统有哪些模块？
哪些模块的契约必须先定义？
哪些字段、事件、状态、接口是事实源？
哪些能力可以后置？
```

P 线产物是文档契约：

```text
领域模型（Domain Schema）
事件分类（Event Taxonomy）
规则赛制（Rules & Format）
回合战报契约（RoundReport Contract）
Token 经济（Token Economy）
大模型驾驶员契约（LLM Driver Contract）
比赛引擎说明（Simulation Engine）
本地持久化说明（Local Persistence）
直播时间线说明（Live Timeline）
```

P 线的验收标准：

```text
契约清楚。
上下游清楚。
事件和状态清楚。
非目标清楚。
变更影响清楚。
```

### 2.2 Phase 线：工程阶段

Phase 线回答：

```text
当前版本要跑出什么？
用什么命令可以复现？
生成了哪些数据？
哪些测试必须通过？
用户能看到什么结果？
```

Phase 线产物是可运行能力：

```text
工程骨架
schema / migration
fake provider
CLI replay
SQLite event log
单回合回放
单张地图
BO3
极简伪直播页
真实 LLM 接入
16 队赛事
Web 化部署
```

Phase 线的验收标准：

```text
能运行。
能复现。
能导出。
能审查。
能失败恢复。
能被下一阶段复用。
```

## 3. 基本关系

### 3.1 不一一对应

P 和 Phase 不是同一种划分：

```text
P0 / P1 / P2 / P3 / P4 = 模块契约优先级。
Phase 0 / Phase 1 / Phase 2 / Phase 3 / Phase 4 = 工程落地阶段。
```

示例：

```text
P4 是 Web 化相关文档模块。
Phase 4 是 Web 化工程阶段。
二者相关，但不是同一个对象。
```

### 3.2 勾稽方式

Phase 不能自由发明核心契约。每个 Phase 必须声明它消费哪些 P 文档：

```text
Phase 输入 = 已冻结 P 文档。
Phase 输出 = 可运行结果 + 必要的回填文档。
```

P 文档也不能无限脱离实现。每个 P 文档必须说明：

```text
它支撑哪个 Phase。
它阻塞哪个 Phase。
它是否已经被实现验证。
```

### 3.3 冻结等级

文档契约分三种状态：

```text
Frozen：
  工程实现必须遵守。修改前必须先更新文档并审查影响。

Draft：
  可以指导实现，但允许在实现中修正。

Reserved：
  只保留方向，不阻塞当前工程。
```

当前建议状态：

```text
P0 / P1：Frozen。
P2.1：完成后进入 Frozen。
P2.2：Frozen。
P2.3：Frozen for Phase 1。
P3：Reserved。
P4：Reserved，但接口意识必须保留。
```

## 4. 当前总推进策略

当前阶段已经完成：

```text
P0：事实源与边界层。
P1：最小比赛闭环。
P2.1：直播时间线说明。
P2.2：2D 战术地图说明。
P2.3：转播系统说明。
Phase 1.0：工程骨架。
Phase 1.1：单回合 replay。
Phase 1.2：单张地图 replay。
Phase 1.3：BO3 fake provider。
Phase 1.4：极简伪直播播放器基础版。
Phase 1.4 内容质量与事件可信度收口。
Phase 1.45：P2.2 / P2.3 契约代码落地。
Phase 1.5：真实 LLM 小范围接入。
Phase 1.6：区域化攻防回合协议。
Phase 1.7：Materials runtime integration 与角色契约升级。
```

当前必须先收口：

```text
Phase 1.7：已完成收口。
Phase 1.8：已完成工程收口。
Phase 1.9：已完成 UI 收口并暂时冻结。
```

已预留并进入下一步：

```text
Phase 2.0-pre：单图 / 定制 BO3 赛事语义校准。
```

当前进入：

```text
Phase 2.0-pre：单图 / 定制 BO3 赛事语义校准。
```

工作模式：

```text
代码主线，文档随行。
```

明确不做：

```text
不等 P3 / P4 全部完成后再开始代码。
不在 Phase 1 做完整 Web 化。
不在 Phase 1 做完整新闻站、奖项站、16 队赛事生态。
```

## 5. Phase 分解

### Phase 0：静态原型

状态：

```text
可选。
当前路线可以跳过，不阻塞 Phase 1。
```

目标：

```text
证明赛事视觉气质和伪直播页面感觉。
```

输入 P 文档：

```text
P0.2 事件分类。
P2.1 直播时间线。
```

输出：

```text
手写 timeline。
静态页面。
kill feed / 解说 / 弹幕 / 支持率静态展示。
```

验收：

```text
能播放一个手写回合。
不要求真实比赛引擎。
不要求 SQLite。
```

### Phase 1：本地 fake provider MVP

目标：

```text
在本地跑通最小比赛闭环。
```

Phase 1 输入 P 文档：

```text
P0.1 领域模型。
P0.2 事件分类。
P0.3 规则赛制。
P1.1 回合战报契约。
P1.2 Token 经济说明。
P1.3 大模型驾驶员契约。
P1.4 比赛引擎说明。
P1.5 本地持久化说明。
P2.1 直播时间线说明。
P2.2 2D 战术地图说明。
P2.3 转播系统说明。
```

Phase 1 不要求：

```text
真实 LLM。
完整 2D 战术地图。
复杂转播系统。
新闻媒体生态。
完整 16 队赛事。
Web 部署。
```

Phase 1 子阶段：

```text
Phase 1.0 工程骨架
Phase 1.1 单回合 replay
Phase 1.2 单张地图
Phase 1.3 BO3 fake provider
Phase 1.4 极简伪直播 demo
Phase 1.45 契约代码落地
Phase 1.5 真实 LLM 小范围接入
Phase 1.6 区域化攻防回合协议
Phase 1.7 Materials runtime integration 与角色契约升级
Phase 1.8 per-agent runtime LLM pilot
Phase 1.9 replay / broadcast UI polish
```

### Phase 1.0 工程骨架

目标：

```text
项目可以安装、构建、运行基础命令。
```

输出：

```text
TypeScript 项目骨架。
domain types。
Zod schemas。
SQLite migration 草案。
Repository 接口。
fake provider 接口。
基础测试框架。
```

验收：

```text
可以运行类型检查。
可以运行测试。
可以初始化本地 data/。
```

### Phase 1.1 单回合 replay

目标：

```text
跑通一个回合的完整事实链。
```

输出：

```text
startMatch。
completeVeto。
startMap。
playNextRound。
RoundReport。
Event Log。
EconomyState。
TimelineEvent。
CLI replay 或极简页面输出。
```

验收：

```text
同一 seed 多次运行得到同一结果。
每个 Event 有 globalSequence / sequenceInScope。
RoundReport 能追溯到 Event。
TimelineEvent 能追溯到 sourceEventIds。
导出 JSON 可读。
```

### Phase 1.2 单张地图

目标：

```text
从第一回合连续推进到 map_completed。
```

输出：

```text
runCurrentMap。
MR6 胜利条件。
换边。
加时入口。
map_summary。
map_review_window。
```

验收：

```text
一张地图能自动跑完。
失败任务不污染比赛事实。
重启后可以恢复继续。
```

### Phase 1.3 BO3 fake provider

目标：

```text
用 fake provider 跑完一场 BO3。
```

输出：

```text
完整 Match。
最多 3 张 MapGame。
match_completed。
基础统计。
导出 match JSON。
```

验收：

```text
Match 有 winnerTeamId。
每个 completed Round 都有 RoundReport。
每个 RoundReport 都能追溯 Event。
BO3 可导出、可重放、可恢复。
```

### Phase 1.4 极简伪直播 demo

目标：

```text
把 BO3 或单图结果以伪直播方式播放出来。
```

输出：

```text
Timeline projection。
极简 Live 页面或 CLI player。
比分牌。
kill feed。
回合摘要。
经济摘要。
```

验收：

```text
前端或 CLI 只消费 TimelineEvent。
不读取 RawOutput 正文。
不反写比赛事实。
```

### Phase 1.45 契约代码落地

目标：

```text
把 P2.2 2D 战术地图和 P2.3 转播系统的关键契约落到可测试代码。
```

输出：

```text
TacticalMapLayout。
BroadcastItem。
Broadcast Quality Gate。
caster / barrage / support_rate / replay_card 规则或 fallback 生成。
最小可见 2D 战术地图 UI。
```

验收：

```text
不新增 SQLite 表。
不接真实 LLM。
包装内容不反写比赛事实。
失败可降级。
```

### Phase 1.5 真实 LLM 小范围接入

状态：

```text
已完成并收口。
```

目标：

```text
在 Phase 1.45 的转播包装锚点稳定后，用真实 provider 替换部分包装任务。
```

输出：

```text
真实 caster_line 调用。
llm_calls 记录。
Artifact 保存。
fallback 验证。
CLI phase15:*。
已冻结的历史单图 real-LLM archive/debug 路径。
```

验收：

```text
真实 API token / cost 只进入 llm_calls。
不进入 Token 经济。
失败可 fallback。
观众侧不暴露 raw LLM、模型字段、Artifact 原文或 API Key。
旧 Web smoke runner 已冻结移出当前前端，不作为生产任务系统。
```

### Phase 1.6 区域化攻防回合协议

目标：

```text
把 P2.2 的区域从展示节点升级为回合模拟输入，让攻方进攻方案、守方区域部署和 Token 资源分配进入 Judge 可解释上下文。
```

输出：

```text
SideAssignment。
AttackPlan。
DefenseDeployment。
ZoneResourceAllocation。
TacticalCollision。
RoundReport tacticalContext 扩展。
攻防相关 EventType / payload。
```

验收：

```text
MR6 第 7 回合能换边。
每回合能确定攻方和守方。
攻方能选择主攻 A / B / 中路控制 / 假打转点。
守方能选择重防 A / B / 默认分散 / 中路前压。
Judge 能解释区域碰撞如何影响胜负。
P2.2 和 P2.3 只消费攻防事实，不反写比赛事实。
```

### Phase 1.7 Materials runtime integration 与角色契约升级

目标：

```text
把 data/materials/processed 稳定接入运行时，并让 materials 里的角色成为 Agent.role / secondaryRoles / roleProfile / materialRef 的工程事实源。
```

输入 P 文档：

```text
P0.1 领域模型。
P1.3 大模型驾驶员契约。
P1.4 比赛引擎说明。
P1.5 本地持久化说明。
P2.1 直播时间线说明。
P2.2 2D 战术地图说明。
P2.3 转播系统说明。
```

输出：

```text
@agent-major/materials Node-only package。
loadProcessedMaterials。
buildRuntimeTeamSeed。
seedPhase17ShowcaseMatch。
phase17:match / phase17:replay / phase17:export。
默认 Falcon-7B vs VitaLLMty canon BO3。
Web runner phase17_showcase_match fake-only 模式。
Phase 1.5 real LLM 单图路径冻结为 CLI-only archive/debug。
Replay safe agentsById 视图。
```

角色契约：

```text
Agent.role = coach / igl / awper / entry / star_rifler / lurker / support / rifler / stand_in。
Agent.secondaryRoles = anchor / flex / closer / system_architect 等副标签。
读取旧数据时 star -> star_rifler，closer -> rifler。
新写入不再产生 star 或 closer primary role。
```

验收：

```text
materials loader 校验 16 队、5 active players、role index、alias、style hooks 和 LLM binding。
unknown role fail fast。
所有 runtime agent 使用 driver_fake_phase17。
future LLM binding 只作为 runtimeEnabled:false materialRef 保存。
PhaseClan head_coach=null 不导入 Coach TBD 作为运行时 coach。
Phase 1.6 tactical protocol 不再依赖 agent id 正则判断角色。
Web replay/export 不暴露模型字段、llm_calls 或 future_driver_binding 全量 JSON。
```

非目标：

```text
不做完整 16 队 bracket。
不启用真实 agent / judge LLM。
不让 materials LLM binding 影响胜负、战术或生成。
```

### Phase 1.8 per-agent runtime LLM pilot

状态：

```text
已完成并收口（工程 pilot），2026-05-04 起暂时冻结。
```

目标：

```text
在 Phase 1.7 canon showcase 稳定后，落地一条独立的本地真实 LLM BO3 pilot 主线，让 active players 与 judge 的真实调用真正进入 round fact chain，并支持 CLI + Web 的逐回合调试。
```

输出：

```text
Phase18 canon ids / seeding。
固定 Falcon-7B vs VitaLLMty、DUST2 / INFERNO / MIRAGE 的 CLI + Web 主线。
2 team_plan -> 10 agent_action -> judge -> judge_review 的真实 LLM round chain。
每回合 llm_calls / Artifact / system events 观测，以及 attempt-scoped retry-safe ids。
Run Next Round / Run Current Map / Run Full BO3。
Web 侧 replay guard、无剧透进度和失败痕迹保留。
```

验收：

```text
Falcon-7B vs VitaLLMty 本地 BO3 可由真实 LLM 驱动跑通，且支持逐回合验收。
player action 与 judge result 真正写入 round outcome、round report 和 replay 事实链。
同一回合失败后允许保留观测痕迹并安全重跑，不再产生 event id conflict。
收口性质是工程 pilot，不要求在本阶段完成 prompt、judge 标准和胜负分布质量的最终打磨。
```

### Phase 1.9 replay / broadcast UI polish

状态：

```text
已完成并收口，2026-05-04 起暂时冻结。
后续只修阻断性 bug，不继续做体验扩展。
```

目标：

```text
在 Phase 1.8 的数据口径稳定后，补强前端观赛体验和 canon 队伍信息展示，不再让旧 demo 或临时调试入口干扰当前主线。
```

输出：

```text
Phase 1.8 only 前台主线。
导播式主舞台。
左右对称悬浮选手栏。
可拖动的 fixed 控制台工具窗。
轻量播放控制条。
生成中 / 失败 / replay guard / replay ready 的统一舞台状态。
完整 LLM 调用明细仍保留在调试层，不进入主观赛层。
```

验收：

```text
当前前端只暴露 Phase 1.8 主线，不再出现旧 Phase 1.5 单图入口或 Phase 1.7 前台按钮。
Web replay 能清晰展示 canon 队伍、原始英文角色和运行状态。
控制台可以在整个浏览器窗口内拖动，不占用任一队伍栏。
展开底部详细信息时不与主舞台重叠。
不为 UI polish 引入新的事实源或破坏 replay / export 兼容性。
```

### Phase 2.0-pre 赛事语义校准

目标：

```text
先不直接扩到 16 队正式赛事，而是围绕一张精心设计的地图和一场定制 BO3，把比赛真正要比的方案语义校准清楚。
```

主要输入 P 文档：

```text
P0.3 规则赛制。
P1.1 回合战报契约。
P1.4 比赛引擎说明。
P2.2 2D 战术地图说明。
P2.3 转播系统说明。
Phase 1.7 materials runtime seed。
Phase 1.8 real LLM BO3 pilot。
Phase 1.9 broadcast UI 主屏。
```

输出：

```text
临时高优先级纲领。
单图命题稿。
双队初始方案稿。
coach / player / judge 职责协议。
裁判评分规程。
前端展示字段清单。
图后方案修正模板。
定制 BO3 验收标准。
```

验收：

```text
单图命题、双队方案、攻防关系和裁判规程真实进入比赛链路。
前端能看懂当前回合谁在攻、谁在守、攻什么、守什么。
图后能沉淀双方方案修正结果。
在此基础上，定制 BO3 能稳定复现同样的赛事语义。
```

### Phase 2：完整赛事雏形

目标：

```text
在 Phase 2.0-pre 通过后，从单场定制 BO3 扩展到完整 16 队单败赛事。
```

主要输入 P 文档：

```text
P0 / P1。
P2.1。
P2.2。
P2.3。
```

输出：

```text
16 队 bracket。
多场 BO3。
赛事晋级。
基础榜单。
基础高光。
```

验收：

```text
能跑完整一届 fake Agent Major。
能导出 tournament JSON。
能从 Event Log 重建关键结果。
```

### Phase 3：赛事生态

目标：

```text
形成内容工厂和赛事沉淀。
```

主要输入 P 文档：

```text
P3.1 数据统计与奖项。
P3.2 新闻与媒体。
P3.3 素材库。
```

输出：

```text
MVP / EVP。
新闻战报。
今日五佳。
深度复盘。
素材库。
```

验收：

```text
所有媒体内容都能追溯 sourceEventIds。
奖项由统计和事件派生，不能直接问模型决定。
```

### Phase 4：Web 化与运营

目标：

```text
从本地产品迁移到可部署 Web 产品。
```

主要输入 P 文档：

```text
P4.1 API 契约。
P4.2 队列与工作器。
P4.3 可观测性与成本。
P4.4 Web 迁移。
```

输出：

```text
Web API。
Postgres。
BullMQ 或等价队列。
对象存储。
部署环境。
用户和权限。
分享链接。
```

验收：

```text
替换存储和队列不重写 Core Engine。
本地导出的赛事可以迁移到 Web。
真实 token / cost 可观测。
```

## 6. P 与 Phase 对照表

| P 文档 | 冻结状态 | 支撑 Phase | 是否阻塞当前 |
|---|---|---|---|
| P0.1 领域模型 | Frozen | Phase 1+ | 是 |
| P0.2 事件分类 | Frozen | Phase 1+ | 是 |
| P0.3 规则赛制 | Frozen | Phase 1+ | 是 |
| P1.1 回合战报契约 | Frozen | Phase 1+ | 是 |
| P1.2 Token 经济 | Frozen | Phase 1+ | 是 |
| P1.3 大模型驾驶员 | Frozen | Phase 1+ | 是 |
| P1.4 比赛引擎 | Frozen | Phase 1+ | 是 |
| P1.5 本地持久化 | Frozen | Phase 1+ | 是 |
| P2.1 直播时间线 | Frozen | Phase 1.1+ | 是 |
| P2.2 2D 战术地图 | Frozen | Phase 1.4 / Phase 2 | 否 |
| P2.3 转播系统 | Frozen for Phase 1 | Phase 1.4 / Phase 1.5 / Phase 2 | 否 |
| P3.1 数据统计与奖项 | Reserved | Phase 3 | 否 |
| P3.2 新闻与媒体 | Reserved | Phase 3 | 否 |
| P3.3 素材库 | Reserved；Phase 1.7 仅使用 processed runtime seed 子集 | Phase 1.7 / Phase 3 | 否 |
| P4.1 API 契约 | Reserved | Phase 4 | 否 |
| P4.2 队列与工作器 | Reserved | Phase 4 | 否 |
| P4.3 可观测性与成本 | Reserved | Phase 4 | 否 |
| P4.4 Web 迁移 | Reserved | Phase 4 | 否 |

## 7. 变更规则

### 7.1 必须先补文档再写代码

以下变化会影响核心契约，必须先更新 P 文档：

```text
新增或修改 EventType / payload。
修改 RoundReport 字段。
修改 Match / MapGame / Round 状态机。
修改 Token 经济规则或 Output Gate。
修改 DriverModel / Provider 接口。
修改 SQLite 核心表。
修改 Event -> TimelineEvent 投影契约。
修改 fake provider 必须满足的验收路径。
```

### 7.2 可以先写代码后补文档

以下变化属于实现细节，不阻塞工程：

```text
Repository 内部 SQL。
fake provider 样例文案。
CLI 输出格式。
极简页面布局。
测试 seed。
日志文案。
非核心工具函数。
本地开发脚本。
```

### 7.3 变更审查最小格式

任何会改核心契约的变更，必须说明：

```text
变更对象：
为什么要改：
影响哪些 P 文档：
影响哪些 Phase：
是否破坏已有 replay / export：
迁移或兼容方案：
```

## 8. 每个 Phase 的交付包

每个 Phase 或子阶段完成时，必须形成一个可审查交付包：

```text
1. 运行命令。
2. 输入 seed / fixture。
3. 生成的 Event Log。
4. 生成的 RoundReport / TimelineEvent / export JSON。
5. 测试结果。
6. 已知问题。
7. 下一步建议。
```

交付包可以先是本地文件或控制台输出，不要求第一版有漂亮页面。

## 9. 可复现要求

Phase 1 起必须满足：

```text
fake provider 使用确定性 seed。
同一 seed 多次运行结果一致。
Event 顺序由 globalSequence / sequenceInScope 决定。
导出 JSON 可用于审查。
RawOutput 默认保存但不污染观赛输出。
失败时能定位到 failed step。
```

### 9.1 依赖安装门禁

`pnpm install` 不属于常规 Phase 验收、代码审查、测试、构建或 Git 同步步骤。后续 agent 默认不得运行 `pnpm install`、删除 `node_modules` 或重建 `.pnpm-store`。

这条规则来自 Phase 1.7 验收期间的 Windows 环境问题：

```text
Next / sharp / Vitest / Node 进程可能锁定原生二进制。
删除 node_modules 时可能触发 EPERM / EIO / access denied。
半失败安装会制造残缺依赖状态，并把环境问题伪装成代码回归。
重复 install 会扩大问题范围，降低验收可信度。
```

允许安装依赖的唯一条件：

```text
任务明确需要新增、删除或升级依赖。
用户在当前对话中明确批准安装。
已停止可能锁文件的 Node / Next / Vitest / dev server 进程。
执行前说明具体命令、风险和失败后的回退方案。
```

如果怀疑依赖状态损坏，应先报告现象并让用户决定是否在自己的 PowerShell 中手动执行安装；agent 不应自行反复尝试。

## 10. P4 的当前处理方式

P4 不进入当前实现，但 Phase 1 必须保留接口意识：

```text
Repository 不直接绑死 SQLite。
ArtifactStore 不直接绑死本地文件。
JobQueue 不直接绑死同步函数。
LLM Provider 不直接绑死单一厂商。
Core Engine 不依赖具体 Web 框架。
```

当前不做：

```text
Postgres。
BullMQ。
对象存储。
用户系统。
权限系统。
公网部署。
多人访问。
```

这样可以保证：

```text
Phase 1 能快速跑通。
Phase 4 不需要重写核心引擎。
```

## 11. 当前下一步

```text
已完成：
1. Phase 1.0：工程骨架。
2. Phase 1.1：单回合 replay。
3. Phase 1.2：单张地图 replay。
4. Phase 1.3：BO3 fake provider。
5. Phase 1.4：极简伪直播播放器基础版。
6. Phase 1.4 播放结果的内容质量与事件可信度收口。
7. P2.2：2D 战术地图说明。
8. P2.3：转播系统说明。
9. Phase 1.45：P2.2 / P2.3 契约代码落地。
10. Phase 1.5：真实 LLM 小范围接入。
11. Phase 1.6：区域化攻防回合协议。
12. Phase 1.7：Materials runtime integration 与角色契约升级。
13. Phase 1.8：per-agent runtime LLM pilot。
14. Phase 1.9：replay / broadcast UI polish。

当前下一步：
15. Phase 2.0-pre：单图 / 定制 BO3 赛事语义校准。

后续预留：
16. Phase 2.0：完整 16 队 bracket 与赛事调度设计。
17. Phase 3：赛事生态。
18. Phase 4：Web 化与运营。
```
