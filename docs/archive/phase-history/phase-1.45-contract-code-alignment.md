# Phase 1.45 契约代码落地计划

## 1. 阶段定位

Phase 1.45 是 Phase 1.4 和 Phase 1.5 之间的契约落地补丁阶段。

```text
Phase 1.4：已经有 BO3 伪直播播放器基础版。
Phase 1.45：把 P2.2 / P2.3 的关键契约变成可测试代码锚点。
Phase 1.5：在这些锚点上做真实 LLM 小范围接入。
```

本阶段不接真实 LLM，不新增 SQLite 表，不做完整美术地图，不做新闻、奖项或完整赛事生态。

## 2. 设计依据

P2.2 已经冻结为 Phase 1 fake provider MVP 的 2D 战术地图契约，要求：

```text
稳定 map zone。
未知 map / zone 可 fallback。
2D 地图只消费 RoundReport / TimelineEvent，不反写比赛事实。
```

P2.3 已经完成，并在 Phase 1 范围内按 Frozen 执行，要求：

```text
Fact First, Broadcast Second。
转播包装失败不阻塞比赛。
转播包装不能修改比分、裁判、经济、RoundReport 或 Event Log。
真实 LLM 第一接入点优先选择 caster_line。
```

当前数据库已经有 Event、TimelineEvent、Artifact、llm_calls 表骨架，但没有 broadcast_items / highlights 表。因此 Phase 1.45 使用现有 Event + TimelineEvent 承载包装层，不提前扩表。

## 3. 已落地代码范围

P2.2 代码锚点：

```text
packages/core/src/tactical-map.ts
```

已提供：

```text
getTacticalMapLayout(mapName)
resolveTacticalZone(layout, zoneId)
DUST2 / INFERNO / MIRAGE / DEFAULT 布局
8 个稳定 zone
fallback zone 解析
```

P2.3 代码锚点：

```text
packages/core/src/broadcast.ts
```

已提供：

```text
BroadcastSourceBundle
BroadcastItem
GenerationMode
QualityStatus
Broadcast Quality Gate
caster_line fallback
barrage fallback
support_rate rule
replay_card rule
```

引擎集成：

```text
回合事实先写入 RoundReport / Event。
随后追加 caster_line_created / barrage_created / support_rate_updated / replay_card_created。
TimelineEvent 继续作为播放层入口。
```

Web 集成：

```text
LiveReplayData 增加 tacticalMap。
LiveRoundFrame 增加 tacticalMap / barrageMessages / supportRate / replayCard。
播放器用最小 2D 节点和连线替代旧虚拟区域列表。
```

## 4. 验收标准

必须满足：

```text
三图和 DEFAULT 都包含 8 个稳定 zone。
未知地图返回 DEFAULT。
未知 zone 返回 fallback zone，且标记 weak。
BroadcastItem 必须有 sourceEventIds。
BroadcastItem 不泄露 driverModelId / providerId / modelName / token / cost。
包装内容不能覆盖事实比分和胜者。
caster / barrage / support_rate / replay_card 包装失败不能阻塞比赛。
浏览器 ViewModel 不暴露 raw events、agentOutputs 或真实模型信息。
```

验收命令：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm phase13:match
pnpm phase13:replay
pnpm phase13:export
```

## 5. Phase 1.5 交接点

Phase 1.5 不应该重做转播系统边界。它只需要把 Phase 1.45 的生成器从 fallback/rule 替换为真实 LLM 版本。

推荐接入顺序：

```text
1. caster_line。
2. barrage。
3. replay_card 文案增强。
```

仍然禁止：

```text
LLM 直接决定比分。
LLM 直接决定裁判结果。
LLM 直接决定支持率基础公式。
LLM 直接决定高光基础权重。
真实 API 成本进入 Token 经济。
```

## 6. 收口结论

Phase 1.45 的职责到此为止：它提供稳定 2D 战术地图展示、转播包装事件、Web ViewModel 和 fallback 生成器。

区域化攻防机制属于后续 Phase 1.6：

```text
Phase 1.45 不追加 SideAssignment / AttackPlan / DefenseDeployment。
Phase 1.45 不修改 RoundReport schema。
Phase 1.45 不新增攻防相关 EventType。
Phase 1.45 不改变当前 fake provider 的胜负判定。
```

因此 Phase 1.45 可以在当前验收命令全部通过、网页人工检查通过后收口。Phase 1.5 继续聚焦真实 LLM 小范围接入，优先替换 `caster_line` 生成器。
