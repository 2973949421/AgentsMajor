# Agent Major 全模块地图 v1

## 1. 模块划分原则

这份文档只做一件事：把 Agent Major 的所有模块放到同一张图里，并说明模块之间的输入、输出和依赖关系。

这份文档是总览索引，不参与 `P0/P1/P2` 的实施编号。后续优先级、排期和工程任务以 `docs/priority-roadmap.md` 为准。

核心边界：

```text
智能体（Agent）= 赛事里的选手人格 / 职责 / 战术位置 / 状态
大模型驾驶员（LLM Driver）= 智能体背后的驾驶员 / 执行引擎
```

第一版不把大模型（LLM）差异放进比赛经济系统：

```text
比赛层关心：队伍（team）/ 智能体（agent）/ 角色（role）/ 地图（map）/ 回合（round）/ 裁判（judge）/ 事件（event）
执行层关心：模型供应商（provider）/ 模型（model）/ 提示词（prompt）/ 解析器（parser）/ 重试（retry）/ 限流（rate limit）
经济层关心：可见上下文预算（visible context budget）/ 激活智能体（active agent）数量 / 战术暂停（timeout）/ 信息可见度 / 输出预算
```

## 2. 顶层模块总览

```text
M01 产品与规则（Product & Rules）
M02 赛事领域（Tournament Domain）
M03 队伍与智能体领域（Team & Agent Domain）
M04 大模型驾驶员层（LLM Driver Layer）
M05 比赛模拟引擎（Simulation Engine）
M06 Token 经济系统（Token Economy）
M07 裁判与评分（Judge & Scoring）
M08 事件日志与时间线（Event Log & Timeline）
M09 转播与伪直播（Broadcast & Pseudo Live）
M10 2D 战术渲染器（2D Tactical Renderer）
M11 数据统计与奖项（Stats & Awards）
M12 新闻与媒体（News & Media）
M13 素材与导入（Materials & Imports）
M14 持久化与存储（Persistence & Storage）
M15 队列与调度（Queue & Scheduling）
M16 API 与集成（API & Integration）
M17 管理与控制台（Admin & Control Panel）
M18 可观测性与成本控制（Observability & Cost Control）
M19 安全、权益与合规（Safety, Rights & Compliance）
M20 测试与样例数据（Testing & Fixtures）
M21 Web 迁移层（Web Migration Layer）
```

## 3. M01 产品与规则（Product & Rules）

### 3.1 产品定义（Product Definition）

- 定义 Agent Major 的产品边界。
- 定义伪直播而非实时直播。
- 定义本地优先、Web 预留。

### 3.2 赛制格式（Competition Format）

- 16 队单败。
- BO3。
- 地图禁选（veto）。
- MR6 正式赛制。
- MR3 可作为 MVP 阶段短赛制。

### 3.3 内容调性（Content Tone）

- 电竞化。
- 事件流驱动。
- HLTV / 直播间 / 新闻 / 奖项 / 舆论生态。
- 不做严肃基准测试（benchmark）风格。

### 3.4 输出契约（Output Contract）

- 给 M02 提供赛事规则。
- 给 M05 提供 比赛模拟（simulation）边界。
- 给 M09 / M12 提供内容调性。

## 4. M02 赛事领域（Tournament Domain）

### 4.1 赛事（Tournament）

- 赛事创建。
- 赛事状态。
- 当前阶段。
- 冠军与最终结果。

### 4.2 对阵树（Bracket）

- 16 队对阵生成。
- 16 强、8 强、4 强、决赛。
- 晋级淘汰。

### 4.3 比赛（Match）

- 三局两胜系列赛（BO3 series）。
- 地图顺序。
- 当前 系列赛比分（series score）。
- 比赛状态（match status）。

### 4.4 地图局（MapGame）

- 当前地图。
- 当前比分。
- 当前 round。
- 地图摘要（map summary）。

### 4.5 回合（Round）

- 回合编号（round number）。
- 双方 购买类型（buy type）。
- 激活智能体（active agents）。
- 裁判结果（judge result）。
- 回合战报（round report）。

### 4.6 依赖关系（Dependencies）

