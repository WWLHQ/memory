---
status: active
---

# 全量审核报告 · 2026-10-31（问题汇总，只读审核，未改任何代码）

> 审核身份：程序设计与审核（20 年视角）——关注正确性、数据完整性、信任边界、诚实化、可维护性、门禁可信度。
> 审核时间：2026-10-31 13:38（UTC+08:00）
> 审核对象：`main` 工作树（批次 A–E + 整改批次 1–24 之后）
> 方法：五路并行只读深审（内核 / Electron 与主进程 / 本机服务与认证 / 19 个渲染页 / 门禁与文档），随后主审核逐条读码复核高危项。
> 标记约定：**✔ = 主审核亲自读码/跑命令确证**；**⚠ = 子审计定位并给出证据，本次未逐行独立复核**（结论可用，动手前请再看一眼该行）。

---

## 0. 一句话结论

产品骨架是诚实的（无种子数据、sync 显式报错、L0 密文、三层管理员门禁都真实存在），但**四条「用户会据此做出错误判断」的假展示仍在**（层级页假保存、日志页假审计链、写页假五维指标、内核不可达当空账本），**本机 3 个 HTTP 端口对本地进程几乎无鉴权**，**FileStorage 写盘失败会静默丢整批**，并且**批次 6–24 的 457 项改动全部没进版本控制、CI 一推即红**。

| 级别 | 条数 | 性质 |
|---|---|---|
| P0 | 9 | 数据静默丢失 / 假展示 / 无鉴权写入 / 交付与门禁不可信 |
| P1 | 12 | 信任边界缺口、可恢复性、性能悬崖、误导性指标 |
| P2 | 18 | 规格漂移、脱敏边界、可达性、文档失真 |
| P3 | 11 | 卫生项、观测噪声、小接口泄漏 |

---

## 1. P0（阻断级，建议按批次 25 一次性收口）

### P0-1 「记忆层级管理页」的编辑从未写回账本，而页面文案承诺写回 ✔

- 证据
  - `src/web/memory/MemoryLayeredPage.tsx:437` → `window.dispatchEvent(new CustomEvent('layered-memory-save', { detail: next }))`
  - 全仓检索字符串 `layered-memory-save` **只有这 1 处命中**（即 dispatch 自身），没有任何 `addEventListener` → 事件发出后无人接收。
  - `src/web/memory/MemoryLayeredPage.tsx:497-505` `save()` 只做 `setSaving(true)` → `onSave(...)` → `finally setSaving(false)`，没有 await、没有失败分支。
  - `src/web/memory/MemoryLayeredPage.tsx:456` 文案：**「L1–L6 直接可读可改（改后写回真实账本 + `memory_op` 审计）」**。
- 对照：另一条路径是真的 —— `src/web/memory/MemoryPage.tsx:60-69` 走 `coreUpdateContent(next.id, next.content)`（含 L0→L1 质量门、version+1、审计）。
- 触发：层级页 → 选记忆 → 改正文 → 点保存 → 按钮闪一下 → 内容回弹，账本与审计零变化。
- 影响：用户以为改掉了脱敏残留/错摘要，实际什么都没写。这是**数据静默丢失**，也是本项目 §7.1 诚实化与 §7.5 审计成对的双重违例。
- 修复方向：`onSave` 改调 `coreUpdateContent`（复用 P8 同一路径），失败显示内核原因；补一条单测「点保存 → 内核收到 content 且 version+1」。

### P0-2 日志页「审计全链路」弹窗是硬编码占位，却标注「真实审计记录」✔

- 证据：`src/web/logs/LogCards.tsx:99-113` `AuditModal` 不接收任何数据、不 fetch；`:107` 承诺「定位该 request_id 的全部审计行」；`:108` 渲染 `链路：{requestId}（真实审计记录）`。
- 触发：日志页任一 `request_id` → 「查阅审计」→ 弹窗永远只有一行文案、零条审计行。
- 影响：这是排障主入口，给用户「审计链就是这样」的错觉；同页 `:63`/`:68` 都把它当真实链路暴露。
- 修复方向：按 `request_id` 真查内核审计（`storage.queryAudit({ request_id })` 或 `audit:query` IPC），零行时显示「该 request_id 无审计行」而不是「真实审计记录」。

### P0-3 写页「五维查重」是同一个相似度分数的 5 条假刻度，且含 `llm_judge` ✔

