# Finance Major 原型计划：Dust2 有色 / 行业判断

## 1. 目标

本计划定义下一阶段的核心方向：把当前 HexGrid 中已经跑通的“泛商业攻防”语义层，替换为“金融投资对抗”语义层。

本阶段不是推翻 HexGrid 工程骨架，而是在最新 Hex 结构上替换内容底座：

```text
保留 HexGrid：地图、路径、阶段、行动、战斗、经济、回合提交、trace、Web 验收。
替换商业语义：旧 business duel 不再作为核心争点。
新增金融语义：finance duel 成为新裁判主线。
```

用户真正要解决的问题是：旧商业攻防虽然字段和链路已经接通，但输出容易变成“闭环、信任、执行力、价值放大”这类空泛语言，底蕴不足。金融投资对抗能把 agent 输出锚定到用户专业领域中的真实判断：行业、周期、供需、价格、估值、风险、配置。

第一版原型固定为：

```text
地图：Dust2 有色
轮次：行业判断
round 数：6
队伍：两种投资风格
agent：多专家团队
裁判：金融研究证据 60-70% + 执行层证据 30-40%
```

但数据事实层必须更克制：

```text
Dust2 有色第一版不是完整中国有色行业基本面系统。
它是免费 API 代理事实版。
```

第一版自动数据源只默认考虑：

```text
FRED
BaoStock
UN Comtrade（可选）
```

CNINFO、国家统计局、工信部、SHFE、SMM、LME、海关统计等先作为后置证据锚点或商业化替换源，不得包装成第一版稳定免费 API。详见：

