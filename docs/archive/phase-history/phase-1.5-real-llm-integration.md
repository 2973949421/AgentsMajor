# Phase 1.5 真实 LLM 小范围接入计划

## 1. 阶段定位

Phase 1.5 的目标是在 Phase 1.45 已经稳定的转播包装锚点上，接入真实大模型供应商，但只替换低风险包装任务，不改变比赛事实链路。

阶段边界：

```text
接入真实 provider。
优先替换 caster_line。
保留 Phase 1.45 rule / fallback 生成器。
记录 llm_calls 和 Artifact。
失败时降级，不阻塞比赛。
不让真实 API 成本进入 Token 经济。
不让 LLM 修改比分、胜者、JudgeResult、RoundReport 核心事实。
不实现 Phase 1.6 区域化攻防协议。
```

## 2. 本地配置

本地环境文件：

```text
.env.local
```

该文件被 `.gitignore` 忽略，不能提交。

环境变量：

```text
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
DASHSCOPE_API_KEY=<local-secret>
AGENT_MAJOR_REAL_LLM_ENABLED=false
AGENT_MAJOR_LLM_PROVIDER=dashscope_openai_compatible
AGENT_MAJOR_CASTER_DRIVER_MODEL_ID=driver_kimi_k2_5
AGENT_MAJOR_CASTER_FALLBACK_DRIVER_MODEL_ID=driver_qwen_3_6_plus
AGENT_MAJOR_BARRAGE_DRIVER_MODEL_ID=driver_minimax_m2_5
AGENT_MAJOR_BARRAGE_FALLBACK_DRIVER_MODEL_ID=driver_qwen_3_5_plus
AGENT_MAJOR_LLM_TIMEOUT_MS=300000
AGENT_MAJOR_LLM_MAX_RETRIES=2
AGENT_MAJOR_WEB_RUNNER_ENABLED=false
AGENT_MAJOR_WEB_RUNNER_TOKEN=<optional-local-token>
AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE=false
AGENT_MAJOR_WEB_RUNNER_ALLOW_PRODUCTION=false
```

安全规则：

```text
API Key 只放本地 .env.local。
文档、代码、测试快照、事件日志、Artifact 和最终导出 JSON 都不能包含 API Key。
Authorization 请求头必须脱敏记录。
AGENT_MAJOR_REAL_LLM_ENABLED 默认 false，避免 typecheck / test / build 误触发真实请求。
AGENT_MAJOR_WEB_RUNNER_ENABLED 默认 false；Web 按钮只是本地 smoke 工具，不是生产启动入口。
如允许远程或生产环境触发 Web runner，必须配置 AGENT_MAJOR_WEB_RUNNER_TOKEN。
```

## 3. 供应商与模型清单

供应商：

```text
providerId: dashscope_openai_compatible
baseUrlEnv: DASHSCOPE_BASE_URL
apiKeyEnv: DASHSCOPE_API_KEY
chatCompletionsPath: /chat/completions
streamingEnabled: false
```

模型清单沿用 P1.3：

| 品牌 | 模型名 | 能力 |
|---|---|---|
| 千问 | `qwen3.6-plus` | 文本生成、深度思考、视觉理解 |
| 千问 | `qwen3.5-plus` | 文本生成、深度思考、视觉理解 |
| 千问 | `qwen3-max-2026-01-23` | 文本生成、深度思考 |
| 千问 | `qwen3-coder-next` | 文本生成 |
| 千问 | `qwen3-coder-plus` | 文本生成 |
| 智谱 | `glm-5` | 文本生成、深度思考 |
| 智谱 | `glm-4.7` | 文本生成、深度思考 |
| Kimi | `kimi-k2.5` | 文本生成、深度思考、视觉理解 |
| MiniMax | `MiniMax-M2.5` | 文本生成、深度思考 |

Phase 1.5 文本优先，不启用视觉理解。

## 4. 第一接入点

第一接入点固定为：

```text
caster_line
```

原因：

```text
caster_line 是包装任务，不是比赛事实。
失败可以回退到 Phase 1.45 fallback。
输出短，质量容易人工评估。
不需要修改 SQLite 表即可先用现有 Event + TimelineEvent 承载。
不影响 Judge、比分、经济和 RoundReport 核心结构。
```

默认模型：

```text
主模型：driver_kimi_k2_5 / kimi-k2.5
fallback：driver_qwen_3_6_plus / qwen3.6-plus
```

## 5. 实现路径

### 5.1 配置读取

新增或补齐：

```text
packages/llm/src/env.ts
packages/llm/src/model-registry.ts
```

要求：

```text
读取 DASHSCOPE_BASE_URL / DASHSCOPE_API_KEY。
读取 AGENT_MAJOR_REAL_LLM_ENABLED。
读取默认 caster / barrage driver。
配置缺失时返回 disabled 状态，不抛出会破坏测试的异常。
```

