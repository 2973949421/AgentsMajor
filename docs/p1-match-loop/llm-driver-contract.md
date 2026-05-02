# P1.3 大模型驾驶员契约（LLM Driver Contract）

## 1. 文档定位

这份文档定义 Agent Major 的大模型执行层。它回答的问题是：

```text
智能体（Agent）如何绑定大模型驾驶员（DriverModel）？
所有模型如何通过统一接口调用？
模型失败时如何重试和降级？
RawOutput 如何生成、归档并交给 Output Gate？
结构化输出如何校验、修复和兜底？
真实 API token / 成本如何记录，但不进入比赛经济？
假模型供应商（fake provider）如何与真实模型共用同一接口？
```

P1.3 的核心边界：

```text
Agent = 赛事角色、人格、职责、战术位置。
DriverModel = Agent 背后的执行引擎。
LLM Gateway = 统一调用模型的工程接口。
```

P1.3 不负责：

- 不定义 Token 经济公式。
- 不决定 `EconomyState`。
- 不裁剪 `SubmittedOutput`。
- 不决定比赛胜负。
- 不定义 2D 地图、解说文风、弹幕风格。
- 不把真实 API 成本反馈到比赛经济。

这些内容分别由其他文档负责：

| 内容 | 负责文档 |
|---|---|
| 比赛内 Token 经济 | P1.2 Token 经济说明 |
| RawOutput 到 SubmittedOutput 裁剪 | P1.2 输出闸门（Output Gate） |
| 回合战报结构 | P1.1 回合战报契约 |
| 比赛状态机 | P1.4 比赛 / 地图 / 回合引擎说明 |
| 真实用量和成本监控 | P4.3 可观测性与成本说明 |

## 2. 已确认接口原则

### 2.1 统一供应商入口

第一版所有模型使用同一个 OpenAI 兼容接口：

```text
Base URL: DASHSCOPE_BASE_URL
API Key: DASHSCOPE_API_KEY
```

本地环境变量建议：

```text
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
DASHSCOPE_API_KEY=本地 .env 注入，不写入文档和代码仓库
```

安全约束：

- API Key 不写入文档正文。
- API Key 不写入代码。
- API Key 不写入事件日志。
- API Key 不写入 Artifact。
- 调试日志必须对 Authorization 头脱敏。

### 2.2 OpenAI 兼容格式

第一版按 OpenAI Chat Completions 兼容格式设计：

```text
POST /chat/completions
```

请求结构遵循：

```json
{
  "model": "模型名",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.7
}
```

实际实现时允许根据供应商兼容细节追加 `extraParams`，但业务模块不能直接依赖供应商私有字段。

### 2.3 非流式调用

第一版统一使用非流式调用：

```text
stream: false
```

原因：

- Agent Major 是伪直播，不依赖真实 streaming。
- 系统先完整生成回合，再投影成直播时间线。
- 非流式调用更容易做结构化校验、重试、归档和 Output Gate。

第一版不保留 streaming 作为正式接口能力。后续如果需要直播视觉效果，可以由时间线播放层模拟。

### 2.4 文本优先

第一版只做文本输入输出：

- 不启用视觉理解。
- 不上传图片。
- 不传多模态消息。
- 模型能力中的视觉理解只作为未来扩展标签保留。

### 2.5 模型名必须精确传入

模型调用时必须严格使用模型清单中的字符串，不能自动改写、补全或替换：

```text
qwen3.6-plus
qwen3.5-plus
qwen3-max-2026-01-23
qwen3-coder-next
qwen3-coder-plus
glm-5
glm-4.7
kimi-k2.5
MiniMax-M2.5
```

## 3. 模型清单

### 3.1 模型供应商注册表（ProviderRegistry）

第一版只有一个真实供应商：

| 中文名 | 代码值 | 类型 | 说明 |
|---|---|---|---|
| DashScope OpenAI 兼容供应商 | `dashscope_openai_compatible` | 真实供应商 | 统一 Base URL 和 API Key。 |
| 假模型供应商 | `fake_provider` | 本地测试供应商 | 不发真实请求，用于跑通本地模拟。 |

### 3.2 驾驶员模型（DriverModel）清单

