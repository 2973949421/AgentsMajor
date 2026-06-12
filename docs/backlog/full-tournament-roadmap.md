# 完整赛事 Backlog

本文件保存完整 16 队赛事、赛程和失败恢复方向。它不是当前执行计划。

## 1. 长期目标

```text
在 HexGrid 单图 / 小地图验收稳定后，扩展到完整赛事。
```

完整赛事至少包括：

```text
16 队参赛池。
seed / fixture。
bracket。
map veto / map pool。
BO3 / BO5 赛制。
match scheduling。
tournament state。
失败恢复和重跑策略。
公开导出和 replay 索引。
```

## 2. 前置条件

进入完整赛事前，应满足：

```text
Hex 单回合和完整 Dust2 map 可稳定提交。
Hex Web 能人工验收回合、phase、action、combat、economy、hard winner。
real provider 失败可审计，不包装成成功。
Phase18 compatibility 与 Hex mainline 边界清楚。
旧 Node/Sector 不再干扰搜索和实现。
```

## 3. 不可提前跳过的边界

```text
不能用 fixture 假装真实 LLM 稳定。
不能让 LLM 写 winner、kills、economyDelta 或 DB fact。
不能把 Web runner 当生产任务系统。
不能直接把单图逻辑复制成第二套 map/tournament engine。
```

## 4. 未来拆分建议

候选阶段：

```text
N35：Hex 结构封板第二轮或 real LLM / Web 质量专项。
N36：Hex map pool / BO3 最小模型。
N37：Tournament state / bracket / fixture。
N38：公开 replay/export/API 边界。
N39：统计、奖项、新闻生态。
```

实际编号必须基于届时状态重新规划，不从本 backlog 直接执行。
