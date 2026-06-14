# Finance materials

本目录是 Finance Major（金融投资对抗）正式资产层，专门管理金融数据源、证据策略和地图绑定。

## 当前范围

第一版只服务：

```text
地图：Dust2 有色
轮次：行业判断
数据：FRED + BaoStock + 可选 UN Comtrade
```

这里不保存 API key，不保存运行时缓存，不保存临时测试脚本。

## 目录

- `source-registry.json`
  金融数据源和采集器注册表。
- `evidence-source-policy.json`
  证据分级、裁判上限和缺口规则。
- `maps/dust2-nonferrous/`
  Dust2 有色 / 行业判断的地图绑定与回合证据配置。

## 环境变量

正式入口使用仓库内本地环境：

```text
AgentsMajor/.env.local
```

上层 `LegendProject/.env` 和外部 `metal_project/` 只视为历史验证痕迹，不作为项目运行入口。