- 输入：M01 rules、M03 队伍（teams）、M06 经济系统（economy）。
- 输出：M05 模拟任务（simulation tasks）、M08 事件（events）、M11 数据统计（stats）。

## 5. M03 队伍与智能体领域（Team & Agent Domain）

### 5.1 队伍档案（Team Profile）

- 队名。
- 种子顺位（seed）。
- 幽灵身份（ghost identity）。
- 队伍基因（team DNA）。
- 地图偏好。

### 5.2 智能体档案（Agent Profile）

- 角色（role）。
- 人格设定（personality）。
- 特质标签（traits）。
- 能力数据（stats）。
- 优势 / 弱点（strengths / weaknesses）。
- 当前状态（current status）。

### 5.3 角色系统（Role System）

- 教练（Coach）。
- 指挥（IGL）。
- 突破手（Entry）。
- 明星位（Star）。
- 潜伏位（Lurker）。
- 辅助位（Support）。
- 终结者（Closer）。

### 5.4 智能体状态（Agent State）

- 火热状态（Hot）。
- 低迷状态（Cold）。
- 残局状态（Clutch）。
- 低经济状态（LowEco）。
- 出局状态（Down）。
- 加持状态（Boosted）。
- 心态波动（Tilted）。

### 5.5 驾驶员绑定（Driver Binding）

- 每个智能体（agent）绑定一个驾驶员模型字段 `driverModelId`。
- 驾驶员（driver）影响输出风格和执行质量。
- 第一版不让驾驶员（driver）影响 token 经济。

### 5.6 依赖关系（Dependencies）

- 输入：M13 阵容导入（roster import）、M04 驾驶员配置（driver config）。
- 输出：M05 激活智能体选择（active agent selection）、M09 转播身份（broadcast identity）、M11 选手数据（player stats）。

## 6. M04 大模型驾驶员层（LLM Driver Layer）

### 6.1 模型供应商注册表（Provider Registry）

- OpenAI。
- Anthropic。
- Gemini。
- Kimi。
- Qwen。
- 本地 / 假模型供应商（Local / mock provider）。

### 6.2 模型配置（Model Config）

- 模型供应商（provider）。
- 模型名称（model name）。
- 上下文上限（context limit）。
- 输出上限（output limit）。
- 成本元数据（cost metadata）。
- 可靠性元数据（reliability metadata）。

### 6.3 驾驶员分配（Driver Assignment）

- 智能体到驾驶员模型绑定（agent -> driver model）。
- 裁判到裁判模型绑定（judge -> judge model）。
- 解说到解说模型绑定（caster -> caster model）。
- 弹幕到弹幕模型绑定（barrage -> barrage model）。
- 新闻到新闻模型绑定（news -> news model）。

### 6.4 提示词模板（Prompt Templates）

- 智能体行动提示词（agent action prompt）。
- 裁判提示词（judge prompt）。
- 回合战报提示词（round report prompt）。
- 解说提示词（caster prompt）。
- 弹幕提示词（barrage prompt）。
- 新闻提示词（news prompt）。
- 奖项提示词（awards prompt）。

### 6.5 响应解析（Response Parsing）

- Zod 结构校验（Zod schema）。
- JSON 修复（JSON repair）。
- 降级解析器（fallback parser）。
- 原始响应归档（raw response archive）。

### 6.6 重试与降级（Retry & Fallback）

- 供应商重试（provider retry）。
- 模型降级（model fallback）。
- 结构修复（schema repair）。
- 超时处理（timeout handling）。

### 6.7 依赖关系（Dependencies）

- 输入：M03 智能体档案（agent profile）、M05 任务上下文（task context）、M18 限流规则（rate limits）。
- 输出：结构化响应（structured responses） 给 M05 / M07 / M09 / M12。

## 7. M05 比赛模拟引擎（Simulation Engine）

### 7.1 比赛模拟（Match Simulation）

- 启动比赛（start match）。
- 执行地图禁选（veto）。
- 启动地图（start map）。
- 推进回合（play round）。
- 判断比赛完成（match completed）。

### 7.2 回合流水线（Round Pipeline）