```text
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

金融数据资产入口固定为：

```text
data/materials/processed/finance/
```

Hex 地图资产和金融主题资产不混放：

```text
data/materials/processed/maps/dust2/                    # Hex 空间事实
data/materials/processed/finance/maps/dust2-nonferrous/ # 金融行业判断事实
```

## 2. 成功标准

完成 N42-N48 后，至少应满足：

- 旧泛商业语义不再影响新对局底座。
- 队伍资产已经从“商业叙事”替换为“投资风格 + 行业理解 + 专家团队”。
- 每个 round 都有明确金融子命题，不再是抽象商业词。
- 守方输出的是投资主张自证，不是商业闭环自夸。
- 攻方输出的是反证挑战，不是泛泛质疑执行力。
- 裁判读取金融证据、逻辑链条、反证处理、收益风险比和可执行性。
- LLM 仍不能写 winner、kills、economyDelta、DB fact。
- 前端仍不能伪造事实。
- CS 词条只作为赛事包装和执行层表达保留，不再主导金融裁判。
- Web 能审计一个 round 的链路：
  ```text
  小主题 -> 守方投资主张 -> 攻方反证挑战 -> 专家 agent 行动 -> 金融裁判 -> 局部胜负 / 击杀包装 -> hard condition
  ```

失败现象：

- 输出仍然主要是“闭环、信任、价值、执行力”等旧商业模板。
- 队伍资产只是把“商业”换成“金融”两个字，没有行业判断干货。
- agent 没有专家分工，仍像 5 个同质选手。
- 裁判只按文风或自信程度评分。
- Web 只能看到字段，不能看清投资主张如何被 challenge。

## 3. 核心定义

```text
赛事主题 = 金融投资对抗
地图 = 行业赛道，例如有色、TMT、消费、医药、金融地产
轮次 = 研究任务类型，例如行业判断、估值建模、公司深度、组合策略、风险应对
round = 当前任务下的小问题 / 子命题
守方 = 提出投资主张并自证
攻方 = challenge 投资假设、估值、风险、行业逻辑
裁判 = 基于证据质量、模型一致性、风险识别、收益风险比、可执行性评分
```

当前测试版：

```text
地图 = Dust2 有色
轮次 = 行业判断
```

“Dust2”在第一版中保留为赛事地图代号和 Hex 空间载体；真实内容主题是有色行业判断。后续可以扩展为：

```text
Mirage TMT
Inferno 消费
Nuke 医药
Ancient 金融地产
```

但第一版只做 Dust2 有色，避免范围过大。

## 4. Dust2 有色 / 行业判断 6 个 round

6 个 round 按行业研究链设计，但第一版必须承认数据边界。铜、铝、锂、金、稀土等品种作为证据进入 round，而不是每个品种各写一篇作文。

在免费 API 代理事实版中，round 不能声称已经完整覆盖国内库存、现货升贴水、SHFE 仓单、行业利润和公司分产品毛利率。裁判必须暴露 `missingEvidence` 和 `scoreCaps`。

攻守互换是硬约束：

```text
一张地图只有 6 个行业判断小主题。
半场攻守互换后，继续复用同 6 个小主题。
当前守方生成 defenseProof。
当前攻方生成 attackChallenge。
队伍风格、agent 专长、map overlay 偏好不能被解释成固定攻守身份。
```

也就是说，Falcon-7B 和 VitaLLMty 都必须能在同一主题下分别承担“守方自证”和“攻方质疑”。任何 prompt、裁判或 Web 展示在使用 `roundTopics`、`roundOwnership`、`teamMapBias` 时，都必须先解析当前 side assignment（阵营分配），不能把某支队伍硬编码为永久进攻方或永久防守方。

| Round | 小主题 | 守方自证 | 攻方挑战 |
|---|---|---|---|
| R1 | 全球有色价格是否支持景气上行 | 用 FRED 金属价格说明全球价格趋势 | 全球价格不能等同于中国国内供需 |
| R2 | A 股有色代表公司是否已经反映价格预期 | 用 BaoStock 股价、成交、PE/PB 说明市场反应 | 市场表现不能证明行业基本面 |
| R3 | 估值是否已经 price in | 用 BaoStock 估值和收益率判断是否透支 | 缺少财报页码和利润弹性时不能做公司深度强结论 |
| R4 | 进出口数据是否支持供需变化 | 用可选 UN Comtrade 观察铜矿砂、铝土矿等进口趋势 | 进出口滞后且不能替代国内库存、现货和行业利润 |
| R5 | 当前证据缺口下哪些结论不能下 | 主动列出 missingEvidence 和 scoreCaps | 攻方检验守方是否用代理事实冒充完整事实 |
| R6 | 基于有限证据的配置倾向与风险边界 | 给出有限置信度的配置倾向、观察指标和降级条件 | 结论是否承认数据边界，是否具备可执行风险控制 |

每个 round 的最小输出应包含：

```text
investmentThesis：投资主张
keyAssumptions：关键假设
evidenceRefs：引用材料或数据点
counterEvidenceHandled：已处理反证
riskBoundary：风险边界
actionableConclusion：可执行结论
```

攻方 challenge 的最小输出应包含：

```text
challengedAssumption：攻击的核心假设
contraryEvidence：反向证据
logicBreak：推导断点
riskAmplifier：风险放大点
requiredDefense：守方必须回答的问题
```

## 5. 队伍资产改造原则

本次切换是替换，不是叠加。

旧队伍资产中的泛商业底色应移除或降级为历史背景，不能继续作为新 finance duel 的主要 prompt 来源。新资产要写成投资团队画像。

资产应有干货，但不要写成长篇文章。第一版建议每队 JSON 主体控制在结构化字段上，Markdown 用于人工审阅，避免几千字宏大叙事。

每队资产至少包含：

```text
investmentStyle：投资风格
industryView：对有色行业的核心理解
preferredEvidence：偏好的证据类型
riskBias：风险偏好
timeHorizon：投资期限
valuationPreference：估值方法偏好
macroAssumption：宏观假设
commodityFocus：重点品种
failureMode：最容易犯的错误
debateWeakness：容易被对手 challenge 的地方
coachDoctrine：教练的研究纪律和临场修正原则
agentRoster：专家 agent 列表
```

资产长度建议：

```text
JSON：结构化、机器可读，字段完整，不写长篇散文。
Markdown：每队 800-1500 中文字左右，足够说明风格、行业判断、专家分工和弱点，不写空泛口号。
```

## 6. 两队第一版风格

第一版可以沿用现有 teamId 和 playerId，减少 runtime 改动；但队伍资产内容必须完全替换为金融画像。

### Team A：进攻型周期成长风格

定位：

```text
偏好高 beta、周期拐点、供需缺口、价格弹性和集中表达。
更愿意在关键窗口提高仓位，追求行业上行阶段的超额收益。
```

强项：

- 对供需缺口和价格弹性敏感。
- 敢于提出明确方向，不满足于中性结论。
- 能把宏观、商品价格和公司弹性连接起来。

弱点：

- 容易高估价格弹性和景气持续性。
- 容易忽视库存、美元、利率、估值兑现和回撤风险。
- 在强趋势叙事中可能低估反证。

### Team B：稳健质量风控风格

定位：

```text
偏好现金流、安全边际、成本曲线、资产质量、政策约束和风险调整收益。
更重视判断的可验证性和回撤控制。
```

强项：

- 对泡沫、拥挤交易和估值透支更敏感。
- 强调财务质量、成本曲线和可执行风险边界。
- 在不确定环境中更稳健。

弱点：

- 可能过度保守，错过周期主升段。
- 可能把早期价格信号误判为噪声。
- 在趋势快速展开时反应偏慢。

## 7. 专家 Agent 与教练分工

agent 角色需要比旧 CS 职责更贴合金融研究，但可以保留部分 CS 包装词作为赛事外壳。建议第一版每队 5 个专家 agent + 1 个 coach。

### Coach（教练）

职责：

- 设定队伍研究纪律。
- 控制“观点过度漂移”。
- 在 round 间修正假设、引用证据和风险边界。
- 不直接写 winner，不直接替 agent 输出完整答案。
- 提供 timeout / review 级别的修正建议。

Coach 不是第 6 个上场选手。它是研究流程的约束者。

### Agent 1：PM / Portfolio Manager（组合经理）

CS 包装词条可映射为 IGL（指挥）。

职责：

- 汇总队伍观点。
- 做最终行业方向、配置权重和风险收益比判断。
- 决定 round 内主攻主守思路。

常见输出：

- 行业方向判断。
- 配置建议。
- 风险边界。
- 对其他专家观点的取舍。

弱点：

- 容易为了结论统一而压低反证。

### Agent 2：Macro / Strategy（宏观策略专家）

CS 包装词条可映射为 AWPer（远点狙击 / 大方向判断）。

职责：

- 判断美元、利率、政策、地产、制造业、全球周期。
- 给出周期位置和宏观约束。

常见输出：

- 周期阶段判断。
- 宏观变量对商品价格的影响。
- 政策与流动性风险。

弱点：

- 容易用宏观框架压过行业微观证据。

### Agent 3：Commodity Supply-Demand（供需 / 商品专家）

CS 包装词条可映射为 entry（突破）。

职责：

- 直接攻击最关键的供需矛盾。
- 分析库存、产能、进口、替代、需求弹性。

常见输出：

- 供需缺口判断。
- 价格弹性来源。
- 商品品种间比较。

弱点：

- 容易过度依赖单一高频数据或短期价格。

### Agent 4：Company / Financial Modeling（公司 / 财务建模专家）

CS 包装词条可映射为 star rifler（主力火力）。

职责：

- 把行业判断落到公司、利润、估值和财务弹性。
- 检查价格假设对盈利和估值的敏感性。

常见输出：

- 成本曲线。
- 盈利弹性。
- 估值锚。
- 公司相对优劣。

弱点：

- 可能陷入模型细节，忽略行业拐点。

### Agent 5：Risk / Trading（风控 / 交易专家）

CS 包装词条可映射为 support / lurker（辅助 / 侧翼观察）。

职责：

- 识别回撤、拥挤度、流动性、止损、仓位和反证触发。
- 攻防中专门找对方结论的失败条件。

常见输出：

- 风险清单。
- 止损条件。
- 交易拥挤度。
- 反证信号。

弱点：

- 可能过度保守，降低进攻性。

## 8. CS 词条保留与替换边界

保留的 CS 词条：

```text
map / round / half / attack / defense / player / coach / KDA / entry / AWPer / IGL / support / clutch / execute / retake
```

保留原因：

- 赛事包装需要 CS Major 外壳。
- Web 选手栏和地图观感仍然使用 HexGrid。
- 用户已经有 `/hex-lab/match` 验收路径。

必须替换的语义：

```text
businessDuel -> financeDuel
businessIntent -> financeIntent / investmentIntent
businessScore -> financeScore
businessVerdict -> financeVerdict
proof_rebutted_challenge -> thesis_defended
challenge_succeeded -> challenge_landed
contested_no_business_resolution -> contested_no_finance_resolution
```

第一版如果为了兼容暂时保留底层字段名，必须通过 adapter 明确语义已经切换为 finance，不能让旧商业词进入 prompt 主体。

## 9. 金融裁判原则

金融裁判比例：

```text
金融研究攻防：60-70%
执行层证据：30-40%
```

金融研究攻防维度：

- `evidenceQuality`：是否引用材料和数据。
- `hypothesisClarity`：假设是否清楚且可检验。
- `logicConsistency`：假设、推导、结论是否一致。
- `counterEvidenceHandling`：是否识别并处理反证。
- `valuationDiscipline`：估值、赔率和敏感性是否合理。
- `riskReward`：收益风险比是否清楚。
- `actionability`：结论是否能落到方向、时间窗口、仓位或风险边界。
- `challengeHitRate`：攻方是否击中守方核心假设。

执行层证据维度：

- `agentRoleFit`：是否符合专家职责。
- `roundObjectiveFit`：是否围绕当前 round 子命题。
- `coordination`：团队观点是否协同。
- `phaseExecution`：是否按阶段推进判断，而不是每 phase 重新发明观点。
- `riskControlAction`：是否根据风险和反证调整。

禁止：

- 不用文风好坏决定胜负。
- 不让 LLM 写 winner 或 kill。
- 不把金融观点包装成数据库事实。
- 不把没有材料引用的宏大判断当强证据。
- 不把旧商业闭环词汇当 finance evidence。
- 不把代理事实包装成完整行业判断。
- 不把 FRED 全球价格直接等同于中国国内现货、库存或供需。
- 不把 BaoStock 市场表现直接等同于行业基本面。
- 不把缺少 CNINFO 页码的公司判断写成公司深度事实。

## 10. 未来 N 规划

### N42：Finance Evidence + Finance Duel 契约

目标：

- 固定金融投资对抗定义。
- 固定免费 API 代理事实版边界。
- 固定 collector / source / evidence / prompt context 分层。
- 固定 Dust2 有色 / 行业判断 6R。
- 固定两队投资风格。
- 固定 agent / coach 分工。
- 明确替换旧商业底座。

交付：

- 本文档。
- `docs/finance/finance-evidence-mvp.md`。
- 当前路线图更新。
- prompt / judge / runtime 文档中增加 finance transition 说明。

### N43：金融队伍资产与专家 Agent 改造（已完成第一版）

目标：

- 修改两队 `initial-proposal.json/md`。
- 删除旧泛商业底色。
- 写入投资风格、行业理解、专家角色、教练纪律。
- 资产有干货但不过长。

交付：

- 两队 finance profile。
- 五专家 + coach 结构。
- materials 验证。

N43 第一版结果：

```text
Falcon-7B：进攻型周期成长风格，强调有色价格弹性、供需缺口、代表公司利润弹性和集中表达。
VitaLLMty：稳健质量风控风格，强调安全边际、成本曲线、估值纪律和风险调整收益。
```

两队 `initial-proposal.json/md` 已替换为金融投资语义；旧 validator（校验器）要求的字段名暂时保留，但字段内容已从泛商业叙事改为金融研究资产。每名选手和教练新增 `finance_agent_profile`，CS 角色保留为赛事包装与 Hex 执行层表达，不再作为金融裁判主语义来源。

N43b 补丁结果：

```text
Team Core：两队跨行业投资风格、证据哲学、攻防模式、决策阈值和盲点已写入 teamCore。
Agent Core：10 名选手 + 2 名教练的 signatureLens、preferredEvidenceType、attackStyle、defenseStyle、decisionThreshold、crossMapStrength、crossMapWeakness、oneLineVoice 已写入 finance_agent_profile。
Dust2 Overlay：有色专属 allowedEvidenceSources、missingEvidence、scoreCaps、teamMapBias、agentMapSpecialization、R1-R6 ownership 和 refereeLanguageGuide 已写入 map-overlay.json。
```

N43b 的关键边界是：队伍和选手 core 必须跨行业复用；FRED、BaoStock、Comtrade、铜铝锂、国内库存、R1-R6 等有色专属内容只能进入地图 overlay 或 evidence pack，不能再次写死到队伍根资产里。

N43b 追加攻守互换约束：

```text
Round topic 是命题，不是队伍所有权。
Defense / attack 是当前 half 和 side assignment 的运行时结果。
map-overlay.json 中的 teamMapBias、agentMapSpecialization、roundOwnership 只描述队伍风格与主题打法示例，不能绕过当前攻守身份。
```

### N44：Finance Evidence MVP 接入

目标：

- 新增 Finance Evidence MVP 的数据接入骨架。
- 先接 FRED 和 BaoStock。
- UN Comtrade 作为可选第三源。
- 从 `data/materials/processed/finance/` 读取 source registry、policy、round topics 和 universe。
- 生成 raw cache、normalized facts、evidence_id、round evidence pack。
- 不接 CNINFO 全文解析，不接 SHFE 自动化，不接 SMM。

交付：

- collector 接口。
- source registry。
- evidence registry。
- round evidence pack。
- judge evidence ledger 第一版。

### N45：Finance Duel Runtime 接入

目标：

- 在 Hex runner 中生成 financeDuel。
- phase request 消费 financeDuel。
- trace artifact 写入 financeDuel。
- 保持旧字段兼容但不让旧 business 语义污染 prompt。

交付：

- `HexRoundFinanceDuel` 或 `roundDuel(type="finance")`。
- 6R subtheme provider。
- prompt adapter。
- trace 测试。

### N46：金融裁判替换商业裁判

目标：

- combat / judge 从 businessScore 切到 financeScore。
- 金融研究证据 60-70%，执行层证据 30-40%。
- financeVerdict 影响击杀、压制、退让和控图。

交付：

- finance scoring。
- finance verdict。
- combat attribution 测试。

### N47：金融 Web 验收台改造

目标：

- `/hex-lab/match` 展示金融攻防链路。
- 选手栏显示专家职责和金融贡献。
- 审计抽屉展示投资主张、反证挑战、金融裁判、执行证据。
- 展示每个 round 的 evidence_id、missingEvidence 和 scoreCaps。

交付：

- finance review projection。
- Web 文案与审计标签替换。
- 不再以旧商业攻防作为主入口。

### N48：Dust2 有色 6R 小样本验收

目标：

- 跑一张 6 round 小地图。
- 验证金融主题是否明显减少空话。
- 验证代理事实版是否诚实暴露数据缺口。
- 检查 token 成本、裁判质量、专家分工、Web 可读性。

交付：

- 6R trace。
- 人工审计样本。
- 下一阶段是否扩大到 TMT / 消费 / 医药的判断。

## 11. 最小化与回滚策略

- N42 只写文档，不改 runtime。
- N43 只改 materials，不改裁判。
- N44 只接 evidence MVP，不接 Web 大改。
- N45 只接 financeDuel，不调裁判权重。
- N46 才替换裁判。
- N47 才改 Web 主展示。
- N48 才做小样本验收。

如果 finance 原型失败：

- 保留 HexGrid 工程骨架。
- 保留 trace 和失败样本。
- 不回滚 N20-N41 已有运行能力。
- 不恢复旧 Node/Sector。
- 不把旧商业攻防混回 finance prompt。
