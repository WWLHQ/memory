# REQ-005 / 首启强制向导（setup.html）— 字段级 AC / TC

> 来源：`specs/需求规格书_UI页面设计.md`（IA / 首启）、`src/electron/main.ts` §6e `registerSetupIpc`、`src/web/setup/SetupPage.tsx`。
> 门禁真源：**主进程**（`isSetupComplete(readSetupPointer())` / `has_admin_wrap` / 备份至少一处 / 本次真导出过恢复卡），页面只是载体。
> 本文件把批次37-B 与批次58 的字段级行为显式落成「AC（验收判据）→ TC（用例）→ 测试文件:用例名」，供红测试反查代码段。
> 诚实边界：真原生目录/另存为对话框、真 LLM 出网、`setupDone` 落盘不在 E2E 覆盖内（E2E 打桩主进程 §6e，逐条镜像返回与拒绝文案）。

---

## A. 页面壳与诚实边界

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-01 | 纯浏览器（无 `window.api.setup`）→ 只渲染 `setup-unavailable` 说明，**不起任何 IPC**，不渲染五步卡片 | TC-SETUP-01 | `SetupPage.test.tsx`「浏览器模式（无桌面壳）：如实说明做不了，不起任何 IPC」；`e2e/setup.spec.ts`「setup.html 真产物：只给不可用说明，五步卡片一个都不渲染」「宿主只有半个 api（没有 setup 方法）时同样如实失败」 |
| AC-SETUP-02 | 挂载即读 `setup:state`，两个库路径与「新库/沿用」按**真值**回显 | TC-SETUP-02 | `SetupPage.test.tsx`「挂载即读主进程进度：两个库路径与「新库/沿用」按真值回显」 |
| AC-SETUP-03 | 进度读取失败（IPC 抛错 / `ok:false`）→ 显示原因，**任何「已完成」状态都不显示** | TC-SETUP-03 | `SetupPage.test.tsx`「进度读取失败（IPC 抛错）：显示原因，不显示任何「已完成」状态」 |

---

## B. ① 两个库的位置

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-10 | 两列**只读**输入分别显示 `ledger_dir` / `l0_dir`；`ledger_file.exists` / `l0_file.exists` 决定文案「已有文件，本次直接沿用，不覆盖」/「新库，首次写入时创建」 | TC-SETUP-10 | `SetupPage.test.tsx`「新库（文件还不存在）：显示「首次写入时创建」，不谎称已有数据」 |
| AC-SETUP-11 | 点「选择目录」→ `setup:reselectDirs`；主进程返回取消 → **保持原位并说明**，不假装已改；成功则由主进程写指针并重启 | TC-SETUP-11 | `SetupPage.test.tsx`「重选目录：主进程返回取消时保持原位并说明，不假装已改」；`e2e/setup.spec.ts`「改选目录点取消：保持原位置并如实说明，不崩不假装重启」 |
| AC-SETUP-12 | 目录校验与数据根**同一真源**（绝对路径、拒 UNC/相对、可写探针）；拒绝则如实报错、不落配置 | TC-SETUP-12 | 主进程判据（`validateDataRootPath` / `ensureDirWritable`）；E2E 经打桩镜像拒绝文案，未直连真对话框（诚实边界） |

---

## C. ① 备份路径（批次58 · **必选**）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-20 | 两列各一个「选择目录」，**点完即落盘**（图中无额外保存按钮），选后 `setup:setBackup` 落配置并回读 | TC-SETUP-20 | `SetupPage.test.tsx`「备份：选目录即落盘（图中每列一个「选择目录」，不再另造保存按钮）」；`e2e/setup.spec.ts`「备份：每列「选择目录」点完即落盘，回读后进度转绿」 |
| AC-SETUP-21 | 未选目录时输入框如实显示「未设置」，**不冒充已有备份** | TC-SETUP-21 | `SetupPage.test.tsx`「备份：没选目录时输入框如实显示「未设置」，不冒充已有备份」 |
| AC-SETUP-22 | 主进程回 `warnings`（备份与库同目录 / 数据根）→ **原样显示不吞掉**，但用户有权这么选 | TC-SETUP-22 | `SetupPage.test.tsx`「备份：主进程回警告（与库同目录）时原样显示，不吞掉」 |
| AC-SETUP-23 | 备份未设 = 必需项没齐 → 「进入应用」不可点 | TC-SETUP-23 | `SetupPage.test.tsx`「备份未设 = 必需项没齐：进入应用不可点（批次58：备份必选）」；`e2e/setup.spec.ts`「备份没设时主进程也拒绝 finish（页面禁用之外的第二道闸）」 |
| AC-SETUP-24 | `setup:setBackup`：空串 = 清空该组（回落共用 dir / 默认目录）；设了任一目录则默认开启定时备份 | TC-SETUP-24 | 主进程判据（`main.ts` §6e `setupSetBackup`）；见 AC-SETUP-20 E2E 回读 |

