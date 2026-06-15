# N50：离线金融事实库计划

## 1. 目标

本轮做 **N50：离线金融事实库**。（已完成第一版）

用户真正要解决的问题是：当前 FRED、BaoStock、UN Comtrade、AKShare 已经完成接口登记和本地验证，但比赛实际消费的 `round-evidence-packs.json` 仍主要是 `configured_proxy_fact`（配置型代理事实）。这意味着金融攻防看起来接入了证据层，实际仍没有稳定的离线观测事实支撑。

N50 只解决数据事实底座，不处理 agent 差异化、裁判采信或 Web 审计。这些拆到 N51-N54。

最终结果：

- 建立正式的离线金融事实库。
- FRED 与 BaoStock 成为第一版必通主路径。
- UN Comtrade 作为可选源，失败不阻塞但必须记录原因。
- AKShare 只登记为采集器候选，不作为最终事实源。
- 生成 `offline_observation_fact`（离线观测事实）或明确的 `unavailable_observation`（不可用观测）。
- 不让 agent 临场联网，不让 LLM 编数据。

## 2. 成功标准

N50 完成后必须满足：

- `data/materials/generated/finance/fact-bank/` 下存在可审计事实库快照。
- FRED 至少生成一组真实观测值，包含 series、period、value、unit、trend、source、collector、rawHash。
- BaoStock 至少生成 coreUniverse（核心公司池）的一组行情或估值代理事实。
- UN Comtrade 若不可用，必须生成 source warning 和 unavailable reason，不能假装成功。
- AKShare 只显示 `registered_collector_not_used`，不能被写成最终 source。
- 事实库不包含 API key、密钥预览、raw PDF、大网页全文或敏感本地路径。
- `round-evidence-packs.json` 仍可由旧配置兜底生成，但新事实库必须能被后续 N51 消费。
- 不修改 Hex AP、combat、economy、hard winner、KDA 归因。
- 不触碰 live replay 文件和 `.next-dev` 日志。

## 3. 已知上下文与初步判断

当前事实：

- `data/materials/processed/finance/source-registry.json` 已登记数据源。
- `tools/finance-data/requirements.txt` 已记录金融数据依赖。
- 外部 `B:\sharewithlight\metal_project` 中的测试脚本证明部分接口曾经跑通，但它们不是正式项目代码。
- 当前 generated evidence pack 多数仍是：

```text
dataMode = configured_proxy_fact
period = configured
value = null
```

初步判断：

- 用户准备接口的努力没有浪费，但尚未进入比赛事实层。
- 第一版不应让每个 agent 自己拉 API；应由离线采集器先生成事实库。
- N50 必须先把数据事实层做实，否则 N51-N54 只会把空数据包装得更漂亮。

## 4. 范围边界

In scope：

- 定义 fact bank（事实库）结构。
- 新增或整理 FRED / BaoStock / 可选 UN Comtrade 采集器。
- 生成 Dust2 有色 / 行业判断需要的低频事实快照。
- 记录 source / collector / limitation / missing reason。
- 更新金融数据契约与 roadmap。

Out of scope：

- 不做 agent evidence slice。
- 不改 `roundOpeningBrief`。
- 不改战斗裁判。
- 不改 Web 审计主界面。
- 不解析完整年报 PDF。
- 不做高频行情。
- 不接付费源。
- 不做 DB migration。
- 不运行 `pnpm install`。

## 5. 技术实现路径

### A. 事实库分层

固定四类对象：

```text
source registry：数据源登记和限制。
collector：API 或本地快照采集器。
fact bank：离线归一化事实库。
fact snapshot：某次生成的可审计快照。
```

推荐输出目录：

```text
data/materials/generated/finance/fact-bank/
```

### B. 标准事实字段

`offline_observation_fact` 至少包含：

```text
factId
statementZh
metricName
value
unit
period
source
sourceType
collector
confidence
rawHash
parserVersion
policyNotes
dataMode
observedAt
generatedAt
```

无法取数时使用：

```text
dataMode = unavailable_observation
unavailableReason
sourceWarning
```

### C. 第一版数据源

FRED：

- 用于全球金属价格和宏观代理变量。
- 不证明中国国内供需。

BaoStock：

- 用于 A 股代表公司行情、成交和估值代理。
- 不证明完整行业基本面。

UN Comtrade：

- 用于进出口滞后线索。
- 第一版可选。

AKShare：

- 第一版只登记为采集器候选。
- 若未来使用，必须保留原始 source 和 URL，不得把 AKShare 当最终 source。

