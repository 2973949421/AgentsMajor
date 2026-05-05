# 当前工作状态

## 1. 文档定位

这份文档是 Agent Major 当前工程状态的状态锚点，用来回答三个问题：

```text
现在已经完成到哪里？
当前还缺什么？
下一步应该做什么，不应该做什么？
```

如果本文件与早期技术设计中的“当前建议”不一致，以本文件和 `docs/meta/p-phase-delivery-framework.md` 的最新阶段判断为准。

## 2. 当前已完成

### 文档层

已经完成并可作为当前工程输入的契约：

```text
P0：事实源与边界层。
P1：最小比赛闭环。
P2.1：直播时间线说明。
P2.2：2D 战术地图说明。
P2.3：转播系统说明。
```

对应文件包括：

```text
docs/p0-foundation/domain-schema.md
docs/p0-foundation/event-taxonomy.md
docs/p0-foundation/rules-format.md
docs/p1-match-loop/round-report-contract.md
docs/p1-match-loop/token-economy.md
docs/p1-match-loop/llm-driver-contract.md
docs/p1-match-loop/simulation-engine.md
docs/p1-match-loop/local-persistence.md
docs/p2-broadcast-viewer/live-timeline.md
docs/p2-broadcast-viewer/tactical-map.md
docs/p2-broadcast-viewer/broadcast-system.md
```

文档结构迁移状态：

```text
旧的 docs/*.md 根目录文档已经迁移到分层目录。
旧路径不再作为维护入口。
后续提交必须整体纳入 docs 的删除、新增、移动和 README 索引更新，避免只提交旧文档删除或只提交新文档新增。
```

这些文档已经足够支撑本地 fake provider MVP，不需要等待 P3 / P4 全部完成后再继续工程。

### 工程层

当前已经完成：

```text
Phase 1.0：工程骨架。
Phase 1.1：单回合 replay。
Phase 1.2：单张地图 replay。
Phase 1.3：BO3 fake provider。
Phase 1.4：极简伪直播播放器基础版。
Phase 1.45：P2.2 / P2.3 契约代码落地。
Phase 1.5：真实 LLM 小范围接入。
Phase 1.6：区域化攻防回合协议。
Phase 1.7：Materials runtime integration 与角色契约升级。
```

Phase 1.2 的当前事实：

```text
可用 fake provider 跑完整张 MR6 地图。
可从常规 12 回合进入 MR3 加时。
可写入 RoundReport、Event、EconomyState、TimelineEvent。
可生成 map_summary。
可通过 CLI replay 读取。
可导出地图 JSON。
Web 页面已经能读取 SQLite 并展示地图 replay。
```

Phase 1.2 历史 demo 输出（已归档，不再作为当前前端例子）：

```text
地图：DUST2
对阵：Ghost NAV vs Ghost FUR
比分：Ghost NAV 10-8 Ghost FUR
回合数：18
加时：yes
地图事件：273
回合事件：270
时间线事件：162
MVP 候选：agent_nav_star
```

