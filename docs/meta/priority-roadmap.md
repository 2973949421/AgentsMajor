# Agent Major 优先级路线图 v1

## 1. 路线原则

当前阶段不是把所有模块一次性做深，而是按依赖关系逐层补齐文档和最小实现。

优先级判断标准：

```text
P0: 没有它，所有后续模块都会失去事实源或边界。
P1: 没有它，无法跑通一场可回放比赛。
P2: 没有它，赛事有结果但缺少观赏性和沉淀。
P3: 有它会明显增强生态，但可以后置。
P4: Web 化、扩展、运营增强。
```

勾稽关系要求：

```text
每个模块文档必须声明 输入（inputs）/ 输出（outputs）/ 上游（upstream）/ 下游（downstream）/ 事件类型（event types）/ 验收标准（acceptance）。
不能只写孤立任务。
```

## 2. 总览索引

### P / Phase 双线交付框架

已完成文档：

```text
docs/meta/p-phase-delivery-framework.md
```

用途：

- 区分 P0-P4 模块优先级与 Phase 0-4 工程阶段。
- 定义 P2.1 后“代码主线，文档随行”的工作模式。
- 定义每个 Phase 的输入 P 文档、输出成果、验收门和变更规则。
- 确保后续工作可复现、可审查、可修改。

说明：

- P 线负责契约，Phase 线负责可运行结果。
- 二者互相勾稽，但不一一对应。
- 后续涉及“先补文档还是先写代码”的争议，以该文档为准。

### 模块总地图

已完成文档：

```text
docs/meta/module-map.md
```

用途：

- 统一所有模块边界。
- 明确智能体（Agent）与大模型驾驶员（LLM Driver） 解耦。
- 确认经济系统不绑定模型成本。

下游：

- 所有模块文档。

说明：

- 这不是实现模块，不占用 P0/P1 编号。
- 它只用于统一模块边界和导航后续文档。
- 后续工程排期从 `P0.1 领域模型` 开始。

## 3. P0：事实源与边界层

### P0.1 领域模型（Domain Schema）

已完成文档：

```text
docs/p0-foundation/domain-schema.md
```

必须覆盖：

- 赛事（Tournament）。
- 队伍（Team）。
- 智能体（Agent）。
- 驾驶员模型（DriverModel）。
- 比赛（Match）。
- 地图局（MapGame）。
- 回合（Round）。
- 回合战报（RoundReport）。
- 经济状态（EconomyState）。
- 事件（Event）。
- 时间线事件（TimelineEvent）。

关键勾稽：

- `智能体驾驶员字段（Agent.driverModelId）` 连接 M03 与 M04。
- `回合战报（RoundReport）.key_events` 驱动 M08 / M09 / M10。
- `经济状态（EconomyState）` 只影响比赛资源，不影响驾驶员模型（driver model）。
- `事件（Event）` 是所有直播、统计、新闻的事实源。

验收标准：

- 所有核心类型都有字段说明。
- 每个类型都有上游来源和下游消费者。
- 回合战报（RoundReport）可直接驱动击杀播报（kill feed）、2D、解说、弹幕、支持率。

### P0.2 事件分类（Event Taxonomy）

已完成文档：

```text
docs/p0-foundation/event-taxonomy.md
```

必须覆盖：

- 事件类型（event type）。
- 载荷结构（payload schema）。
- 哪些事件（event）是事实，哪些事件是包装。
- 时间线毫秒（timelineMs）规则。
- 回放投影（replay projection）规则。

关键勾稽：

- M05 只写比赛事实事件（event）。
- M09 写转播包装事件（broadcast event）。
- M10 只消费事件（event），不反写比赛事实。
- M11 / M12 从事件（event）派生数据和内容。

验收标准：

- 一场回合（round）的完整事件（event）序列可以被写出来。
- 前端可以只靠 事件时间线（event timeline）播放伪直播。

### P0.3 规则与赛制说明（Rules & Format Spec）

已完成文档：

