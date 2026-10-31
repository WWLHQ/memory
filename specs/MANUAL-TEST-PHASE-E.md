# 手动测试报告 · Phase E（净化与打包）

- 日期：2026-10-30
- 分支：main（未提交；工作区状态见文末）
- 正式安装包：`release/installer-20261030-034927/MultiAgent Memory-0.1.0-setup.exe`（116.26 MiB）
- 便携包（手动测试用）：`release/win-unpacked/MultiAgent Memory.exe`（本轮已按 E 改动重打）
- 数据目录：`%APPDATA%\MultiAgent Memory`
- 关联报告：`specs/MANUAL-TEST-PHASE-A.md`、`MANUAL-TEST-PHASE-B.md`、`MANUAL-TEST-PHASE-C.md`、`MANUAL-TEST-PHASE-D.md`

## 1. 本轮改了什么（E1–E4）

| 项 | 内容 |
| --- | --- |
| E1 删除陈旧目录 | 删除 `release2/`、`dist-package/`、`dist-pkg-v2/`、`float-test/`、`test-run/` 五个历史构建/调试目录；`dist/`、`dist-electron/`、`release/` 由 `.gitignore` 覆盖 |
| E2 仓库净化 | `.workbuddy/` 7 个本地记忆文件移出索引（文件保留在磁盘，`.gitignore` 新增 `.workbuddy/`）；根目录 4 个一次性启动脚本移入 `tools/archive/`（附 README 说明已退役）；8 个逐字节相同的页面 `theme.css` 合并为 `src/web/shared/theme.css`，对应 8 个 entry 改为 `import '../shared/theme.css'` |
| E3 正式打包 | `devDependencies` 增加 `electron-builder@26.18.0`；新增 `npm run package`；版本号 `0.0.1 → 0.1.0`（package.json / lockfile 同步）；图标 `build-resources/icon.png`（1024×1024，嵌入 exe 并回读验证）；`files` 只收 `dist`、`dist-electron`、`package.json`（node_modules 0 条目） |
| E4 调试残留 | `src/electron/main.ts` 删除 3 处启动调试输出（`[boot] starting...`、`[DEBUG] bootstrap() called`、`[main] waiting for ready`）；代码中无 `LOCALAPPDATA` 调试写盘（检索确认），失败路径的 `console.error` 保留 |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **89 文件 / 793 用例全过** |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 总门禁 | `npm run verify` | 退出码 0 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |
| 便携打包 | `npm run package:win` | 退出码 0 → `release/win-unpacked` |

## 3. 打包产物与体积（E5 验收记录）

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-034927/MultiAgent Memory-0.1.0-setup.exe` | 121,909,750 B = **116.26 MiB**；SHA256 `5E7E7D759115A62722A88AACB36A18A1B17A8CBCBA3B8FA24F5C7DCDE73BAC5F` |
| 未打包目录（安装包形态） | `release/installer-20261030-034927/win-unpacked/` | 358 MB（Electron 45.1.0 运行时占绝大部分） |
| 应用资源 | `resources/app.asar` | 626,622 B，67 个条目；**node_modules 条目数 0** |
| 便携包 | `release/win-unpacked/` | 358 MB（`resources/app/` 解包形态） |
| 应用图标 | `build-resources/icon.png` | 1.1 MB（1024×1024，入库） |
| exe 元数据 | `MultiAgent Memory.exe` | `ProductName=MultiAgent Memory`、`FileVersion=0.1.0`，图标回读为三层记忆堆叠图案 |

安装包目标为 `nsis + dir`（`oneClick=false`、`perMachine=false`、可选安装目录）；同时生成 `latest.yml` 与 `.blockmap`。

### 3.1 打包实现与环境绕行（重要）

- `electron-builder.config.cjs`：`buildResources=build-resources`、默认输出 `release/installer`、`asarUnpack=dist-electron/**/*`、`npmRebuild=false`；`electronDist` 指向 `.data/electron-dist`。
- `tools/prepare-electron-dist.cjs`：从 `node_modules/electron/dist` 生成硬链接发行缓存（实际几乎不占额外磁盘），唯一排除 `resources/default_app.asar`——该文件仅用于 Electron 无 app 参数的默认窗口，打包应用用不到。
- `tools/package-builder.cjs`：先尝试清理 `release/installer`；若被外部进程（本机为工作区索引器）持有句柄无法清理，则自动改用 `release/installer-<时间戳>` 输出，保证 `npm run package` 始终成功，不静默覆盖、不半途失败。
- 本轮 `release/` 下遗留的 `builder/`、`installer/` 是被索引器句柄占用的历史构建目录（已 gitignore）；关闭 IDE/重启后可直接删除，不影响任何产物。

## 4. 打包后启动冒烟（本轮实机）

启动方式（PowerShell 清除本 shell 的 `ELECTRON_RUN_AS_NODE` 后直接运行；资源管理器双击不受影响）：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\installer-20261030-034927\win-unpacked\MultiAgent Memory.exe'
```

