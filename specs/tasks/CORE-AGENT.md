# REQ-007 memagent-core 内核 任务拆分（内核API契约 19.10/19.11）

> 内核 = 唯一事实源；端壳只调用不实现业务（19.11 红线①）。纯 TS、零 UI 耦合，落 `src/core/memagent/`。

## T1 类型契约（契约文档 §1/§2/§6 直译）
- `types.ts`：Form（desktop|web|mobile|mac|linux|cli）、错误码 7 个、RecallReq/RecallResult（预算 1500/2000/3000）、MemReq/WriteResult、GcReq/GcReport、BrowseReq/BrowseResult、LogReq/LogPage、DiscoverReq/DiscoverResult、SyncReq/SyncReport、AuditRef；Provider 三接口（LlmProvider/VectorBackend/StorageBackend）
- `errors.ts`：MemAgentError(code, msg)，code ∈ E_AUTH_L0/E_BUDGET_FUSE/E_LLM_FALLBACK/E_SYNC_CONFLICT/E_FORM_DISABLED/E_QUOTA/E_VECTOR

## T2 基础设施
- `ulid.ts`：时间戳+随机的单调 ULID
- `storage.ts`：StorageBackend 接口（memories 增删改查 + audit append/query）+ InMemoryStorage（种子 5 条含 L0 加密）
- `vector.ts`：JsVectorBackend（hash bag-of-words 64 维 + cosine，起步实现；RustWasm 同构接口预留）
- `llm.ts`：LlmProvider 接口 + FakeLlmProvider（listModels 含档位/单价/余量）；`routeProxy(sources, priceCap, costCap, usedToday)` → 先免费后低价 ≤cap → cost_cap → 回退本地（19.8，审计 llm_proxy_source/llm_fallback）

## T3 内核业务（schema §3 + 行为红线）
- `memories.ts`：write（六类 17.6 + 五维查重 sim ≥0.75 → merged/duplicated + 短路嫁接 L1→L6）/browse（L0 需管理员密码，错 → E_AUTH_L0 + 遮罩；l0_view 审计）/gc（decay hot→warm→cold 推进 + 报告）
- `agent.ts`：createMemAgent({form, account, llm, vector, storage}) → 9 API：
  - recall：top_k 1–10 默认 5、critical 禁 minimal（16.5）、token 预算三档、evidence_thin 逃生阀、request_id 审计
  - logs：level/form/action/since 过滤 + 分页 + 异常置顶（熔断 OPEN 等 error）
  - discover：form 能力矩阵（web/mobile 剔除 proc，E_FORM_DISABLED）+ 打标绑定 auto_bind 审计
  - unbind：审计 unbound；getPrefs：user_id 级偏好；sync：最小实现 + 版本冲突 → E_SYNC_CONFLICT
- 全动作写审计（§3.2 action 枚举）

## T4 契约级验收用例（§8，8 条全测）
- 桌面↔Web recall 同口径；反代理路由三端一致；JS 向量后端可替换（同构）；L0 遮罩/授权/审计；logs 过滤+异常置顶；Web discover 剔 proc

## T5 收尾
- vitest 全绿 + Overview 不动（内核无 UI）+ TRACE/validate 不受影响
