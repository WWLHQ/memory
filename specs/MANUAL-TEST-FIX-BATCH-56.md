# 批次56 · 手动测试报告（2026-11-21 第五轮）

> 用户 5 条原话：①反馈页要适配深色主题 ②生命周期页要适配深色主题 ③按 stratum-a-full.html 设计稿对同步中枢/冲突裁决再比对 ④首启向导页要固定（附截图：底部固定圆角胶囊条「必须项还差 N 项 + 进入应用 →」+ 下方状态行）⑤反馈页要对接召回回显，全部接真数据。

## 安装包

- 路径：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
- 大小：129,319,467 bytes；SHA256 `7EF3DA6DFD787AC995416652752A4DE8030D867874EA261A09DB029125D66322`
- `git diff -- package.json` 为空（electron-builder 未破坏 scripts）；`dist-electron/main.cjs` 与 `app.asar.unpacked/dist-electron/main.cjs` 逐字节一致
- 已 `/S` 静默安装至 `C:\Users\LHQ\AppData\Local\Programs\MultiAgent Memory`，新端启动核运行态：`bootstrap:done` + 8202/8203/8204 LISTENING（本轮重启后 L0 写密钥默认 `write_unlocked:false`，属预期安全行为，需在安全页解锁）

## 改动清单

| 需求 | 实现 | 文件 |
|---|---|---|
| ①② 反馈/生命周期深色（根因修复） | **真凶是 CSS 构建顺序**：`shared/theme.css` 的 `:root` 浅色字面量（--panel:#fff、--panel2:#edf1f5、--txt/--dim/--err 等 11 个旧名）在构建产物里排在 p0 共享 CSS 之后，压掉深色别名 → 深色下卡片白底、输入框浅灰（打包版实测 `.card` rgb(255,255,255) 复现）。修复：theme.css 增加 `html[data-theme="dark"]` 令牌块（特异性 0-1-1 > `:root` 0-1-0，与加载顺序无关），色值与 p0.css 深色调色板一致 | [src/web/shared/theme.css](../src/web/shared/theme.css) |
| ③ 同步中枢对齐设计稿 pg-sync | 页头 sub「sync-hub/ · 单机 pglite 进程内 Postgres · 衍生可重建数据，不进备份四源」+ badge「implemented: true」；「立即同步｜中枢对账」双列 `af-g2`（窄屏回落单列）；pushed/pulled `sy-stat` 卡；§9.7 面板头「去冲突裁决 →」链接（testid `goto-dispute`，href=../dispute.html）；底部「形态」说明条；通道与游标/L0 排除两分区原样保留（真实数据功能，testid 零删） | [SyncPage.tsx](../src/web/sync/SyncPage.tsx)、sync/theme.css |
| ③ 冲突裁决对齐设计稿 pg-dispute | 页头 sub「§9.7 裁决队列 · write/sync 冲突 · 超期 7 天升级告警」+ badge warn「待裁决 N」；双栏对比标题带 conflict_id（内核 ConflictRecord 无版本字段，如实用 mem_id 不编造版本号）；旧值 `<del>`/新值 `<ins>`；裁决历史 hint「security_change / dispute_resolve」 | [DisputePage.tsx](../src/web/dispute/DisputePage.tsx)、dispute/theme.css |
| ⑤ 反馈页召回回显接真数据 | `coreLoadRecallEchoes`：`queryAudit({action:'recall'})` 最近 ≤20 条渲染「召回回显」卡（testid `recall-echo` / `recall-echo-row-N` / `recall-echo-error` / `recall-echo-empty`）；命中数/客户端/用量按账本真实值，账本没记的列写原因文本（不编造）。已核审计账本 `audit.jsonl` recall 行字段齐全（query/mode/hits/client/injected_tokens/saved_tokens） | [coreFeedback.ts](../src/web/feedback/coreFeedback.ts)、[FeedbackPage.tsx](../src/web/feedback/FeedbackPage.tsx) |
| ④ 首启向导固定 | 核实无需改码：`sw-foot` 本就是 `position:fixed` 圆角胶囊（bottom 30px / radius 12px）+ `sw-status` 状态行，与截图结构一致，实机确认通过 | setupPage.css（既有） |

## 验证证据（三道闸门）

- **A 影响面回归**：`verify:fast` 全绿（typecheck 0 错 + oxlint 0 + 索引新鲜 + vitest 全量 0 失败，子代理自跑 59/59 定向 + 全量 4086）；通道与游标/L0 排除/全部既有 testid 零改动。
- **B 正向用例**（打包版实机，workspace 壳层点「深色」后逐页 iframe 实测）：
  - 反馈页：iframe `data-theme=dark`、body rgb(6,11,22)、`.card` rgb(12,20,36)（**修复前白底 rgb(255,255,255)**）、`--panel` 解析 #0c1424 ✓
  - 生命周期页：`data-theme=dark`、body rgb(6,11,22)、`.card` rgb(12,20,36) ✓
  - 同步中枢：sub/badge「implemented: true」/`af-g2`×2/`sy-stat`×2/`goto-dispute`/「形态」条全部命中，pushed/pulled「未取数」诚实 ✓
  - 冲突裁决：sub/badge 命中；`del/ins` 随真实冲突行渲染（当前队列 0 条属诚实空态）✓
  - setup：`.sw-foot` position:fixed + bottom 30px + radius 12px + 深色，截图目检与用户参考图同构 ✓
  - recall-echo：外置浏览器无 preload 时按设计诚实降级（宿主桥不可达提示），数据路径由 vitest 真账本用例覆盖
- **C 变异验证**：新增 4 条测试（coreLoadRecallEchoes 三路径 + echo 卡渲染）全绿；theme.css 深色令牌块由「打包版白底复现 → 修复后实测变暗」双向证明。
- **壳层持久化判别**：Trae 桥接浏览器出现「首挂载 attr=light 而状态=dark」假象；临时 E2E（点深色→重载→断言首挂载 attr=dark）在真实 Chromium 通过后即删，确认属桥接环境假象非产品 bug（与批次55 dev 环境假象同类）。

## 已知边界

- recall-echo 真数据渲染需真实 Electron 环境（window.api 存在）；外置浏览器按设计诚实降级为「宿主桥不可达」。
- dispute 的 del/ins 仅在有真实冲突时出现，空队列不伪造对比行。
- 历史 `release/installer-*` 目录句柄占用删不掉（EPERM，已知边界不阻塞）。

## 状态

**未提交、未推送**，等用户目视验收。工作区另含他人批次流未提交改动（百余文件），本批次仅触碰上表所列文件。