- 证据：`src/web/write/logic.ts:55-65`

  ```ts
  const best = existing.map((e) => ({ e, s: jaccard(content, e.content) })).sort(...)[0];
  const s = best ? best.s : 0;
  const dims = { semantic: s*0.9+0.05, keyword: s*0.8+0.1, entity: s*0.7, structure: s*0.6+0.1, llm_judge: s*0.85 };
  ```

  五维全是单一天花板 `s` 的仿射变换；`composite`（`:66-68`）又是这五个加权和，因此排序/命中判定完全等价于一个 Jaccard。
- 呈现：`src/web/write/DedupCard.tsx:16-34` 把每维画成独立百分比条，标签写「semantic（35%）… llm_judge」，并输出「综合分 x / 阈值 y」。
- 影响：界面语言是「多维语义判定」，实际只有词面重合，而且**未接 LLM 却展示 LLM 仲裁维**。用户据「综合分」判断是否重复入库，判断依据是假的。
- 修复方向：二选一 —— ① 收缩成「本地词面相似度」单值，去掉 4 条假维度与 `llm_judge` 标签；② 接到内核真五维（单一真源 `src/core/memagent/layerRules.ts:46-52` DEDUP_WEIGHTS + `semantic/keyword/entity/structure/judge`），走 IPC 取真分。

### P0-4 Webhook 8203：本机任意进程可无鉴权写入，且 GET 端点回吐精炼正文 ✔

- 证据：`src/electron/main.ts:1460-1467` 闸门只在 `req.headers.origin` **存在时**才比对白名单（不带 Origin 的 curl / Node / 任意本机进程直接放行）；`:1469-1470` `let body = ''; req.on('data', (c) => { body += c; })` 无字节上限；`:1484-1488` `GET /ingest/status` 返回 `webhook.recentStatus(n)`，其元素含 `l2_preview`（`main.ts:1452` 取 `r.layers?.content_l2`）与 `mem_id`；`:1490-1494` `GET /ingest/hash` 可任意探测。
- 影响：① 本机任意进程无限写记忆 → 污染真实账本与所有派生指标（图谱、效果证据、成功率）；② 无上限 body → 大对象打满主进程内存；③ `status` 把 L2 正文给到进程外读取者（批次3 的 L1 脱敏不等于授权查阅）；④ hash 探测 = 幂等键预言机。
- 与既有设计不一致：MCP（8202/8204）在批次 2-D/2-E 已做令牌 + Origin + 1 MiB 上限；webhook 是同一信任面上**唯一没跟上**的入口。
- 修复方向：复用 `userData/mcp-token.txt` 做 Bearer/`x-mcp-token` 校验（无 Origin 也必须带令牌）、body 1 MiB 上限、`/ingest/status|hash` 只回 id 与状态、绝不回正文。

### P0-5 Agent 接入服务 8200：全部写端点零会话校验，`rotate-key` 明文返回密钥 ✔

- 证据：`src/agentOnboard/server.ts:134-144`（仅「带 Origin 且不在白名单」才 403，`OPTIONS`/无 Origin 放行）+ `:182-197`：`POST /agents`（建卡）、`POST /agents/:n/test`、`POST /agents/:n/rotate-key`、`POST /agents/:n/revoke-key`、`POST /discover`、`DELETE /agents/:n`、`GET /audit`、`GET /agents` 全部没有会话/角色检查（⚠ rotate-key 响应体明文密钥来自 `service.rotateKey`，`src/agentOnboard/service.ts:231-240`，本次未逐行复核）。
- 影响：本机任意进程可撤销/轮换真实 Agent Key、增删卡片、写 `auto_bind` 审计（直接伪造批次 21/22 的成功率与平均延时——它们就来自 `/audit`），并从 `/audit` 的 reason 里读到本机安装路径（⚠ `src/agentOnboard/probe.ts:32`）。
- 与既有权限模型冲突：AGENTS.md §5 规定「成员/密钥管理」仅管理员；但 8200 侧完全没有实现该门禁，只在 UI 层做了。
- 修复方向：写端点统一要求受信会话（`x-session-id` + 后端角色=admin，复用 `homeServerRef.getSessionContext`），或至少要求与 MCP 同源令牌；`GET /audit` 做正文/路径脱敏。

### P0-6 FileStorage：写盘失败时「内存已改、磁盘未改」，批量提交失败会整批丢失 ✔

