---
status: done
---

# 手动测试报告 · 修复批次 23（开发态登录一键启动 + 效果证据迁首页 + MCP 一键适配全覆盖）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **11:26**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,975,243 B = **116.32 MiB**
  - SHA256：`95b899d9157b04d0484b470f365f9ffdc6bd07c2aba5a47c4226db54707c0d20`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B = 238.36 MiB）
- 关联文档：`specs/MANUAL-TEST.md` §3.11、`specs/code-map.md` 批次23、`specs/需求规格书.md` §19.18

> **输出目录说明**：本次打包前 `release/installer` 被外部进程占用（日志 `[package] release/installer 被外部进程占用（EPERM）`），产物先输出到 `release/installer-20261031-032552`；构建成功后按批次21 的兜底逻辑（rename 持续 EPERM → 复制+删除）收口回 `release/installer`。最终 `release/` **只剩 `installer/` 一份产物**。

---

## 0. 起因与结论

用户提出三项问题：

1. 「web 端登录显示登录后端未响应（localhost：8201），请从桌面端打开本应用，或先运行 npm run dev:backend 启动本机登录服务。」
2. 「将 agent 接入配置页的效果证据 4 卡片移动到首页关系图谱卡片上方。」
3. 「MCP 接入卡片中一键适配全部不可点击，你再次确认要一键自动适配，不要一个一个让用户自己适配。」

追加要求：

4. 「MCP 有异常的无法接入的要引导用户去提示指定设置将 agent 接通而不是只显示未连通或需配置。」

| 问题 | 根因 | 处理 | 结果 |
| --- | --- | --- | --- |
| 浏览器登录提示后端未响应 | 批次22 只提供 `npm run dev:backend`，用户直接 `npm run dev` 时只有 Vite，8201 没有服务 | `npm run dev` 改为 `tools/dev.mjs`：先探活 8201（带 5180 来源），可复用则复用，否则自动拉起 `tools/dev-backend.mjs`，再启动 Vite；Vite 退出一并收尾；8201 被不允许 5180 来源的桌面端占用时明确提示关闭桌面端 | 已落地；本机 8201 被安装版桌面端占用，`npm run dev` 全链路需用户关闭桌面端后手测（见 §5） |
| 效果证据四卡在接入页 | 四卡原先由接入页自己读内核账本渲染 | `getHomeFeed` 新增 `effectGains`（`computeOnboardGains` 真实聚合）；首页 `Dashboard` 在 `#layerGraph` 之前渲染 `#effectEvidence`；接入页删除四卡与相关状态；`Gains` 支持独立 `id` 避免与累计四卡冲突 | 已落地 |
| 一键适配全部不可点击 | 批次22 只把「可写 JSON 客户端」计入目标；若本机只有 Codex/手工客户端或全部已接入，`wireTargets.length === 0` 直接禁用按钮 | 只要扫描到已安装客户端按钮就可点；`wireAll` 先自动写入全部可写客户端（JSON + TOML/Codex），再为其余未接通客户端自动生成含令牌片段；文案回显「自动 N + 片段 K」；全部已接入时也给出明确结论 | 已落地 |
| 异常客户端只显示未连通/需配置 | 原先每行只有一句通用「建议」 | 新增 `connectHint`（覆盖 10 个客户端配方）与 `guideFor(row, endpoint)`：按状态给出**具体配置文件/菜单路径、serverKey、端点、当前指向 URL、修复步骤**（缺令牌→补齐；未配置→一键接入或手工新增 HTTP MCP；冲突→改指端点或删条目→刷新→一键接入；无法解析→先修语法→刷新；无稳定路径→按菜单手工添加） | 已落地 |

**结论**：开发态登录不再要求用户另开终端；效果证据四卡按用户要求迁至首页关系图谱上方；MCP「一键适配全部」真正可用并覆盖 JSON/TOML，无法自动写入的客户端也会自动生成片段并给出可执行的接通位置与步骤。

---

## 1. 改动详解

### 1.1 开发态一键启动（问题 1）

`tools/dev.mjs`（新增，`package.json` 的 `dev` 指向它）

