---
status: pending-manual-acceptance
---

# 手动测试报告 · 批次57-B（L3 首页 Stratum A 版式 + 全部接真实数据）

- 日期：2026-11-10
- 分支：main（功能已提交 `b16a018`；ahead 6，**未 push，待授权**）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（127,977,215 B = 122.05 MiB）
- SHA256：`89d3bd87ef91ef744fcaaad2ac3d67781f29768462d6f693ae4c5ffc6b5be8f1`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`
- 关联：`specs/code-map.md` 批次57-B 段落、提交 `b16a018`、上一轮 L1 `4dc137b`
- 范围口径：用户下令「记忆库先暂停，只改首页」+「首页数据要接入真实数据」。本轮**只动首页**，记忆库版式未动。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 首页版式 A 化 | OverviewPage 重写为 `.af-*` 版式：头部（标题+日期/数据根+操作钮）、效果证据四卡、L1–L6 径向图谱+层级行、异常速览、最近审计、右侧遥测四面板（补炼队列/MCP 接入/引擎延迟/今日概览）、页脚（health/壳模式/会话/读取时钟） | `src/web/overview/OverviewPage.tsx` |
| A 令牌浅/深 | 本 iframe 不加载 p0.css/壳层 theme.css，故内嵌 A 令牌：浅 `.ov-page`、深 `html[data-theme="dark"] .ov-page`；组件全 `var()` 自动跟随；useHostTheme + storage 事件同步 | `src/web/overview/overviewPage.css` |
| 真实数据面 | `loadOverview()` 并行取数：内核账本/审计 + 主进程 IPC（refine:state·mcp:clients·llm:config·dataRoot:get）+ /api/health + billing；新增最近审计/补炼/MCP/引擎/数据根五个读取器；单源失败只影响自身字段 | `src/web/shell/overview.ts` |
| 诚实降级 | 各面板 `!available / !ok / 空` 三分支；gains 空→「未取数」、strata null→「未取到」、审计空→「账本为空」、浏览器模式侧栏「非桌面壳不可用」；绝不用演示数或 0 冒充成功读数 | `OverviewPage.tsx` / `overview.ts` |
| 旧派生清理 | 删 `deriveOverviewView/OverviewView/buildInsights` 等旧首页派生（保留 `answerOverviewQuestion`/`OVERVIEW_SUGGESTIONS` 供壳层记忆助手复用） | `src/web/overview/overviewPageData.ts` |
| 壳层降级补字段 | refreshOverview catch 补新字段空值 + `emptyLayerGraph()`，保证壳层层级刻度/状态栏不因新字段缺失崩 | `src/web/shell/Workspace.tsx` |
| 测试 | 新增 `homeView.test.ts`（deriveHomeView 纯派生 6 例，含 C 变异哨兵）；e2e home/overview/crossTabAuth 三 spec 对齐新 DOM；workspace.test 补 mock 字段 | `src/web/overview/__tests__/homeView.test.ts`、`e2e/*.spec.ts` |

## 2. 自动化门禁结果（三道闸门）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| Lint | `npm run lint`（oxlint） | 0 warnings / 0 errors |
| 索引新鲜度 | `npm run code:index:check` | 通过（378 源码 / 120 文档） |
| 无演示标识 | `npm run check:no-demo` | 0 命中 |
| 全量回归（A） | `npm run test:gate`（4 片串行 maxWorkers=1） | **229 文件 / 2648 例 0 失败**；片4 原生崩溃 0xC0000409 按口径重试一次后绿 |
| 真浏览器 E2E（B） | `node e2e/run.mjs --workers=1 e2e/home.spec.ts e2e/overview.spec.ts e2e/crossTabAuth.spec.ts` | **10/10 通过**（真 dist + 真 home 后端 + CDP Chromium） |
| 纯派生单测（B/C） | `npx vitest run src/web/overview/__tests__/homeView.test.ts` | 6/6 通过 |
| 变异验证（C） | `healthOk 'ok'→'down'` 注入 → 指定用例红 → 还原 | 红灯→复绿，无残留 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

> 负载 flaky 说明：并行 `test:coverage` 曾现 4 例超时（personalInvoke/personal/phase6Gate，均非本轮改动文件）；单跑 41/41 绿 + 串行 `test:gate` 全绿证实为满负载超时、非回归。

## 3. 包内产物校验（防「写了≠打进包」）

- `app.asar` 列表含 `\dist\assets\main-nFZiIc0-.js`（本次 vite 构建哈希）、`\dist\assets\workspace-EMFhkjLY.js`、`\dist\index.html`。
- 解包该 `main-nFZiIc0-.js`（12,995 B）实测含标记：`总览工作台 / af-g4 / af-graph / home-today / 未取数 / 非桌面壳` 全为 true → 新首页确在安装包内。
- 校验方式：`@electron/asar.extractAll` 解到临时目录后读文件（裸 grep app.asar 对 unpacked 的 dist-electron 是假阴性，故用解包读内容）。

## 4. 真机手测清单（待用户在安装版执行）

- [ ] 安装/覆盖 `release/installer/MultiAgent Memory-0.1.0-setup.exe`，启动后中心区首页为「总览工作台」A 版式（四卡+图谱+层级行+异常+审计+右侧四遥测+页脚），非旧问候语大卡。
- [ ] 浅色：纸灰底/白面/墨蓝字/电青主按钮；切深色：深空底/暗面/亮字/辉光青；切随系统：跟随 OS。三者版式不溢出、不叠层。
- [ ] 桌面壳登录后：右侧补炼队列/MCP 接入/引擎延迟读主进程真遥测（有配置则显示真名单/延迟，未拨测显示「未拨测」）；今日概览记忆/审计/今日写入/今日召回/待裁决为真计数；页脚「已登录」。
- [ ] 空账本/未登录：四卡显示「未取数」、图谱六枢纽计数 0、今日数字 0、异常/审计诚实空态；**不出现任何演示数字（如 -58%、1467）**；未登录页脚「未登录 · 只读」+「去登录」入口。
- [ ] 登录→页脚变「已登录」且「去登录」消失；登出→回「未登录 · 只读」+「去登录」出现（跨页会话共享不重复登录）。
- [ ] 账本读取失败/锁定时：顶部红色告警给真实原因，下方读数按「读取失败」显示而非 0；L0 写密钥锁定异常出现时顶部提示+「去处理」跳记忆库。
- [ ] 头部「写入记忆/立即备份/重读」与面板「管理/接入/配置/看审计」跳转到对应真实视图；「重读」重新取数并更新页脚读取时钟。
- [ ] 记忆库页（memory-bank）版式与本轮之前一致（本轮暂停未动），无回归。

## 5. 已知边界

- 浏览器直连（无主进程）时侧栏补炼/MCP/引擎与数据根如实「非桌面壳不可用」，今日数字读浏览器临时账本；桌面壳登录后才读主进程 IPC 真遥测。
- 效果四卡空账本恒 4 张「未取数」（computeOnboardGains/emptyOnboardGains 同口径）；图谱恒 6 枢纽 count 0（GRAPH_LAYERS 派生），不伪造节点。
- 打包时 6 个旧时间戳安装包目录被外部进程占用（EPERM）未删，产物已收口到固定 `release/installer`；不影响本次安装包完整性。