```text
docs/p0-foundation/rules-format.md
```

必须覆盖：

- 16 队单败。
- BO3。
- 地图池。
- 地图禁选（veto）。
- MR6。
- 加时。
- 晋级淘汰。

关键勾稽：

- M01 给 M02 状态机提供规则。
- M02 给 M05 round pipeline 提供当前状态。
- M11 统计需要理解 map / match / tournament 层级。

验收标准：

- 能根据规则手工推演一届 16 队赛事。

## 4. P1：最小比赛闭环

### P1.1 回合战报契约（RoundReport Contract）

已完成文档：

```text
docs/p1-match-loop/round-report-contract.md
```

必须覆盖：

- 裁判结果（judge result）。
- 关键事件（key events）。
- 经济变化（economy delta）。
- token 用量（token usage）。
- 高光标签（highlight tags）。
- 地图区域（map zones）。
- 摘要（summary）。

关键勾稽：

- M05 生成回合战报（RoundReport）。
- M08 按回合战报（RoundReport）拆事件（events）。
- M09 生成解说和弹幕。
- M10 更新 2D 战场。
- M11 更新数据统计（stats）。

验收标准：

- 一个回合战报（RoundReport）可以自动投影成击杀播报（kill feed）、比分更新（score update）、经济更新（economy update）、高光候选（highlight candidate）。

### P1.2 Token 经济说明（Token Economy Spec）

已完成文档：

```text
docs/p1-match-loop/token-economy.md
```

必须覆盖：

- token 银行（token bank）。
- Agent 级经济主体。
- 经济上限（agentTokenCap）。
- Drop。
- 输出闸门（Output Gate）。
- 收入（income）。
- 连败补偿（loss bonus）。
- 全起 / 半起 / 经济局 / 强起 / 保经济（full buy / half buy / eco / force buy / save）。
- 战术暂停（timeout）。
- 购买类型影响（buy type effects）。

关键勾稽：

- 经济状态（EconomyState）约束 M05 单个 Agent 的购买、提交输出和预算；不裁剪双方共同的公开输入。
- 经济事件（EconomyEvent）进入 M08。
- 经济数据（EconomyStats）进入 M11。
- 不影响 M04 驾驶员模型（driver model）。

验收标准：

- 能解释为什么某回合是经济局（eco）、强起（force buy）或全起（full buy）。
- 能从 Agent 级 EconomyState 推导该回合的购买预算、上下文预算和 Output Gate 裁剪结果。

### P1.3 大模型驾驶员契约（LLM Driver Contract）

已完成文档：

```text
docs/p1-match-loop/llm-driver-contract.md
```

必须覆盖：

- 智能体（Agent）与驾驶员模型（driverModelId）绑定。
- 模型供应商注册表（ProviderRegistry）。
- 模型配置（ModelConfig）。
- 提示词模板（PromptTemplate）。
- 结构化输出（Structured output）。
- 重试 / 降级（Retry / fallback）。
- 假模型供应商（fake provider）。

关键勾稽：

- M03 只知道 agent 绑定 driver。
- M04 负责调用 provider。
- M05 不关心具体模型厂商。
- M18 记录真实调用成本，但不反馈到比赛经济。

验收标准：

- 假模型供应商（fake provider）与真实 provider 使用同一接口。
- 同一个 agent 可以切换 driver，不改变比赛层 schema。

### P1.4 比赛 / 地图 / 回合引擎说明（Match / Map / Round Engine Spec）

已完成文档：

```text
docs/p1-match-loop/simulation-engine.md
```

必须覆盖：

- 启动比赛（start match）。
- 地图禁选（veto）。
- 启动地图（start map）。
- 推进下一回合（play next round）。
- 完成地图（complete map）。
- 完成比赛（complete match）。
- 摘要更新（summary update）。

关键勾稽：

- 输入 M02 状态（state）、M03 智能体（agent）、M06 经济系统（economy）。
- 输出 M08 事件（event）、M14 状态（state）、M15 异步任务（async jobs）。
- Phase 1.6 后，P1.4 还将承载攻守方分配、攻方方案、守方部署和区域碰撞判定。

