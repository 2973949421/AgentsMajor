# 当前优先路线图

本文只记录近期优先级和长期方向。旧 Phase 执行历史见 `docs/archive/phase-history/`，旧长期设想的展开稿见 `docs/backlog/`。

## 1. 当前原则

```text
Simulation First, Broadcast Second.
事实链先稳定，再做转播包装、新闻、奖项和生态。
```

当前主线仍是 HexGrid 工程骨架，不是旧 Node/Sector，也不是继续扩 Phase18。N42 起的下一阶段，是在 HexGrid 上切换到 Finance Major（金融投资对抗）原型。

Finance Major 的当前口径是：

```text
金融研究攻防决定为什么打，Hex 执行层证据决定怎么打，硬条件决定谁赢。
```

也就是：

```text
地图 = 行业赛道。
轮次 = 研究任务类型。
round = 当前任务子命题。
守方提出投资主张并自证。
攻方 challenge 投资假设、估值、风险和行业逻辑。
裁判基于证据质量、逻辑一致性、反证处理、收益风险比和可执行性评分。
```

N20-N41 的旧商业攻防口径已经完成第一版验证，但它容易输出空泛内容。后续不继续加厚旧商业文案，而是把旧 business duel 语义替换为 finance duel。

N20-N41 历史口径可在 Hex 文档中回看：

```text
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
```

## 2. 已收口的主线状态

```text
Phase18 replay / live replay：保留为兼容线，不继续作为新事实主线扩展。
HexGrid N20-N34c：已完成地图、路径、状态、行动、战斗、经济、单回合提交、完整 Dust2 地图灰度、Web 验收台、结构封板第一轮和旧 Node/Sector 清理。
Node/Sector 实验线：已退役并清理 active mode / runtime / Web progress / UI 分支。
```

## 3. 近期优先级

### P0：N42-N55，Finance Major 原型（当前）

目标是保留 HexGrid 工程骨架，把旧 business duel 语义替换为 finance duel：

```text
N42：Finance Evidence + Finance Duel 契约。（已完成）
N43：金融队伍资产与专家 Agent 改造。（已完成）
N44：Finance Evidence MVP 接入。（已完成第一版）
N45：Finance Duel Runtime 接入。（已完成第一版）
N46：金融裁判替换商业裁判。（已完成第一版）
N47：金融 Web 验收台改造。（已完成第一版）
N48：Dust2 有色 / 行业判断 6R 小样本验收。（条件通过）
N49：中文可读审计 + 回合信息层 / 局内行动层拆分。（已完成第一版）
N50：离线金融事实库。（已完成第一版）
N51：专家证据切片与开局信息卡差异化。（已完成第一版）
N52：回合信息层 / 局内行动层硬隔离。（已完成第一版）
N53：金融裁判证据采信事实化。（已完成第一版）
N54：中文人类审计与真实样本验收。（Web 收口完成；real 成功样本 blocked）
N55：真实 LLM 输出人类审计摘要与系统输入卡隔离。（已完成第一版）
```

当前测试落点：

```text
地图：Dust2 有色。
轮次：行业判断。
round：全球价格、市场反应、估值是否 price in、进出口线索、证据缺口、有限配置结论。
队伍：两种投资风格 + 五专家 agent + coach。
数据：FRED + BaoStock + 可选 UN Comtrade 的免费 API 代理事实版。
```

详见：