- 启动顺序：
  1. `probeBackend()` 请求 `http://127.0.0.1:8201/api/health`（`Origin: http://127.0.0.1:5180`，1.5s 超时），检查 `access-control-allow-origin` 是否等于 5180；
  2. 兼容 → 日志「复用已在运行的登录后端」；未监听 → `spawn(node, tools/dev-backend.mjs)` 并等待 6s 就绪（日志「登录后端就绪：http://127.0.0.1:8201（演示账号 user_001 / demo1234）」）；
  3. 8201 有服务但不允许 5180（典型：安装版桌面端）→ 明确提示「请关闭桌面端后重跑 npm run dev；本次仍启动 Vite，但浏览器登录会被来源策略拒绝」；
  4. 启动 Vite（`vite/package.json` 定位 `bin/vite.js`，避免 `exports` 不暴露 bin 的问题）；Vite 退出时结束本脚本拉起的后端。
- `SIGINT/SIGTERM` 统一收尾，避免残留后端进程。

`tools/dev-backend.mjs`

- 监听 `127.0.0.1:8201`（对齐 `HOME_BASE`），`allowDevOrigins: true`；预置演示账号 `user_001 / demo1234`；
- `EADDRINUSE` 时输出占用提示（端口被占用时不静默挂起）。

### 1.2 效果证据四卡迁首页（问题 2）

`src/web/Home/coreHome.ts`

- `HomeFeedResult` 增加 `effectGains: Gain[]`；
- 返回 `effectGains: storageOk ? computeOnboardGains(audits, memories) : emptyOnboardGains()`（真实审计 + 记忆主表聚合，存储不可用时空态）。

`src/web/main.tsx`

- 新增 `effectGains` 状态（初值 `emptyOnboardGains()`）；
- 挂载加载、登录回填、`refreshGraph` 三处更新 `setEffectGains(res.effectGains)`；
- 传给 `HomePage`。

`src/web/Home/HomePage.tsx` / `Dashboard.tsx`

- 新增 `effectGains?: Gain[]` 透传；
- 在 `LayerGraphPanel`（`#layerGraph`）**之前**渲染：

```tsx
<section id="effectEvidence" data-testid="effect-evidence">
  <div className="section-title">效果证据（内核账本 · 真实聚合）</div>
  <Gains gains={effectGains} id="effectGains" />
  <div className="note">Token 节省 / 效率提升 / 跨 Agent 复用 / 模型成本均来自真实召回审计与记忆主表；
    无样本显示「—」，未设置单价时模型成本不估算。</div>
</section>
```

`src/web/AgentOnboard/AgentOnboardPage.tsx` / `Gains.tsx` / `theme.css`

- 接入页删除 `Gains`、`emptyOnboardGains`、`getOnboardGains` 引用与 `gains` 状态、效果证据区块；
- `Gains` 新增可选 `id`（默认 `gains`），首页累计四卡 `#gains` 与效果四卡 `#effectGains` 互不冲突；
- 删除接入页失效的 `.gains/.gain` 样式。

### 1.3 MCP 一键适配全覆盖（问题 3）

`src/agentOnboard/mcpClients.ts`

- `McpClientSpec` 新增 `connectHint`，10 个客户端均填写具体菜单/配置路径；
- `codex`、`gemini-cli`、`qwen-code` 改为 `writable: true`；
- 新增 `mergeMcpTomlConfig(text, spec, endpoint, token)`：
  - 无 `[mcp_servers.<key>]` 段 → 追加完整段（`url` + `http_headers`）；
  - 已有段 → `url` 必须匹配本服务端点，否则 `E_CONFIG_CONFLICT`；
  - 支持 `[mcp_servers.<key>.http_headers]` 子表与内联 `http_headers = { ... }`，保留其它请求头，只补/换 `Authorization`；
  - 同一令牌 → `changed:false` 且原样返回；保留 CRLF。

`src/electron/mcpClients.ts`

- `wireMcpClient` 按 `spec.format` 分派 JSON/TOML 合并；仅在 `!spec.configPath || !spec.writable` 时拒绝；仍先备份、原子替换、扫描结果不含令牌。

`src/web/AgentOnboard/McpClientsPanel.tsx`