---

## D. ② L0 管理密码

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-30 | 密码须 **≥12 位 + 大写 + 小写 + 数字 + 符号 + 两次一致** 才可提交；提交时把**原样字符串**交给主进程 | TC-SETUP-30 | `SetupPage.test.tsx`「密码两步：不满足 ≥12 位复杂度或两次不一致不给提交；一致后把原样字符串交给主进程」；`e2e/setup.spec.ts`「密码表单闸门：≥12 位复杂度且两次一致才可提交」 |
| AC-SETUP-31 | 密钥环已有 `admin_wrap` → **不再给首次设密码表单**，改给「用管理密码重新生成恢复码」 | TC-SETUP-31 | `SetupPage.test.tsx`「密码已设：不再给首次设密码表单，改给「用管理密码重新生成恢复码」」；`e2e/setup.spec.ts`「第③步只给「用密码重新发码」，不再出现设密码表单」 |
| AC-SETUP-32 | 向导内**没有改密码通道**：已设密码时提交新密码被主进程拒绝 | TC-SETUP-32 | `e2e/setup.spec.ts`「向导里绝不再有「改密码」通道：已设密码时提交新密码被主进程拒绝」 |
| AC-SETUP-33 | 重发码时密码错 → 主进程原因**原样显示**，不发码也不跳转 | TC-SETUP-33 | `e2e/setup.spec.ts`「密码错 → 主进程原因原样显示，不发码也不跳转」 |

---

## E. ③ 恢复卡（明文只出现一次）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-40 | 发码成功 → 分组明文码可见 + 复制/导出入口 + 明确「只显现这一次」 | TC-SETUP-40 | `SetupPage.test.tsx`「发码成功：分组明文码可见 + 复制与导出入口，且写明只显现这一次」 |
| AC-SETUP-41 | `card_pending` 但码已不再回显 → **如实说明，绝不编一个码出来** | TC-SETUP-41 | `SetupPage.test.tsx`「卡待导出但码已不再回显：如实说明，绝不编一个码出来」 |
| AC-SETUP-42 | 没导出恢复卡 → 「进入应用」不可点（强制先导出） | TC-SETUP-42 | `SetupPage.test.tsx`「没导出恢复卡：完成按钮不可点（强制先导出才能继续）」 |
| AC-SETUP-43 | 导出取消 → 说明「可再点一次」，**不放行完成** | TC-SETUP-43 | `SetupPage.test.tsx`「导出取消：说明「可再点一次」，不放行完成」；`e2e/setup.spec.ts`「导出时在原生对话框点取消：如实说「可以再点一次」，且不放开 finish」 |
| AC-SETUP-44 | 导出落在数据根内 → 回执如实警告「同一次事故会一起没」，但按已导出放行 | TC-SETUP-44 | `SetupPage.test.tsx`「导出落在数据根内：回执如实警告「同一次事故会一起没」，但按已导出放行」 |
| AC-SETUP-45 | 恢复码明文**不进日志/审计**，日志只记指纹与目录 | TC-SETUP-45 | 主进程日志口径（`actionLog('kernel','l0:recovery-issued',{fingerprint})`）；审计未直接断言正文不存在（诚实边界） |

---