验收标准：

- 不接真实 LLM，也能用假模型供应商（fake provider）跑完一场 BO3。

### P1.5 本地持久化说明（Local Persistence Spec）

已完成文档：

```text
docs/p1-match-loop/local-persistence.md
```

必须覆盖：

- SQLite 数据表（SQLite tables）。
- 仓储接口（repository interfaces）。
- 产物存储（artifact storage）。
- 导出格式（export format）。
- 迁移路径（migration path）。

关键勾稽：

- M14 是 M02 / M05 / M08 / M11 / M12 的共同底座。
- 不允许业务事实只存在内存。

验收标准：

- 能保存并重新打开一场 match 的完整 replay。

## 5. P2：伪直播与观赛体验

### P2.1 直播时间线说明（Live Timeline Spec）

已完成文档：

```text
docs/p2-broadcast-viewer/live-timeline.md
```

必须覆盖：

- 时间线事件（timeline event）。
- 播放时间点（atMs）。
- 播放（playback）。
- 暂停 / 重放（pause / replay）。
- 回合回放（round replay）。
- 高光跳转（highlight jump）。

关键勾稽：

- M08 事件日志（event log） 投影到 M09 / M10。
- 前端只消费时间线（timeline），不读取 LLM 原始输出。

验收标准：

- 一组静态 时间线事件（timeline events） 可以播放出一回合伪直播。
- CLI Player 和 Web Live Player 可以消费同一批 TimelineEvent。
- 观众模式支持地图内自动连续播放、倍速、持续弹幕、单主解说和回合后高光揭示。

### P2.2 2D 战术地图说明（2D Tactical Map Spec）

目标文档：

```text
docs/p2-broadcast-viewer/tactical-map.md
```

当前状态：

```text
已完成，作为 Phase 1 fake provider MVP 的 2D 战术地图消费契约。
```

必须覆盖：

- 地图区域（map zones）。
- 智能体位置（agent positions）。
- 控制区域（control regions）。
- 行动路径（action path）。
- 状态徽标（state badge）。
- 高光闪烁（highlight flash）。

关键勾稽：

- M13 地图素材（map materials）定义地图区域（zones）。
- 回合战报（RoundReport）.key_events 引用地图区域（zones）。
- M10 渲染地图区域（zones）和控制变化（control delta）。
- Phase 1.6 后，地图区域还会成为攻防协议的战术词汇；P2.2 仍只消费事实，不反写 Judge。

验收标准：

- 每张地图至少有 地图区域结构（zone schema）。
- 每个 关键事件（key event） 都能落到一个 zone。

### P2.3 转播系统说明（Broadcast System Spec）

已完成文档：

```text
docs/p2-broadcast-viewer/broadcast-system.md
```

当前状态：

```text
已完成，作为 Phase 1 fake provider MVP 与 Phase 1.5 真实 caster_line 的转播包装层边界；Phase 1 范围内可按 Frozen 执行。
```

必须覆盖：

- 解说席（caster desk）。
- 弹幕（barrage）。
- 击杀播报（kill feed）。
- 支持率（support rate）。
- 回放卡片（replay cards）。

关键勾稽：

- M09 从 M08 / M11 消费事实，不发明比赛结果。
- 解说（caster）/ 弹幕（barrage） 可异步生成。
- 失败时不阻塞 M05。
- Phase 1.6 后，P2.3 可以包装攻防事实，例如重防 A、假打转 B、B 点弱防被打穿，但不能决定这些事实。

验收标准：

- 同一个 回合战报（RoundReport） 能生成至少 1 条官解、3-8 条弹幕、1-3 条 击杀播报（kill feed）。

## 6. P3：数据、奖项与媒体生态

### P3.1 数据统计与奖项说明（Stats & Awards Spec）

目标文档：

```text
docs/p3-ecosystem/stats-awards.md
```

必须覆盖：

