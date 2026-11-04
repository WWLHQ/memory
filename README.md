# 本项目怎么用（使用入口）

一套用 AI Agent 协作、低 token 消耗、易维护、可校验的项目工作法。
完整方法论见 [`AI_AGENT_PROJECT_PLAYBOOK.md`](AI_AGENT_PROJECT_PLAYBOOK.md)，日常 SOP 见 [`meta/MAINTENANCE.md`](meta/MAINTENANCE.md)，软件生命周期步骤见 [`SOFTWARE_DEV_STEPS.md`](SOFTWARE_DEV_STEPS.md)。

## 简写对照（中文）
| 简写 | 中文含义 |
|------|----------|
| SSOT | 单一事实来源 |
| REQ  | 需求 |
| AC   | 验收标准 |
| TC   | 测试用例 |
| ADR  | 决策记录 |
| DoD  | 完成定义 |
| NFR  | 非功能需求 |
| TDD  | 测试驱动开发 |
| PR   | 合并请求 |
| CI   | 持续集成 |
| UI   | 用户界面 |
| SOP  | 标准作业程序 |
| BUG  | 程序缺陷 |

---

## 30 秒上手

```bash
# 1) 克隆/进入项目后，先看全貌（只读索引，不加载全文）
cat meta/index.md

# 2) 每次改动后跑门禁（必须 0 失败）
python tools/validate_project.py
```

---

## 运行应用与门禁（本项目实际命令）

