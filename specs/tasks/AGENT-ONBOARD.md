# 原子任务：Agent 接入配置页（REQ-003）

> 本文件是 `meta/TASK_SPLITTING.md` 规范在 **REQ-003（Agent 接入配置页）** 上的真实再创作。
> 来源：[需求规格书_Agent接入页字段级交互规格.md](需求规格书_Agent接入页字段级交互规格.md)（第 0~9 章）、[需求规格书.md](需求规格书.md) 第 19 章、[需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) 第 10 章、[设计/ui/Agent接入页_原型.html](设计/ui/Agent接入页_原型.html)。
> 拆分原则：越底层越先（类型/状态机纯逻辑）→ 越纯越先（校验/脱敏）→ UI 组件 → 集成 → E2E。每个任务可被一条命令验收，单独提交。
> 技术栈：TS 内核 + Rust/WASM 向量层（19.11）；测试命令以 `npm test -- <tag>` 约定（脚手架见 T1）。

---

## T1 接入卡片数据模型 / 类型定义
- 目标：定义 Agent 接入页全部领域类型，作为后续一切任务的契约基线
- 输入：`REQ-003` 规格 §0（状态）、§1（卡片头）、§3（MCP 工具）、§3（通道）、§4（密钥）；全局租户上下文 `REQ-002`
- 输出：`src/types/agentOnboard.ts`：
  - `AgentStatus = 'ONBOARD'|'CONFIGURED'|'CONNECTED'|'DEGRADED'`
  - `PriorityBadge = 'P0'|'P1'|'P2'|'P3'`（MVP·P0 / MVP·P1 / 兜底·P2 / 扩展·P3）
  - `AgentCard`（agent_name 枚举、接入方式、连通成功率、熔断状态、平均延迟、enterprise_id/team_id 只读、优先级）
  - `McpToolConfig`（`recall_memory`/`write_memory`/`get_user_preferences` + project_id/user_id 必填标记）
  - `ChannelConfig`（主 Webhook + 补偿 API 拉取、对账周期、SHA-256 幂等开关）
  - `KeyMgmt`（脱敏占位、轮换宽限期、最后轮换时间）
- 验收：`node --test src/types/__tests__/types.test.js`（零依赖，替代 tsc；与原稿等价，已按实际工具链修正）
- 边界：仅 `src/types/`、`src/types/agentOnboard.js`
- 依赖：无；被 T2~T10 全部依赖
- 提交：`feat: define Agent onboard types`（message 含 T1）

## T2 页面状态机（ONBOARD→CONFIGURED→CONNECTED/DEGRADED）
- 目标：实现每家 Agent 卡片状态流转 + 熔断联动降级逻辑（纯函数，零 UI 依赖）
- 输入：T1 的 `AgentStatus`/`ChannelConfig` 类型；规格 §0 状态图、§6 R6、§7 R5
- 输出：`src/agentOnboard/stateMachine.ts` → `transition(card, event)`（填密钥+选通道→CONFIGURED；测试通过→CONNECTED；测试失败/熔断 OPEN→DEGRADED）+ 熔断降级判定
- 验收：`npm test -- agentOnboard.stateMachine`（覆盖 4 态流转、熔断 OPEN→DEGRADED、恢复）
- 边界：仅 `src/agentOnboard/stateMachine.ts` + 其测试
- 依赖：T1；被 T3 / T6 / T9 依赖
- 提交：`feat: agent status state machine`（含 T2）

## T3 接入卡片渲染组件（卡片头 + 单 Agent 操作）
- 目标：渲染单家 Agent 接入卡片：卡片头字段 + 测试/轮换/吊销 三个操作
- 输入：T1 类型、T2 状态机；规格 §1.1（卡片头字段默认值/校验/联动/异常态）、§1.2（单 Agent 操作文案）
- 输出：`src/web/AgentOnboard/AgentCard.tsx` + 组件测试（渲染 4 字段、优先级徽标、熔断状态点 CLOSED/OPEN/HALF_OPEN、<95% 变黄、>5s 告警、操作触发对应回调）
- 验收：`npm test -- AgentCard`（渲染 + 连通率<95% 黄色 + 熔断 OPEN 禁用「测试」+ 操作回调）
- 边界：仅 `src/web/AgentOnboard/AgentCard.tsx` + 测试
- 依赖：T1, T2；被 T4 / T11 依赖
- 提交：`feat: AgentCard component`（含 T3）

