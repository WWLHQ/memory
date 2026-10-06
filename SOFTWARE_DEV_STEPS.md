# 软件开发详细步骤（AI Agent 协作版）

> 把 `AI_AGENT_PROJECT_PLAYBOOK.md` 的原则落到真实软件生命周期。
> 贯穿纪律：**SSOT（specs 单一事实来源）+ 模块化（每模块一上下文）+ 外科手术式编辑 + 校验/测试门禁 + Git 可回滚**。
> 配套 SOP 见 `meta/MAINTENANCE.md`，门禁见 `tools/validate_project.py`。

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

## 阶段 0：初始化（一次性）
- 建仓库、目录结构、`meta/index.md` + `charter.md`、校验脚本、CI。
- 产出：可运行骨架（本项目已具备）。
- 门禁：跑一次 `validate_project.py` 全绿。

## 阶段 1：可行性 & 需求（specs/）
- `feasibility.md`：技术可行性、成本、风险。
- `requirements.md`：列 `REQ-xxx`，含**功能需求 + 非功能需求（NFR：性能/安全/合规）+ 约束**。
- 协作：Agent 只动 specs，编号 REQ；重大取舍写 ADR（`meta/decisions.md`）。
- 门禁：validate（编号唯一、引用完整）。

## 阶段 2：架构设计（meta/architecture.md）
- 模块划分：**每个模块 = 一个目录 = 一个独立上下文**（直接决定后期 token 与 BUG 范围）。
- 定义模块间接口/契约（API、数据结构、边界）。
- 产出 `architecture.md` + 模块清单（登记进 `index.md`）。

### 任务拆分（对应流程第 5 步：项目计划与任务拆分）
架构定好后，把每个模块拆成**可独立验证的原子任务**（规范见 [`meta/TASK_SPLITTING.md`](meta/TASK_SPLITTING.md)）。每个原子任务必须具备 8 项属性：单一目标、输入明确、输出明确、验收可执行（一条命令）、修改边界清晰、依赖明确、上下文可控（相关文件 ≤ 窗口 30%~50%）、可独立提交 / 回滚。填写示例见 [`specs/tasks/USER-REGISTER.md`](specs/tasks/USER-REGISTER.md)。

## 阶段 3：详细设计（per-module）
- 每个模块一份 design：流程、状态、错误码、边界条件。
- **接口契约先行**：先定输入输出，再写实现。
- 协作：每次只打开一个模块设计，不拉全局。

## 阶段 4：验收 & 测试标准（acceptance/test-plan → 可执行用例）
- `AC-xxx` 转验收用例，`TC-xxx` 转测试用例，绑定 `REQ/AC`。
- 定**完成定义（DoD）**：相关 `TC` 全绿才算做完。
- 门禁：validate 保证 `AC↔REQ`、`TC↔AC` 不断链。

## 阶段 5：UI 原稿（design/ui）
- 每页一个文件，低保真即可，与 `REQ` 对应。
- 协作：只改对应页面文件。

## 阶段 6：示例程序 / 原型（samples/）
- 按模块建最小可跑样例，验证技术选型是否成立。
- 协作：每模块独立，互不加载。

## 阶段 7：编码实现（核心 · 模块化 + TDD）
- 每个模块一个分支 / 一个 PR。
- 循环：**写失败测试（TC）→ 外科手术式实现 → 跑测试 → 绿**。
- 协作：Agent 只加载「该模块文件 + 相关测试 + 接口契约」，**不加载全项目**。
- 提交：`git commit -m "mod-auth: REQ-001 登录实现"`。
- 逐任务执行细则见 [`meta/CODING_SOP.md`](meta/CODING_SOP.md)：领任务 → 读输入 → 定契约(先写失败测试) → 外科实现 → 跑验收 → 跑门禁 → 单 commit。

## 阶段 8：测试（分层）
- 单元（模块内）/ 集成（模块间接口）/ 验收（AC）。
- 测试即正确性闸门；可设覆盖率门槛。
- 门禁：测试全绿 **且** `validate` 全绿。

## 阶段 9：验收
- 按 `AC` 逐条核对，由你/产品确认。
- 不通过 → 回到阶段 7。

## 阶段 10：发布 / 部署
- 出包、环境、回滚预案。
- 沉淀 `README.md` / `runbook.md`。

## 阶段 11：运维 & BUG 优化
- 标准流程：**最小复现 → 定位模块（只加载该模块）→ 先写失败测试 → 外科修复 → 绿 → 更新 CHANGELOG / known-issues**。
- 同类 BUG 先查 `known-issues.md`，不再从头分析。
- 大项目用**子 Agent 各管一个模块**，主 Agent 只编排，避免全局上下文膨胀。
- BUG 定位的"事前准备"见 [`meta/DEBUG_READINESS.md`](meta/DEBUG_READINESS.md)：可追溯映射（code-map）、结构化日志/错误、测试即定位器、提交带任务号。可追溯示例见 [`specs/code-map.md`](specs/code-map.md)。
- BUG 处置的标准流程见 [`meta/BUG_SOP.md`](meta/BUG_SOP.md)：接报 → 定位 → 最小复现 → 先写失败测试 → 外科修复 → 门禁 → 沉淀。

## 阶段 12：复盘 & 持续改进
- 复盘文档、补 ADR、补测试、清理孤儿文件。

---

## 全程纪律（省 token + 保质量）
1. **常驻只** `index.md` + `charter.md`（~2k token）。
2. **按需加载、外科编辑**：只动相关文件/章节，不整体重写。
3. **每阶段结束跑** `validate_project.py` + 测试，必须全绿。
4. **一切 Git 化、PR 化**：可 diff、可回滚、可审计。
5. **决策留痕（ADR）**：防被错误改动推翻。

> 一句话：文档期用 specs 当真相，开发期用「模块 + 测试 + 校验」当真相；Agent 永远只读该读的、只改要改的，改完用脚本和测试证明没改坏。
