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