```bash
npm install                 # 安装依赖（Node ≥22.13）
npm run dev                 # 一键开发：自动拉起本机登录后端 + Vite 127.0.0.1:5180（浏览器登录开箱可用；演示账号 user_001 / demo1234）
                            #   默认端口被安装版桌面端占用且不信任 5180 来源时，批次24 起自动换备用端口（8211→8215）另起受信服务，
                            #   并直接以 ?backend= 打开页面，无需先关闭桌面端
npm run dev:backend         # 仅本机登录/mirror 服务（默认 8201，可 PORT=8211 另起），供 npm run dev 复用或单独联调
npm run package:win         # 便携目录 release/win-unpacked/
npm run package             # NSIS 安装包 release/installer*/

npm run verify:fast         # typecheck + lint + 索引新鲜度 + 覆盖率单测（2026-11-04 实测 149 文件 / 1754 例；每批都变，以本命令输出为准）
npm run verify              # verify:fast + Electron 构建 + Playwright E2E（22 个 spec / 106 例，`ls e2e/*.spec.ts` 现查）
npm run lint                # oxlint 静态检查（correctness 规则，0 error 通过）
npm run test:coverage       # vitest + v8 覆盖率（阈值门禁见 vite.config.ts）
npm run code:index -- --write   # 刷新 specs/code-index.generated.md（导出符号索引，便于定位）
```

开发/维护前先读 [`AGENTS.md`](AGENTS.md)：目录地图、改哪里、动作日志格式与排查、权限模型、门禁与交付要求。

## 管理员与诊断日志（批次7）

- 内置管理员：`admin` / 初始密码 `Admin@123456`（首次启动自动播种；登录后在「账号与安全」页修改，已有管理员密码不会被覆盖）。
- 仅管理员：更改/恢复数据根、备份配置与立即备份、密码策略、成员与密钥管理、账号角色与团队分配；普通成员访问其余页面，敏感入口显示「需管理员」。
- 动作日志：数据根下 `actions.log`，一行一个动作，格式 `[ISO] [level] [scope:action] [requestId] {json}`，覆盖 UI 点击/提交/页面进入、宿主桥、IPC、HTTP、备份/数据根/内核动作；密码/令牌/密钥自动脱敏，5 MiB 轮转保留 3 份。其它日志：`main.log`、`float.log`、`home-audit.json`、`home-mirror.json`。

手测流程见 [`specs/MANUAL-TEST.md`](specs/MANUAL-TEST.md)；各批次修复与验收结论见 `specs/MANUAL-TEST-FIX-BATCH-*.md`。

---

## 已有项目怎么纳入

老项目不想重写？看 [`meta/MIGRATION.md`](meta/MIGRATION.md)：先 `init_project.py` 种骨架（不动源码），再让 Agent **逆向**补全 `specs/`（把现有功能提炼成 REQ/AC/TC）+ `code-map.md`（文件→函数→测试），BUG 立即可定位；新改动走新流程，旧代码碰才改。

若手上是一堆**散落的资料**（需求规格 / 原型 HTML / 章节索引），用导入器一键归位：
```bash
python tools/import_legacy.py <资料目录> <目标目录> "项目名" "目标"
```
`*原型*.html → design/ui/`、`需求规格*.md → specs/`、`*索引*.md → meta/`、临时文件 → `_legacy/`，并生成索引 + 跑门禁。

## 在新项目里初始化（一键生成骨架）

在**本仓库内**运行，把骨架生成到你的新项目目录：

```bash
python tools/init_project.py "D:/path/to/你的新项目" "项目名" "一句话目标"
```

它会自动创建 `meta/`、`specs/`、`tools/`、`.github/workflows/ci.yml`、`.gitignore`、README，并跑一次门禁校验。
之后到新项目的会话里，用上面那段「开场白」即可开工。

## 目录结构

```
meta/        # 常驻上下文：index(契约) + charter(宪章) + decisions(ADR) + MAINTENANCE(本SOP)
specs/       # 单一事实来源：requirements / acceptance / test-plan（REQ/AC/TC 编号）
design/ui/   # UI 原稿，每页一个文件
samples/     # 示例程序，按模块拆分
build/       # 由 specs 生成的产物（可丢弃重建）
tools/       # validate_project.py 完整性校验门禁
```

---

## 与 Agent 协作：每次会话的开场白（直接复制）

> 把下面这段作为每次新对话的第一条消息发给 Agent：

```
你是本项目（<项目名>）的协作者。请严格遵守工作规则：
1. 每次先只读 meta/index.md 和 meta/charter.md，不要加载其他文件，除非本次任务明确需要。
2. 改动时只打开相关文件，做外科手术式局部编辑（Edit），不要整体重写。
3. 需求/验收/测试用 REQ-/AC-/TC- 编号互相引用，一一对应。
4. 改完运行 python tools/validate_project.py，必须 0 失败才能交付。
5. 新增产物文件必须在 meta/index.md 登记。
6. 长对话中把已定决策和待办压入 meta/decisions.md 和 CHANGELOG.md，丢弃早期原文。
请先读 meta/index.md 和 meta/charter.md，确认理解项目范围，然后等我的具体任务。
```

---

## 端到端使用流程（从 0 到一个可上线的模块）

1. **开会话**：发上面那段「开场白」，Agent 只读 `meta/index.md` + `meta/charter.md` 接手（省 token）。
2. **计划与任务拆分**：让 Agent 按 [`meta/TASK_SPLITTING.md`](meta/TASK_SPLITTING.md) 的 8 属性拆任务，填写进 `specs/tasks/*.md`（参考 [`specs/tasks/USER-REGISTER.md`](specs/tasks/USER-REGISTER.md)）。
3. **编码**：逐个任务按 [`meta/CODING_SOP.md`](meta/CODING_SOP.md) 执行（领任务 → 读输入 → 先写失败测试 → 外科实现 → 跑验收 → 跑门禁 → 单 commit）。
4. **重建产物**：改完 `specs/` 跑 `python tools/generate.py`，刷新 `build/`（文档 + 可追溯矩阵 + HTML 报告）。
5. **门禁**：`python tools/validate_project.py` 必须 0 失败。
6. **提交 + CI**：一个任务一 commit；push / PR 触发 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 自动校验，红则修。
7. **出 BUG**：按 [`meta/DEBUG_READINESS.md`](meta/DEBUG_READINESS.md)（事前准备）+ [`meta/BUG_SOP.md`](meta/BUG_SOP.md)（事中流程）定位并修复，更新 `known-issues.md` / `CHANGELOG.md`。

> 全程纪律见 [`meta/MAINTENANCE.md`](meta/MAINTENANCE.md)；完整 11 步流程见 [`SOFTWARE_DEV_STEPS.md`](SOFTWARE_DEV_STEPS.md)；压缩上下文（新会话直读）见 [`meta/STATE.md`](meta/STATE.md)。

## 日常操作指令模板

**改一条需求**
```
修改 REQ-001 的口径：把"账号密码登录"改为"支持手机号+验证码"。
只改 specs/requirements.md 和对应的 AC/TC，不要动其他文件。改完跑校验。
```

**新增一章（如加一个需求）**
```
新增一条需求 REQ-003：登录失败 5 次锁定 10 分钟。
在 requirements.md 加 REQ-003，并在 acceptance.md / test-plan.md 同步加 AC-003 / TC-003。
改完跑 python tools/validate_project.py 至全绿。
```

**新增一个 UI 页面**
```
新建 design/ui/03-profile.html 个人主页原型，并在 meta/index.md 登记。
```

**删除一章**
```
删除 REQ-002。先删 requirements.md 中的 REQ-002，再按校验器提示清理关联的 AC/TC，直到校验全绿。
```

**排查漂移/错误**
```
validate_project.py 报红了，按报告定位到具体文件和 ID，做最小修复，再跑到全绿。
```

---

## 门禁命令

```bash
python tools/validate_project.py     # 完整性/正确性，0 失败=可合入
python tools/generate.py             # 从 specs/ 重建 build/（文档+可追溯矩阵+HTML 报告）
python tools/generate.py --check     # CI 校验：build/ 是否与 specs 同步，不同步退出 1
git add -A && git commit -m "REQ-003: ..."   # 每次改动提交
```

---

## 接 CI（可选）

把 `python tools/validate_project.py` 放入流水线，退出码非 0 即阻断合入，
保证任何提交都不会破坏"索引契约 / 编号对应 / 引用完整"。

## CI/CD

门禁已可接入流水线，见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。每次 push / PR 自动跑：

1. Ubuntu `quality-gate` —— typecheck + oxlint + vitest + `validate_project.py` / `generate.py --check`
2. Ubuntu `e2e` —— Playwright（spec 数 = `ls e2e/*.spec.ts | wc -l`，2026-11-04 为 22 个）
3. Windows `windows-gate` —— `verify:fast`（类型 + lint + 单测 + 覆盖率阈值）

若第 2 步失败，本地跑 `python tools/generate.py` 重新生成并提交 `build/` 即可。
真实项目的测试命令（如 `npm test`，即各原子任务的验收命令）加进同一 workflow 即可。