- 智能体评级（agent rating）。
- 队伍数据（team stats）。
- 经济数据（economy stats）。
- 最有价值选手（MVP）。
- 优秀价值选手（EVP）。
- 娱乐奖项（entertaining awards）。

关键勾稽：

- M11 只从 event / judge / 回合战报（round report） 派生，不直接问模型“谁是 MVP”。
- 模型可用于解释奖项，但不能替代基础统计。

验收标准：

- 一场 BO3 后能给出 match MVP。
- 一届赛事后能给出 MVP / EVP 候选。

### P3.2 新闻与媒体说明（News & Media Spec）

目标文档：

```text
docs/p3-ecosystem/news-media.md
```

必须覆盖：

- 赛前前瞻。
- 赛中快讯。
- 赛后战报。
- 赛后采访。
- 今日五佳。
- 深度复盘。

关键勾稽：

- M12 从 M08 / M09 / M11 获取素材。
- 新闻不能修改比赛事实。
- 新闻引用 event ids 便于追溯。

验收标准：

- 一场 match 结束后能生成一篇战报，并能追溯到关键 events。

### P3.3 素材库说明（Materials Library Spec）

目标文档：

```text
docs/p3-ecosystem/materials-library.md
```

当前执行边界：

```text
Phase 1.7 已先使用 data/materials/processed 的 runtime seed 子集。
这不等于 P3.3 素材库完整完成。
P3.3 仍负责后续素材来源、版权、风格资产、弹幕语料和媒体内容边界。
```

必须覆盖：

- 幽灵战队导入（ghost team import）。
- 地图素材（map materials）。
- 转播风格（broadcast style）。
- 弹幕语料池（barrage phrase pool）。
- 禁用表达（forbidden expressions）。

关键勾稽：

- M13 供给 M03 / M09 / M10。
- 所有素材必须标记来源和使用边界。

验收标准：

- 能用手动 JSON 导入 2 支队伍和 1 张地图。

## 7. P4：Web 化与运营能力

### P4.1 API 契约（API Contract）

目标文档：

```text
docs/p4-web-ops/api-contract.md
```

必须覆盖：

- 命令接口（command API）。
- 查询接口（query API）。
- 流式接口（stream API）。
- 错误格式（error format）。
- 任务状态（job status）。

关键勾稽：

- 本地 UI 和 Web UI 使用同一 API。
- API 不暴露数据库实现。

验收标准：

- 本地版 API 可以无痛映射到 Web 部署。

### P4.2 队列与工作器说明（Queue & Worker Spec）

目标文档：

```text
docs/p4-web-ops/queue-worker.md
```

必须覆盖：

- 本地队列（local queue）。
- 后期 BullMQ（BullMQ future）。
- 任务生命周期（job lifecycle）。
- 重试（retry）。
- 死信任务（dead letter）。
- 限流规则（rate limits）。

关键勾稽：

- M15 调度 M04 调用。
- M18 提供限流与成本反馈。
- M05 同步路径不依赖异步 broadcast 成功。

验收标准：

- 同一个 job handler 可从 local queue 切到 BullMQ。

### P4.3 可观测性与成本说明（Observability & Cost Spec）

目标文档：

```text
docs/p4-web-ops/observability-cost.md
```

必须覆盖：

- token 用量（token usage）。
- 供应商延迟（provider latency）。
- 结构失败（schema failure）。
- 重试次数（retry count）。
- 单场比赛上限（per match cap）。
- 单届赛事上限（per tournament cap）。

关键勾稽：

- M18 读取 M04 / M15 / M08。
- 降级策略反馈给 M15。
- 不反馈到 M06 比赛经济，除非后续版本明确设计。

验收标准：

- 能看出一场 match 花了多少真实 token 和估算成本。

### P4.4 Web 迁移说明（Web Migration Spec）

目标文档：

```text
docs/p4-web-ops/web-migration.md
```

必须覆盖：

