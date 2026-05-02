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
```

文档结构迁移状态：

```text
旧的 docs/*.md 根目录文档已经迁移到分层目录。
旧路径不再作为维护入口。
后续提交必须整体纳入 docs 的删除、新增、移动和 README 索引更新，避免只提交旧文档删除或只提交新文档新增。
```

这些文档已经足够支撑本地 fake provider MVP，不需要等待 P2.3 / P3 / P4 全部完成后再继续工程。

### 工程层

当前已经完成：

```text
Phase 1.0：工程骨架。
Phase 1.1：单回合 replay。
Phase 1.2：单张地图 replay。
Phase 1.3：BO3 fake provider。
Phase 1.4：极简伪直播播放器基础版。
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

当前 demo 输出：

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

### Phase 1.5：真实 LLM 小范围接入

尚未开始：

```text
真实 provider 接入。
真实 llm_calls 记录。
结构化输出失败修复。
provider fallback。
真实 token / cost 观测。
```

真实 API 成本和比赛内 Token 经济仍然不耦合。

### P2.2 之后的文档

当前状态：

```text
P2.2：2D 战术地图说明，已完成，见 docs/p2-broadcast-viewer/tactical-map.md。
P2.3：转播系统说明，下一步补齐。
P3：数据、奖项、新闻、素材库。
P4：API、队列、可观测性、Web 迁移。
```

P2.3 是当前文档主线；P3 / P4 只保留边界意识，不展开到实现细节。

## 4. 当前下一步

当前只建议做一件主线工作：

```text
补 P2.3：转播系统边界说明。
```

下一步优先补强对象：

```text
1. P2.3：定义 Caster / Barrage / Highlight / Replay Clip 的输入、输出和异步生成边界。
2. P2.3：明确哪些转播内容来自结构化事实源，哪些只是可丢弃的包装层。
3. P2.3：补清转播系统与 RoundReport、TimelineEvent、map_summary keyRounds、tactical map zones 的勾稽关系。
4. P2.3：定义缺失解说、缺失弹幕、低质量包装内容时的降级规则。
```

当前不建议先做：

```text
不先接真实 LLM。
不先做完整 2D 地图。
不先做新闻站、奖项站或 16 队完整赛事。
不先做 Web 部署。
```

原因是 BO3 match 级事实源、Phase 1.4 播放层、第一轮赛事语义收口和 P2.2 2D 战术地图契约已经具备。继续接真实 LLM 前，先把转播系统的消费边界写清楚，可以避免包装层反向污染事实源。

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
