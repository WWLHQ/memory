---
status: done
---

# Phase A 手动测试报告（2026-10-30）

> 覆盖：A1 注册去接管 / A2 IPC 补齐 / A3 bootstrap 失败可见化 / A4 端口单一真源 / A5 CORS-Origin 收口，
> 外加本轮「注释乱码清理 + 被注释真代码恢复 + 采集器首扫修复」的回归。

## 0 · 交付物与启动

| 项 | 值 |
|---|---|
| 可执行文件 | `D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\win-unpacked\MultiAgent Memory.exe` |
| 启动方式 | **双击** exe 即可（无需 node_modules，便携目录可整体拷走） |
| 若从命令行启动 | 先清除 `ELECTRON_RUN_AS_NODE`（本机某些 shell 会注入它，导致 electron.exe 退化为 Node 直接退出）：`$env:ELECTRON_RUN_AS_NODE=''; Start-Process "…\MultiAgent Memory.exe"` |
| 数据目录 | `%APPDATA%\MultiAgent Memory`（记忆账本 memories.db.json、审计 home-audit.json、采集游标 collector-cursor.json、main.log） |
| 旧版数据 | 旧包使用 `%APPDATA%\multi-agent-memory`，**不会自动迁移**；如需旧数据，退出应用后把 `memories.db.json` 复制到新目录再启动 |
| 重置环境 | 退出应用后删除 `%APPDATA%\MultiAgent Memory`（会清空账号/记忆/审计，谨慎） |

启动后窗口加载 `overview.html`（通览页），左侧导航切换各子页；本机端口固定 8200–8204。

## 1 · 本轮变更（相对上一版可执行文件）

1. **删除 iframe preload 死代码**：`session.registerPreloadScript` 对子 frame 实际无效（实测 iframe 内仍无 `window.api`），已移除。iframe 能力走既有 `desktop/hostBridge.ts` 消息桥（顶层窗口代理 storage/hostScan 等），这是设计路径。
2. **恢复被注释掉的浮窗定位真代码**：`x = pos.x + pos.width + 8`、右侧放不下回退左侧、垂直居中三处此前被吞进 `//` 注释，已恢复。
3. **采集器修复（三条）**：
   - `source` 改为函数形式，每轮现取 `cursor` 与 agent 白名单 → 增量续采真正生效；
   - 每轮扫描后回写内存游标 `collectorCursor = scan.cursors`；
   - 恢复 `storage.beginBatch()`（此前整批写入每条都同步全量落盘，易卡事件循环）。
4. **首扫修复**：原代码监听不存在的 `webContents 'did-ready-to-show'`，首扫永不触发；改为统一延迟 10s 启动。实测首扫成功：`collected=50, deduped=734, skipped=8`。
5. **调试脚手架清理**：移除 exe 同目录 `debug.log` 写入、`%LOCALAPPDATA%\MultiAgentMemory-dbg` 探针日志、`MAIN_PROCESS_STARTED`/`[main] booting...` 等启动噪音，删除重复 electron 导入。
6. **注释乱码清理**：main.ts 历史编辑造成的 `?` 乱码注释全部重写；窗口标题由空白乱码改为「多Agent记忆助手」，浮窗标题改为「归因浮窗」。

## 2 · 自动化门禁（本次已跑）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过（无输出） |
| `npx vitest run` | **86 文件 / 753 用例全绿** |
| 受影响子集（electron/home/agentOnboard/web） | 12 文件 / 83 用例全绿 |
| `npm run package:win` | `[package] OK -> release\win-unpacked\MultiAgent Memory.exe` |

## 3 · 本次打包应用冒烟实测

| 检查 | 命令/方式 | 结果 |
|---|---|---|
| 本机端口 | `Get-NetTCPConnection` | 8200/8201/8202/8203/8204 均监听 |
| iframe 宿主桥 | CDP 注入消息桥请求 `storage:location` | `{ok:true, path:"C:\\Users\\LHQ\\AppData\\Roaming\\MultiAgent Memory\\memories.db.json", source:"userData"}` |
| A5 恶意来源 | `curl -H "Origin: http://evil.example" /api/me`、`/agents` | home **403**、agentOnboard **403** |
| 首扫 | main.log | `collector:first-scan:scheduled` → `start` → `done {"collected":50,"deduped":734,"skipped":8}` |
| 游标落盘 | `%APPDATA%\MultiAgent Memory\collector-cursor.json` | 已生成（158,957 字节，时间与首扫一致） |
| 调试残留 | exe 目录 debug.log / LOCALAPPDATA dbg 目录 | 均为旧时间戳，本次启动**未再写** |

## 4 · 手动用例（请逐项打勾）

### A1 注册接口：不去接管、不污染锁定