- SQLite 到 Postgres 迁移（SQLite -> Postgres）。
- 本地队列到 BullMQ 迁移（local queue -> BullMQ）。
- 本地文件到对象存储迁移（local files -> object storage）。
- 本地 SSE 到部署流迁移（local SSE -> deployed stream）。
- 工作器拆分（worker split）。

关键勾稽：

- M21 只替换实现，不改变 M02 / M05 / M08 的业务契约。

验收标准：

- 每个本地接口都有对应 Web 实现方案。

## 8. 推荐推进顺序

### 已完成的基础契约

```text
1. docs/p0-foundation/domain-schema.md
2. docs/p0-foundation/event-taxonomy.md
3. docs/p0-foundation/rules-format.md
4. docs/p1-match-loop/round-report-contract.md
5. docs/p1-match-loop/token-economy.md
6. docs/p1-match-loop/llm-driver-contract.md
7. docs/p1-match-loop/simulation-engine.md
8. docs/p1-match-loop/local-persistence.md
9. docs/p2-broadcast-viewer/live-timeline.md
10. docs/p2-broadcast-viewer/tactical-map.md
11. docs/p2-broadcast-viewer/broadcast-system.md
```

原因：

- 这些文档已经覆盖事实源、事件、规则、回合战报、经济、驾驶员、比赛推进流程、本地持久化、直播时间线、2D 战术地图消费契约和转播包装层契约。
- 后续 UI、持久化、解说、新闻、统计都依赖它们。
- 没有这些，直接写代码会很容易返工。

### 当前阶段最应该补强

```text
1. Phase 1.7 materials runtime seed 的完整回归验证。
2. Agent role / secondaryRoles / roleProfile / materialRef 在 P0 / P1 / DB / Web replay 中保持一致。
3. Falcon-7B vs VitaLLMty canon BO3 的 CLI、Replay、Export 和 Web runner smoke。
4. Phase 2.0 完整 16 队 bracket 的边界设计。
```

原因：

- Phase 1.0 / 1.1 / 1.2 / 1.3 / 1.4 基础版已经跑通，当前已经有本地 SQLite、单回合 replay、单图 replay、BO3 match replay、summary、CLI replay/export 和 BO3 伪直播播放器。
- Phase 1.4 的 RoundReport、TimelineEvent、keyRounds 和 highlight 已完成第一轮内容质量与事件可信度收口。
- P2.2 已经明确 2D 战术地图如何消费结构化事实源；P2.3 已经明确转播系统中哪些内容来自事实源，哪些只是可延后、可丢弃、可重建的包装层。
- Phase 1.6 已完成 deterministic rule-based 区域化攻防协议，当前不再需要把它当成待办主线。
- Phase 1.7 引入了真实 materials 资产和角色契约重构，当前更重要的是先把事实源、兼容迁移、导出安全和默认 showcase 固定住，避免 Phase 2.0 做 16 队 bracket 时返工。

### P2.1 后的工程切换结果

当前结果：

```text
docs/p2-broadcast-viewer/live-timeline.md 已完成，优先进入工程骨架和 fake provider MVP。
该决策已经执行，工程已推进到 Phase 1.4，并已回补 P2.2 / P2.3。
```

原因：

- P0 / P1 已经定义事实源、事件、规则、回合战报、经济、驾驶员、比赛引擎和本地持久化。
- P2.1 已补齐 Event 到 TimelineEvent 的播放投影，足以支撑第一个伪直播 demo。
- Phase 1.2 已经验证状态机、事件顺序、SQLite 持久化和 replay 可以真实跑通。

已完成的最小工程目标：

```text
1. 建立 TypeScript 项目骨架。
2. 定义核心 domain types 和 Zod schemas。
3. 建立 SQLite schema / migration。
4. 实现 fake provider。
5. 跑通 startMatch -> completeVeto -> startMap -> playNextRound。
6. 写入 RoundReport / Event / EconomyState。
7. 从 Event 投影 TimelineEvent。
8. 用 CLI 或极简页面播放 / 打印单回合 replay。
9. 跑通 runCurrentMap。
10. 完成 MR6 + MR3 加时的单图 replay。
11. 生成 map summary。
12. 导出 map JSON。
```

