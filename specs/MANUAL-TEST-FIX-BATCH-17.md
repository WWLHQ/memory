---
status: done
---

# 手动测试报告 · 修复批次 17（打包自动清理旧产物 + 首页程序运行日志窗口）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **00:51:21**）
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,970,772 B = **116.32 MiB**
  - SHA256：`a0651b8df1b8b0431eb592c1d11ac9368ae22dfb4b2ac7a6c1ccae59aa4e50c5`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B = 238.36 MiB）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-16.md`、`specs/MANUAL-TEST.md` §3.6（通用手测入口）

> **输出目录说明**：本轮共打包两次。第一次（00:48）清掉了 8 个历史 `release/installer-*` 目录（3 个小目录 + 5 个约 475 MB 目录）；随后把清理逻辑改成「先原子重命名、再清理」，第二次（00:51）验证了重命名路径：旧 `release/installer` → `installer-20261030-165101-stale` → 构建成功后删除，最终仍只有固定目录 `release/installer/`。`release/win-unpacked` 便携目录全程保留。文首 SHA256 为第二次（最终）产物。

---

## 0. 起因与结论

用户要求：

1. **每次打包删除上次的打包**，避免 `release/` 越攒越大占硬盘。
2. 在合适页面增加**程序输出日志窗口**，显示 3–5 行；有问题时提示用户反馈。

| 要求 | 落地 |
| --- | --- |
| 打包清理 | `tools/package-builder.cjs`：构建成功退出后清理旧 `release/installer-*`；保留本次产物与 `release/win-unpacked`；删除失败只告警 |
| 日志窗口位置 | 首页 `HomePage` 顶栏下方，登录前/登录后都显示（第一屏即可见） |
| 显示行数 | 默认 **5 行**，内部扫描最近 **20 行**用于错误判断 |
| 数据来源 | 真实 `actions.log`（含 `actions.log.1..3` 轮转分片）尾读；浏览器/无宿主桥时明确显示不可用，不造假行 |
| 时间口径 | 固定 UTC+08:00 展示（不随机器时区变化） |
| 自动刷新 | 每 5 秒轮询；页面隐藏时暂停；可手动「↻ 刷新」 |
| 问题提示 | 最近 20 行出现 `[error]` → 显示「⚠ …请复制诊断信息反馈给维护者」+「📋 复制诊断信息」 |
| 防刷屏 | `log:tail` 为静默通道，轮询本身不写 IPC/宿主动作日志 |

**核心事实**：面板只展示真实动作日志；复制内容包含时间(+08:00)、页面路径、日志路径与原始行（日志写入时已按 `password|secret|token|authorization|...` 脱敏），复制动作只记条数与是否成功，不记日志正文。

---

## 1. 打包自动清理旧产物

### 1.1 行为

`tools/package-builder.cjs`：

1. 准备输出目录时，若固定目录 `release/installer` 存在，先**原子重命名**为 `release/installer-<UTC 时间戳>-stale`：
   - 重命名成功 → 本次仍输出 `release/installer`，旧目录留给构建成功后清理；
   - 重命名被占用（运行中实例/索引器）→ 保留原目录，本次回退到 `release/installer-<UTC 时间戳>`，不强行结束占用进程；
   - 不再对运行中的旧目录做递归删除，避免「删掉一半文件才失败」。
2. 调用 electron-builder；**仅当构建退出码为 0** 时执行清理：
   - 遍历 `release/` 下以 `installer-` 开头的目录；
   - 跳过本次输出目录；
   - 递归删除其余旧目录（含 `-stale`）并逐条打印 `[package] 已删除旧安装包目录 …`；
   - 删除失败只 `console.warn` 并计入失败数，不改变构建成功结论。
3. 构建失败时：若固定目录已被腾空（`stale` 存在且 `release/installer` 不存在），把旧目录**改回** `release/installer`，优先保住可回退产物。
4. **不会删除** `release/win-unpacked`（便携目录）与 `release/builder`（构建缓存）。
5. 构建失败时不清理旧安装包，避免误删可回退产物。

### 1.2 本次实测（2026-10-31 00:48）

打包前 `release/`：

| 目录 | 体积 |
| --- | --- |
| `installer` | 357 MB（仅 `win-unpacked`） |
| `installer-20261030-074405` | 628 KB |
| `installer-20261030-080930` | 640 KB |
| `installer-20261030-081255` | 640 KB |
| `installer-20261030-083753` | 475 MB |
| `installer-20261030-131026` | 475 MB |
| `installer-20261030-155918` | 475 MB |
| `installer-20261030-160355` | 475 MB |
| `installer-20261030-162718` | 475 MB |
| `win-unpacked` | 358 MB |

打包日志末尾：

```text
[package] 已删除旧安装包目录 release\installer-20261030-074405
[package] 已删除旧安装包目录 release\installer-20261030-080930
[package] 已删除旧安装包目录 release\installer-20261030-081255
[package] 已删除旧安装包目录 release\installer-20261030-083753
[package] 已删除旧安装包目录 release\installer-20261030-131026
[package] 已删除旧安装包目录 release\installer-20261030-155918
[package] 已删除旧安装包目录 release\installer-20261030-160355
[package] 已删除旧安装包目录 release\installer-20261030-162718
[package] 产物：release\installer；旧安装包目录清理 8 个
```

打包后 `release/`：

| 目录 | 体积 |
| --- | --- |
| `installer`（本次安装包 + win-unpacked） | 475 MB |
| `win-unpacked`（便携目录，保留） | 358 MB |
| `builder` | 236 KB |

`release/` 总占用从约 **3.0 GB** 降到约 **0.81 GB**，释放约 **2.2 GB**。

### 1.3 第二次打包（2026-10-31 00:51，验证重命名路径）

第一次清理后把脚本改为「先原子重命名、再清理」，并用第二次打包验证最终路径：

```text
[package] 已删除旧安装包目录 release\installer-20261030-165101-stale
[package] 产物：release\installer；旧安装包目录清理 1 个
```

- 开始前：`release/installer` 存在；
- 脚本将其重命名为 `release/installer-20261030-165101-stale`（未边删边失败）；
- 构建输出到新的 `release/installer`；
- 成功后删除 `-stale` 目录；
- 最终 `release/` 仍只有 `installer`、`win-unpacked`、`builder`，无 `installer-*`。

---

## 2. 首页程序运行日志窗口

### 2.1 数据链路

```text
actions.log（数据根，已脱敏）
  → 主进程 tailActionLog(limit)             // 尾读 ≤128 KiB，最多 20 行，含轮转分片
  → IPC 'log:tail'（静默，不写 ipc 动作日志）
  → preload window.api.log.tail
  → hostBridge 'log:tail'（iframe 子页，静默）
  → ProgramLogPanel（5 秒轮询 / 手动刷新 / 页面隐藏暂停）
