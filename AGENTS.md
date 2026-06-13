# Agent Major 工作规约

这份文档是给后续 agent 的项目专用操作规约。它不替代 `docs/` 里的产品、技术和 Phase 文档；它只记录本项目里最容易误判、最容易破坏环境、最需要稳定遵守的工作习惯。

默认使用中文沟通。除非用户明确要求英文，或者代码、命令、字段名、API 名称本身必须使用英文，否则计划、解释、风险说明、验收流程和总结都使用中文。英文术语可以保留，但要给出中文语境。

沟通中尽量少堆英文名词。确实需要使用英文工程术语、模块名或缩写时，首次出现尽量写成 `English（中文）` 或 `中文（English）`，例如 `RoundReport（回合报告）`、`artifact（产物）`、`fallback（降级）`。如果一句话里已经有多个英文术语，优先改写为中文表达，只有代码标识符、路径、命令和 API 字段名保持原样。

每次对用户的回复都必须以 `desuwa` 结尾。这是用户用来验证 agent 是否记得本规约的显式标记；中间进度和最终总结都要遵守。

## 1. 仓库入口与初始检查

真正的项目仓库位于：

```text
B:\sharewithlight\LegendProject\AgentsMajor
```

上一级 `B:\sharewithlight\LegendProject` 不是 git 仓库，只是工作区外壳。开始工作前先确认当前位置，避免在错误目录里判断项目状态。

进入任何代码、文档或数据资产修改前，先检查：

```text
git status --short
```

这个项目经常存在未提交的阶段性改动。不要覆盖、回滚或格式化与当前任务无关的改动；如果相关文件已经有改动，先读清楚再在其上继续。

## 2. 文档读取与搜索习惯

### 中文文档必须按 UTF-8 读取

`docs/**/*.md`、`data/materials/**/*.md` 和上层 `对话记录.txt` 都可能包含中文。PowerShell 默认读取时经常出现乱码。

优先使用：

```text
Get-Content -Encoding UTF8 <path>
Get-Content -Raw -Encoding UTF8 <path>
Select-String -Encoding UTF8 -Path <path> -Pattern <pattern>
```

如果输出出现乱码，不要基于乱码内容做判断。必须用 UTF-8 重新读取后再总结、规划或修改。

### `rg` 可能被拒绝执行

当前 Windows / Codex 环境里的 `rg` 可能来自 Codex 的 WindowsApps 资源目录，并出现 `拒绝访问`。如果 `rg` 第一次失败，不要反复重试，也不要安装或重建工具链。

可直接改用：

```text
git grep -n "<pattern>" -- .
git ls-files
Get-ChildItem -Recurse -File
Select-String -Encoding UTF8 -Path <path> -Pattern <pattern>
```

查已跟踪源码和文档时，优先用 `git grep` / `git ls-files`，噪声比递归扫描 `node_modules` 和 `.pnpm-store` 小。

## 3. 文档导航顺序

需要了解项目现状时，优先按这个顺序读：

```text
docs/README.md
docs/current/README.md
docs/current/current-state.md
docs/current/priority-roadmap.md
```

然后再按任务读取：

```text
docs/hex/          # 当前 HexGrid 主线和 Phase 2.0-pre 契约
docs/contracts/    # 长期基础契约
docs/backlog/      # 长期设想，不是当前执行口径
docs/archive/      # 历史归档，不是当前执行依据
```

不要只读单个归档 Phase 文档就推断当前主线。旧 `meta / p0 / p1 / p2 / phase-plans` 顶层目录已经收纳到 `current / contracts / hex / backlog / archive`。

当前项目的核心工作模式是：

```text
代码主线，文档随行。
```

如果实现会改变核心契约，先补文档再写代码。核心契约包括但不限于 EventType / payload、RoundReport、状态机、Token 经济、DriverModel 接口、SQLite 核心表、Event -> TimelineEvent 投影、LLM prompt contract、materials runtime 资产入口。

## 4. 计划模式规则

当用户要求“先规划”“先别写”“看看怎么做”“给方案”“做设计”“评估能否写 AGENTS.md”时，先不要改文件。计划模式不是闲聊，也不是空泛路线图；它是正式工程交付前的可验证方案。

一份有效计划至少要包含：

