# REQ-011 日志记录页（P15）任务拆分

> 规格：`specs/需求规格书_日志记录页字段级交互规格.md`。定位：系统事件流 + 异常（与 P11 审计互补）。

## T1 脚手架
- `logs.html` + `src/web/logs/` + vite entry + Overview 导航（第 14 视图）。

## T2 数据模型 + 纯逻辑
- types：LogEntry（ts/level info|warn|error/form 端枚举/action 全动作枚举/agent?/request_id/message/ref_audit/extra）
- seed：覆盖 recall/write/gc/sync_up/sync_down/sync_fail/sync_reconcile/conflict_resolve/llm_proxy/llm_fallback/l0_view/login/team_assign；含 error 样本（熔断/同步失败/额度超限/冲突挂起）、跨端样本、无 request_id 样本
- logic（纯函数）：
  - `sortLogs(list)` → error 恒置顶 → ts 倒序（R-LOG1）
  - `filterLogs(list, f)` → 级别/端/动作多选/时间窗/关键词/仅异常 六维 AND
  - `aggrErrors(errors)` → 按类型聚合（熔断 OPEN/同步失败/额度超限/L0 失败/向量报错/冲突挂起）+ 处置入口
  - `ensureRequestId(list)` → 无 request_id 补 `n/a` + 标告警（R-LOG2）
  - `l0Auth(pwd, state)` → 密码校验/错 5 次锁 15min（R-LOG3）
  - `canDeleteAudit(role)` → 仅 Admin；删除必写 `audit_delete`（R-LOG8）

## T3 组件
- LogFilter：级别/端/动作多选/时间窗/关键词/仅异常开关
- LogTable：行（时间·色点·端徽标·动作·消息·request_id 链接）error 红底；「详情」展开 extra；「查阅审计」弹 modal（R-LOG6 非常驻）
- ErrorAggr：error 分类聚合卡 + 处置入口（跳 P10/P13/P8 占位）
- AuditModal：独立 modal 定位 request_id 全链路，关闭收起
- L0AuthCard：非管理员遮罩 `[L0 已加密 · 需授权]`；管理员密码解锁（会话级）；错 5 次锁 15min

## T4 编排 + E2E
- LogsPage 编排 + useLogsMirror（safe-noop）+ toast
- e2e/logs.spec.ts（:8140）：全动作可见/仅异常置顶/跨端对照/弹审计 modal/L0 授权/密码错锁定/无删除按钮