```

- 主进程未初始化（数据根未就绪）→ 返回 `ok:false` 与原因；
- 文件为空 → 空态「暂无程序日志」；
- 文件被轮转 → 当前文件行不足时回溯 `actions.log.1..3`；
- `limit` 限幅：`<1` 取 1，`>20` 取 20，非数字取 5。

### 2.2 面板行为（`src/web/Home/ProgramLogPanel.tsx`）

| 场景 | 展示 |
| --- | --- |
| 桌面壳 + 有日志 | 最近 5 行：`HH:MM:SS`（UTC+08:00）+ `info/warn/error` + `scope:action` + 消息；底部日志文件绝对路径 |
| 最近 20 行有 `[error]` | 追加黄色提示「⚠ 最近 20 条程序日志中有 N 条错误。请复制诊断信息反馈给维护者。」+「📋 复制诊断信息」 |
| 日志为空 | 「暂无程序日志（操作后会自动出现）」 |
| 读取失败 | 显示真实错误原因 + 重试按钮 |
| 浏览器 / 无宿主桥 | 「当前为非桌面壳环境，无法读取程序日志」；**不渲染任何日志行** |
| 页面隐藏 | 停止轮询；重新可见后立即刷新一次 |

复制内容示例：

```text
MultiAgent Memory 程序诊断信息
时间: 2026-10-31 00:51:21 (+08:00)
页面: /index.html
日志文件: C:\Users\<用户>\AppData\Roaming\MultiAgent Memory\actions.log

