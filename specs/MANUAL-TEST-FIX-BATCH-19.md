---
status: done
---

# 手动测试报告 · 修复批次 19（接入卡片统一格式 + 程序运行日志迁至日志记录页）

> **安装包已被批次20 取代**：批次20 重新打包并清理旧产物，本报告中的安装包路径仍为 `release/installer/...`，但大小/SHA256 已变；最新值见 `specs/MANUAL-TEST-FIX-BATCH-20.md`。本报告保留批次19 的改动、门禁与验收结论。

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **08:29:31**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,970,909 B = **116.32 MiB**
  - SHA256：`9DBBD66267D5867E4899E53146458C0011747C482970724A69AA35B1F34E4409`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-17.md`、`specs/MANUAL-TEST-FIX-BATCH-18.md`、`specs/MANUAL-TEST.md` §3.6/§3.8（通用手测入口）

> **输出目录说明**：本次打包前 `release/` 下无运行中的旧实例（脚本的强制结束检查未命中进程）。首次重命名 `release/installer` 时被瞬时占用（EPERM，无对应进程，Windows 索引器/杀软常见），脚本按兜底输出到 `release/installer-20261031-002909`；构建成功后脚本重试收口：删除旧 `release/installer`、把本次产物移回固定路径，并清理旧 `installer-20261031-002810`。最终 `release/` **只剩 `installer/` 一份产物**。

---

## 0. 起因与结论

用户提出两件事，并追加一条打包要求：

1. 「将 agent 接入配置页内的扫描卡片『自动发现 · 已绑定』和『撤销』按钮移动到上面，和 MVP·P1 Claude Code 平齐，所有接入卡片要统一格式」
2. 「将首页的程序运行日志卡片移动到日志记录页」
3. 「每次打包都要只留最新的打包程序，如遇已经打开的程序请强制关闭后再打包」

| 需求 | 处理 | 结果 |
| --- | --- | --- |
| 扫描卡片状态/撤销上移 | 发现卡片与已安装卡片统一为两行结构：首行 `badge + 名称 + 右侧状态/操作`，次行信号/来源 | 已落地 |
| 所有接入卡片统一格式 | 发现卡片、已安装 Agent 卡片同构；单 Agent 配置大卡原本就是首行对齐；MCP 客户端状态行不受影响 | 已落地 |
| 程序日志卡迁移 | `HomePage` 移除面板；`LogsPage` 标题下方渲染；CSS 从 `Home/theme.css` 迁到 `Logs/extras.css` | 已落地 |
| 打包只留最新 + 强制关闭旧实例 | `tools/package-builder.cjs` 打包前强制结束本仓库 `release/` 下运行中的进程；重命名带 3 次重试；若仍被占用则先输出时间戳目录，**构建成功后重试删除旧目录并收口回 `release/installer`** | 已落地；本次无占用进程，瞬时 EPERM 由构建后收口兜住，产物最终落在 `release/installer` |

**结论**：三项需求均已落地；`verify:fast`、E2E、打包全绿；安装包与 `app.asar` 已确认包含新卡片结构与日志页面板。

---

## 1. 接入卡片统一格式

### 1.1 新结构

`src/web/AgentOnboard/OneClickOnboard.tsx` 的发现卡片：

```text
┌──────────────────────────────────────────────────────────────┐
│ [MVP·P1] Claude Code              [自动发现 · 已绑定 ✓] [撤销] │  ← .found-head
│ 信号：proc · claude.exe · 宿主真扫                            │  ← .found-meta
└──────────────────────────────────────────────────────────────┘
```

已安装 Agent 卡片（同构）：

```text
┌──────────────────────────────────────────────────────────────┐
│ [扩展·P3] Cursor                          [+ 新增接入卡片]    │  ← .found-head
│ [桌面端已装] C:\...\Cursor.exe · v0.42.0                      │  ← .found-meta
└──────────────────────────────────────────────────────────────┘
```

### 1.2 样式作用域

`src/web/AgentOnboard/theme.css` 新增：

```css
.found-card { flex-direction:column; align-items:stretch; gap:6px; }
.found-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.found-actions { margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.found-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
```

- 仅作用于 `.found-card`，`#mcp-client-rows .found`（MCP 客户端接入状态行）仍保持原单行布局；
- 单 Agent 配置大卡 `.card > .top` 原本就是 `badge + 名称 + method + 右侧状态`，本次不改；
- 未绑定卡片沿用 `.found.unbound` 虚线/半透明；`data-disc`、`data-unbind` 选择器与回调下标不变。

### 1.3 行为边界

- 「撤销」仍回调 `onUnbind(index)`；「+ 新增接入卡片」仍回调 `onAddCardForInstalled(agent)`；
- 状态文案不变：`自动发现 · 已绑定 ✓` / `自动发现 · 已绑定 ⚠ 待手动补` / `未发现信号 · 需手填端点`；
- 无任何伪造数据或按钮语义变化。

### 1.4 测试

`src/web/AgentOnboard/__tests__/components.test.tsx`（+1 例，共 14 例）：

| 用例 | 断言 |
| --- | --- |
| 发现卡片首行结构 | 3 张 `.found-card .found-head`；每张首行含 badge、名称、`.found-actions .pill`；`[data-unbind]` 均在首行；次行含 `.method` |
| 已安装卡片同构 | `.found-head` 含 badge/名称/`+ 新增接入卡片`；`.found-meta` 含「桌面端已装」与版本号 |

---

## 2. 程序运行日志卡迁移

### 2.1 位置变更

| 项 | 批次17 | 批次19 |
| --- | --- | --- |
| 渲染页面 | 首页（登录门控 + 已登录） | **日志记录页顶部（标题下方）** |
| 渲染入口 | `src/web/Home/HomePage.tsx` | `src/web/Logs/LogsPage.tsx` |
| 样式归属 | `src/web/Home/theme.css` | `src/web/Logs/extras.css` |
| 组件/逻辑 | `ProgramLogPanel.tsx` + `programLog.ts` | 不变（只更新文件头注释） |

### 2.2 不变的部分

- 数据源仍是主进程 `log:tail` → `tailActionLog` 尾读真实 `<数据根>/actions.log`；
- 窗口显示最近 5 行（内部扫 20 行）、5 秒轮询（页面隐藏暂停）、刷新、错误反馈与诊断复制；
- 时间固定 UTC+08:00；无桌面壳能力时显示「非桌面壳环境：无法读取本机程序日志」，绝不造行；
- `log:tail` 仍是静默通道，不写自身调用日志。

### 2.3 测试

| 测试 | 断言 |
| --- | --- |
| `HomePage.test.tsx` | 首页 `#programLog` 为 `null`（面板已迁出） |
| `LogsPage.test.tsx` | 日志页存在 `[data-testid="program-log"]`（`id=programLog`），显示「非桌面壳环境」，无假日志行 |
| `e2e/home.spec.ts` | 首页 `#programLog` 计数 0 |
| `e2e/logs.spec.ts` | 日志页面板可见、不可用提示正确、无伪造日志行、无脚本异常 |

---

## 3. 打包前强制关闭旧实例

### 3.1 实现

`tools/package-builder.cjs` 新增 `killReleaseProcesses()`，在重命名/构建之前执行：

1. 仅 Windows 生效（NSIS 打包目标）；
2. 通过 `Get-CimInstance Win32_Process` 匹配 `ExecutablePath` **以本仓库 `release/` 开头**的进程；
3. 对命中的 PID 执行 `Stop-Process -Force`，并打印 `[package] 强制结束旧实例 PID <pid> <path>`；
4. 命中后同步等待 800ms，给文件句柄释放时间；
5. 结束失败只 `console.warn`，继续走原有兜底；
6. **不匹配**系统安装版（`%LOCALAPPDATA%\Programs\...`）或其它 Electron 应用，避免误杀。

同时加固目录收口：

1. `renameWithRetry()`：旧 `release/installer` 重命名最多 3 次（间隔 400ms），覆盖索引器/杀软瞬时占用；
2. 若 3 次仍失败，本次构建输出到 `installer-<UTC>`；
3. **构建成功后**若仍处于「时间戳目录」状态，再尝试删除旧 `release/installer` 并把本次产物移回固定路径（此时构建已耗时数十秒，瞬时占用通常已释放）；
4. 仍失败才保留时间戳目录，并输出明确警告。

### 3.2 本次打包实测

```text
[package] release/installer 被外部进程占用（EPERM），本次输出改到 release\installer-20261031-002909
...
[package] 已删除旧 release/installer，并把本次产物收口到固定目录
[package] 已删除旧安装包目录 release\installer-20261031-002810
[package] 产物：release\installer；旧安装包目录清理 1 个
```

- 本次检查时 `release/` 下无运行中的旧实例，因此没有「强制结束」日志；
- 首次重命名为兜底路径（EPERM，查无对应进程），构建成功后重试收口成功；
- 最终 `release/` 只包含 `installer/`（安装包 + `win-unpacked` + 元数据）；
- 旧 `installer-*` 目录 1 个已删除；`win-unpacked` / `builder` 残留如存在也会被清理。

---

## 4. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `specs/MANUAL-TEST-FIX-BATCH-19.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `src/web/AgentOnboard/OneClickOnboard.tsx` | 发现卡片与已安装卡片改为 `found-card` 两行结构 |
| `src/web/AgentOnboard/theme.css` | 新增 `.found-card/.found-head/.found-actions/.found-meta` 作用域样式 |
| `src/web/AgentOnboard/__tests__/components.test.tsx` | +1 例已安装卡片同构；首测增加首行结构断言 |
| `src/web/Home/HomePage.tsx` | 移除 `ProgramLogPanel` 导入与两处渲染 |
| `src/web/Logs/LogsPage.tsx` | 标题下方渲染 `ProgramLogPanel` |
| `src/web/Home/ProgramLogPanel.tsx` | 文件头注释更新为日志记录页（逻辑不变） |
| `src/web/Home/theme.css` | 删除 `.program-log*` 样式 |
| `src/web/Logs/extras.css` | 迁入 `.program-log*` 样式 |
| `src/web/Home/__tests__/HomePage.test.tsx` | 改为断言首页无 `#programLog` |
| `src/web/Logs/__tests__/LogsPage.test.tsx` | +1 例日志页面板诚实不可用 |
| `src/web/Home/__tests__/ProgramLogPanel.test.tsx` | 仅更新文件头注释 |
| `e2e/home.spec.ts` | 首页断言 `#programLog` 计数 0 |
| `e2e/logs.spec.ts` | +1 例日志页面板断言 |
| `tools/package-builder.cjs` | 打包前强制结束 `release/` 下旧实例；重命名 3 次重试；构建成功后收口回固定目录 |
| `AGENTS.md` | §3/§4/§9 更新日志位置与打包强制关闭口径 |
| `specs/code-map.md` | 批次17 面板行更新；新增批次19 映射 |
| `specs/需求规格书.md` | §19.13 位置/落点/测试更新；新增 §19.15 |
| `specs/MANUAL-TEST.md` | §3.6 改为日志记录页；新增 §3.8；更新计数与已知限制 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 刷新（268 文件） |

---

## 5. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（0 错误，渲染 + Electron 双配置） |
| `npm run lint` | 通过（oxlint 0 warning / 0 error，420 文件） |
| `npm test` | **109 文件 / 1119 用例全过**（批次18 为 1117；+2） |
| `npm run test:coverage` | Statements **76.57%** / Branches **68.46%** / Functions **71.76%** / Lines **79.51%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 94 用例全过**（30.0s，真构建产物 + 真后端；批次18 为 93） |
| `npm run package` | 成功；瞬时占用后由构建后收口回 `release/installer`；清理旧 `installer-*` 1 个 |
| `npm run code:index -- --write` | 已写入 268 个文件 |

### 5.1 打包产物自检

| 检查 | 结果 |
| --- | --- |
| `app.asar` 含 `found-head` | 是 |
| `app.asar` 含 `found-card` | 是 |
| `app.asar` 含 `programLogUnavailable` | 是 |
| `dist/assets/agentonboard-*.js`（`agentonboard-DgqEEjIK.js`）含 `found-head`、`新增接入卡片` | 是 |
| `dist/assets/logs-*.js`（`logs-DdJoQyro.js`）含 `程序运行日志`、`programLogUnavailable` | 是 |
| 首页 chunk（`main-BKhIKMO1.js`）**不含** `程序运行日志`、`programLogUnavailable` | 是（已迁出） |
| `release/` 只剩 `installer/` | 是 |

---

## 6. 手动测试步骤（待用户执行）

### 6.1 使用本次最新包

1. 关闭当前正在运行的旧实例（若已打开）。
2. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；
   - 或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`。
3. 打开首页 → **不应**再出现「🖥 程序运行日志」卡片。

### 6.2 接入页卡片统一格式

1. 用管理员登录，打开「Agent 接入配置页」，等待自动扫描完成。
2. 检查 `#found` 每张已绑定卡片：
   - 首行左侧是 `MVP·P1` 等 badge 与 Agent 名称（如 `Claude Code`）；
   - **同一行右侧**是「自动发现 · 已绑定 ✓」与「撤销」；
   - 第二行是「信号：… · 宿主真扫」。
3. 检查「已安装的 Agent」区块：新发现项首行右侧为「+ 新增接入卡片」，第二行为安装方式/路径/版本。
4. 点一次「撤销」→ 仅对应卡片解绑；点「+ 新增接入卡片」→ 新增卡片成功。
5. 检查「MCP 客户端接入状态」行仍为原单行布局（本次未改）。

### 6.3 程序运行日志卡

1. 打开「日志记录页」→ 标题下方出现「🖥 程序运行日志」：
   - 显示最近 5 行真实 `actions.log`，时间为 UTC+08:00；
   - 点「↻ 刷新」立即重读；停留数秒内容自动更新；
   - 底部显示日志文件真实路径。
2. 制造一条 `[error]` → 出现「⚠ 最近 20 条程序日志中有 N 条错误」与「📋 复制诊断信息」；
   - 复制内容含时间、页面路径、日志文件路径与原始行；
   - `actions.log` 出现 `[ui:program_log_copy]`，不含日志正文。
3. 回首页 → 确认日志卡片**不再出现**。

### 6.4 打包只留最新程序

1. 保持应用运行，直接执行 `npm run package`：
   - 打包日志应先出现 `[package] 强制结束旧实例 PID …`（若旧实例从 `release/` 启动）；
   - 若重命名被瞬时占用，会先输出到时间戳目录，构建成功后出现「已删除旧 release/installer，并把本次产物收口到固定目录」；
   - 随后出现「已删除旧安装包目录」「已删除旧便携包/残留」；
   - 最终 `release/` 只剩 `installer/`。
2. 若构建成功后目录仍被占用，脚本会保留时间戳目录并告警；关闭占用程序（或稍后）再执行一次即可收口。

---

## 7. 已知限制

1. **强制关闭范围**：只匹配本仓库 `release/` 下的可执行文件路径；系统安装版（安装在 `%LOCALAPPDATA%`）与其它应用不会被结束。若旧实例不是从 `release/` 启动，则不会被强制关闭，但仍走重命名/时间戳兜底。
2. **瞬时占用**：本次 `release/installer` 的 EPERM 查无对应进程，属于 Windows 索引器/杀软对目录的短暂占用；脚本已用「重命名 3 次重试 + 构建后收口」兜住，最终仍收口到固定目录。若构建后仍被占用，会保留时间戳目录并告警。
3. **非 Windows 平台**：强制关闭逻辑仅 Windows 生效；NSIS 安装包本身也仅在 Windows 构建。
4. **日志窗口位置**：批次19 起只在日志记录页显示，首页不再显示；这是用户要求的行为变更。
5. **卡片布局**：本次只调整发现/已安装卡片的排版，不改 MCP 客户端状态行与单 Agent 配置大卡；窄屏下 `flex-wrap` 会自动换行，仍保持首行右侧操作。
6. **安装包未配置代码签名证书**：Windows SmartScreen 可能提示未知发布者（既有情况，非本批次引入）。
7. **构建失败演练**：本次未故意制造构建失败；失败回退逻辑沿用批次17/18，已通过代码审查，但未在本机做破坏性验证。

---

## 8. 结论

- 扫描卡片与已安装 Agent 卡片已统一为「首行 badge/名称 + 右侧状态/撤销/新增，次行信号/来源」的两行结构，`MVP·P1` 与「自动发现 · 已绑定」现在同一行。
- 程序运行日志卡已从首页迁到日志记录页顶部；首页不再渲染，日志页逻辑与数据源完全不变。
- 打包脚本在打包前会强制结束本仓库 `release/` 下的旧实例；重命名带重试，构建成功后会把时间戳产物收口回 `release/installer`，最终 `release/` 只剩一份产物。
- 自动化门禁全绿：typecheck、oxlint、109 文件/1119 单测、覆盖率阈值、21 spec/94 E2E、打包与产物字符串自检。
- 手动验收请按 §6 执行；未提交 git（按约定等待用户确认）。
