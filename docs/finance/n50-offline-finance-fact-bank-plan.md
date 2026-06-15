# N50：离线金融事实库与专家证据切片计划

## 1. 目标

本轮做 **N50：离线金融事实库与专家证据切片**。

N49 已经把 Web 审计改成中文摘要优先，并引入 `roundOpeningBrief`（回合开局信息层）和 `agentOpeningBrief`（选手开局信息卡）。但最新人工审计暴露出两个根问题：

```text
1. 用户准备的 FRED / BaoStock / UN Comtrade / AKShare 接口没有真正产出比赛可用的金融事实库。
2. 同一队伍内 5 名 agent 的开局金融内容高度重复，因为当前只按攻守方生成模板，没有按专家角色切分证据和任务。
```

N50 的目标不是让每个 agent 在比赛中临场拉 API。那会带来成本、延迟、失败率和上下文污染。更稳的方向是：

```text
先用接口离线准备一份充足、低 token、可审计的宏微观事实库。
比赛时 agent 只读取被裁剪过的 evidence pack（证据包）和 role slice（角色证据切片）。
```

最终结果：

- 把用户已经准备好的金融 API 入口转化为正式数据采集计划，而不是只停留在 source registry（数据源登记）。
- 明确区分 `collector（采集器）`、`source（事实来源）`、`fact bank（事实库）`、`evidence pack（证据包）`、`agent evidence slice（选手证据切片）`。
- 用离线事实库驱动 round 级金融攻防和 10 名 agent 的差异化开局信息卡。
- 不要求 agent 临场联网，不让 LLM 编数据，不把配置型代理事实冒充真实数据。
- 保持 HexGrid 运行骨架不变，只修金融事实层和信息分发层。

## 2. 成功标准

N50 完成后必须满足：

- `data/materials/generated/finance/` 中不再只有 `configured_proxy_fact（配置型代理事实）`，而是能生成带真实观测值或明确快照值的 `offline_observation_fact（离线观测事实）`。
- FRED / BaoStock / UN Comtrade / AKShare 的状态被明确分层：
  - 已启用采集。
  - 暂只登记。
  - 只作为采集器，不作为最终事实源。
  - 因限制暂缓。
- 正式比赛运行时仍不临场请求外部 API；只读取已经生成并校验过的本地事实库。
- 每个 round evidence pack 至少包含：
  - 事实摘要。
  - 原始 source。
  - collector。
  - 数据期点 / 时间范围。
  - value / unit / direction / trend / rank 或明确的不可用说明。
  - missingEvidence。
  - scoreCaps。
  - rawHash / generatedAt / dataMode。
- 每个 agent 的开局信息卡不再是同队复制：
  - PM / IGL：组合观点、配置权重、风险收益。
  - Macro / AWPer：宏观与全球价格锚。
  - Commodity / entry：品种供需、库存缺口、价格弹性。
  - Company / star rifler：公司池、估值、盈利弹性。
  - Risk / support：反证、仓位、止损、拥挤度、证据缺口。
- 同一队伍 5 名 agent 至少引用不同的 evidence slice，不能只复读同一句守方自证或攻方质疑。
- Web 审计能显示“这个 agent 本局拿到哪些证据、负责什么问题、引用了哪些 factId / evidenceId”。
- 裁判必须基于证据质量、证据边界和角色任务判断；不能因为文本自信就给高分。
- 不改 AP、combat 权重、economy 参数、hard winner 原则。
- 不让 LLM 或前端写最终胜负、击杀、经济变化或数据库事实。

## 3. 已知上下文与初步判断

当前阶段：

```text
N42：Finance Evidence + Finance Duel 契约。（已完成）
N43：金融队伍资产与专家 Agent 改造。（已完成）
N44：Finance Evidence MVP 接入。（已完成第一版）
N45：Finance Duel Runtime 接入。（已完成第一版）
N46：金融裁判替换商业裁判。（已完成第一版）
N47：金融 Web 验收台改造。（已完成第一版）
N48：Dust2 有色 / 行业判断 6R 小样本验收。（条件通过）
N49：中文可读审计 + 回合信息层 / 局内行动层拆分。（已完成第一版）
N50：离线金融事实库与专家证据切片。（本轮）
```