## F. ④ 精炼大模型（批次58 · 可选）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-50 | 未拨测通过前「保存并启用」**禁用**；拨测通过后才放开 | TC-SETUP-50 | `SetupPage.test.tsx`「模型：没拨测通过前「保存并启用」不可点；拨测通过后才放开」；`e2e/setup.spec.ts`「精炼大模型：拨测通过才允许「保存并启用」（未测时按钮禁用）」 |
| AC-SETUP-51 | 拨测失败 → 保存仍禁用，并**原样显示**主进程给的原因 | TC-SETUP-51 | `SetupPage.test.tsx`「模型：拨测失败 → 保存仍禁用，并把主进程给的原因原样显示」 |
| AC-SETUP-52 | 保存由**主进程复测**后才算数；保存被拒如实显示，不谎称已启用 | TC-SETUP-52 | `SetupPage.test.tsx`「模型：保存由主进程复测后才算数——保存被拒时如实显示、不谎称已启用」 |
| AC-SETUP-53 | 跳过弹窗**必须写明**「无法生成 L2–L5 精炼记忆层」；点「否」只关窗不落标记 | TC-SETUP-53 | `SetupPage.test.tsx`「跳过：弹窗必须写明「无法生成 L2–L5 精炼记忆层」；点否只关窗，不落跳过标记」；`e2e/setup.spec.ts`「精炼大模型：跳过必须先看见代价（L2–L5 生成不出来），点「否」只关窗」 |
| AC-SETUP-54 | 必需项已齐时确认跳过 → 记 `llmSkipped` 标记并直接进入应用；没齐时只记标记、不假装能进 | TC-SETUP-54 | `SetupPage.test.tsx`「跳过：必需项已齐时，确认跳过即记标记并直接进入应用」「跳过：必需项没齐时只记标记，不假装能进应用」 |

---

## G. `setup:finish` 闸门（主进程硬判据）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-60 | 页面 `requiredDone` = `dirs_set && backupDone && has_admin_password && card_exported`；**精炼模型可选，不在其列** | TC-SETUP-60 | `SetupPage.test.tsx`「进度三格：状态全部来自 setup:state（已设备份 / 已跳过模型 / 已导出卡）」 |
| AC-SETUP-61 | 点完成 → 按主进程给的 `next_url` 跳转（端口参数由主进程拼，页面不自拼） | TC-SETUP-61 | `SetupPage.test.tsx`「三步走完：点完成按主进程给的地址跳转（端口参数由主进程拼）」 |
| AC-SETUP-62 | 主进程拒绝完成 → 显示原因，**绝不跳主界面** | TC-SETUP-62 | `SetupPage.test.tsx`「主进程拒绝完成：显示原因，绝不跳主界面」；`e2e/setup.spec.ts`「必需项看起来都完成，但 setup:finish 被拒 → 停在向导页并摆出原因」 |
| AC-SETUP-63 | 主进程三重硬判据：`has_admin_wrap` **且** 备份至少一处 **且** 本次真导出过卡（`recoveryCardExported && pendingRecoveryCard`），缺一即拒 | TC-SETUP-63 | 主进程判据（`main.ts` §6e `setupFinish`）；E2E「备份没设时主进程也拒绝 finish」覆盖备份这一支，其余两支由拒绝文案与单测镜像 |
| AC-SETUP-64 | 走完写 `setup:done` 审计，`llm` 字段如实记 `configured`/`skipped`/`untouched`，`backupEnabled` 记真实值 | TC-SETUP-64 | 主进程审计口径（`main.ts` §6e `setup:done`）；未直接单测（诚实边界） |

---

## H. 备份配方（`backupFiles.ts`，批次58 分组）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-SETUP-70 | 分组归属：`ledger + audit` 一组，`l0 + keyring` 一组（密钥环必须跟原数据库同处） | TC-SETUP-70 | `backupFiles.test.ts`「分组归属：ledger+audit 一组，l0+keyring 一组」 |
| AC-SETUP-71 | 目录优先级：本组专用目录 → 共用 `dir`（老配置）→ 默认目录；**默认目录恒非空**，不写出空路径 | TC-SETUP-71 | `backupFiles.test.ts`「分组目录优先：两处都配好时各进各的目录（密钥环跟原数据库）」「老配置只有 dir：两类都回落到 dir（批次37-D 行为不变）」「只配了一处：另一组回落到 dir → 再回落到默认目录」 |
| AC-SETUP-72 | `backupTargetDirs`：同目录只出现一次，两处不同则两条 | TC-SETUP-72 | `backupFiles.test.ts`「backupTargetDirs：同目录只出现一次，两处不同则两条」 |
| AC-SETUP-73 | 既有红线不破：只备真实存在的源、每个前缀各留 keep 份、只删本配方产物（`isRecipeBackupName`）、审计只认 `.jsonl` | TC-SETUP-73 | `backupFiles.test.ts` 既有 15 例（`planBackupFiles` / `selectBackupsToDelete` / `isRecipeBackupName` / 排序与归属） |

---

## 复核命令

```bash
npx vitest run src/web/setup src/electron/__tests__/backupFiles.test.ts   # 47 例
npx playwright test e2e/setup.spec.ts                                     # 16 例（需真 dist 产物）
npm run typecheck && npm run lint                                         # 静态门禁
```