## T4 一键全量接入（发现流程 扫→分→绑→验 + 四段进度条）
- 目标：实现「⚡ 一键接入」：发现 → 自动打标优先级 → 绑定默认值 → 逐个测通 + 审计
- 输入：T1 类型；规格 §2.0（发现流程四段）、§2.1（绑定默认值：project 共享/双通道/反代理映射/只读召回）、§7 R8/R9/R10（仅只读召回、可撤销、限本机授权）
- 输出：`src/agentOnboard/discover.ts`（discover/split/bind/verify 四段状态机，返回绑定结果卡数组）+ `src/web/AgentOnboard/OneClickOnboard.tsx`（四段进度条、自动绑定结果卡、撤销绑定按钮）+ 审计 `auto_bind`/`unbound` 写入（R9）
- 验收：`npm test -- agentOnboard.discover`（四段顺序、P0/P1/P2 打标、默认只读召回、可撤销；`npm test -- OneClickOnboard` 渲染进度条与结果卡）
- 边界：仅 `src/agentOnboard/discover.ts`、`src/web/AgentOnboard/OneClickOnboard.tsx` + 测试
- 依赖：T1, T2；被 T11 / T12 依赖
- 提交：`feat: one-click agent onboard`（含 T4）

## T5 MCP 工具配置 + project_id 校验（R2）+ 隔离粒度开关（19.4）
- 目标：实现 MCP 工具配置面板（3 工具参数、默认值、开关）与保存前 `project_id` 必填红线
- 输入：T1 的 `McpToolConfig`；规格 §3（工具参数/默认/校验）、§3 隔离粒度三开关、§6 R2、§7 R2/R3
- 输出：`src/web/AgentOnboard/McpToolConfig.tsx` + 组件测试：
  - `recall_memory`/`write_memory` 缺 `project_id` → 禁保存 + 红字「记忆读写须带 project_id」（R2）
  - `scene=critical` 时 `mode` 不得 `minimal`，自动回落 null + toast（R3，16.5）
  - `category` 枚举校验、`top_k` 越界钳制（1–10）
  - 隔离粒度三开关联动文案正确
- 验收：`npm test -- McpToolConfig`（R2 禁保存、R3 回落、钳制、开关联动）
- 边界：仅 `src/web/AgentOnboard/McpToolConfig.tsx` + 测试
- 依赖：T1；被 T11 依赖
- 提交：`feat: MCP tool config + project_id gate`（含 T5）

## T6 双通道配置 + 熔断降级（R4/R5）+ SHA-256 幂等
- 目标：实现采集通道配置面板与双通道至少一个开启校验、主通道熔断自动降级
- 输入：T1 的 `ChannelConfig`、T2 状态机；规格 §3（采集通道）、§6 R4、§7 R4/R5
- 输出：`src/web/AgentOnboard/ChannelConfig.tsx` + 组件测试：
  - 主通道 + 补偿通道全关 → 禁保存（R4）
  - 主通道 Webhook 熔断 OPEN → 卡片 DEGRADED，提示「延迟 5min，数据完整性不受影响」（R5）
  - 对账周期枚举（5min/15min/30min + 每日全量）、SHA-256 幂等开关固定开不可关
- 验收：`npm test -- ChannelConfig`（R4 禁保存、R5 降级提示、幂等不可关）
- 边界：仅 `src/web/AgentOnboard/ChannelConfig.tsx` + 测试
- 依赖：T1, T2；被 T11 依赖
- 提交：`feat: dual-channel config + degrade`（含 T6）

