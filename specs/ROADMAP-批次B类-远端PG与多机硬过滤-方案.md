# 批次 B 类 · 远端 PG 中枢（B4）+ 多机硬过滤（B1）+ 真实精炼（B3）方案

> 背景：B2（45-B3 API 密钥进 MCP 门）经 B 类审查**确认已全量落地并接线生产**（见 §0）。
> 本方案只覆盖**真正未落地**的三项：B4、B1、B3。
> 纪律：先勘察 → 方案 → 编码；每项过 A 影响面回归 + B 效果验证 + C 变异验证三道闸门。

## 0. B2 已落地（无需重做，仅登记）

证据（均为现行代码，非计划）：

- 域模型 + 存储：`src/core/memagent/memberStore.ts`（`MemberRecord`/`ApiKeyRecord`、`FileMemberStore` 0600 + **真实空表**、`resolveApiKeyAccount`）+ `tokenStore.ts`（`resolveAccountFor` 三环鉴权）。
- 接线生产：`mcp.ts:163` 与 `mcpHttp.ts:445` 调 `resolveAccountFor(..., memberStore: opts.memberStore)`；`main.ts:2571/2673/2681` 实例化 `FileMemberStore` 并注入 TCP(8202)/HTTP(8204) 双服务。
- 管理端点：`home/server.ts:579-638` 提供密钥 list / mint / revoke。
- 已更正 AGENTS §190「留到多端」的过时备注。

**结论**：B2 在"开始执行 B 类"时已是完成态，本轮只补登记，不写新代码。

## 1. B4 · 远端 PG 中枢可配置化

### 1.1 现状
- `src/core/memagent/pgSyncHub.ts` 基于 `@electric-sql/pglite`（进程内 WASM PG）：`new PgSyncHub(dataDir?)`——无参=内存、有参=落盘单机文件（`dataDir` = 数据根 `sync-hub/`）。
- 其 SQL 为标准 PG 方言（`$1` 位置参数、`::jsonb`、`ON CONFLICT`、`COALESCE(MAX(seq),0)`），与真 `pg` 客户端 API（`client.query(sql, params) → { rows }`）近乎同构——**可移植性高**。
- `pg` 依赖**当前未安装**；本环境**无远端 PG 服务端**。

### 1.2 目标
把中枢从"硬编码单机 pglite"改为 **env 驱动连接串**：
- 默认（`SYNC_HUB_PG_URL` 未设）= 现状 pglite 落盘，**行为零变化、单测全绿**。
- 设了 URL = 接远端 Postgres（共享中枢，多机前提）。

### 1.3 实施草图（待你拍板后落地）
1. 新增依赖 `pg`（需 `npm i pg` + 进 electron 打包白名单；属重依赖，需你授权）。
2. `PgSyncHub` 构造改为 `constructor(opts: { dataDir?: string; pgUrl?: string })`：
   - `pgUrl` 存在 → 懒加载 `pg`、建立 `Pool/Client`；SQL 不变（已兼容）。
   - 否则 → 沿用 pglite（现状路径，单测覆盖）。
3. `main.ts` 读 `SYNC_HUB_PG_URL` 决定构造参数；`before-quit` 优雅关闭对两种后端都生效。
4. 连接失败 fail-fast（不静默退回 pglite 冒充远端）。

### 1.4 测试边界（诚实）
- 默认 pglite 路径：现有 `pgSyncHub` 测试继续全绿（B4 不能破默认行为）。
- 远端路径：**需真实 PG 服务端**才能端到端测——本环境无，故远端路径的实现必须配套一个"有服务端才跑"的集成测试（env 门控），否则无法进 CI 绿。

### 1.5 前置（须你提供）
- 授权新增 `pg` 依赖；
- 提供远端 PG 连接串 / 可访问的服务端（或允许我用本地临时起的 PG 做集成验证）。

## 2. B1 · 多机 team/enterprise 硬过滤