| 检查点 | 安装包形态（app.asar，PID 26156） | 便携形态（resources/app，PID 10060） |
| --- | --- | --- |
| 主进程启动 | 存活 | 存活 |
| 端口 8200–8204 | 5/5 LISTENING | 5/5 LISTENING |
| 静态 UI 端口 | 49524 → `/overview.html` 200 | 59216 → `/api/captcha` 200 |
| 镜像账本 | `GET :8201/api/mirror/audit` + 受信 Origin → 200 | 同左（端口探测） |
| Origin 收口 | 恶意 Origin → 403 | 同左 |
| 未登录态 | `GET :8201/api/me` → 401 | — |
| 验证码/入口 | `/api/captcha` → 200；`:8203/ingest/status` → 200 | — |
| stderr 噪音 | **0 字节** | **0 字节** |
| 调试残留 | 无 `[DEBUG]` / `[boot]` / `bootstrap:fatal` | 同左 |
| 启动输出 | 仅 5 条服务/采集器运行日志（mcp 8202、mcp-http 8204、webhook 8203、collector 创建与周期结果） | 同左 |

说明：E3 验收中的「安装后启动」用与安装包完全相同的 `win-unpacked` 载荷实机启动验证；安装/卸载动作留给下方手动用例（不在自动化中静默安装到用户系统）。

## 5. 本轮手动测试用例（Phase E 验收）

### E-1 安装包安装

| # | 操作 | 期望 |
| --- | --- | --- |
| E-1 | 双击 `release/installer-20261030-034927/MultiAgent Memory-0.1.0-setup.exe` | NSIS 向导可选择安装目录；完成后开始菜单/桌面出现「MultiAgent Memory」 |
| E-2 | 右键 exe → 属性 → 详细信息 | 版本 0.1.0；图标为三层记忆堆叠图案（非 Electron 默认图标） |
| E-3 | 启动安装后的应用 | 主窗口加载总览页；无控制台窗口/调试输出；8200–8204 全部监听 |
| E-4 | 设置 → 应用 → 卸载 | 可正常卸载；无残留后台进程 |

### E-2 便携包与主题回归

| # | 操作 | 期望 |
| --- | --- | --- |
| E-5 | 运行 `release/win-unpacked/MultiAgent Memory.exe` | 启动、登录、各页面正常（与安装包同一份代码，仅资源形态不同） |
| E-6 | 依次打开反馈 / 成长 / 生命周期 / 日志 / 模型 / 参数 / 检索 / 安全 8 页 | 暗色主题与改造前一致（共用 `shared/theme.css`）；无样式缺失/错位 |
| E-7 | 关闭应用后确认 8200–8204 退出 | 无残留进程与端口 |

### E-3 重复打包

| # | 操作 | 期望 |
| --- | --- | --- |
| E-8 | `npm run package` | 生成新的 setup exe；若 `release/installer` 被占用会打印一行提示并输出到 `release/installer-<时间戳>`，命令本身始终成功 |

## 6. 回归清单

按 Phase A/B/C/D 报告执行：首页 / 记忆 / 写入 / 审计 / 生命周期 / 争议 / 参数 / 监控 / 反馈 / 安全 / 检索 / 日志 / 模型 / 成长 / 层级 15 个视图 + 接入页 + 浮窗。Phase E 只动了启动日志与样式引用，重点确认：

- 启动无 `[DEBUG]`/`[boot]` 输出，失败时仍有明确错误日志与弹窗；
- 8 个合并主题的页面样式无回归；
- 写→检索、删除→审计、浮窗归因、安全变更审计等闭环与 D 轮一致；
- 关闭主窗后进程与 8200–8204 全部退出。

## 7. 已知问题 / 边界

- 未配置代码签名：SmartScreen 会提示「未知发布者」；安装包未签名属预期。
- `release/installer`、`release/builder` 两个历史目录被本机工作区索引器持有句柄，当前无法删除（已 gitignore）；关闭 IDE 或重启后可删。本轮安装包位于 `release/installer-20261030-034927/`。
- `electron-builder` 提示 `author is missed in package.json`（非阻塞，未虚构作者信息）。
- esbuild 对 `src/agentOnboard/server.ts` 的 `import.meta` 在 CJS 下告警（既有问题，`typeof __dirname` 分支保护，CJS 部署不会执行）。
- 采集器旧版字符游标仍会按文件逐步一次性重扫迁移（D4 语义，去重保证不重复入库）。
- git 工作区未提交：E 轮改动已暂存，但按约束不执行 `git commit`，因此 `git status` 不会显示「干净」——这是流程约束，不是遗漏。

## 8. 版本控制状态（本轮执行）

- 已暂存（未提交）：E1–E4 涉及的 `.gitignore`、`package.json`、`package-lock.json`、`electron-builder.config.cjs`、`build-resources/icon.png`、`tools/prepare-electron-dist.cjs`、`tools/package-builder.cjs`、`tools/archive/*`（4 个移入脚本 + README）、`src/web/shared/theme.css`、8 个 entry、8 个重复 theme.css 删除、`.workbuddy` 7 个文件移出索引、`src/electron/main.ts`，以及本报告。
- 跟踪文件数：517 → **507**（E2 移除 15 个重复/个人文件，新增 4 个工具与资源文件，E5 报告 1 个）；`git ls-files | grep '\.log$'` = 0。
- 工作区统计：`90 A`、`10 AM`、`28 D`、`175 M`、`5 R`、`1 RM`（本报告加入后 A +1）。
- 未执行 `git commit` / `git push`。
