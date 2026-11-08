# 顶部三层并一条 + 删默认菜单（2026-11-08）

- 基准：`UI-Design-Proposals/final-01-workspace.html`（v8-01 定稿）
- 改造前取证：`release/topbar-audit/before-packaged-top.jpg`（真实安装包运行）
- 定稿取证：`release/topbar-audit/design-window.png`、`design-top.png`
- 改造后取证：`release/topbar-audit/after-packaged-1280-light.jpg`、`after-packaged-1024-dark.jpg`（真实安装包运行）、`after-1280-light.png`、`after-1280-dark.png`、`after-1024-light.png`、`after-1024-dark.png`（网页区四组合）、`shortcut-f5-status.png`（F5 提示）

## 一、改造前：谁在画，重复在哪

| 层 | 内容 | 由谁绘制 | 是否重复 |
|---|---|---|---|
| ① 系统标题栏 | 「MemoryDesk 记忆工作台」+ 最小化/最大化/关闭 | Windows / Electron 默认 `titleBarStyle: default` | 应用名与 ③ 重复；系统标题栏 + 菜单 + 自绘行叠成三行 |
| ② 默认应用菜单 | `File / Edit / View / Window`（英文） | Electron 默认应用菜单（`Menu`） | 与 ③ 的 Ribbon 命令重复，且语言不一致 |
| ③ 自绘标题行 | 应用名 · 当前库/文档 + Ribbon 8 标签 + 查找框 + 折叠 | 壳层 `Workspace.tsx` + `theme.css` | 与 ① 应用名、② 菜单重复 |

定稿只有一条：品牌标记 + 应用名 + 库/文档 + Ribbon 标签 + 右侧查找/折叠，窗口按钮由系统覆盖层画在右侧，没有菜单栏。

## 二、改造后：一条自绘标题栏

- `main.ts`：主窗口 `titleBarStyle: 'hidden'` + `titleBarOverlay`（高 34px，浅/深两套 `color/symbolColor`）；`app.whenReady()` 首行 `Menu.setApplicationMenu(null)`，不再自建中文菜单。
- 标题栏结构：`.ribbon-tabs` 一条内依次为 `.tb-left`（品牌标记 + 「MemoryDesk 记忆工作台」+ 分隔 + 当前库/文档 + 登录态徽标）→ `.rib-tabs`（8 个 Ribbon 标签）→ `.rib-spring` → `.rib-search` → `.rib-fold`；删除第二行重复标题。
- 拖拽：`.shell.electron .ribbon-tabs { -webkit-app-region: drag; padding-right: calc(146px / zoom) }` 为系统三按钮留位；标签、查找框、折叠按钮全部 `no-drag`。
- 主题同步：壳层切换浅/深时经 `shell:titleBarTheme` IPC 调 `setTitleBarOverlay`，按钮配色跟随主题。
- 快捷键：默认菜单删除后由主进程 `before-input-event`（焦点在 iframe 内同样生效）捕获 F5/F9/F1/Ctrl+F/Ctrl+K，经 `shell:shortcut` IPC 交壳层执行；浏览器模式才注册 `window` keydown，两者互斥不双触发。

## 三、验收

### 顶部只有一条（真实安装包）

| 组合 | 窗口宽度 | 标题栏条数 | 标签右缘 / 查找框左缘 | 间距 | 重叠 | 横向溢出 |
|---|---|---|---|---|---|---|
| 浅色 | 1280 | 1 | 814 / 920 | 106 | 否 | 否 |
| 深色 | 1280 | 1 | 814 / 920 | 106 | 否 | 否 |
| 浅色 | 1024 | 1 | 602 / 718 | 116 | 否 | 否 |
| 深色 | 1024 | 1 | 602 / 718 | 116 | 否 | 否 |

拖拽区实测 `-webkit-app-region: drag`，查找框 `no-drag`，标题栏高 34px，右侧预留 146px（随缩放换算）。

### 窗口与快捷键（真实安装包，Win32 真实鼠标/键盘）

| 项 | 结果 |
|---|---|
| 拖拽移动 | 通过（窗口位移随鼠标） |
| 双击标题栏最大化 | 通过（`IsZoomed=True`，再次双击还原） |
| 最小化按钮 | 通过（`IsIconic=True`，可还原） |
| 最大化按钮 | 通过（`IsZoomed=True`，可还原） |
| 关闭按钮 | 通过（进程正常退出） |
| Ctrl+F | 通过（聚焦顶部查找框并过滤左侧导航） |
| Ctrl+A / Ctrl+C / Delete / Ctrl+V | 通过（系统编辑命令保留，文本可全选复制粘贴） |
| F9 | 通过（切到「安全与账号」） |
| F1 | 通过（状态栏显示快捷键说明） |
| F5 | 通过（状态栏「已刷新中心区真实页面与底部面板/状态栏读数。」） |

### 工程闸门

`typecheck`、`lint`、`build`、`build:electron` 全部通过；`check-no-demo`、`test:gate` 通过；索引 `--write` 后 `--check` 一致。
