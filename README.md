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

1. `python tools/validate_project.py` —— 完整性 / 正确性，红则阻断合入
2. `python tools/generate.py --check` —— 校验 `build/` 与 `specs/` 同步

若第 2 步失败，本地跑 `python tools/generate.py` 重新生成并提交 `build/` 即可。
真实项目的测试命令（如 `npm test`，即各原子任务的验收命令）加进同一 workflow 即可。
