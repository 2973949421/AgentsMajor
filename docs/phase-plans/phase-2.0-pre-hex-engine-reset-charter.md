# Phase 2.0-pre HexGrid 回合引擎重置纲领

## 1. 文档定位

本文档是 Phase 2.0-pre 后续比赛引擎路线的纲领文件。

它回答三个问题：

1. 为什么停止旧 Node/Sector（节点/区块）实验路线。
2. HexGrid（蜂巢格）新主线的不可变边界是什么。
3. N30 完成后，为什么下一步要先做 Hex Web 验收台，而不是马上删除旧 Node/Sector 或只做结构封板。

本纲领与以下文档共同生效：

- `phase-2.0-pre-hex-engine-implementation-plan.md`
- `phase-2.0-pre-hex-engine-runtime-contract.md`

旧节点化文档已经移入 `docs/phase-plans/frozen/`，只允许作为历史背景，不再作为 N20+ 主线依据。

## 2. 路线重置结论

新主线判断：

- `HexGrid（蜂巢格）` 是地图空间底层真相。
- `Region（区域）` 和 `Point（点位）` 从 HexGrid 标注产生。
- 旧 `node-graph.json` 与 `sector-map.json` 不再作为路径、区域或比赛事实来源。
- 每个 agent（智能体）每个 phase（阶段）调用 LLM（大语言模型）生成行动草案。
- 代码负责硬约束：
  - 地图可走区域。
  - 路径。
  - AP（行动点）。
  - 经济资源。
  - 道具能力。
  - 生命状态。
  - C4 状态。
  - combat（战斗）局部裁定。
  - final winner（最终胜方）。
- LLM 不能写：
  - winner。
  - roundWinType。
  - kills / damage。
  - economyDelta。
  - DB fact。
- 经济系统保留，但作为 Hex round（蜂巢回合）的资源输入和结果结算来源。
- Web 验收是主线必经阶段；CLI 跑通不等于用户可验收。

## 3. 当前阶段状态

截至 N30：

| 阶段 | 状态 | 说明 |
|---|---|---|
| N20 | 已完成 | 路线重置与旧文档冻结 |
| N21 | 已完成 | HexGrid schema / validator / architecture boundary |
| N22 | 已完成第一版 | HexMapEditor，可编辑 Dust2 Hex 草稿 |
| N23 | 已完成 | Dust2 official Hex asset |
| N24 | 已完成 | pathfinding + AP |
| N25 | 已完成 | agent phase memory |
| N26 | 已完成 | agent 每 phase command harness |
| N27 | 已完成 | Hex combat harness |
| N28 | 已完成 | economy 接入 Hex |
| N29 | 已完成 | Hex 单回合提交 |
| N30 | 已完成 | Hex Dust2 完整地图 CLI 灰度 |

当前仍未完成：

- Web 人工验收完整 Hex 对局。
- Web 真实 LLM 稳定验收。
- Hex 结构封板。
- 旧 Node/Sector 删除收口。

## 4. 主线边界

### 4.1 Hex 主线必须做

- 使用 `data/materials/processed/maps/<mapSlug>/hex/` 下的 Hex map asset。
- 使用 `packages/core/src/hex-engine/` 下的 Hex runtime。
- 通过 code validator（代码校验器）约束行动合法性。
- 通过 artifact（产物）保留 request / response / trace / summary。
- 通过 RoundReport（回合报告）兼容旧系统读取。
- 通过 Web 页面让用户人工验收完整对局。

### 4.2 Hex 主线禁止做

- 禁止继续扩展旧 NodeGraph / SectorMap 作为主线。
- 禁止让 LLM 猜地图路径。
- 禁止让 LLM 写最终胜负。
- 禁止让 LLM 写击杀事实。
- 禁止让 LLM 修改经济参数。
- 禁止为了比分好看绕过 combat / economy / AP。
- 禁止把旧 Node Lab 继续作为 Hex 主控入口。

## 5. 当前成果处理策略

保留并复用：

- Economy/Output（经济/输出）系统。
- artifact / audit / fallback 思路。
- provider real/fixture 切换经验。
- RoundReport bridge 经验。
- Team Context / role / coach context。
- Web progress 展示经验。

停止扩展：

- `node-graph.json`
- `sector-map.json`
- 39 node + 13 sector 展示路线。
- `local-node-judge` 作为未来主裁判路线。
- 基于 node edge 的旧 AP 成本模型。
- Node Lab 作为 Hex 主控入口。

N34/N34b 后实际处理：

- 旧 Node/Sector runtime 已退役并物理删除。
- 旧 Node Lab 历史展示主控已退役，只保留 `/node-lab` 说明页和 410 API。
- 旧 node/sector 历史资产已移入 `data/materials/archive/maps/dust2/node-sector/`。

保留原因：

- 历史 frozen 文档、RoundReport 兼容字段和 artifact parser 仍用于读取旧证据。
- Phase18 replay / live replay 不属于 Node/Sector runtime，不能随旧实验层一起删除。
- 删除旧路线不能破坏 `/hex-lab/match` 和历史 replay 的可观察性。

## 6. 新后续路线