```text
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

N44 已生成第一版证据包：

```text
data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json
```

N45 已读取这份 evidence pack，生成 round-level financeDuel，并写入 Hex trace。N46 已让 combat 裁判优先消费 financeDuel，并保留旧 business 字段作为兼容别名。N47 已让 `/hex-lab/match` 的审计抽屉优先展示金融小主题、投资主张、反证质疑、证据编号、缺失证据、评分上限、金融裁判和 hard condition 分离链路。N48 已完成 Dust2 有色 / 行业判断 6R 小样本验收，结论是条件通过：fixture 结构链路通过，real provider 金融样本尚未通过。

N49 已完成第一版中文审计和信息层拆分，重点结果是：

```text
1. Web 审计默认中文摘要优先，不再强迫用户先读 raw enum / artifact id。
2. 每 round 生成 roundOpeningBrief 和 10 张 agentOpeningBrief。
3. phase action 消费开局信息卡和当前局势，不应继续重写完整金融论文。
4. 技术细节仍折叠保留，方便排查。
```

N49 暴露出的新问题是：

```text
1. FRED / BaoStock / UN Comtrade / AKShare 只完成 source registry 和依赖登记。
2. 当前 evidence pack 主要仍是 configured_proxy_fact，不是真实 API 观测数据。
3. generate-finance-evidence.mjs 只读取配置文件，没有真正调用 FRED / BaoStock / Comtrade / AKShare。
4. 同队 5 名 agent 的开局信息卡高度重复，finance role 仍可能是 unknown。
5. roundOpeningBrief 缺少按 PM / Macro / Commodity / Company / Risk 切分的证据。
```

因此下一步必须拆成 N50-N55：

```text
N50 已用用户准备的免费接口生成离线宏微观事实库，FRED / BaoStock 为观测事实，UN Comtrade 为 optional unavailable。
N51 已从事实库生成 agent evidence slice，让 10 名 agent 的开局信息卡按专家角色读取不同证据、证据缺口和评分边界。
N52 已把回合信息层和局内行动层硬隔离：compact request 不再发送完整金融长文本，briefRefId 缺失或错写只能修到当前 agent 自己的信息卡，复述完整开局论点或行动理由明显超长会拒绝 / 降级。
N53 已让金融裁判明确采信 / 拒绝 / 降权哪些证据，不能用字段存在冒充机制生效。combat trace 现在记录 `acceptedEvidenceRefs / rejectedEvidenceRefs / missingEvidenceApplied / scoreCapRefs / financeReasonZh / csReasonZh`，fallback、invalid action、复述开局论点和明显超长行动理由不产生正向金融证据。
N54 已完成中文 Web 审计主链路和失败报告。当前环境中的 real provider 成功样本因外部出站风险被阻断，因此不能宣称真实对局已通过。

