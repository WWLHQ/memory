---
status: done
---

# 批次 27 手动测试报告 —— 全量审计收口（P0-8/9 + 27-F + 27-G + P2 八项 + P3 十一项）

- 日期：2026-10-31
- 范围：`specs/AUDIT-FULL-REVIEW-2026-10-31.md` 剩余全部条目——P0-8（主题提交）、P0-9（CI 门禁）、27-F（MCP 一键适配接真）、27-G（登录自动切受信 dev 后端）、P2-1/2/3/4/5/7/10/18、P3-1…11
- 原则：与前批一致；诚实偏差与残留已固化在 `AGENTS.md` §9（批次27-G 与 P2/P3 摘要条目）

## 1. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,987,558 B（116.33 MiB） |
| SHA256 | `C6F2AFD70ADECC61C9DC35D8344327A324C889C9FBB041F3F73DCF3BE82B99F8` |
| 清理 | `release/` 只留最新 `installer/` 一份（时间戳目录已收口回固定目录并删除） |

## 2. 改动清单（按主题提交）

| 提交 | 主题 |
|---|---|
| `31e0805` | P0-8 文档收口（批次1–27 手测报告 / 审计清单 / 需求规格） |
| `312c6d6` | P0-9 CI 两道门禁（TC-013 补 AC、手测报告补 status frontmatter、quality-gate 收敛 verify:fast + build:electron） |
| `64085ea` | 27-G 登录自动切受信 dev 后端（?backend= 会话记忆 + 8211–8215 自动发现 + 自动重试） |
| `5fcf956` | P2 修复八项 |
| `3751c55` | P3 卫生项十一项 |

### 27-F MCP 一键适配接真
1. Trae CN 升级为可自动写入（`%APPDATA%/Trae CN/User/mcp.json`，`expandHome` 支持 `%APPDATA%/` 前缀）；令牌过期（与 mcp-token.txt 当前值不一致）降级 `missing_auth` 并可一键补齐；不可自动写入的三个客户端（WorkBuddy/Zcode/deepseek harness）给精确原因，汇总消息点名「仅生成片段」。

### 27-G 登录自动切受信 dev 后端（`src/web/Home/useLoginMirror.ts` 等）
1. 页面用 `sessionStorage`（`mam.backend.session.v1`）记住本次会话真实后端；登录失败先按记录自动重试。
2. 记录缺失时自动探测备用端口 8211–8215（`discoverTrustedDevBackend`：探活 `/api/health` + ACAO 精确匹配 5180），发现受信 dev 后端即自动重试登录。
3. `origin_blocked` 文案如实说明「已自动探测 8211–8215 未发现受信后端，请启动/重跑 npm run dev」。
4. **边界**：浏览器页面无法替用户拉起进程——`npm run dev` 没跑时页面只能报错指路（本次已如实呈现）。

### P2 八项
1. **P2-1 查重阈值单一真源**：写页/层级页的阈值改为从内核 `layerRules.ts` 常量导出（L5=0.90），三处漂移消除。
2. **P2-2 `coreBrowse` 非法 layer 拒绝**：`FIELD` 表外值直接 `E_BAD_LAYER`，不再 `m[undefined]` 静默过滤全表还记成功审计。
3. **P2-3 webhook 降级分支契约修复**：未注入 pipeline 时如实报错并**不**把 hash 记进幂等索引（同内容不再永久 `duplicate`），`webhook.test.ts` 旧期望同步纠正。
4. **P2-4 refined_by 三态诚实化**：`llm`（完整阶梯）/ `llm_partial`（LLM 调用过但阶梯中断）/ `stub`（无 LLM）；`merge.test.ts` 两条契约同步。
5. **P2-5 脱敏对抗样本**：`refine.test.ts` 固化已知边界——跨行拼接、全角冒号/等号、裸 Base64 不误伤、拆词不误判；正则补 `sk-proj-` 形态（`[A-Za-z0-9_-]{16,}`）。
6. **P2-7 项目 ID 真源**：写页/查重/L0 申请的项目来自真实账本项目清单，不再硬编码 `'P1'`。
7. **P2-10 动作日志加固**：值形态兜底脱敏（Bearer/JWT/sk-/AKIA/xox 裸串、数组与嵌套）、`safeLogToken` 字符集归一（scope≤40/action≤80/request_id≤80，防日志注入伪造行）。
8. **P2-18 文档失真校正 + 索引指纹门禁**：`specs/test-plan.md` 等计数实测校正；`tools/code-index.mjs` 每文件附 12 位 sha256 指纹，任一单行改动 `--check` 即失败（防「改了代码不刷索引」）。

