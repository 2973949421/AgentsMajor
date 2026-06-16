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
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
docs/finance/n50-offline-finance-fact-bank-plan.md
docs/finance/n51-agent-evidence-slice-plan.md
docs/finance/n52-information-action-boundary-plan.md
docs/finance/n53-judge-evidence-adoption-plan.md
docs/finance/n54-human-audit-validation-plan.md
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

N43 已落地第一版两队资产，N43b 进一步把资产分为跨行业 core（核心）和地图 overlay（覆盖层）：

```text
Falcon-7B：进攻型周期成长，偏高 beta、供需缺口、价格弹性和集中表达。
VitaLLMty：稳健质量风控，偏安全边际、成本曲线、估值纪律和风险调整收益。
```

每队保留 5 名选手 + 1 名教练的 CS Major 包装，但新增 `finance_agent_profile` 作为金融研究职责入口：

```text
PM / Portfolio Manager（组合经理）
Macro / Strategy（宏观策略专家）
Commodity Supply-Demand（供需 / 商品专家）
Company / Financial Modeling（公司 / 财务建模专家）
Risk / Trading（风控 / 交易专家）
Coach / Research Discipline（教练 / 研究纪律）
```

N43b 后的资产分层：

```text
Team Core：写在 data/materials/processed/teams/<team>/initial-proposal.json 的 teamCore。
Agent Core：写在 players/coach 的 finance_agent_profile，包含 signatureLens、attackStyle、defenseStyle、decisionThreshold、crossMapStrength 等跨行业字段。
Map Overlay：写在 data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json，只承载 Dust2 有色专属证据源、R1-R6、scoreCaps、agentMapSpecialization。
```

后续新增 TMT、消费、医药、金融地产等地图时，优先新增对应 `map-overlay.json`，不要重写队伍和选手核心资产。

第一版不做完整金融数据库，不做完整赛事，不做新闻/奖项站。数据事实层采用“免费 API 代理事实版”：

```text
FRED + BaoStock + 可选 UN Comtrade
```

这只能支撑有色行业判断的代理事实包，不能冒充完整中国有色基本面系统。CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源，不在第一版包装成稳定免费 API。

详见：

```text
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

N49 后暴露出的关键问题是：FRED / BaoStock / UN Comtrade / AKShare 已经完成 source registry（数据源登记）和依赖记录，但当前比赛实际消费的主要仍是 `configured_proxy_fact`（配置型代理事实），不是 API 实际观测数据；同队 5 名 agent 的开局信息卡仍可能重复；phase action 仍可能复述完整金融论点；裁判还需要证明自己采信了哪些证据。

因此下一段不是一个巨大 N50，而是 N50-N55 连续收口：

```text
N50：离线金融事实库。（已完成第一版）
N51：专家证据切片与开局信息卡差异化。（已完成第一版）
N52：回合信息层 / 局内行动层硬隔离。（已完成第一版）
N53：金融裁判证据采信事实化。（已完成第一版）
N54：中文人类审计与真实样本验收。（Web 收口完成；real 成功样本 blocked）
N55：真实 LLM 输出人类审计摘要与系统输入卡隔离。（已完成第一版）
```

N50 第一版输出：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

当前状态是：FRED 和 BaoStock 已有离线观测事实；UN Comtrade 作为可选源记录不可用观测；AKShare 仍只登记为采集器候选。

## 数据资产入口

金融数据源、证据策略和 Dust2 有色行业判断绑定已经独立放入：

```text
data/materials/processed/finance/
```

它和 Hex 地图资产分层：

```text
data/materials/processed/maps/dust2/                    # 地图空间、路径、区域、点位
data/materials/processed/finance/maps/dust2-nonferrous/ # 金融主题、回合子命题、证据源、证据包模板
```

Dust2 有色地图覆盖层入口：

```text
data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json
```

## 攻守互换约束

Dust2 有色第一版只有 6 个行业判断小主题；半场攻守互换后复用同 6 个主题。当前守方读取 `defenseThesisFocus` 并生成自证，当前攻方读取 `attackChallengeFocus` 并生成质疑。队伍风格、选手专长和 `map-overlay.json` 里的地图偏好不能被解释成固定攻守身份。

这条约束已经写入：

```text
data/materials/processed/finance/maps/dust2-nonferrous/finance-map-binding.json
data/materials/processed/finance/maps/dust2-nonferrous/round-topics.json
data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json
```

后续 prompt（提示词）、judge（裁判）和 Web 展示在使用 `roundOwnership`、`teamMapBias` 或 `agentMapSpecialization` 前，必须先解析当前 side assignment（阵营分配）。不能把 Falcon-7B 写死成进攻方，也不能把 VitaLLMty 写死成防守方。

正式本地环境入口固定为：

```text
AgentsMajor/.env.local
```

上层 `.env`、`.venv` 和外部 `metal_project/` 只作为历史验证痕迹，不作为运行时入口。
