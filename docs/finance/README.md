# Finance Major 文档入口

本目录只保留 Finance Major（金融投资对抗）当前主线的最小阅读集合。旧的逐 N 详细计划已经汇总到迭代日志，不再作为日常入口堆在本目录。

## 当前状态

```text
主线：在 HexGrid 工程骨架上运行金融投资对抗。
当前地图：Dust2 有色。
当前轮次：行业判断。
当前目标：N61 已完成 real provider 小样本验收；结论为 fail，失败点是 phase0 真实结构化卡片 0/10 可消费。
最新口径：real provider 已成功执行第 6 局；26 个 finance verdict 中 0 次无采信金融胜利，26 个 combat explanation 全部分清金融与 CS，但 10 条 phase0 输出全部不可消费，因此 N61 不能通过。下一步回到 N58 做真实模型结构化输出窄修。
```

## 必读顺序

```text
1. docs/finance/README.md
2. docs/finance/finance-major-prototype-plan.md
3. docs/finance/finance-decision-question-contract.md
4. docs/finance/finance-evidence-mvp.md
5. docs/finance/finance-evidence-bound-round-roadmap.md
6. docs/finance/n57-data-source-probe-report.md
7. docs/finance/finance-data-asset-contract.md
8. docs/finance/n61-evidence-bound-round-validation-report.md
9. docs/finance/finance-n48-n55-iteration-log.md
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
  当前 Finance Major 原型契约，固定“证据绑定的投资决策攻防”主口径。

finance-decision-question-contract.md
  N56 决策题、允许立场、必需证据结构、挑战规则，以及后续 stance card / challenge card 的上游契约。

finance-evidence-mvp.md
  免费 API 代理事实版证据层契约，说明 FRED / BaoStock / AKShare 三主源能证明什么、不能证明什么，并标注 World Bank / UN Comtrade 的 frozen 状态。

finance-evidence-bound-round-roadmap.md
  N56-N61 强依赖路线，说明每一步输入、输出、阻断条件；当前记录 N61 real provider 已跑但 phase0 结构化卡片失败。

n57-data-source-probe-report.md
  N57 前置探测报告，说明 FRED / BaoStock / AKShare-SHFE/INE/GFEX / World Bank / UN Comtrade 的真实可用性、字段和 N56 requiredEvidenceSchema 映射。

finance-data-asset-contract.md
  金融数据资产、环境变量、事实库、地图绑定和材料目录边界。

n61-evidence-bound-round-validation-report.md
  N61 小样本验收报告，记录 real provider 样本、phase0 卡片失败、采信链安全结果和后续 gap。

finance-n48-n55-iteration-log.md
  N48-N55 的历史收口日志，保留背景，但不是当前下一步执行入口。
```

## 当前运行边界

Finance Major 不是第二套引擎。它复用 HexGrid 的地图、路径、状态、行动、战斗、经济、回合提交、trace（轨迹）和 Web 验收台。

替换的是语义层。旧口径是：

```text
旧 business duel（商业攻防）
-> finance duel（金融投资攻防）
```

N56 起的新口径是：

```text
固定数据菜单
-> 决策题 round
-> 立场方 stance
-> 挑战方 challenge
-> 裁判采信 accepted / rejected / missing / score cap
-> 金融结果只提供主动权和战斗投影权限
-> CS 行动层决定击杀 / 压制 / 退让
-> hard winner 仍来自硬条件
```

硬边界：

```text
LLM 不能写最终胜负、击杀、经济变化或数据库事实。
前端不能伪造裁判理由、KDA、AP、C4、winner 或金融采信链。
系统输入卡不能冒充 agent 真实输出。
phase0 真实开局输出必须来自 response artifact 或 fixture response。
phase1+ 只能短句引用 phase0 输出，不能重写金融论文。
没有 acceptedEvidenceRefs，不能判金融胜利。
missingEvidence 只能降权或限制置信度，不能自动赢。
CS 击杀可以由纯 CS 事实产生，但不能被包装成金融胜利。
```

N56-N61 不是并列任务。必须按依赖链理解：

```text
N56：定义决策题和 requiredEvidenceSchema，决定需要什么证据。
N57：按 requiredEvidenceSchema 扩充数据、提取事实、生成派生指标和 Fact Bank v2。
N57b：广探 AKShare endpoint，摸清期货、现货、公司基本面、行业/板块和资金数据能取什么。（已完成；报告见 n57b-akshare-endpoint-probe-report.md）
N57c：用 FRED + BaoStock + AKShare 三主源覆盖 active fact bank，冻结 World Bank / UN Comtrade。（已完成）
N58：让 phase0 只基于这些证据输出 stanceCard / challengeCard。
N59：让裁判只采信合法 claim-evidence 绑定。
N60：让金融结果只通过 combatEffectAllowed 影响战斗投影。
N61：用最小样本验证整条链是否真正闭环。
```

## 当前数据入口

```text
金融数据资产：
data/materials/processed/finance/

Dust2 有色地图覆盖层：
data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json

离线事实库：
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json

N57 前置数据源探测：
data/materials/generated/finance/source-probes/dust2-nonferrous/source-probe-report.json

两队资产：
data/materials/processed/teams/falcon-7b/initial-proposal.json
data/materials/processed/teams/vitallmty/initial-proposal.json
```

数据层必须克制：FRED 全球价格、BaoStock 市场数据和 AKShare 可取公开 endpoint 只能作为代理事实，不能包装成完整中国有色行业基本面。World Bank / UN Comtrade 暂时 frozen，不进入当前 active evidence。
