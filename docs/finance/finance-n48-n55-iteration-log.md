# Finance Major N48-N55 迭代日志

本文件汇总 N48-N55 的关键结论，替代原先散落在 `docs/finance/` 下的单个 N 计划和报告。它是历史与审计日志，不是当前入口契约；当前契约见 `finance-major-prototype-plan.md`。

## 总结

```text
N48：Dust2 有色 6R 小样本验收，结构条件通过，真实样本质量未通过。
N50：离线金融事实库，FRED / BaoStock 进入 offline observation，UN Comtrade optional unavailable。
N51：专家证据切片，PM / Macro / Commodity / Company / Risk 五类角色开始拿不同证据。
N52：回合信息层 / 局内行动层硬隔离，phase action 不再接收完整金融长文本。
N53：金融裁判证据采信事实化，裁判必须说明采信、拒绝、缺失和 score cap。
N54：中文人类审计，Web 中文链路完成，real provider 成功样本 blocked。
N55：真实 LLM 输出审计，系统输入卡不能冒充 agent 输出。
N55 收口修正：phase0 真实开局输出层，phase1+ 只引用 phase0 输出。
```

## N48：Dust2 有色 6R 小样本验收

结论：条件通过。

已证明：

- fixture 6R 样本能写入 financeDuel。
- Web 能展示金融小主题、投资主张、反证质疑、证据编号、缺失证据和金融裁判。
- HexGrid 结构可以承载 Finance Major 原型。

未证明：

- real provider 金融样本质量达标。
- 真实对局足够有对抗性。
- 连续 round 的金融输出足够深入。

边界：

```text
N48 只说明结构链路可继续推进，不能作为真实金融对局通过证明。
```

## N50：离线金融事实库

目标：把用户准备的免费数据接口转成低频、可审计、低 token 的本地事实库。

结果：

```text
输出：data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
FRED：offline_observation_fact
BaoStock：offline_observation_fact
UN Comtrade：optional unavailable_observation
AKShare：registered_collector_not_used
```

边界：

- 不让 agent 在比赛中临场联网。
- 不让 LLM 编缺失数据。
- 不提交 API key、raw PDF、网页全文或敏感路径。

## N51：专家证据切片

目标：解决同队信息卡重复、专家差异不明显的问题。

结果：

- 每 round 生成 10 份 `agentEvidenceSlice`。
- 五类角色稳定覆盖：
  - PM / IGL：配置强度、风险收益、组合观点。
  - Macro / AWPer：全球价格、宏观和周期锚。
  - Commodity / entry：供需、贸易线索和缺失证据。
  - Company / star rifler：公司池、行情、估值代理。
  - Risk / support：missingEvidence、scoreCaps、止损和仓位降级。
- `agentOpeningBrief` 引用各自切片。

边界：

```text
N51 只解决输入差异化，不直接证明裁判已经采信证据。
```

## N52：回合信息层 / 局内行动层硬隔离

目标：防止 phase action 每阶段重写金融论文。

结果：

- compact request 不再发送完整 financeDuel 长文本。
- phase action 必须引用当前 agent 自己的 `briefRefId`。
- 缺失或错写 `briefRefId` 只能修到当前 agent 自己的信息卡。
- 大段复述开局论点会触发 `phase_repeated_round_thesis`。
- 行动理由明显超长会触发 `phase_action_reason_too_long`。

边界：

```text
N52 仍然使用系统生成的开局信息卡，尚未提供真实 phase0 开局输出。
```

## N53：金融裁判证据采信事实化

目标：防止“字段存在”冒充“机制生效”。

结果：

combat trace 新增：

```text
acceptedEvidenceRefs
rejectedEvidenceRefs
missingEvidenceApplied
scoreCapRefs
financeReasonZh
csReasonZh
```

规则：

- `challenge_landed` 必须说明攻方击中了哪条证据、假设或缺口。
- `thesis_defended` 必须说明守方用哪些证据、边界或风险承认守住质疑。
- fallback、invalid action、复述开局论点、行动理由超长不产生正向金融证据。
- `configured_proxy_fact` 是弱代理事实。
- `unavailable_observation` 不能被当成真实事实。

## N54：中文人类审计与真实样本验收

目标：让用户不用读 raw JSON 也能看懂真实链路。

结果：

- Web 中文链路已完成：
  - 小主题
  - 自证 / 质疑
  - 10 人信息卡
  - phase 行动
  - 采信 / 未采信 / 缺失证据
  - 金融理由 / CS 理由
  - hard winner
- 技术细节折叠保留。

真实样本状态：

```text
real provider 成功样本 blocked。
原因：当前环境出站或安全审查阻断外部 provider 调用。
结论：N54 不能宣称 real provider 成功样本通过，只能证明失败路径可审计。
```

## N55：真实 LLM 输出人类审计摘要

目标：解决系统输入卡被误认为 agent 输出的问题。

结果：

- 主审计展示 `hex_llm_response` artifact 的人工摘要。
- `agentOpeningBrief` 明确标注为“系统输入卡，非 agent 输出”。
- 没有 response artifact 时，必须显示没有真实模型输出。
- fallback 文案不能冒充 agent 成功输出。

边界：

```text
N55 第一版仍然没有真实 phase0 开局输出层，只是把 phase action response 摘要和系统输入卡分开。
```

## N55 收口修正：phase0 真实开局输出层

目标：满足用户要求的“开局先生成本局内容，后续 phase 只行动并引用”。

结果：

- 每个新 round 会生成 10 条 `roundStartAgentOutputs`。
- 每条输出来自真实 response artifact 或 fixture response。
- `agentOpeningBrief` 只作为 phase0 prompt 的输入材料。
- phase1+ request 只带当前 agent 自己的 phase0 输出摘要和当前局势。
- phase1+ 需要 `roundStartOutputId`。
- 大段复述 phase0 输出会触发 `phase_repeated_round_thesis`。
- Web 默认展示“本局真实开局输出”。

展示收窄补丁：

- `/hex-lab/match` 审计抽屉主视图只保留金融攻防审计。
- 主视图按选手折叠，先看 Phase0 真实开局输出和买型裁剪，再看当前 phase 的真实行动输出。
- 系统输入卡、artifact id、raw JSON、裁判调试细节默认折叠，不再和 agent 输出混在一起。
- 如果某个 agent 没有可消费真实输出，页面必须显示缺失或失败原因，不能用系统输入卡或 fallback 文案补成输出。

当前验收口径：

```text
用户已跑一个 round，评价为“一般但是合格”。
下一步应先做人工审计和文档清理，不立即扩新机制。
```

## 后续判断

进入 N56 前，应先完成：

```text
1. 用户人工 Web 审计。
2. 文档目录和入口清理。
3. 对真实样本质量问题做清单，而不是继续堆新机制。
```
