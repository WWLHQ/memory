# 批次54 手动测试报告（2026-11-21 第三轮）

用户四条反馈 → 四项改造 + 一处顺手修，全部走完三道闸门与交付闭环。

## 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 129,315,311 bytes |
| SHA256 | `F3C869608D11CFD0C39DF2648C7D1F311ED7A6D7493E88BE3B196ADDF597C782` |
| 产物验证 | dist 渲染产物含批次54 全部标记（回显反馈 / 冲突队列（0） / 不自动覆盖 · 保存原文 / 用户反馈（13.7 反馈表单 / 同步中枢），构建时间 16:54 与 exe 16:55 同批；dist-electron/main.cjs 同批重建 |

> 说明：本批 win-unpacked 被打包流程清理，标记验证改在 `dist/` 构建产物上进行（exe 即由这些产物压缩组装）。

## 改动清单

1. **冲突裁决页空态对齐截图**（[DisputePage.tsx](../src/web/dispute/DisputePage.tsx) + [theme.css](../src/web/dispute/theme.css)）
   - 空账本时不再显示一张居中说明卡（用户「看起来没改」的根因），改为与目标截图同构：`冲突队列（0）` 面板 + 7 列表头骨架（conflict_id/类型/mem_id/old 置信度/new 置信度/等待/操作）+ 诚实空行（无 pending 冲突不伪造数据）。
   - 页头下补第二行小灰 chip（`9.7 裁决队列` / `不自动覆盖 · 保存原文`）；计数徽标改绿色 chip；队列列头 `mem_id（old → new）` 收成 `mem_id`。
2. **同步中枢去页签**（[SyncPage.tsx](../src/web/sync/SyncPage.tsx)）：四个分区直接堆叠（无页签，与截图版式语言一致），其余 testid 与数据逻辑零改动。
3. **记忆助手页深色主题**（[AssistantPage.tsx](../src/web/assistant/AssistantPage.tsx)）：根因是本页从未设置 `html[data-theme]`，深色变量不生效；接入 `useHostTheme()` 修复。
4. **用户反馈页上移 + 整合**（[views.ts](../src/web/shell/views.ts) + [FeedbackPage.tsx](../src/web/feedback/FeedbackPage.tsx) + [FeedbackForm.tsx](../src/web/feedback/FeedbackForm.tsx)）：导航项从「治理」组上移到「工作台 → 检索」下方；页面整合「用户反馈（表单）」与「回显反馈（内核审计读回，含接入 Agent 经 MCP 提交的记录）」两块。
5. **顺手修**：[mcpManageTools.ts](../src/core/memagent/mcpManageTools.ts) 工作区遗留（批次 A1 流）裸导入 `ulid` 打断打包，改 `./ulid.ts`；A1 其余未提交改动原样不动。

## 三道闸门证据

| 闸 | 证据 |
|---|---|
| A 影响面回归 | `npm run verify:fast` 全绿（typecheck / oxlint / 索引新鲜度 / no-demo / vitest 覆盖率）；`code:index --write` 已刷新 |
| B 效果验证 | 定向 5 套件 44 例全绿：dispute / sync / feedback / assistant / views；新增批次54 正向用例：空态骨架列头齐全、sync 无页签同屏堆叠、assistant 深色 data-theme、feedback 两块整合、views 期望序 feedback 位于检索之后 |
| C 变异验证 | 空态骨架 `old 置信度` 列头临时改 `MUTATED-COL` → DisputePage.test.tsx 红灯（1 failed）→ 原样还原 → 复绿。注：首靶 `conflict_id` 不锐（空态正文含同词），换靶重验 |

## 日志验证步骤（管理员/普通用户皆可）

1. 深色模式（首页右上主题切换）下依次打开：**冲突裁决**（空态应显示队列表头骨架）、**同步中枢**（四个分区堆叠、无页签）、**记忆助手**（整页应为深色底）、**工作台 → 用户反馈**（检索正下方；页面有「用户反馈」表单与「回显反馈」两块）。
2. 日志记录页（原文视图）可查 `ui:*` 与 `kernel` 相关动作；本轮无新增写操作，无伪造回执。
3. 运行态：`main.log` 尾部 `bootstrap:done`（08:58:09Z）+ 8200~8204 全 LISTENING + 进程 4。

## 已知边界

- 冲突裁决队列只在账本真实出现 pending 冲突时才有数据行；空态保留表头骨架 + 诚实提示（不注入演示数据）。
- `release/installer-*` 带时间戳的历史目录与 `win-unpacked` 因句柄占用清理失败（EPERM），`release/` 已 gitignored，不阻塞交付。
- 工作区 137 个未提交文件中，冲突裁决/同步/反馈/助手/视图相关为本批改动；`src/core/memagent`（mcpRecall/mcpSchema/agent.ts 等）、e2e、recall-echo-contract 等属另一条未收口的批次 A1 流，本批不代为提交。
