# Phase 2.0-pre HexGrid N35-N37 计划：商业攻防裁判与真实对局质量收口

## 1. 目标

本计划覆盖 **N35-N37**，目标不是继续打磨临时 UI，也不是把 HexGrid 改成普通 CS 模拟器，而是把项目核心重新拉回正确口径：

```text
大主题地图
-> 一张地图固定 6 个小主题
-> 上半场逐 round 使用主题 1-6
-> 下半场换边后复用同一组主题
-> 守方基于自身商业资产生成该小主题下的自证
-> 攻方基于自身商业资产生成对应质疑
-> agent 的 CS 行动承载自证/质疑
-> 战斗裁判判断自证驳回质疑，或质疑成功
-> 局部裁定物化为击杀、受伤、压制、逼退和区域控制变化
-> 总裁判仍只根据 hard condition（硬条件）裁定 round winner（回合胜负）
```

当前 Hex 已能跑图、提交回合、展示 Web 验收台，但仍存在几个会影响数据集可信度的问题：

- 商业证据仍是每 phase（阶段）的单句 `businessIntent`，不是回合级自证/质疑。
- 队伍材料资产尚未完整进入 Hex round / phase 请求。
- 战斗裁判虽然有 `65 business / 35 CS` 结构，但 business 部分仍偏关键词。
- KDA（击杀/死亡/助攻）归因不可信，IGL（指挥）异常吃击杀。
- 小地图验收比分和路线重复，真实 LLM（大语言模型）对局变化不足。
- Web 审计还不能直接让用户抽样看到 LLM 原文、商业攻防文本、战斗裁判和总裁判链路。
- 输出稳定性和识别稳定性不足：LLM 输出、规范化字段、裁判读取字段必须有稳定 schema（结构契约）和稳定识别规则，不能依赖临时文本猜测。
- 前端选手栏里 KDA 仍不够突出；经济展示应统一为 `当前经济 /（本局花费）`。

N35-N37 的目标是按依赖顺序收口这些问题，而不是一次性混在一个巨大补丁里。

## 2. 成功标准

N35 完成后：

- 每 round 生成一次 `HexRoundBusinessDuel`。
- 守方输出 `defenseProof`（防守自证），攻方输出 `attackChallenge`（进攻质疑）。
- `HexRoundBusinessDuel` 引用队伍 `initial-proposal`、教练上下文、角色职责、经济态势和当前 round 的六主题映射。
- phase agent request（阶段选手请求）消费 round-level proof/challenge，不再让每个 phase 临时生成商业计划。
- fallback（降级）文本不再作为正向 business evidence（商业证据）。
- `HexRoundBusinessDuel` 输出必须稳定：字段名、枚举值、teamId、agentId、subthemeId、proofId、challengeId 都要可重复识别；乱码或缺必填字段必须 fail，不能猜。

N36 完成后：

- Combat resolver（战斗裁定器）以 proof/challenge adjudication（自证/质疑裁定）为 business 核心。
- 战斗结果明确记录：
  - `businessVerdict`: `proof_rebutted_challenge` 或 `challenge_succeeded`
  - `killerAgentId`
  - `targetAgentId`
  - `assisterAgentIds`
  - `businessReasons`
  - `csReasons`
- KDA 只能来自 combat trace（战斗轨迹），不能由 Web 继续猜测。
- RoundReport（回合报告）的 kill ledger（击杀账本）来自 combat trace。
- Combat trace 的输出必须稳定：`businessVerdict / killerAgentId / targetAgentId / assisterAgentIds` 等字段必须有 schema 测试，Web 只能按这些字段识别。

N37 完成后：

- real provider 小地图验收不再长期稳定复现同一 `2:4` 结构。
- 同一小主题下允许相似战术，但同一地图内不能 10+ round 路线高度一致。
- LLM 输出结构错误，例如单元素 `actions[]`，有明确规范化或拒绝策略。
- LLM 输出识别稳定：同一合法语义不能因为轻微字段顺序、单元素 `actions[]`、可修复 id 字段而随机 accepted/rejected；不可修复字段必须稳定 rejected。
- Web 审计面板能抽样展示：
  - round proof/challenge
  - LLM 原始输出
  - normalized action（规范化行动）
  - 战斗裁判 business / CS 分
  - 总裁判 hard condition