- 读取当前状态。
- 选择激活智能体（active agents）。
- 构建上下文。
- 调用双方行动（action）。
- 调用裁判（judge）。
- 生成回合战报（round report）。
- 写入事件（events）。
- 更新摘要（summary）。

### 7.3 上下文构建器（Context Builder）

- 当前任务。
- 当前经济。
- 当前比分。
- 最近 2-3 个回合（round）。
- 地图摘要（map summary）。
- 比赛摘要（match summary）。
- 已暴露弱点。

### 7.4 摘要引擎（Summary Engine）

- 回合摘要（round summary）。
- 地图摘要（map summary）。
- 比赛摘要（match summary）。
- 队伍战术记忆（team tactical memory）。

### 7.5 模拟模式（Simulation Modes）

- 假模型供应商模式（fake provider mode）。
- 本地单场比赛模式（local single match mode）。
- 完整赛事模式（full tournament mode）。
- 仅回放模式（replay-only mode）。

### 7.6 依赖关系（Dependencies）

- 输入：M02 状态（state）、M03 智能体（agents）、M04 驾驶员（drivers）、M06 经济系统（economy）。
- 输出：M08 事件日志（event log）、M09 转播任务（broadcast jobs）、M11 数据统计（stats）。

## 8. M06 Token 经济系统（Token Economy）

### 8.1 经济状态（Economy State）

- token 银行（token bank）。
- Agent 级经济主体。
- 团队经济加总展示。
- 经济上限（agentTokenCap）。
- 购买类型（buy type）。
- 连败补偿（loss bonus）。
- 战术暂停次数（timeout count）。
- 保经济 / 强起状态（save / force buy）。

### 8.2 购买类型（Buy Types）

- 全甲全弹（Full Buy）。
- 半起（Half Buy）。
- 经济局（Eco）。
- 强起（Force Buy）。
- 保枪 / 保经济（Save）。

### 8.3 经济影响（Economy Effects）

- 单个 Agent 的购买预算。
- 可见上下文预算（visibleContextBudget）。
- 可见历史范围。
- 战术暂停（timeout）可用性。
- 输出预算。
- 输出闸门（Output Gate）裁剪。
- 是否允许教练指令（coach call）。

### 8.4 经济事件（Economy Events）

- 经济更新事件（economy_updated）。
- Drop 创建事件（drop_created）。
- 强起事件（force_buy_called）。
- 保经济事件（save_called）。
- 战术暂停使用事件（timeout_used）。
- 输出闸门应用事件（output_gate_applied）。
- 经济局残局事件（eco_clutch）。
- 经济崩盘事件（economy_collapse）。

### 8.5 排除项（Exclusions）

- 不根据模型成本调整购买类型（buy type）。
- 不让模型档位（model tier）成为比赛资源。
- 不把模型供应商（provider）价格直接计入比赛经济。

### 8.6 依赖关系（Dependencies）

- 输入：M02 回合结果（round result）、M07 裁判结果（judge result）。
- 输出：M05 激活约束（active constraints）、M08 经济事件（economy events）、M11 经济数据（economy stats）。

## 9. M07 裁判与评分（Judge & Scoring）

### 9.1 裁判判定（Judge Decision）

- 回合胜者（round winner）。
- 分数变化（score delta）。
- 裁判理由（judge reason）。
- 关键失误（key mistake）。
- 关键优势（key strength）。

### 9.2 地图评分（Map Scoring）

- 回合比分（round score）。
- 地图胜者（map winner）。
- 加时处理（overtime handling）。

### 9.3 智能体评级（Agent Rating）

- 影响力（impact）。
- 残局（clutch）。
- 辅助价值（support value）。
- token 效率（token efficiency）。
- 关键回合权重（key round weight）。

### 9.4 质量控制（Quality Control）

- 裁判一致性（judge consistency）。
- 反重复（anti-repetition）。
- 非法输出修复（invalid output repair）。
- 确定性降级（deterministic fallback）。

### 9.5 依赖关系（Dependencies）

- 输入：M05 智能体行动（agent actions）、M06 经济上下文（economy context）。
- 输出：M02 比分更新（score update）、M08 裁判事件（judge events）、M11 评级（rating）。

## 10. M08 事件日志与时间线（Event Log & Timeline）