- 证据：`src/core/memagent/fileStorage.ts`

  ```ts
  commitBatch() { if (!this.batching) return; this.batching = false; if (this.dirty) this.persist(); this.dirty = false; }   // :59-64
  putMemory(m) { this.doc.memories[m.mem_id] = m; this.touch(); }                                                               // :181-183
  close() { if (!this.open) return; this.commitBatch(); this.open = false; }                                                      // :230-234
  ```

  `persist()`（`:148-158`）为 stringify → tmp → fsync → rename。
- 两个缺陷：① `commitBatch` **先**置 `batching=false` 再 persist；persist 抛错时 `dirty` 仍为 true，但此后 `close()` 里的 `commitBatch()` 因 `!this.batching` 直接 return → 退出前不再尝试落盘，整批内存改动丢失。② `putMemory/appendAudit/deleteMemory` 都先改 `this.doc` 再写盘，写盘失败时内存保留新状态，要等下一次成功写入才被「顺带」落盘（磁盘处于半态，内存与账本不可分诊）。
- 触发概率不低：本机数据目录被宿主/索引器长期持有（批次 19/21 的打包 EPERM 就是同一现象的实测证据）、磁盘满、以及批次 19 起「打包前强制结束旧实例」这种 SIGKILL 路径。
- 修复方向：`commitBatch` 只在 persist 成功后清 `batching/dirty`；`putMemory/appendAudit` 采用「先写盘成功、再提交内存」或对 doc 做浅拷贝回滚；`close()` 落一条 `storage:close-commit` 动作日志（成功/失败都记），失败必须让调用方可见。

### P0-7 内核不可达被渲染成「记忆账本还是空的」✔（本页）/ ⚠（同形页）

- 证据：`src/web/memory/MemoryPage.tsx:32-40`

  ```ts
  void coreListMemories().then(...).catch(() => { if (alive) { setMemories([]); setLoaded(true); } });
  ```

  `:87-103` `loaded && memories.length === 0` → 「🗂️ 记忆账本还是空的 / 去「写入页」写下第一条记忆」。没有任何错误态、没有重试、没有 `error` 日志。
- ⚠ 同形（子审计定位，逐页复核后再统一改）：`src/web/Params/ParamsPage.tsx:33`、`src/web/monitor/MonitorPage.tsx:32`、`src/web/dispute/DisputePage.tsx:48`、`AgentConversationDemo.tsx:72`、`src/web/Home/coreHome.ts:201`。
- 影响：主进程繁忙、库被锁、hostBridge 3s 桥超时（该超时在批次 24 手测里已出现过）时，把本机 1642 行真账本说成空库；用户很可能「重新写一遍」→ 制造重复记忆。
- 修复方向：`useState<'loading'|'ok'|'error'>` 三态，错误态显示内核原因 + 「重试」；同时记 `ui:error` 动作日志。这条应做成共享件（19 页统一），别逐页各写一份。

### P0-8 批次 6–24 全部未提交：CI 与「verify 全绿」都不覆盖当前交付物 ✔

- 证据：`git log -1` → `e3bbf3d 2026-10-10 22:09:54 +0800 fix(web): 接真七页 tsc strict 修复…`；`git status -sb` → `## main...origin/main`（无 ahead/behind）；`git status --porcelain` 计数：`213 M / 94 ?? / 53 A / 45 AM / 28 D / 15 MM / 5 R / 3 AD / 1 RM`（≈457 项，其中含 `3 AD`＝已加入索引但工作树已删）。
- 影响：19 个批次的数据根、L0 密钥环、遗留账本清理、分页/列宽、dev 回退……在版本控制里**不存在**；无法 bisect、无法回滚、无法做代码取证；每个安装包只能靠 SHA256 自证，**无法对应任何源码版本**；CI 跑的仍是 10-10 的代码。
- 说明：本项需要用户授权才能动（记忆中「未获明确授权不得 commit/push」是硬约束），故本次只报告、不提交。
- 修复方向：建议按 6–12 / 13–19 / 20–24 三段提交（每段一条说明性 message），此后每次 `npm run package` 把 `git rev-parse --short HEAD`（或 `-dirty` 标记）写进手测报告与安装包元数据。

### P0-9 CI 首次推送即红：两道门禁在本地已实测不通过 ✔