- Web 选手栏把 KDA 作为核心战绩信息高亮显示；经济行统一显示 `经济：当前经济 /（本局花费）`。

全部阶段共同保持：

- LLM 不能写最终胜负、击杀、伤害、经济变化或数据库事实。
- 前端不能伪造 HP、枪械、伤害、敌人真实位置或 winner（胜负）。
- 不恢复旧 Node/Sector runtime（节点/区块运行时）。
- 不削减 Phase18 replay / live replay（回放 / 实时回放）兼容线。

## 3. 已知上下文与初步判断

当前阶段：

| 阶段 | 当前状态 | 本计划定位 |
|---|---|---|
| N20-N24 | 完成 | 地图、资产、路径、AP 基础保持 |
| N25 | 完成 | phase memory 作为事实输入 |
| N26 | 完成 | agent command harness 需接入 round business duel |
| N27 | 完成 | combat resolver 需升级 business 裁定 |
| N28 | 完成 | economy context 作为 proof/challenge 证据 |
| N29 | 完成 | round commit 保持 hard winner 来源 |
| N30 | 完成 | map runner 继续薄调用 N29 |
| N31 | 完成第一版 | Web 验收台继续作为审计入口 |
| N32-N34c | 完成第一轮 | 结构和旧 Node/Sector 清理保持 |
| N35 | 未完成 | 商业自证/质疑 round 层 |
| N36 | 未完成 | 战斗裁判与 KDA 事实化 |
| N37 | 未完成 | real LLM 对局质量与 Web 审计 |

已确认事实：

- 最新 real rounds 中，LLM 确实输出了 `businessIntent`，但这是 action 级字段。
- Hex phase request 当前包含地图、记忆、经济、战术变体、目标候选，但没有完整接入 `initial-proposal`、coach context、player directive 和角色职责材料。
- Combat resolver 当前有 `businessWeight = 65`、`csWeight = 35`，但 business scoring 主要看文本存在、推进动作、团队动作、攻守关键词和上一阶段摘要。
- 当前 combat casualty 记录没有 killer / assist，Web KDA 是推断，导致 IGL 异常吃击杀。
- 小地图多次出现 `2:4`，路线和目标选择重复，主要来自确定性战术变体、固定队伍/经济起点、低温度和有限随机层。

初步判断：

- N35 必须先建 round-level business duel（回合级商业攻防），否则 N36 的战斗裁判没有正确业务输入。
- N36 必须先修战斗事实和 KDA，否则 N37 再看真实质量会被错误击杀归因污染。
- N37 才处理真实 LLM 对局多样性和 Web 抽样审计，不应提前用 UI 假装真实。

## 4. 范围边界

In scope：

- 新增 Hex round-level business proof/challenge 层。
- 接入队伍材料资产到 Hex round business duel。
- 战斗裁判改为围绕自证/质疑做 business 判断。
- 修复击杀归因和 KDA 数据来源。
- 增强 real LLM 输出规范化、对局多样性和 Web 审计展示。
- 更新文档和测试。

Out of scope：

- 不把 Hex 改成纯 CS 微观模拟器。
- 不让 LLM 写 winner、kills、damage、economyDelta 或 DB fact。
- 不让 Web 伪造 HP、枪械、伤害或敌人真实位置。
- 不删除 Phase18 replay/live replay。
- 不恢复旧 Node/Sector。
- 不做 DB 字段大迁移，除非单独批准。
- 不运行 `pnpm install`。

## 5. 技术实现路径

### N35：Hex Round Business Duel（回合级商业攻防）

新增模块建议：

```text
packages/core/src/hex-engine/business/hex-round-business-duel.ts
packages/core/src/hex-engine/business/hex-round-business-duel.test.ts
packages/core/src/hex-engine/business/index.ts
```

核心类型：

```ts
HexRoundBusinessDuel
HexTeamBusinessProof
HexTeamBusinessChallenge
HexRoundSubtheme
HexAgentBusinessAssignment
```

稳定输出要求：