当前仓库事实：

- `tools/finance-data/requirements.txt` 只记录依赖，没有正式 collector 实现。
- `data/materials/processed/finance/source-registry.json` 已登记 FRED、BaoStock、UN Comtrade、AKShare。
- `data/materials/scripts/generate-finance-evidence.mjs` 会生成 evidence pack，但当前主要读取配置文件。
- 当前 evidence fact 多为：

```text
dataMode = configured_proxy_fact
period = configured
value = null
```

- 最新 trace 已经消费 `financeDuel.evidence`，但用的是这些配置型代理事实。
- 最新 round 中同队 5 人开局信息卡高度重复，根因是 `financeTask` 只按攻守方生成，agent role 还是 `unknown`。

初步判断：

- 用户准备 API 的努力没有白费，但目前只落到了“数据源登记”和“证据包壳子”，尚未变成真实事实库。
- 不应让 agent 自己拉数据；应该由离线 collector 先生成稳定事实库，再由 runtime 按 round 和 role 裁剪。
- 现在最该补的是“事实采集 -> 事实归一化 -> round evidence pack -> agent evidence slice -> opening brief”的链路。
- 这不是 UI 问题；Web 当前只是把底层同质事实和同质任务暴露出来。

## 4. 范围边界

In scope：

- 规划并实现离线金融事实库结构。
- 明确 FRED / BaoStock / UN Comtrade / AKShare 的第一版采集边界。
- 新增或整理 collector 输出格式。
- 生成 Dust2 有色 / 行业判断 6R 的事实库快照。
- 用事实库生成 round evidence pack。
- 用 round evidence pack 生成 agent role evidence slice。
- 让 `roundOpeningBrief` 消费 role slice，而不是只消费同一句 side thesis / challenge。
- 更新 Web 审计字段，让用户能看到每名 agent 的证据来源和职责差异。
- 更新文档、测试和材料验证。

Out of scope：

- 不让每个 agent 在比赛中实时联网查数据。
- 不做高频行情系统。
- 不解析完整年报 PDF 全文。
- 不接付费源，不抓取受限站点。
- 不把 AKShare 记录为最终事实源；AKShare 只能是采集器。
- 不把 FRED 全球价格直接写成中国国内供需事实。
- 不把 BaoStock 股价/估值直接写成行业基本面事实。
- 不把 UN Comtrade 滞后进出口数据写成国内库存或现货事实。
- 不新增 DB migration。
- 不改 Hex 地图、路径、AP、combat、economy、winner。
- 不恢复 Node/Sector。

## 5. 技术实现路径

### A. 数据层分层

固定五层：

```text
source registry：登记数据源与限制。
collector：负责从 API 或本地快照取数。
fact bank：离线事实库，保存归一化事实。
round evidence pack：每个 round 的可裁判证据包。
agent evidence slice：每名 agent 的角色证据切片。
```

目录建议：

```text
data/materials/processed/finance/                  # 人工维护配置
data/materials/generated/finance/fact-bank/        # 离线事实库快照
data/materials/generated/finance/maps/<map>/       # round evidence packs
data/materials/generated/finance/agent-slices/     # 可选，若需要缓存 agent 切片
tools/finance-data/collectors/                     # collector 实现
tools/finance-data/README.md                       # 本地运行说明
```

### B. FRED 第一版

用途：

- 全球金属价格。
- 宏观代理变量。
- 只能支撑全球价格锚，不能证明中国国内供需。

输出事实：

- seriesId。
- observationDate。
- value。
- unit。
- latestValue。
- lookbackWindow。
- trendDirection。
- changePct。
- source = FRED。
- collector = fred_http_api_v1。
- dataMode = offline_observation_fact。

### C. BaoStock 第一版

用途：