边界：

- 这个工程切换不取消 P3、P4。
- P2.2 与 P2.3 已经在 Phase 1.4 之后完成回补。
- 当前仍不要求真实 LLM，不要求完整 2D 地图，不要求新闻、奖项和 Web 部署。

### P2.1 后的工作模式

P2.1 之后采用：

```text
代码主线，文档随行。
```

含义：

- 主线目标从“继续补完整文档”切换为“跑通 fake provider MVP”。
- 不再等待 P3 / P4 全部文档完成。
- 工程实现必须遵守 P0 / P1 / P2.1 / P2.2 已冻结契约，并以 P2.3 作为 Phase 1 的转播边界输入。
- 如果实现中发现会改变核心契约的问题，先补对应文档，再改代码。
- 如果只是模块内部实现细节，不阻塞代码推进，后续再回填文档。

必须先补文档再写代码的情况：

```text
1. 新增或修改 EventType / payload。
2. 修改 RoundReport 字段。
3. 修改 Match / MapGame / Round 状态机。
4. 修改 Token 经济规则或 Output Gate 规则。
5. 修改 DriverModel / Provider 接口。
6. 修改 SQLite 核心表结构。
7. 修改 Event -> TimelineEvent 投影契约。
```

可以先写代码、后补文档的情况：

```text
1. Repository 内部实现。
2. fake provider 的确定性样例内容。
3. CLI 输出格式。
4. 极简页面布局。
5. 测试数据 seed。
6. 日志文案。
7. 非核心工具函数。
```

阶段目标：

```text
已完成：P2.1 直播时间线说明。
已完成：Phase 1.1 单回合 replay。
已完成：Phase 1.2 单张地图 replay。
已完成：Phase 1.3 BO3 fake provider。
已完成：Phase 1.4 极简伪直播播放器基础版。
已完成：Phase 1.4 播放结果的内容质量与事件可信度收口。
已完成：P2.2 2D 战术地图说明。
已完成：P2.3 转播系统说明。
已完成：Phase 1.45 P2.2 / P2.3 契约代码落地。
已完成：Phase 1.5 真实 LLM 小范围接入。
已完成：Phase 1.6 区域化攻防回合协议。
已完成：Phase 1.7 materials runtime integration 与角色契约升级。
已完成：Phase 1.8 本地真实 LLM BO3 pilot，暂时冻结。
已完成：Phase 1.9 Phase18 观赛主屏 / 调试控制台，暂时冻结。
当前：进入 Phase 2.0-pre 单图 / 定制 BO3 赛事语义校准。
```

### 长期规划判断

当前文档需要保留长期视野，但不要把远期模块提前写成实现细节。判断标准如下：

```text
如果远期设计会影响事实源、状态机、持久化、API、replay 兼容性、队列恢复或真实成本观测，就必须现在立边界。
如果远期设计只是内容包装、页面表现、弹幕语料、奖项命名或运营风格，可以先保留方向，不展开细节。
```

因此，当前应继续保持“近期写深，远期写边界”的文档策略。P2.2 已完成，P2.3 已完成并可作为 Phase 1 转播边界执行，Phase 1.45 已把关键契约落到代码锚点，Phase 1.5 已完成真实 caster_line 小范围接入，Phase 1.6 已完成 deterministic rule-based 区域化攻防协议，Phase 1.8 / 1.9 已作为真实 LLM pilot 与观赛主屏基线冻结。下一步不应直接跳入完整 16 队 bracket，而应先进入 Phase 2.0-pre，围绕单图命题、双队方案、coach / player / judge 分工、裁判规程和图后修正机制做语义校准。待定制单图与定制 BO3 跑顺后，再进入完整 16 队 bracket、fixture、赛事调度、失败恢复和公开导出 / API 边界设计。Phase 3 赛事生态和 Phase 4 Web 化仍只保留边界意识，不阻塞当前主线。

