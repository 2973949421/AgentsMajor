# Agent Major 文字资产库

本目录用于承载 Agent Major 的长期文字资产，不用于保存运行时导出、回放数据或调试产物。

## 当前定位

- `raw/`：原始资料、研究稿、快照、待整理素材。
- `processed/`：正式资产库，作为后续产品、运营和技术接入的统一读取入口。
- `raw/teams/agent_major_player_roles.md`：选手 / 教练现实位置到 Agent Major 职责的当前角色来源。
- `processed/indexes/roles.index.json`：所有正赛选手 / 教练的角色汇总索引。

## 命令入口

- `pnpm materials:build`：按当前 canon 批量生成 16 支战队目录、总索引和别名字典。
- `pnpm materials:validate`：校验目录结构、人数约束、索引引用和风格 ID 引用。

## 维护原则

- 正式资产统一使用 `MD + JSON` 双文件制。
- `JSON` 是机器消费主契约。
- `Markdown` 是人工评审和持续维护主文档。
- 队伍、选手、教练的长期维护单位是 16 支正赛战队目录。
- 解说、弹幕、跨圈梗、新闻角度等共性风格，统一沉淀在中央风格库。
- 运行时只读取 `processed/`，不直接读取 `raw/`。

## 命名分层

- 展示层字段保留项目设计大小写，例如 `agent_team_name`、`display_name`、`in_game_id`。
- 工程层路径和程序标识统一小写，例如 `team_slug`、文件路径、`team_id`、`entity_id`。
- 前端、卡片页、新闻页、直播间文案默认读取展示层字段，不直接把 slug 当展示名输出。
- 后续新增队伍、选手或教练资产时，先确定展示名，再派生对应的小写 slug 和稳定 ID。

## LLM 绑定资产层

- `processed/llm/`：保存模型画像、角色绑定模板和少量 spotlight override，只保存可审查的模型元数据。
- `processed/indexes/llm-bindings.index.json`：汇总 96 个选手 / 教练 agent 的 LLM binding，供前端、运营工具和未来 runtime 查询。
- `.env.local`：只属于本地运行时凭证来源，禁止把真实 API Key、token、secret、base url 值写入 materials。
- v1 只做 `asset_preallocation`，所有 `runtime_enabled` 和 `task_bindings[].enabled` 必须为 `false`，不影响比赛模拟、裁判、胜负、战术或生成流程。
- 未来 runtime 接入读取顺序固定为：agent binding → role template → model profile → `packages/llm` driver registry → env。

## 当前 canon 口径

- 当前 16 支正赛队伍与 `PhaseClan` 递补设定，视为 Agent Major 的正式项目 canon。
- `3D-MoE` 作为候补 / 被替换资产保留，不进入正赛 16 队主目录。
- 当前选手资料默认保留公开 ID、队伍归属和项目化备注；后续再逐步补齐更细的人格、模型绑定和运营专题接口。
