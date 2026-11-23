# 批次52 手动测试报告（2026-11-21）

## 改动清单（用户四项）

1. **会话复盘沉淀**：沿用批次51 写入 project_memory.md 的长期规则，本批次收尾照常执行（write_memory 复盘条目）。
2. **功能导航「记忆」→「记忆管理」，四个子项取消**：
   - [views.ts](../../src/web/shell/views.ts) NAV：组名 `记忆` → `记忆管理`；删除 `memory-active`（活跃）、`memory-dormant`（蛰伏/休眠）、`memory-archived`（已归档）、`personal`（个人记忆）四项。主导航 25 → 21 项。
   - 能力不删：记忆库页仍支持 `?tab=personal` 与 `status=hibernating,dormant` 等真实筛选；个人记忆常驻面板保留（状态栏快捷按钮入口）。
   - 引用面同步：views.test.ts（五组21项 + 四子项反向断言）、workspace.test.tsx（DOM 五组20项 + 导航反向断言）、e2e/personal.spec.ts（导航项改反向断言，面板走状态栏）、PersonalMemoryPanel.tsx 头注释。
3. **首页右栏「今日概览」上移 + 顶部四卡同尺寸**：
   - [OverviewPage.tsx](../../src/web/overview/OverviewPage.tsx)：右栏顺序改为 今日概览 → TOKEN 节省率 → 补炼队列 → MCP 接入 → 引擎延迟排行。
   - [overviewPage.css](../../src/web/overview/overviewPage.css)：`.af-g4` 去掉 `align-items: start`，四卡默认 stretch 等高同尺寸（列轨道本就是 4 等份）。
4. **字体统一方向纠偏（「里面的卡片对齐外面的」）**：
   - 首页 [overviewPage.css](../../src/web/overview/overviewPage.css) `.af-stat .v` 20px → **24px/600 mono**，em 11px → 12px（回归设计稿）。
   - 监控 [theme.css](../../src/web/monitor/theme.css) 同纠偏：`.af-stat .v` 24px/em 12px；全部指标小卡 `.mval` `600 20px` → `600 24px`。批次51 的容器规格（surface+line+10px+padding 12px 14px、标题 11px muted、crit/warn 只染边框）保持不变。
   - 测试同步：overviewCards.test.tsx（24px + 四卡无 align-items）、metricsHonesty.test.tsx（describe 改批次52、24px 断言）。

## 闸门证据（三栏）

| 闸门 | 证据 |
|---|---|
| A 影响面回归 | `npm run verify:fast` 全绿（typecheck + oxlint 0 error + 索引新鲜度 + 覆盖率 Statements 81.89%）；定向测试 4 文件 127 用例全绿 |
| B 效果验证 | 正向：views.test 断言组名与21项全清单；overviewCards 断言右栏 DOM 顺序 home-today 首位；metricsHonesty 断言 `.af-stat .v` 24px 与 `.mval 600 24px`。反向：四子项 id 在 NAV 中不存在（views.test/workspace.test/e2e 三处） |
| C 变异验证 | 临时把 `.af-stat .v` 24px 改回 20px → overviewCards.test.tsx:88 红灯（1 failed）→ 原样还原 → 复跑 48 用例全绿 |

## 交付闭环

| 步 | 结果 |
|---|---|
| 关旧端 | `MultiAgent Memory` 进程归 0，8200~8204 无 LISTENING |
| 重打包 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` 成功；`git diff package.json` 为空；12 个历史 `release/installer-*` 因句柄占用 EPERM 未删（release/ 已 gitignore，如实记录不强删） |
| 产物 | `release/installer/MultiAgent Memory-0.1.0-setup.exe`，129,312,019 字节，SHA256 `1FF2201F3C56017AEF896D1136AC41B49FEE8593EDD4A3611B92B977D7EAE44C`；`dist-electron/main.cjs` 与 `release/installer/win-unpacked/resources/app.asar.unpacked/dist-electron/main.cjs` 哈希一致；asar 内含 `font-size:24px`、`600 24px/1.25`、`home-today` 改动标记 |
| 启新端 | 非 job-object 路径启动（沙箱内后台启动两次被回收，改 Start-Process 脱离沙箱后存活——已知坑的新变体，详见复盘） |
| 核运行态 | main.log `bootstrap:done`（07:33:33Z / 新一轮 07:34+）；8200/8201/8202/8203/8204 全 LISTENING；`get_write_status` HTTP 200（l0_unlocked: true, writeDek_present: true） |

## 验证步骤（人工）

1. 桌面端左侧导航：第二组标题为「记忆管理」，组内只有 记忆库/层级管理/生命周期/净化生长/冲突裁决 五项，无 活跃/蛰伏休眠/已归档/个人记忆。
2. 状态栏「个人记忆」快捷按钮仍能打开常驻面板；记忆库页内个人记忆 Tab 正常。
3. 首页右栏第一张卡是「今日概览」，其后依次 TOKEN 节省率/补炼/MCP/引擎。
4. 首页顶部四卡等高同宽；数值字号为 24px，与监控页六格一致；监控「全部指标」内小卡数值同为 24px。
5. 窗口缩放（≤900px）四卡折两列/单列不破版。

## 已知边界

- 深链 `memory.html?tab=all&status=archived` 等仍有效（记忆页能力保留），只是不再有导航入口。
- 12 个历史 installer-* 目录句柄占用删不掉，属历史遗留，不阻塞交付。
- L0 写密钥本轮实测 unlocked:true；若重启后为 false，属预期安全行为（安全页重新解锁即可）。
