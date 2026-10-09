---
status: draft
---

# 代码映射（REQ → 原型 / 文件 → 测试）

> 可追溯性基石：BUG 出现时，凭 REQ / TC 或红测试即可定位程序段。真实项目编码阶段按此结构为每个 REQ 维护「文件 → 函数 → 测试命令」。
> 首版仅映射「需求 → 原型 HTML / 规格文件」，代码段待编码阶段填充。

| REQ | 需求规格文件 | 对应原型 HTML | 代码段（待编码填充） |
|------|--------------|---------------|----------------------|
| REQ-001 | [需求规格书.md](需求规格书.md) | - | - |
| REQ-002 | [需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) / [需求规格书_新增章节_十八_ID字段整理.md](需求规格书_新增章节_十八_ID字段整理.md) | - | - |
| REQ-003 | [需求规格书_Agent接入页字段级交互规格.md](需求规格书_Agent接入页字段级交互规格.md) | [Agent接入页_原型.html](design/ui/Agent接入页_原型.html) | 原子任务：[AGENT-ONBOARD.md](tasks/AGENT-ONBOARD.md)；**已全量跑通（T2+T9 逻辑 + T3~T8/T10 渲染 + T11 集成 + T12 E2E）**：
- 状态机 `src/agentOnboard/stateMachine.ts`(`transition`)
- 校验器 `src/agentOnboard/validators.ts`(`validateOnboard` R1–R10)
- 按端矩阵 `src/agentOnboard/formMatrix.ts`(`signalSourcesForForm`)
- UI 组件 `src/web/AgentOnboard/*.tsx`（AgentCard/OneClickOnboard/McpToolConfig/ChannelConfig/KeyMgmt/TestPanel/FormBadge/Gains）+ `theme.css`（逐条抄自原型）
- 服务层 `src/agentOnboard/service.ts`(`AgentOnboardService`：configure/testConnect/rotateKey/revokeKey/oneClickOnboard/revokeBind + 审计)
- 页面装配 `src/web/AgentOnboard/AgentOnboardPage.tsx` + `src/web/main.tsx` + `index.html`（Vite 构建，`npm run dev/build`）
- 测试 `src/**/__tests__/*.test.ts(x)`；命令 `npm run typecheck`（tsc strict）+ `npm test`（vitest 71 例）+ `npm run test:e2e`（Playwright 7 例） |
| REQ-004 | [需求规格书_Agent界面内联记忆标识.md](需求规格书_Agent界面内联记忆标识.md) | [Agent界面内联标识_原型.html](design/ui/Agent界面内联标识_原型.html) | - |
| REQ-005 | [需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) | [登录与首页_原型.html](design/ui/登录与首页_原型.html) / [index.html](design/ui/index.html) | 原子任务：[HOME-LOGIN.md](tasks/HOME-LOGIN.md)（T1–T12，**已拆分未实现**：租户上下文类型 / 密码哈希 / 登录业务+锁定 / Dashboard 聚合 / 租户 Provider / TopBar / Dashboard 区块 / 登录弹卡 / HomePage 装配 / 登录后端 / 前端镜像 / E2E） |
| REQ-006 | [需求规格书_其余页面字段级交互规格.md](需求规格书_其余页面字段级交互规格.md) | [冲突裁决页_原型.html](design/ui/冲突裁决页_原型.html) | - |
| REQ-007 | [需求规格书_内核API契约.md](需求规格书_内核API契约.md) | - | - |
| REQ-008 | [需求规格书_同步机制详细设计.md](需求规格书_同步机制详细设计.md) | - | - |
| REQ-009 | [需求规格书_大模型与净化生长页字段级交互规格.md](需求规格书_大模型与净化生长页字段级交互规格.md) | [净化生长与大模型_原型.html](design/ui/净化生长与大模型_原型.html) | - |
| REQ-010 | [需求规格书_新增章节_十七_遗忘机制与用户体验设计.md](需求规格书_新增章节_十七_遗忘机制与用户体验设计.md) | [故事线_原型.html](design/ui/故事线_原型.html) / [机制演示_原型.html](design/ui/机制演示_原型.html) | - |
| REQ-011 | [需求规格书_日志记录页字段级交互规格.md](需求规格书_日志记录页字段级交互规格.md) | [日志记录页_原型.html](design/ui/日志记录页_原型.html) / [审计日志页_原型.html](design/ui/审计日志页_原型.html) | - |
| REQ-012 | [需求规格书_检索页字段级交互规格.md](需求规格书_检索页字段级交互规格.md) | [检索页_原型.html](design/ui/检索页_原型.html) | - |