1. 首页顶栏「▶ 登录」→ 切到「注册」。
2. 输入新账号（手机号/邮箱）+ 密码 + 确认密码 + 验证码 → 提交。
   - **预期**：注册成功；团队自动为 `personal-<账号>`（个人端）。
3. 用该账号登录 → **预期**：成功进入已登录态。
4. 退出后，用**同一账号再注册一次**。
   - **预期**：提示「账号已存在」（409），且**不会**把原密码改掉；用原密码仍可登录。
5. 连续 5 次用错误密码「注册探测」（不需要真提交成功）后，用**正确密码登录**。
   - **预期**：不会被误锁（注册探测不计入登录失败锁定）。
6. （可选）对已锁定账号再次注册 → 仍提示已存在，且正确密码登录仍为锁定态（423）。

### A2 IPC 补齐与启动自检

1. 启动应用 → **预期**：无「MultiAgent Memory 启动失败」弹窗、无控制台 `IPC rejected` 报错。
2. 进入「记忆管理」→ 点开任意一条记忆 → 抽屉「存储位置」。
   - **预期**：桌面壳内显示真实文件路径（`…\AppData\Roaming\MultiAgent Memory\memories.db.json`），不是「内存态」。
3. 进入「Agent 接入」→ 一键接入/本机扫描。
   - **预期**：能读到本机进程/CLI（显示真实检测结果），不再提示「非桌面壳环境」。

### A3 bootstrap 失败可见化（可选，进阶）

1. 先用 PowerShell 占住 8200 端口：`$l=[System.Net.Sockets.TcpListener]::new([ipaddress]::loopback,8200); $l.Start(); Read-Host '占用中，按回车释放'`。
2. 保持占用，双击应用。
   - **预期**：弹出「MultiAgent Memory 启动失败」错误框（含 `EADDRINUSE` 信息），点确定后进程退出；`main.log` 记录 `bootstrap:agentOnboard-error`。
3. 回到 PowerShell 回车释放端口，再启动 → 正常。

### A4 端口单一真源

1. 通览页按 F12 → Elements → 找 `iframe#stage`。
   - **预期**：src 自带 `?backend=http://127.0.0.1:8201&agentBackend=http://127.0.0.1:8200`。
2. 把该 iframe 的 backend 参数临时改为 `?backend=http://127.0.0.1:9` 后刷新子页。
   - **预期**：登录/审计请求失败并诚实提示（说明参数覆盖生效），页面不崩溃。

### A5 CORS / Origin 收口

1. PowerShell 执行：
   ```powershell
   curl.exe -s -o NUL -w "home=%{http_code}`n" -H "Origin: http://evil.example" http://127.0.0.1:8201/api/me
   curl.exe -s -o NUL -w "onboard=%{http_code}`n" -H "Origin: http://evil.example" http://127.0.0.1:8200/agents
   ```
   - **预期**：`home=403`、`onboard=403`。
2. 应用内正常使用登录/接入 → **预期**：不受影响（精确 UI origin 在白名单内）。
3. DevTools Network 查看任一后端响应头 → **预期**：`Access-Control-Allow-Origin` 为精确来源，**没有** `*`，且含 `Vary: Origin`。

## 5 · 回归用例

1. 首页登录/注册（A1 已覆盖）→ 顶栏已登录、四个指标卡点亮。
2. 通览页左侧全部已落地视图（当前 15 个）逐一切换 → 无空白页、无控制台红色报错。
3. 记忆管理：列表显示**真实采集**的记忆（首扫 50 条）；置顶/删除/详情可用，审计有对应记录。
4. 审计日志页：能看到真实 `login` / `team_assign` / 采集写入等 action；筛选可用。
5. 全局参数 → 记忆库管理卡片：显示真实 db 路径与备份配置。
6. 内联归因浮窗：在「内联标识」页打开浮窗 → 未安装 Claude 时屏幕居中显示（不崩溃）；安装 Claude 时可贴靠其窗口。

## 6 · 已知问题与边界（非本轮范围）

1. `e2e/app.spec.ts`、`e2e/overview.spec.ts` 仍按旧版 3 条种子卡片断言，种子清除后预期失败（**与打包应用无关**，仅 e2e 存量待重写）。
2. iframe 内 `window.api` 为 undefined 属**设计行为**（走宿主桥）；若后续改动请勿再尝试 `registerPreloadScript`。
3. 采集器写库账号固定 `u1/t1/e1`（单机默认），待后续轮次接登录态。
4. 纯浏览器打开（非桌面壳）时，Agent 接入扫描诚实降级为「内核模拟」，属预期。
5. 旧数据目录 `%APPDATA%\multi-agent-memory` 不迁移（见 §0）。

## 7 · 问题记录

| # | 页面/用例 | 现象 | 严重度 | 备注 |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
