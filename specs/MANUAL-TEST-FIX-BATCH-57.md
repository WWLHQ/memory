# 批次57 手动测试报告：记忆库页签精简 + 行右键常驻详情菜单 + 个人记忆独立页

- **日期**：2026-11-21
- **安装包**：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
- **大小**：129,319,582 B（129.3 MB）
- **SHA256**：`D7384F8D1A32855ACA97D4022B701B663015E09877F3FD33FDF3BC7C194310EB`
- **产物一致性**：`release/installer/win-unpacked/resources/app.asar.unpacked/dist-electron/main.cjs` 与 `dist-electron/main.cjs` SHA256 逐字节一致（`AAFCD304…288286`）；`git diff -- package.json` 为空。

## 用户需求 → 落地

| # | 需求 | 落地 |
|---|------|------|
| 1 | 将记忆库「冲突 / 带重放写入 / L0密文」页签删除，增加「活跃 / 休眠 / 归档 / 弃用」 | 六页签精简版（详见下），状态四态语义派生 [coreMemoryOps.ts](../../src/web/memory/coreMemoryOps.ts) `deriveMemoryStatus` |
| 2 | 对页签重新整理，删重复/无实际意义项 | 删「冲突」（与冲突裁决页 dispute.html 重复）、「待重放写入」（只读队列无操作价值）、「L0密文」（与安全页重复，页内解锁表单一并移除）、「个人记忆」（去独立页 personal.html） |
| 3 | 记忆详情放入右键、右键菜单不会消失 | 行右键 = 常驻详情菜单（[MemoryManagementPage.tsx](../../src/web/memory/MemoryManagementPage.tsx) `mm-ctx-menu`）：点外部/滚动**不关闭**，Esc 或右上角 × 关闭，右键另一行切换内容；行点击右侧抽屉保留 |

## 新六页签与语义派生口径（用户已确认）

| 页签 | 口径 | 真实账本计数（5692 条） |
|------|------|------------------------|
| 全部记忆 | 不过滤 | 5692 |
| 活跃 | decay_class hot/warm | 5624 |
| 休眠 | decay_class dormant 或 cold | 68 |
| 归档 | decay_class archived | 0（诚实空态） |
| 弃用 | `merged_into` 非空（旧值已让位给合并新值） | 40 |
| 分层 L1–L6 | 分层策略矩阵 + 按层过滤（原样保留） | 6 层 |

- 状态筛选下拉同步收敛为四态（蛰伏/陈旧/「蛰伏/休眠」组合选项删除；`?status=` 深链保持兼容，命令面板「归档」入口不受影响）。
- 冲突队列与 L0 会话仍作页头/真源条**读数**；裁决动作在冲突裁决页、L0 解锁在安全页，本页不再重复。分层工具区「解锁 L0」按钮改为「L0 与安全」直达安全页。

## 改动清单

- [MemoryManagementPage.tsx](../../src/web/memory/MemoryManagementPage.tsx)：六页签重整、删四 pane 与裁决/解锁/L0浏览/个人记忆代码、右键常驻详情菜单、状态页签过滤与计数
- [coreMemoryOps.ts](../../src/web/memory/coreMemoryOps.ts)：导出 `deriveMemoryStatus`；`toRecord`/`mergeBack` status 改语义派生
- [memoryManagement.css](../../src/web/memory/memoryManagement.css)：`mm-ctx-detail` 常驻菜单样式（深浅色）
- [Workspace.tsx](../../src/web/shell/Workspace.tsx)：iframe 右键接管规则——页面已 `preventDefault` 且目标在 `memory-row-*` 内时壳层不再叠加菜单（其余场景壳层全域接管不变）
- [views.ts](../../src/web/shell/views.ts)：补 `PageKey 'personal'`（他人流已写 personal 条目但类型漏键，随本批修复）；memory/personal 条目描述更新
- 新增 [personal.html](../../personal.html) + [personalEntry.tsx](../../src/web/memory/personalEntry.tsx)：个人记忆独立页（复用 PersonalMemoryPane），HTML 入口 22 → 23
- [vite.config.ts](../../vite.config.ts)：新增 personal 入口
- 测试：新增 [MemoryManagementPage.batch57.test.tsx](../../src/web/memory/__tests__/MemoryManagementPage.batch57.test.tsx)（派生口径 4 例 + 页签精简 3 例 + 右键常驻 2 例）；[e2e/memory.spec.ts](../../e2e/memory.spec.ts) 页签断言更新；[e2e/personal.spec.ts](../../e2e/personal.spec.ts) 指向 personal.html 并按工作区现状（批次51 面板下线）更新导航用例

## 三道闸门证据

| 闸门 | 证据 |
|------|------|
| A 影响面回归 | `npm run verify:fast` 全绿（typecheck + oxlint + 索引新鲜度 + vitest 4102 例 + 覆盖率阈值）；E2E `memory + personal + layered` 14/14 绿、`dispute` 2/2 绿 |
| B 效果验证（正向） | 9 例新用例断言状态**真的变了**：页签计数来自语义派生真实账本（弃用=merged_into 1 条、休眠=cold 1 条）、弃用页签表格只显示被合并行、右键菜单含详情字段、右键另一行内容切换、点外部不关闭、Esc/× 关闭 |
| C 变异验证 | 临时把 `if (m.merged_into) return 'deprecated'` 变异为 `if (false && …)` → 指定测试 2 例红灯（派生用例 + 页签计数用例）→ 原样还原 → 复跑绿灯 |

## 手动验证步骤（打包版）

1. `/S` 静默安装 → 启动桌面端 → `main.log` 出现 `bootstrap:done`，8200/8201/8202/8203/8204 全部 LISTENING（实测通过，静态端口 50373）。
2. 打开「记忆库」页：页签条为六页签；「弃用」页签计数 40（真实账本 merged_into 条数），点击后表格仅显示被合并的旧值行。
3. 右键任一记忆行：弹出「记忆详情」常驻菜单——点页面空白处/滚动菜单**不消失**；右键另一行内容切换；Esc 或右上角 × 关闭。
4. 单击行：右侧详情抽屉照常打开（原行为保留）。
5. 导航树「个人记忆库」：壳层新开页签直达 personal.html 独立页，双窗 Pane 正常渲染。

## 已知边界（不留给用户猜）

- 「归档」页签当前真实 0 条（账本尚无 decay_class=archived 记忆），显示诚实空态，非缺陷。
- `shell.spec` 4 条预存失败（135 未登录 gated / 182 检查器右键 / 301 mcp-browser-note / 322 壳内 dispute 空态）均属工作区他人未提交流的改动面（Workspace 大改、未跟踪 McpPage 未实现 browser-note、批次52 stale 断言）；`dispute.spec` 直开同一构建 2/2 绿可证与批次57 无关，不代改他人未提交代码。
- 壳层 iframe 内 personal 端口经宿主桥降级读不到直开页种子数据（诚实降级，数据断言由 personal.html 直开用例覆盖）。
- 历史深链 `?tab=personal|conflict|review|l0` 与 `#l0bar` 语义回落：personal/conflict/review/l0 → 全部记忆；`?status=hibernating,dormant` 等旧枚举值 → 照旧解析（蛰伏并入休眠口径由派生承担）。

## 提交状态

未提交，等用户确认后按《提交前必须人工确认》执行 commit/push。
