# 手动测试报告 · 修复批次 18（接入页启动自动补扫 + 只保留最新程序）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **08:06:25**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer-20261031-000554/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,970,835 B = **116.32 MiB**
  - SHA256：`B5010D165D703DA714C5F2BD5FDB20E81DF456D54EB29CF5E5CBBF8704E51C6D`
- 未打包目录（本次产物）：`release/installer-20261031-000554/win-unpacked/MultiAgent Memory.exe`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-17.md`、`specs/MANUAL-TEST.md` §3.7（通用手测入口）

> **输出目录说明（重要）**：本次打包时，旧实例正从 `release/installer/win-unpacked/MultiAgent Memory.exe` 运行（启动时间 08:02:40），Windows 锁住该目录，脚本按设计把产物落到 `release/installer-20261031-000554` 并保留原目录（未强杀进程）。随后已删除旧目录中的旧安装包文件（setup.exe / blockmap / latest.yml / builder-debug.yml / .icon-ico），旧 `win-unpacked` 仅因正在运行而保留。**关闭旧实例后再执行一次 `npm run package`，即可回到固定目录 `release/installer` 并自动清掉旧 `win-unpacked`。**

---

## 0. 起因与结论

用户提出两件事：

1. 「agent 接入配置页启动后怎么不会自动扫描并接入？」
2. 「我首页图谱怎么没有了？是不是不是最新程序？」以及「只保留最新程序，容易引起误导」。

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| 接入页启动后不自动扫描 | 自动接入只挂在**表单登录成功**事件（`LoginModal`）上；应用重启恢复会话、或直接打开接入页时没有登录事件 | 接入页挂载后检测真实会话，补跑同一三路扫描；近 60s 内已有结果则复用；无会话仍走登录门禁 |
| 首页图谱消失 | 用户启动的很可能是旧的 `release/win-unpacked` 便携包（构建于批次 8 之前，不含图谱/程序日志），而不是最新安装包 | 最新构建已确认含图谱与程序日志；打包成功后自动删除旧便携包 `release/win-unpacked` 与 `release/builder` 残留 |
| 旧程序堆积误导 | 批次17 只清理 `release/installer-*`，旧便携包与 builder 残留长期保留 | 批次18 起成功打包同时清理旧便携包与 builder 残留 |

**结论**：两项需求均已落地；最新产物包含 L1–L6 图谱、首页程序日志、接入页启动补扫。旧运行中实例锁定目录的清理由用户关闭应用后一次重打包完成（见 §2.3、§6.4）。

---

## 1. 接入页启动自动补扫

### 1.1 触发条件

`src/web/AgentOnboard/AgentOnboardPage.tsx` 新增挂载副作用：

1. 必须存在真实会话 `session.sid`（来自 `session:realpage`），且 `session.loading === false`；
2. 近 60 秒内既没有成功状态（`agentOnboardState.lastOnboardAt`），也没有失败快照（`agentOnboardFailure.at`）；
3. `autoScanRef` 保证单次挂载只触发一次（StrictMode 双挂载 / 依赖变化不重复）；
4. 满足条件后调用 `runPipeline('auto')`，执行与登录/手动检测相同的三路真扫：
   - `hostScan:run`（进程 / MCP 注册表）
   - `hostAgentDetect:run`（CLI / 安装目录 / 开始菜单 / 配置 / 注册表卸载项）
   - `mcp:clients`（客户端配置文件真读）
5. `runAutoOnboard` 的模块级 `inFlight` 仍生效：若登录触发正在跑，补扫会复用同一轮，不会并发扫描。

### 1.2 为什么是 60 秒复用窗口

登录成功后 `LoginModal` 已在后台执行一轮自动接入并写 `agentOnboardState`；随后用户切到接入页（可能经 iframe 重新加载）。若页面挂载无条件再扫一遍，会造成重复扫描、重复 `/discover` 调用与重复 MCP 写入尝试。60 秒内直接复用已有成功结果或失败快照，既覆盖「应用重启后无登录事件」的场景，也避免「登录后立刻切页」的重复。

### 1.3 审计与诚实边界

- `onboarding:scan` 的动作日志 `trigger` 现在区分：`login` / `auto` / `manual` / `rebind`；
- 无会话 → 仍显示登录门禁「请先登录」，绝不匿名扫描；
- 纯浏览器 / 无宿主桥 → 补扫如实失败，提示「请使用桌面应用」或点「🔍 手动检测」，不伪造发现行；
- 扫描失败写 `agentOnboardFailure` 快照，页面显示真实失败原因。

### 1.4 测试

`src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx` 新增 3 例（共 18 例）：

| 用例 | 断言 |
| --- | --- |
| 有会话 + 无历史状态 → 自动扫描并接入（无需点击） | 渲染 1 张真实卡片；`scanState` 含「完成 · 发现并绑定 1 个」；`#found` 1 行 |
| 近 60s 内已有成功结果 → 不重复扫描 | 宿主扫描调用次数为 0；显示上次完成状态；无失败横幅 |
| 无真实会话 → 登录门禁，不触发扫描 | 显示「请先登录」；宿主扫描调用次数为 0 |

