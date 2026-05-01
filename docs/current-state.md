# 当前工作状态

## 1. 文档定位

这份文档是 Agent Major 当前工程状态的状态锚点，用来回答三个问题：

```text
现在已经完成到哪里？
当前还缺什么？
下一步应该做什么，不应该做什么？
```

如果本文件与早期技术设计中的“当前建议”不一致，以本文件和 `docs/p-phase-delivery-framework.md` 的最新阶段判断为准。

## 2. 当前已完成

### 文档层

已经完成并可作为当前工程输入的契约：

```text
P0：事实源与边界层。
P1：最小比赛闭环。
P2.1：直播时间线说明。
```

对应文件包括：

```text
docs/domain-schema.md
docs/event-taxonomy.md
docs/rules-format.md
docs/round-report-contract.md
docs/token-economy.md
docs/llm-driver-contract.md
docs/simulation-engine.md
docs/local-persistence.md
docs/live-timeline.md
```

这些文档已经足够支撑本地 fake provider MVP，不需要等待 P2.2 / P2.3 / P3 / P4 全部完成后再继续工程。

### 工程层

当前已经完成：

```text
Phase 1.0：工程骨架。
Phase 1.1：单回合 replay。
Phase 1.2：单张地图 replay。
Phase 1.3：BO3 fake provider。
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

当前只是部分启动：

```text
Web 页面可以展示单图 replay。
还不是按 TimelineEvent 播放的伪直播播放器。
还没有播放控制、倍速、回合跳转、高光跳转。
还没有 2D 战术地图渲染。
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

尚未展开成正式契约：

```text
P2.2：2D 战术地图说明。
P2.3：转播系统说明。
P3：数据、奖项、新闻、素材库。
P4：API、队列、可观测性、Web 迁移。
```

这些模块要保留接口意识，但不应阻塞 Phase 1.4。

## 4. 当前下一步

当前只建议做一件主线工作：

```text
进入 Phase 1.4：极简伪直播 demo。
```

Phase 1.4 的最小验收口径：

```text
1. 不重新模拟比赛，只消费 Phase 1.3 产出的 match / map replay。
2. 前端可以按 TimelineEvent 播放一张地图。
3. 支持播放 / 暂停 / 重置 / 回合跳转。
4. 展示比分、回合战报、事件流、关键高光。
5. 保留未来 BO3 地图切换和 2D 战术地图接口。
```

当前不建议先做：

```text
不先接真实 LLM。
不先做完整 2D 地图。
不先做新闻站、奖项站或 16 队完整赛事。
不先做 Web 部署。
```

原因是 BO3 match 级事实源已经具备，下一步应该验证它能否被观赛层稳定消费。

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