| 品牌 | 驾驶员模型 ID | 供应商 | 模型名 | 能力标签 |
|---|---|---|---|---|
| 千问 | `driver_qwen_3_6_plus` | `dashscope_openai_compatible` | `qwen3.6-plus` | 文本生成、深度思考、视觉理解 |
| 千问 | `driver_qwen_3_5_plus` | `dashscope_openai_compatible` | `qwen3.5-plus` | 文本生成、深度思考、视觉理解 |
| 千问 | `driver_qwen_3_max_2026_01_23` | `dashscope_openai_compatible` | `qwen3-max-2026-01-23` | 文本生成、深度思考 |
| 千问 | `driver_qwen_3_coder_next` | `dashscope_openai_compatible` | `qwen3-coder-next` | 文本生成、代码能力 |
| 千问 | `driver_qwen_3_coder_plus` | `dashscope_openai_compatible` | `qwen3-coder-plus` | 文本生成、代码能力 |
| 智谱 | `driver_glm_5` | `dashscope_openai_compatible` | `glm-5` | 文本生成、深度思考 |
| 智谱 | `driver_glm_4_7` | `dashscope_openai_compatible` | `glm-4.7` | 文本生成、深度思考 |
| Kimi | `driver_kimi_k2_5` | `dashscope_openai_compatible` | `kimi-k2.5` | 文本生成、深度思考、视觉理解 |
| MiniMax | `driver_minimax_m2_5` | `dashscope_openai_compatible` | `MiniMax-M2.5` | 文本生成、深度思考 |
| 本地测试 | `driver_fake_default` | `fake_provider` | `fake-driver-default` | 文本生成、确定性假数据 |

说明：

- 视觉理解能力第一版不启用。
- 代码模型不限定只能在某张地图使用。
- 解说、弹幕、新闻不使用降配模型，因为当前成本按调用次数一致，不以模型价格作为调度依据。

## 4. 核心对象

### 4.1 驾驶员模型（DriverModel）

`DriverModel` 是可被智能体、裁判、解说、弹幕、新闻等任务绑定的模型配置。

字段草案：

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 驾驶员模型 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 显示名称 | `displayName` | `string` | 是 | 管理面板可读名称。 |
| 模型供应商 | `providerId` | `ProviderId` | 是 | 第一版主要是 `dashscope_openai_compatible`。 |
| 模型名 | `modelName` | `string` | 是 | 必须精确传给接口。 |
| 品牌 | `brand` | `string` | 是 | 千问、智谱、Kimi、MiniMax。 |
| 能力标签 | `capabilities` | `ModelCapability[]` | 是 | 文本、深度思考、视觉、代码。 |
| 默认用途 | `defaultUseCases` | `DriverUseCase[]` | 是 | agent、judge、caster、barrage、news 等。 |
| 是否启用 | `enabled` | `boolean` | 是 | 可本地禁用某个模型。 |
| 优先级 | `priority` | `number` | 否 | fallback 排序参考。 |
| 额外参数 | `defaultExtraParams` | `Record<string, unknown>` | 否 | 深度思考等可选参数。 |

### 4.2 模型能力（ModelCapability）

```text
text_generation
reasoning
vision
code
structured_output
long_context
```

第一版实际使用：

```text
text_generation
reasoning
code
structured_output
```

视觉能力仅作为标签保留，不进入调用路径。

### 4.3 驾驶员用途（DriverUseCase）

```text
agent_action
judge
judge_panel
arbiter
round_report
event_builder
caster
barrage
news
interview
summary
repair
fake
```

说明：

- `agent_action`：选手智能体出招。
- `judge`：单个裁判判定。
- `judge_panel`：双裁判合议。
- `arbiter`：裁判分歧时仲裁。
- `round_report`：生成回合战报。
- `event_builder`：从回合战报拆事件。
- `repair`：修复非法结构化输出。

### 4.4 模型配置（ModelConfig）

`ModelConfig` 是运行期加载的模型配置视图。它可以由 `DriverModel` 派生，也可以后续从 `models.json` 或数据库读取。

字段草案：

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 驾驶员模型 ID | `driverModelId` | `string` | 是 | 指向 DriverModel。 |
| 供应商 ID | `providerId` | `ProviderId` | 是 | 例如 `dashscope_openai_compatible`。 |
| 模型名 | `modelName` | `string` | 是 | 必须精确传入接口。 |
| 默认温度 | `defaultTemperature` | `number` | 否 | 不同任务可覆盖。 |
| 默认输出上限 | `defaultMaxOutputTokens` | `number` | 否 | 只限制真实模型输出，不代表比赛经济。 |
| 默认超时 | `defaultTimeoutMs` | `number` | 是 | 第一版默认 `300000`。 |
| 默认额外参数 | `defaultExtraParams` | `Record<string, unknown>` | 否 | 深度思考等供应商参数。 |
| fallback 模型 ID | `fallbackDriverModelIds` | `string[]` | 否 | 失败后按顺序尝试。 |