---

## 2. 只保留最新程序

### 2.1 行为变更

`tools/package-builder.cjs`：

1. 保留批次17 的「先原子重命名 `release/installer` → `installer-<UTC>-stale`，成功后清理」逻辑；
2. 构建成功后，除清理旧 `release/installer-*` 外，**同时删除**：
   - `release/win-unpacked`（旧便携包，最容易误启动）
   - `release/builder`（electron-builder 残留）
3. 删除失败只 `console.warn`，不影响本次打包成功结论；
4. 构建失败时**不**清理旧便携包/残留，并仍把腾空的 `installer` 目录改回固定路径。

### 2.2 本次打包实测

打包日志（节选）：

```text
[package] release/installer 被外部进程占用（EPERM），本次输出改到 release\installer-20261031-000554
...
[package] 已删除旧便携包/残留 release\win-unpacked
[package] 已删除旧便携包/残留 release\builder
[package] 产物：release\installer-20261031-000554；旧安装包目录清理 2 个；release/installer 本次被占用，已保留
```

清理效果：

| 清理项 | 结果 |
| --- | --- |
| 历史 `release/installer-*` 目录 | 删除 2 个 |
| 旧便携包 `release/win-unpacked`（批次8 之前，不含图谱/程序日志） | 已删除 |
| `release/builder` 残留 | 已删除 |
| 旧 `release/installer` 内的旧安装包文件 | 已删除（setup.exe / blockmap / latest.yml / builder-debug.yml / .icon-ico） |
| 旧 `release/installer/win-unpacked` | **保留**（旧实例 08:02:40 启动，目录被 Windows 锁定） |

打包后 `release/` 实际内容：

```text
release/
├─ installer/                 # 旧实例运行中，仅剩 win-unpacked（锁定）
└─ installer-20261031-000554/ # 本次最新产物（安装包 + win-unpacked + 元数据）
```

### 2.3 如何收口到唯一的 `release/installer`

旧实例关闭后，任选其一：

1. **推荐**：直接再执行一次 `npm run package`。脚本会把旧 `release/installer` 重命名为 `installer-<UTC>-stale`，构建成功后将本次 `installer-20261031-000554` 作为旧目录一并清理，最终只剩新的 `release/installer`；
2. 手工：删除 `release/installer`，把 `release/installer-20261031-000554` 重命名为 `release/installer`。

> 在旧实例未关闭前，不要强行删除 `release/installer/win-unpacked`，否则会破坏正在运行的程序。

---

## 3. 首页图谱消失的诊断

### 3.1 证据

| 构建 | 时间 | 内容 |
| --- | --- | --- |
| 旧 `release/win-unpacked` | 目录 10-29 17:07，app 复制 10-30 11:50 | `app.asar` 中**没有**「L1–L6 关系图谱」、**没有**「程序运行日志」、**没有** `log:tail` |
| 批次17 安装包 `release/installer` | 10-31 00:51 | 含图谱、程序日志、`log:tail` |
| 批次18 本次产物 | 10-31 08:06 | 含图谱、程序日志、`log:tail`，并新增「启动后自动扫描」 |

另外，`%APPDATA%\MultiAgent Memory\actions.log` 在旧便携包运行时没有 08:0x 的新动作日志，说明当时运行的构建早于批次7（动作日志）；旧构建自然也没有批次8 的图谱。

### 3.2 结论

**不是最新程序缺图谱，而是误启动了旧的便携包。** 最新安装包与本次新包均含图谱。批次18 起旧便携包会在成功打包后删除，避免再次误启动；本次已删除该旧便携包。

---

## 4. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `specs/MANUAL-TEST-FIX-BATCH-18.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `src/web/AgentOnboard/autoOnboard.ts` | `trigger` 增加 `'auto'`，审计区分页面补扫 |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | 挂载后启动补扫；60s 复用窗口；`useRef` 单次守卫 |
| `src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx` | +3 例启动补扫测试（共 18 例） |
| `tools/package-builder.cjs` | 成功打包后同时清理旧便携包 `release/win-unpacked` 与 `release/builder` 残留 |
| `specs/需求规格书.md` | §19.9 补启动补扫；§19.13 更新打包清理；新增 §19.14 |
| `specs/code-map.md` | 新增批次18 映射；更新批次17/构建说明中的便携包口径 |
| `specs/MANUAL-TEST.md` | 索引 1..18；新增 §3.7；更新单测数量与打包说明 |
| `AGENTS.md` | §9 新增接入页启动补扫；更新打包清理边界 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 刷新（268 文件） |

---

