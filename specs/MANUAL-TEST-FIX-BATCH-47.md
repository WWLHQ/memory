# 手动测试报告 · 批次 47：写入页模板 1:1 复刻 STRATUM pg-write

> 日期：2026-11-21 ｜ 前序：S0 壳层 + S1 首页 STRATUM 复刻（已交付运行）
> 设计真源：`stratum-a-full.html` pg-write 视图段（仓库对齐基准 `specs/STRATUM-设计系统规格.md`）
> 用户要求同首页：逐页 1:1 复刻（视觉+格式+符号+配色+**页面格式模板**），不残留上版任何东西；数据全接真实账本，演示数字不落。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/web/write/theme.css` | 整文件重写：STRATUM 令牌内嵌 `.wr-page`（亮 `#F3F5F8/#0088CC/--r:10px`、暗 `#060B16/#22D3EE`）；af 基元子集（head/btn/alert/panel/ph/pb/field/input/select/textarea 88px/formgrid/pill/stat/bar/table/badge/empty/kv/actline/toast）；`wr-cols` 落设计稿双栏 `1fr 320px`（≤900px 单列）；**wf-*/p0-* 旧版式类清零** |
| `src/web/write/WritePage.tsx` | 重建成设计稿单页模板：`af-head`（h1 写入记忆 + sub「只落 L0 密文 + 脱敏 L1 · 深层交后台补炼 · L0→L1 质量门 v{实算版本} 无旁路」）→ 双栏：左=写入表单 + E_L0_LOCKED warn alert（**真被挡过才出现**）+ 就地解锁卡（warn 边框，已解锁不渲染）+ 回执/待生成卡；右=查重预览；底部=最近写入通栏表。**tab 栏（写入表单/最近回执/查重与L0规则）、p0-pagehead、页头写密钥状态徽标、`L0WriteUnlock` 右栏卡全部移除**——设计稿页头无右侧区，锁状态由解锁卡如实承载 |
| `src/web/write/WriteForm.tsx` | af-panel 模板：af-ph hint `≈{estimateTokens 实算} tokens · {质量门实算提示}`（设计稿样值 38 不抄）；af-formgrid 四格（类别/来源 Agent/session_id 只读/project_id 可修改——修复轮3 行为保留）；标签联想 af-pill +「点击采纳 · 脱敏在 L1 自动执行」；写入行 af-btn pri + 快路径 note |
| `src/web/write/DedupCard.tsx` | 设计稿右栏「查重预览」：af-stat 词面相似度单值（.k 带阈值/层，全部实算）+ af-bar + 判读 note + 最接近记忆 pill + 内核裁决 note +「查看净化生长 →」接真实导航 `requestShellView('growth')`；诚实化契约逐句保留（四类结果自动裁决 / 四维判重 / 未接大模型只查 L1 / 不做假刻度 / 无「合并/覆盖/保留」按钮） |
| `src/web/write/WriteReceiptCard.tsx` | 回执=af-panel + af-badge + af-kv（request_id/memory_id/去重/精炼/写入时间，四类结果照内核真实返回，filtered 明确未入库）；被拒卡=原因 + request_id（未签发如实写「未签发」）；最近写入=设计稿四列表（时间/mem_id/动作/层，只统计真实落库 create/graft/keep，质量门拦截不计入）；**`WriteReceiptTable` 整体删除**（tab 版式残留） |
| `src/web/write/WriteL0UnlockCard.tsx` | 重写为设计稿「就地解锁 L0 写密钥」warn 边框面板：密码框 +「解锁并自动重放」同行 nowrap；admin 管理密码 / §4.4.4-B 成员写解锁口令 / 未登录 need-admin 三路径语义不变；密码「只进这一次调用、成功失败都清空」边界不变 |
| 写入页测试 6 文件 | `WritePage.test.tsx`：tab 类用例改 STRATUM 模板契约（af-head/无 tab/af-cols/占位卡）；`WritePage.l0locked.test.tsx`：`l0-unlock-done` 改「解锁成功后解锁卡收起 + alert 消失」，别处解锁信号用例改「解锁卡收起」；`DedupCard.test.tsx`：className 改 `af-panel`；session/visual 用例回归 |
| `specs/code-map.md`、`specs/code-index.generated.md` | 同步本轮条目与符号索引 |

**诚实化边界（有意不抄设计稿的部分）**：设计稿演示数字（≈38 tokens / 相似度 0.31 / demo 表行）一律不落，全部实算实读；设计稿类别选项（skill/episode 等 demo 词表）不抄，用内核真实类别；`p0-tabs` 在 asar 中仍有命中属**其它未复刻页面**（home/audit 等）的正常残留，写入页自身 chunk 已清零。

## 三道闸门证据

