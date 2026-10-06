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

## 现状（压缩）
- 门禁：`validate_project.py` 全绿（41 链接 / 36 编号 / 0 失败）；`generate.py` 重建 `build/`
- **REQ-003（Agent 接入页）已全量跑通**（零依赖 Node 22 `node:test`）：
  - 代码 `src/agentOnboard/`：stateMachine(`transition` T2) + validators(`validateOnboard` R1–R10 T9) + formMatrix(按端置灰 T10) + render(T3~T8/T10) + service(`AgentOnboardService` T11/T12) + app.html/browser.js（接原型）
  - 字段级 AC/TC：AC-003.1~.10、TC-003.1~.12
  - 测试 **39 例全绿**（`npm test`）；code-map REQ-003 已回填「文件→函数→测试命令」
- 技术栈务实约定：**纯 ESM JS + Node 内置 node:test**，渲染层用「state→HTML 字符串」纯函数（零 jsdom）；真实后端接入时把 `AgentOnboardService` 存储/审计替换为 API 即可

## 下一步
- 对 **REQ-004~REQ-012** 做同样动作：补字段级 AC/TC + 跑通一个功能（参考 REQ-003）
- 或接真实后端：替换 `AgentOnboardService` 存储/审计为 API

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