边界：

- `ModelConfig` 可以影响真实调用表现。
- `ModelConfig` 不进入 `EconomyState`。
- `defaultMaxOutputTokens` 不是 `SubmittedOutput` 预算。
- 比赛经济仍由 P1.2 的 Output Gate 控制。

### 4.5 提示词模板（PromptTemplate）

`PromptTemplate` 定义某类任务如何构造 system / user messages。它是 P1.4 调用大模型时的输入契约，不直接保存比赛事实。

字段草案：

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 模板 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 任务类型 | `taskType` | `DriverUseCase` | 是 | agent_action、judge、round_report 等。 |
| 模板版本 | `version` | `number` | 是 | 修改模板时递增。 |
| System 模板 | `systemTemplate` | `string` | 是 | 系统角色提示词。 |
| User 模板 | `userTemplate` | `string` | 是 | 用户任务提示词。 |
| 必需变量 | `requiredVariables` | `string[]` | 是 | 渲染前必须提供。 |
| 输出格式 | `responseFormat` | `"text" | "json_object"` | 是 | 是否要求 JSON。 |
| 结构名 | `schemaName` | `string` | 否 | 结构化任务需要。 |
| 是否启用 | `enabled` | `boolean` | 是 | 可在本地禁用旧模板。 |

第一版模板类型：

```text
agent_action
judge
arbiter
round_report
event_builder
caster
barrage
news
summary
repair
```

约束：

- 模板渲染后的 prompt 可以保存为 Artifact。
- prompt Artifact 必须脱敏。
- 结构化任务必须声明 `schemaName`。
- 模板不直接决定 `driverModelId`，只声明任务如何表达。

## 5. 智能体绑定规则

### 5.1 Agent 绑定 DriverModel

领域模型中已经确定：

```text
Agent.driverModelId -> DriverModel.id
```

第一版规则：

- 每个 Agent 必须绑定一个 `driverModelId`。
- 同一个 `DriverModel` 可以驱动多个 Agent。
- 同一支队伍内可以混用多个模型。
- `driverModelId` 默认在赛事开始前确定。
- 第一版不把模型绑定作为比赛经济资源。
- 经济系统不能修改 `driverModelId`。

### 5.2 是否公开展示

默认策略：

- 管理与调试界面展示 `driverModelId`。
- 观众直播页默认不展示真实模型名。
- 可以在队伍档案页后续做“驾驶员风格”叙事，但第一版不把模型名作为赛事宣传核心。

原因：

- 避免观众把胜负简单归因于模型强弱。
- 保留后续“模型驾驶员数据榜”的空间。
- 第一版先让比赛机制成立。

### 5.3 选手模型分配默认策略

选手模型分配后续会单独细化。P1.3 先给出默认原则：

- Coach / IGL：优先深度思考强的模型。
- Star / Closer：优先综合输出强、创造力强的模型。
- Entry：优先快速提出高冲击方案的模型。
- Lurker：优先反制、找漏洞、长推理能力强的模型。
- Support：优先结构化补全、稳健表达强的模型。

第一版不强制某个模型只能用于某张地图。

## 6. 默认模型分工

### 6.1 裁判模型

默认裁判采用双裁判合议：

```text
主裁判：glm-5
副裁判：qwen3-max-2026-01-23
```

默认流程：

```text
1. glm-5 生成 JudgeDecision。
2. qwen3-max-2026-01-23 生成 JudgeDecision。
3. 如果 winnerTeamId 一致，合并理由和评分。
4. 如果 winnerTeamId 不一致，调用仲裁模型。
```

默认仲裁模型：

```text
glm-5
```

说明：

- 仲裁调用必须看到两个裁判的结构化判定。
- 仲裁只能基于 `submittedOutput`、地图目标、经济状态、回合上下文和两份裁判意见。
- 仲裁不能读取未提交的 `rawOutput`。

### 6.2 RoundReport 模型

