---
status: pending
---

# 手动测试报告 · 批次58（写入表单 tab 按确认效果图重排）

- 日期：2026-11-11
- 分支：main（上一笔 `9bc2483`；本批 ahead 待查 `git status -sb`，**未 push，待授权**）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（127,990,360 B = 122.06 MiB）
- SHA256：`14AC4A62D955648A3DA92DF48FB2929603DF82521C110BF07950F0B61D7133B3`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`
- 关联：`specs/code-map.md` 批次58 段落、上一轮 57-D（`92b4b4e`）、用户确认的写入页定稿效果图
- 范围口径：用户确认「原写入页有 3 个卡片，本版式只改写入表单卡片（页），不要 3 个卡片全部改」——本批只重排「写入表单」tab；「最近回执」「查重与 L0 规则」两 tab 与页签条保持原样。底板不照抄效果图配色，全部走 Stratum A 令牌（亮/暗随壳层）。

## 1. 本轮改了什么

| 改动 | 说明 | 文件 |
| --- | --- | --- |
| masthead + 双栏 + 通栏 | 「写入表单」tab 改为：WRITE / 写入记忆 / INGEST 帽头 → 左栏 FORM + RECEIPT、右栏 DEDUP + L0 UNLOCK → 底部 RECENT WRITES 通栏（账本审计 action=write 最近 3 条，挂载即载、写入后即刷） | `src/web/write/WritePage.tsx` |
| 表单卡 | 字段序照定稿：正文 → 类别 / 来源 agent / 标签联想 chips（点击增删）→ session_id / project_id 只读；「约 N token · 质量门预判」全部实算（内核 `checkL0ToL1Quality` v3 单一真源），不抄图上样值 | `src/web/write/WriteForm.tsx` |
| 查重卡 | 一条真实词面分 + 内核阈值 0.70 对照条；命中态 `hit` 高亮；阶段5-E 诚实契约文案保留 | `src/web/write/DedupCard.tsx` |
| 回执卡 | 成功/被拒改 wf-kv 版式；被拒态如实区分「待重放 · 重放后内核自动裁决」（写密钥锁定）与「不可重放 · 修正后重新提交」（内容问题）；新增本地 HH:MM:SS `fmtHMS` | `src/web/write/WriteReceiptCard.tsx` |
| 最近写入通栏 | 时间/mem_id/动作/层/说明五列；filtered 行以审计 detail 真实 `filter_code`/`gate_version` 标注「L0+L1 质量门 v3 · {码}」；空库诚实空态「真实 0 条」 | `src/web/write/WriteReceiptCard.tsx` + `types.ts` + `coreWrite.ts` |
| L0 解锁卡常驻 | 右栏常驻：真实读写密钥状态；锁着区分「将被挡」/「被挡（E_L0_LOCKED）」；管理员就地解锁（密码成功失败立刻清空），解锁后仅确实挡过条目才自动重放；非管理员如实说明。共享 `L0WriteUnlock.tsx` 其他页面在用，不动 | **新** `src/web/write/WriteL0UnlockCard.tsx` |

## 2. 自动化门禁结果（三道闸门）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| Lint | `npm run lint`（oxlint） | 0 warnings / 0 errors |
| 索引新鲜度 | `npm run code:index -- --write` + `check` | 通过（382 源码 / 123 文档） |
| 无演示标识 | `npm run check:no-demo` | 0 命中 |
| 全量回归（A） | `npm run test:gate`（4 片串行） | **233 文件 / 2701 例 0 失败、重试 1 次**（片 4 原生崩溃 0xC0000409 按口径重试即绿；报告留档 `test-results/test-gate/20261111-104331/`）。另：verify:fast 首轮 6 例失败经复跑证实为满负载 flaky（与本次改动无交集），第 2 轮全绿 |
| 真浏览器 E2E（B） | `npx playwright test e2e/write.spec.ts` | **3/3 通过**（真 dist + CDP Chromium；渲染用例新增 masthead / RECENT WRITES 真实空态 / 右栏解锁卡断言） |
| 变异验证（C） | `DedupCard.tsx` 命中高亮注入恒 `' hit'` | 指定用例「未命中 → 不高亮」**真实红灯**（1 failed / 14）→ 原样还原 → write 模块 48/48 复绿 |
| 单测（write 模块） | `npx vitest run src/web/write` | **6 文件 / 48 例全绿**（含 L0 锁定 → 原地解锁 → 自动重放 → 回执全链） |
| 浅/深截图（B） | 临时截图脚本（验收确认后删） | 1280px 浅/深全页目视：masthead/双栏/通栏逐块对齐定稿图，令牌跟随主题（`%TEMP%\mam58-shots\write-light.png` / `write-dark.png`） |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

## 3. 包内产物校验（防「写了≠打进包」）

- `app.asar` 列表含本次构建产物 `dist/assets/write-B4X3l2tY.js`、`dist/assets/write-DK7K_0Iz.css`。
- `app.asar` 字节级检索三处标记全部命中：`wf-masthead`（新版式骨架）、`解锁并自动重放`（L0 解锁卡）、`账本暂无写入`（最近写入诚实空态）。

## 4. 真机手测清单（待用户在安装版执行）

- [ ] 覆盖安装后进「写入记忆」页：默认「写入表单」tab 出现 WRITE / 写入记忆 / INGEST 帽头，左栏写入表单 + 写入回执、右栏查重预览区 + 写密钥解锁卡、底部「最近写入」通栏；**页签条仍是三枚（写入表单 / 最近回执 / 查重与 L0 规则），后两枚版式与之前一致**。
- [ ] 「最近写入」空库时显示「账本暂无写入（真实 0 条）· 不注入演示行」；完成一次真实写入后立即出现行（时间/mem_id/动作/层/说明），无需切页签。
- [ ] 表单提示行随内容实算：空 = 「等待输入 · 质量门预判随内容实算」；带具体技术名词短句（如「PostgreSQL 16 的逻辑复制槽在主库切换后会失效」）= 「豁免字数门槛」；纯寒暄 = 「将被质量门拦截 · short_low_signal」。
- [ ] 标签联想 chips 点击加入、再点已选 chip 移除；session_id / project_id 只读（project_id 缺失时「写入记忆」禁用）。
- [ ] 写密钥锁定时（重启应用后未解锁）：右栏解锁卡显示「写密钥未解锁 · 写入将被挡（E_L0_LOCKED）」；提交后被挡文案转「这条写入被挡」；管理员输入管理密码解锁后**自动重放**并出回执，密码框立即清空；普通成员只看到说明文字、无密码框。
- [ ] 查重卡：输入与既有记忆相近内容时进度条转警示色并显示「预览提示可能重复」；note 仍含「四种真实结果 / 全部由内核自动裁决 / 不存在用户可选的『合并/覆盖/保留』模式」。
- [ ] 浅 / 深 / 随系统三主题下版式一致、无溢出无叠层；颜色跟随壳层令牌（不出现定稿图的绿格纸底）。
- [ ] 「最近回执」「查重与 L0 规则」两 tab 功能与版式无回归（含「刷新」按钮与四类回执规则表）。

## 5. 已知边界与并发说明

- RECENT WRITES 取账本 action=write 最近 3 条（成功 + 质量门拦截行）；被拒请求不入账、如实无行。
- masthead 仅「写入表单」tab 显示；其余两 tab 沿用旧页头（含写密钥状态 tag 与「解锁写密钥」按钮）。
- **并发裁决待办**：工作区存在另一会话未提交的 code-map「58-B」条目，描述「无页签单页 / wr-testonly 隐藏钩子」实现，与本仓代码不符（`wr-testonly` 全仓 grep 零命中、无对应 stash/提交）；本批以工作树实际代码为准，条目取舍待用户裁决。