- 证据
  - `python tools/validate_project.py` 退出码 **1**，唯一 FAIL：**「TC-013 未引用任何 AC 编号」**（另有 76 条 WARN：全部 `specs/MANUAL-TEST*.md` 缺 frontmatter `status`）。
  - `python tools/generate.py --check` → **不同步**：`build\SPEC.md`、`build\TRACE.md`、`build\SPEC.html`。
  - `.github/workflows/ci.yml:44-46` 与 `:52-54` 恰好把这两项设为阻断步骤。
- 结构性缺口（同属门禁可信度）：`ci.yml:41` 的 quality-gate 跑 `npm test`（**不含**覆盖率阈值与 `code:index:check`），CI **从不执行 `npm run build:electron`** → 主进程/IPC/preload 胶水在 CI 里连编译验证都没有；覆盖率与索引检查只在 `windows-gate`（`:70` verify:fast），而该 job 本身尚未提交（见 P0-8）。
- 修复方向：补 TC-013 的 AC 关联并跑 `generate.py`；给 MANUAL-TEST 文档补 `status`；CI 增加 `npm run build:electron`；quality-gate 改用 `verify:fast` 口径。

---

## 2. P1（高优，建议批次 26）

| # | 问题 | 证据 | 影响 / 修复方向 |
|---|---|---|---|
| 1 | `?backend=` / `?agentBackend=` 原样用作请求基址，登录把**明文密码** POST 过去 | ✔ `src/web/backend.ts:9-37`（无 scheme/host 校验）+ `src/web/Home/useLoginMirror.ts:55,61-68`（`body: JSON.stringify({account, password})`）；同族 `src/web/Home/useBackendMirror.ts`、`mirrorClient.ts:16` | 诱导打开带参 URL 即可收走凭据；假后端还能返回 `ok:true` 伪造登录态。**修**：`new URL()` 校验只允许 `http://(localhost|127.0.0.1):82xx`，白名单外回落默认值并记 `ui:error`。 |
| 2 | 数据面 IPC 无会话/角色门禁：任意受信页面可删记忆、**伪造审计** | ✔ `src/electron/main.ts:1051-1086`（`storagePutMemory/DeleteMemory/AppendAudit/QueryAudit/hostScanRun/hostAgentDetectRun` 全部裸调 storage）；`handleIpc` 只做 senderFrame URL 校验（`:993-1013`） | 一次渲染层 XSS 即可清空账本或写假 `memory_op/log_view`；`hostScanRun` 一次返回最多 200 个真实进程名（⚠ `src/electron/hostScan.ts:149`）。**修**：删除/审计写类通道纳入 `requireSession`，写审计类通道拒绝调用方自报 `request_id`。 |
| 3 | 租户身份完全由渲染层自报 | ✔ `src/web/kernel.ts:16,26-53`（`mam.tenant.v1`，缺省就现造 `u_xxx/team_local/ent_local` 并持久化）→ `:67-70` `kernelAccount()` | 改一个 localStorage 键即切换/冒充租户，跨租户隔离名义化。**修**：主进程按会话下发三元组，渲染层不得自报。 |
| 4 | 遗忘合并产出的摘要行缺 `embedding/sha256/content_l1/refined_by` | ✔ `src/core/memagent/forgetting.ts:166-183`（`layer:'L3'`，只给 `content`） | 语义召回对该行恒 0 分（§2.2 不变量 7 要求向量源自 L1）；按 L1 浏览看不到它；reconcile 会把它判成缺失。**修**：摘要同样过 `sanitizeL1` → 落 `content_l1` → `embedSync` → `sha256`。 |
| 5 | 内核审计只增不减，且非批量模式下每条审计 = 整库 stringify+fsync+rename | ✔ `fileStorage.ts:210-213`（`doc.audit.push` + `touch()`）+ `:148-158` | 每次 IPC 全量序列化；本机库已 25 MB 级 → 写放大 O(n²)，UI 卡顿与掉电风险同步上升。**修**：审计独立追加文件（或批量模式内攒批），并设归档/轮转策略。 |
| 6 | 窗口创建失败后 `return`，不走 `handleBootFailure`、不退出 | ✔ `src/electron/main.ts:1697-1713` | 无窗口但进程存活并持有单实例锁 → 用户表现为「双击没反应」，只能靠杀进程恢复，且日志仅一行 `bootstrap:window-failed`。**修**：`dialog.showErrorBox` + `app.quit()`。 |
| 7 | `npm run test:e2e` 强杀 9222 占用者的整棵进程树 | ✔ `e2e/global-setup.mjs:81-91`（`taskkill /PID <pid> /T /F`） | 若用户自己的 Chrome 开着 `--remote-debugging-port=9222`，测试会连其标签页一起杀（含未提交表单）。**修**：改为自己随机端口启动，或先校验进程路径属于本仓库 Playwright 缓存。 |
| 8 | 备份配置目录未校验 + 在该目录内盲删 `memories-*.json` | ⚠ `src/electron/main.ts:548`（`cfg.dir`）、`:440-443`（`unlink`），UNC 仅在数据根路径校验（`src/electron/dataRoot.ts:140`） | 管理员配错目录 → 删除该目录下同名文件。**修**：写入前做与数据根同规格的绝对路径/白名单校验，删除只针对本次生成的确切文件名。 |
| 9 | 角色/团队变更、改密不吊销既有会话 | ⚠ `src/home/server.ts:323`（登录时快照角色）+ `src/electron/main.ts:521-533`（`requireAdmin` 读快照）+ 12h TTL | 撤权后旧会话最长 12h 仍是管理员。**修**：`role_change/password_change` 时按 user_id 清 session 表（批次 2 已为登出做过同类修复）。 |
| 10 | MCP 单令牌 = 全局超权；`project_id` 归属校验存疑 | ⚠ `src/core/memagent/mcpAuth.ts:14-18`、`mcpHttp.ts:125-127`、`mcpRecall.ts:54-70`（批次 2-F 已实现租户闭包，项目维度是否覆盖需复核） | 拿到令牌即可读任意项目记忆。**修**：令牌绑定 enterprise/team 作用域，recall/write 强制过滤。 |
| 11 | 管理员 L0 查阅只校验会话、不校验管理员；`pbkdf2Sync(100k)` 在主进程同步执行 | ⚠ `src/electron/main.ts:781-788`、`src/core/memagent/crypto.ts:82-86` | 前者可能让非管理员凭密码取到 `scope:['*']`；后者每次解锁阻塞主进程数百 ms（IPC 全停）。**修**：查阅走 `requireAdmin`；KDF 挪到 worker 或降轮数并记录。 |
| 12 | 采集器在 L0 锁定/写失败时按 5min 周期无限重试、无退避 | ⚠ `src/electron/main.ts:1540-1650` | 长期空转写日志、反复触发锁定错误。**修**：指数退避 + 上限 + 一条 `collector:backoff` 日志。 |

