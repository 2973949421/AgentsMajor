# Agent Major 文档入口

本目录按“当前入口 / 契约 / Phase 计划 / 归档 / Backlog”分层维护。新 agent 进入仓库时不要从旧 Phase 文档或早期技术总览开始读，先读当前索引。

## 当前状态

```text
当前主线：HexGrid（蜂巢格）Phase 2.0-pre 路线。
当前进度：N20-N34c 已完成，旧 Node/Sector 实验线已退役并清理 active 入口。
保留兼容线：Phase18 replay / live replay 仍保留，不属于旧 Node/Sector runtime。
下一步：文档治理完成后，再在 N35 选择 Hex 结构封板第二轮或 Hex real LLM / Web 验收质量专项。
```

## 推荐阅读顺序

```text
1. docs/current/README.md
2. docs/current/current-state.md
3. docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
4. docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
5. 按任务阅读 contracts、backlog 或 archive
```

## 文档分层

### 当前入口

```text
docs/current/README.md
docs/current/current-state.md
docs/current/priority-roadmap.md
docs/current/delivery-framework.md
docs/current/module-map.md
```

`docs/current/README.md` 是当前必读文档清单。

### Current 状态与路线

```text
docs/current/current-state.md
docs/current/priority-roadmap.md
docs/current/delivery-framework.md
docs/current/module-map.md
```

这些文件只承载当前状态、近期路线、交付规则和模块地图。旧 Phase 执行记录不再堆在 meta 里。

### 契约文档

```text
docs/contracts/foundation/
docs/contracts/match-loop/
docs/contracts/broadcast-viewer/
```

这些是事实源、事件、回合、经济、LLM、持久化、直播和展示契约。它们不是当前进度日志，修改时必须同步对应测试和实现。

### Hex 当前主线

```text
docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/hex/phase-2.0-pre-hex-engine-reset-charter.md
docs/hex/phase-2.0-pre-*.md
```

HexGrid 是当前比赛空间事实主线。旧 Node/Sector 不再作为 runtime 或 active Web/API 路线存在。

### Backlog

```text
docs/backlog/ecosystem-roadmap.md
docs/backlog/full-tournament-roadmap.md
```

这里保存长期想法，例如完整 16 队赛事、统计、奖项、新闻、素材库、Web ops、队列与可观测性。Backlog 不是当前执行口径。

### Archive

```text
docs/archive/
```

这里保存旧 Phase 计划、早期技术设计、已被 HexGrid 替代的 Node/Sector 方案和 meta 旧版快照。Archive 仅供背景参考，不是当前执行依据。

## Materials 当前入口

```text
地图资产：
data/materials/processed/maps/dust2/
data/materials/processed/maps/dust2/hex/dust2-hex-map.json

队伍方案：
data/materials/processed/teams/<team-slug>/initial-proposal.json
data/materials/processed/teams/<team-slug>/initial-proposal.md
```

不要再把旧的“按队伍再按地图拆分方案”的目录当作 runtime 队伍方案入口；当前只认队伍根目录下的 `initial-proposal.*`。

## 维护规则

```text
当前状态只写入 docs/current/current-state.md。
长期想法写入 docs/backlog/。
历史计划和旧判断写入 docs/archive/。
新增当前必读文档必须更新 docs/current/README.md。
文档移动必须更新 docs/archive/README.md。
中文文档必须按 UTF-8 读取和编辑。
```