[2026-10-30T16:47:12.345Z] [error] [home:login] [req_x] {"error":"..."}
...
```

复制优先使用 Clipboard API，失败回退 `textarea + document.execCommand('copy')`；成功后记 `[ui:program_log_copy]`，只含 `{lines, errors, copied}`。

### 2.3 位置

`src/web/Home/HomePage.tsx` 在 `TopBar` 之后、登录门控/仪表盘之前渲染 `<ProgramLogPanel />`，因此：

- 未登录：门控卡片下方可见；
- 已登录：四卡/图谱上方可见。

---

## 3. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `src/web/Home/programLog.ts` | 日志行解析、UTC+08:00 时间格式化、错误计数、诊断文本、剪贴板复制 |
| `src/web/Home/ProgramLogPanel.tsx` | 首页日志面板（5 行/20 行扫描/5s 轮询/错误提示/复制） |
| `src/web/Home/__tests__/programLog.test.ts` | 12 例纯函数测试 |
| `src/web/Home/__tests__/ProgramLogPanel.test.tsx` | 6 例面板测试（不可用/5 行/空/读取失败/刷新/复制） |
| `specs/MANUAL-TEST-FIX-BATCH-17.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `tools/package-builder.cjs` | 构建成功后的旧安装包目录清理 + 固定目录占用回退 |
| `src/shared/actionLog.ts` | 新增 `ActionLogTailResult` 共享类型 |
| `src/electron/actionLog.ts` | 新增 `tailActionLog`（尾块读取、轮转回溯、限幅） |
| `src/electron/ipcChannels.ts` | 新增 `logTail: 'log:tail'` |
| `src/electron/preload.ts` | 暴露 `api.log.tail` |
| `src/electron/main.ts` | 注册 `log:tail`；`QUIET_IPC_CHANNELS` 抑制轮询 IPC 日志 |
| `src/desktop/hostBridge.ts` | `HostMethod`/`CHANNEL_TO_NATIVE` 增加 `log:tail`；`QUIET_METHODS` 抑制宿主日志 |
| `src/web/Home/HomePage.tsx` | 首页登录前后渲染日志面板 |
| `src/web/Home/theme.css` | `.program-log*` 样式 |
| `src/electron/__tests__/actionLog.test.ts` | +5 例尾读测试（共 14 例） |
| `src/web/Home/__tests__/HomePage.test.tsx` | +1 例：未登录也显示日志面板且不造假行（共 6 例） |
| `e2e/home.spec.ts` | 首页首屏断言日志面板存在、浏览器模式显示不可用、无日志行 |
| `specs/需求规格书.md` | 新增 §19.13 首页程序运行日志窗口（批次17） |
| `specs/code-map.md` | 新增批次17 映射；打包说明补清理行为 |
| `specs/MANUAL-TEST.md` | 索引 1..17；新增 §3.6；更新单测/E2E 数量与已知限制 |
| `AGENTS.md` | §2 打包说明、§3 任务→文件、§4 静默尾读、§9 边界 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 刷新（268 文件） |

---

## 4. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（0 错误，渲染 + Electron 双配置） |
| `npm run lint` | 通过（oxlint 420 文件，0 warning / 0 error） |
| `npm test` | **109 文件 / 1114 用例全过** |
| `npm run test:coverage` | Statements **76.45%** / Branches **68.23%** / Functions **71.7%** / Lines **79.41%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 93 用例全过**（31.2s，真构建产物 + 真后端） |
| `npm run package` | 成功；第一次清理历史 `installer-*` **8 个**，第二次验证重命名路径并清理 `-stale` **1 个**；最终产物 `release/installer` |
| `npm run code:index -- --write` | 已写入 268 个文件 |