- `canWire = row.writable && state 不为 wired/conflict/invalid`；
- `wireAll`：
  1. 顺序 `mcp:clientWire` 全部可写客户端（逐行进度）；
  2. 对 `state !== 'wired' && !canWire(row)` 的客户端调用 `mcp:clientSnippet` 生成含令牌片段，计数；
  3. 结束汇总「⚡ 一键适配完成：自动写入 N 个 · 已是最新 M 个 · 生成配置片段 K 份[ · 失败…]」，并提示「无法自动写入的客户端已在行内给出具体接通位置与步骤」；
  4. 全部已接入且无片段 → 「所有已安装客户端均已接入，无需改动」；
  5. 结束 `refresh()`。
- 按钮禁用条件仅剩：非管理员 / 忙碌 / 扫描中 / 浏览器模式 / 无已安装客户端；文案动态显示「（自动 N + 片段 K）」「（生成 K 份片段）」或纯「一键适配全部」；
- 行内「一键接入」覆盖 TOML 客户端；每行新增 `接通指引：{guideFor(row, endpoint)}`（`data-testid="guide-<id>"`）。

`src/web/AgentOnboard/autoDiscovery.ts`

- 自动接入只跳过 `!spec.writable`；TOML 客户端（Codex）与 JSON 一样自动备份写入。

### 1.4 接通指引（追加问题 4）

`guideFor(row, endpoint)` 按状态输出可执行步骤：

| 状态 | 指引内容 |
| --- | --- |
| `wired` | 无需操作；重启客户端后验证提示行 |
| `missing_auth` | 可写 → 点「补齐令牌」；否则打开 `connectHint` 指向的配置/菜单，补 `Authorization: Bearer <令牌>` |
| `missing_entry` / `no_config` | 可写 → 点「一键接入」或「一键适配全部」；否则按 `connectHint` 新增 HTTP MCP（serverKey、端点、Authorization） |
| `conflict` | 打开配置文件路径，把同名条目 URL 从当前指向改为 `endpoint`（或删除条目），刷新状态后一键接入 |
| `invalid` | 先按错误信息修复 JSON/TOML 语法，再刷新；修复前系统拒绝写入 |
| `manual` | 按 `connectHint` 的客户端菜单手工添加 HTTP MCP 服务器（名称、端点、请求头） |

---

## 2. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `tools/dev.mjs` | `npm run dev` 一键启动：探活/复用或拉起 8201 后端 + Vite，统一收尾 |
| `specs/MANUAL-TEST-FIX-BATCH-23.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `tools/dev-backend.mjs` | 127.0.0.1:8201 + EADDRINUSE 明确提示 |
| `package.json` | `dev` → `node tools/dev.mjs` |
| `src/web/Home/coreHome.ts` | `HomeFeedResult.effectGains` 真实聚合 |
| `src/web/main.tsx` | 效果四卡状态 + 三处回填 + 透传 |
| `src/web/Home/HomePage.tsx` / `Dashboard.tsx` | `effectGains` 透传；`#effectEvidence` 位于 `#layerGraph` 之前 |
| `src/web/AgentOnboard/Gains.tsx` | 支持独立 `id` |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | 移除效果四卡与 gains 状态 |
| `src/web/AgentOnboard/theme.css` | 删除失效 `.gains/.gain` 样式 |
| `src/agentOnboard/mcpClients.ts` | `connectHint`×10、TOML 合并、Codex/Gemini/Qwen 可写 |
| `src/electron/mcpClients.ts` | JSON/TOML 分派写入 |
| `src/web/AgentOnboard/autoDiscovery.ts` | TOML 客户端自动写入 |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 一键适配全部真正可用（含片段生成）、接通指引、TOML 行内按钮 |
| `src/web/Home/__tests__/coreHome.test.ts` | `effectGains` 真实值 / 空账本 / 损坏存储 |
| `src/web/Home/__tests__/Dashboard.test.tsx` | 四卡位置与独立 id |
| `src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx` | 接入页不再渲染 `#gains` |
| `src/agentOnboard/__tests__/mcpClients.test.ts` | `mergeMcpTomlConfig` 6 例 + 配方可写性 |
| `src/electron/__tests__/mcpClients.test.ts` | Codex 新建/幂等/保留/冲突；手工客户端拒绝 |
| `src/web/AgentOnboard/__tests__/autoDiscovery.test.ts` | TOML 自动写入 / 冲突拒绝 / 无路径转手工 |
| `src/web/AgentOnboard/__tests__/McpClientsPanel.test.tsx` | 批量自动 + 片段、全部已接入仍可生成片段、接通指引、成员禁用 |
| `e2e/home.spec.ts` | 效果证据四卡位于关系图谱上方 |
| `e2e/app.spec.ts` | 接入页不再有 `#gains` / `#effectEvidence` |
| `AGENTS.md` | §2 dev 命令；§3 MCP/自动接入行；§9 批次23 边界与浏览器模式说明 |
| `specs/code-map.md` | 新增批次23 映射 |
| `specs/需求规格书.md` | 新增 §19.18 |
| `specs/MANUAL-TEST.md` | 标题 1..23；§1 dev 行；§3.10 批次23 注记；新增 §3.11 |
| `specs/code-index.generated.md` | 刷新（268 文件） |

