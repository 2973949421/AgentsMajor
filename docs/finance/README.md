# Finance Major 文档入口

本目录记录 Agent Major 从“泛商业攻防”切换到“金融投资对抗”的下一阶段设计。

## 当前定位

```text
Finance Major 不是新建第二套引擎。
Finance Major 复用最新 HexGrid 工程骨架。
本阶段要替换的是旧 business duel（商业攻防）语义层，不是替换 map/path/state/action/combat/round/Web 这些运行结构。
```

当前核心判断：

```text
旧商业底座已经证明结构能跑，但内容容易空泛。
下一阶段应把比赛争点落到用户专业可判断的金融研究任务上。
金融投资对抗比泛商业概念更有材料、有假设、有反证、有评分依据。
```

## 当前必读

```text
docs/finance/finance-major-prototype-plan.md
docs/current/priority-roadmap.md
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/hex/phase-2.0-pre-prompt-contract.md
docs/hex/phase-2.0-pre-judge-audit-contract.md
```

## 与 HexGrid 的关系

```text
保留：
- Hex map / path / state / action / combat / economy / round / commit / map-runner。
- /hex-lab/match Web 验收台。
- trace artifact / RoundReport / hard condition / LLM audit。
- CS Major 叙事外壳、地图名、选手卡和部分 CS 包装词条。

替换：
- businessDuel -> financeDuel。
- businessIntent -> financeIntent 或 investmentIntent。
- businessScore -> financeScore。
- businessVerdict -> financeVerdict。
- 守方商业自证 -> 守方投资主张自证。
- 攻方商业质疑 -> 攻方投资反证挑战。
```

CS 词条可以保留为赛事包装和 UI 叙事，例如 map、round、team、coach、player、attack、defense、entry、AWPer 等；但真实裁判依据应从“商业闭环”切换为“金融研究证据”。

## 当前测试落点

```text
地图：Dust2 有色
轮次：行业判断
队伍：两种投资风格 + 多专家 agent 团队
回合：6 个行业判断子命题
```

第一版不接真实行情，不做完整赛事，不做新闻/奖项站。先用可审计材料包和结构化队伍资产验证金融攻防是否比旧商业底座更有底蕴。