## T7 密钥管理（脱敏 + 轮换 24h 宽限，R6）
- 目标：实现 API Key 脱敏展示与轮换/吊销，满足 L1 脱敏与宽限期红线
- 输入：T1 的 `KeyMgmt`；规格 §4（脱敏占位、轮换宽限 0–72h、最后轮换时间）、§6 R5、§7 R6
- 输出：`src/web/AgentOnboard/KeyMgmt.tsx` + 组件测试：
  - 填入明文仅保存哈希，界面恒显示 `[API_KEY:service]` 占位（R5/R6）
  - 点「轮换」→ 新 Key + 旧 Key 进入宽限期（默认 24h，文案「已轮换，旧 Key 24h 内有效」）
  - 点「吊销」→ 立即失效 + 写审计（「已吊销该 Agent 密钥」）
  - 最后轮换超 90 天 → 黄色提醒
- 验收：`npm test -- KeyMgmt`（脱敏不回显、轮换宽限、吊销审计、90 天提醒）
- 边界：仅 `src/web/AgentOnboard/KeyMgmt.tsx` + 测试
- 依赖：T1；被 T11 依赖
- 提交：`feat: key mgmt desensitize+rotate`（含 T7）

## T8 接入测试面板 + request_id 审计（R7）
- 目标：实现测试面板：发 recall 测试、注入预览、request_id 复制跳审计
- 输入：T1 类型；规格 §5（测试 query/scene/注入预览/request_id）、§7 R7
- 输出：`src/web/AgentOnboard/TestPanel.tsx` + 组件测试：
  - 发 `recall_memory` 测试 → 显示注入预览（Top-K + 层级，payload ≈ X tokens）+ `request_id`（18.2-E）
  - 点 request_id → 开审计页；测试失败「未生成 request_id，检查连通」（R7 必记审计）
  - 熔断 OPEN 时禁用测试（联动 T2）
- 验收：`npm test -- TestPanel`（注入预览、request_id 复制、失败文案、熔断禁用）
- 边界：仅 `src/web/AgentOnboard/TestPanel.tsx` + 测试
- 依赖：T1, T2；被 T11 依赖
- 提交：`feat: agent test panel + request_id audit`（含 T8）

## T9 校验规则 R1–R6 + 边界约束 R1–R10 前端落地
- 目标：把规格 §6/§7 的全部校验与边界红线收敛为统一校验函数，供各组件复用
- 输入：T1 类型、T2~T8 各组件；规格 §6（R1–R6）、§7（R1–R10）
- 输出：`src/agentOnboard/validators.ts` → `validateOnboard(card)`（覆盖 R1 租户禁手填、R2 project_id、R3 critical 禁极简、R4 双通道至少一、R5 密钥不回流、R6 熔断联动、R7 request_id 审计、R8 只读召回、R9 可撤销、R10 限本机授权）+ 单测
- 验收：`npm test -- agentOnboard.validators`（R1–R10 逐条触发与放行）
- 边界：仅 `src/agentOnboard/validators.ts` + 测试（复用 T1~T8 类型，不重复实现 UI）
- 依赖：T1, T2, T5, T6, T7, T8；被 T10 / T11 依赖
- 提交：`feat: onboard validators R1-R10`（含 T9）

## T10 按端置灰 / 部署端字段（19.10 / 19.11）
- 目标：实现 `form` 当前端徽标 + 信号源按端自动置灰 + 端字段审计落点
- 输入：T1 类型；规格 §9（form 运行时注入 desktop/web/mobile/mac/linux/cli）、§9 信号源置灰矩阵、§7 R10（限本机）、§8 按端置灰/审计记端/CLI 一键/全端同步
- 输出：`src/agentOnboard/formMatrix.ts`（端→信号源可用矩阵，Web 关「本机进程」、移动关「本机进程/注册表」、CLI 改命令）+ `src/web/AgentOnboard/FormBadge.tsx`（当前端只读徽标）+ 组件测试；`auto_bind` 审计自动记 `form:<端>`
- 验收：`npm test -- agentOnboard.formMatrix`（Web 置灰本机进程、CLI 改命令、徽标渲染、审计含 form）
- 边界：仅 `src/agentOnboard/formMatrix.ts`、`src/web/AgentOnboard/FormBadge.tsx` + 测试
- 依赖：T1, T4；被 T11 依赖
- 提交：`feat: per-form graying + form audit`（含 T10）

