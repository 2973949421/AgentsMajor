# 模块地图

本文描述 Agent Major 的模块边界和长期依赖关系。它不是当前下一步计划；当前状态见 `docs/current/current-state.md`，近期路线见 `docs/current/priority-roadmap.md`。

## 1. 当前主线分层

```text
HexGrid runtime
  -> map / path / state / action / combat / economy / round / commit / map-runner
  -> trace artifacts
  -> /hex-lab/match Web 验收

Phase18 compatibility
  -> replay / live replay
  -> historical RoundReport / timeline consumption

Shared contracts
  -> schemas / enums / event types / RoundReport shape

Materials
  -> processed map assets
  -> processed team proposals
  -> style and roster assets

Finance Major transition
  -> finance evidence MVP
  -> finance data source registry
  -> finance duel contract
  -> finance team profiles
  -> expert agent roster
  -> finance judge evidence
```

旧 Node/Sector 不再是 active module。相关文档只在 archive / frozen 背景中保留。

## 2. 当前关键模块

### M01 Hex map / path

职责：

```text
读取 official Dust2 Hex asset。
校验 playable cells、regions、points、flags、vertical links。
提供 pathfinding 和 AP cost。
```

### M02 Hex state / memory

职责：

```text
维护 agent phase memory。
维护 known / lastSeen enemy intel。
维护 C4 carrier / dropped / planted / defused 状态。
推进 phase events。
```

### M03 Hex action / LLM command

职责：

```text
构造 agent command request。
规范化和校验 LLM draft。
记录 accepted / rejected / fallback。
保留 request / response artifact 审计。
```

### M04 Hex combat

职责：

```text
构造局部 combat contacts。
评分 business / CS evidence。
物化 casualties、suppression、forcedBack、control hints。
不写 final winner。
```

### M05 Hex economy

职责：

```text
把现有 economy plan 适配到 Hex action request、validator 和 combat evidence。
不重写 economy 规则。
不直接决定 winner。
```

### M06 Hex round / map commit

职责：

```text
单回合提交。
完整 Dust2 map 灰度循环。
写 trace artifact、RoundReport、events、economy states。
winner 只来自 hard win condition。
```

### M07 Hex Web validation

职责：

```text
/hex-lab/match。
展示 map summary、round trace、phase、agent action、combat、economy、hard condition。
提供 fixture / real provider 验收入口。
不重新计算比赛事实。
```

### M08 Finance duel semantic layer

职责：

```text
复用 HexGrid 运行结构。
把旧 business duel 语义替换为 finance duel。
读取金融队伍资产、专家 agent 职责和 coach 研究纪律。
生成行业地图 / 研究轮次 / round 子命题。
把投资主张、自证、反证挑战和金融裁判证据写入 trace。
```

边界：

```text
不新建第二套地图引擎。
不恢复旧 Node/Sector。
不让旧商业闭环词汇继续作为主 prompt 证据。
CS 词条只保留为赛事包装和执行层表达。
```

### M09 Finance evidence MVP layer

职责：

```text
接入免费 API 代理事实。
区分 collector / source / evidence / prompt context。
读取 data/materials/processed/finance/ 下的数据源注册、证据策略和 Dust2 有色绑定。
维护 raw cache、normalized facts、evidence_id、round evidence pack 和 judge evidence ledger。
为 financeDuel 提供短事实包，而不是把网页、PDF 或长文本直接塞进 LLM。
```

第一版数据源：

```text
FRED：全球金属价格和宏观代理事实。
BaoStock：A 股代表公司行情、成交和估值。
UN Comtrade：可选进出口线索。
```

边界：

```text
Dust2 有色第一版是免费 API 代理事实版，不是完整中国有色行业基本面系统。
CNINFO、国家统计局、工信部、SHFE、SMM 先作为后置证据锚点或商业化替换源。
缺失国内库存、现货升贴水、行业利润或公司财报页码时，裁判必须通过 missingEvidence 和 scoreCaps 降低结论上限。
```

## 3. 保留兼容模块

### Phase18 replay / live replay

定位：

```text
历史正式 replay / live replay 兼容线。
保留播放和审计能力。
不作为新 Hex 事实生成线。
```

### Historical trace compatibility

定位：

```text
nodeTraceArtifactId / nodeTraceSource 是历史 DB/schema 字段。
active Hex 代码通过 trace reference 语义读取。
字段名不代表旧 Node runtime 仍存在。
```

## 4. 长期生态模块

这些模块仍有产品价值，但属于 backlog：

```text
M11 数据统计与奖项。
M12 新闻与媒体。
M13 素材库和赛事生态。
M14 Web/API/远端部署。
M15 队列、异步任务和可观测性。
M16 完整 16 队 bracket / fixture / tournament scheduling。
```

详见：

```text
docs/backlog/ecosystem-roadmap.md
docs/backlog/full-tournament-roadmap.md
```

## 5. 当前边界

```text
前端不能伪造 HP、枪械、伤害、敌人真实位置或 winner。
LLM 不能写最终 winner、kills、economyDelta 或 DB fact。
Combat 可以写局部 casualties / suppression，但不能提交 round winner。
Economy 影响 action/evidence，不直接决定胜负。
Phase18 和 Hex 可以共存，但不能互相污染事实链。
旧 Node/Sector 不得复活为 runtime。
```

## 6. 下一步使用方式

后续设计新功能时，先判断它属于：

```text
Hex runtime 当前主线。
Phase18 compatibility。
Shared contract。
Materials asset。
Backlog ecosystem。
Archive history。
```

不要把 backlog 或 archive 里的设想直接当作当前实现要求。
