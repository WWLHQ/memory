# 手动测试报告 · 修复批次 24（日志人话化 + 列表分页与列宽固化 + 遗留账本清理 + 层级生成时间 + 开发态端口回退）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **13:00:32**）
- 分支：main（未提交，等你验收后再决定是否提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,980,214 B = **116.33 MiB**
  - SHA256：`22cf418a48eae5289b8551b4d5196ae0de654fb12e99e402e45a9c772b0e296d`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B = 238.36 MiB）
- `release/` 现在**只有 `installer/` 一份产物**（批次19 规则：打包前强杀 `release/` 下旧实例，构建后删旧包）
- 关联文档：`specs/MANUAL-TEST.md` §3.12、`specs/code-map.md` 批次24、`specs/需求规格书.md` §19.19、`AGENTS.md` §2/§3/§4/§9

> **输出目录说明**：打包前 `release/installer` 被外部进程持有句柄（日志 `[package] release/installer 被外部进程占用（EPERM）`），本次先输出到 `release\installer-20261031-050011`，构建成功后按批次21 兜底（rename 仍 EPERM → 复制+删除）收口回 `release/installer`，并删除上一轮（12:56 那次，SHA256 `4b568570…`）的旧包。

---

## 0. 起因与结论

用户 5 条反馈：

1. 「没有接入大模型时不运行生成 L2–L6 吗？现在记忆层级管理页中 L2–L6 都有数据了呢？」
2. 「每条记忆是否要带入库日期和每层生成日期（只讨论不动作）」
3. 「程序运行日志都是代码，表示的什么意思也看不懂，一般用户也看不懂吧！需不需增加一个上下回滚条」
4. 「日志记录页和审计日志页增加分页功能和表头，表头列要可调，调整后的宽度要固化，不能每次登录要重调，参考记忆库管理页分页功能，每页预设显示 10 条，现在内容都出卡片了请调整」
5. 「web 端登录显示本机登录后端在线，但当前页面来源未被信任（cors 白名单外）。请从桌面端打开本应用，开发调试请用 npm run dev（127.0.0.1:5180）并先运行 npm run dev:backend。」

追加拍板：「1.要清理遗留账本；2.三种可选口径，我也倾向是第二种」→ 落地 ①的清理功能 + ②采用**口径2**（一条记忆只记一个「本组层级生成时间」）。

| # | 结论 / 根因 | 处理 | 结果 |
| --- | --- | --- | --- |
| 1 | **不是新写入在造假**。批次9 起「无真实 LLM 只落 L1」是硬规则；层级页的 L2–L6 全部来自规则落地**之前**的 stub 账本。本机数据根只读实测：扫描 1642 行，命中 986 行带 L2–L6（L2/L3/L4/L5/L6 各 986 行，`by_layer={L2:986}`，这些行的可召回正文 `content` 取的就是 stub L2），`refined_by` 分布 **987 行字段缺失 + 655 行 `stub` + 0 行 `llm`**，986 行都有 `content_l1`（`missing_l1=0`） | 新增安全页「遗留账本清理」卡：管理员先只读预览，二次确认后把这些行诚实降级回 L1（`content←content_l1`、清空 stub 深层、`layer_specs` 只留 L1、重算 sha256、版本+1，**向量原样保留**）；执行前强制备份，备份失败拒绝改写 | 已落地；执行前后各有单测/审计/动作日志三处可回查 |
| 2 | 口径2 = 单个 `layers_generated_at`（本组层内容生成时刻），入库时间仍是 `created_at`；逐层时间（口径1）与不加字段（口径3）被否 | 内核写入落层 / 合并生成摘要 / 手动改写内容三处打戳；页面映射为 ISO，历史行缺字段显示「层级生成未记录」，不拿 `created_at` 冒充 | 已落地 |
| 3 | 日志窗口只给 5 行原始 `scope:action`，一般用户读不懂，也没有纵向回看手段 | 默认**人话视图**（中文标题 + 关键字段摘要，同行保留原始码可 grep）+「原文」切换；一次取最近 **50** 条（主进程 `TAIL_MAX_LINES` 20→50），正文区固定高度**常驻上下滚动条**；用户上翻时不被新日志拽回底部 | 已落地 |
| 4 | 日志页/审计页是卡片流，无表头、无分页；列宽不可调也不记忆 | 抽出共用原语 `paginate` / `PageNav` / `useColWidths`，两页改**带表头表格 + 分页**（默认每页 10，档 10/20/50/100），列宽拖把手调整并 localStorage 固化 + 「恢复默认」 | 已落地 |
| 5 | 8201 上跑的是**安装版桌面端自带的登录后端**，它按白名单拒绝 `http://127.0.0.1:5180` 来源（实测 403 且无 `Access-Control-Allow-Origin`），而批次23 只教用户「先关桌面端」 | `npm run dev` 不再要求关桌面端：检测到「有服务但不受信」时自动在备用端口（8211→8215，`net` 真实探空闲）另起一份 `allowDevOrigins` 登录服务，并直接以 `?backend=` 受信地址打开页面 | 已落地并本机实测通过 |

