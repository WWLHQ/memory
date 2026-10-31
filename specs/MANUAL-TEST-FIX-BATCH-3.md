---
status: done
---

# 手动测试报告 · 修复批次 3（内核正确性）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-062213/MultiAgent Memory-0.1.0-setup.exe`（121,913,223 B = 116.27 MiB）
- SHA256：`bc1d1310866189d36b17bbafa8b6ac3f0d133c6bf28337fe0d14f1c0892fa5b9`
- 未打包目录：`release/installer-20261030-062213/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`；便携包/开发态 `%APPDATA%\multi-agent-memory`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md`、`specs/MANUAL-TEST-FIX-BATCH-2.md`；本轮对应审核清单批次 3（recall 冷回填预算 / LLM 产物诚实化 / category 校验 / FileStorage fsync 与损坏通知 / webhook 失败可重试 / 加密 merge 解密失败）

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 3-A recall 冷回填预算 | 初始命中与冷回填后统一走 `applyHardCap`：按分数从低到高丢弃直到 ≤3000t，`payload_tokens` 按最终 hits 重算，`budget.status` 以最终 payload 为准（回填不再击穿硬熔断） | `src/core/memagent/agent.ts` |
| 3-B LLM 产物落地 / refined_by | 新增可选结构化 `LlmProvider.refine`；只有非 stub、选中模型且实现 refine 时才生成 L2–L6。L1 始终由内核 `sanitizeL1` 生成，L2–L6 逐层过 `checkLayerSpec`（违规层丢弃并返回 `spec_violations`），调用失败回退 L1 并返回 `refine_error`。`agent.write` 仅在 LLM 产物真正落库时记 `llm_proxy` 与计费；选中模型但未产出记 `llm_fallback`（E_LLM_FALLBACK）；显式 stub 不写 llm_* 审计噪音 | `src/core/memagent/types.ts`、`memories.ts`、`agent.ts` |
| 3-C category 运行时校验 | `CATEGORIES/isCategory` 成为唯一真源；`coreWrite` 入口拒绝非法 category（不再静默落 pitfall）。MCP TCP `write_memory` 非法 category → `-32602`；MCP HTTP tools/call → `isError`；Webhook 非法 category → `dedup:'error'` 且不占用幂等键 | `types.ts`、`memories.ts`、`mcp.ts`、`mcpHttp.ts`、`webhook.ts` |
| 3-D FileStorage fsync + 损坏二次启动 | `persist()` 写 tmp → 文件 fsync → rename → 目录 fsync（目录失败按平台忽略）。新增 `<db>.corrupt-notice.json` sidecar：首次损坏落盘，下次启动（空库）由主进程消费一次，写 `main.log` 并在窗口加载完成后弹窗告知原件备份位置 | `fileStorage.ts`、`src/electron/main.ts` |
| 3-E webhook 失败可重试 | `HashIndex` 只把成功结果写入幂等索引，失败仅保留在最近状态（`recentStatus`）；同一事件失败后可直接重试，不会被“已收录”短路。主进程 refinePipeline 映射修正：`duplicated→duplicate`，`merged/new→new`，`filtered→ok:false + error`（不再伪装成 duplicate） | `webhook.ts`、`src/electron/main.ts` |
| 3-F 加密 merge 解密失败 | 合并加密记忆必须先解出旧 L0 再整体重加密：缺密码或解密失败 → 审计 `merge_blocked`（`l0_merge: missing_password / decrypt_failed`）并抛 `E_AUTH_L0`；旧记忆完全不变，绝不静默保留旧密文导致 L0/L1 分叉 | `memories.ts` |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **92 文件 / 835 用例全过** |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |

新增/调整测试：

- `src/core/memagent/__tests__/recallBudget.test.ts`（新建）：热层弱相关 + 冷层强信号回填后仍守 3000t，`payload_tokens`/`budget.status` 按最终结果。
- `src/core/memagent/__tests__/refine.test.ts`：新增真实 `refine` 落地、违规层丢弃、异常回退、stub 不调用 refine、非法 category 报错。
- `src/core/memagent/__tests__/llmHonesty.test.ts`（新建）：`agent.write` 的 `llm_proxy` / `llm_fallback` / 显式 stub 无噪音 / 无代理源四类审计。
- `src/core/memagent/__tests__/merge.test.ts`：非 stub 无 refine → 只落 L1 标 stub；加密合并缺密码/错密码 → `E_AUTH_L0` 且旧记忆与版本不变、审计含 `merge_blocked`。
- `src/core/memagent/__tests__/webhook.test.ts`：非法 category 可修正重试；pipeline 失败不进入幂等索引、重试成功；`HashIndex` 失败结果只留 recent。
- `src/core/memagent/__tests__/mcp.test.ts` / `mcpHttp.test.ts`：write_memory 非法 category 拒绝。
- `src/core/memagent/__tests__/fileStorage.test.ts`：损坏隔离 sidecar 可消费一次并说明备份路径；无损坏时返回 null。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-062213/MultiAgent Memory-0.1.0-setup.exe` | 121,913,223 B = **116.27 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-062213/win-unpacked/` | 可直接运行 `MultiAgent Memory.exe` |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 仍被本机工作区索引器占用（EPERM），`tools/package-builder.cjs` 自动输出到时间戳目录，属预期。此前 `release/installer-20261030-062108` 为同轮中间构建，以本报告 `062213` 为准。

## 4. 本轮手动测试用例（重点）

> 令牌读取（PowerShell）：`(Get-Content "$env:APPDATA\MultiAgent Memory\mcp-token.txt" -Raw).Trim()`
> 便携包/开发态把目录换成 `multi-agent-memory`。TCP 完整脚本见 `docs/会话采集启动指南.md` §2.7。
> `8202`=MCP TCP，`8204`=MCP HTTP，`8203`=Webhook，`8201`=home server。

### 4.1 recall 预算（3-A）

| # | 操作 | 期望 |
| --- | --- | --- |
| A-1 | 通过 MCP `write_memory` 写入一条约 5000 字、含 `budgetcheck` 关键词的 pitfall（项目 `P1`） | 返回 `mem_id`，`refined_by=stub` |
| A-2 | 通过 MCP `recall_memory` 查询 `budgetcheck`（`top_k=5`） | `payload_tokens ≤ 3000`；`budget.status` 为 `ok/warn/fused` 之一且与 payload 对应；单条超限时该条被裁剪而非整体击穿 |
| A-3 | 打开「召回」页做同样查询 | 页面显示的 token/预算与 MCP 返回一致（同内核口径） |

> 冷回填触发需要「热层零命中/全低分 + 冷层 sim≥0.85」，属确定性单测覆盖场景（`recallBudget.test.ts`），界面手测以 A-2 的硬上限为准。

### 4.2 LLM 精炼诚实化（3-B）

| # | 操作 | 期望 |
| --- | --- | --- |
| B-1 | 通过 MCP 写入一条普通记忆 → 打开「分层」页查看该条 | 仅 L1 有内容；L2–L6 显示为空/不可用；来源标记为 stub（不出现模板摘要） |
| B-2 | 打开「日志」页筛选 `llm_fallback` | 本轮写入**不应**产生新的 llm_fallback（显式 stub 不制造失败噪音）；历史遗留条目不受影响 |
| B-3 | 写入审计（`main.log` / 审计 JSON）核对 | `write` 审计的 `layers` 仅 `["L1"]`，`refined_by` 为 `stub`；无 `llm_proxy` 计费记录 |

> 真实 `refine` 落地需要接入真实 Provider（本安装包仍装配 stub）。L2–L6 落库、违规层丢弃、异常回退由 `refine.test.ts` / `llmHonesty.test.ts` 覆盖；接入真实模型后可按 B-4 复测：写入 → 分层页出现 L2–L6 → 日志出现 `llm_proxy` 且带模型来源。

### 4.3 category 校验（3-C）

| # | 操作 | 期望 |
| --- | --- | --- |
| C-1 | MCP TCP `write_memory` 传 `category:"bug"` | 返回 `-32602`，消息含 `category`；记忆库无新增 |
| C-2 | MCP HTTP `POST /mcp` tools/call `write_memory` 传非法 category | `isError:true`，文本含 `category`；记忆库无新增 |
| C-3 | `POST http://127.0.0.1:8203/ingest` 传 `category:"bug"` | `{ok:false, dedup:"error", error:"非法 category…"}`；`GET /ingest/hash?hash=…` 返回 `found:false` |
| C-4 | 同内容/同 session 改为 `category:"pitfall"` 重发 | `{ok:true, dedup:"new", mem_id:"mem_…"}`（修正后可重试） |