### 10.1 事件日志（Event Log）

- 不可变事件（immutable event）。
- 载荷（payload）。
- 时间线毫秒（timelineMs）。
- 创建时间（createdAt）。
- 来源模块（source module）。

### 10.2 事件类型（Event Types）

- 比赛开始事件（match_started）。
- 地图开始事件（map_started）。
- 回合开始事件（round_started）。
- 智能体行动事件（agent_action）。
- 裁判判定事件（judge_decision）。
- 经济更新事件（economy_update）。
- 击杀播报事件（kill_feed）。
- 高光（highlight）。
- 解说台词事件（caster_line）。
- 弹幕（barrage）。
- 支持率更新事件（support_rate_update）。
- 运行控制事件（runtime_control）。
- 地图结束事件（map_completed）。
- 比赛结束事件（match_completed）。

### 10.3 时间线投影（Timeline Projection）

- 事件排序。
- 伪直播播放时间。
- 回放时间线（replay timeline）。
- 回合时间线（round timeline）。

### 10.4 事件消费者（Event Consumers）

- M09 伪直播（pseudo live）。
- M10 2D renderer。
- M11 数据统计（stats）。
- M12 news。
- M17 admin / control。
- M18 observability。

### 10.5 依赖关系（Dependencies）

- 输入：M05 / M06 / M07 / M09 / M12 / M17。
- 输出：所有下游模块的事实源。

## 11. M09 转播与伪直播（Broadcast & Pseudo Live）

### 11.1 解说席（Caster Desk）

- 主解说。
- 分析解说。
- 嘉宾 / 毒舌位。
- 赛前、赛中、赛后语气。

### 11.2 弹幕系统（Barrage System）

- 普通弹幕。
- 高能弹幕。
- 刷屏时刻。
- 事件绑定反应。

### 11.3 击杀播报（Kill Feed）

- 击穿。
- 反制。
- 偷点。
- 拆解。
- 逼出暂停。
- 残局（clutch）。

### 11.4 支持率（Support Rate）

- 赛前支持率。
- round 后动态变化。
- 爆冷指数。
- 分歧度。

### 11.5 回放卡片（Replay Cards）

- 标题。
- 发生回合。
- 背景。
- 原始 event。
- 解说版本。
- 数据面板。

### 11.6 依赖关系（Dependencies）

- 输入：M08 events、M02 match state、M03 identities。
- 输出：M10 渲染事件（render events）、M12 内容素材（content materials）、M11 高光数据（highlight stats）。

## 12. M10 2D 战术渲染器（2D Tactical Renderer）

### 12.1 地图布局（Map Layout）

- 地图区域（map zones）。
- 控制区域（control regions）。
- spawn / site / mid / connector 抽象区域。

### 12.2 智能体可视化（Agent Visualization）

- 智能体图标（agent icon）。
- 角色标记（role marker）。
- 状态徽标（state badge）。
- 移动路径（move path）。
- 行动闪烁（action flash）。

### 12.3 控制区可视化（Control Visualization）

- 区域归属。
- 争夺状态。
- 控制变化（control delta）。
- 压力指示器（pressure indicator）。

### 12.4 直播回放播放（Live Playback）

- 时间线播放器（timeline player）。
- 暂停 / 重放（pause / replay）。
- 速度控制（speed control）。
- 高光跳转（highlight jump）。

### 12.5 依赖关系（Dependencies）

- 输入：M08 时间线事件（timeline events）、M09 broadcast events、M13 map素材。
- 输出：用户观赛体验，不反写比赛事实。

## 13. M11 数据统计与奖项（Stats & Awards）

### 13.1 队伍数据（Team Stats）

- 地图胜场（maps won）。
- 回合胜场（rounds won）。
- 经济效率（economy efficiency）。
- 残局回合数（clutch rounds）。
- 地图胜率（map win rate）。

### 13.2 智能体数据（Agent Stats）

- 评级（rating）。
- 影响力（impact）。
- 残局（clutch）。
- 突破成功（entry success）。
- 辅助修补（support repairs）。
- token 效率（token efficiency）。

### 13.3 奖项（Awards）

