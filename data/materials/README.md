# Agent Major Materials

这个目录用于维护 Agent Major 的长期文本资产与结构化素材，不用于保存运行时导出、回放缓存或临时调试产物。

## 当前分层

- `raw/`
  原始资料、研究记录、快照、待整理素材。
- `processed/`
  正式资产层，作为 runtime、前端、工具脚本统一读取入口。
- `processed/maps/<map-slug>/`
  地图级正式资产。只承载：
  - 地图命题
  - 裁判规程
  - 区域语义
  - 其他公共地图资产
- `processed/finance/`
  金融投资对抗正式资产。只承载：
  - 数据源注册
  - 证据分级策略
  - 金融地图主题绑定
  - 回合证据包模板
  - 公司 universe 和外部数据 series 配置
- `processed/teams/<team-slug>/`
  队伍级正式资产。长期维护单位固定为队伍目录。

## 队伍唯一方案

从 Phase 2.0-pre `6.1` 开始，队伍方案口径固定为：

- 队伍唯一方案文件：
  - `processed/teams/<team-slug>/initial-proposal.md`
  - `processed/teams/<team-slug>/initial-proposal.json`
- `initial-proposal.json`
  是唯一 runtime 主契约。
- `initial-proposal.md`
  是人工阅读、审稿、维护稿。

当前不再保留以下平行真相：

- `strategy.*`
- `processed/teams/<team-slug>/maps/<map-slug>/initial-proposal.*`

也就是说：

- 队伍只带一份唯一方案进入赛事。
- 不同地图负责挑战同一份方案的不同部分。
- 地图不再拥有自己的队伍方案真相。

## 运行时读取原则

- runtime 只读取 `processed/`
- runtime 不直接读取 `raw/`
- runtime 不直接读取整篇 Markdown
- 机器消费主契约固定为 JSON

当前核心读取口径：

- `processed/teams/<team-slug>/initial-proposal.json`
- `processed/maps/<map-slug>/map-proposition.json`
- `processed/maps/<map-slug>/judge-rubric.json`
- `processed/finance/source-registry.json`
- `processed/finance/evidence-source-policy.json`
- `processed/finance/maps/<finance-map-slug>/finance-map-binding.json`
- `processed/indexes/*.json`

Hex 地图资产和金融主题资产分开维护：

```text
processed/maps/dust2/                    # Hex 空间、路径、区域、点位
processed/finance/maps/dust2-nonferrous/ # 金融行业判断、证据源和回合子命题
```

## 资产维护原则

- 正式资产统一使用 `MD + JSON` 双文件制。
- `JSON` 负责机器消费、校验与接线。
- `Markdown` 负责人工审阅、解释与持续维护。
- 地图资产只写命题、裁决、区域语义，不再写队伍方案。
- 队伍资产承担长期方案、角色职责、教练职责与可复用表达。

## 命令入口

- `pnpm materials:build`
  按当前 canon 生成目录、索引和必要派生文件。
- `pnpm materials:validate`
  校验目录结构、索引引用、字段完整性与关键 canon 约束。

## 当前阶段要求

本轮只强制以下两队具备唯一方案资产：

- `falcon-7b`
- `vitallmty`

其他 14 队可以暂缺 `initial-proposal.*`，但不允许继续新增 `strategy.*` 作为平行方案层。

## LLM 资产说明

- `processed/indexes/llm-bindings.index.json`
  维护选手 / 教练与模型绑定的结构化索引。
- `processed/llm/`
  维护模型画像、模板与 override 元数据。
- 真正的 API key、token、provider secret 仍只放在本地环境变量，不进入 materials。