**一句话结论**：①②是「解释 + 按你拍板落地」，③④是可读可用性问题已改到与其它页一致，⑤开发态登录在桌面端运行时也能开箱可用。

---

## 1. 改动详解

### 1.1 遗留账本清理（问题 1 的处置）

`src/core/memagent/legacyLayers.ts`（新增，纯内核）

- 判定 `isStubDeepLayered`：**带任一 L2–L6 正文且 `refined_by !== 'llm'`**。不做语义猜测，真实 LLM 产物一律不碰。
- `scanStubLayers`：只读预览，返回 `{scanned, hits, missing_l1, by_layer}`，不改任何数据。
- `demoteStubLayers`：`layer=L1`、`content=content_l1`、清 `content_l2..l6`、`layer_specs` 只留 `{L1: 'v1:清洗脱敏'}`、`refined_by='stub'`、`sha256` 按新正文重算、`version+1`、`updated_at=now`；**缺 `content_l1` 的行跳过并计入 `missing_l1`，绝不伪造正文**；不伪造 `layers_generated_at`。
- **向量原样保留**：本机 986 条脏行实测 `cosine(embedding, embedSync(content_l1)) = 1.000`（与实际 `content`/stub L2 只有 0.69~0.95），说明旧向量本就按 L1 生成（与 §2.2 不变量 7 一致），重算只会白改数据。
- 必须带 `admin_user_id`（空则抛错、账本一字不改），并落一条 `security_change` 审计（`detail.op='legacy_layer_demote'`，只记计数与最多 20 个样本 id，**正文与口令不进账本**）。

`src/electron/main.ts` §6c `registerLegacyIpc`（第 837 行起）

- `legacy:scan` 需真实登录会话（`requireSession`）；
- `legacy:demote` 需管理员（`requireAdmin`，不信任渲染层自报），先 `backupBeforeKernelChange('legacy-demote')` 备份到数据根 `backups/legacy-demote-*`，**备份失败直接返回错误、不改账本**；成功后写动作日志 `kernel:legacy:demote`（含 scanned/hits/demoted/missing_l1/备份目录）。
- 通道贯穿：`ipcChannels.ts` → `main.ts` → `preload.ts`（`api.legacy.scan/demote`）→ `src/desktop/hostBridge.ts`（`legacy:scan|legacy:demote`）。

`src/web/security/LegacyLedgerCard.tsx`（安全页第五卡，`SecurityPage.tsx:66`，仅管理员 `enabled={role==='admin'}`）

- 管理员进入自动预览一次；回执显示扫描/命中/已降级/跳过/缺 L1/原层级分布/备份目录；执行按钮 → 二次确认（`legacy-confirm` → `legacy-demote-yes/no`）；
- 非管理员显示「需管理员账号才能执行清理」；浏览器模式（无主进程 IPC）显示不可用；账本干净时显示「没有未接 LLM 却带 L2–L6 的历史行」。

### 1.2 层级生成时间（问题 2 的口径2）