默认使用：

```text
qwen3-max-2026-01-23
```

fallback：

```text
glm-5
```

原因：

- 回合战报是事件、转播、统计的桥，结构化稳定性优先。
- 失败时必须重试或 fallback，不能跳过。

### 6.3 Event Builder 模型

默认使用：

```text
qwen3-max-2026-01-23
```

fallback：

```text
glm-5
```

如果事件拆解可以用确定性规则完成，优先使用规则，不调用模型。

### 6.4 Agent Action 模型

第一版不固定所有 Agent 使用同一模型。默认策略：

- 可以混编。
- 允许同模型多 Agent 共享。
- 允许后续按角色、队伍风格、地图目标分配。
- 暂不把模型分配写成平衡规则。

临时默认池：

```text
glm-5
qwen3-max-2026-01-23
kimi-k2.5
MiniMax-M2.5
qwen3.6-plus
qwen3.5-plus
qwen3-coder-plus
qwen3-coder-next
glm-4.7
```

### 6.5 解说、弹幕、新闻模型

不做降配。默认可使用强模型。

建议默认：

| 任务 | 默认模型 | fallback |
|---|---|---|
| 解说（caster） | `kimi-k2.5` | `qwen3.6-plus` |
| 弹幕（barrage） | `MiniMax-M2.5` | `qwen3.5-plus` |
| 新闻（news） | `kimi-k2.5` | `qwen3-max-2026-01-23` |
| 采访（interview） | `MiniMax-M2.5` | `kimi-k2.5` |
| 摘要（summary） | `qwen3-max-2026-01-23` | `glm-5` |

这些默认值只用于 P1.3 第一版，后续可通过配置调整。

## 7. 大模型网关（LlmGateway）

### 7.1 统一调用接口

工程实现建议提供一个统一入口：

```ts
type LlmGatewayRequest = {
  taskType: DriverUseCase;
  driverModelId: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: "text" | "json_object";
  schemaName?: string;
  extraParams?: Record<string, unknown>;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  trace: {
    tournamentId?: string;
    matchId?: string;
    mapGameId?: string;
    roundId?: string;
    agentId?: string;
    sourceModule: string;
  };
};
```

返回结构：

```ts
type LlmGatewayResult = {
  ok: true;
  driverModelId: string;
  providerId: string;
  modelName: string;
  taskType: DriverUseCase;
  rawText: string;
  parsedJson?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  requestArtifactId?: string;
  responseArtifactId?: string;
  warnings?: string[];
};
```

失败结构：

```ts
type LlmGatewayFailure = {
  ok: false;
  driverModelId: string;
  providerId: string;
  modelName: string;
  taskType: DriverUseCase;
  errorType:
    | "timeout"
    | "rate_limited"
    | "provider_error"
    | "invalid_response"
    | "schema_validation_failed"
    | "unknown";
  message: string;
  retryable: boolean;
  latencyMs?: number;
  requestArtifactId?: string;
  responseArtifactId?: string;
};
```

### 7.2 OpenAI 兼容请求

适配器把 `LlmGatewayRequest` 转换成 OpenAI 兼容请求：

```json
{
  "model": "glm-5",
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "..."
    }
  ],
  "stream": false,
  "temperature": 0.3
}
```

如果任务要求 JSON：

```json
{
  "response_format": {
    "type": "json_object"
  }
}
```

是否支持 `response_format` 由适配器探测或配置决定。如果供应商不支持，系统改用 prompt 约束和后置解析。

## 8. 深度思考参数

当前不确定各模型对深度思考参数的支持情况。P1.3 采用保守设计：

### 8.1 通用额外参数（extraParams）

大模型网关允许传入：

```ts
type ThinkingExtraParams = {
  enableThinking?: boolean;
  thinkingBudget?: number;
};
```

这些参数只进入供应商适配层，不进入比赛领域模型。

### 8.2 默认启用策略

默认尝试开启深度思考的任务：

- 裁判（judge）。
- 仲裁（arbiter）。
- Coach。
- IGL。
- 回合战报（round_report）。
- 赛后复盘（news / recap）。

默认不开启深度思考的任务：

- 弹幕（barrage）。
- 普通解说（caster）。
- 击杀播报（kill_feed）。
- 简短采访（interview）。

### 8.3 不支持时的处理

如果模型或供应商不支持深度思考参数：