---

## 3. P2（应修，批次 27）

1. ✔ **查重阈值两份真源且已经漂移**：内核 `layerRules.ts:41-43` L5=**0.90**，写页 `src/web/write/spec.ts:24` L5=**0.88**；层级页 `MemoryLayeredPage.tsx:21` 又把 L5 标成 0.90。同一内容在不同页得到不同判定。→ 渲染层改为从内核常量导出（单一真源原则，见记忆 layer-rules-hardcoding）。
2. ✔ `coreBrowse` 不校验 `layer`：`src/core/memagent/memories.ts:355-358` 的 `FIELD` 表外值 → `m[undefined]` → 过滤掉全部行，**仍写一条 `log_view` 成功审计**（`:367-371`）。→ 非法 layer 直接 `E_BAD_LAYER`。
3. ✔ `webhook` 降级分支自相矛盾：`webhook.ts:139-147` 未注入 pipeline 时返回 `ok:true/dedup:'new'`、error 文案说「L0 明文落库」，实际**什么都没写**，却把 hash 记进幂等索引（`record()` 判定 `result.ok && dedup!=='error'`，`:66`）→ 同内容永久 `duplicate`。桌面接线注入了 pipeline（`main.ts:1436`），故当前不可达，但作为库契约是错的（`webhook.test.ts:172-179` 反而把该行为固化为期望）。
4. ⚠ `refined_by='llm'` 只要任一层有产物就标记（`memories.ts:239`）→ 部分 LLM 产物冒充全量。
5. ✔ `sanitizeL1`（`layerRules.ts:97-157`）是逐行正则集合：跨行拼接、Base64、全角字符、拆词（`C o o k i e`）等形态不在覆盖内。→ 报告口径需写明「不是语义识别」，并在 AGENTS §9 已有该限制，但缺对抗样本。
6. ⚠ 损坏库通知只进日志：`main.ts:1300-1301` 消费 `.corrupt-notice.json` 后没有 UI 弹窗/页面横幅（批次 3-D 的意图）。
7. ✔ 项目 ID 硬编码 `'P1'`：`src/web/memory/coreMemoryOps.ts:231-248`、`src/web/write/WritePage.tsx:16`、`src/web/logs/LogCards.tsx:143`（L0 申请默认项目）。真实项目应来自 `list_projects`。
8. ⚠ 无跨进程锁：两个实例（安装包 + 便携版）指向同一数据根时会互相覆盖整库 JSON。
9. ⚠ `sync.ts:218-350` 一旦接线会放大 4/5 两条缺陷（摘要行无向量 + 审计无限增长）。
10. ⚠ 日志脱敏有洞：`src/shared/actionLog.ts:61-77` 只对「键名命中敏感词」脱敏，数组元素与无键值不查；`:102-105` 把 `scope:action` 原样插进一行，配合 `log:write` 接受任意 scope/action（`main.ts:1037-1044`）→ 可注入伪造行/换行伪造记录。
11. ⚠ `actionLog.ts:141-143` 尾读用 `Buffer.allocUnsafe` 且忽略 `readSync` 返回长度 → 未初始化堆内存可能在短读时进 UI 日志。
12. ⚠ `main.ts:937` `decodeURIComponent` 未捕获 `URIError`（畸形 % 序列直接抛）。
13. ⚠ 主进程同步子进程调用：`main.ts:1140-1143`、`src/electron/agentDetect.ts:109-120`（`execSync/execFileSync`，PowerShell 枚举窗口）→ 界面卡顿。
14. ⚠ 本机凭据面：`localOrigin` 放行无 Origin 请求 + 默认口令 `admin/Admin@123456`（⚠ `src/auth/loginService.ts:17`）+ 锁定仅按账号计数且锁定文件可删 → 本机暴力尝试无速率上限。
15. ⚠ 令牌文件保护在 Windows 无效：`main.ts:306` `mode:0o600`；`src/electron/mcpClients.ts:144-150` 每次写入生成含 `Authorization: Bearer …` 的 `.bak-<ISO>` 副本且从不清理，另有 `.tmp-<pid>` 残留。
16. ⚠ 无 `Host` 头绑定（`src/home/localOrigin.ts:41-52`）→ DNS rebinding 后浏览器脚本可读本机服务。
17. ⚠ 验证码 `Map` 无上限、`code` 直接回给调用方（`src/home/server.ts:302-311`）；注册无上限 + `scryptSync` 同步 + 全文件写（`:157-172,286-298`、`src/auth/hash.ts:18,38`）；用户名可枚举（`:332-334`）。
18. ✔ **文档漂移（会误导维护者）**：`AGENTS.md:121` 与 `specs/code-map.md:208` 仍写「只读最近 20 条（窗口显示 5 行）」，真实实现是 `src/electron/actionLog.ts:131` `TAIL_MAX_LINES = 50`（AGENTS §4 自己已改成 50，两处矛盾）；⚠ `specs/test-plan.md:85` 写 99 文件/941 用例，实际 115/1204；⚠ `tools/code-index.mjs:82-133` 的新鲜度门禁只比符号与行数，单行改动（正是 P0-1 那种）照样通过。

