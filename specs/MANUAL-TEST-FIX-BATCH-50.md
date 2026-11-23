# 手动测试报告 · 批次50（2026-11-21）

## 改动清单（用户截图反馈三项）

1. **顶栏可点性**：根因不是功能缺失——顶栏功能此前已全部接线（搜索=命令面板、浅色/深色/随系统三联=setTheme、⚙=首启向导、右侧工具簇八钮、头像=登录）。真正原因是 Electron 拖拽区 `no-drag` 白名单漏了主题三联 / ⚙ 首启向导 / 头像·角色 / 回到工作台，它们落在拖拽区里点击被吞。已补齐白名单（`src/web/shell/theme.css`）。
2. **最小化/最大化下面图标缺失**：`win-space`（系统三按钮占位 135px）是绝对定位、不参与布局，标题栏右侧内容（头像·角色 / 工具簇尾部）伸进了系统三按钮覆盖层（titleBarOverlay 高 32px 不透明底）下面被盖住。已给标题栏右缘让位：`padding-right: calc(135px * var(--shell-zoom, 1))`。
3. **竖向滚动条跟随主题**：此前无任何自定义滚动条规则，Chromium 默认深灰跟随系统 nativeTheme 而非应用内主题。已在壳层 `shell/theme.css` 与全部 iframe 页共用的 `shared/p0.css` 加令牌化规则（thumb = `color-mix(in srgb, var(--muted) 40%, transparent)`），浅色浅 / 深色深，随主题即时切换。
4. **「全部指标」小卡片配色统一**：`mon-mcard` 从 `--surface2` 底 + 4px 圆角改为与上方六格 af-stat 同款 `--surface` 底 + line 边 + 10px 圆角（crit/warn 染色本就混 surface，同源）。

## 产物

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe`（14:40:00） |
| 大小 | 123.3 MB |
| SHA256 | `E9A851E805F248D4D06345A557F22884F578A08853301ADB3FAA8F9719C89D90` |
| 主进程一致性 | `dist-electron/main.cjs` 与 `app.asar.unpacked/dist-electron/main.cjs` SHA256 一致 |
| asar 标记 | `padding-right:calc(135px * var(--shell-zoom,1))` ✓、`.mon-mcard{background:var(--surface)` ✓、`::-webkit-scrollbar-thumb`×8 ✓ |
| `git diff -- package.json` | 为空 |

## 三道闸门证据

| 闸门 | 结果 |
|---|---|
| A 静态门禁 | typecheck 0 错、oxlint 0/0、索引新鲜（verify:fast 前半段全过） |
| B 效果验证 | `npm run test:gate`：319 文件 / 4038 例（verify:fast 连续两次 0xC0000409 原生崩溃，按批次48 口径改走 test:gate；片3 首跑原生崩溃自动重试，二次 1 例 WritePage 集成偶发失败、单跑 13/13 复绿，其余 4037 例全绿）；定向 ribbonLayout+metricsHonesty 47/47 两轮绿 |
| C 变异 | 删 titlebar `padding-right` → ribbonLayout 批次50 用例精确判红；还原复绿 |

新增钉子测试：ribbonLayout「标题栏可点区全量 no-drag + 右缘让位 + 滚动条跟随主题」、metricsHonesty「mon-mcard 与六格同配色」。

## 交付闭环

关旧端（进程 0、无 LISTENING）→ 打包 → 验产物（上表）→ 启新端（进程 4，8200~8204 全 LISTENING）→ main.log collector 正常调度。

## 手动验证步骤

1. 点顶栏「浅色 / 深色 / 随系统」三联 → 主题应即时切换（此前点了没反应）；点 ⚙ 首启向导、点头像 → 应能打开对应面板。
2. 看标题栏最右：头像圆标与「admin · 管理员」应完整显示在系统三按钮左侧（此前被盖住只露残影）。
3. 切浅色主题 → 左右两条竖滚动条变浅灰；切深色 → 变深。监控页内部滚动条同样跟随。
4. 监控页展开「全部指标」→ 小卡片与上方六格同为白底细边 10px 圆角，视觉一体。

## 已知限制

- 历史旧安装包目录（release/installer-2026…）9 个因句柄占用 EPERM 删不掉，`release/` 已 gitignored，不阻塞交付。
- 0xC0000409 原生崩溃为 vitest worker 偶发（本批 verify:fast 连续两次），test:gate 已有重试口径兜底。

## 状态

**未提交、未推送**，等用户目视验收 + 明确确认。
