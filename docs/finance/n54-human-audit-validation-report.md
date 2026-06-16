# N54 中文人类审计与真实样本验收报告

## 1. 结论

N54 的 Web 中文审计主链路已完成第一版：`/hex-lab/match` 的金融攻防审计默认展示中文摘要、10 人开局信息卡、phase 行动引用、证据采信链、金融裁判理由、CS 执行理由和硬胜负解释，技术字段默认折叠在细节中。

真实样本验收本轮 **未通过 real provider 成功样本**。原因不是前端或裁判字段缺失，而是当前执行环境阻断了真实供应器调用：

```text
样本 1：沙箱内 real provider 请求全部 EACCES。
样本 2：外部执行申请被安全审查拒绝，原因是会把真实对局提示词与资产内容发送到外部 provider。
```

因此本报告结论是：

```text
中文人工审计 UI：通过第一版。
N50-N53 字段投影：可读。
real provider 成功样本：未通过，状态为 external blocked / provider error。
是否能宣称真实对局验收通过：不能。
```

## 2. 样本来源

本轮新建 real provider 样本：

```text
mapGameId: map_hex_lab_1781585477001_5aea8c81
provider mode: real
model: driver_deepseek_v4_flash
round: 1
roundWinType: defense_timeout_no_plant
score after round: 0-1
```

LLM 调用审计：

```text
expectedCalls: 50
totalLlmCallsAttempted: 50
acceptedDrafts: 0
rejectedDrafts: 50
fallbackCount: 50
responseArtifactIds: 0
providerErrors: provider_error / fetch failed / EACCES
combatResolutionCount: 0
```

这不是可用的真实成功样本。它只能证明失败路径可审计。

## 3. 字段链路检查

尽管 provider 被阻断，样本仍展示出 N50-N53 的投影字段可被 Web 读取：

```text
roundStoryZh: 本 round 小主题：全球有色价格是否支持景气上行。
roundValidationSummaryZh: 样本审计：真实 provider，6 个 phase，10 张开局信息卡，0 条证据采信链。
openingBriefCount: 10
sampleQualityWarningsZh:
  - provider 失败
  - 50 个行动降级
  - 50 个草案被拒绝
```

开局信息卡抽样：

- kyousuke：供需 / 商品专家，负责检查全球价格不能直接等同于中国国内供需、库存或现货紧张。可用事实主要来自 UN Comtrade unavailable observations，并引用 FRED 铜、铝价格作为弱代理事实。
- NiKo：公司 / 财务建模专家，负责把反证挑战落到代表公司行情、估值和利润弹性代理。可用事实来自 BaoStock 紫金矿业、江西铜业、中国铝业等公司市场表现。
- m0NESY：宏观策略专家，负责用全球价格和宏观周期线索检验方向基础。可用事实来自 FRED 铜、铝、镍、锌价格。

这些信息卡证明 N51 的专家切片已经进入人类审计投影，但因为 provider 失败，没有形成真实行动和 combat 采信链。

## 4. 行动与裁判链路

样本中所有 phase action 都因 provider error 降级为 `hold_position`。典型行动摘要：

```text
kyousuke 本阶段留守当前位置；
理由：真实供应器请求失败；
引用开局信息卡：供需 / 商品专家的证据切片；
降级原因：provider_error / EACCES。
```

因为没有 accepted action：

```text
combatResolutionCount: 0
financeEvidenceAdoption: 无
acceptedEvidenceRefs: 无
rejectedEvidenceRefs: 无
missingEvidenceApplied: 无
```

这意味着本轮不能证明：

- 真实 LLM 输出是否能稳定引用信息卡。
- N53 采信链是否能在真实 combat 中发挥作用。
- 金融证据采信是否实际影响击杀、压制、退让或控图。

## 5. 硬胜负

样本 round 最终是：

```text
roundWinType: defense_timeout_no_plant
```

该结果来自硬条件，而不是 LLM、前端或金融裁判。由于 provider 被阻断，进攻方没有形成有效推进和下包行动，最终超时。

这是合理失败路径，不是金融对抗成功样本。

## 6. 本轮 Web 改动验收

N54 已补强：

- `humanAudit.roundValidationSummaryZh`
- `humanAudit.sampleQualityWarningsZh`
- `phaseStory.phaseValidationSummaryZh`
- provider / fallback / missing evidence 中文失败解释。
- 金融攻防标签改为“金融攻防”。
- 行动技术细节折叠。
- 战斗技术细节折叠。

主视图现在先显示中文链路；raw artifact、agent id、cell id、英文 enum 和 raw JSON 保留在技术细节中。

## 7. 失败原因分类

本轮真实样本失败属于：

```text
external blocked / provider error
```

不是：

```text
schema rejected
action boundary rejected
evidence adoption failed
combat scoring failed
hard winner mismatch
Web projection missing
```

但由于 provider 没有成功返回，本轮无法判断真实输出质量。

## 8. 后续建议

如果用户要完成真正 real provider 人工验收，需要显式批准以下风险：

```text
真实对局 prompt、队伍资产摘要、金融证据摘要和地图行动上下文会发送给外部模型供应器。
```

批准后应重跑 1-3 个 real round，并补充本报告：

- 至少 1 个 accepted action。
- 至少 1 个 combat resolution。
- 至少 1 条 `financeEvidenceAdoption`。
- 至少 1 个 hard winner。
- 抽样解释“小主题 -> 自证 / 质疑 -> 信息卡 -> 行动 -> 采信链 -> combat -> hard winner”。

如果用户不批准外部出站，则 N55 应改为：

```text
离线 / fixture 审计质量门槛。
```

也就是用可控 fixture 样本先把中文审计、采信链、失败分类和 UI 验收做成质量门槛，再等待人工环境跑 real provider。