### 5.2 真实供应商实现

新增：

```text
packages/llm/src/dashscope-openai-provider.ts
```

职责：

```text
实现 LlmGateway.generateStructured。
使用 OpenAI Chat Completions 兼容请求。
统一非流式 stream=false。
支持 timeout。
支持最多 2 次 retry。
保留 rawText。
返回 usage。
错误对象脱敏。
```

### 5.3 Caster LLM 生成器

在 P2.3 广播模块中新增真实生成路径：

```text
输入：BroadcastSourceBundle。
输出：BroadcastItem kind=caster_line。
质量闸门：沿用 Phase 1.45 Broadcast Quality Gate。
失败：回退到 Phase 1.45 fallback_template。
```

约束：

```text
LLM 只能写解说文本。
不能输出 winnerTeamId、scoreAfterRound 覆盖字段。
不能暴露 driverModelId、providerId、modelName、token、cost。
必须有 sourceEventIds。
```

### 5.4 调用记录与产物

每次真实调用至少记录：

```text
taskType
driverModelId
providerId
modelName
ok
errorType
inputTokens
outputTokens
totalTokens
latencyMs
usedFallback
createdAt
requestArtifactId
responseArtifactId
```

边界：

```text
llm_calls 可记录真实 token 用量。
真实 token 用量不能进入 EconomyState。
Artifact 必须脱敏。
观众 ViewModel 不暴露 llm_calls 或 Artifact 原文。
```

### 5.5 测试策略

自动测试默认不打真实网络。

必须覆盖：

```text
环境变量缺失时保持 fallback。
AGENT_MAJOR_REAL_LLM_ENABLED=false 时保持 fallback。
真实 provider fetch mock 成功时生成 caster_line。
真实 provider 超时 / 500 / 非 JSON 时 fallback。
质量闸门 rejected 时不进入 Timeline。
输出不包含 API Key、Authorization、driverModelId、modelName。
```

### 5.6 人工烟测

只有当本地显式开启后才允许真实调用：

```text
AGENT_MAJOR_REAL_LLM_ENABLED=true
```

人工烟测建议先只跑单场 demo，并观察：

```text
是否产生真实 caster_line。
fallback 是否仍可用。
llm_calls 是否记录 usage / latency。
导出 JSON 是否不包含 API Key。
Web ViewModel 是否不暴露模型信息。
Web runner 默认关闭；显式启用后只接受 localhost，请求必须确认会重置 demo fixture。
```

## 6. 不做事项

Phase 1.5 不做：

```text
不把 agent_action 换成真实 LLM。
不把 judge 换成真实 LLM。
不让 LLM 生成最终 RoundReport 事实。
不修改 Token 经济。
不新增 broadcast_items / highlights 表。
不实现 Phase 1.6 攻防协议。
不启用视觉理解。
不做公网部署。
```

## 7. 验收标准

```text
pnpm typecheck 通过。
pnpm test 通过，默认不访问真实网络。
pnpm build 通过。
AGENT_MAJOR_REAL_LLM_ENABLED=false 时，Phase 1.45 行为不回退。
AGENT_MAJOR_REAL_LLM_ENABLED=true 且配置有效时，caster_line 可由真实 LLM 生成。
真实调用失败时自动使用 fallback。
llm_calls / Artifact 有记录但不泄露密钥。
Web LiveReplayData 不包含 raw LLM response、driverModelId、modelName、API Key。
```

## 8. 收口规划

Phase 1.5 的收口原则：

```text
不继续扩功能。
不把真实 LLM 扩到 agent_action / judge / RoundReport / barrage / replay_card。
不把 Web runner 当成生产任务系统。
只冻结真实 caster_line 的最小安全链路。
把剩余扩展交给 Phase 1.6 之后再判断。
```

收口对象：

```text
1. provider 配置读取。
2. DashScope OpenAI 兼容 provider。
3. DriverModel 注册表。
4. LLM caster_line 生成器。
5. llm_calls 与 Artifact 记录。
6. Broadcast Quality Gate。
7. CLI phase15:* 命令。
8. Web 本地 smoke runner。
9. LiveReplayData 观众侧隐藏规则。
10. fallback_template 降级路径。
```

收口后 Phase 1.5 的唯一真实 LLM 入口：

```text
BroadcastSourceBundle -> LLM caster_line -> BroadcastItem -> Event -> TimelineEvent -> LiveReplayData
```

所有比赛事实仍来自：

```text
fake provider -> judge rule -> RoundReport -> Event Log
```

## 9. 完成状态

Phase 1.5 已完成基础落地：