- 所有核心 id 必须来自代码给定上下文，不允许 LLM 自造。
- `defenseProof`、`attackChallenge`、`agentAssignments` 使用固定字段和枚举。
- business duel artifact（商业攻防产物）必须能被 Web 和 combat resolver 直接读取，不依赖自然语言二次猜测。
- 输出缺失必填字段、中文编码损坏或 team/agent id 不可识别时，该 round business duel 必须 fail。

数据来源：

- `data/materials/processed/teams/<team-slug>/initial-proposal.json`
- agent role profile（角色档案）
- coach context（教练上下文）
- economy context（经济上下文）
- Dust2 Hex map proposition / semantic regions（地图命题 / 语义区域）
- round number -> 六主题半场映射：R1/R7 同主题，R6/R12 同主题，攻防互换

行为：

- 每 round 只生成一次。
- defense 生成自证：本小主题下如何证明己方商业计划成立。
- attack 生成质疑：本小主题下如何攻击守方计划缺口。
- 每个 agent 获得自己的 proof/challenge assignment。
- phase request 只引用这个 round duel，不再要求 agent 临场发明商业总计划。

### N36：Combat Business Adjudication（战斗商业裁判）

修改模块：

```text
packages/core/src/hex-engine/combat/**
packages/core/src/hex-engine/round/**
packages/core/src/hex-engine/commit/hex-round-report-bridge.ts
apps/web/app/server-hex-match-lab.ts
```

核心变化：

- Combat resolver 输入增加 `businessDuel`。
- business score 不再主要依赖关键词，而是评估：
  - 当前 contact（交火）涉及哪些 proof/challenge claim。
  - agent 行动是否有效承载本方自证/质疑。
  - 对方是否提供了有效反驳或击穿。
  - CS 证据是否支撑该商业裁定。
- 输出 `businessVerdict`。
- casualty materializer 输出真实 kill attribution（击杀归因）。
- Web KDA 和 RoundReport killLedger 只消费 trace。
- Combat output 使用稳定 schema，前端不得从文本 reason 里反推 killer、winner 或 businessVerdict。

### N37：Real LLM Quality and Audit（真实 LLM 对局质量与审计）

修改模块：

```text
packages/core/src/hex-engine/action/**
packages/core/src/hex-engine/round/**
apps/web/app/hex-lab/match/**
apps/web/app/server-hex-match-lab.ts
```

核心变化：

- 明确 `actions[]` 单元素输出是否规范化为一个 action；若允许，必须审计 `repaired_single_action_array`。
- 引入可审计 random seed（随机种子）和 strategy variance（战术变化）层，避免路线高度重复。
- 调整 LLM request，不激进压缩，但要突出：
  - 当前小主题
  - 我方 proof/challenge
  - 该 agent 的商业攻防职责
  - 可选 CS 承载方式
- Web 增加抽样审计：
  - LLM 原文
  - normalized action
  - proof/challenge 片段
  - combat business verdict
  - final hard condition
- Web player card（选手卡）展示收口：
  - KDA 高亮，优先级高于普通行动说明。
  - 当前回合击杀星标仍可保留，但不能替代累计 KDA。
  - 经济统一为 `当前经济 /（本局花费）`，例如 `经济：2200 /（700）`。
  - 状态颜色保持：存活绿色、受伤黄色、阵亡红色。

## 6. 分阶段执行步骤

1. N35 基线检查
   记录 `git status --short`，确认 live replay 和 `.next-dev` 无关文件不混入。

2. N35 定义 business duel contract
   先写文档和类型，明确自证/质疑不是“兑现计划”，并锁定稳定输出字段。

3. N35 接入 materials adapter
   从 team / agent 材料读取最小必要字段，生成 compact context。

4. N35 实现 round business duel builder
   每 round 生成 defenseProof / attackChallenge / agentAssignments。

5. N35 注入 phase request
   agent phase request 只消费 round duel assignment 和小主题。

6. N36 补 combat business tests
   用 fixture 验证：自证驳回质疑、质疑成功、fallback 不加正向 business。

7. N36 改 combat resolver
   输出 businessVerdict、businessReasons、csReasons、killerAgentId / targetAgentId / assisterAgentIds。

8. N36 改 RoundReport / Web KDA
   停止 Web 推断击杀，全部来自 combat trace。

9. N37 补 real LLM normalization tests
   覆盖单元素 `actions[]`、错误字段、拒绝路径、稳定识别和 artifact 审计。