- 内核 `types.ts` 新增 `layers_generated_at?: number`；打戳点：`memories.ts`（写入落层）、`forgetting.ts`（合并生成摘要）、`coreMemoryOps.ts:201`（手动改写=重新生成层级，时间跟着刷新）。
- 页面 `src/web/memory/types.ts` 的 `MemoryRecord.layers_generated_at?: string`（`coreMemoryOps.ts:65` 转 ISO；**字段缺失就不给值**）。
- 新增 `src/web/shared/layerTime.ts`：`fmtLayerGen(iso, 'full'|'date')` 输出本地时区（UTC+08:00）时间；缺字段返回 `LAYER_GEN_UNRECORDED = 层级生成未记录`；畸形串原样带出，不显示 `Invalid Date`。
- 展示位：记忆库行（`MemoryRow.tsx:74`）、记忆层级页列表（`LayerMemoryTable.tsx:164`）、层级详情（`MemoryLayeredPage.tsx:536`）、记忆抽屉（`MemoryDrawer.tsx:89`）。
- 附带小修正：`MemoryDrawer` 的「创建 / 更新」此前直接显示账本里的 UTC ISO，现统一走本地时区（`localTime()`），与新增字段一致——你之前定的口径是**用户可见时间一律 UTC+08:00**。

### 1.3 程序运行日志人话化 + 垂直滚动（问题 3）

- 新增 `src/web/Home/programLogLabels.ts`：`SCOPE_LABEL`（13 个作用域）/`ACTION_LABEL`（按真实在用的 `scope:action`）/`CHANNEL_LABEL`（IPC 通道）/`NOTE_KEYS` → `actionTitle()`、`detailNote()`、`humanizeProgramLog()`。**字典只翻译，不改写事实**：字典没有的动作显示「作用域中文 + 原始动作名」，不编「未知操作」。
- `ProgramLogPanel.tsx`：默认人话视图，`pl-mode-human`/`pl-mode-raw` 切换；人话行 = 中文标题 + ` · 关键字段摘要`，同排仍带原始 `scope:action`；`title` 悬浮给原始整行。
- 正文区 `.pl-body` 固定 240px、`overflow-y: scroll`（常驻滚动条，不随内容多少忽隐忽现），一次渲染 50 条；`atBottom` 判定（距底 <24px 才算停在底部）→ 上翻看历史时新日志不抢回底部，重新滚到底即恢复自动跟随（**没有单独「跳到最新」按钮**，文档已按实现写）。
- 主进程 `src/electron/actionLog.ts`：`TAIL_MAX_LINES` 20→**50**（`limit` 请求超界钳到 50），否则界面说 50 实际只给 20。
- 脱敏字段（`password/token/secret/authorization/api_key/credential/cookie/session_id`）在人话摘要里不出现。

### 1.4 日志页 / 审计页分页 + 表头列宽固化（问题 4）

- 新增共用原语：`src/web/shared/paginate.ts`（`PAGE_SIZES=[10,20,50,100]`、`DEFAULT_PAGE_SIZE=10`、1-based 越界 clamp、空列表 `totalPages=1`）、`PageNav.tsx`（首页/上一页/跳页输入/下一页/尾页 + 档位 + 「共 N 条」，testid `pagination`/`pg-first`/`pg-prev`/`pg-next`/`pg-last`/`pg-info`/`pg-goto-input`/`pg-size`/`pg-note`）、`useColWidths.tsx`（表头把手拖宽 → localStorage 固化，`MIN_COL_WIDTH=30`，「恢复默认」）+ `tableResize.css`。
- 日志记录页：`LogCards.tsx` 卡片流 → 表格，表头 7 列 `时间/级别/端/动作/消息/request_id/操作`，默认宽 `[92,62,58,96,300,148,150]`，键 `logsColWidths`；`LogsPage.tsx` 负责过滤 + 分页。
- 审计日志页：`AuditTable.tsx` 表头 9 列 `时间/动作/资源/状态变更/request_id（链路）/payload/pipeline_llm/操作者/操作`，默认宽 `[150,104,150,130,176,78,96,150,56]`，键 `auditColWidths`；`AuditPage.tsx` 主表与链式视图都分页，进入链式视图重置到第 1 页。
- 记忆库/层级页原有的分页口径收敛到同一 `paginate`（`memoryFilter.ts`、`layerFilter.ts`、`lifecycleFilter.ts` 只做转发，默认仍 5 条，不改变你已验收的观感）。