---

## 3. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run verify:fast` | **通过**（typecheck 双配置 + oxlint 0 error/0 warning + 索引新鲜度 + 覆盖率） |
| `npm run typecheck` | 通过（渲染 + Electron 双配置，0 错误） |
| `npm run lint` | 通过（oxlint 421 文件 / 123 规则，0 warning / 0 error） |
| `npm run code:index:check` | 通过（索引与源码一致，268 文件） |
| `npm test`（全量） | **109 文件 / 1147 用例全过** |
| `npm run test:coverage` | Statements **76.88%** / Branches **68.9%** / Functions **71.98%** / Lines **79.87%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 94 用例全过**（34.2s，真构建产物 + 真后端） |
| `npm run package` | 成功；EPERM → 时间戳目录构建 → 复制+删除收口回 `release/installer`；`release/` 只剩 `installer/` |
| 专项回归（批次23 相关 7 个测试文件） | 105 用例全过 |

### 3.1 打包产物自检

| 检查 | 结果 |
| --- | --- |
| `dist/assets/agentonboard-*.js` 含 `一键适配全部` / `生成配置片段` / `接通指引` | 是 |
| `dist/assets/main-*.js` 含 `effectEvidence` | 是 |
| `release/installer/MultiAgent Memory-0.1.0-setup.exe` 存在且非空 | 是（121,975,243 B） |
| `release/installer/win-unpacked/MultiAgent Memory.exe` 存在 | 是（249,934,848 B） |
| `release/` 只剩 `installer/` | 是 |

---

## 4. 手动测试步骤（待用户执行）

### 4.1 使用本次最新包

1. 关闭正在运行的旧实例（若已打开）。
2. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`。

### 4.2 开发态登录（问题 1）

1. **先关闭安装版桌面端**（否则 8201 被占用），在仓库根目录执行 `npm run dev`。
2. 终端应依次出现：
   - `[dev] 启动本机登录后端 127.0.0.1:8201…`
   - `[dev] 登录后端就绪：http://127.0.0.1:8201（演示账号 user_001 / demo1234）`
   - `[dev] 启动 Vite：http://127.0.0.1:5180`
3. 浏览器打开 `http://127.0.0.1:5180`，用 `user_001 / demo1234` 登录 → 应成功，不再提示「登录后端未响应」。
4. 再次执行 `npm run dev`（8201 已被上一次 dev 后端占用且允许 5180）→ 应显示「复用已在运行的登录后端」。
5. 若安装版桌面端占用 8201 再执行 `npm run dev` → 应明确提示「8201 已有服务但不允许 http://127.0.0.1:5180 来源；请关闭桌面端后重跑」。

### 4.3 效果证据四卡位置（问题 2）

1. 桌面端登录 → 首页。
2. 「效果证据（内核账本 · 真实聚合）」四卡（Token 节省 / 效率提升 / 跨 Agent 复用 / 模型成本）应位于 **L1–L6 关系图谱卡片上方**。
3. 原有「累计记忆 / 累计动作 / 近 1h 调用 / 待裁决」四卡仍在原位置；两组数字互不覆盖。
4. 打开 Agent 接入页 → 不应再出现效果证据四卡。
5. 空账本时四卡显示「—」并注明原因；未设置单价时模型成本不估算。

### 4.4 一键适配全部（问题 3）

