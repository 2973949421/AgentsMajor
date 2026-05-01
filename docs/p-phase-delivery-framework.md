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
P2.2 / P2.3：Draft，等 MVP 骨架跑通后再完善。
P3：Reserved。
P4：Reserved，但接口意识必须保留。
```

## 4. 当前总推进策略

当前阶段已经完成：

```text
P0：事实源与边界层。
P1：最小比赛闭环。
P2.1：直播时间线说明。
```

当前必须先做：

```text
Phase 1.0：工程骨架。
```

当前进入：

```text
Phase 1：本地 fake provider MVP。
```

工作模式：

```text
代码主线，文档随行。
```

明确不做：

```text
不等 P2.2 / P2.3 / P3 / P4 全部完成后再开始代码。
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
Phase 1.5 真实 LLM 小范围接入
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

### Phase 1.5 真实 LLM 小范围接入

目标：

```text
在 fake provider 稳定后，用真实 provider 替换部分 driver。
```

输出：

```text
真实 agent_action 或 judge 调用。
llm_calls 记录。
Artifact 保存。
fallback 验证。
```

验收：

```text
真实 API token / cost 只进入 llm_calls。
不进入 Token 经济。
失败可 fallback。
```

### Phase 2：完整赛事雏形

目标：

```text
从单场 BO3 扩展到 16 队单败赛事。
```

主要输入 P 文档：

```text
P0 / P1。
P2.1。
必要时补 P2.2 / P2.3。
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
| P2.2 2D 战术地图 | Draft | Phase 1.4 / Phase 2 | 否 |
| P2.3 转播系统 | Draft | Phase 1.4 / Phase 2 | 否 |
| P3.1 数据统计与奖项 | Reserved | Phase 3 | 否 |
| P3.2 新闻与媒体 | Reserved | Phase 3 | 否 |
| P3.3 素材库 | Reserved | Phase 3 | 否 |
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
1. 进入 Phase 1.0：工程骨架。
2. 跑通 Phase 1.1：单回合 replay。
3. 扩展 Phase 1.2：单张地图。
4. 扩展 Phase 1.3：BO3 fake provider。
5. 再决定补 P2.2 / P2.3，或进入真实 LLM 小范围接入。
```