> 用法：测试红 → 查本表对应行 → 直抵原型/规格/代码段；或凭报错中的 REQ/TC 注释反查。

---

## REQ-003 任务级代码映射（T1–T15，TS+React 实现）

> 编码阶段所有原子任务已落地。**2026-10-07 起实现与规格完全对齐**（TS 内核 + React 组件），此前的"纯 ESM JS"方案级差异已消除。
> UI 硬约束：结构/样式/文案/交互以 `design/ui/Agent接入页_原型.html` 为唯一事实来源，各组件内均标注对齐声明。

| 任务 | 规格职责 | 实际落点（文件 : 导出） | 验收命令 |
|------|----------|---------------------------|----------|
| T1 | 接入卡片数据模型 / 类型定义 | `src/types/agentOnboard.ts` : `AgentStatus`/`PriorityBadge`/`CircuitState`、`AgentCard`/`AgentCardInput`/`AgentCardCandidate`、`UiAgentCard`（对齐原型）、`assertShape` | `npm run typecheck` + `vitest run src/types` |
| T2 | 页面状态机 + 熔断任意态降级 | `src/agentOnboard/stateMachine.ts` : `TRANSITIONS`、`transition()` | `vitest run stateMachine.test.ts` |
| T3 | 接入卡片渲染（卡片头 + 单 Agent 操作） | `src/web/AgentOnboard/AgentCard.tsx` : `AgentCard` | `vitest run AgentCard.test.tsx` |
| T4 | 一键全量接入（发现→打标→绑→验 + 进度条） | `src/web/AgentOnboard/OneClickOnboard.tsx` : `OneClickOnboard`（四段 `.stages` + `#found` + 撤销） | `vitest run components.test.tsx` |
| T5 | MCP 工具配置 + project_id 红线(R2) | `src/web/AgentOnboard/McpToolConfig.tsx` : `McpToolConfig`、`toolRef`（布尔归一化）；`validators.ts` : `checkR2_projectIdRequired` | 同上 + `validators.test.ts` |
| T6 | 双通道 + 熔断降级(R4/R5) + SHA-256 幂等 | `src/web/AgentOnboard/ChannelConfig.tsx` : `ChannelConfig`；`stateMachine.ts` : 熔断→`DEGRADED`；`validators.ts` : `checkR4`/`checkR5`/`checkR6` | 同上 |
| T7 | 密钥脱敏 + 轮换宽限(R6) | `src/web/AgentOnboard/KeyMgmt.tsx` : `KeyMgmt`；`service.ts` : `rotateKey`/`revokeKey` | 同上 + `service.test.ts` |
| T8 | 测试面板 + request_id 审计(R7) | `src/web/AgentOnboard/TestPanel.tsx` : `TestPanel`；`service.ts` : 审计写入 | 同上 |
| T9 | 校验 R1–R10 统一收敛 | `src/agentOnboard/validators.ts` : `validateOnboard` + `checkR1`…`checkR10` | `vitest run validators.test.ts` |
| T10 | 按端置灰 / 部署端字段(R10) | `src/agentOnboard/formMatrix.ts` : `signalSourcesForForm`/`isSourceGrayed`；`src/web/AgentOnboard/FormBadge.tsx` : `FormBadge`、`GRAYED_BY_FORM` | `components.test.tsx` + `e2e.test.ts` |
| T11 | 集成（卡片→接口→审计链路） | `src/agentOnboard/service.ts` : `AgentOnboardService<B>`（泛型：内存同步 / 注入后端异步） | `vitest run service.test.ts` |
| T12 | 端到端验收（含按端置灰/同步） | `src/agentOnboard/__tests__/e2e.test.ts`；页面装配 `src/web/AgentOnboard/AgentOnboardPage.tsx` | `npm test`（71 例全绿） |
| T13 | 真实后端 HTTP 服务 | `src/agentOnboard/server.ts` : `createServer`（node:http + JSON 持久化 + CORS） | `server.test.ts` / `client.test.ts` |
| T14 | HTTP 客户端 | `src/agentOnboard/client.ts` : `AgentOnboardClient`；`src/web/AgentOnboard/useBackendMirror.ts` | `client.test.ts` |
| T15 | 真实链路 E2E + 真浏览器点击级 | `e2e/app.spec.ts`（Playwright，指向 `dist/` 真实构建产物） | `npm run test:e2e`（7 例） |

> 全量命令：`npm run verify` = `typecheck` → `test`（vitest 71 例）→ `validate_project.py` → `generate.py --check`。
> 另有真浏览器点击级：`npm run test:e2e`（先 `vite build`，再 Playwright 7 例；服务 `dist/` 并起真实后端 :8200）。