- A 股代表公司行情。
- 估值代理。
- 成交和市场反应。
- 不能证明行业基本面。

输出事实：

- stockCode。
- companyName。
- dateRange。
- close / return / turnover / volume。
- PE / PB 若可取。
- trendDirection。
- valuationSignal。
- source = BaoStock。
- collector = baostock_python_package_v0。
- dataMode = offline_observation_fact。

第一版可先使用 coreUniverse，不必马上扩到 25 家：

```text
紫金矿业
江西铜业
中国铝业
铜陵有色
云南铜业
```

### D. UN Comtrade 第一版

用途：

- 进出口滞后线索。
- 可选第三源。
- 不能替代中国海关、本土库存或现货升贴水。

输出事实：

- reporter。
- partner。
- cmdCode。
- period。
- tradeFlow。
- tradeValue。
- netWeight / quantity 若可取。
- lagWarning。
- source = UN Comtrade。
- collector = un_comtrade_python_package_v1。
- dataMode = offline_observation_fact。

### E. AKShare 第一版

用途：

- 采集器候选。
- 不作为最终 source。
- 可后续用于抓 SHFE、国家统计局、行业页面等，但必须保留原始 source 和限制。

N50 第一版不强制启用 AKShare；可先在事实库中记录：

```text
akshare_status = registered_collector_not_used
```

### F. Agent evidence slice

每个 round evidence pack 进入 agent 前，必须按专家角色切片：

```text
PM / IGL：
  组合结论、证据强弱、配置上限、风险收益比。

Macro / AWPer：
  FRED 全球价格、宏观变量、周期位置。

Commodity / entry：
  商品品种、供需代理、进出口线索、库存缺口。

Company / star rifler：
  BaoStock 公司池、行情、估值代理、盈利弹性限制。

Risk / support：
  missingEvidence、scoreCaps、反证、止损、仓位边界。
```

每张开局信息卡应包含：

```text
briefId
agentId
displayName
financeRole
teamSide
roundTopic
roleQuestionZh
evidenceRefs
usableFactsZh
evidenceBoundaryZh
challengeOrProofZh
actionHintZh
```

### G. 裁判与 Web 使用

裁判应读取：

- agent evidence slice。
- cited evidenceRefs。
- missingEvidence。
- scoreCaps。
- action intent。
- CS execution evidence。

Web 应默认展示：

- 每名 agent 的证据切片。
- 引用了哪些 factId / evidenceId。
- 哪些证据被裁判采信。
- 哪些结论因缺失证据被降权。

技术细节折叠显示：

- raw value。
- source / collector。
- hash。
- generatedAt。
- artifact id。

## 6. 分阶段执行步骤

1. 冻结基线  
   执行 `git status --short`，确认 live replay 和 `.next-dev` 日志不属于本轮。  
   目的：避免金融数据层改动混入无关 UI。

2. 补文档与契约  
   更新 finance data contract、prototype plan 和 current roadmap。  
   目的：先固定“不临场拉 API，先离线事实库”的方向。

3. 定义 fact bank schema  
   新增事实库 JSON schema 或 TypeScript 类型。  
   目的：让 collector 输出稳定，不靠临时对象。

4. 实现 FRED collector 第一版  
   读取 `.env.local`，拉取配置里的 series，生成离线 fact bank。  
   目的：先打通官方 API 数据源。

5. 实现 BaoStock collector 第一版  
   用 coreUniverse 拉行情和可用估值代理，生成离线 fact bank。  
   目的：让 A 股代表公司数据不再只是配置列表。

6. 评估 UN Comtrade collector  
   如果 key 和包稳定，就生成可选事实；如果失败，明确写入 source warning。  
   目的：不阻塞主链路，但不假装成功。

7. 改造 evidence generator  
   从 fact bank 生成 round evidence pack。  
   目的：替换纯 configured proxy fact。

8. 生成 agent evidence slice  
   按 PM / Macro / Commodity / Company / Risk 切分证据。  
   目的：解决同队开局信息卡复制问题。

