# P13 大模型配置页 任务拆分（REQ-009 / 13.2 / 19.8）

## T1 脚手架
- `models.html` + `src/web/models/` + vite entry + Overview 导航（第 15 视图）。

## T2 数据模型 + 纯逻辑
- types：VectorModelKey（st/bge/ds）、LlmUsage（write/judge/rerank/growth）、ProxySource（agent/model/tier free|cheap|paid/price/quota/used）、ProxySelectMode auto|manual
- seed：3 向量模型、4 用途默认、反代理映射（claude-code:claude-free 免费 / codex:gpt4o-mini ¥0.01 / x-agent:deepseek ¥0.03 超限演示 / 另一免费源）
- logic（纯函数）：
  - `vectorInfo(key)` → dims/deploy/cloud（云端需 Key）
  - `maskKey(k)` → `[API_KEY:x]`（R2）
  - `validateUsage(u)` → R1 至少一模型；net 勾选须端点非空（C3）；judge 温度恒 0（R4）；fallback 恒开（R3）
  - `proxyEligible(src, priceCap)` → tier=free 或 (cheap 且 price≤cap)（R7/R12）
  - `autoPick(srcs, priceCap, now)` → auto 择优：免费（余量>0.9×声明额度降权）→ 低价≤cap（C7/C8/C13）；无合格 → local（R12）
  - `manualPick(selected, now)` → 勾选源可用则用之，全不可用→local 不转其他（C11）；含付费高价→拒（C9/R7）
  - `proxyBudgetOf(src)` → 声明额度×0.9（R8）
  - `auditProxy(src, cost, mode)` → `llm_proxy_source=agent:<name>`+花费+模式（R10）
  - `validatePriceCap(v)` → ≥0；=0 仅免费（C13）

## T3 组件
- VectorCard：模型下拉联动 dims/deploy；384→1024 提示重建 + 估时；重建中禁切换（R5）；连通测试
- LlmUsageTable：4 行（本地/网络复选 + 端点/Key 脱敏槽 + temperature + timeout + fallback 恒开）；judge 温度锁灰（C2/R4）
- ProxyPanel：全量映射表（勾选驱动 agent_model）+ 来源单选（本地/网络/反代理）+ select_mode 切换（记审计 C12）+ price_cap/cost_cap/budget 条
- AuditEcho：审计回显（model_config / llm_proxy_source）

## T4 编排 + E2E
- ModelsPage 编排 + toast + mirror（safe-noop）+ 保存（校验→写 model_config）
- e2e/models.spec.ts（:8141）：C1/C2/C5/C6/C7/C13 关键链路
