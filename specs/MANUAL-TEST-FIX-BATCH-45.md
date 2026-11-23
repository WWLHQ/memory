# 手动测试报告 · 批次45（界面重设计 v5：批次 A 壳层 + B 页头/表底 + C 检查器快捷键 + D 全量视觉对齐）

- 日期：2026-11-20（A/B/C）；D 2026-11-21
- 设计真源：`design-mockups/记忆工作台-界面重设计-v5.html`（Graphite + Signal Teal）
- 代码记录：`specs/code-map.md` §批次61

## 改动清单

| 子批 | 内容 |
|---|---|
| A（上一轮已随 91EA5C6E… 包交付） | 壳层 36px 标题栏 / 44px 命令条 / 26px 状态栏、Ribbon+菜单删除、Ctrl+K 命令面板、Ctrl+1..8·B·` 快捷键 |
| B（2026-11-20） | 记忆库/检索/审计三页 v5 页头（20px 标题 + tagline 胶囊 + 分隔符元信息行 + 右侧主操作）；审计页 v5 表底（显示/共 + 紧凑数字 pager）；记忆库页签条对齐 tabsline、表底数字 pager；共享 `pagerWindow.ts` + `PageNav variant="pager"` |
| C（2026-11-20） | Ctrl+Shift+I 折叠/展开属性检查器（主进程 before-input-event → ShellShortcut 'inspector' → 壳层 runShellShortcut，与 QAT/命令面板同一状态源）；F1 快捷键参考补行；命令面板 inspector 命令补 kbd |
| D（本轮，2026-11-21，用户确认「与效果图差距很大」后全量对齐） | ① p0.css 基元：正文 13px/1.5、页面底色 surface-2、卡片白面 8px 圆角+微阴影、输入 31px+focus 焦点环、按钮 29px、表格 31px 吸顶表头+34px 行高+灰悬停、页签 35px+计数徽标、栅格 12px；② 壳层：导航树 29px 行+active 左 3px 品牌条、页签条 35px 顶条白底、检查器 76px 右对齐属性栅格、dock 32px 头+15px 徽标、标题栏渐变+品牌块 23px、悬停态全面去品牌化；③ 页面级：记忆库页 v5 令牌全换（accent 蓝→青、行高 34、控件 29px、亮暗硬编码色块全换）、write/shared/legacyLight/memory/dispute/AgentOnboard/Home/overview/personalMemoryPane/login 九份旧主题正文 13px + accent 青化 + 卡片 8px |
| F（本轮，2026-11-21，「左侧功能导航和设计稿对齐」） | ① 头部：去掉 folder 前置图标，工具区改为「新建记忆（开写入页）+ 折叠」双 24px 按钮（v5 `.icon-btn` 口径）；② 树体：容器 padding 改 `0 8px 8px`、分组标题改 margin `12px 4px 5px`（首组 2px），激活药丸随之贴左缘（left:-8px）；③ 主项图标 16px、非激活 muted / hover ink2 / 激活 accent；④ 子项 26px 行高 + 12px 字号 + muted（激活仍 accent）；⑤ 计数徽标变体 hot/warn/soft（dispute=hot 红、monitor/sync=warn 琥珀、personal=soft 青，激活行徽标反白）；⑥ 默认导航宽 250→236（v5 `--nav-w`）。ShellStatusCard / StrataScale / 层级刻度版式保持批次53 口径（真实数据卡，非设计稿示例存储卡）。 |
| E（本轮，2026-11-21，「所有页与首页对齐：视觉/格式/符号/配色」） | ① **分页统一**：`PageNav` 删除旧完整档（⏮ 首页/尾页 ⏭ + 跳页输入框），统一为 v5 紧凑数字 pager（‹ 1 2 › + 「第 x / y 页」+ 可选条数下拉）；记忆库表底、日志记录页、审计页、生命周期页、分层内容页五处共用；生命周期/分层卡片的「每页 N 条」选择保留本页口径（testid 不变）；LogsPage 测试改写为 pager 断言。② **页头统一**：logs/write/monitor/growth/overview/feedback/dispute/lifecycle/MemoryLayeredPage/AgentOnboard 十页全部转 `p0-pagehead`（20px 标题 + tagline 胶囊 + 分隔符元信息行 + 右侧主操作），dispute/分层页入口补引 `shared/p0.css`；overview 死 CSS（af-head/af-title/af-actions）与 write 死 CSS（wf-masthead 四规则）清除；login/setup 为特殊全屏页不强套页头（本就无 emoji）。③ **符号统一**：按钮/徽标 emoji 换线性 `Icon`（检索页记住/忘记/反馈三按钮、首页图谱抽屉锁定/冲突徽标、logs 两处告警 banner、growth 手动触发按钮、AgentOnboard 一键接入/手动检测/测试接入/一键适配全部按钮与 section 标题）；纯文本语义符号保留（pill「实测 ✓ N 工具」、★ 评分语义、消息文案 ⚠）。④ **配色统一**：层色板与首页层级刻度 `STRATA_LAYERS` 同源（L0 #8fa3bc / L1 #22d3ee / L2 #38bdf8 / L3 #818cf8 / L4 #c084fc / L5 #f472b6 / L6 #fbbf24），替换 MemoryLayeredPage、layerGraph.ts 两处旧「官方色板」及 layerGraph.css 深色画布 8 处 #4d9fff/rgba(77,159,255) → #38bdf8/rgba(56,189,248)。⑤ 顺手清掉 syncHub.ts/regression.ts/main.ts 三文件开头历史 BOM（oxlint no-irregular-whitespace 报 error）。 |

## 安装包

- 路径：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
- 大小：123.3 MB（129,314,537 bytes）
- SHA256：`4120F30833804953E45957BF9C9B8C41222AE01D3D2DA0708B71BCAA56818ECE`（批次 D，2026-11-21）
- 主进程核验：`app.asar.unpacked/dist-electron/main.cjs` 与 `dist-electron/main.cjs` SHA256 一致；`git diff -- package.json` 为空。

## 安装包（批次 E，2026-11-21 交付闭环）

- 路径：`release/installer-20261121-012754/MultiAgent Memory-0.1.0-setup.exe`（`release/installer` 固定路径被外部句柄占用 EPERM，本次输出落到带时间戳目录，已知边界）
- 大小：123.3 MB（129,314,186 bytes）
- SHA256：`AADFDE1848576064A2C0AC48D8420542D44097C727BBB068C2AFBE3AAFFA6615`
- 主进程核验：`app.asar.unpacked/dist-electron/main.cjs` 与 `dist-electron/main.cjs` SHA256 一致（`3B710B2F…4D3D81`）；`git diff -- package.json` 为空。
- 运行态核对：`bootstrap:done` + 8201/8202/8203/8204 LISTENING + MCP `initialize`（memagent-mcp 1.0.0 正常下发 instructions）+ `get_write_status`（`l0_unlocked:true`、pending 0——本机 L0 会话授权仍有效，非重启默认锁定态）。
- electron-builder 发布步骤因缺 GH_TOKEN 报错（CI 检测触发 publish），NSIS 产物与 blockmap 均已生成，不影响交付。

## 安装包（批次 F，2026-11-21 交付闭环）

- 路径：`release/installer-20261121-015518/MultiAgent Memory-0.1.0-setup.exe`（`release/installer` 固定路径仍被外部句柄占用，落带时间戳目录，已知边界）
- 大小：123.3 MB（129,314,193 bytes）
- SHA256：`14095560DD016E7F9F9CA9710ADFB3597D9E29AA4CCFA8B145F9F60FF6BDF6D0`
- 主进程核验：`app.asar.unpacked/dist-electron/main.cjs` 与 `dist-electron/main.cjs` SHA256 一致（`3B710B2F…4D3D81`，批次 F 未动主进程，哈希与批次 E 相同属预期）；渲染层标记 `nav-new-memory` 已在 `app.asar` 内命中（1 处；`NAV_COUNT_VARIANTS` 为标识符经产物压缩不保留属正常）；`git diff -- package.json` 为空。
- 运行态核对：`bootstrap:done` + 8200/8201/8202/8203/8204 LISTENING + MCP `initialize`（memagent-mcp 1.0.0）+ `recall_memory`（命中 1 条；账本 2 项目时缺省 project_id 被诚实拒绝并提示，符合契约）+ `get_write_status`（`l0_unlocked:false`、pending 0——重启默认锁定，预期安全行为）。
- electron-builder 发布步骤因缺 GH_TOKEN 报错（同批次 E 已知边界），NSIS 产物与 blockmap 均已生成，不影响交付。

## 自动化门禁

- 批次 F：typecheck 0 错、oxlint 0 errors（2 warnings 为 Workspace.tsx 既有 exhaustive-deps，非本轮引入）、索引新鲜；`npm run test:gate` 4 分片 319 文件 / 4023 例 / 0 失败 / 0 重试全绿（含新增「v5 设计稿对齐：导航头部工具」两例）；闸门 C：`Workspace.tsx` `openNav('write')` 注入改 `openNav('home')` → 新用例红灯 → 还原 → shell 套件 155/155 复绿。
- 批次 E：typecheck 0 错、oxlint 0 errors（顺手清掉 syncHub/regression/main 三文件历史 BOM）、索引新鲜；`npm run test:gate` 4022 例 4021 绿 + 1 例环境抖动超时（`webchatExtensionContent.test.ts`「历史遍历分页续采」——分片 2 承接原生崩溃重试后单片 877s 超时，与本轮改动无关，单独复跑 13/13 通过）；闸门 C：`PageNav` pg-next 禁用阈值注入 `>=`→`>` → Logs/Audit 各 1 例红灯 → 还原 → 156/156 复绿。
- 批次 D：typecheck 0 错、oxlint 0 errors、索引新鲜；`npm run test:gate` 4 分片 4022/4022 全绿（verify:fast 连续 3 次 0xC0000409 原生崩溃，按批次48 A27 口径改走带重试的 test:gate）；`npm run test:coverage` 4022/4022 + 覆盖率 Lines 85.09% 达标。
- 批次 D 变异验证（闸门 C）：`p0.css` `--row-h:34px` 注入改回 26px → `aTokens.test.ts` 契约红灯 → 还原 → 4/4 复绿。
- 批次 A/B/C（上一轮）：`verify:fast` 全绿 4022 例；`pagerWindow.ts` 边界判定注入缺陷 → 2 例红 → 还原 → 88/88 绿。
- 三道闸门证据全文见 `specs/code-map.md` §批次61。

## 管理员/日志验证步骤（真机手测清单）

1. 启动后整体观感：页面底色浅石墨灰（#F7F9FB）+ 白面卡片（8px 圆角、微阴影），正文不再偏小（13px）；导航树/页签条/命令条悬停为中性灰不再发蓝。
2. 记忆库页：页签条 35px 高、active 白底顶部 2px 青条 + 计数徽标；表格表头吸顶浅灰 31px、行高 34px、悬停浅灰；选中行青底；顶部蓝色 accent 全部变青色（含亮/暗主题切换各看一次）。
3. 审计日志页：表底「显示 N 行 / 共 M 行」+ 数字 pager（‹ 1 2 ›）；页头右侧导出 CSV/JSON。
4. 检索页：命中列表白卡片、页头「命中 N 条 · 用时 X ms · 预算 Xt」。
5. 右侧属性检查器（Ctrl+Shift+I）：属性键 76px 灰、值右对齐等宽数字；分区标题小号加灰。
6. 底部 dock（Ctrl+B）：32px 头、tab 底部 2px 青条、计数徽标灰底。
7. 登录窗（登出后重开）：品牌块/按钮/焦点环为青色系。
8. `Ctrl+Shift+I` 与 F1 快捷键参考、Ctrl+K 命令面板行为同上一轮（未变）。
9. 批次 F（导航对齐）：左侧导航头部只有「+ 新建记忆」「⌐ 折叠」两个 24px 图标按钮（无 folder 前置图标），点「+」打开写入页；分组标题 10.5px 小字、主项图标 16px 灰（悬停变深、激活变青）；子项 26px 行高更小字号；激活项左侧 3px 青色药丸贴导航左缘；争议角标红色、监控/同步角标琥珀、个人角标青色（激活行角标反白）；默认导航宽 236px。

## 已知边界

- 批次 D 为令牌/版式级全量对齐，非像素级复刻：检索页命中卡、日志页、Setup 向导等自定义组件的内边距与设计稿可能仍有 1-2px 级出入。
- 分层图谱（layerGraph/记忆分层子页）的层色板（批次 D 时仍为 `#4d9fff` 旧官方色板）已于批次 E 全量对齐首页 `STRATA_LAYERS` 定稿色阶，该边界不再存在。
- `verify:fast` 的 vitest worker 在本机随机 0xC0000409 崩溃（连续 3 次），批次 D 门禁改走 `test:gate`（分片+重试）+ `test:coverage`，等价覆盖 typecheck/lint/索引/测试/覆盖率五项；属环境问题非代码缺陷。
- 检查器选中联动为单选口径（状态栏「已选 1 条 / 无」）；v5 设计稿「多选计数进状态栏」未实现（页面无多选能力，不造假）。
- 历史 `release/installer-*` 7 个目录句柄占用删不掉（EPERM），`release/` 已 gitignore，不阻塞交付。