- 不让调用失败。
- 静默移除不支持参数。
- 在 `warnings` 里记录。
- 在可观测性里记录一次 `unsupported_extra_param`。

## 9. 重试、降级与超时

### 9.1 默认超时

默认单次调用超时：

```text
timeoutMs = 300000
```

说明：

- 该值可配置。
- 第一版统一按约 300 秒设计，避免深度思考和长上下文任务被过早中断。
- 弹幕、击杀播报等轻任务后续可在可观测性稳定后降低到 `60000`，但不作为第一版默认策略。

### 9.2 默认重试策略

默认策略：

```text
同模型最多 2 次重试
失败后 1 次 fallback
```

结构：

```ts
type RetryPolicy = {
  maxRetries: number;        // 默认 2
  retryBackoffMs: number[];  // 默认 [1000, 3000]
  allowFallback: boolean;    // 默认 true
  fallbackDriverModelIds: string[];
};
```

### 9.3 失败处理优先级

```text
1. 超时、限流、供应商错误：可重试。
2. 非法 JSON：先做结构修复。
3. 结构修复失败：可 fallback。
4. 关键任务全部失败：阻塞当前回合。
5. 包装任务全部失败：跳过或延后，不阻塞比赛。
```

关键任务：

```text
agent_action
judge
arbiter
round_report
event_builder
summary
```

非关键包装任务：

```text
caster
barrage
news
interview
replay_card
```

### 9.4 Fallback 记录

每次 fallback 必须记录：

- 原始 `driverModelId`。
- fallback `driverModelId`。
- 失败原因。
- 最终是否成功。
- 关联 `roundId` / `agentId` / `taskType`。

这些记录进入可观测性与成本控制，不进入比赛经济。

## 10. 结构化输出

### 10.1 必须结构化的任务

以下任务必须输出 JSON 或可解析为 JSON：

- 裁判判定（judge）。
- 仲裁判定（arbiter）。
- 回合战报（round_report）。
- 事件拆解（event_builder）。
- 经济相关解释（economy explanation，如果使用模型）。
- 数据统计解释（stats explanation，如果需要机器消费）。

### 10.2 可纯文本的任务

以下任务允许纯文本：

- 智能体行动（agent_action）。
- 解说台词（caster）。
- 弹幕（barrage）。
- 新闻文章（news）。
- 赛后采访（interview）。

但如果纯文本会被下游机器消费，应额外生成摘要或结构字段。

### 10.3 JSON 修复

非法 JSON 处理流程：

```text
1. 尝试本地解析修复。
2. 本地修复失败，调用 repair 模型。
3. repair 失败，执行 fallback 模型。
4. 关键任务仍失败，则当前 round 进入 failed 状态。
```

默认 repair 模型：

```text
qwen3-max-2026-01-23
```

fallback：

```text
glm-5
```

### 10.4 结构校验

所有结构化输出必须通过 schema 校验：

- P1.1 的 `RoundReport` 校验。
- P0.2 的 `Event` payload 校验。
- P1.3 的 `JudgeDecision` 校验。
- 后续 API / DB 写入前的最终校验。

校验失败不能直接写入事实事件。

## 11. RawOutput 边界

### 11.1 生成边界

P1.3 负责生成完整 `RawOutput`：

```text
Agent + Prompt + DriverModel + Context
→ LLM Gateway
→ RawOutput
```

P1.3 不负责裁剪：

```text
RawOutput
→ P1.2 Output Gate
→ SubmittedOutput
```

### 11.2 RawOutput 归档

默认策略：

- 所有 Agent 的 RawOutput 都保存为 Artifact。
- 裁判、仲裁、回合战报、事件拆解的原始响应都保存为 Artifact。
- 解说、弹幕、新闻的原始响应建议保存，但不阻塞比赛。
- RawOutput 默认不展示给观众。
- 管理与调试界面可以查看 RawOutput。

Artifact 记录至少包含：

| 中文字段 | 代码字段 | 说明 |
|---|---|---|
| 产物 ID | `artifactId` | 稳定引用。 |
| 任务类型 | `taskType` | agent_action、judge 等。 |
| 驾驶员模型 ID | `driverModelId` | 调用模型。 |
| 关联智能体 ID | `agentId` | 可选。 |
| 关联回合 ID | `roundId` | 可选。 |
| 内容路径 | `uri` | 本地文件或对象存储位置。 |
| 创建时间 | `createdAt` | ISO 时间。 |