### 1.5 开发态端口回退（问题 5）

`tools/dev.mjs`（`npm run dev` 入口）

- `probeBackend(8201)`：带 `Origin: http://127.0.0.1:5180` 请求 `/api/health`，只有 **响应 200 且 `access-control-allow-origin === http://127.0.0.1:5180`** 才算「可复用」；
- 可复用 → 「复用已在运行的登录后端 127.0.0.1:8201（允许 http://127.0.0.1:5180）」；
- **有服务但不受信**（安装版桌面端的典型表现）→ 日志「8201 已有服务但不允许 http://127.0.0.1:5180 来源（多半是安装版桌面端自带的登录后端）；无需关闭桌面端，本次自动改用备用端口。」→ `pickBackendPort()` 在 8211→8215 里用 `net` 真实探第一个空闲端口，另起 `allowDevOrigins` 登录服务；
- 后端不在 8201 时，置 `DEV_NO_OPEN=1` 并用 `vite --open /overview.html?backend=http://127.0.0.1:<备用端口>&agentBackend=http://127.0.0.1:8200` 直接打开受信地址，终端打印完整入口 URL；
- 备用端口全被占 → 如实「本次不起登录后端（浏览器登录不可用）」，不假装成功；Vite 退出时一并收尾后端进程。
- `tools/dev-backend.mjs`：支持 `PORT=` 覆盖（默认 8201），非默认端口额外提示「页面需显式指定：/overview.html?backend=…」；`EADDRINUSE` 提示改用 `npm run dev` 自动回退。
- `vite.config.ts`：`server.open` 尊重 `DEV_NO_OPEN`；`port 5180 + strictPort` 不漂移。
- `LoginModal.tsx` 两条失败文案改为真实指引：来源不受信时说清「多半被安装版桌面端占用，重跑 `npm run dev` 会自动换备用端口」；未响应时说清 `npm run dev` / `npm run dev:backend`。文案不含端口字面量（仍过 `src/web/__tests__/backend.test.ts` 的硬编码端口扫描）。

---

## 2. 变更清单（批次24）

**新增 — 内核**：`src/core/memagent/legacyLayers.ts`
**新增 — 主进程/宿主**：（IPC 通道与 handler 落在既有文件内，见下）
**新增 — 渲染共用**：`src/web/shared/paginate.ts`、`PageNav.tsx`、`useColWidths.tsx`、`tableResize.css`、`layerTime.ts`
**新增 — 页面组件**：`src/web/security/LegacyLedgerCard.tsx`、`src/web/Home/programLogLabels.ts`
**新增 — 测试**：`src/core/memagent/__tests__/legacyLayers.test.ts`、`src/web/security/__tests__/LegacyLedgerCard.test.tsx`、`src/web/shared/__tests__/{paginate.test.ts,useColWidths.test.tsx,layerTime.test.ts}`、`src/web/Home/__tests__/programLogLabels.test.ts`、`src/web/logs/__tests__/LogsPage.test.tsx`、`src/web/audit/__tests__/AuditPage.test.tsx`