- 最有价值选手（MVP）。
- 优秀价值选手（EVP）。
- 最佳残局（Best Clutch）。
- 最佳教练指令（Best Coach Call）。
- 最佳突破（Best Entry）。
- 最高 Token 效率（Most Token Efficient）。
- 最具节目效果（Most Entertaining）。

### 13.4 排行榜（Leaderboards）

- MVP 竞争榜（MVP race）。
- 高光排行榜（highlight ranking）。
- 经济排行榜（economy ranking）。
- 支持率排行榜（support rate ranking）。

### 13.5 依赖关系（Dependencies）

- 输入：M08 events、M07 scoring、M09 highlights。
- 输出：M12 news素材、M17 admin view、用户 Stats 页面。

## 14. M12 新闻与媒体（News & Media）

### 14.1 赛前内容（Pre-match Content）

- 赛前前瞻。
- 地图池分析。
- 关键对位。
- 支持率解读。

### 14.2 赛中内容（In-match Content）

- 快讯。
- 爆冷提示。
- 关键回合摘要。

### 14.3 赛后内容（Post-match Content）

- 战报。
- 赛后采访。
- 今日五佳。
- 深度复盘。

### 14.4 长内容（Long-form Content）

- 赛事纪录。
- 队伍故事线。
- MVP 专题。
- 数据观察。

### 14.5 依赖关系（Dependencies）

- 输入：M08 events、M09 broadcast、M11 数据统计（stats）。
- 输出：门户页内容、赛后沉淀、后续 prompt 素材。

## 15. M13 素材与导入（Materials & Imports）

### 15.1 队伍来源（Team Source）

- 手动 JSON（manual JSON）。
- HLTV / Valve ranking 手动导入。
- 自定义邀请队。

### 15.2 幽灵战队转译（Ghost Conversion）

- 真实来源 -> ghost team。
- 阵容到智能体角色映射（roster -> agent roles）。
- 种子顺位到对阵树映射（seed -> bracket）。
- team DNA 生成。

### 15.3 地图素材（Map Materials）

- 地图名称（map names）。
- 地图区域（map zones）。
- 地图目标定义（map objective definitions）。
- 地图专属提示词片段（map-specific prompt fragments）。

### 15.4 转播素材（Broadcast Materials）

- 虚构官解风格库。
- 弹幕语料池。
- 梗标签。
- 禁用表达。

### 15.5 依赖关系（Dependencies）

- 输入：人工整理素材。
- 输出：M03 teams、M10 map layouts、M09 broadcast style。

## 16. M14 持久化与存储（Persistence & Storage）

### 16.1 数据库（Database）

- SQLite 优先（SQLite first）。
- 后期迁移 Postgres（Postgres later）。
- 结构迁移（schema migration）。

### 16.2 仓储接口（Repositories）

- 赛事（Tournament）Repository。
- 队伍仓储接口（TeamRepository）。
- 比赛（Match）Repository。
- 事件仓储接口（EventRepository）。
- 摘要仓储接口（SummaryRepository）。
- 产物仓储接口（ArtifactRepository）。

### 16.3 产物文件（Artifacts）

- 大模型原始响应（raw LLM responses）。
- 导出的赛事 JSON（exported tournament JSON）。
- 生成的文章（generated articles）。
- 回放快照（replay snapshots）。
- 调试日志（debug logs）。

### 16.4 备份与导出（Backup & Export）

- 完整赛事导出（full tournament export）。
- 比赛回放导出（match replay export）。
- 数据统计导出（stats export）。

### 16.5 依赖关系（Dependencies）

- 输入：所有模块写入。
- 输出：所有模块读取。

## 17. M15 队列与调度（Queue & Scheduling）

### 17.1 任务队列（Job Queue）

- 本地队列（local queue）。
- 后期 BullMQ（BullMQ future）。
- 优先级（priority）。
- 重试（retry）。
- 延迟执行（delay）。

### 17.2 任务类型（Job Types）

- 模拟回合任务（simulate_round）。
- 生成解说台词任务（generate_caster_lines）。
- 生成弹幕任务（generate_barrage）。
- 检测高光任务（detect_highlights）。
- 生成文章任务（generate_article）。
- 更新奖项任务（update_awards）。