### 4.1 打包产物自检

在 `release/installer/win-unpacked/resources/app.asar` 中确认：

| 字符串 | 命中次数 | 含义 |
| --- | --- | --- |
| `log:tail` | 2 | 主进程 IPC 通道 + 宿主桥通道已进包 |
| `program-log` | 1 | 面板 CSS/结构已进包 |
| `program_log_copy` | 1 | 复制诊断动作日志已进包 |
| `程序运行日志` | 1 | 面板标题已进包 |

> `main.cjs` 经 esbuild 压缩，函数名 `tailActionLog`/`QUIET_IPC_CHANNELS` 不以原名保留；以通道字符串与面板文案命中为准。

---

## 5. 手动测试步骤（待用户执行）

### 5.1 安装与启动

1. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动（或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`）。
2. 打开首页。

### 5.2 日志窗口（未登录）

1. 首页应出现「🖥 程序运行日志」卡片（在登录门控上方/附近）。
2. 预期：
   - 显示最近 5 行真实日志，时间为 UTC+08:00；
   - 底部显示 `…\MultiAgent Memory\actions.log` 路径；
   - 不出现任何示例/伪造日志行。

### 5.3 日志窗口（登录后）

1. 用管理员或普通账号登录。
2. 点击几个按钮（如「参数」页保存、首页刷新图谱），回到首页。
3. 预期：
   - 5 秒内新日志出现在面板顶部；
   - 点「↻ 刷新」立即重读；
   - 切到其它页/最小化 ≥10 秒再回来，不重复刷屏，恢复后立即刷新。

### 5.4 错误提示与复制诊断

1. 制造一条真实错误，任选其一：
   - 停掉接入后端（结束占用 8200 端口的进程）后点一次「撤销并重接」；
   - 或临时向数据根 `actions.log` 追加一行：
     `[2026-10-31T00:50:00.000Z] [error] [manual:test] [req_manual] {"error":"manual test"}`
2. 回到首页，预期出现「⚠ 最近 20 条程序日志中有 N 条错误。请复制诊断信息反馈给维护者。」
3. 点「📋 复制诊断信息」→ 粘贴到记事本，确认包含：时间(+08:00)、页面路径、日志路径、原始错误行。
4. 打开 `actions.log`，确认出现 `[ui:program_log_copy]`，且该行只有 `{lines, errors, copied}`，**不含日志正文**。

### 5.5 轮询不污染日志

1. 首页停留 ≥1 分钟（期间不要操作）。
2. 检查 `actions.log`：**不应**出现 `ipc:log:tail` 或 `host:log:tail` 行；其它操作日志正常。

### 5.6 浏览器模式降级

1. `npm run dev` 打开首页。
2. 预期：日志卡片显示「当前为非桌面壳环境，无法读取程序日志」，无日志行、无错误提示；控制台无异常。

### 5.7 打包清理复测（可选）

1. 记录当前 `release/` 内容：应只有 `installer`、`win-unpacked`、`builder`，无 `installer-*`。
2. 再次执行 `npm run package`：
   - 若 `release/installer` 未被占用 → 先重命名为 `installer-<UTC 时间戳>-stale`，再输出到 `release/installer`，结束后 `-stale` 被删除；
   - 若被占用（重命名失败）→ 原目录保留，本次输出 `release/installer-<时间戳>`，其余旧时间戳目录仍被清理；
   - 日志出现「旧安装包目录清理 N 个」；
   - `release/win-unpacked` 始终保留。
3. 若想验证构建失败回退：临时让 `electron-builder` 失败（例如断网且无本地 Electron 缓存），确认旧目录被改回 `release/installer`；验证后恢复环境。

### 5.8 时间口径

1. 记录本机当前时间（UTC+08:00）。
2. 做一次操作，确认面板中新行的时间与当前本机时间一致（不是 UTC 00:xx 之外的 8 小时偏差）。
3. 若把系统时区临时改为其它时区，面板时间仍应为 UTC+08:00（明确标注口径）。

---

## 6. 已知限制

1. 日志窗口只读 `actions.log`（含轮转分片），不包含内核审计、`main.log`、`float.log`；这些仍到「审计/日志」页或数据根查看。
2. 错误提示按「最近 20 行」判断：旧会话遗留的错误也会触发提示，属预期；清空/轮转 `actions.log` 后提示消失。
3. 日志脱敏在写入时完成；面板与复制不做二次脱敏。若手工向 `actions.log` 写入明文敏感信息，面板会原样展示（这是人为绕过，不是程序写入路径）。
4. 尾读单次最多读取文件尾 128 KiB、最多返回 20 行；若单行超长或文件尾部块从行中间开始，会丢弃首个不完整行。
5. 浏览器模式无宿主桥，日志窗口不可用；这是诚实降级，不是缺陷。
6. 打包清理只处理 `release/installer-*`；不删除 `release/win-unpacked`、`release/builder`。若 `release/installer` 被运行中程序占用，重命名会失败，脚本保留原目录并改用时间戳输出，不改动运行中实例。
7. 构建失败时不清理旧安装包；若固定目录已被腾空，会把旧目录改回 `release/installer`，避免误删可回退产物。
8. 安装包未配置代码签名证书，Windows SmartScreen 可能提示未知发布者（既有情况，非本批次引入）。
9. 「构建失败时把 `-stale` 改回 `release/installer`」分支已通过语法检查与代码审查，但本次未故意制造构建失败做破坏性演练；需要时按 §5.7 第 3 步验证。

### 6.1 为什么 `win-unpacked` 里很多文件显示 1980/1/1 8:00

这是 **Electron 官方预编译分发包自带的 ZIP 时间戳**，不是本次构建时间写错：

- ZIP/DOS 时间戳的最小值是 `1980-01-01 00:00:00`；Electron 的 npm 包解压后，文件 mtime 为 `1980-01-01 00:00:00 UTC`，在 UTC+08:00 下显示为 `1980/1/1 8:00`。
- 已核对 `node_modules/electron/dist/electron.exe`、`ffmpeg.dll`、`resources.pak`、`icudtl.dat` 等原始文件均为该时间；`.data/electron-dist` 用硬链接继承，打包复制后仍是该时间。
- `release/win-unpacked` 是便携包（`npm run package:win`），`MultiAgent Memory.exe` 只是把 `electron.exe` 重命名，未被改写，因此保留 1980。
- 安装包目标（`release/installer`）里，electron-builder 会改写 `MultiAgent Memory.exe` 的 PE 资源（asar integrity），所以该 exe 显示本次构建时间；`resources/`、`app.asar` 等新生成文件同样是构建时间。
- 不影响功能、版本号、安装/卸载或更新判断。若希望资源管理器统一显示构建时间，可在打包末尾加一次 mtime 归一化（只改时间戳、不改内容）；本批次未启用。

---

## 7. 结论

- 批次17 的两项需求均已落地：打包成功后自动清理旧安装包目录；首页新增真实程序日志窗口（5 行显示、UTC+08:00、5 秒刷新、错误提示与一键复制诊断）。
- 自动化门禁全绿：typecheck、oxlint、109 文件/1114 单测、覆盖率阈值、21 spec/93 E2E、打包与产物字符串自检。
- 本次打包实测：第一次清理 8 个历史 `installer-*` 目录，`release/` 从约 3.0 GB 降到约 0.81 GB；第二次验证最终的重命名路径，清理 1 个 `-stale` 目录；便携目录 `release/win-unpacked` 保留。
- 手动验收请按 §5 执行；未提交 git（按约定等待用户确认）。