### 4.4 本地库 fsync 与损坏二次启动（3-D）

| # | 操作 | 期望 |
| --- | --- | --- |
| D-1 | 关闭应用 → 备份 `%APPDATA%\MultiAgent Memory\memories.db.json` → 写入 `{broken` → 启动应用 | 首次启动显示错误框（E_STORAGE_CORRUPT）；退出；目录出现 `memories.db.json.corrupt` 与 `memories.db.json.corrupt-notice.json` |
| D-2 | 再次启动应用 | 应用正常打开（空库），窗口加载完成后弹窗「本地记忆库曾被隔离」，detail 含损坏路径、备份路径、检测时间与错误 |
| D-3 | 关闭后第三次启动 | 不再弹窗（通知已消费）；`corrupt-notice.json` 已删除；`.corrupt` 备份仍在 |
| D-4 | 恢复备份：关闭应用 → 删除空库 → 将 `.corrupt` 改名回 `memories.db.json` → 启动 | 记忆/审计恢复，无损坏提示 |
| D-5 | 写入若干记忆后强制结束进程再启动 | 最近一次成功写入仍在（tmp→fsync→rename 生效），无 0 字节库文件 |

### 4.5 Webhook 失败可重试（3-E）

| # | 操作 | 期望 |
| --- | --- | --- |
| E-1 | `POST /ingest` 发送合法事件，随后用同一 content/session 重发 | 第一次 `dedup:"new"`；第二次 `dedup:"duplicate"` 且同 `mem_id`（成功仍幂等） |
| E-2 | 构造一次失败（如 `category` 非法或 pipeline 异常），`GET /ingest/status` 查看 | 最近状态可见 `dedup:"error"` 与错误原因；`GET /ingest/hash` 对失败 hash 返回 `found:false` |
| E-3 | 修正后重发同一事件 | 成功入库（`dedup:"new"`），不被失败缓存短路 |
| E-4 | `POST /ingest` 传含 PII 的低质内容触发质量门（如纯占位/无信息） | 返回 `ok:false, dedup:"error"`，error 含「质量门拦截」；不会显示为 duplicate |