### P3 十一项
1. **P3-1 `_seedMemory` 收回测试钩子**：`MemAgentSeedHooks` 独立接口，公开 `MemAgent` 不再带种子方法；7 个测试文件改用 `getKernelWithSeed()`。
2. **P3-2 审计零会话键**：`l0_session_id` 从 5 处内核审计 detail 与 4 处 l0_auth_expire 日志中移除（§7.4 会话不进审计）；grant_id 保留可回查。
3. **P3-3 降级打层级生成时间**：`legacyLayers.ts` 降级时按批次24-F 口径打 `layers_generated_at`（重建=重新生成）；`grafted_from` 保留（入边是历史事实）。
4. **P3-4 IPC 会话闸门补齐**：`l0:seal` 与 `mcp:clients` 扫描改 `requireSession` 校验；seal 改走统一 IpcResult（`{ok, sealed}`/`l0Fail`），渲染层 `l0Port.ts` 用 `unwrap` 映射；`mcp:clients` 成功回包形状非 IpcResult → 闸门失败**抛错**（渲染层走「扫描失败」路径，绝不静默显示空列表）；preload/autoDiscovery/McpClientsPanel 全部带 `currentSessionId()`。
5. **P3-5 宿主桥去重键**：`hostBridge.ts` 去重键 = id + method + args，可预测/撞车 id 不再劫持 TTL 窗口内另一条调用的缓存结果；同 id 重试语义不变。
6. **P3-6 Windows `file:` 信任修复**：`isTrustedUrl` 用 `fileURLToPath` 按平台转换（旧实现 `u.pathname` 带前导 `/` 在 Windows 上从未生效），根目录拼 `sep` 保证目录边界。
7. **P3-7 日志轮转口径**：keep=3 实际只留 `.1/.2` 两份历史；`tailActionLog` 探测循环对齐 `keep-1`，AGENTS §4 文案纠正。
8. **P3-8 打包杀旧实例先礼后兵**：`package-builder.cjs` 先 `CloseMainWindow()`（等价点 ×，before-quit/日志收尾能跑）最多等 3 秒，幸存者才 `Stop-Process -Force`。
9. **P3-9 dev 端口 TOCTOU + agentBackend 诚实化**：`portFree` 探测与真实 listen 的竞速失败（EADDRINUSE 退出）自动顺延下一候选端口重试；备用端口入口不再硬编码拼 `agentBackend=8200`——先探活 8200 是否放行 dev 来源，否则如实说明接入页在开发态不可用。
10. **P3-10 `engines.node>=22`**：与 CI（node 22）和 TS 7 要求对齐，低版本 npm 安装时给警告。
11. **P3-11 覆盖率小数只随当次报告 + 悬浮层冒烟**：新 `floatEntry.test.tsx`（4 例）——无桥如实显示 initErr / 有桥 `detectClaude` → `setPosition` 贴右侧 / 跟随开关与 ✕ / `#root` 缺失显式抛错；各批次报告的覆盖率小数为当次实测，不再跨批复制。

## 3. 自动化门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck`（双配置） | 0 错 |
| `npm run lint`（oxlint） | 0 warning / 0 error |
| 索引新鲜度 `code:index:check` | 通过（已 `--write` 刷新，279 文件；P2-18 指纹门禁生效） |
| 单测 + 覆盖率 | **121 文件 / 1320 例**全过；覆盖率 语句 79.40 / 分支 71.74 / 函数 75.31 / 行 82.42（阈值 74/71/67/74） |
| E2E（`npm run test:e2e`，真构建产物 + 真后端） | **21 个 spec / 94 例**全过（32.7s） |
| `npm run package` | exit 0；打包前自动刷索引；时间戳目录 EPERM 走复制+删除收口回 `release/installer`；旧产物清理完成 |