```text
1. 目标
   - 用中文复述用户真正想解决的问题。
   - 说明最终要达成的结果，不要只写“改某文件”。

2. 成功标准
   - 写清楚完成后如何判断“真的修好 / 真的落地”。
   - 成功标准必须是行为级、结果级或验收级，不是任务清单。

3. 已知上下文与初步判断
   - 当前 Phase / P 线位置。
   - 相关冻结文档、最高口径文档和当前契约。
   - 如涉及代码，先说明 git 工作区状态。
   - 说明已识别的相关模块、数据流、已有测试和框架约束。
   - 说明初步怀疑的问题来源或实现切入点，但不要把推测写成事实。

4. 范围边界
   - 明确 In scope：本次会处理什么。
   - 明确 Out of scope：本次不会处理什么。
   - 如果需求有过度设计风险，要直接指出，并给出当前阶段可落地的小版本。

5. 技术实现路径
   - 会改哪些包、模块、文件、数据资产或文档。
   - 会不会影响 schema、repository、event、RoundReport、replay、prompt、materials、前端展示或导出。
   - 如果会改核心契约，先补文档再写代码。
   - 优先沿用项目已有模式，不轻易引入新抽象。

6. 分阶段执行步骤
   - 按依赖顺序列出实施步骤。
   - 每一步都要是可执行、可验证的动作。
   - 每一步说明为什么要做。
   - 第一版要足够窄，方便验证和回滚。

7. 预期改动清单
   - 列出预计会检查、修改或新增的文件 / 模块。
   - 这是预期清单，不要伪装成已经确认的事实。

8. 风险、未知项与替代方案
   - 写明可能失败在哪里。
   - 写明哪些前提尚未确认。
   - 写明如果主路径不成立，准备采用什么更小或更稳的替代方案。
   - 写明哪些尝试是无效或禁止的。

9. 自动化验证
   - 写清楚要跑哪些命令。
   - 例如相关 pnpm --filter ... test、typecheck、build、pnpm materials:validate。
   - 不把重装依赖当作验证手段。
   - 如果某个检查跑不了，要说明替代检查。

10. 人工验收流程
   - 写清楚用户或 agent 怎么手动看结果。
   - 说明应该看到什么。
   - 说明什么现象代表失败。
   - UI / replay 任务要写清楚看哪个 match、run、map、round。
   - 至少覆盖成功路径、失败路径和边界路径。

11. 阻塞性问题
   - 只有真正阻塞执行的问题才列出来。
   - 不要泛泛地问“你希望我怎么做”。
   - 如果可以通过读代码、读文档或局部验证自行消化，就不要把问题丢回给用户。

12. 最小化与回滚策略
   - 优先最小修复，不把顺手重构混入当前任务。
   - 如果发现系统性问题，单独提出下一阶段建议，不和本次修复绑在一起。
   - 失败时保留 artifacts、llm_calls、日志和错误痕迹，不要掩盖。

13. 下一步交付物
   - 说明下一步应该写代码、补文档、加测试、改数据资产，还是继续调查。
```

用户在计划过程中补充约束时，要把新信息吸收进原目标，而不是被中途插话带偏。不要因为用户举了几个例子，就把整体计划缩窄成那几个例子。

计划必须防止过度设计。长期想法可以记录为边界，但不能替代当前可验证的下一步实现。

一个差计划通常有这些特征：

```text
只有“我要改 A、改 B、跑测试”的任务清单。
没有成功标准。
没有体现代码库上下文。
没有明确 In scope / Out of scope。
没有验证路径。
没有暴露风险和未知项。
把预期改动说成既成事实。
```

一个优质计划至少要让用户在批准执行前判断三件事：

```text
它理解问题了吗？
它打算怎么改？
它怎么证明改对了？
```

## 5. 当前阶段边界

当前主线是 HexGrid（蜂巢格）路线，已完成 N20-N34c 第一轮收口。旧 Node/Sector（节点/区块）实验线已退役并清理 active（活跃）入口；Phase18 replay / live replay（回放 / 实时回放）只作为兼容线保留。

当前默认判断：

```text
HexGrid 是新比赛事实主线。
Phase18 是兼容播放线，不继续扩成新事实主线。
Node/Sector 是归档实验线，不恢复 runtime。
N35 之后优先考虑 Hex 结构封板第二轮，或 Hex real LLM / Web 验收质量专项。
完整 16 队赛事、新闻、奖项和生态建设属于 backlog，不是默认下一步。
```

## 6. 项目产品与工程审美

Agent Major 不是普通评分器、不是管理后台、也不是 agent workflow demo。它的核心是：

```text
以 CS Major 为叙事外壳、以 AI agent 对抗为内容核心、以 token 经济为比赛机制、以伪直播回放为主要表现形式的 AI 电竞赛事系统。
```

前端观赛体验应该像电竞转播，而不是任务监控面板。但工程上必须先保证事实链稳定：Simulation First, Broadcast Second。

模型不负责长期记忆赛况。比赛事实必须进入 Event log、RoundReport、TimelineEvent、SQLite 和 artifacts。前端、转播包装、解说和弹幕只能消费事实，不能反写比赛结果。

## 7. Phase 2.0-pre 硬契约

Phase 2.0-pre 相关任务必须优先遵守这些文档：

