---
title: 测试标准
status: draft
---

# 测试标准（多 Agent 记忆助手）

> 每条 TC 对应一条 AC；结构化首版，验收命令待编码阶段按模块填充。

## TC-001 产品定位评审
对应 AC-001：评审通过产品定位文档。

## TC-002 租户隔离测试
对应 AC-002：构造多租户数据，验证隔离与无串档。

## TC-003 Agent 接入配置测试（字段级）
对应 AC-003：覆盖 AC-003.1~AC-003.10。运行环境：Node 22 内置 `node:test`，零依赖；命令 `npm test`（= `node --test src/agentOnboard`）。
- TC-003.1 状态机流转（AC-003.3）：`node --test src/agentOnboard/__tests__/stateMachine.test.js`
- TC-003.2 校验 R1 租户禁手填（AC-003.1）：validators.test.js → checkR1
- TC-003.3 校验 R2 project_id 必填（AC-003.5）：validators.test.js → checkR2
- TC-003.4 校验 R3 critical 禁极简（AC-003.5）：validators.test.js → checkR3
- TC-003.5 校验 R4 双通道至少一（AC-003.6）：validators.test.js → checkR4
- TC-003.6 校验 R5 密钥不回流（AC-003.7）：validators.test.js → checkR5
- TC-003.7 校验 R6 熔断联动降级（AC-003.3/AC-003.6）：validators.test.js → checkR6
- TC-003.8 校验 R7 request_id 审计（AC-003.8）：validators.test.js → checkR7
- TC-003.9 校验 R8 只读召回/P2 确认（AC-003.4）：validators.test.js → checkR8
- TC-003.10 校验 R9 可撤销（AC-003.4）：validators.test.js → checkR9
- TC-003.11 校验 R10 限本机（AC-003.4）：validators.test.js → checkR10
- TC-003.12 全量汇总（R1–R10 基线全绿）：`node --test src/agentOnboard`（validateOnboard）

## TC-004 内联标识测试
对应 AC-004：四类标识按规范渲染。

## TC-005 首页/登录测试
对应 AC-005：首页直达与租户上下文一致。

## TC-006 其余页面测试
对应 AC-006：写入/查重/冲突裁决字段交互符合预期。

## TC-007 内核 API 测试
对应 AC-007：端壳注入与核心 API 契约回归通过。

## TC-008 云同步测试
对应 AC-008：多端同步一致性 + 冲突对账收敛。

## TC-009 大模型/净化页测试
对应 AC-009：配置与净化页字段交互符合规格。

## TC-010 遗忘机制测试
对应 AC-010：遗忘操作可见且生效。

## TC-011 日志页测试
对应 AC-011：日志数据模型与交互符合规格。

## TC-012 检索页测试
对应 AC-012：状态机与 scene 联动符合规格。
