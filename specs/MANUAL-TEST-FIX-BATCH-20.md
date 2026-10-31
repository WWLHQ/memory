---
status: done
---

# 手动测试报告 · 修复批次 20（可读可维护性收口 + 索引门禁）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **08:33:53**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,970,864 B = **116.32 MiB**
  - SHA256：`94EEDF8D850060D25241C35B6FD7DC43A831A3D867D5BE312718250A555A5BD5`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-19.md`、`specs/MANUAL-TEST.md` §3.8/§7

> **输出目录说明**：本次打包前 `release/` 下无运行中的旧实例；产物直接落在固定目录 `release/installer`，成功后自动清理旧目录 `release/installer-20261031-003331-stale`（批次19 的安装包已被本次替换）。最终 `release/` **只剩 `installer/` 一份产物**。

---

## 0. 起因与结论

用户提出两项长期要求：

1. 「程序的可读可维护性做优化」
2. 「程序每做完一个功能都要建索引，请增加到记忆内」

| 要求 | 处理 | 结果 |
| --- | --- | --- |
| 可读可维护性 | 接入卡片提取 `FoundCard` 单一外壳，发现卡片与已安装卡片共用结构，消除重复 JSX；DOM/交互不变 | 已落地 |
| 每完成功能即建索引 | 记忆已更新；`tools/code-index.mjs` 新增 `--check`；`verify:fast` 内置索引检查；`npm run package` / `package:win` 前置自动刷新索引 | 已落地 |

**结论**：本批次只做内部结构收敛与流程门禁，不改变任何可见行为、数据路径或接口；单测、E2E、打包与产物自检全绿。

---

## 1. 可读可维护性优化

### 1.1 接入卡片单一外壳

`src/web/AgentOnboard/OneClickOnboard.tsx` 新增内部组件 `FoundCard`：

```text
<FoundCard
  badge / label / name / nameSize / unbound / dataDisc
  actions = 状态 pill + 撤销（发现卡片）或「+ 新增接入卡片」（已安装卡片）
  meta    = 信号 + 来源（发现卡片）或 安装方式 + 路径 + 版本（已安装卡片）
/>
```

- 首行 `.found-head`：badge + 名称 + 右侧 `.found-actions`；
- 次行 `.found-meta`：元信息；
- 两处调用点共用同一外壳，后续改版不会出现「发现卡片改了、已安装卡片忘了改」的漂移；
- `data-disc` / `data-unbind` / `.found-card` / `.unbound` 等选择器与回调完全不变，测试无需改写。

### 1.2 索引新鲜度门禁

| 能力 | 实现 |
| --- | --- |
| 只检查不写盘 | `tools/code-index.mjs --check`：重新生成索引并与 `specs/code-index.generated.md` 比较，不一致退出码 1，并提示运行 `--write` |
| 门禁内置 | `package.json` 新增 `code:index:check`；`verify:fast` 顺序改为 typecheck → lint → **索引检查** → 覆盖率单测 |
| 打包自动刷新 | `prepackage` / `prepackage:win` 在 `npm run package` / `package:win` 前自动执行 `npm run code:index -- --write` |
| 协作规则 | `AGENTS.md §2/§8` 明确「每完成一个功能/修复批次先刷新索引，索引过期视为功能未完成」 |

> 本次实测：`npm run code:index:check` 输出「代码索引已是最新（268 个文件）」。

### 1.3 记忆更新

长期记忆 `feedback-readability-maintainability.md`（用户级）新增：

- **功能完成即建索引**：每做完一个功能或修复批次，必须刷新代码索引与代码地图，再进入门禁与打包；索引过期视为功能未完成。
- 同步更新 `MEMORY.md` 索引摘要。

---

## 2. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `specs/MANUAL-TEST-FIX-BATCH-20.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `src/web/AgentOnboard/OneClickOnboard.tsx` | 提取 `FoundCard`；发现卡片与已安装卡片共用；DOM/交互不变 |
| `tools/code-index.mjs` | 新增 `--check` 模式与用法注释 |
| `package.json` | 新增 `code:index:check`、`prepackage`、`prepackage:win`；`verify:fast` 加入索引检查 |
| `AGENTS.md` | §2 命令与 §8 门禁加入「功能完成即建索引」；打包命令说明更新 |
| `specs/code-map.md` | 新增批次20 映射；构建说明补充索引门禁 |
| `specs/需求规格书.md` | §19.15 补充 `FoundCard` 与索引门禁 |
| `specs/MANUAL-TEST.md` | 报告索引 1..20；§3.8 补充批次20 回归说明；§7 加入索引检查命令 |
| `specs/code-index.generated.md` | 刷新（268 文件） |

