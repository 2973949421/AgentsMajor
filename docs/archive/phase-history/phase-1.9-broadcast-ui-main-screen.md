# Phase 1.9 Broadcast UI Main Screen 收口记录

## 1. Stage Position

Phase 1.9 已在 2026-05-04 收口并暂时冻结。

本阶段目标是把 Phase 1.8 的 Web 前台从“海报页 + 回放播放器 + 运行控制台 + LLM 表格”的混合页面，收成一个 Phase 1.8 only 的观赛与调试主屏。

冻结含义：

```text
后续只修阻断性 UI bug。
不继续做视觉扩展、16 队 bracket 页面、新闻站、奖项站或完整 CS 原生 HUD。
Phase 2.0 可以复用当前页面作为单场 BO3 观赛和调试基线。
```

## 2. Final Scope

已完成能力：

```text
Phase 1.8 only 前台主线。
Phase 1.7 前台按钮隐藏，底层能力保留。
顶部 BO3 HUD。
中央战术主舞台。
左右对称悬浮选手栏。
选手角色显示 materials 原始英文口径，例如 Rifler / Entry / AWPer / IGL / Lurker / Support / Anchor / Star Rifler。
轻量播放控制条。
底部事件 / 高光 / 回合索引详情区。
可拖动 fixed 控制台工具窗，拖拽范围为整个浏览器窗口。
控制台保留 Run Next Round / Run Current Map / Run Full BO3、运行摘要、latest error 和 LLM 明细。
生成中、失败、replay hidden、replay ready 共用同一页面骨架。
```

## 3. Final Boundaries

Phase 1.9 不做：

```text
不新增后端 API。
不改 SQLite 事实源。
不伪造 HP、护甲、枪械、投掷物、雷达点位等当前没有的数据。
不提前引入 16 队 bracket 页面。
不把 driverModelId、raw agentId 或完整 LLM 明细放进主观赛层。
不恢复 Phase 1.7 前台并列入口。
```

## 4. Acceptance

收口验收口径：

```text
主画面不再被左右列硬切碎。
队伍1 / 队伍2 在主舞台内左右对称显示。
控制台不属于任一队伍栏，可以在整个页面窗口移动。
展开底部详细信息时，页面正常向下增长，不再和主舞台互相覆盖。
播放控制不再用大块方框遮挡主画面。
旧 replay guard 继续防止生成失败时播放旧预设结果。
中文 UI 文案不再乱码。
```

最后验证：

```text
pnpm --filter @agent-major/web typecheck
pnpm --filter @agent-major/web test
pnpm build:web
```

## 5. Known Residual Risks

冻结后仍保留的质量风险：

```text
当前是工具化导播主屏，不是最终节目级视觉包装。
战术图仍是抽象事实图，不是完整 CS 美术地图。
事件 / 高光 / 弹幕内容体系只做了收纳降权，尚未进入深度内容设计。
不同分辨率下仍可能需要后续专项视觉 QA。
```

这些风险转入后续 UI 质量阶段，不阻塞 Phase 1.9 收口。
