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
- 状态机 `src/agentOnboard/stateMachine.js`(`transition`)
- 校验器 `src/agentOnboard/validators.js`(`validateOnboard` R1–R10)
- 按端矩阵 `src/agentOnboard/formMatrix.js`(`signalSourcesForForm`)
- 渲染层 `src/agentOnboard/render.js`(renderCard/renderOneClickProgress/renderTestPanel/renderFormBadge/renderOnboardPage)
- 服务层 `src/agentOnboard/service.js`(`AgentOnboardService`：configure/testConnect/rotateKey/revokeKey/oneClickOnboard/revokeBind + 审计)
- 浏览器入口 `src/agentOnboard/app.html` + `browser.js`（接原型 HTML，需 `python -m http.server` 打开）
- 测试 `src/agentOnboard/__tests__/*.test.js`；命令 `npm test`（39 例全绿：状态机 6 + 校验 11 + 渲染 8 + 集成 7 + E2E 7） |
| REQ-004 | [需求规格书_Agent界面内联记忆标识.md](需求规格书_Agent界面内联记忆标识.md) | [Agent界面内联标识_原型.html](design/ui/Agent界面内联标识_原型.html) | - |
| REQ-005 | [需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) | [登录与首页_原型.html](design/ui/登录与首页_原型.html) / [index.html](design/ui/index.html) | - |
| REQ-006 | [需求规格书_其余页面字段级交互规格.md](需求规格书_其余页面字段级交互规格.md) | [冲突裁决页_原型.html](design/ui/冲突裁决页_原型.html) | - |
| REQ-007 | [需求规格书_内核API契约.md](需求规格书_内核API契约.md) | - | - |
| REQ-008 | [需求规格书_同步机制详细设计.md](需求规格书_同步机制详细设计.md) | - | - |
| REQ-009 | [需求规格书_大模型与净化生长页字段级交互规格.md](需求规格书_大模型与净化生长页字段级交互规格.md) | [净化生长与大模型_原型.html](design/ui/净化生长与大模型_原型.html) | - |
| REQ-010 | [需求规格书_新增章节_十七_遗忘机制与用户体验设计.md](需求规格书_新增章节_十七_遗忘机制与用户体验设计.md) | [故事线_原型.html](design/ui/故事线_原型.html) / [机制演示_原型.html](design/ui/机制演示_原型.html) | - |
| REQ-011 | [需求规格书_日志记录页字段级交互规格.md](需求规格书_日志记录页字段级交互规格.md) | [日志记录页_原型.html](design/ui/日志记录页_原型.html) / [审计日志页_原型.html](design/ui/审计日志页_原型.html) | - |
| REQ-012 | [需求规格书_检索页字段级交互规格.md](需求规格书_检索页字段级交互规格.md) | [检索页_原型.html](design/ui/检索页_原型.html) | - |

> 用法：测试红 → 查本表对应行 → 直抵原型/规格/代码段；或凭报错中的 REQ/TC 注释反查。

---

## REQ-003 任务级代码映射（T1–T12，对应实际 JS 实现）

> 编码阶段所有原子任务已落地（代码随 initial commit `04cb27b` 一并入库，未逐任务拆分 commit；任务归属如下表，供 BUG 凭 REQ/TC/红测试反查）。
> ⚠️ **实现与 `tasks/AGENT-ONBOARD.md` 的差异**：规格按 TS+React 拆成 `src/web/AgentOnboard/*.tsx` 单组件；**实际落地为纯 ESM JS**（零依赖、`node:test`），UI 渲染合并进 `render.js`、集成进 `service.js`、端矩阵进 `formMatrix.js`。下表以实际代码为准。

| 任务 | 规格职责 | 实际 JS 落点（文件 : 函数） | 验收命令（单测） |
|------|----------|------------------------------|------------------|
| T1 | 接入卡片数据模型 / 类型定义 | `src/types/agentOnboard.js` : `AgentStatus`/`PriorityBadge`/`CircuitState` 枚举、`AgentCardShape`/`McpToolConfigShape`/`ChannelConfigShape`/`KeyMgmtShape`、`assertShape` | `node --test src/types/__tests__/types.test.js` |
| T2 | 页面状态机 + 熔断任意态降级 | `src/agentOnboard/stateMachine.js` : `TRANSITIONS`、`transition()` | `node --test src/agentOnboard/__tests__/stateMachine.test.js` |
| T3 | 接入卡片渲染（卡片头 + 单 Agent 操作） | `src/agentOnboard/render.js` : `renderCard`、`renderStatusBadge`、`renderPriorityBadge`、`renderCircuitDot` | `node --test src/agentOnboard/__tests__/render.test.js` |
| T4 | 一键全量接入（发现→打标→绑→验 + 进度条） | `src/agentOnboard/render.js` : `renderOneClickProgress`、`renderAutoBindCard` | `node --test src/agentOnboard/__tests__/render.test.js` |
| T5 | MCP 工具配置 + project_id 红线(R2) | `src/agentOnboard/validators.js` : `checkR2_projectIdRequired`（红线）；`src/agentOnboard/render.js` : 表单渲染 | `node --test src/agentOnboard/__tests__/validators.test.js` |
| T6 | 双通道 + 熔断降级(R4/R5) + SHA-256 幂等 | `src/agentOnboard/stateMachine.js` : 熔断→`DEGRADED`；`src/agentOnboard/validators.js` : `checkR4_dualChannelAtLeastOne`/`checkR5_keyNotReflected`/`checkR6_circuitDegrade` | `node --test src/agentOnboard/__tests__/validators.test.js` |
| T7 | 密钥脱敏 + 轮换宽限(R6) | `src/types/agentOnboard.js` : `KeyMgmtShape`；`src/agentOnboard/service.js` : `rotateKey`/`revokeKey` | `node --test src/agentOnboard/__tests__/service.test.js` |
| T8 | 测试面板 + request_id 审计(R7) | `src/agentOnboard/render.js` : `renderTestPanel`；`src/agentOnboard/service.js` : 审计写入 | `node --test src/agentOnboard/__tests__/render.test.js` |
| T9 | 校验 R1–R10 统一收敛 | `src/agentOnboard/validators.js` : `validateOnboard` + `checkR1`…`checkR10` | `node --test src/agentOnboard/__tests__/validators.test.js` |
| T10 | 按端置灰 / 部署端字段(R10) | `src/agentOnboard/formMatrix.js` : `SIGNAL_SOURCES`、`signalSourcesForForm`、`isSourceGrayed`；`src/agentOnboard/render.js` : `renderFormBadge` | `node --test src/agentOnboard/__tests__/render.test.js`（含 formMatrix 用例） |
| T11 | 集成（卡片→接口→审计链路） | `src/agentOnboard/service.js` : `AgentOnboardService`（configure/testConnect/oneClickOnboard/revokeBind + 审计） | `node --test src/agentOnboard/__tests__/service.test.js` |
| T12 | 端到端验收（含按端置灰/同步） | `src/agentOnboard/__tests__/e2e.test.js`；`src/agentOnboard/app.html`+`browser.js`+`index.js`（接原型 HTML） | `node --test src/agentOnboard/__tests__/e2e.test.js` |

> 全量命令：`npm test`（45 例 = types 6 + stateMachine 6 + render 8 + validators 11 + service 7 + e2e 7）。门禁链：`npm test` → `validate_project.py` → `generate.py --check`（CI 双触发已验证绿）。
> `formMatrix` 无独立测试文件，由其消费者 `render.test.js` 与 `e2e.test.js` 覆盖。