## 5. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（0 错误，渲染 + Electron 双配置） |
| `npm run lint` | 通过（oxlint 0 warning / 0 error） |
| `npm test` | **109 文件 / 1117 用例全过** |
| `npm run test:coverage` | Statements **76.52%** / Branches **68.39%** / Functions **71.68%** / Lines **79.48%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 93 用例全过**（32.6s，真构建产物 + 真后端） |
| `npm run package` | 成功；清理旧 `installer-*` 2 个、旧便携包 `win-unpacked`、`builder`；因运行中实例占用，本次输出时间戳目录 |
| `npm run code:index -- --write` | 已写入 268 个文件 |

### 5.1 打包产物自检

在 `release/installer-20261031-000554/win-unpacked/resources/app.asar` 中确认：

| 字符串 | 所在文件 | 命中 |
| --- | --- | --- |
| `启动后自动扫描` | `dist/assets/agentonboard-*.js` | 是 |
| `L1–L6 关系图谱` | `dist/assets/main-*.js` | 是 |
| `程序运行日志` | `dist/assets/main-*.js` | 是 |
| `log:tail` | `dist-electron/main.cjs`、`dist-electron/preload.cjs`、`dist/assets/main-*.js` | 是 |

---

## 6. 手动测试步骤（待用户执行）

### 6.1 使用本次最新包

1. 先关闭当前正在运行的旧实例（任务管理器结束 `MultiAgent Memory.exe`，或正常退出应用）。
2. 运行 `release/installer-20261031-000554/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；
   - 或直接运行 `release/installer-20261031-000554/win-unpacked/MultiAgent Memory.exe`。
3. 打开首页 → 应看到「🖥 程序运行日志」；登录后应看到「L1–L6 关系图谱」。

### 6.2 接入页启动自动补扫

1. 用管理员登录一次，确认接入页正常自动接入。
2. 完全退出应用，重新启动，打开「Agent 接入配置页」：
   - 不填登录表单，页面应自动显示「启动后自动扫描…（宿主真扫 + 安装痕迹 + MCP 配置）」；
   - 数秒后显示「完成 · 发现并绑定 N 个 · 宿主真扫」，已安装 Agent 自动出现在卡片区；
   - `actions.log` 出现 `[onboarding:scan]` 且 `trigger=auto`。
3. 登录后 60 秒内再次打开接入页 → 应复用上次结果，不重复扫描。
4. 未登录 / 登出后打开接入页 → 仍显示「请先登录」，不匿名扫描。

### 6.3 只保留最新程序

1. 旧实例关闭后执行 `npm run package`：
   - 日志应出现「已删除旧安装包目录」「已删除旧便携包/残留」；
   - 最终 `release/` 只保留 `installer`（最新安装包 + win-unpacked），不再有旧 `installer-*`、`win-unpacked`、`builder`。
2. 若仍被占用，脚本会输出时间戳目录并保留旧目录；关闭占用程序后再执行一次即可。

### 6.4 图谱与日志回归

1. 首页登录后确认图谱六层锚点与缩放按钮存在；空账本显示诚实空态，不出现演示节点。
2. 首页日志窗口显示最近 5 行真实日志，时间 UTC+08:00；有错误时出现「📋 复制诊断信息」。

---

## 7. 已知限制

1. **运行中旧实例锁定目录**：本次打包时旧实例从 `release/installer/win-unpacked` 运行，Windows 拒绝重命名/删除该目录，脚本按设计保留原目录并输出时间戳目录，未强杀进程。关闭旧实例后需再打包一次（或手工替换）才能回到唯一的 `release/installer`。
2. **60 秒复用窗口**：登录后 60 秒内打开接入页不会重新扫描；若这 60 秒内本机新装了 Agent，需等窗口过期或点「🔍 手动检测」。
3. **无会话不扫描**：应用未登录时打开接入页仍走登录门禁；这是安全边界，不是缺陷。
4. **浏览器模式**：`npm run dev` 无宿主桥，补扫会如实失败并提示手动检测；不会伪造发现行。
5. **旧安装包文件已删除**：本次已删除旧 `release/installer` 内的 setup.exe 等文件；旧 `win-unpacked` 因运行中保留，关闭后可清理。
6. 安装包未配置代码签名证书，Windows SmartScreen 可能提示未知发布者（既有情况，非本批次引入）。
7. 本次未故意制造构建失败演练；失败回退逻辑沿用批次17，已通过代码审查与单测，但未在本机破坏性验证。

---

## 8. 结论

- 接入页现在会在**应用重启/直接打开**且存在真实会话时自动补扫并接入，不再依赖表单登录事件；登录后 60 秒内复用结果，避免重复扫描。
- 打包成功后只保留最新安装包，并清理旧 `installer-*`、旧便携包 `win-unpacked` 与 `builder` 残留；本次因旧实例运行中锁定目录，产物落在 `release/installer-20261031-000554`，旧实例关闭后重打包即可回到 `release/installer`。
- 首页图谱消失已定位为旧便携包（批次8 之前）导致；最新包已确认包含图谱与程序日志。
- 自动化门禁全绿：typecheck、oxlint、109 文件/1117 单测、覆盖率阈值、21 spec/93 E2E、打包与产物字符串自检。
- 手动验收请按 §6 执行；未提交 git（按约定等待用户确认）。