10. N37 引入可审计变化层
    round strategy variant 与六主题半场映射绑定，并加入 seed / variance audit。

11. N37 增强 Web 审计
    让用户能直接抽样看到 LLM 写了什么、裁判为什么这么判。

12. N37 收口选手栏战绩展示
    KDA 高亮显示，经济统一为 `当前经济 /（本局花费）`。

13. 自动验证与提交
    每个 N 单独验证、单独提交，避免业务裁判、击杀归因和 Web 审计混成不可回滚大改。

## 7. 预期改动清单

N35 预计新增/修改：

```text
packages/core/src/hex-engine/business/**
packages/core/src/hex-engine/action/hex-agent-command-boundary.ts
packages/core/src/hex-engine/round/hex-round-runner.ts
packages/core/src/hex-engine/commit/hex-round-commit-context.ts
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/hex/phase-2.0-pre-prompt-contract.md
```

N36 预计新增/修改：

```text
packages/core/src/hex-engine/combat/**
packages/core/src/hex-engine/round/**
packages/core/src/hex-engine/commit/hex-round-report-bridge.ts
apps/web/app/server-hex-match-lab.ts
apps/web/app/hex-lab/match/**
```

N37 预计新增/修改：

```text
packages/core/src/hex-engine/action/**
packages/core/src/hex-engine/round/**
apps/web/app/hex-lab/match/**
apps/web/tests/hex-match-lab.test.ts
docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
```

预计不动：

```text
packages/core/src/phase18/**
apps/web/app/live-replay-player.tsx
apps/web/app/live-replay-player.module.css
旧 Node/Sector runtime
DB schema
```

## 8. 风险、未知项与替代方案

风险：

- business duel 如果设计过重，会拖慢 real LLM 调用。
- 材料资产接入太多会让 prompt 过长。
- 战斗裁判改动会影响 KDA、RoundReport 和 Web。
- 允许 `actions[]` 规范化可能掩盖模型不遵守格式的问题。
- 战术变化过强可能让数据集变得不可复现。
- 识别规则如果太宽，会把坏输出误认成合法；如果太窄，会让语义正确但格式轻微偏差的真实 LLM 输出被无意义拒绝。

控制策略：

- N35 只接 compact materials，不塞完整文档。
- N36 保持 hard winner 不变，只改局部 combat verdict 和 kill attribution。
- N37 所有随机/变化必须带 seed 和 audit。
- `actions[]` 只允许单元素且字段合法，必须记录 repair。
- 输出稳定性优先靠 schema、必填字段和明确 repair reason，不靠模糊自然语言匹配。

替代方案：

- 如果 real LLM 成本过高，N35 先用 fixture builder 生成 business duel，再开放 real。
- 如果 materials adapter 复杂，先接 `initial-proposal` 摘要和 agent role responsibilities。
- 如果 KDA trace 改动过大，先让 Web 显示“击杀归因不可用”，不再猜测。

禁止尝试：

- 不把“计划兑现”当核心口径。
- 不把 fallback 文本当正向商业论证。
- 不用前端假数据修 KDA。
- 不让 LLM 直接写击杀或最终胜负。
- 不为了路线变化用不可审计随机数。

## 9. 自动化验证

N35 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/business/hex-round-business-duel.test.ts packages/core/src/hex-engine/action/hex-agent-command-boundary.test.ts packages/core/src/hex-engine/round/hex-round-runner.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

N35 新增测试场景：

```text
business duel 输出字段稳定。
缺少 defenseProof / attackChallenge 必须 fail。
agentId / teamId 自造必须 fail。
中文编码损坏必须 fail。
```

N36 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/combat/hex-combat-resolver.test.ts packages/core/src/hex-engine/combat/hex-combat-events.test.ts packages/core/src/hex-engine/commit/hex-round-report-bridge.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

N36 新增测试场景：

```text
combat trace 必须稳定输出 businessVerdict / killerAgentId / targetAgentId。
Web KDA 只能从 combat trace 读取。
缺 kill attribution 时 Web 不得猜测。
```

