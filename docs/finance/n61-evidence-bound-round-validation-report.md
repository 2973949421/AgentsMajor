# N61 Evidence-bound Round v1 小样本验收报告

更新时间：2026-06-21

## 1. 当前结论

N61 第 7 局 real 小样本曾达到 `pass`，证明 N56-N60 的结构链路可以跑通；但后续真实 map 样本暴露出更高优先级的 P0 问题：provider 断线、phase0 0/10 可消费、action 大面积 fallback 时，旧 trace 仍会出现 timeout/no plant 这类 hard winner，并容易被误读成正常比赛结果。

因此当前结论改为：

```text
N61 链路能力：曾通过小样本。
最新真实样本验收：fail。
当前优先级：fork-p0-round-quality-gate。
```

最新机器报告：

```text
data/materials/generated/finance/validation/dust2-nonferrous/n61-evidence-bound-round-report.json
qualityConclusion：fail
```

## 2. 最新失败样本

```text
trace：data/artifacts/hex-round-traces/round_map_hex_lab_1781988872146_1eb0ec98_9.json
roundNumber：9
providerMode：real
hardWinnerSource：defense_timeout_no_plant
```

关键失败计数：

```text
phase0 输出：10
可消费 phase0 输出：0
invalidPhase0OutputCount：5
providerErrorPhase0Count：5
stanceCardCount：0
challengeCardCount：0
financeVerdictCount：0
combatExplanationCount：0
legacyNoQualityGateCount：1
```

失败分类：

```text
old_trace_missing_fields：trace 未记录 P0 roundQualityStatus 质量闸门。
invalid_stance_card：真实 phase0 未产生可消费 stanceCard / coreClaims。
no_valid_claim_catalog：立场方没有合法 claimCatalog，挑战方按规则跳过真实模型调用。
provider_error：phase0 存在 provider_error，不能宣称 real 样本通过。
```

这说明问题不是 N59/N60 放松了裁判，而是坏 round 没有被质量闸门隔离。

## 3. P0 修复目标

当前必须先落地 `fork-p0-round-quality-gate`：

```text
roundQualityStatus：valid / provider_degraded / invalid_round
roundQualityReasons：phase0_stance_insufficient / phase0_challenge_insufficient / no_usable_phase0 / phase_action_provider_failed / phase_action_degraded / provider_error_threshold_exceeded / action_fallback_threshold_exceeded
roundQualityCounts：phase0 可消费数、provider error 数、invalid 数、fallback 数、最大 phase fallback、连续降级 phase 数
```

质量闸门要求：

```text
phase0 stanceCard 不足 5 张 -> invalid_round。
phase0 challengeCard 不足 4 张 -> invalid_round。
任一 phase action 10/10 fallback -> invalid_round。
连续 2 phase fallback >= 8/10 -> invalid_round。
invalid round 保留 trace / artifact / 错误原因，但不作为正常 hard winner 或正式 map 样本展示。
```

## 4. 旧 pass 样本保留

旧通过样本仍保留作为“链路可行”的证据，但不能替代当前质量闸门验收：

```text
trace：data/artifacts/hex-round-traces/round_map_hex_lab_1781788595055_0802feda_7.json
qualityConclusion：pass
phase0：10/10 可消费结构化卡片
finance verdict：33
无 accepted evidence 却判金融胜利：0
combat 金融 / CS 解释分离率：100%
hard winner：attack_elimination
```

## 5. 后续人工验收

P0 修复完成后，重新跑 real Dust2 有色 map：

```text
provider 正常：roundQualityStatus 应为 valid，hard winner 正常展示。
provider 断线或 action 大面积 fallback：roundQualityStatus 应为 invalid_round 或 provider_degraded，Web 顶部显示坏 round，不应展示成正常 timeout/no plant 胜负。
N61 脚本：invalid round 必须 fail，不能 pass。
```