可复现命令：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm phase12:map
pnpm phase12:replay
pnpm phase12:export
```

## 3. 当前状态

### Phase 1.3：BO3 fake provider

已完成并已做稳定性加固：

```text
runCurrentMatch。
最多 3 张 MapGame 的连续推进。
先到 2 图胜的 Match 完成条件。
match_completed 事件。
match summary。
match replay。
match export JSON。
phase13:* CLI 命令。
BO3 级别的确定性测试和失败恢复测试。
已有单图状态升级到 BO3。
最终地图完成时同步完成 Match。
不完整 match replay 不允许导出。
```

Phase 1.3 现在可以作为 match 级事实源底座。后续统计、奖项、新闻、赛后内容可以基于 match replay / match summary 继续推进。

### Phase 1.4：极简伪直播 demo

已完成基础版，并已通过基础验收：

```text
首页已升级为 BO3 伪直播播放器。
播放器只消费 Phase 1.3 产出的 MatchReplay / TimelineEvent，不重新模拟比赛。
客户端使用 LiveReplayData 播放专用 ViewModel，不直接下发完整 MatchReplay。
支持地图选择、单图自动连播、播放、暂停、重置、倍速、回合跳转、高光跳转。
支持 BO3 顶部比分牌、地图标签、当前回合舞台、经济面板、kill feed、主解说、回合摘要、高光区和回合跳转列表。
地图之间采用人工确认切换，不做 BO3 全自动连播。
未播放地图和未到结算时点的比分 / 胜者不提前剧透。
保留 /api/matches/[matchId]/replay 完整 replay 接口，并新增 ?format=live 的轻量播放 ViewModel 返回。
```

Phase 1.4 基础版验收记录：

```text
验收日期：2026-05-02。
pnpm phase13:match：通过。
pnpm --filter @agent-major/web typecheck：通过。
pnpm build:web：通过。
pnpm dev：启动成功。
首页 GET /：200。
已推送基础版提交：5dbca81 Implement Phase 1.4 pseudo live replay。
远端分支：main -> origin/main。
```

说明：`5dbca81` 只代表 Phase 1.4 极简伪直播播放器基础版，不包含后续“内容质量与事件可信度收口”增量。

Phase 1.4 已知边界：

```text
2D 战术地图不属于当前验收范围。
弹幕系统不属于当前验收范围。
新闻 / 奖项 / 统计站不属于当前验收范围。
浏览器内播放交互细节仍可继续做人工抽查，但不阻塞基础验收结论。
当前已经完成第一轮内容质量收口；真实 LLM 接入后仍需要二次内容调校。
```

Phase 1.4 内容质量与事件可信度收口记录：

```text
收口日期：2026-05-02。
版本归属：这是 5dbca81 之后的 Phase 1.4 增量收口，不能归属到 5dbca81；提交哈希以 git log 最新记录为准。
RoundReport：移除 Phase 1.2/demo 口径，摘要改为比分、购买态势、关键事件和高光语义共同驱动。
JudgeResult：胜负原因改为地图、回合、比分压力、MVP 和优势类型共同生成。
RoundKeyEvent：入口控制、优势转化 / 残局收束、经济波动事件具备机器可消费语义。
HighlightTags：不再使用 phase12_demo / team_a_round / team_b_round，改为 map_closeout、overtime_round、economy_swing 等语义标签。
TimelineEvent：round_intro、scoreboard_update、economy_panel_update、caster_line、highlight_reveal、round_result 的 payload 已补齐回放语义。
map_summary：keyRounds 改为基于语义标签评分筛选，并保留 reason、highlightTags、summary。
播放器模型：继续过滤泛化高光标签，并支持仅从 RoundReport.highlightTags 识别高光回合。
验证：TypeScript 全项目检查通过；全项目 Vitest 34 用例通过；Next Web build 通过；phase13 match / replay / export 顺序烟测通过。
```

### Phase 1.45：P2.2 / P2.3 契约代码落地

已完成基础版：

```text
P2.2 战术地图布局代码化。
DUST2 / INFERNO / MIRAGE / DEFAULT 四套抽象布局。
每张地图包含 8 个稳定 zone。
未知 map / zone 可 fallback，不阻塞播放。
P2.3 转播基础类型代码化。
caster_line / barrage / support_rate / replay_card 规则或 fallback 生成。
Broadcast Quality Gate 校验 sourceEventIds、事实一致性和模型信息隐藏。
回合完成后追加 caster_line_created / barrage_created / support_rate_updated / replay_card_created。
TimelineEvent 继续作为播放层入口，不新增 API route。
Web LiveReplayData 增加 tacticalMap、barrageMessages、supportRate、replayCard。
播放器已用最小可见 2D 节点 / 连线地图替代旧虚拟区域列表。
```

Phase 1.45 边界：

```text
不接真实 LLM。
不读取 .env。
不新增 SQLite 表。
不实现完整美术地图。
不让转播包装反写比赛事实。
```

Phase 1.45 验收记录：

```text
验证日期：2026-05-02。
pnpm typecheck：通过。
pnpm test：通过，39 个测试通过。
pnpm build：通过。
pnpm phase13:match / phase13:replay / phase13:export：按顺序烟测通过。
```

Phase 1.45 收口补充：

```text
区域化攻防机制已作为 Phase 1.6 预留设计写入文档。
Phase 1.45 不追加 SideAssignment / AttackPlan / DefenseDeployment。
Phase 1.45 不修改 RoundReport schema。
Phase 1.45 不新增攻防相关 EventType。
Phase 1.45 不改变当前 fake provider 的胜负判定。
```

### Phase 1.5：真实 LLM 小范围接入

已完成基础版并收口：

```text
真实 LLM 只接入 caster_line。
比赛事实链路仍由 fake provider / rule engine 驱动。
真实 LLM 不参与 agent_action、judge、比分、经济、RoundReport 事实生成。
DashScope OpenAI 兼容 provider 已实现。
DriverModel 注册表已实现。
.env.local 本地配置加载已实现。
phase15:match / phase15:replay / phase15:export 已实现。
llm_calls 与 Artifact 记录已接入。
真实调用发生在事实事件和 RoundReport 落库之后，不在 SQLite transaction 内等待网络。
LLM 失败、结构不稳定或质量闸门 rejected 时自动 fallback_template。
旧 Phase 1.5 Web smoke runner 曾完成默认关闭、localhost、confirmReset、token 和生产禁用保护；现已从当前前端冻结移除，仅保留 CLI archive/debug 路径。
LiveReplayData 不暴露 raw LLM response、driverModelId、modelName、llm_calls、Artifact 原文或 API Key。
```

Phase 1.5 验收记录：

```text
收口日期：2026-05-02。
pnpm typecheck：通过。
pnpm test：通过。
pnpm build：通过。
真实 DUST2 单图 smoke：通过。
真实 caster_line_created generationMode=llm：18 条。
llm_calls：18 次。
caster payload 模型字段泄露数：0。
Web replay API 敏感字段扫描：未发现 API Key / Authorization / driverModelId / modelName / llm_calls / Artifact / rawText。
data/artifacts 与 data/exports 敏感字段扫描：未发现 sk-sp- / DASHSCOPE_API_KEY / Authorization / Bearer。
```

Phase 1.5 边界：

```text
不把 agent_action 换成真实 LLM。
不把 judge 换成真实 LLM。
不让 LLM 生成 RoundReport 事实。
不修改 Token 经济。
不新增 broadcast_items / highlights 表。
不实现 Phase 1.6 区域化攻防协议。
Web runner 只是本地 smoke 工具，不是生产任务系统。
```

Phase 1.5 使用方式：

```text
默认：AGENT_MAJOR_REAL_LLM_ENABLED=false，不访问真实网络。
真实 CLI smoke：AGENT_MAJOR_REAL_LLM_ENABLED=true 后运行 pnpm phase15:match。
远程或生产触发 Web runner：必须设置 AGENT_MAJOR_WEB_RUNNER_TOKEN，且仍不建议作为正式任务系统。
```

真实 API 成本和比赛内 Token 经济仍然不耦合。

### Phase 1.6：区域化攻防回合协议

该阶段用于承接新的核心思路：

```text
每回合有攻方和守方。
MR6 换边后攻守互换。
攻方选择主攻 A / B、中路控制、假打转点或经济偷点。
守方根据信息不完全、token 余量和历史弱点做重防 A、重防 B、默认分散、中路前压或保守回防。
区域资源分配从 Agent 级 outputBudget 派生，不新增经济主体。
Judge 根据 SubmittedOutput、战术摘要、经济状态和公开上下文判定区域碰撞。
P2.2 只展示战术区域，P2.3 只包装攻防事实。
```

当前状态：

```text
文档、代码和验收均已完成收口。
`phase16:*` 命令已落地并与 `phase13:*`、`phase15:*` 保持隔离。
命令行、Web 播放层、导出边界和人工复查已通过。
```

### Phase 1.7：Materials runtime integration 与角色契约升级

当前状态：

```text
已新增 docs/phase-plans/phase-1.7-materials-runtime-integration.md。
已新增 Node-only @agent-major/materials package。
data/materials/processed 已接入运行时 seeding。
默认 showcase 固定为 Falcon-7B vs VitaLLMty。
默认 BO3 地图为 DUST2 / INFERNO / MIRAGE。
新增 phase17:match / phase17:replay / phase17:export。
Web runner 新增 phase17_showcase_match fake-only 模式。
Phase 1.5 real LLM 单图路径已冻结为 CLI-only archive/debug 路径，不再影响当前前端主线。
```

角色契约已经升级：

```text
Agent.role 主枚举：coach / igl / awper / entry / star_rifler / lurker / support / rifler / stand_in。
Agent.secondaryRoles 保存 anchor / flex / closer / system_architect 等副标签。
Agent.roleProfile 保存 materials 里的 raw position、confidence、positionTags 和职责说明。
Agent.materialRef 保存 materials entity id、team slug、json path、binding version 与 runtimeEnabled:false。
读取旧数据时 star -> star_rifler，closer -> rifler。
新写入不再产生旧 primary role。
```

Phase 1.7 边界：

```text
不跑完整 16 队 bracket。
不启用真实 agent / judge LLM。
不让 materials 的 future LLM binding 影响胜负、战术或生成流程。
不把 future_driver_binding、driver ids、modelName、llm_calls 或 raw materials 全量 JSON 暴露给观众侧。
完整 16 队 bracket 留给 Phase 2.0。
```

### 队员 agent 与本地 LLM 环境判断

当前结论：

```text
.env.local 已具备 DASHSCOPE_BASE_URL、DASHSCOPE_API_KEY、AGENT_MAJOR_REAL_LLM_ENABLED、AGENT_MAJOR_LLM_PROVIDER、caster/barrage driver ids、timeout/retries 和 Web runner 开关。
packages/llm/src/model-registry.ts 已注册 qwen / glm / kimi / minimax 多个 driver model ids。
packages/materials/src/index.ts 会严格校验 16 队角色资产和 future_driver_binding，但运行时仍强制 runtime_enabled=false，并把 showcase runtime Agent.driverModelId 统一写成 driver_fake_phase17。
packages/core/src/engine.ts 已具备按 agent.driverModelId 驱动 agent_action、按 mvpAgent.driverModelId 驱动 judge 的能力。
因此，当前资产层和 provider 层已具备条件，但“每个队员由大模型驱动”的 runtime 路由策略、env 契约和安全边界还没有正式落地。
```

这意味着：现在可以继续跑 `caster_line` 级真实 LLM，也可以准备一场本地 BO3 的 per-agent pilot；但要让 10 名 active player 真正进入 `agent_action` 真实驱动，必须单独进入下一阶段实现 runtime driver binding。

### P2.2 之后的文档

当前状态：

```text
P2.2：2D 战术地图说明，已完成，见 docs/p2-broadcast-viewer/tactical-map.md。
P2.3：转播系统说明，已完成，见 docs/p2-broadcast-viewer/broadcast-system.md；Phase 1 范围内可按 Frozen 执行。
P3：数据、奖项、新闻、素材库。
P4：API、队列、可观测性、Web 迁移。
```

P2.3 已补齐 Phase 1 fake provider MVP 和 Phase 1.5 真实 caster_line 需要的转播包装边界。P3 / P4 只保留边界意识，不展开到实现细节。

## 4. 当前下一步

当前判断已经更新为：

```text
1. Phase 1.7 已完成验收收口：旧前端例子已冻结。
2. Phase 1.8 已完成工程收口并暂时冻结：本地真实 LLM BO3 pilot 已打通 CLI + Web、逐回合调试、全量 llm_calls 观测、judge_review 护栏与可重跑链路。
3. Phase 1.9 已完成 UI 收口并暂时冻结：Phase 1.8 only 观赛主屏、左右悬浮选手栏、可拖动控制台、底部事件详情和 replay guard 体验已成型。
4. 当前下一步进入 Phase 2.0-pre：单图 / 定制 BO3 赛事语义校准。
5. 一版节目目标不变：Phase 2.0-pre 通过后，再进入完整 16 队 bracket 与赛事调度设计。
```

下一步优先对象：

```text
1. 落地 Phase 2.0-pre 临时高优先级纲领，并围绕单图赛事语义校准补齐当前唯一口径。
2. 为单张精心设计的地图补齐命题稿、双队初始方案、coach / player / judge 职责协议和裁判评分规程。
3. 在单图跑顺后，再校准一场定制 BO3，并验证图后方案修正机制和前端表达。
4. 只有在 Phase 2.0-pre 通过后，才进入完整 16 队 bracket 的状态机、seed、fixture、赛事调度和失败恢复设计。
```

当前不建议先做：

```text
不在 Phase 1.8 / 1.9 冻结后继续扩展真实 LLM 范围。
不先做完整 2D 美术地图。
不先做完整新闻站、奖项站或 16 队正式赛季实现。
不先做远端部署和长期在线任务系统。
不在未补边界前继续扩公开 API 和公开导出范围。
```

原因是 BO3 match 级事实源、Phase 1.4 播放层、P2.2 2D 战术地图契约、P2.3 转播系统、Phase 1.5 真实 caster_line 链路和 Phase 1.6 区域化攻防协议都已经具备。当前真正的缺口不是赛事壳，而是“地图命题、队伍方案、攻防协议、裁判规程、图后修正”这套赛事语义内核尚未完成校准，因此应先执行 Phase 2.0-pre，而不是直接扩成 16 队正式赛事。

## 5. 长期规划判断

结论：

```text
文档需要想得更长远，但不应该现在把远期模块写到实现细节级别。
```

更准确的做法是：

```text
近期文档写深。
远期文档写边界。
关键契约提前冻结。
实现细节等事实源跑通后再展开。
```

必须提前想清楚的长期问题：

```text
1. 会不会影响 Event / RoundReport / TimelineEvent 的字段和语义。
2. 会不会影响 SQLite 到 Postgres 的迁移。
3. 会不会影响本地 replay 到 Web replay 的兼容性。
4. 会不会影响真实 LLM 调用记录、限流和成本观测。
5. 会不会影响后续队列、worker、失败恢复和任务幂等。
6. 会不会影响公开产品的版权、命名、素材和真实电竞边界。
```

可以后置的长期问题：

```text
1. 新闻文风和栏目包装。
2. 具体 2D 地图美术表现。
3. 弹幕语料细节。
4. 奖项命名和娱乐榜单。
5. Web 页面最终视觉风格。
6. 具体选择哪家真实 LLM provider。
```

判断标准：

```text
如果一个远期设计会改变事实源、状态机、持久化、API 或 replay 兼容性，就必须现在立边界。
如果它只是内容包装、表现层、平衡数值或运营风格，可以先保留方向，不展开细节。
```

因此，当前不需要写一套庞大的 Phase 2-4 详细设计；但需要在 Phase 1.4 前后补一份高层长期路线图，覆盖：

```text
Phase 2：完整 16 队赛事。
Phase 3：赛事生态、统计、奖项、新闻。
Phase 4：Web 化、队列、可观测性、部署。
```

这份长期路线图应该只定义边界、依赖和不可逆决策，不应该替代当前 Phase 1.4 的工程推进。
## Phase 1.6 当前落地状态

Phase 1.6 已作为独立工程阶段落地：`phase16:*` 命令启用 deterministic rule-based 区域化攻防协议，`phase13:*` 与 `phase15:*` 保持隔离。当前版本不访问真实网络、不需要 API Key、不新增 SQLite 表，只在既有事件、回合战报、时间线和 Web ViewModel 上扩展公开战术事实。

已完成的核心能力包括：攻守方分配、AttackPlan、DefenseDeployment、TacticalCollision、`RoundReport.tacticalContext` 持久化、4 个 tactical events、timeline tactical projection、Web `tacticalRound` 与 tactical map 高亮。

下一阶段若继续推进，应优先评估战术协议的数据观察面、更多地图区域、真实 LLM 战术生成的安全边界，以及是否需要 tactical 专表；不应在 Phase 1.6 v1 中让真实 LLM 影响胜负判定。
