# Finance Major 文档入口

本目录只保留 Finance Major（金融投资对抗）当前主线的最小阅读集合。旧的逐 N 详细计划已经汇总到迭代日志，不再作为日常入口堆在本目录。

## 当前状态

```text
主线：在 HexGrid 工程骨架上运行金融投资对抗。
当前地图：Dust2 有色。
当前轮次：行业判断。
当前目标：用真实资料、专家角色、开局真实输出、局内行动和裁判采信链，支撑可人工审计的金融对局。
最新口径：N55 收口修正已新增 phase0 真实开局输出层，phase1+ 只引用开局输出并执行行动。
```

## 必读顺序

```text
1. docs/finance/README.md
2. docs/finance/finance-major-prototype-plan.md
3. docs/finance/finance-evidence-mvp.md
4. docs/finance/finance-data-asset-contract.md
5. docs/finance/finance-n48-n55-iteration-log.md
```

关联横向契约：

```text
docs/hex/phase-2.0-pre-prompt-contract.md
docs/hex/phase-2.0-pre-judge-audit-contract.md
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/current/current-state.md
docs/current/priority-roadmap.md
```

## 文件职责

```text
finance-major-prototype-plan.md
  当前 Finance Major 原型契约，只写目标、角色、回合设计、裁判原则和验收边界。

finance-evidence-mvp.md
  免费 API 代理事实版证据层契约，说明 FRED / BaoStock / UN Comtrade 能证明什么、不能证明什么。

finance-data-asset-contract.md
  金融数据资产、环境变量、事实库、地图绑定和材料目录边界。

finance-n48-n55-iteration-log.md
  N48-N55 的收口日志，替代原先散落的单个 N 计划和报告。
```

## 当前运行边界

Finance Major 不是第二套引擎。它复用 HexGrid 的地图、路径、状态、行动、战斗、经济、回合提交、trace（轨迹）和 Web 验收台。

替换的是语义层：

```text
旧 business duel（商业攻防）
-> finance duel（金融投资攻防）
```

硬边界：

```text
LLM 不能写最终胜负、击杀、经济变化或数据库事实。
前端不能伪造裁判理由、KDA、AP、C4、winner 或金融采信链。
系统输入卡不能冒充 agent 真实输出。
phase0 真实开局输出必须来自 response artifact 或 fixture response。
phase1+ 只能短句引用 phase0 输出，不能重写金融论文。
```

## 当前数据入口

```text
金融数据资产：
data/materials/processed/finance/

Dust2 有色地图覆盖层：
data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json

离线事实库：
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json

两队资产：
data/materials/processed/teams/falcon-7b/initial-proposal.json
data/materials/processed/teams/vitallmty/initial-proposal.json
```

数据层必须克制：FRED 全球价格、BaoStock 市场数据和可选 UN Comtrade 只能作为代理事实，不能包装成完整中国有色行业基本面。