Phase 1.7 的决策是先把 materials 资产接入 runtime seed，并把角色契约重构为 materials 主角色枚举。这一步会改变 Agent schema、repository 兼容、runtime seeding、Web replay 安全视图和 CLI 默认 fixture，因此属于必须同步更新 P0 / P1 契约的工程阶段。它仍不展开 P3.3 完整素材库，也不提前实现 Phase 2.0 的 16 队 bracket。

### 后续文档补充顺序

```text
已完成：docs/p2-broadcast-viewer/tactical-map.md
已完成：docs/p2-broadcast-viewer/broadcast-system.md
已完成：docs/phase-plans/phase-1.45-contract-code-alignment.md
已完成：docs/phase-plans/phase-1.5-real-llm-integration.md
已完成：docs/phase-plans/phase-1.6-zone-offense-defense-protocol.md
已完成：docs/phase-plans/phase-1.7-materials-runtime-integration.md
已完成：docs/phase-plans/phase-1.8-real-llm-bo3-pilot.md
已完成：docs/phase-plans/phase-1.9-broadcast-ui-main-screen.md
已完成：docs/phase-plans/phase-2.0-pre-semantic-calibration-charter.md
已完成：data/materials/processed/maps/dust2/map-proposition.md
已完成：data/materials/processed/maps/dust2/judge-rubric.md
已完成：data/materials/processed/teams/falcon-7b/initial-proposal.md
已完成：data/materials/processed/teams/vitallmty/initial-proposal.md
```

原因：

- 这些决定观赛体验。
- 依赖回合战报（RoundReport）和事件分类（Event Taxonomy）。

### 最后补

```text
5. docs/p3-ecosystem/stats-awards.md
6. docs/p3-ecosystem/news-media.md
7. docs/p3-ecosystem/materials-library.md
8. docs/p4-web-ops/api-contract.md
9. docs/p4-web-ops/queue-worker.md
10. docs/p4-web-ops/observability-cost.md
11. docs/p4-web-ops/web-migration.md
```

原因：

- 它们增强生态和可部署性。
- 依赖核心事实源和最小比赛闭环。

## 9. 文档之间的强制勾稽格式

每份后续文档必须包含这几个章节：

```text
1. 范围（Scope）
2. Upstream 依赖关系（Dependencies）
3. 下游消费者（Downstream Consumers）
4. 数据契约（Data Contracts）
5. 事件契约（Event Contracts）
6. 最小版本（MVP Version）
7. 非目标（Non-goals）
8. 待确认问题（Open Questions）
```

示例：

```text
docs/p2-broadcast-viewer/tactical-map.md

Upstream:
  - 回合战报（RoundReport）.keyEvents[].zoneId
  - TacticalMapLayout.zones / 后续 MapMaterials.zones
  - 时间线事件（TimelineEvent）.kind

Downstream:
  - Live page renderer
  - Replay cards

事件契约（Event Contracts）:
  - map_control
  - agent_move
  - highlight_flash
```

这样每个模块都能被追溯，避免变成互不关联的独立清单。

## 10. 关键边界再确认

### 智能体（Agent）与大模型驾驶员（LLM Driver）

```text
Agent 是比赛角色。
大模型驾驶员（LLM Driver）是执行引擎。
智能体（Agent）必须绑定驾驶员模型（driverModelId）。
比赛层不关心 provider 细节。
```

### Token Economy 与真实模型成本

```text
Token 经济（Token Economy）是比赛内抽象资源。
真实模型 token/cost 是运维指标。
第一版二者不耦合。
```

### Simulation 与 Broadcast

```text
比赛模拟（Simulation）产生事实。
转播包装（Broadcast）包装事实。
转播包装（Broadcast）不能修改比赛事实。
```

### 事件日志（Event Log） 与 Summary

```text
事件日志（Event Log） 是事实源。
摘要（Summary）是下一轮上下文燃料。
Summary 可以重生成，事件（Event）不应被随意修改。
```