9. 接入 roundOpeningBrief  
   让 10 张开局信息卡读取 agent evidence slice。  
   目的：让每名 agent 有不同证据和任务。

10. 更新 Web human audit  
    显示每名 agent 的证据卡和引用证据。  
    目的：人工审计能直接看到“谁拿了什么数据，负责什么问题”。

11. 增加验证  
    跑 finance evidence validate、相关 core/action/web 测试和 typecheck。  
    目的：确保事实库、证据包和审计投影没有断链。

12. 生成 N50 样本  
    至少生成 Dust2 有色 R1-R6 的 fact bank 和 evidence pack，并抽样说明与旧 configured proxy fact 的差异。  
    目的：证明用户准备的接口真的进入可消费事实层。

## 7. 预期改动清单

预计新增：

```text
tools/finance-data/README.md
tools/finance-data/collectors/fred_*.py 或 .mjs
tools/finance-data/collectors/baostock_*.py
tools/finance-data/collectors/comtrade_*.py（可选）
data/materials/generated/finance/fact-bank/
docs/finance/n50-offline-finance-fact-bank-plan.md
```

预计修改：

```text
data/materials/scripts/generate-finance-evidence.mjs
data/materials/scripts/validate-finance-evidence.mjs
packages/core/src/hex-engine/finance/hex-round-finance-duel.ts
packages/core/src/hex-engine/action/hex-round-opening-brief.ts
apps/web/app/server-hex-match-lab.ts
apps/web/app/hex-lab/match/hex-match-audit-drawer.tsx
docs/current/current-state.md
docs/current/priority-roadmap.md
docs/finance/README.md
docs/finance/finance-data-asset-contract.md
docs/finance/finance-major-prototype-plan.md
```

预计不动：

```text
Phase18 replay / live replay
Hex map/path/state/combat/economy/win-condition 规则
DB schema
Node/Sector archive
data/materials/processed/maps/dust2/hex/dust2-hex-map.json
```

## 8. 风险、未知项与替代方案

风险：

- FRED API 可用，但不同 series 的频率和缺值处理需要统一。
- BaoStock 可用，但估值字段和行情字段可能不全。
- UN Comtrade 调用可能慢、限额或字段复杂。
- 离线事实库如果太大，会重新污染 prompt。
- 事实切片如果太机械，agent 仍会输出同质内容。
- 采集器写得太急，可能把 collector 当 source，破坏审计边界。

控制策略：

- N50 第一版只做低频快照，不做高频更新。
- fact bank 存完整低频数据，prompt 只拿摘要。
- 每个事实必须保留 source、collector、period、value、unit、hash、limitation。
- AKShare 第一版默认只登记，不强制启用。
- UN Comtrade 失败不阻塞主路径，但必须写 source warning。
- agent slice 必须按角色选择不同证据，而不是全队共享同一段文本。

替代方案：

- 如果 Python collector 集成成本高，先用用户已跑通脚本输出 CSV/JSON，再写标准化 converter。
- 如果 BaoStock 估值字段不稳定，第一版只用行情、收益率、成交量和 turnover。
- 如果 Comtrade 不稳定，N50 先把它保留为 optional missingEvidence，不包装成已用事实。
- 如果事实库太大，先只生成 R1-R3，R4-R6 保留 configured proxy fact 并明确标记。

禁止尝试：

- 不让 agent 临场调用 API。
- 不把 API key 写入仓库。
- 不提交 raw PDF 或大体积网页全文。
- 不用 LLM 编造缺失数据。
- 不把 configured proxy fact 冒充 live observation。
- 不把 AKShare 当作最终事实源。
- 不隐藏 missingEvidence 和 scoreCaps。

## 9. 自动化验证

N50 必跑：