```text
packages/llm 已实现 DashScope OpenAI 兼容 provider。
packages/llm 已实现真实模型注册表。
packages/cli 已实现 .env.local 读取。
packages/core 已实现 createLlmCasterBroadcastGenerator。
engine 已拆成事实提交、转播生成、转播提交三段。
真实 LLM 调用不在 SQLite transaction 内等待。
phase15:* CLI 已接入真实 caster_line 可选链路。
Web 本地按钮已加默认关闭、localhost、confirmReset、token 和生产禁用保护。
LiveReplayData 不暴露 raw LLM response、driverModelId、modelName、llm_calls、Artifact 原文或 API Key。
```

Phase 1.5 人工真实 smoke 已验证：

```text
测试地图：DUST2 单图。
真实模式：AGENT_MAJOR_REAL_LLM_ENABLED=true。
地图状态：completed。
比分：Ghost NAV 10-8 Ghost FUR。
caster_line_created generationMode=llm：18 条。
llm_calls：18 次。
inputTokens：11014。
outputTokens：2054。
caster payload 模型字段泄露数：0。
网页端可看到真实主解说输出。
```

## 10. 验收记录

收口验收命令：

```text
pnpm typecheck
pnpm test
pnpm build
```

验收结果：

```text
pnpm typecheck：通过。
pnpm test：通过。
pnpm build：通过。
Web replay API：200。
LiveReplayData 敏感字段扫描：未发现 API Key / Authorization / driverModelId / modelName / llm_calls / Artifact / rawText。
本地 data/artifacts 与 data/exports 敏感字段扫描：未发现 sk-sp- / DASHSCOPE_API_KEY / Authorization / Bearer。
```

说明：

```text
测试、构建和默认本地运行仍然不访问真实网络。
真实 LLM smoke 需要显式开启 AGENT_MAJOR_REAL_LLM_ENABLED=true。
Web 按钮需要额外显式开启 AGENT_MAJOR_WEB_RUNNER_ENABLED=true。
```

## 11. 运行方式

默认安全运行：

```text
AGENT_MAJOR_REAL_LLM_ENABLED=false
AGENT_MAJOR_WEB_RUNNER_ENABLED=false
pnpm phase15:match
```

该模式会完成 Phase 1.5 流程，但 caster_line 使用 fallback，不产生真实成本。

CLI 真实 smoke：

```text
AGENT_MAJOR_REAL_LLM_ENABLED=true
pnpm phase15:match
```

Web 本地按钮 smoke：

```text
AGENT_MAJOR_REAL_LLM_ENABLED=true
AGENT_MAJOR_WEB_RUNNER_ENABLED=true
pnpm dev
```

如果需要 token 保护：

```text
AGENT_MAJOR_WEB_RUNNER_TOKEN=<local-token>
```

禁止事项：

```text
不要在公网生产环境直接暴露 Web runner。
不要把 AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE=true 与空 token 同时使用。
不要把 AGENT_MAJOR_WEB_RUNNER_ALLOW_PRODUCTION=true 与空 token 同时使用。
不要把真实 token usage 接入比赛内 Token Economy。
```

## 12. 已知边界

Phase 1.5 收口后仍保留的边界：

```text
Web runner 只是本地 smoke 工具，不是正式任务系统。
Web runner 当前仍是同步 HTTP 长请求。
activeRun 只提供单进程防重入，不是分布式锁。
Artifact 存本地 data/artifacts，不进入观众 ViewModel。
llm_calls 记录 token usage，但不做成本 dashboard。
真实 LLM 只增强主解说，不提升选手或裁判能力。
```

这些边界不阻塞 Phase 1.5 收口，因为 Phase 1.5 的目标不是 Web 化任务系统，而是真实 LLM 最小安全接入。

## 13. Phase 1.6 交接

Phase 1.6 可以依赖 Phase 1.5 的能力：

```text
真实 LLM provider 可选可用。
caster_line 可从结构化事实生成自然语言包装。
fallback_template 可作为失败降级。
BroadcastSourceBundle 已证明能作为安全输入边界。
Event / TimelineEvent / LiveReplayData 的事实与包装分层已经跑通。
```

Phase 1.6 不应该依赖 Phase 1.5 的能力：

```text
不要让真实 LLM 决定攻防胜负。
不要让真实 LLM 直接写 RoundReport 事实。
不要把真实 LLM token usage 当作区域资源分配。
不要把 Web runner 当作区域化攻防的正式调度入口。
```

Phase 1.6 的第一目标应是：

```text
用规则 / fake provider 先落地区域化攻防协议，让攻方方案、守方部署、区域资源分配和区域碰撞进入回合事实链。
```

## 14. 收口结论

Phase 1.5 判定为完成：

```text
完成真实 provider 最小接入。
完成真实 caster_line 小范围替换。
完成 fallback 与质量闸门。
完成敏感信息隐藏和错误脱敏。
完成 CLI 与 Web 本地 smoke 入口。
完成验收命令。
不再在 Phase 1.5 扩展新能力。
```

下一阶段进入：

```text
Phase 1.6：区域化攻防回合协议。
```