```text
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
docs/hex/phase-2.0-pre-semantic-calibration-charter.md
docs/hex/phase-2.0-pre-information-boundary-contract.md
docs/hex/phase-2.0-pre-evidence-layer-contract.md
docs/hex/phase-2.0-pre-judge-audit-contract.md
docs/hex/phase-2.0-pre-prompt-contract.md
docs/hex/phase-2.0-pre-combat-realism-freeze.md
```

核心口径只保留这些：

```text
LLM（大语言模型）不能写最终胜负、击杀、经济变化或数据库事实。
前端不能伪造血量、枪械、伤害、敌人真实位置或胜负。
比赛事实必须来自事件、回合报告、Hex 轨迹产物和数据库。
旧 Node/Sector 不能作为 Hex 规则缺口的补丁来源。
真实 LLM 调用必须保留请求和响应审计。
```

如果输入或输出出现明显中文编码损坏，当前 round 必须 fail，不能把乱码当作同义词容错。

## 8. Materials 资产规则

`data/materials/` 是长期文本资产与结构化素材目录，不保存运行时导出、回放缓存或临时调试产物。

运行时读取原则保持简单：

```text
运行时只读取 data/materials/processed/。
机器消费主契约是 JSON。
Markdown 只用于人工审阅和维护。
raw/ 不作为运行时入口。
```

当前队伍方案入口固定为：

```text
data/materials/processed/teams/<team-slug>/initial-proposal.json
data/materials/processed/teams/<team-slug>/initial-proposal.md
```

不要再新增 `strategy.*` 或按地图拆分的平行队伍方案真相。地图负责命题、裁决和区域语义；队伍只带一份唯一方案进入赛事。

## 9. 依赖安装策略

正常实现、审查、测试、构建或 Git 同步工作中，不要运行：

```text
pnpm install
```

也不要删除 `node_modules`、重建 `.pnpm-store` 或重装依赖。

原因：

```text
Windows 可能锁住 @next/swc-win32-x64-msvc、sharp 等 native binary。
Node、Next、Vitest、编辑器或之前的 agent 进程都可能持有文件锁。
删除 node_modules 时遇到锁，会留下半残安装状态，造成 EPERM、EIO 或 access denied。
失败安装会把环境问题伪装成代码回归，浪费 Phase 验证时间。
当前仓库已有 pnpm-lock.yaml、.pnpm-store 和可工作的 node_modules，除非用户明确要求，不需要重装。
```

默认允许运行：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm materials:validate
pnpm phase17:match
pnpm phase17:replay
pnpm phase17:export
pnpm phase18:round
pnpm phase18:map
pnpm phase18:match
pnpm phase18:replay
pnpm phase18:export
```

只有同时满足以下条件，才可以考虑安装依赖：

```text
1. 任务明确需要新增、删除或升级依赖。
2. 用户在当前对话里明确批准安装步骤。
3. 已停止可能锁住 native binary 的 Node / Next / Vitest / dev-server 进程。
4. 执行前说明具体 package-manager 命令、风险和失败后的回退方案。
```

如果依赖状态看起来坏了，停止并报告具体失败。优先让用户在自己的 PowerShell 会话里手动处理，而不是在 agent 环境里反复尝试安装。

## 10. 验证习惯

按改动范围选择最小但有效的验证：

```text
改 core：优先跑相关 @agent-major/core 测试。
改 cli：优先跑相关 @agent-major/cli 测试。
改 web：跑 @agent-major/web typecheck / test，必要时 build:web。
改 materials：跑 pnpm materials:validate。
改共享 schema 或 db repository：至少覆盖 shared/db/core 中相关测试。
改文档：检查 UTF-8 显示、链接路径和当前状态是否与 meta 文档一致。
```

不要把全量 build 当作所有小改动的唯一证明；也不要用重装依赖替代验证。

涉及 UI / replay 的任务，除了自动化测试，还要给出人工验收路径：打开哪个页面、使用哪个按钮、查看哪个 run / match / map / round、应该看到什么、什么现象代表失败。

## 11. 常见无效尝试与停止条件

不要做这些事：

```text
不要反复执行失败的 rg。
不要基于乱码文档做判断。
不要为了解决测试失败先重装依赖。
不要把真实 LLM token usage 接入比赛内 Token Economy。
不要让真实 LLM 直接写 RoundReport 事实，除非对应 Phase 契约已经允许。
不要让前端伪造 HP、护甲、枪械、投掷物、雷达点位等当前事实层没有的数据。
不要把 Web runner 当作生产任务系统。
不要在 judge 中为了 replay 更精彩而脑补微观战斗。
不要在 combat realism 冻结条件未满足前深修 kill ledger 真实性。
```

失败时应保留可观测痕迹。LLM 调用失败、schema 校验失败、judge hard fail 或 replay guard 拦截时，保留 `llm_calls`、artifacts、system events、error message 和失败状态，不能用旧 replay 或预设结果掩盖。