新增/更新测试（批次27 全段累计）：
- 新 `src/web/InlineAttribution/__tests__/floatEntry.test.tsx`（4 例，P3-11）：悬浮层入口冒烟。
- `src/desktop/__tests__/hostBridge.test.ts` +1 例（P3-5）：同 id 不同 args 不互相劫持（去重键含 method+args）。
- `src/shared/__tests__/actionLog.test.ts` +5 例（P2-10）：值形态兜底脱敏（Bearer/JWT/sk-/AKIA/xox）、误伤回归（skype/version/admin）、数组与嵌套脱敏、注入归一（换行/`] [error]`/非法 request_id）、截断 40/80/80。
- `src/core/memagent/__tests__/refine.test.ts` +4 例（P2-5）：脱敏对抗样本边界固化。
- `src/core/memagent/__tests__/merge.test.ts` 2 例改期望（P2-4）：阶梯中断 → `llm_partial`。
- `src/core/memagent/__tests__/legacyLayers.test.ts` 改期望（P3-3）：降级打 `layers_generated_at`。
- 7 个测试文件换用 `getKernelWithSeed()`（P3-1，12 处调用点）。
- `src/web/Home/useLoginMirror.test.tsx`（27-G）：会话记忆自动重试 + 8211–8215 自动发现。

## 4. 手动测试步骤（安装版）

1. **安装与启动**：双击安装包 → 启动 → 登录 admin（或演示账号）→ 首页图谱与四卡正常。
2. **管理员闸门（P3-4）**：安全页 L0 写密钥解锁/加密封装正常（登录态）；登出后任何触发 `mcp:clients`/`l0:seal` 的操作应得到「需要登录后操作」类错误而非静默成功——动作日志（`ipc:… denied:no_session`）可回查。
3. **MCP 客户端面板**：接入页 MCP 面板「刷新状态」显示扫描时间（UTC+08:00）与真实检出客户端；未登录时扫描应失败并显示原因（不再是空列表）。
4. **一键适配（27-F）**：管理员点「⚡ 一键适配全部（N）」→ 逐行进度 + 汇总；已接入的显示「写入/已是最新」，不可自动写的客户端在汇总里点名「仅生成片段」。
5. **27-G 浏览器开发态**：`npm run dev`（8201 被桌面端占用时自动 8211+）→ 浏览器打开 `http://127.0.0.1:5180/overview.html?backend=…` 登录；关页重开（同浏览器会话）不带 `?backend=` 也应自动连上；彻底关掉 dev 后端再登录 → 报错文案明确「已自动探测 8211–8215 未发现受信后端」。
6. **日志轮转（P3-7）**：数据根 `actions.log` 超 5 MiB 后只出现 `actions.log.1`/`.2`（不再有 `.3`），日志页尾读正常。
7. **遗留账本清理（P2-4/P3-3）**：安全页「遗留账本清理」预览/执行正常；执行后记忆层级列表的生成时间显示本次操作时刻，真实 LLM 产物（含 `llm_partial`）不被降级。
8. **打包占用（P3-8）**：运行旧安装版时执行 `npm run package` → 日志先出现「请求旧实例退出 PID …」，3 秒内未退才「未响应，强制结束」；旧实例正常退出时无强杀行。

## 5. 已知边界与残留（诚实声明）

- 脱敏是**正则/值形态兜底，不是语义识别**：跨行拼接的畸形敏感串可能漏网（对抗样本测试固化的是已知边界，不是完备保证）。
- 宿主桥去重 TTL（10s）内同 id + 同 args 重发共享首次结果——这是幂等保护设计，非缺陷。
- 浏览器开发态仍无宿主能力（MCP 客户端扫描、数据根 IPC、L0 密钥环），页面如实降级；接入服务 8200 被桌面端占用时接入页在开发态不可用（dev 启动日志会如实说明）。
- MCP 单令牌仍是机器级凭据（P1-10 残留）；验证码 code 直出（无短信/邮件通道，设计取舍）。
- `sync()` 仍未接线（显式 `E_NOT_IMPLEMENTED`）。