| 阶段 | 名称 | 目标 | 结果判定 |
|---|---|---|---|
| N31 | Hex Web 验收台第一版 | 建立 `/hex-lab/match`，Web 可跑可看 Hex 单回合和当前地图 | 用户能人工查看完整 Hex 对局 |
| N32 | Hex 结构封板 | 拆大文件、整理模块边界、修文档乱码、清理导出面 | 结构更干净，行为不变 |
| N33 | 真实 LLM Web 稳定验收 | Web real provider 可审计运行 | request / response / fallback / rejected / accepted 可见 |
| N34 | 旧 Node/Sector 删除收口 | 删除旧实验层主控和 runtime 污染 | Hex 主线独立，旧路径不再干扰 |

## 7. N31 的纲领要求

N31 必须优先实现 Web 人工验收，不得被结构封板或旧删除替代。

N31 必须提供：

- 新页面：`/hex-lab/match`。
- Web 按钮：
  - 运行 Hex 单回合。
  - 运行 Hex 当前地图。
  - 刷新结果。
  - 打开 Hex 地图编辑器。
- Web 展示：
  - map summary。
  - round trace 列表。
  - phase 进度。
  - agent actions。
  - combat resolutions。
  - economy context。
  - final hard win condition。
  - fallback / rejected / ignored fields。
- 明确标注：
  - experimental。
  - writesDb=true。
  - replacesLegacyRoundPath=false。
  - LLM cannot write final winner。

N31 不得做：

- 不做旧 Node/Sector 删除。
- 不调 combat 评分。
- 不调 economy 参数。
- 不改 winner 规则。
- 不把 Hex 接入旧 Phase18 一直生成。
- 不做 BO3。

## 8. N32 的纲领要求

N32 必须在用户能 Web 验收完整 Hex 对局后进行。

N32 目标：

- 降低快速实验债务。
- 拆分大文件。
- 清理文档乱码。
- 统一模块导出。
- 准备旧 Node/Sector 删除清单。

优先拆分：

- `hex-phase-memory.ts`
- `hex-combat-resolver.ts`
- `hex-round-runner.ts`

N32 不得做：

- 不新增比赛机制。
- 不调 AP / economy / combat / winner。
- 不做真实 LLM 稳定验收。
- 不删除旧 Node/Sector 主线。

## 9. N33 的纲领要求

N33 专门做 Web 真实 LLM 稳定验收。

N33 必须让 Web 展示：

- providerMode。
- modelId。
- 每个 agent 每个 phase 的 request artifact。
- response artifact。
- accepted draft。
- rejected draft。
- fallback reason。
- ignored fields。
- provider error。
- JSON parse / repair 结果。

N33 成功标准：

- real 单回合可跑或明确 external blocked。
- real 小上限地图可跑或明确 external blocked。
- 页面不崩。
- 失败不包装成成功。
- LLM 仍不能写硬事实。

## 10. N34 的纲领要求

N34 才进入旧 Node/Sector 删除。

前置条件：

- N31 完成。
- N32 完成。
- N33 完成或明确外部 provider 受限但审计路径完整。

N34 删除对象：

- 旧 Node Lab 主控入口。
- 旧 sector 主控 UI。
- 旧 node/sector runtime 依赖。
- `node-engine` 中不再被引用的 action / judge / graph / sector 模块。
- 旧 Dust2 node/sector runtime 资产入口。

N34 必须保留：

- 历史 frozen 文档。
- 旧 RoundReport 读取兼容。
- 历史 artifact 读取兼容。
- Phase18 replay / live replay 播放层。

N34b 安全清理结果：

- `packages/core/src/node-engine/**` 已物理删除。
- 旧 Node Lab client/CSS/layout helper 已删除。
- `phase20-node-*` CLI 已删除。
- `node-graph.*` / `sector-map.*` 已从 processed runtime 资产目录移入 archive。
- `/node-lab` 与 `/api/node-lab/run` 仍作为 retired stub 存在，避免用户访问时出现 404/500。

## 11. 删除策略修订

旧删除策略：

- Hex 单图跑通后立即删除旧 Node/Sector。

新删除策略：

- N20-N30：冻结旧 Node/Sector，不新增功能。
- N31：先做 Web 验收台。
- N32：再做结构封板。
- N33：再做真实 LLM Web 稳定验收。
- N34：最后退役旧 Node/Sector 可执行入口。
- N34b：在兼容护栏下物理清理旧 Node/Sector runtime 与运行资产入口。

新策略原因：

- 用户需要先能看见完整 Hex 对局。
- CLI 成功不能替代 Web 人工验收。
- 结构封板应服务可观察的对局，而不是先清理后再发现无法验收。
- 删除旧路线前必须确认 Hex Web 和真实 LLM 路径可用。

## 12. 后续计划生成规则

后续每个 N 的计划必须包含：

- 当前阶段定位。
- 目标与成功标准。
- 已知上下文。
- 范围边界。
- 技术实现路径。
- 分阶段执行步骤。
- 预期改动清单。
- 风险、未知项与替代方案。
- 自动化验证。
- 人工验收流程。
- 阻塞性问题。
- 最小化与回滚策略。
- 完成后阶段汇报表。

任何阶段未达成，必须写“部分完成”或“未完成”，不能包装成完成。

## 13. 下一步

N31-N34b 已完成当前 HexGrid 收口链路。

下一步应基于 N34b 验证结果另行规划：

```text
N35：待 N34b 验证后确定
```