### 11.3 Prompt 归档

默认保存完整 request prompt：

- 便于复盘。
- 便于重放。
- 便于调试结构化输出失败。

安全要求：

- 不保存 API Key。
- 不保存 Authorization 头。
- 后续如果 prompt 包含用户隐私或密钥，必须在写入 Artifact 前脱敏。

## 12. Fake Provider

### 12.1 目标

假模型供应商（fake provider）用于本地开发和测试：

- 不调用真实 API。
- 不消耗次数。
- 不依赖网络。
- 可复现。
- 与真实 provider 使用同一 `LlmGateway` 接口。

### 12.2 输入输出

Fake Provider 必须接受同样的请求结构：

```text
driverModelId
taskType
messages
responseFormat
schemaName
trace
```

输出同样的结果结构：

```text
rawText
parsedJson
usage
latencyMs
artifactId
```

### 12.3 默认行为

建议 fake provider 支持：

- 固定文本输出。
- 基于 `taskType` 的模板输出。
- 基于 `roundId` 和 `agentId` 的确定性变化。
- 可配置失败率，用于测试 retry / fallback。
- 可配置非法 JSON 输出，用于测试 repair。

### 12.4 验收标准

使用 fake provider 应能跑通：

- 一个 Agent action。
- 一个 Judge decision。
- 一个 RoundReport。
- 一场 BO3 的最小模拟。

## 13. 调用任务类型

### 13.1 Agent Action

输入：

- Agent 基础档案。
- `driverModelId`。
- 地图目标。
- 当前回合上下文。
- EconomyState。
- 最近摘要。

输出：

- `rawOutput`。
- `rawOutputSummary`。
- `rawOutputTokens` 估算。
- Artifact 引用。

后续由 Output Gate 裁剪为 `submittedOutput`。

### 13.2 Judge

输入：

- 双方 `submittedOutput`。
- 地图目标。
- 回合目标。
- 经济状态。
- 关键上下文摘要。

禁止输入：

- 未提交的完整 `rawOutput`。

输出：

- `winnerTeamId`。
- `loserTeamId`。
- `scoreImpact`。
- `judgeReason`。
- `confidence`。
- `keyStrengths`。
- `keyMistakes`。

### 13.3 Arbiter

触发条件：

- 双裁判 `winnerTeamId` 不一致。
- 双裁判置信度差距过小。
- 结构化判定冲突。

输入：

- 两份 JudgeDecision。
- 双方 `submittedOutput`。
- 地图目标。
- 经济状态。

输出：

- 最终 JudgeDecision。
- 分歧处理说明。

### 13.4 Round Report

输入：

- Round。
- AgentOutputs。
- JudgeResult。
- EconomySnapshot。
- Map Context。

输出：

- P1.1 定义的 RoundReport。

要求：

- 必须结构化。
- 失败必须重试或 fallback。
- 成功前不能进入事件拆解。

### 13.5 Event Builder

输入：

- RoundReport。
- P0.2 Event Taxonomy。

输出：

- `score_updated`。
- `economy_updated`。
- `round_report_created`。
- `kill_feed_created` 等事件草案。

`score_updated`、`economy_updated` 可以由模拟引擎先写入，Event Builder 负责校验 RoundReport 是否能稳定关联这些核心事实；`kill_feed_created` 等包装事件如果可以规则化拆解，优先规则化。

### 13.6 Broadcast Tasks

包括：

- caster。
- barrage。
- interview。
- news。
- replay_card。

要求：

- 可以异步。
- 可以失败后延后。
- 不能修改比赛事实。
- 必须引用来源 Event 或 RoundReport。

## 14. 事件与可观测性

P1.3 不新增比赛事实事件类型。它主要写入：

- Artifact。
- LLM 调用日志。
- 可观测性记录。
- fallback 记录。

后续 P4.3 可定义正式事件或数据表。

建议记录字段：