```powershell
node data/materials/scripts/validate-finance-evidence.mjs
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/finance/hex-round-finance-duel.test.ts packages/core/src/hex-engine/action/hex-round-opening-brief.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

如果新增 Python collector：

```powershell
<项目指定 Python> tools/finance-data/collectors/<collector>.py --dry-run
```

验证要求：

- 不打印 API key。
- collector 失败时返回明确错误和 source warning。
- generated fact bank 里没有 secret。
- generated evidence pack 至少有真实 value 或明确 unavailable reason。
- agentOpeningBrief 里 10 名 agent 的 `roleQuestionZh / usableFactsZh / evidenceRefs` 不应全相同。

## 10. 人工验收流程

成功路径：

1. 运行金融事实库生成脚本。
2. 打开 generated fact bank。
3. 检查 FRED / BaoStock 至少有一批真实观测值或明确快照值。
4. 打开 round evidence pack。
5. 检查每个 round 有事实、缺失证据、评分上限。
6. 新建 Hex 金融验收比赛。
7. 跑 1 个 round。
8. 打开 Web 审计。
9. 检查 10 名选手开局信息卡：
   - 同队 5 人不再完全相同。
   - 每名 agent 有自己的证据切片。
   - 能看到 factId / evidenceId。
10. 检查裁判解释：
    - 哪条证据被采信。
    - 哪条缺失证据导致降权。
    - 为什么某个质疑成立或自证守住。

失败路径：

- 证据包仍全是 `configured_proxy_fact`。
- value 仍全是 `null` 且没有 unavailable reason。
- 10 名 agent 开局信息卡仍是同队复制。
- Web 看不到 agent 引用的具体证据。
- 裁判仍只看文本自信程度，不看 evidenceRefs。
- API key 或 raw secret 出现在 artifact / docs / generated materials。

边界路径：

- UN Comtrade 不可用时，系统应显示 optional source warning，而不是失败或假装有数据。
- AKShare 未启用时，应显示 collector registered but unused。
- 旧 trace 没有 fact bank 时，Web 应显示“旧 trace 仅配置型代理事实”，不能崩。

## 11. 阻塞性问题

当前无产品阻塞。

执行前需要确认的非阻塞点：

- 本地 Python 环境路径是否固定使用 `B:\sharewithlight\LegendProject\.venv`，还是另建 `tools/finance-data/.venv`。
- UN Comtrade 第一版是否必须启用，还是只保留 optional。
- BaoStock 第一版是否只采 coreUniverse 5 家，还是扩大到 10 家。

默认建议：

```text
FRED + BaoStock 作为 N50 必通主路径。
UN Comtrade optional。
AKShare registered only。
coreUniverse 先用 5 家，跑通后再扩到 10 家。
```

## 12. 最小化与回滚策略

最小化策略：

- 第一版只做 Dust2 有色 / 行业判断。
- 第一版只做低频快照，不做定时任务。
- 第一版只保证 FRED + BaoStock 主路径。
- 第一版只把事实库接到 opening brief，不改 combat 权重。
- 不修改 DB schema。

回滚策略：

- 如果 collector 不稳定，保留 source registry 和 configured proxy fact，不阻塞现有比赛。
- 如果 fact bank 太大，保留 fact bank，回退 prompt 只引用 promptFacts 摘要。
- 如果 agent slice 设计不理想，回退到 Web-only 展示，不影响 core action。
- 如果 Web 审计变复杂，保留 technical details，隐藏新证据切片面板。

## 13. 下一步交付物

N50 交付：

1. 离线金融事实库契约。
2. FRED / BaoStock 主路径采集器或标准化转换器。
3. 可选 UN Comtrade 状态记录。
4. Dust2 有色 R1-R6 fact bank 快照。
5. 从 fact bank 生成的 round evidence pack。
6. agent evidence slice。
7. 差异化 agentOpeningBrief。
8. Web 中文审计展示每名 agent 证据切片。
9. 验证命令和样本说明。
10. 单独本地提交，排除 live replay 与 `.next-dev` 日志。

N50 完成后再评估：

- N51：金融裁判样本质量专项。
- N52：小地图人工验收质量门槛。
- N53：第二张行业地图，例如 TMT 或消费。
