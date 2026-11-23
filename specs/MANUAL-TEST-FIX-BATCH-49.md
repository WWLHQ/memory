# 手动测试报告 · 批次49-STRATUM（2026-11-21）

## 改动清单

1. **功能导航跟随主题**（用户原话：「功能导航要和系统颜色变化而变化，浅色就是浅色深色就是深色」）
   - `src/web/shell/theme.css`：浅色 `:root` 的 rail 令牌从写死深墨蓝（`--rail: #0B1526` 等）改为跟随主题令牌（`--rail: var(--surface2)`、`--rail-ink: var(--muted)`、`--rail-active: var(--brand)`、`--rail-on: var(--ink)`，hover/line/hot 全令牌化）；深色块保留原深值（`--rail: #04070F`）。浅色主题下左侧功能导航现在是浅色，深色主题下保持深色。
   - 测试：`aTokens.test.ts` rail 断言改新契约；`ribbonLayout.test.ts` 用例名改「跟随主题」。

2. **监控告警页 1:1 复刻 STRATUM pg-monitor**（设计真源 `stratum-a-full.html` 行 891–920）
   - `src/web/monitor/theme.css` 整文件重写：`.mon-page` 作用域令牌（亮暗两套）+ af 基元子集（head/btn/link/panel/ph+hint/pb/note/row/g3/select/chip/badge/stat/det/tl/empty/li）+ 指标卡辅助类 `mon-mcard`；p0-* 旧版式清零。
   - `src/web/monitor/MonitorPage.tsx` 重排：af-head（h1 监控告警 + 诚实 sub + 刷新按钮）→ 筛选行（级别下拉 + **1h/24h/7d chips** + 宿主 Agent 下拉）→ **af-g3 六格汇总** → 「全部指标」折叠（20 卡 8 组全保留）→ 后台操作状态 → 告警时间线。
   - `src/web/monitor/useMonitorReal.ts`：新增 `summaryFromLedger` 六格真实派生（Agent 健康/补炼队列/冷存储/人工审核/检索 P95/今日召回），无口径显「— 未采集」整串，绝不编造。
   - `MetricGrid.tsx` / `AlertTimeline.tsx` 换 af 类，全部 data-testid 与深链保留；`e2e/monitor.spec.ts` 适配折叠。

## 产物

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 123.3 MB（129,313,087 字节） |
| SHA256 | `8F1DD4075BD26759CA9830BCBFF1AFF665DA9592C58F061DC64999CA2E27D9F5` |
| 主进程一致性 | `dist-electron/main.cjs` 与 `app.asar.unpacked/dist-electron/main.cjs` SHA256 逐字节一致 |
| asar 标记 | 含 `mon-page`×4 / `monitor-summary` / `af-g3`×8 / `af-chip`×7；旧类 `p0-mcard` / `p0-mgroup` / `p0-tl-item` **0 命中** |
| `git diff -- package.json` | 为空 |

## 三道闸门证据

| 闸门 | 结果 |
|---|---|
| A 影响面回归 | `npm run verify:fast` 全绿：typecheck 0 错、oxlint 0/0、索引新鲜（已 `--write` 刷新）、vitest **319 文件 / 4036 例**全绿、覆盖率达标 |
| B 效果验证 | 监控定向 **77 例全绿**（5 文件），含批次49 新增 6 例：六格空账本 0/未采集分明、全真实值派生（24h 窗外样本不计入 P95）、未采集整串契约、chips 真过滤 + hint 换窗、刷新按钮；导航 rail 由 `aTokens`/`ribbonLayout` 断言钉住 |
| C 变异验证 | `summaryFromLedger` 冷存储 `v: String(coldDormant)` → `v: '0'`：`metricsHonesty` 全真实值用例**精确判红**；还原后 77 例**复绿** |

## 交付闭环

关旧端（进程 4→0，8200~8204 无 LISTENING）→ `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` → 验产物（见上表）→ 启新端（进程 4，8200~8204 全 LISTENING）→ `main.log` 有 `bootstrap:done`（2026-11-21T06:06:43Z）。

## 手动验证步骤（管理员视角）

1. 打开桌面端，切浅色主题 → 左侧功能导航应为浅色（不再是深墨蓝）；切深色 → 导航回深色。
2. 打开「监控」页：页头为「监控告警」+ 诚实副题 + 右上「刷新」；筛选行为级别下拉 + 1h/24h/7d 胶囊 chips + 宿主 Agent 下拉（空账本只有「全部」）。
3. 六格汇总：全部来自真实账本——无拨测样本显示「— 未采集」；冷存储/人工审核/今日召回显真实 0（不是编造）。
4. 点开「全部指标」折叠：20 张指标卡分 8 组，无样本卡显「暂无数据」。
5. 告警时间线：`monitor_alert · 近 24 小时 · N 条`；点 request_id / memory_id 真跳审计页 / 记忆页。
6. 亮暗主题切换，监控页整页跟随（筛选框、卡片、时间线配色同步变化）。

## 已知限制

- e2e（依赖 dist + 浏览器栈）本环境未执行；同等口径已由单测钉住。
- 「检索 P95」六格副名如实标 24h（独立派生），与「全部指标」折叠内 1h 窗口卡口径不同属预期（两处都注明窗口）。
- `release/installer-2026…` 8 个历史目录因句柄占用 EPERM 删不掉（`release/` 已 gitignored，不阻塞交付）。

## 状态

**未提交、未推送**，等用户目视验收 + 明确确认。
