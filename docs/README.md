# Agent Major 文档入口

本目录按“当前入口 / 契约 / Phase 计划 / 归档 / Backlog”分层维护。新 agent 进入仓库时不要从旧 Phase 文档或早期技术总览开始读，先读当前索引。

## 当前状态

```text
当前主线：HexGrid（蜂巢格）Phase 2.0-pre 路线。
当前进度：N20-N55 已完成 HexGrid、Finance Major、中文审计和 phase0 真实开局输出收口第一版；旧 Node/Sector 实验线已退役并清理 active 入口。
保留兼容线：Phase18 replay / live replay 仍保留，不属于旧 Node/Sector runtime。
下一步：先做用户人工 Web 审计和文档 / 结构清理，再决定是否进入 N56。
```

## 推荐阅读顺序

```text
1. docs/current/README.md
2. docs/current/current-state.md
3. docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
4. docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
5. docs/finance/finance-major-prototype-plan.md
6. docs/finance/finance-evidence-mvp.md
7. docs/finance/finance-data-asset-contract.md
8. docs/finance/finance-n48-n55-iteration-log.md
9. 按任务阅读 contracts、hex、backlog 或 archive
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
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
docs/hex/phase-2.0-pre-hex-engine-reset-charter.md
docs/hex/phase-2.0-pre-*.md
```

HexGrid 是当前比赛空间事实主线。旧 Node/Sector 不再作为 runtime 或 active Web/API 路线存在。

### Finance Major 下一阶段

```text
docs/finance/README.md
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

Finance Major 是 N42 起的下一阶段候选主线：复用 HexGrid 运行结构，但把旧 business duel（商业攻防）语义层替换为 finance duel（金融投资攻防）。当前测试落点是 `Dust2 有色 / 行业判断 / 6 round`。

第一版数据事实层是“免费 API 代理事实版”，不是完整中国有色行业基本面系统。默认自动源是 FRED、BaoStock 和可选 UN Comtrade；CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源。裁判必须暴露 missingEvidence 和 scoreCaps，不能让 LLM 用代理事实冒充完整事实。

金融数据源和 Dust2 有色行业判断绑定独立放在 `data/materials/processed/finance/`。正式本地环境入口固定为 `AgentsMajor/.env.local`，上层 `.env`、`.venv` 和外部 `metal_project/` 只作为历史验证痕迹。

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