1. 管理员登录 → Agent 接入页 →「MCP 客户端接入状态」→ 点「刷新状态」。
2. 只要扫描到已安装客户端，按钮「⚡ 一键适配全部（自动 N + 片段 K）」应**可点击**（非管理员/扫描中除外）。
3. 点击后：
   - 逐行显示「⚡ 一键适配中 i/N」；
   - 可写客户端（Qoder CN / Claude Code / Cursor / Gemini / Qwen / Codex）先备份后写入，Codex 的 TOML 段自动补齐；
   - 其余未接通客户端（冲突/无法解析/无稳定路径）自动生成含令牌片段；
   - 结束显示「自动写入 N 个 · 已是最新 M 个 · 生成配置片段 K 份」及失败原因；
   - 自动刷新扫描状态。
4. 全部已接入时按钮仍可点，执行后给出「所有已安装客户端均已接入，无需改动」或按实际状态给片段。
5. 非管理员：按钮禁用；行内「一键接入」「复制片段」同样禁用。

### 4.5 异常客户端接通指引（问题 4）

逐行检查「接通指引」是否给出**具体位置与步骤**：

- 缺令牌：可写 → 「点『补齐令牌』」；不可写 → 「打开 `~/.xxx` 或菜单，补 `Authorization: Bearer <令牌>`」。
- 未配置/无配置：可写 → 「点『一键接入』」；不可写 → 「打开具体菜单（如 `Trae CN → 设置 → MCP → 添加服务器`），新增 HTTP MCP，serverKey、端点 `http://127.0.0.1:8204/mcp`、Authorization」。
- 冲突：显示「当前指向：http://其它端点」，指导改成 `http://127.0.0.1:8204/mcp` 或删除同名条目 → 刷新 → 一键接入。
- 无法解析：显示解析错误，指导先修 JSON/TOML 语法 → 刷新（修复前拒绝写入）。
- 需手工：给出客户端菜单路径 + 端点 + 请求头。

### 4.6 写入安全与日志

1. 任选缺令牌客户端点「一键接入」→ 原文件旁生成 `*.bak-<时间戳>`，写入后状态「已接入」。
2. 冲突/坏文件/超 8 MiB 配置拒绝覆盖，原文件不变。
3. 数据根 `actions.log` 有对应 `mcp` 动作，且**不含明文令牌**。
4. 浏览器模式（`npm run dev`）打开接入页 → 不列客户端、不显示「已接入」，如实说明无法读取本机配置。

---

## 5. 已知限制

1. **`npm run dev` 全链路未在本机完成手测**：本机 8201 被安装版桌面端（PID 16940）占用且来源不允许 5180，按约定未强制结束用户进程。已在备用端口 8205 冒烟验证 `dev-backend`：dev-origin 200 / 其它来源 403 / 启动日志正常；`dev.mjs` 的 Vite 解析与进程收尾逻辑已通过代码与单元测试路径确认。最终请按 §4.2 关闭桌面端后手测。
2. **效果证据口径不变**：仍只统计真实召回审计与记忆主表；无样本「—」，未设单价不估算模型成本；旧审计缺省量字段只计调用次数。
3. **自动写入覆盖边界**：JSON（Qoder CN / Claude Code / Cursor / Gemini / Qwen）与 TOML（Codex）可自动写入；Trae CN / WorkBuddy / Zcode / deepseek harness 无稳定配置路径，只能生成片段 + 菜单指引；冲突/无法解析/超大文件一律拒绝覆盖。批量写入按顺序执行，单个失败不回滚已写入的客户端。
4. **`connectHint` 是静态配方**：客户端菜单名称可能随版本变化，若与实际界面不符，以配置文件路径为准手工修改。
5. **令牌安全**：片段中的 Authorization 只在下发时展示一次，不写日志/审计；`mcp:clientSnippet` / `mcp:clientWire` 仍需管理员登录会话，由主进程二次校验。
6. **安装包未配置代码签名证书**：Windows SmartScreen 可能提示未知发布者（既有情况）。
7. **未提交 git**：按约定等待用户确认。

---

## 6. 结论

- 四项用户问题全部落地：`npm run dev` 自动拉起登录后端；效果证据四卡迁至首页关系图谱上方；MCP 一键适配全部真正可点并覆盖 JSON/TOML + 自动生成片段；异常客户端逐行给出具体设置位置与修复步骤。
- 自动化门禁全绿：typecheck、oxlint、索引检查、109 文件/1147 单测、覆盖率阈值、21 spec/94 E2E、打包与产物自检。
- 手动验收按 §4 执行；最新安装包为 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见页首）。