**修改 — 内核**：`src/core/memagent/types.ts`（`layers_generated_at`）、`memories.ts`、`forgetting.ts` 及其测试 `refine.test.ts`、`forgetting.test.ts`
**修改 — 主进程/宿主**：`src/electron/ipcChannels.ts`、`main.ts`（§6c `registerLegacyIpc`、§7 尾读注释）、`actionLog.ts`（`TAIL_MAX_LINES=50`）、`preload.ts`、`src/desktop/hostBridge.ts`、`src/electron/__tests__/actionLog.test.ts`
**修改 — 安全页**：`src/web/security/SecurityPage.tsx`（第五区块）、`__tests__/SecurityPage.test.tsx`
**修改 — 记忆页**：`src/web/memory/types.ts`、`coreMemoryOps.ts`、`MemoryRow.tsx`、`LayerMemoryTable.tsx`、`MemoryDrawer.tsx`、`MemoryLayeredPage.tsx`、`memoryFilter.ts`、`layerFilter.ts`、`__tests__/coreMemoryOps.test.ts`；`src/web/lifecycle/lifecycleFilter.ts`
**修改 — 日志/审计页**：`src/web/logs/LogsPage.tsx`、`LogCards.tsx`、`extras.css`；`src/web/audit/AuditPage.tsx`、`AuditTable.tsx`
**修改 — 首页/登录**：`src/web/Home/ProgramLogPanel.tsx`、`programLog.ts`、`__tests__/ProgramLogPanel.test.tsx`、`src/web/Home/LoginModal.tsx`
**修改 — 工具/配置**：`tools/dev.mjs`、`tools/dev-backend.mjs`、`vite.config.ts`
**修改 — 文档**：`AGENTS.md`、`README.md`、`specs/code-map.md`、`specs/code-index.generated.md`、`specs/MANUAL-TEST.md`、`specs/需求规格书.md`（§19.19）

**未做（明确不做）**：不改 §2.2 层级生成规则本身；不动真实 LLM 产物；不给逐层时间（口径1 被否）；不新增「跳到最新」按钮；接入服务 8200 的被占回退本次未覆盖。

---

## 3. 自动化门禁结果（本机实跑，2026-10-31 12:54–13:00 UTC+08:00）

| 命令 | 结果 |
| --- | --- |
| `npm run code:index -- --write` | 已写入 `specs/code-index.generated.md`（275 个文件） |
| `npm run typecheck` | 通过（渲染 + Electron 双配置 0 错误） |
| `npm run lint`（oxlint） | 通过（0 error，`verify:fast` 内含） |
| `npm run code:index:check` | 通过（索引不过期） |
| `npm test` / `npm run test:coverage` | **115 文件 / 1204 用例全过**；覆盖率 语句 77.61%、分支 69.59%、函数 73.06%、行 80.58%，均高于阈值（71/61/67/74） |
| `npm run build:electron` | 通过（main.cjs / preload.cjs，electron-dist 45.1.0 复用） |
| `npm run test:e2e` | **21 个 spec / 94 用例全过**（33.0s，真构建产物 + 真后端） |
| `npm run verify` | 全绿（退出码 0） |
| `npm run package` | 成功，`release/` 只剩最新 `installer/`（NSIS + win-unpacked 见文首 SHA256） |

批次24 新增/改写的测试覆盖点：
`legacyLayers.test.ts`（10 例：判定命中/不命中、降级回填与指纹重算、审计成对且不含正文、重跑幂等、**向量原样保留**、缺管理员抛错、缺 L1 跳过、混合账本只动脏行、空账本不写审计）；
`LegacyLedgerCard.test.tsx`（8 例：浏览器不可用 / 非管理员不扫 / 预览回执 / 确认执行 / 取消 / 干净账本 / 主进程拒绝 / IPC 未注册）；
`paginate.test.ts`、`useColWidths.test.tsx`、`layerTime.test.ts`、`LogsPage.test.tsx`、`AuditPage.test.tsx`、`programLogLabels.test.ts`、`ProgramLogPanel.test.tsx`、`actionLog.test.ts`（limit 钳到 1..50）、`coreMemoryOps.test.ts`（`layers_generated_at` 映射与改写刷新）。

**另有一次真机验证（问题 5）**：安装版桌面端运行时执行 `npm run dev` → 日志显示改用 **8211**；`GET http://127.0.0.1:8211/api/health`（带 5180 Origin）返回 200 且 `access-control-allow-origin: http://127.0.0.1:5180`；`POST /api/login`（`user_001 / demo1234`）真实返回会话。收尾时按 `netstat` 查到的真实 PID 结束本次脚本拉起的进程树，桌面端 8201 未被动过。

---