### 2.1 现状（已落地的单机部分）
- 三池门禁 D6-2：`projectInScope`（P-shared 恒可见 / P-archive 仅 admin / P-<user> 仅 owner·admin / general 按 `scope_project_ids`）在 recall/write/list/get/feedback/manage/gc 全门禁点生效。
- 账本租户归一 45-A1（`tenant.json` 真源）/ 45-A2（存量归一）已落地。
- 中枢 `PgSyncHub` 的**每条 SQL 都已按 `team_id` 隔离**（push/pull/reconcile/listConflicts/auditsFrom 全带 `team_id` 过滤）。

### 2.2 真正未落地的"多机"部分
单机下 tenant 恒定，跨机不可见性无压力。多机场景的硬过滤 = 在 B4 远端共享中枢之上，保证：
- 客户端上行/下行携带的 `team_id/enterprise_id` 与中枢规范三元组一致（由 45-A1 归一保证，已具备）；
- 任一端的"非本租户"读写在**中枢层**也被拒（中枢已按 `team_id` 过滤，但需明确：跨机伪造 team_id 时仍按传入 team_id 落库——需 B4 远端 + 一个 `SYNC_MULTI_TENANT=1` 开关来强制"客户端 tenant 必须 == 中枢规范 tenant"，否则 fail-closed）。

### 2.3 实施草图（依赖 B4）
- 新增 env `SYNC_MULTI_TENANT`：开启后，`PgSyncHub.push/pull` 校验传入 `team_id` 必须等于中枢规范三元组（中枢侧存一份 `hub_meta` 的 canonical tenant），不符即拒（不静默跨租户写）。
- 单测：构造两个不同 canonical tenant 的 hub 实例，断言跨 tenant 写入被拒、同 tenant 正常。
- 仍属"中枢层"过滤；客户端层三池门禁已先行落地。

### 2.4 前置
- 依赖 B4 远端中枢落地（单机 pglite 各端独立，无"跨机"语义，B1 在单机下无意义）。

## 3. B3 · L2–L6 真实精炼启用链路

### 3.1 现状（管线已具备）
- `src/electron/llmGateway.ts`：`callOrder()` 按最近拨测延时排队、逐个回退；`N` 引擎（13 家预设 + 自定义）；密钥经 `llm-keys.json` 0600。
- 精炼队列 `refineQueue.ts` 已接真引擎；`buildLayerPrompt` 读 `layerRules.ts` 单一真源。
- 当前全库 1585 行全是 L1、`refined_by=stub` 是**诚实 stub**（无密钥就不编深层），非缺陷。

### 3.2 真出深层所需（卡点）
- 提供**至少一家真实 LLM API Key**（写入 `llm-keys.json`，建议本机小模型如 Ollama 免费用，或云端一家）；
- 授权**预算**（真调引擎会花钱；每日行数上限 `REFINE_MAX_ROWS_PER_DAY` 默认 500，参数页可切"不限额"）；
- 在参数页"测试连通"通过后，开启后台补炼，存量即按 L2–L6 产出。

### 3.3 我可先做（不需 Key）
- 核查启用链路是否还有 stub 短路（确认 `isStub` 仅在"无可用引擎"时为真，有密钥即真实生成）；
- 若有遗漏的诚实短路点，修正使其在有密钥时能真产出。

## 4. 总排序与风险

1. **B4 远端 PG 可配置化**（架构前提，需你授权 `pg` + 服务端）—— 默认行为不变。
2. **B1 多机硬过滤**（依赖 B4，env 开关 + 中枢 tenant 校验）。
3. **B3 真实精炼**（依赖你提供 Key + 预算；我先做启用链路核查）。

- 红线（沿用）：中枢失败 fail-fast 不静默降级；密钥零明文落盘/日志/URL；远端路径不可绿则不进主构建。
- 不做的代价（诚实）：B4/B1 不处理，多机共享中枢与跨机硬隔离做不到（单机数据正确性不受影响）；B3 不处理，深层 L2–L6 全 L1、检索/生长维度偏薄（但属诚实 stub，不谎报）。

## 5. 待你拍板
- B4：是否授权新增 `pg` 依赖？是否提供远端 PG 服务端（或允许本地起临时 PG 做集成验证）？
- B3：提供哪家真实 LLM Key？是否授权精炼预算？
- 拍板后按 §1.3 / §2.3 / §3.3 落地，每项过三道闸门 + code-map 登记。