N55 进一步修正审计来源：主审计展示真实 `hex_llm_response` artifact 的人工可读摘要，系统生成的 `agentOpeningBrief` 只能作为“系统输入卡（非 agent 输出）”折叠展示。没有 response artifact 时必须显示“没有真实模型输出”，不能用系统预置词或 fallback 文案补成 agent 输出。
```

当前必须承认的边界：

```text
Dust2 有色第一版不是完整中国有色行业基本面系统。
FRED 全球金属价格不能直接证明中国国内供需。
BaoStock 市场表现不能直接证明行业基本面。
UN Comtrade 进出口数据只能提供滞后线索。
CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源。
裁判必须展示 missingEvidence 和 scoreCaps，不能让 LLM 用代理事实冒充完整事实。
```

当前金融数据资产入口：

```text
data/materials/processed/finance/
```

N50-N55 固定计划：

```text
docs/finance/n50-offline-finance-fact-bank-plan.md
docs/finance/n51-agent-evidence-slice-plan.md
docs/finance/n52-information-action-boundary-plan.md
docs/finance/n53-judge-evidence-adoption-plan.md
docs/finance/n54-human-audit-validation-plan.md
docs/finance/n54-human-audit-validation-report.md
docs/finance/n55-agent-output-audit-plan.md
```

正式本地环境入口：

```text
AgentsMajor/.env.local
```

上层 `.env`、`.venv` 和外部 `metal_project/` 是历史验证痕迹，不作为项目运行入口。

### P1：后续候选，Hex 结构封板第二轮

Finance Major 原型验证后，再评估结构封板第二轮。结构封板的目标应是拆分已稳定的事实链实现，而不是在结构整理中顺手改变比赛规则。

## 4. 已完成质量打磨记录

### Done：N38，目标行动事实链修复（已完成第一版）

目标是先修硬事实一致性，避免出现“事件显示下包成功，但 `bombState` 仍为未下包，最终又判 `timeout_no_plant`”的矛盾。

```text
bomb_planted event
bombState.planted / plantedCellId
agent final cell
hard win condition
```

这些字段必须一致。N38 不处理 KDA、request 压缩或 Web 美化。

当前结果：

```text
bomb_planted 事件只在 C4 carrier 真正站到合法包点时生成。
bomb reducer 会拒绝未站到 objective cell 的下包事件。
defuse reducer 会拒绝未站到已下包格的非法拆包。
被敌方占住的包点不会生成虚假的 bomb_planted 成功事实。
```

### Done：N39，LLM 调用成本与中文输出稳定（已完成第一版）

目标是把 real provider 每 agent request 从约 37k-39k tokens 降到 15k-22k 左右，并让商业语义字段中文为主。

```text
compact request
round business duel 摘要复用
当前 agent 必需上下文
language_mismatch audit
中文 businessIntent / riskRead / tacticalIntent
```

当前结果：

```text
real provider 使用 compact_match payload，不再直接发送完整 HexAgentCommandRequest。
request artifact 同时保留 fullRequest 和 compactRequest，便于审计和回滚。
response artifact 记录 request size metrics、provider prompt tokens（若返回）和 language_mismatch audit。
Web LLM audit 显示 compact 请求数、平均压缩率、prompt token 总数、语义语言和 mismatch 数。
```

### Done：N40，角色感知 KDA 与 combat contact 收敛（已完成第一版）

目标是让枪战归因更像真实 CS 队内分工，同时减少一回合 80-100 个 combat resolution 的噪声。

```text
AWPer / star rifler / entry 更容易形成击杀贡献
IGL / support 更容易形成助攻或控制贡献
contact builder 只保留关键接触
assist 不再长期为 0
KDA 仍只来自 combat trace
```

当前结果：

```text
combat contact builder 已收敛为关键接触优先，不再默认保留全互联噪声。
objective contact、C4 压力、补枪准备、辅助压制等接触会写入 retentionReasons。
role contribution 已进入 killer / assister 归因排序，但不写 hard winner。
KDA 仍只从 combat trace 的 killer / target / assister 链路读取。
```

### Done：N41，商业攻防审计主线（已完成第一版）

目标是让用户不用打开 raw JSON，也能审查商业文斗：

```text
本回合小主题
守方自证
攻方质疑
agent 商业职责
LLM 原始输出与规范化行动
战斗商业裁判
CS 证据
hard winner
```

当前结果：

```text
Web progress projection 新增 businessReview。
/hex-lab/match 的审计抽屉新增并默认进入“商业攻防”标签。
页面先展示 round 小主题、守方自证、攻方质疑、phase 行动故事、combat 裁判故事和 hard winner。
LLM / combat / economy / hard winner 标签仍保留，但 raw JSON 不再是理解回合的主要入口。
```

详见：

```text
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
docs/hex/phase-2.0-pre-n35-n37-business-duel-quality-plan.md
```

## 5. 中期方向

```text
1. Hex 事实链稳定后，再讨论完整 BO3 / map pool。
2. Hex Web 验收可靠后，再考虑节目级观赛 UI。
3. 真实 LLM 稳定后，再扩大队伍和比赛规模。
4. 旧 Phase18 只作为 replay/live replay 兼容，不再作为新事实主线。
```

## 6. 长期 Backlog

长期方向保留，但不作为当前 N35 默认目标：

```text
完整 16 队 tournament / bracket / fixture / scheduling。
统计与奖项。
新闻与媒体站。
素材库和赛事生态。
Web ops、队列、可观测性、远端部署。
```

详见：

```text
docs/backlog/full-tournament-roadmap.md
docs/backlog/ecosystem-roadmap.md
docs/backlog/README.md
```

## 7. 当前不建议做

```text
不直接扩 16 队正式赛。
不先做新闻站或奖项站。
不恢复旧 Node/Sector runtime。
不把 Phase18 replay 误删或混成 Hex runtime。
不为真实感让前端、LLM 或经济系统写最终 winner。
不通过重装依赖解决文档或测试问题。
```