## 4. 手动测试步骤（待你执行）

时间一律按本机 UTC+08:00 阅读；动作日志位置 = 设置页「数据目录」卡片显示路径下的 `actions.log`。

### A. 安装与冒烟

1. 装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（或直接用 `release/installer/win-unpacked/MultiAgent Memory.exe`）。
2. 登录（管理员 `admin`，或演示账号 `user_001 / demo1234`），首页正常出图即通过。

### B. 问题 1 —— 层级页数据与「遗留账本清理」

1. 打开「记忆层级管理页」：批次9 之前写入的历史行仍带 L2–L6（这就是你看到的数据来源，属遗留产物，不是新写入在生成）。
2. 打开「账号与安全」页 → 第五卡「遗留账本清理」：管理员进入应**自动只读预览**，回显扫描行数 / 命中 / 缺 L1 / 原层级分布（本机量级预期 **扫描 1642 · 命中 986 · 缺 L1 0 · L2:986**）。
3. 点「执行清理」→ 出现二次确认；确认 → 回执显示已降级 / 跳过 / 样本 id / **备份目录**。
4. 数据根 `backups/legacy-demote-*` 目录应存在且含清理前的账本备份（这是唯一回退手段，降级本身不可逆）。
5. 回「记忆层级管理页」刷新：这些行只剩 L1，可召回正文 = 真实 L1（不再是 stub 套话），L2–L6 无内容；**层级生成仍显示「层级生成未记录」**（不伪造）。
6. 检索页用 L1 正文关键词召回一次：命中说明向量仍然有效（向量按实现原样保留）。
7. 审计页可查到 `security_change`，`detail.op=legacy_layer_demote`，`request_id` 以 `req_legacy_` 开头；`actions.log` 有 `[kernel:legacy:demote]` 一行含 scanned/hits/demoted/missing_l1/备份目录。
8. 再点一次「重新预览」→ 应显示命中 0 /「账本干净」。
9. 用普通成员账号进同一页：只看到「需管理员账号才能执行清理」，不自动扫描、无执行按钮。

### C. 问题 2 —— 入库时间 vs 层级生成时间

1. 新写一条记忆（写入页）→ 记忆库行同时显示入库时间与「层级生成 <今天时间>」。
2. 在记忆库管理页点该行打开抽屉 → 「层级生成」有本地时间值；同页「创建 / 更新」也应是本地时间（不再是 `...Z` 结尾的 UTC 串）。
3. 手动编辑该行内容并保存 → 层级生成时间刷新为本次操作时刻。
4. 批次24 之前的历史行（含 B 步刚降级的行）→ 显示「层级生成未记录」，**不得等于入库时间**。

### D. 问题 3 —— 程序运行日志窗口

1. 日志记录页顶部：默认「人话」视图，每行中文标题 + ` · 关键字段`（如「主进程：保存记忆 · mem=m1」），右侧仍有原始 `ipc:storage:putMemory` 供对照。
2. 点「原文」→ 恢复一行一条原始日志；再点「人话」切回。
3. 正文区应有**常驻**纵向滚动条，能回看本次取回的最近 50 条（含已轮转的 `actions.log.1`）。
4. 向上滚动停住，等操作约 10 秒：新日志到达**不应**把视图拽回底部；手动滚回底部后应恢复自动跟随。
5. 制造一次错误（如在检索页空查询触发失败）→ 底部出现「最近 N 条程序日志中有 M 条错误」与「📋 复制诊断信息」。
6. 人话摘要里不应出现 `***` 之外的密码/令牌明文。

### E. 问题 4 —— 分页与列宽固化

1. 日志记录页：列表为带表头表格（时间/级别/端/动作/消息/request_id/操作），分页条默认「每页 10 条」，可切 10/20/50/100；首页/上一页/跳页/尾页与「共 N 条」数字正确，翻页行号连续。
2. 审计日志页同样有 9 列表头 + 分页；点某行进入链式视图 → 分页应重置到第 1 页。
3. 在日志页拖动「消息」列右缘把手变宽 → 刷新页面（或退出重新登录）宽度保持；点「恢复默认列宽」回到初始；审计页独立记忆自己的宽度（键 `auditColWidths`）。
4. 把某列拖到很窄 → 不应小于最小宽度 30px，表头不塌。
5. 过滤（关键字/动作/级别）命中不足一页时 → 自动落在有效页，不应停在空白页。