| 闸门 | 证据 |
|---|---|
| A · 影响面回归 | `npm run verify:fast` 全绿（复跑）：typecheck（web+electron）0 错、oxlint 0 error、`code-index:check` 最新、vitest 全量通过（首轮 0xC0000409 并发抖动，复跑即绿——已知边界）；覆盖率 Statements 81.91% / Branches 73.93% / Functions 78.56% / Lines 85.19%；`code:index --write` 441 源码 / 154 文档 |
| B · 效果验证 | 写入页定向 **63 例全绿**：STRATUM 模板结构（af-head + 无 tab + 1fr/320px + 占位卡）、四类回执字段、质量门拦截不计入最近写入、L0 锁定 alert/解锁卡三路径、成员 §4.4.4-B 自解锁、别处解锁信号广播、session 回归——断言打到真实渲染 DOM/CSS，均为「真的变了」型 |
| C · 变异验证 | 拆掉 `rows.filter((r) => r.filter_code === null)`（把质量门拦截算进最近写入）→ `WritePage.test.tsx` 修复轮4 用例**精确判红**（1 失败 / 12 绿）；原样还原 → 63 例复绿。另试 `showUnlockCard` 恒真变异未判红——该判定与异步状态刷新冗余，属无效变异位，如实记录后还原 |

## 产物与运行态

| 项 | 值 |
|---|---|
| 安装包 | `release\installer\MultiAgent Memory-0.1.0-setup.exe`（129,312,522 bytes） |
| SHA256 | `26161B0B3AD03FB475FC752665E81DDE395779DFFA60E1492CAE243435667EFB` |
| package.json | `git diff` 为空（未被 electron-builder 污染） |
| main.cjs | `app.asar.unpacked\dist-electron\main.cjs` 与 `dist-electron\main.cjs` SHA256 逐字节一致 |
| 产物标记 | `app.asar`（UTF-8 明文）含 `wr-page`/`write-head`/「只落 L0 密文 + 脱敏 L1」/「质量门 v」/「写入表单」/「查重预览」/「最近写入」；写入页旧类 `wf-pagehead`/`wf-card`/`write-tab-` **0 命中**（v5 残留清零成立） |
| 关端核验 | 打包前 `MultiAgent Memory.exe` 进程 0、8200~8204 无 LISTENING |
| 启动 | WMI 启动 PID 54160 → `D:\MultiAgent Memory\logs\main.log` `[2026-11-21T03:54:17.026Z] bootstrap:done`（数据根 `D:\MultiAgent Memory`，`l0ReadOnly:false`），8200/8201/8202/8203/8204 全部 LISTENING |
| 清扫 | `coverage/`（13.5 MB 验证产物）已删；`test-results/` 无残留；release 下 7 个历史 `installer-*` 被占用删不掉（已知边界，gitignored 不阻塞） |

## 手动验证步骤（用户实机）

1. 点侧栏「写入记忆」：页头应为「写入记忆」+ 灰色副行（只落 L0 密文 + 脱敏 L1 · 深层交后台补炼 · 质量门 v3 无旁路）；**没有 tab 栏**，整体为「左表单 + 右查重 + 底部最近写入」三段双栏。
2. 写入表单：hint 为「≈N tokens · …」实时跟随内容变化；内容框约 88px 高；类别/来源 Agent 下拉、session_id 灰色只读、project_id 可改；标签联想为蓝边胶囊。
3. 右栏查重预览：输入内容后出现大号等宽相似度值 + 进度条 + 判读说明；「查看净化生长 →」点击应切到净化生长页。
4. 底部最近写入：四列表（时间/mem_id/动作/层），动作徽标 create 蓝 / graft 绿 / keep 黄。
5. 提交一条真实写入：应出「回执」卡（徽标 + request_id/memory_id/去重/精炼/时间五行 kv），短无信息量内容应被质量门拦截并明确「未入库」。
6. L0 锁定联动：安全页锁写密钥后到写入页提交 → 出黄底「L0」alert + 黄边「就地解锁」卡；解锁成功后 alert 与解锁卡自动消失、被挡那条自动重放出回执。
7. 亮/暗主题切换：纸灰 `#F3F5F8` / 深空 `#060B16`，海洋蓝 accent，与首页同套。

## 已知边界 / 未完成

- 设计稿「查重与 L0 规则」的规则性内容（四类回执释义、LAYER_SPECS 表）随 tab 一起移除（设计稿无此面板，相关说明由查重预览 note 与「净化生长」页承载）；若实测后觉得需要，可在净化生长页补。
- 页头不再显示写密钥状态徽标（1:1 口径）：锁定态由 alert+解锁卡承载，解锁态页面无状态显示——属设计稿既定形态。
- 逐页复刻推进中：下一页待用户指定。
