# 项目状态快照（压缩上下文 · 新会话直读）

> 新会话只需读 `meta/index.md` + 本文件即可接手，无需重读全部文档，省 token。

## 一句话定位
本工作区 = **工作法体系** + 真实项目「**多 Agent 记忆助手**」（需求规格与原型已结构化并跑通首个功能）。

## 核心规则（压缩）
1. 常驻只 `meta/index.md` + `meta/charter.md`
2. 按需加载、外科编辑（不整篇重写）
3. 改完跑 `python tools/validate_project.py` + 测试，必须全绿
4. 一切 Git 化、PR 化
5. `specs/` 为单一事实来源（SSOT）

## 推荐流程（11 步）
需求提出与收集 → 需求分析与评审 → 产品与交互设计 → 技术方案设计 → 项目计划与任务拆分 → 编码开发 → 测试验证 → 预发布与验收 → 发布上线到生产 → 生产运维与监控 → 反馈与迭代

## 产物清单（压缩）
- **工作法**：README / PLAYBOOK / SOFTWARE_DEV_STEPS / meta/*（SOP 全套）/ tools/*（validate+generate+init+import）
- **真实项目资料（已归位，状态 imported）**：`specs/` 13 份「需求规格书_*.md」；`design/ui/` 12 个原型 HTML；`meta/文档章节索引.md`
- **已结构化**：12 条 REQ + 12 条 AC + 12 条 TC（全部互链），`specs/code-map.md` 连「需求→原型 HTML」；`generate.py` 产出 `build/`

## 现状（压缩 · 2026-10-07 更新）
- **远端**：已推 GitHub `https://github.com/WWLHQ/memory`（默认分支 `main`），GitHub Actions 三道门禁（`npm test` / `validate_project.py` / `generate.py --check`）。
- **CI 真实生效已验证**：首跑 push 因 `build/` 未生成（`--check` 红）被拦 → 修 ci.yml「先 `generate` 再 `--check`」→ PR #1 合并 → push 与 PR 双触发均 **success**。证明门禁能拦错也能过。
- **REQ-003 编码完成（逻辑层 100%）+ 真实后端全链路已接入（T13/T14/T15）**：T1–T12 全落地；T13 零依赖 HTTP 后端（`server.js`，JSON 持久化 `.data/`，提交 `554e20f`）；T14 HTTP 客户端（`client.js` + `service.js` 注入点 + `app.html` 后端地址配置，提交 `62eb3be`）；T15 升级 `e2e.test.js` 为"起真实服务 + T14 注入点跑全链路 + 持久化跨重启"（提交待 push）；`npm test` **50/50 绿**；`specs/code-map.md` 已补映射（本地提交 `94ecf71`）。
- **UI 已严格对齐原型（2026-10-07 重写）**：用户在 `REQ-003` 指出实现与原型 `design/ui/Agent接入页_原型.html` 不一致 → 已重写 `render.js`/`browser.js`/`app.html` 严格逐字段/逐交互对齐原型：暗色主题、`.card/.metrics/.row/.sw/.pill` 等 class、`.found/.gain`、`.toast`、`btnDiscover`+`.stages` 四段动画、`.sig` 信号源+`applyForm` 19.10 端置灰、`data-tool/data-iso/data-chan/data-act/data-rid/data-unbind` 全交互；`render.js` 导出 `renderCard/renderFound/renderGains`（proto 形状）。`npm test` **52/52 绿**，`validate`+`generate --check` 通过。`browser.js` 内置真实后端镜像（隐藏 `#backend` 默认 `localhost:8200`，best-effort 调 T13，不改变原型视觉与同步交互）。
- **完成度边界（重要）**：① 实现=**TS 内核 + React 19 UI**（Vite 构建），**已与规格完全对齐，方案级差异已消除**（2026-10-07 用户拍板走B 方案并完成迁移）；② 真实后端=**可选镜像**：`useBackendMirror.ts` 默认 `http://localhost:8200`（`?backend=` 可覆盖），fire-and-forget，不改原型视觉与同步交互；③ E2E 分两层：`npm test`（vitest 71 例，逻辑 + 组件 + 页面集成）与 `npm run test:e2e`（Playwright 7 例真浏览器点击级，被测对象为 `dist/` 真实构建产物 + 真实后端 :8200）。
- **门禁命令**：`npm run verify` = `typecheck`(tsc --noEmit, strict) → `test`(vitest) → `validate_project.py` → `generate.py --check`。CI 已加 `npm ci` + `typecheck` + vitest + e2e job。
- `npm test` **71/71绿**（新增 28 例：AgentCard 10 + 其余组件 11 + 页面集成 7）。
- **提交约定**：每次提交必须写提交日志（conventional commit，见 MEMORY.md）；T3–T12 已在 initial commit `04cb27b` 打包，决策**不重写历史**、改 code-map 标注任务归属。
- **已推**：2026-10-07 通过 SSH（`git@github.com:WWLHQ/memory.git`，密钥 `C:\Users\LHQ\.ssh\id_ed25519_github_push`）将本地 12 个提交全部推上 `origin/main`（含 `947353f`、`554e20f`…`c7c1476`），`git fetch` 后 `ahead 0` 确认同步。备注：本沙箱出网仅 SSH(22) 可达 GitHub，HTTPS(443) 被本地代理封死；`.workbuddy/memory/` 仍为未跟踪（agent 工作记忆，按需提交）。

## 下一步
- 候选：① 接真实后端（替换 `service.js` 内存为 API）；② 真浏览器 E2E（Playwright 跑 `app.html`）；③ 确认 JS 方案并更新规格消除偏离；④ 推进 REQ-004~REQ-012（补 AC/TC + 跑通一个功能）。
- 推远端需 PAT(repo+workflow)，或用户本机 `git push`。

---

## 流程固化（2026-10-10 更新）

- **全生命周期工作流已固化为强制 SOP**：新增 [`meta/WORKFLOW_SOP.md`](WORKFLOW_SOP.md)（主流程），
  串起 `TASK_SPLITTING`（任务长什么样）→ `CODING_SOP`（单任务 7 步）→ **自检门禁** → 人工验收 → 提交 → 收尾。
- **铁律（已验证）**：交人验收**之前**必须先在本机跑绿 `typecheck + vitest + e2e(--workers=1) + verify`，
  E2E 不得出现静默 SIGTERM；门禁全绿 + 人点头后才 commit（中文 message，一个任务一个 commit）。
- **当前真实项目状态（2026-10-10）**：REQ-003/004/005 + 用户注册已**编码完成并经人工验收通过**，
  自检全绿（`npm test` 178/178、`npm run test:e2e` 24/24、`npm run verify` 通过）。
  关键修复沉淀于 `.workbuddy/memory/pitfalls-2026-10-09.md`（#1~#13，含 vitest vmThreads、npm arborist、
  jsdom window.location、E2E SIGTERM 三层根因、登录门控脱节、CORS 白名单漏头真实 BUG）。
  全部改动已提交（最新 `b4d0f78`，14 文件）。
- **下一步待选 REQ**：REQ-012 检索页 / REQ-011 日志记录页 / REQ-006 其余页面（用户已选「先人工验收再开发」节奏）。

---

## REQ-006 子页批量（2026-10-10，待人工验收 · 挂起）

- **P8 记忆管理页 / P2 写入页 / P11 审计日志页 / P4 生命周期页** 均已按固化流程走完 ①拆分(T1–T5) → ②编码 → ③自检门禁全绿；
  **用户暂不方便验收，四页挂起、未提交**（验收通过后按 ⑥ 各自中文 commit）。
- **新增入口**：`memory.html` / `write.html` / `audit.html` / `lifecycle.html`（Vite 多入口 7 个）；
  Overview 已落地视图 3→7（memory/write/audit/lifecycle 加入，audit 已从 PLANNED 移除）。
- **任务拆分文档**：`specs/tasks/{MEMORY-MANAGE,WRITE-PAGE,AUDIT-LOG,LIFECYCLE}.md`。
- **P4 生命周期页覆盖**：六态机(9.10)迁移 + 调参面板(17.4/17.5，locked 全置灰 G4，freshness=0.5^(age/hl) 实时预览) +
  deprecated 替代跳转(9.7) + N/M(90/180)参数 + 批量迁移(9.10.4，写审计 lifecycle_change + request_id)。
- **自检门禁（全绿）**：`typecheck` ✅；`vitest` **302 例**（P4 34 + memory 33 + write 27 + audit 28 + 其余）；`validate` 0 失败；`generate --check` ✅；e2e 单 spec 全绿（memory 4 / write 3 / audit 4 / lifecycle 4）。
  ⚠ 全量 e2e 中 `app.spec` 因 :8200 被手动验收用的 dev backend 占用而 EADDRINUSE —— 环境耦合非回归，停 backend 后全绿。
- **本地预览**（vite dev + home backend 已起）：`http://localhost:5180/{memory,write,audit,lifecycle}.html`。
- **新增坑**：Playwright strict mode 下同 request_id 多行的 testid 必须带行索引；同文案多处出现时断言改用 getAllByText/first。

## 简写对照（中文）
| 简写 | 中文 | | 简写 | 中文 |
|------|------|---|------|------|
| SSOT | 单一事实来源 | | PR   | 合并请求 |
| REQ  | 需求 | | CI   | 持续集成 |
| AC   | 验收标准 | | UI   | 用户界面 |
| TC   | 测试用例 | | SOP  | 标准作业程序 |
| TDD  | 测试驱动开发 | | DAG  | 有向无环图 |
| ADR  | 决策记录 | | BUG  | 程序缺陷 |
| DoD  | 完成定义 | | E2E  | 端到端测试 |