### 17.3 限流器（Rate Limiter）

- 全局并发（global concurrency）。
- 单场比赛并发（per match concurrency）。
- 模型供应商每分钟请求数（provider RPM）。
- 模型供应商每分钟 token 数（provider TPM）。

### 17.4 失败处理（Failure Handling）

- 重试（retry）。
- 死信任务（dead letter）。
- 降级（fallback）。
- 人工恢复（manual resume）。

### 17.5 依赖关系（Dependencies）

- 输入：M05 / M09 / M12 job requests。
- 输出：LLM 调度和异步内容生成。

## 18. M16 API 与集成（API & Integration）

### 18.1 命令接口（Command API）

- 创建赛事（create tournament）。
- 导入队伍（import teams）。
- 开始比赛（start match）。
- 推进下一回合（play next round）。
- 生成回放（generate replay）。

### 18.2 查询接口（Query API）

- 赛事详情（tournament detail）。
- 比赛详情（match detail）。
- 事件列表（event list）。
- 能力数据（stats）。
- 文章（articles）。

### 18.3 流式接口（Stream API）

- 比赛事件流（match event stream）。
- 回放流（replay stream）。
- 任务状态流（job status stream）。

### 18.4 公开契约（Public Contract）

- 本地 UI 和 Web UI 使用同一 API 语义。
- 后期接外部前端或移动端不改核心引擎。

### 18.5 依赖关系（Dependencies）

- 输入：UI / admin 操作。
- 输出：M02 / M05 commands、M08 event queries。

## 19. M17 管理与控制台（Admin & Control Panel）

### 19.1 赛事控制（Tournament Control）

- 创建赛事。
- 导入队伍。
- 开始 match。
- 推进下一回合（play next round）。
- 暂停 / 恢复（pause / resume）。
- 回合审查窗口（review window）。
- 地图审查确认（map review confirmation）。

### 19.2 调试视图（Debug View）

- 当前状态。
- 任务状态（job status）。
- 大模型调用（LLM calls）。
- token 用量（token usage）。
- 事件检查器（event inspector）。

### 19.3 人工干预（Manual Override）

- 重新生成回合战报（round report）。
- 重新生成解说。
- 修复坏 event。
- 强制推进。
- 运行控制事件（runtime_control event）审计。

### 19.4 依赖关系（Dependencies）

- 输入：M14 state、M15 jobs、M18 logs。
- 输出：M16 commands、M05 control。

## 20. M18 可观测性与成本控制（Observability & Cost Control）

### 20.1 大模型用量（LLM Usage）

- 输入 token（input tokens）。
- 输出 token（output tokens）。
- 总 token（total tokens）。
- 预估成本（estimated cost）。
- 延迟（latency）。

### 20.2 模拟指标（Simulation Metrics）

- 回合耗时（round duration）。
- 重试次数（retries）。
- 结构校验失败（schema failures）。
- 队列等待时间（queue wait time）。

### 20.3 成本上限（Cost Caps）

- 单回合上限（per round cap）。
- 单场比赛上限（per match cap）。
- 单届赛事上限（per tournament cap）。
- 供应商上限（provider cap）。

### 20.4 质量指标（Quality Metrics）

- 重复度评分（repetition score）。
- 非法结构率（invalid schema rate）。
- 高光密度（highlight density）。
- 裁判分歧（judge disagreement）。

### 20.5 依赖关系（Dependencies）

- 输入：M04 calls、M15 jobs、M08 events。
- 输出：M15 rate limits、M17 debug view、降级策略。

## 21. M19 安全、权益与合规（Safety, Rights & Compliance）

### 21.1 幽灵战队策略（Ghost Team Policy）

- 不直接使用真实 logo。
- 不声称官方授权。
- 不复刻真实选手人格。

### 21.2 解说策略（Caster Policy）

- 虚构官解。
- 不复刻真实主播人格。
- 不大段复制真实语料。

### 21.3 支持率策略（Support Rate Policy）

- 支持率不是赔率。
- 不接真钱。
- 不提供赌博建议。

### 21.4 内容审核（Content Moderation）

- 禁止人身攻击。
- 限制敏感表达。
- 过滤不适合公开展示内容。

