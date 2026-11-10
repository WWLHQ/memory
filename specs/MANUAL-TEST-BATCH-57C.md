---
status: pending-manual-acceptance
---

# 手动测试报告 · 批次57-C（首页版式对齐定稿图 stratum-l1l3-preview pg-home）

- 日期：2026-11-10
- 分支：main（57-B 已提交 `b93f37c`；本轮改动待提交，**未 push，待授权**）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（127,978,575 B = 122.05 MiB）
- SHA256：`0ff94d0b262ddc2519f8d3da2b92d99236f1140e3c4a46afca3db96c47ba65af`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`
- 关联：`specs/code-map.md` 批次57-C 段落、定稿图 `stratum-l1l3-preview.html` pg-home、上一轮 57-B `b16a018`/`b93f37c`
- 范围口径：用户贴定稿截图并拍板「按照这个重排」。本轮**只重排首页版式**，真实数据口径不变，记忆库仍暂停。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 图谱面板对齐定稿图 | 图谱头加层组 chip（全部/L2/L3/L4+，真实过滤只调透明度不增删节点）；SVG 改定稿图样式：radialGradient 账本核 + 双环轨 + 六枢纽外置「语义 计数」标签；**无卫星标签**（没有真实映射，不编造）；层级行改六格横排 `af-strata-cell`（L1–L6 真实计数/占比） | `src/web/overview/OverviewPage.tsx` |
| TOKEN 节省率卡（右栏新） | 今日召回 payload 相对 2.4.1 全量预算的节省率 + 真实 payload 走势 sparkline（<2 样本不画）；空态「未取数 + 今日暂无召回」给原因 | `overview.ts` + `OverviewPage.tsx` |
| 今日概览列表 | 右栏改定稿图列表：写入/召回/嫁接/过滤 四类真计数（UTC+08:00 今日起内核审计实算；嫁接=action `graft`、过滤=detail.action `filtered_l0_to_l1`，qualityGate 同源） | `src/web/shell/overview.ts` |
| 审计单源重构 | `loadRecentAudits` → `loadAuditPanels`：一次 `queryAudit` 同源派生 最近审计/今日概览/TOKEN 节省率 三面板 | `src/web/shell/overview.ts` |
| 单一真源 | `FULL_BUDGET` 从 `coreOnboard.ts` 导出，首页 sparkline 与接入页四卡共用同一预算口径 | `src/web/AgentOnboard/coreOnboard.ts` |
| 页脚端口行 | 定稿图样式：后端状态 + 会话 + home/onboard 端口自 `backend.ts` 常量派生（A4 门禁禁字面量）+ mcp/webhook 标签 + audit 行数 | `OverviewPage.tsx` |
| 样式 | `overviewPage.css` af- 组件层重写（cols 1fr/300px、chip、strata-cell、spark、圆点列表行、mono 审计行/页脚）；A 令牌浅/深块不变 | `src/web/overview/overviewPage.css` |
| 测试 | `homeView.test.ts`/`workspace.test.tsx` fixture 补 token/today；e2e ④ 改断言新今日概览；`Workspace.tsx` catch 补字段 | `e2e/home.spec.ts` 等 |

## 2. 自动化门禁结果（三道闸门）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Lint | `npm run lint`（oxlint） | 0 warnings / 0 errors |
| 索引新鲜度 | `npm run code:index:check` | 通过（378 源码 / 121 文档，`--write` 后复验） |
| 无演示标识 | `npm run check:no-demo` | 0 命中（拦下 1 处「—」占位，已改「未取数」） |
| 全量回归（A） | `npm run test:gate`（4 片串行 maxWorkers=1） | **229 文件 / 2648 例 0 失败**（第 3 轮全绿，见下） |
| 真浏览器 E2E（B） | `node e2e/run.mjs e2e/home.spec.ts e2e/overview.spec.ts e2e/crossTabAuth.spec.ts` | **10/10 通过**（真 dist + 真 home 后端 + CDP Chromium） |
| 纯派生单测（B/C） | `npx vitest run src/web/overview/__tests__/homeView.test.ts` | 6/6 通过 |
| 变异验证（C） | `healthOk === 'ok'` 注入 `!==` → 指定用例红 → 还原 | 红灯（1 failed/6）→ 复绿 6/6，无残留 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

> 第 1 轮 test:gate 量出 2 失败，处置如实记录：① **A4 端口字面量扫描逮到页脚硬编码 `:8201/:8200`——本轮真回归**，改从 `backend.ts` `HOME_BASE/ONBOARD_BASE` 派生后修复；② `storageProjects` mtime 1 例单跑复绿，证实满负载 flaky（历史已知）。第 2 轮 A4 残红原因是注释里写了端口号被同一扫描逮到（门禁有效），改措辞后第 3 轮全绿。

## 3. 包内产物校验（防「写了≠打进包」）

- SHA256 实测：`0ff94d0b262ddc2519f8d3da2b92d99236f1140e3c4a46afca3db96c47ba65af`。
- `@electron/asar.extractAll` 解包 `release/installer/win-unpacked/resources/app.asar` 后扫 dist 文本，57-C 标记全命中：`TOKEN 节省率`×1、`嫁接`×8、`af-strata-cell`×2、`查看全部审计`×1 → 新版式确在安装包内（校验后临时目录已删）。

## 4. 真机手测清单（待用户在安装版执行）

- [ ] 安装/覆盖安装包后启动，首页与定稿图逐块对照：头部（标题+日期/UTC+08:00+数据根+右侧操作钮）→ L0 提示条（仅锁定时）→ 效果四卡 → 左栏（图谱+层级六格横排/异常速览/最近审计）→ 右栏（TOKEN 节省率/补炼队列/MCP 接入/引擎延迟排行/今日概览）→ 页脚端口行。
- [ ] 图谱：六枢纽外置「脱敏/摘要/得失/模式/洞察/索引 + 计数」标签与账本核总数为真实账本派生；点 chip「全部/L2/L3/L4+」只高亮/淡化对应枢纽，枢纽不消失（恒 6 个）。
- [ ] TOKEN 节省率卡：有今日召回时显示真实节省率 + payload 走势曲线；无召回显示「未取数 · 今日暂无召回」，**不出现演示曲线**。
- [ ] 今日概览：写入/召回/嫁接/过滤 四行与审计页同源可对账（嫁接/过滤口径见 §1）；空账本全 0。
- [ ] 浅/深/随系统三主题：版式不溢出不叠层；颜色跟随 A 令牌（纸灰/墨蓝/电青 ↔ 深空/辉光青）。
- [ ] 会话：登录→页脚「已登录」+「去登录」消失；登出→回「未登录 · 只读」。未登录时四卡/节省率仍读本地账本（诚实口径）。
- [ ] 账本读取失败/L0 锁定时顶部告警给真实原因；侧栏各面板失败给原因而非 0/演示数。
- [ ] 记忆库页与其余页面版式与本轮之前一致（本轮暂停未动），无回归。

## 5. 已知边界

- 图谱卫星小点/项目名标签**有意不画**：定稿图上的「PG 索引优化/SolidWorks 插件/MCP 接入」为演示文案，真实账本没有记忆→坐标的映射，画了就是编造。
- 嫁接计数=顶层审计 `action=graft`；过滤计数=`detail.action=filtered_l0_to_l1`（批次35 质量门口径）。与「今日写入」互斥不重复计。
- TOKEN 节省率按「今日」、效果四卡第 1 张按账本全周期，同为 2.4.1 预算口径（`FULL_BUDGET` 单一真源）。
- 打包时 6 个旧时间戳安装包目录仍被外部进程占用（EPERM）未删，产物已收口固定 `release/installer`；不影响本次安装包完整性。
