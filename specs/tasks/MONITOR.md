# P6 监控仪表盘 任务拆分（REQ-006 / 12.1 / 12.2）

> 布局：筛选栏 → 指标卡网格（6 组 14 卡）→ 告警时间线。

## T1 脚手架
- `monitor.html` 入口 + `src/web/monitor/` + vite.config 注册 + Overview 导航。

## T2 数据模型 + 纯逻辑
- types：MetricCard（group/metric/value/threshold/level ok|warn|crit/jumpTarget）、AlertItem（ts/level/message/request_id/memory_id）
- seed：14 卡数据，含触发阈值的 warn/crit 样本（如熔断 OPEN=crit、待裁决 25>warn、死信>0）
- logic（纯函数）：
  - `evalLevel(value, threshold, cmp)` → ok/warn/crit
  - `filterAlerts(list, {level, window, agent})` → 三维 AND
  - `p95(nums)`/`p99(nums)`（检索性能卡用，可测）

## T3 组件
- MetricGrid：分组渲染 14 卡，值/阈值/级别徽标（🔴 crit 红、⚠️ warn 黄、ok 绿），点击卡跳转目标（P10/P7/P1 占位链接）
- AlertTimeline：时间线列表，request_id/memory_id 可点（跳审计页占位），级别色点

## T4 编排 + E2E
- MonitorPage 编排 + 筛选栏（级别/时间窗/宿主 Agent）+ useMonitorMirror（safe-noop）
- e2e/monitor.spec.ts（:8136）：14 卡渲染、crit/warn 徽标、时间线 request_id 可见、筛选联动

## 验收要点
- 阈值对照规格表：连通<95%、延迟>5s、堆积>1000、写成功<99.5%、待裁决>20、命中率<60%、p95 payload>2000、llm>3000、p99>2s、证据不足>20%