| 中文字段 | 代码字段 | 说明 |
|---|---|---|
| 调用 ID | `llmCallId` | 稳定引用。 |
| 任务类型 | `taskType` | agent_action、judge 等。 |
| 驾驶员模型 ID | `driverModelId` | 使用哪个模型。 |
| 模型名 | `modelName` | 实际传入接口的字符串。 |
| 供应商 ID | `providerId` | dashscope_openai_compatible。 |
| 是否成功 | `ok` | true / false。 |
| 错误类型 | `errorType` | timeout、provider_error 等。 |
| 输入 token | `inputTokens` | 如果供应商返回。 |
| 输出 token | `outputTokens` | 如果供应商返回。 |
| 总 token | `totalTokens` | 如果供应商返回。 |
| 延迟 | `latencyMs` | 调用耗时。 |
| 是否 fallback | `usedFallback` | 是否发生降级。 |
| 创建时间 | `createdAt` | ISO 时间。 |

真实 token 和真实成本只用于可观测性：

```text
不得写入 EconomyState。
不得影响 BuyType。
不得修改 driverModelId。
不得作为比赛胜负依据。
```

## 15. 默认配置草案

### 15.1 环境变量

```text
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
DASHSCOPE_API_KEY=<local-secret>
```

### 15.2 Provider 配置

```json
{
  "id": "dashscope_openai_compatible",
  "displayName": "DashScope OpenAI Compatible",
  "baseUrlEnv": "DASHSCOPE_BASE_URL",
  "apiKeyEnv": "DASHSCOPE_API_KEY",
  "chatCompletionsPath": "/chat/completions",
  "streamingEnabled": false
}
```

### 15.3 Retry 配置

```json
{
  "timeoutMs": 300000,
  "maxRetries": 2,
  "retryBackoffMs": [1000, 3000],
  "allowFallback": true
}
```

### 15.4 Judge Panel 配置

```json
{
  "judgePanel": {
    "primaryJudgeDriverModelId": "driver_glm_5",
    "secondaryJudgeDriverModelId": "driver_qwen_3_max_2026_01_23",
    "arbiterDriverModelId": "driver_glm_5"
  }
}
```

## 16. 与其他文档的勾稽关系

| 文档 | P1.3 提供 | 对方负责 |
|---|---|---|
| P0.1 领域模型 | `DriverModel`、`driverModelId` 的执行含义 | 实体关系和字段骨架 |
| P0.2 事件分类 | LLM 调用不直接产生比赛事实事件的边界 | 事件类型和 payload |
| P1.1 回合战报契约 | `RawOutput` 生成、Artifact、结构化输出 | `AgentOutput`、`RoundReport` |
| P1.2 Token 经济说明 | 完整 `RawOutput` 交给 Output Gate | `SubmittedOutput` 裁剪 |
| P1.4 比赛 / 地图 / 回合引擎说明 | 调用接口、重试、fallback | 调用时机和状态机 |
| P1.5 本地持久化说明 | Artifact 和调用日志需求 | SQLite / 文件系统映射 |
| P4.3 可观测性与成本说明 | 用量、延迟、失败、fallback 字段 | 成本统计和告警 |

## 17. 验收标准

完成 P1.3 后，应满足：

- 能用同一 `LlmGateway` 接口调用真实 provider 和 fake provider。
- 能严格按给定模型名传入 API。
- 能通过 `Agent.driverModelId` 找到 `DriverModel`。
- 能为 Agent action 生成 `RawOutput`。
- 能把 `RawOutput` 交给 P1.2 Output Gate。
- 能让 Judge 只读取 `SubmittedOutput`。
- 能执行 `2 次重试 + 1 次 fallback`。
- 能对结构化任务做 JSON 校验、修复和降级。
- 能记录真实 token 用量和延迟，但不写入 `EconomyState`。
- 能保证 `driverModelId` 不被经济系统修改。

## 18. 待你审阅的问题

这些问题不阻塞 P1.3 初版，但会影响后续细化：

1. 默认裁判合议是否固定为 `glm-5 + qwen3-max-2026-01-23`，还是允许每届赛事换裁判组？
2. 仲裁模型默认用 `glm-5` 是否可接受？
3. `qwen3.6-plus` 和 `qwen3.5-plus` 是否都进入正式选手池，还是一个作为备用？
4. 是否允许在观众页面公开展示“驾驶员模型”？
5. `RawOutput` 是否永久保存，还是只保存本地开发阶段？
6. 深度思考参数如果供应商实际报错，是静默关闭，还是在管理面板提示？
7. 是否需要为每个模型维护“适合角色”标签，例如 Coach、IGL、Star、Lurker？
8. 第一版是否需要做“模型驾驶员数据榜”，还是推迟到 Stats 模块？