N37 必跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/action/hex-agent-command-harness.test.ts packages/core/src/hex-engine/round/hex-round-runner.test.ts packages/core/src/hex-engine/map-runner/hex-map-experimental-runner.test.ts
node node_modules/vitest/vitest.mjs run apps/web/tests/hex-match-lab.test.ts
cd apps/web
node node_modules/next/dist/bin/next build
```

N37 新增测试场景：

```text
单元素 actions[] 可稳定识别或稳定拒绝。
同一类错误不会在不同 phase 随机 accepted/rejected。
选手栏 KDA 高亮。
经济格式为 当前经济 /（本局花费）。
```

全阶段至少补充：

```powershell
node node_modules/vitest/vitest.mjs run packages/core/src/hex-engine/architecture-boundary.test.ts packages/shared/src/schemas.test.ts
node node_modules/typescript/bin/tsc -b packages/shared packages/db packages/llm packages/queue packages/materials packages/core packages/cli
```

## 10. 人工验收流程

N35：

1. 打开 `/hex-lab/match`。
2. 新建 Hex 验收比赛。
3. 跑一回合 fixture 或 real。
4. 检查 trace 中存在 round-level business duel。
5. 应看到本 round 小主题、守方自证、攻方质疑、agent assignment。
6. phase action 只是在承载自证/质疑，不再临场发明总商业计划。
7. business duel 字段稳定，不能出现自造 agentId / teamId 或编码损坏。

失败现象：

- 仍只有 `businessIntent` 单句。
- 队伍材料资产没有进入 round business duel。
- fallback 文本被当成正向商业计划。

N36：

1. 跑一回合 real 或 fixture。
2. 打开 combat audit。
3. 每个 kill / wound 应能追溯：
   - 谁质疑成功或谁自证驳回质疑。
   - 哪个 agent 击杀了谁。
   - 哪些 CS 证据支持裁定。
4. Web KDA 应与 combat trace 一致。
5. Combat trace 字段稳定，Web 不需要解析自然语言 reason 才能显示击杀归因。

失败现象：

- IGL 因 participant 排序继续吃击杀。
- Web 仍自行猜 killer。
- Combat 只显示 business_intent_present 这类浅理由。

N37：

1. 连跑多个 6 回合半场窗口或 12 回合完整换边窗口。
2. 查看比分、路线、proof/challenge 和 LLM 输出。
3. 应看到同一小主题内有一致性，但不应 10+ round 高度重复。
4. Web 可以抽样展示 LLM 原文、规范化行动、战斗裁判和总裁判。
5. 选手栏 KDA 更醒目，经济显示为 `当前经济 /（本局花费）`。

失败现象：

- 仍固定 `2:4` 且路线高度一致。
- 用户无法看到 LLM 到底写了什么。
- 总裁判来源不清楚。

## 11. 阻塞性问题

当前无阻塞问题。

执行前需要默认确认：

- 用户已明确核心口径是商业计划攻防，不是“计划兑现/履约”。
- N35 优先做 round-level proof/challenge，不继续在每 phase `businessIntent` 上堆复杂度。
- N36 之前不应继续相信当前 Web KDA。

## 12. 最小化与回滚策略

- N35 如果 real business duel 成本过高，先用 deterministic builder（确定性构造器）和材料摘要生成。
- N36 如果 kill attribution 影响大，先禁用 Web 推断 KDA，显示 trace 不足，再补 trace。
- N37 如果路线变化影响可复现性，保留 seed 固定和 replay audit。
- 如果输出识别规则争议过大，先走严格 schema fail，不做模糊容错。
- 每个 N 单独提交，任何失败不回滚已完成 Hex 跑图和 Web 验收能力。

## 13. 下一步交付物

N35：

- `HexRoundBusinessDuel`。
- 六主题半场映射。
- defenseProof / attackChallenge。
- 队伍材料资产 compact adapter。
- phase request 消费 proof/challenge。
- 稳定输出 schema 与识别失败规则。

N36：

- proof/challenge 战斗裁判。
- killer / target / assister trace。
- KDA 与 killLedger 事实化。
- Web 不再猜击杀。
- 稳定 combat trace 字段。

N37：

- real LLM 输出规范化策略。
- 可审计战术变化与 seed。
- Web 抽样审计面板。
- KDA 高亮信息层级。
- 经济显示 `当前经济 /（本局花费）`。
- 小地图质量验收报告。