---

## 4. P3（卫生项）

1. ⚠ `agent.ts:28` 与 `:157` 重复硬编码 Token 预算字面量；`agent.ts:315-344` `_seedMemory` 挂在公开接口上，绕过质量门与 L0 门禁。
2. ✔ `l0_session_id` 落进内核审计（`memories.ts:382` 等 `detail.l0_session_id`）——与「session 不进审计」的自订规则相冲突（§7.4）。
3. ✔ `legacyLayers.ts:92-108` 降级时不刷新 `layers_generated_at`、不清 `grafted_from` 悬空引用（批次 24 遗留，实测无错误降级路径，但层级时间语义会不一致）。
4. ⚠ `log:write` 之外，`l0:seal`（`main.ts:826-829`）、`mcp:clients`（`main.ts:609`）无会话校验。
5. ⚠ `src/desktop/hostBridge.ts:140-149` 去重只按消息 id → 可被预测 id 顶掉。
6. ⚠ `isTrustedUrl` 的 `file:` 分支在 Windows 上永不命中（`main.ts:967-971`）。
7. ⚠ 轮转文档与实现不符：AGENTS 说 `.1…3`，`keep=3` 实际产出 `.1/.2`。
8. ⚠ 打包前 `Stop-Process` 绕过 `before-quit` 的 L0 上锁与 `close()` 提交（与 P0-6 叠加；下次启动路径可自愈）。
9. ⚠ `tools/dev.mjs:129` 把 `agentBackend` 写死 8200；`:104-137` 端口探测存在 TOCTOU（探测与 spawn 之间可被抢）。
10. ⚠ 无 `engines` 字段（package.json），Node 24 与 TS 7 的版本要求只散落在文档。
11. ⚠ 覆盖率小数漂移（文档 80.58/77.61/73.06/69.59 vs 实测 80.61/77.62/73.11/69.58）；`floatattribution.html` 无测试却在 vite 入口里。