## 6. 分阶段执行步骤

1. 冻结基线  
   执行 `git status --short`，确认 live replay 与 `.next-dev` 日志不属于本轮。

2. 补事实库契约
   在文档和类型中固定 `offline_observation_fact` / `unavailable_observation`。

3. 实现 FRED 主路径
   读取 `.env.local`，生成全球金属价格和宏观代理事实。

4. 实现 BaoStock 主路径
   采集 coreUniverse 公司行情和可用估值代理。

5. 接入 UN Comtrade 可选状态
   成功则生成观测事实，失败则生成 source warning。

6. 写入 fact bank 快照
   输出稳定 JSON，并保证不含 secret。

7. 更新材料验证
   增加 fact bank 结构校验。

8. 更新文档
   同步 `finance-data-asset-contract.md`、prototype plan 和 roadmap。

9. 验证并提交
   跑材料验证、相关测试和 typecheck。

## 7. 预期改动清单

预计新增：

```text
tools/finance-data/collectors/
data/materials/generated/finance/fact-bank/
```

预计修改：

```text
tools/finance-data/README.md
data/materials/scripts/validate-finance-evidence.mjs
docs/finance/finance-data-asset-contract.md
docs/finance/finance-major-prototype-plan.md
docs/current/current-state.md
docs/current/priority-roadmap.md
```

预计不动：

```text
apps/web/app/live-replay-player.tsx
apps/web/app/live-replay-player.module.css
Hex combat / AP / economy / hard winner
DB schema
```

## 8. 风险、未知项与替代方案

风险：

- FRED series 频率不同，需要统一 period。
- BaoStock 字段可能不稳定。
- UN Comtrade 可能受限或慢。
- 事实库过大可能污染后续 prompt。

替代方案：

- 如果 Python collector 集成成本过高，先从用户跑通脚本导出的 CSV/JSON 做标准化 converter。
- 如果 UN Comtrade 不稳定，先只写 unavailable observation。
- 如果事实库太大，只保留摘要事实和 rawHash，不提交 raw data。

禁止尝试：

- 不提交 API key。
- 不让 LLM 补缺失数据。
- 不把 configured proxy fact 冒充真实观测。
- 不把 FRED / BaoStock 的代理事实写成完整行业基本面。

## 9. 自动化验证

必须运行：

```powershell
node data/materials/scripts/validate-finance-evidence.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

如果新增 collector：

```powershell
<项目指定 Python> tools/finance-data/collectors/<collector>.py --dry-run
```

提交前检查：

```powershell
git diff --cached --name-only
```

要求不包含 live replay 和 `.next-dev` 日志。

## 10. 人工验收流程

成功路径：

1. 运行事实库生成命令。
2. 打开 fact bank JSON。
3. 检查 FRED 与 BaoStock 事实有真实 value。
4. 检查每条事实都有 source、collector、period、unit、hash。
5. 检查 unavailable observation 有原因。

失败路径：

- fact bank 仍全是 `configured_proxy_fact`。
- value 全是 null 且没有 unavailable reason。
- 输出包含 API key。
- AKShare 被写成最终事实源。

边界路径：

- UN Comtrade 不可用时不阻塞主路径。
- 旧 evidence pack 仍可兜底生成，但必须标记为 configured proxy。

## 11. 阻塞性问题

当前无产品阻塞。

执行前需要确认的非阻塞点：

- 本地 Python 使用项目根 `.venv` 还是工具目录 `.venv`。
- coreUniverse 第一版使用 5 家还是 10 家。

默认建议：

```text
FRED + BaoStock 必通。
UN Comtrade optional。
AKShare registered only。
coreUniverse 先用 5 家。
```

## 12. 最小化与回滚策略

- 第一版只生成 Dust2 有色 / 行业判断事实库。
- 只做低频快照。
- 不改比赛运行逻辑。
- 如果 collector 不稳定，保留 configured proxy 兜底，但明确标记。
- 如果事实库格式不合适，回滚生成目录，不影响已有 Hex 运行。

## 13. 下一步交付物

N50 交付：

1. 离线事实库结构。
2. FRED 主路径事实。
3. BaoStock 主路径事实。
4. UN Comtrade 可选状态。
5. AKShare 登记但未启用说明。
6. 验证脚本与文档更新。
7. 单独提交。

第一版实际输出：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/fred-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/baostock-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/un-comtrade-facts.json
```

N50 后进入：

```text
N51：专家证据切片与开局信息卡差异化。
```