## T11 集成测试（卡片 → 接口 → 审计链路）
- 目标：把 T3~T10 各面板接到真实/模拟接口，验证端到端数据流与审计写入
- 输入：T3~T10 全部组件与 validators；规格 §8 验收用例（MVP 接入、隔离配置、project 必填、双通道兜底、密钥脱敏、测试链路、一键接入、撤销、P2 确认）
- 输出：`src/web/AgentOnboard/__tests__/onboard.integration.tsx` 集成测试：
  - 配 deepseek+Claude Code 双通道 → 两卡片 CONNECTED，P0/P1 徽标
  - 删 recall 的 project_id → 禁保存（复用 T9 R2）
  - 主通道熔断 → DEGRADED 仅补偿
  - 一键接入 → 默认只读召回 + 双通道 + project 共享，各记 `auto_bind`
  - P2 写 → 弹确认（R8）
- 验收：`npm test -- agentOnboard.integration`（§8 用例覆盖通过）
- 边界：仅 `src/web/AgentOnboard/__tests__/`
- 依赖：T3, T4, T5, T6, T7, T8, T9, T10
- 提交：`test: agent onboard integration`（含 T11）

## T12 端到端验收测试（覆盖 §8 全部验收用例 + 按端置灰/同步）
- 目标：在真实运行环境跑通 §8 所有验收用例，含 19.10/19.11 端谱场景
- 输入：T11 集成测试 + 真实端构建；规格 §8（按端置灰、审计记端、CLI 一键、全端同账号同步 19.11）
- 输出：`e2e/agent-onboard.spec.ts`：
  - 桌面端写项目记忆 → Web 同账号 5min 内命中（服务端镜像，审计 form:web）
  - Linux 跑 `memagent discover --form cli` → 终端表格、无 GUI 四段条
  - 移动端离线写本地 → 回传 SHA-256 幂等不重复
- 验收：`npm run test:e2e -- agent-onboard`（§8 全部用例 + 端谱场景绿）
- 边界：仅 `e2e/agent-onboard.spec.ts`
- 依赖：T11
- 提交：`test: agent onboard e2e`（含 T12）

---

## 依赖 DAG（有向无环图）

```
T1 ──┬── T2 ──┬── T3 ──┬──────────────────────────────┐
     │        │        └── T8 ──┐                      │
     │        ├── T6 ──┐        │                      │
     │        └── T9 ──┤        │                      │
     ├── T4 ───────────┤        │                      │
     ├── T5 ───────────┤        │                      │
     ├── T7 ───────────┤        │                      │
     └── T10 ──────────┘        │                      │
                                └── T11 ── T12         │
T2 被 T3/T6/T8/T9 依赖；T9 汇总 R1–R10 供 T11 复用。
```

## 与门禁的关系
- 每个任务自带「验收命令」= 该任务单元 / 集成测试（见各任务「验收」）。
- 任务完成后仍跑 `python tools/validate_project.py`，确认没破坏 `meta/index.md` 契约与编号对应。
- T1~T12 全绿 + validate 绿 = REQ-003 编码阶段完成，可进入 REQ-004 或测试验证阶段。

## 简写对照（中文）
| 简写 | 中文 |
|------|------|
| TS   | TypeScript（类型化 JS） |
| WASM | 网页汇编（Rust 编译到浏览器的高性能模块） |
| MCP  | 模型上下文协议（Agent 工具接入标准） |
| API  | 应用程序接口 |
| UI   | 用户界面 |
| Rn   | 校验/边界规则编号（Spec 内） |
| DAG  | 有向无环图（依赖关系） |
| E2E  | 端到端测试 |
