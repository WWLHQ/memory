# 手动测试报告 · 批次 46：首页模板 1:1 复刻 STRATUM pg-home（S1）

> 日期：2026-11-21 ｜ 前序：S0 壳层 STRATUM 复刻（已交付运行）
> 设计真源：`stratum-a-full.html` pg-home 视图（仓库对齐基准 `specs/STRATUM-设计系统规格.md`）
> 用户要求：逐页 1:1 复刻（视觉+格式+符号+配色+**页面格式模板**），不残留上版任何东西；数据全接真实账本。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/web/overview/overviewPage.css` | 令牌全表换 STRATUM（亮 `#F3F5F8/#0088CC/--r:10px`、暗 `#060B16/#22D3EE`），清除批次57-C 旧版（`#0E7490/#F7F9FB/--r:8px`）；组件度量逐条对齐设计稿（主区 18px 20px 30px、af-head 新增、af-btn 6px 13px r8、af-alert 8px 13px r10、af-stat .v 24px mono、af-cols 316px、gap 14、af-graph 352px、strata bar 默认 accent、af-li 7px 14px、af-foot 11px gap16）；删上版残留类：`.af-anoms/.af-anom`、`.l0-lock-*`、`.af-eng-state`、`.af-stops`、`.af-stat .src`、四卡 min-height |
| `src/web/overview/OverviewPage.tsx` | 页头 `p0-pagehead`→`af-head`（h1 总览工作台 + sub 日期·UTC+08:00·数据根 + 「立即备份 / + 写入记忆」，去图标与「重读」按钮，补读走 focus/visibilitychange）；L0 提示条统一 af-alert 模板；异常速览改 af-alert bad/warn 行 + rid 内联 + hint 修正「近 30 分钟 · 窗口聚合」（原「近 1 小时」与内核 `L0_LOCK_ANOMALY_WINDOW_MS` 不符）；四卡 k/v/d 三段（去图标位/`.src` 行）；右栏顺序改设计稿（TOKEN 节省率→补炼队列→MCP 接入→引擎延迟排行→今日概览回末位，覆盖 2026-11-16 上移约定）；补炼/MCP/引擎面板头去「管理/接入/配置」链接；引擎排行 hint「最近成功拨测」、前三名 accent；sparkline 画线顺序、strata bar 去层色均对齐设计稿 |
| `src/web/overview/__tests__/overviewCards.test.tsx` | 重写为 1:1 复刻契约（顶对齐四卡 / k+v+d 无 .src 无图标 / 右栏 4 面板顺序链式断言 / af-head 结构 / 异常行 af-alert + 近 30 分钟 / strata bar 默认 accent） |
| `src/web/overview/__tests__/overviewPageWake.test.tsx` | `loggedInThenOut` 改走 focus 事件（原依赖已删除的「重读」按钮） |
| `specs/code-map.md`、`specs/code-index.generated.md` | 同步本轮条目与符号索引 |

**诚实化边界（有意不抄设计稿的部分）**：设计稿的卫星节点/标签、L6 虚线合并弧、面板头快捷链接、「Ctrl+滚轮缩放」提示——前者无真实映射不编造（诚实化红线），后者功能未实现不虚假标注。数据全部来自真实账本，设计稿演示数字未落。

## 三道闸门证据

| 闸门 | 证据 |
|---|---|
| A · 影响面回归 | `npm run verify:fast` 全绿：typecheck（web+electron 双工程）0 错、oxlint 0 error（2 处 Workspace.tsx 历史告警与本轮无关）、`code-index:check` 最新、vitest 全量 **4030 项**（1 例 `LedgerResetCard` 并发偶发，隔离复跑 12/12 绿，属已知 0xC0000409 边界；第三轮全量 EXIT 0）；覆盖率 Statements 81.97% / Lines 85.25% |
| B · 效果验证 | overview 定向 **33 例全绿**：四卡无 `.src`/无图标、右栏顺序 refine→mcp→engine→today、页头 af-head（无 home-reload）、异常行 af-alert.bad + hint「近 30 分钟」、strata bar 无层色——断言打到真实渲染 DOM 与 CSS 文件，均为「真的变了」型断言 |
| C · 变异验证 | 把 `.af-g4` 的 `align-items:start` 变异回 `stretch` → `overviewCards.test.tsx` **精确判红 1 例**（其余 6 例仍绿）；原样还原 → 33 例复绿 |

## 产物与运行态

| 项 | 值 |
|---|---|
| 安装包 | `release\installer\MultiAgent Memory-0.1.0-setup.exe`（129,313,960 bytes） |
| SHA256 | `BFDA21E3CA48335D0E8F000E0A96F91E9A7C8445DC1EF7EA219C27B49E08FEBD` |
| package.json | `git diff` 为空（未被 electron-builder 污染） |
| 产物标记 | `app.asar` 内含 `af-head`/`#f3f5f8`（CSS 压缩小写）/`af-mono`/「数据根」/「近 30 分钟」；旧类 `af-anoms`/`af-eng-state`/`af-stops` 在产物中为 **0 命中**（v5 残留清零成立） |
| 关端核验 | `MultiAgent Memory.exe` 进程 0、8200~8204 无 LISTENING 后才打包 |
| 启动 | WMI 启动 PID 40976 → `D:\MultiAgent Memory\logs\main.log` `[2026-11-21T03:31:13.492Z] bootstrap:done`，8200/8201/8202/8203/8204 全部 LISTENING |
| 清扫 | `coverage/`（450 文件 / 12.9 MB 验证产物）已删；`test-results/` 无残留；release 下 7 个历史 `installer-*` 被 WorkBuddy 句柄占用删不掉（已知边界，gitignored 不阻塞） |

## 手动验证步骤（用户实机）

1. 点侧栏「🏠 首页」：页头应为「总览工作台」+ 灰色副行（日期 · UTC+08:00 · 数据根 D:\MultiAgent Memory\data），右上只有「立即备份 / + 写入记忆」两个按钮（未登录态多一个「去登录」）。
2. 四张统计卡：数值为 24px 等宽字体，卡内只有 标题/数值/说明 三段，无图标、无来源行；四卡顶对齐（说明长短不齐时允许参差——设计稿口径）。
3. 右栏自上而下：TOKEN 节省率 → L2–L6 补炼队列 → MCP 接入 → 引擎延迟排行 → 今日概览；三个面板标题右侧只有灰色 mono 小字 hint，没有「管理/接入/配置」链接。
4. 异常速览：有异常时是整条彩底提示（阻断=红边、提醒=黄边），request_id 以等宽字体缀在行内；hint 显示「近 30 分钟 · 窗口聚合」。
5. 层级图谱下方六格 strata 条：进度条统一海洋蓝（不再按层五颜六色）。
6. 亮/暗主题切换：首页纸灰 `#F3F5F8` / 深空 `#060B16`，海洋蓝 accent。
7. 写锁联动：安全页解锁 L0 后切回首页，红条应在 1~2 秒内自动消失（focus 补读）；未解锁时首页提示为 accent 蓝底「L0」标签条。

## 已知边界 / 未完成

- 「Ctrl+滚轮缩放」未实现（设计稿有此提示文案，未接功能故不显示——不虚假标注）；设计稿卫星节点无真实数据映射，未画。
- 右栏「今日概览」回到末位（1:1 复刻），覆盖 2026-11-16「上移」约定；若实测后想改回，改 `OverviewPage.tsx` 右栏顺序一处即可。
- 面板头「管理/接入/配置」快捷链接按设计稿移除（对应功能仍可从侧栏进入）。
- 逐页复刻推进中：下一页 = 写入页。
