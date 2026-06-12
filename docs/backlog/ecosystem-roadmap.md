# 赛事生态 Backlog

本文件保存旧 roadmap 和 module-map 中有价值的生态设想。它不是当前执行计划。

## 1. 统计与奖项

长期目标：

```text
基于 Event、RoundReport、Hex trace 和 match summary 生成可追溯统计。
奖项由结构化事实派生，不能直接问 LLM 决定。
```

候选能力：

```text
player rating / impact。
MVP / EVP。
clutch、entry、support、economy efficiency。
团队风格画像。
按 round / map / match / tournament 聚合。
```

边界：

```text
统计不反写比赛结果。
奖项解释可以用 LLM，但基础事实必须来自落库事件和 trace。
```

## 2. 新闻与媒体

长期目标：

```text
基于比赛事实生成战报、快讯、复盘和栏目化内容。
新闻是包装层，不改变比赛事实。
```

候选能力：

```text
赛后战报。
回合高光卡片。
选手故事线。
队伍商业叙事。
媒体角度分类。
```

边界：

```text
新闻必须引用 sourceEventIds、RoundReport 或 trace artifact。
不能把未发生的 kill、winner、经济变化写成事实。
```

## 3. 素材库与叙事生态

长期目标：

```text
把 processed materials、队伍方案、选手角色、风格语料和地图命题沉淀为可维护素材库。
```

候选能力：

```text
队伍长期画像。
选手 role / alias / style。
caster / barrage / meme 风格库。
跨圈梗与栏目包装。
```

边界：

```text
runtime 只读 processed JSON 作为机器真相。
Markdown 用于人工维护和审阅。
素材库不能绕过 schema / validator。
```

## 4. Web Ops 与运营

长期目标：

```text
从本地实验转向可运行、可观测、可恢复的 Web 化系统。
```

候选能力：

```text
API contract。
queue / worker。
long-running run orchestration。
observability / cost tracking。
public export。
权限与多用户。
```

边界：

```text
不要在 Hex Web 验收台里假装生产任务系统。
不要在核心事实链稳定前引入复杂远端部署。
```