### F. 问题 5 —— 开发态登录（保持桌面端运行）

1. **不要**关闭安装版桌面端，在项目目录执行 `npm run dev`。
2. 终端应出现：`8201 已有服务但不允许 http://127.0.0.1:5180 来源…无需关闭桌面端，本次自动改用备用端口。` → `登录后端就绪：http://127.0.0.1:8211（演示账号 user_001 / demo1234）` → `浏览器入口（登录后端在备用端口）：http://127.0.0.1:5180/overview.html?backend=http://127.0.0.1:8211&agentBackend=http://127.0.0.1:8200`。
3. 浏览器自动打开的地址用 `user_001 / demo1234` 应登录成功，不再出现「当前页面来源未被信任」。
4. 关掉 Vite（Ctrl+C）后，8211 应被一并释放（`netstat -ano | findstr 8211` 无残留）。
5. 对照实验：桌面端**未**运行时 `npm run dev` 应显示「复用已在运行的登录后端」或直接起在 8201，不触发备用端口。
6. 浏览器模式仍是无宿主能力模式（MCP 客户端扫描、数据根 IPC、L0 写密钥不可用），页面如实显示。

---

## 5. 已知限制

1. **清理不可逆**：只能从执行前自动生成的 `backups/legacy-demote-*` 恢复；判定只看「带 L2–L6 且 `refined_by !== 'llm'`」，若某条历史行确实由真实 LLM 产出但没写 `refined_by`，会被误降（本机实测 0 条 `llm` 行、987 行缺字段的都带 stub 套话，故本机无此风险）。缺 `content_l1` 的行一律跳过。
2. 清理不刷向量索引：本体内唯一 `VectorBackend` 是进程内临时索引，召回走存储全量扫描；主进程没有需要同步改 layer 的持久索引。
3. **层级生成时间只一个时刻**（口径2），不逐层；批次24 之前的历史行永远显示「层级生成未记录」，不做推断。
4. 列宽按**列序号**保存：将来页面增删列时旧值会错位，需点「恢复默认」；jsdom 无真实布局，拖宽只有单测覆盖，视觉需按 §4-E 手测。
5. 日志窗口一次最多 50 条（主进程上限），不是全量 `actions.log`；要查更早记录仍需直接 grep 文件。
6. 端口回退**只覆盖登录/镜像服务（8201）**：接入服务 8200 若也被安装版桌面端占用且来源不受信，接入页仍会拒绝来源；本次未做 8200 的回退。
7. 安装包未代码签名（未配置证书），Windows SmartScreen 可能告警。
8. `sync()` 仍显式 `E_NOT_IMPLEMENTED`；Windows CI 实跑仍未验证（本机门禁全绿，CI 配置在 `.github/workflows/ci.yml`）。
9. 本轮未提交 git（等你验收）。

---

## 6. 结论

批次24 的五条反馈全部有落地或明确答复：① 层级页的 L2–L6 来自批次9 之前的 stub 账本，已按你的拍板提供管理员「遗留账本清理」（预览→备份→降级→审计三处留痕，实测本机 1642 扫描 / 986 命中 / 0 缺 L1）；② 采用口径2，每条记忆一个 `layers_generated_at`，历史行不伪造；③ 程序运行日志默认人话视图 + 常驻滚动条 + 50 条窗口；④ 日志页/审计页改为带表头表格 + 每页 10 条分页，列宽可调且固化；⑤ `npm run dev` 在桌面端占用 8201 时自动改用备用端口并直接打开受信地址，浏览器登录开箱可用。

全部门禁在本机实跑通过（单测 115 文件 / 1204 用例、覆盖率过阈、Electron 构建、94 项 E2E），安装包已重新构建且 `release/` 只留最新一份。
