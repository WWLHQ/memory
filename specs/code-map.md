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
