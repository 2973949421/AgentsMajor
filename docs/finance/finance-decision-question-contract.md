# Finance Decision Question Contract

本文冻结 N56 起的 Finance Major（金融投资对抗）命题口径。它替代旧的“守方自证 / 攻方质疑”证明题表达。

当前实现状态：N56 已完成第一版。Dust2 有色 6 个 round 已写入 `decisionQuestion`、`allowedStance`、`requiredEvidenceSchema` 和 `challengePolicy`，并进入 finance duel、phase0 / phase1+ prompt 上下文和 Web 中文审计。N57 已覆盖升级现有 fact bank 到 v2。N58 已把 phase0 真实输出升级为结构化 `stanceCard / challengeCard`；N59 仍负责金融裁判证据采信重写。

## 1. 核心结论

Finance Major 第一阶段不是验证谁投资一定正确，而是验证：

```text
谁能在固定、有限、可审计的数据框架下，形成更稳健、更可执行、更少幻觉的投资判断。
```

金融层必须改成证据绑定的投资决策攻防：

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

CS 层仍可使用 attack / defense、T / CT、下包、拆包、控图、击杀等包装。金融层不再继承“进攻方必须唱反调、防守方必须证明某个方向”的逻辑。

## 2. Round 必须是决策题

Round 不再写成“证明某观点成立”，而要写成受约束的投资决策题。

错误示例：

```text
证明全球有色价格支持景气上行。
```

正确示例：

```text
在当前数据框架下，未来 1-3 个月 A 股有色相对沪深300是否应超配、标配、低配、结构性配置，还是暂不交易？
```

每个决策题至少包含：

```text
decisionObject：行业、子行业、股票池或商品。
horizon：1个月、3个月或6个月。
benchmark：沪深300、中证800、商品价格指数或其他明确基准。
allowedStance：看多、看空、中性、结构性分化、条件判断、暂不交易。
requiredOutput：仓位建议、核心证据、主要风险、失效条件。
requiredEvidenceSchema：本题必须覆盖或明确缺失的证据类别。
```

`requiredEvidenceSchema` 是 N57 数据补厚的输入，不是审计装饰。它至少包含：

```text
requiredKey：证据需求，例如 commodity_price、macro_demand、equity_performance、valuation、risk、supply_inventory。
requiredForClaimTypes：该证据限制哪些主张类型。
minimumFactCount：最低事实数量。
preferredSources：优先数据源。
fallbackSources：可接受代理源。
missingEffect：缺失时触发的 score cap、置信度上限或投影限制。
notWinCondition：明确缺失证据不能让 challenge 自动获胜。
```

如果 round 没有 `requiredEvidenceSchema`，就不能进入 N57。否则 N57 不知道该补哪些数据，N58 也会继续让 agent 自己发明数据框架。

## 3. 立场方

立场方负责给出投资立场，不负责证明预设方向。

允许的立场：

```text
bullish：看多。
bearish：看空。
neutral：中性。
structural：结构性分化。
conditional_bullish：条件看多。
conditional_bearish：条件看空。
no_trade：暂不交易。
```

`no_trade` 不是逃避判断。它必须说明：

```text
当前最关键的不确定性。
触发交易的可观察条件。
触发后应如何行动。
```

## 4. 挑战方

挑战方负责攻击具体主张，而不是泛泛说“数据不足”。

Challenge 必须绑定：

```text
targetClaimId：被挑战的主张。
challengeType：代理错配、证据缺失、时间窗口错配、风险收益不成立、替代解释。
evidenceRefs：挑战使用的证据。
confidenceReduction：挑战成立时应降低多少置信度。
```

无效 challenge：

```text
数据不够，所以不能判断。
```

有效 challenge：

```text
对方用铜价上涨支持全有色超配，但该证据只能支持铜价动量，不能证明整个 A 股有色公司池盈利传导。因此该立场最多能支持铜暴露子行业结构性配置，不能支持全行业超配。
```

## 5. Phase0 输出卡

N58 起，phase0 真实开局输出应升级为结构化卡片。自然语言可以用于审计摘要，但底层必须可校验。

### Stance Card

```text
direction：立场方向。
target：判断对象。
horizon：时间窗口。
confidence：置信度。
positionSuggestion：仓位或配置建议。
coreClaims：核心主张。
evidenceRefs：证据引用。
reasoningBridge：证据到结论的推理桥。
riskBoundaries：风险边界。
invalidatingConditions：失效条件。
```

### Challenge Card

```text
targetClaimId：挑战对象。
challengeType：挑战类型。
challengedAssumption：被挑战假设。
evidenceRefs：证据引用。
proxyMismatch：代理错配说明。
confidenceReduction：置信度压降。
```

## 6. Phase1+ 行动边界

Phase1+ 是局内行动层，不是重新写金融论文。

允许：

```text
引用一个 claimId 或 challengeId。
说明本阶段行动目标。
说明目标点位、风险、补枪、换人、护包、拆包或控图动作。
用一两句话连接 phase0 判断和当前行动。
```

禁止：

```text
新增投资立场。
新增 evidence。
重写完整金融论证。
把系统输入卡当作 agent 输出。
把 provider error 或 fallback 文案当作真实输出。
```

## 7. 裁判硬门槛

金融裁判必须判定：

```text
acceptedEvidenceRefs
rejectedEvidenceRefs
missingEvidenceApplied
scoreCaps
stanceScore
challengeScore
financialResult
combatEffectAllowed
```

硬规则：

```text
没有 acceptedEvidenceRefs，不能判金融胜利。
missing evidence 只能降权、限制置信度或限制战斗投影。
不存在的 evidence id 让对应 claim 无效。
代理事实过度外推必须 rejected。
数据不足不能直接赢。
```

CS 层仍可独立产生击杀，但不能把无采信证据的击杀解释成金融优势。