### 4.6 加密记忆合并（3-F）

| # | 操作 | 期望 |
| --- | --- | --- |
| F-1 | MCP `write_memory` 写入 `content` + `l0_password:"pw123456"`（项目 `P1`），记录 `mem_id` | `dedup:"new"`，库中无明文（分层页 L0 不可见） |
| F-2 | 再写一条高度相似内容但**不带** `l0_password` | 返回错误（消息含 `E_AUTH_L0` / 须提供 L0 密码）；原记忆 `content_l1`/版本不变；审计出现 `merge_blocked` + `l0_merge:"missing_password"` |
| F-3 | 带 `l0_password:"wrong999"` 重试 | 返回 `E_AUTH_L0`（密码错误或密文损坏）；原密文与 L1 不变；审计 `l0_merge:"decrypt_failed"` |
| F-4 | 带正确密码 `pw123456` 重试 | `dedup:"merged"`，版本 +1；用该密码在 L0 查阅页可解出新旧两段内容；`content_orig` 仍为空（不落明文） |

> MCP TCP 返回为 JSON-RPC error（`code -32000`，message 含 `[E_AUTH_L0]`）；Web 界面/内核直调会得到 `code:'E_AUTH_L0'`。

## 5. 未纳入本轮 / 已知问题

| 项 | 状态 |
| --- | --- |
| E2E 使用 8202/8204 与桌面 MCP 端口冲突、`e2e/servers.ts` 前缀校验 | 留批次 4（门禁与稳定性） |
| 遗忘引擎周期调度未接入、同步引擎未接线 | 批次 4（未接线模块诚实化） |
| 真实 LLM Provider 尚未装配 | 本安装包仍为显式 stub；接入后按 4.2 B-4 复测 |
| `release/installer` 被索引器占用 | 持续存在；按时间戳目录交付 |