---

## 3. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（0 错误，渲染 + Electron 双配置） |
| `npm run lint` | 通过（oxlint 0 error / 0 warning） |
| `npm run code:index:check` | 通过（代码索引已是最新，268 文件） |
| `npm test` | **109 文件 / 1119 用例全过** |
| `npm run test:coverage` | Statements **76.58%** / Branches **68.46%** / Functions **71.77%** / Lines **79.52%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 94 用例全过**（31.0s，真构建产物 + 真后端） |
| `npm run package` | 成功；直接产出 `release/installer`；清理旧 `installer-*` 1 个 |
| `npm run code:index -- --write` | 已写入 268 个文件（`prepackage` 自动执行） |

### 3.1 打包产物自检

| 检查 | 结果 |
| --- | --- |
| `dist/assets/agentonboard-CwyP9Go8.js`（45,056 B）含 `found-head`、`新增接入卡片` | 是 |
| `dist/assets/logs-DdJoQyro.js`（21,617 B）含 `程序运行日志`、`programLogUnavailable` | 是 |
| 首页 chunk `main-BKhIKMO1.js` **不含** `程序运行日志`、`programLogUnavailable` | 是（日志面板仍在日志记录页） |
| `release/` 只剩 `installer/` | 是 |

---

## 4. 手动测试步骤（待用户执行）

### 4.1 使用本次最新包

1. 关闭正在运行的旧实例（若已打开）。
2. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；
   - 或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`。
3. 本批次**没有可见界面变化**；重点回归上一批次（批次19）的卡片与日志位置。

### 4.2 接入卡片回归

1. 用管理员登录 → 打开「Agent 接入配置页」，等待自动扫描完成。
2. 检查发现卡片：首行 badge + 名称 + 右侧「自动发现 · 已绑定 ✓」与「撤销」；第二行信号/来源。
3. 检查「已安装的 Agent」：与发现卡片同构，首行右侧「+ 新增接入卡片」。
4. 点一次「撤销」与「+ 新增接入卡片」→ 行为与批次19 一致。
5. 「MCP 客户端接入状态」行仍为原单行布局。

### 4.3 索引门禁回归

1. 在仓库执行 `npm run code:index:check` → 应输出「代码索引已是最新（268 个文件）」。
2. 若手工改动任一 `src/` 文件后不刷新索引，再次执行 → 应报「代码索引已过期：请运行 npm run code:index -- --write」并以非 0 退出；运行 `npm run code:index -- --write` 后恢复通过。
3. 执行 `npm run package` → 日志开头应自动出现索引写入；打包成功后 `release/` 只剩 `installer/`。

### 4.4 日志与首页回归

1. 打开「日志记录页」→ 顶部显示程序运行日志卡（最近 5 行真实 `actions.log`，UTC+08:00）。
2. 打开「首页」→ 不再出现程序日志卡。
3. 登录后首页 L1–L6 图谱正常展示（空账本显示诚实空态）。

---

## 5. 已知限制

1. **无可见行为变化**：本批次仅收敛卡片 JSX 与增加索引门禁，不新增功能、不改数据路径。
2. **索引检查会「故意失败」**：任何 `src/`/`e2e/` 改动后未运行 `npm run code:index -- --write`，`verify:fast` 会失败；这是流程门禁，不是缺陷。
3. **打包自动写文档**：`prepackage`/`prepackage:win` 会写 `specs/code-index.generated.md`；该文件不在安装包内，只影响仓库文档。
4. **既有构建告警**：`src/agentOnboard/server.ts` 的 `import.meta` 在 CJS 输出下为空，是既有 esbuild 警告，本批次未引入、未改变运行行为。
5. **安装包未配置代码签名证书**：Windows SmartScreen 可能提示未知发布者（既有情况）。
6. **未提交 git**：按约定等待用户确认。

---

## 6. 结论

- 接入卡片改为 `FoundCard` 单一外壳，发现卡片与已安装卡片结构由同一处代码保证，后续维护不再需要双改。
- 「每完成一个功能即建索引」已写入长期记忆，并落地为可执行门禁：`code:index:check` + `verify:fast` + `prepackage`。
- 自动化门禁全绿：typecheck、oxlint、索引检查、109 文件/1119 单测、覆盖率阈值、21 spec/94 E2E、打包与产物自检。
- 手动验收按 §4 执行；最新安装包为 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见页首）。