### 21.5 依赖关系（Dependencies）

- 输入：M13素材、M09解说弹幕、M12新闻。
- 输出：prompt guardrails、内容审核规则。

## 22. M20 测试与样例数据（Testing & Fixtures）

### 22.1 样例数据（Fixtures）

- 假队伍（fake teams）。
- 假智能体（fake agents）。
- 假地图（fake maps）。
- fake 回合战报（round report）s。
- fake 时间线事件（timeline events）。

### 22.2 单元测试（Unit Tests）

- 对阵树（bracket）。
- 经济系统（economy）。
- 评分系统（scoring）。
- 事件投影（event projection）。
- 结构校验（schema validation）。

### 22.3 集成测试（Integration Tests）

- 跑通一个回合（play one round）。
- 跑通一张地图（play one map）。
- play BO3。
- 回放时间线（replay timeline）。

### 22.4 黄金样例（Golden Samples）

- 标准 回合战报（RoundReport）。
- 标准 击杀播报（kill feed）。
- 标准 caster lines。
- 标准 replay card。

### 22.5 依赖关系（Dependencies）

- 输入：所有核心 schema。
- 输出：开发安全网。

## 23. M21 Web 迁移层（Web Migration Layer）

### 23.1 可替换接口（Replaceable Interfaces）

- 存储仓储接口（StorageRepository）。
- 产物存储接口（ArtifactStore）。
- 任务队列接口（JobQueue）。
- 大模型网关接口（LlmGateway）。
- 限流器接口（RateLimiter）。
- 事件发布接口（EventPublisher）。

### 23.2 本地实现（Local Implementations）

- SQLite 数据库（SQLite）。
- 本地文件系统（local file system）。
- 内存队列（in-memory queue）。
- 本地限流器（local rate limiter）。
- SSE 发布器（SSE publisher）。

### 23.3 Web 实现（Web Implementations）

- Postgres 数据库（Postgres）。
- 对象存储（object storage）。
- BullMQ 队列（BullMQ）。
- Redis 限流器（Redis limiter）。
- 已部署工作器（deployed worker）。

### 23.4 迁移约束（Migration Constraints）

- 不把业务状态只放内存。
- 不让 Core Engine 依赖 Next.js request。
- 不让 UI 直接写数据库。
- 不让 LLM provider 逻辑散落在业务模块。

### 23.5 依赖关系（Dependencies）

- 输入：M14 / M15 / M16 抽象。
- 输出：后期 Web 化路径。

## 24. 模块勾稽关系总表

```text
M01 规则定义
  -> M02 赛事状态机
  -> M05 模拟流程
  -> M09 / M12 内容风格

M13 素材导入
  -> M03 队伍与 agent
  -> M10 地图布局
  -> M09 解说弹幕风格

M03 agent 设定
  -> M05 active agent 选择
  -> M04 driver 绑定
  -> M11 agent stats
  -> M09 转播身份

M04 LLM driver
  -> M05 agent action
  -> M07 judge
  -> M09 broadcast
  -> M12 media

M06 经济系统
  -> M05 round constraints
  -> M08 经济事件（economy events）
  -> M11 经济数据（economy stats）

M05 模拟引擎
  -> M07 judge
  -> M08 事件日志（event log）
  -> M14 persistence
  -> M15 async jobs

M08 事件日志（event log）
  -> M09 伪直播（pseudo live）
  -> M10 2D renderer
  -> M11 数据统计（stats）
  -> M12 news
  -> M17 admin/debug

M11 数据统计（stats）
  -> M12 news
  -> M09 broadcast talking points
  -> M17 admin

M14 persistence
  -> all modules
  -> M21 web migration

M15 queue
  -> M04 LLM calls
  -> M09 / M12 async generation
  -> M18 rate/cost control
```

## 25. 当前判断

模块范围已经可以认为完整，但不应该同时深入实现所有模块。

下一步应该按优先级逐个补文档，每补一个模块都必须写清楚：

```text
1. 它消费哪些上游数据。
2. 它产生哪些下游数据。
3. 它依赖哪些 schema。
4. 它的最小可用版本是什么。
5. 它和 事件日志（event log） 的关系是什么。
```