---

## 5. 复核确认「干净」的部分（请勿顺手改）

以下均亲自读过码，是对的，报告出来是为了避免后续整改误伤：

- ✔ 召回预算：初始与冷回填两条路径统一 `applyHardCap`（`src/core/memagent/agent.ts:96-138`）。
- ✔ `sync()` 诚实：写 `implemented:false` 审计后抛 `E_NOT_IMPLEMENTED`（`agent.ts:252-262`）；`SyncHub/PgSyncHub` 仅被 `__tests__` 引用，无「假装已同步」路径。
- ✔ L0 一次性密码不可复用（`l0vault.ts:594-598`）；`legacy:demote` / L0 迁移都是 `requireAdmin` + 强制先备份（`main.ts:833-867`）。
- ✔ 合并分组键含租户三元组，跨项目绝不合并（`forgetting.ts:144-151,248`）。
- ✔ 损坏库处理成对：`load()` 备份 `.corrupt` + 显式抛 `StorageCorruptError` + sidecar 通知（`fileStorage.ts:66-145`）。
- ✔ IPC 统一有 senderFrame 来源校验与耗时日志（`main.ts:993-1030`）；`openMemoryFile` 的 memId 白名单正则挡住路径穿越（`main.ts:1061`）；数据根迁移只复制不删源（`dataRoot.ts:262-317`）；指针损坏/缺失走交互询问而非静默换库。
- ✔ 打包卫生：`electron-builder.config.cjs:20-25` 只收 `dist/`、`dist-electron/`、`package.json`；`package-builder` 清理只匹配 `release\` 下的可执行文件。
- ✔ 播种管理员绝不覆盖已有 admin 口令（`loginService.ts:121-139`，⚠ 该行由子审计给出）；注册格式规则使 `admin` 不可能被普通注册占用；所有服务绑定 `127.0.0.1`；无外发 fetch → 无 SSRF。
- ✔ 批次 24 的新测试是真测试：正常/拒绝/边界三条路径齐备，`src/web/__tests__/backend.test.ts:62-68` 的端口字面量扫描是好设计；分页/列宽/`loadSeq`/`inFlight`/60s 补扫复用等实现与文档一致，无「假门禁」。

---

## 6. 建议整改顺序（等你拍板后再动手，每批照旧：门禁 → 打包 → 手测报告 → 索引）

- **批次 25「假展示与静默丢失」**：P0-1、P0-2、P0-3、P0-7（+同形页）、P0-6。这批全是用户可感知且会造成错误决策/数据丢失的，改动面小、可测。
- **批次 26「本机信任边界」**：P0-4、P0-5、P1-1（`?backend=` 白名单）、P1-2、P1-3、P1-9、P1-10、P1-11、P2-14、P2-15、P2-16、P2-17。
- **批次 27「可维护性与门禁可信度」**：P0-8（需你授权提交）、P0-9、P2-1、P2-2、P2-3、P2-4、P2-5、P2-7、P2-10、P2-18、P3 全部。
- **单独立项**：P1-4/P1-5（内核摘要行与审计增长）建议与「真实 LLM Provider 接入」一起设计，否则接真 LLM 后问题会放大。

---

## 7. 已知限制（本次审核自身的边界，不让你猜）

1. 纯静态读码 + 只跑了两条命令（`validate_project.py`、`generate.py --check`）与 git 状态查询；未运行完整 `verify`，未运行 E2E，未改任何文件（含本报告之外的文件）。
2. ⚠ 标记项来自子审计的代码证据，我未逐行复核，动手前请回读该行。
3. 分支保护、GitHub Actions 历史（`windows-gate` 是否曾绿）无法确认——本机 `gh` 未认证。
4. 本机真账本 1642 行的「遗留 stub 层级」清理（批次 24 交付物）至今**未在真实数据上执行**，本报告不改变该状态。
