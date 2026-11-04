# 批次37 手动测试报告 · L0 与 L1–L6 拆成两个库文件（强制首启选位 + L0 管理密码 + 双库备份 + 恢复码找回 + 按 L0 重建）

日期（UTC+08:00）：2026-11-02
分支：`main`（批次35、36、37 的改动都**还未提交**，HEAD 仍是 `3a4080a`；`git push` 需用户明确授权）
上一批次：批次36（`specs/MANUAL-TEST-FIX-BATCH-36.md`）

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,034,774 字节 = **116.38 MB** |
| SHA256 | `97D9606A3E8233AFF8DF3C4266803A1C0346EAFCCC141F7A331653DF2CDEEB22` |
| 构建完成（UTC+08:00） | 2026-11-02 20:20 |
| `npm run verify` | **退出码 0（全绿）**；尾部实测 Playwright **94/94 E2E 通过（34.5s）** |
| `npm run lint` | oxlint `0 warnings / 0 errors`（489 文件 / 123 规则 / 83ms） |
| `npm run code:index:check` | 代码索引已是最新（**301 个文件**） |
| `npm run test:coverage` | vitest **143 文件 / 1624 用例全过** → Statements 81.02%（10583/13062）/ Branches 73.14%（7569/10348）/ Functions 77.14%（2370/3072）/ Lines 84.12%（9209/10947） |
| 批次37 新增单测（逐个文件实测计数） | 内核/主进程 8 文件 **103 例**：`l0Store` 27 · `l0VaultRecovery` 13 · `dataRoot` 20 · `rebuild` 12 · `backupFiles` 10 · `l0Split` 9 · `l0Recovery` 8 · `l0SplitFile` 4；渲染层 6 文件 **58 例**：`SetupPage` 14 · `L0RecoveryCard` 13 · `RebuildFromL0Card` 12 · `L0SplitCard` 11 · `l0BlobStore` 6 · `setupEntry` 2 |
| 旧包清理 | 本次 `release/installer` 删除被 EPERM 挡住（该环境 rename 对新目录同样被拒），构建产物先落 `release/installer-20261102-121947/`，成功后按批次21 的兜底**改用复制+删除**收口回固定目录；日志原文：`[package] 旧 release/installer 删除失败（EPERM），继续尝试收口` → `[package] 目录重命名被占用（EPERM），已改用复制+删除：release\installer` → `[package] 已删除旧 release/installer，并把本次产物收口到固定目录` |

## 1. 这一批解决什么（用户三句原话 + 五项拍板）

- 「**执行36-D「L0 与 L1–L6 拆两个库文件」，软件首次启动需强制用户指定 L0 库和 L1-L6 库位置，并且 L0 库和 L1-L6 库要增加备份功能**」→ 37-A 拆库 + 37-B 强制首启向导 + 37-D 双库备份。
- 「**原数据库最好搞成密码忘记可找回的渠道，数据是宝贵的万一忘记密码数据就废了损失比较大**」→ 37-G 恢复码 + 恢复卡。
- 「**我说的删除库只是删除 L1-L6 的库，不用重新读，直接从 L0 重新生成**」→ 37-E 按 L0 原文重建 L1–L6（不重采、不动游标）。
- 配套的 37-C 存量搬家：老账本里 1641 行**明文** `content_orig` 得先封成 v2 信封搬进 L0 库，「拆库」才是真的拆，而不是换个地方躺明文。

**五项拍板（AskUserQuestion，逐条已落地）**

| # | 拍板 | 落地的判据 |
|---|---|---|
| ① | 升级上来的老指针**也走强制向导** | 指针没有 `setupDone` → 每次启动都进 `setup.html`（本机当前指针实测就没有 `setupDone`，见 §2） |
| ② | 两个库**各自选目录**，可同可不同 | `ledgerDir` / `l0Dir` 两个字段独立；`setup:state` 回 `same_dir` 供页面如实标注 |
| ③ | 首启**强制先设 L0 管理密码** | `setup:finish` 要求 `has_admin_wrap=true`，否则返回「还没设置 L0 管理密码：这一步不能跳」 |
| ④ | 按 L0 重建入口**一起做** | 安全页 `RebuildFromL0Card.tsx` + `l0:rebuildPreview`/`l0:rebuildRun` |
| ⑤ | 找回=**恢复码 + 恢复卡**，码**一次性**，**必须先导出一张卡**才能走完向导 | `setup:finish` 只在**本次真导出过一张卡**才落 `setupDone`；`recoverWithCode` 成功即作废并当场换新码 |

## 2. 本机当前真实状态（决定「实机第一步会看到什么」，全部命令行实测 2026-11-02 20:1x）

```
数据根：C:\Users\LHQ\AppData\Roaming\MultiAgent Memory
指针 data-root.json：{ version:1, root:…, updatedAt:2026-10-30 }   ← 没有 ledgerDir / l0Dir / setupDone
memories.db.json：21,158,589 字节 · 1642 行 · content_orig 1641 行 · content_l0_enc 0 行 · has_l0 0 行
memories.l0.json：不存在
l0-keyring.json：存在（v:2，admin_wrap 有，grants 0，requests 0，recovery_wrap 没有，updated_at 2026-11-01 17:06 UTC+08:00）
backups/：只有 2 个 legacy-auto-demote-* 目录；memories-/meml0-/l0key- 三个前缀各 0 份
backup-config.json：不存在（走默认份数）
```

**由此推出本机实机走查的真实路径**（不是「从零设置密码」，别按从零写预期）：

1. 指针没有 `setupDone` → 装完新包**首次启动必进首启向导**（拍板①）。
2. 第②步「设置 L0 管理密码」会显示 **`本机已设置 L0 管理密码。如果上一轮的恢复卡没导出就退出了，用该密码在下面重新生成一张新码（旧码当场作废）。`** ——因为 11-01 那次 `l0:setup` 已经把 `admin_wrap` 建好了。此时要产出恢复卡，得**输入那次的 L0 管理密码**点「重新生成恢复码」（`setup:regenCode`：当场解锁→换发新码→立刻锁回）。
3. 想跳过这一步是**不行**的：`setup:finish` 硬性要求「本次真导出过一张恢复卡」。
4. **密钥环里没有 `recovery_wrap`**，所以 11-01 那个管理密码如果已经想不起来，恢复码这条通道对本机**还没生效**（码是这次才要发的）。真遇上的最省事退路：把 `l0-keyring.json` **改名**（不要删）移走——它现在**不保护任何密文**（L0 库不存在、信封 0 行），重启后向导会当成没设过密码、重新设一次并当场发码导卡。**一旦 `memories.l0.json` 里有信封，这招就永远不能用了**（那等于销毁解密能力）。

> 校正声明：批次36 报告与本仓文档此前写的「数据根没有 `l0-keyring.json`（L0 从未初始化）」是**错的**，已按上面的实测改正（批次36 报告、`specs/code-map.md`、`specs/需求规格书.md` §19.21 三处都留了校正）。结论不变：**必须先解锁 L0 写密钥才能重新入库**，只是理由从「键环没有」变成「键环有、可它保护的密文一份都还没有」。

## 3. 改动清单（逐文件为何要动）

| 文件 | 改了什么 | 为什么必须动这个文件 |
|---|---|---|
| [src/core/memagent/l0Store.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/l0Store.ts)（**新**） | `L0BlobStore` 接口 + `FileL0BlobStore`（`{version,items:{[mem_id]:{envelope,sealed_at}}}`、0600）+ `isSealedL0`（**只放行 v2/v1 信封**）+ `InMemoryL0BlobStore`；`L0NotSealedError` / `L0StoreCorruptError` / `L0StoreLockedError` | 37-A 的本体。**明文进不了这个文件**，「拆库」才不是「把原文挪个地方继续裸奔」；原件读不动时改名隔离 + 落 `kernel:l0:store-corrupt`，绝不静默当空库 |
| [src/core/memagent/fileStorage.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/fileStorage.ts) | 新增 `l0?: L0BlobStore` 注入与 `l0Store` getter；写路径把信封搬进 L0 库、行上只留 `has_l0`；删行/清 L0 同步删密文不留孤儿；**行说有自己的 L0 而库里没有 → 显式断链错误** | 记忆库与 L0 库的**唯一接线点**。不注入的调用方（含全部既有测试）行为不变，所以只加选项不做兼容层 |
| [src/web/shared/l0BlobStore.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/shared/l0BlobStore.ts)（**新**，挂在 [kernel.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/kernel.ts)） | 渲染层**只读**门面：`getAll` 一次走 `l0:blobs` 取完整库（不逐条打 IPC）、拿到的仍是密文、不解密不缓存正文；写/删/整库枚举一律显式 `E_NOT_IMPLEMENTED` | 拆库后内核 browse 要信封才能解密，但**渲染层永远不是 L0 库的写者**——把这件事写成代码里的显式拒绝，而不是文档里的一句约定 |
| [src/electron/dataRoot.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/dataRoot.ts) | `LEDGER_FILE_NAME` / `L0_FILE_NAME` / `L0_KEYRING_FILE_NAME`、指针新增 `ledgerDir`/`l0Dir`/`setupDone`、`resolveLibraryPaths`（缺省=root，**兼容读取**）、`isSetupComplete` | 两个库各自的位置只有一个真源；老指针（本机就是）读得出、不会炸 |
| [setup.html](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/setup.html) + [src/web/setup/SetupPage.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/setup/SetupPage.tsx) / [setupEntry.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/setup/setupEntry.tsx) + [vite.config.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/vite.config.ts) 的入口 | 第 20 个 HTML 入口。三步卡片（①两库位置 ②L0 管理密码 ③恢复卡），进度**一律按 `setup:state` 真值**回显；主进程说不回显恢复码时页面绝不自己编一个；三步没走完「完成设置」不可点；主进程拒绝就原样显示原因、绝不跳主界面 | 37-B。**门禁在主进程，页面只是载体**——所以页面拿不到真值时唯一诚实的做法是「不做任何断言」 |
| [src/electron/main.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/main.ts) §2/§5/§6/§6e | `isWizardIncomplete()`、`mainWindowUrl(port, wizardFirst)`（向导没走完主窗口直接进 `setup.html`）、`chooseLibraryDirs`（**取消=诚实退出，不塞默认值**）、`adoptLibraryFilesIntoPlace`（补送到新目录、不删源）、`registerSetupIpc` 六条通道、`registerL0Ipc` 的 `l0:blobs`/`split*`/`rebuild*`/`recovery*`、`backupBeforeKernelChange(dirPrefix)` | 只有主进程是 FileStorage 的写者，也只有它能在 `app ready` 前解析路径。`setup:setL0Password` 用「**密钥环尚无 `admin_wrap`**」这条比会话更硬的本机判据（向导跑在登录之前） |
| [src/electron/backupFiles.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/backupFiles.ts)（**新**） | 三前缀 `memories-`/`meml0-`/`l0key-` + 同一时间戳；`planBackupFiles` 只收真实存在的源、缺哪个就在回执里明说；`selectBackupsToDelete` **每个前缀各留 keep 份**；`tsOfBackupName`/`sortBackupsNewestFirst` 按**时间戳段**排序 | 37-D。三类前缀长度不同，整串排序会让一个库独占榜单、把另两个库的历史挤掉。**只备记忆库 = 让 L0 原库成为唯一没有退路的那一份** |
| [src/core/memagent/l0Split.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/l0Split.ts)（**新**） | `scanLedgerForSplit`（只读预览）/ `splitLedger`（执行）：明文**必须先封存成 v2 信封**才许搬，没解锁写密钥整轮拒绝；行上已有 v1/v2 **原样搬家不重封**（重封要旧密码，那是 `l0:migrate` 的活）；解析不出的既不搬也不删；单行失败不中断；再跑一遍幂等零写盘 | 37-C。存量是 1641 行明文，这是本机唯一一次「搬家」机会，做错等于把原件毁在中间态 |
| [src/core/memagent/rebuild.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/rebuild.ts)（**新**） | `makeL0Reader`（原文**只有两条来源**：行上历史明文 / 管理员 L0 查阅会话；四类原因码 `no_source`/`broken_link`/`view_locked`/`bad_envelope`）、`scanRowsForRebuild`、`rebuildLayersFromL0`（原文→`checkL0ToL1Quality`→新 L1→（可选）逐层 L2–L6 过 `checkLayerSpec`→重算 `sha256`/`embedSync(L1)` 向量/`layer_specs`/`layers_generated_at`/`quality_gate_v`） | 37-E「删的只是 L1–L6 那份库，不用重采」。管道函数 `makeLayerGenerator`/`buildL6Input`/`layerSpecsFrom` 由 [memories.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/memories.ts) 导出复用——**与正常写入同一条管道，不复制实现**，否则重建出来的库和日常写的库不是一套规则 |
| [src/core/memagent/l0Recovery.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/l0Recovery.ts)（**新**） + [l0vault.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/l0vault.ts) | `generateRecoveryCode`（32 字节 = 256bit 随机数，**不是密码的衍生物**）、`createKeyringSecrets`（**同一个 DEK 包两份**）、`buildRecoveryCard`（纯文本卡：码 + 库指纹 + 对应文件路径 + 红线，**绝不含管理密码**）、`keyringFingerprint`、`RECOVERY_BAD_CODE`；vault 侧 `initL0WithRecovery`/`rotateRecoveryCode`/`recoverWithCode`/`recoveryStatus` | 37-G。恢复成功当场作废旧码换新码；**码错算进同一套 5 次锁定链路**；DEK 不变 → 恢复前封的信封用新密码照样解得开；状态接口只回「有没有/指纹/时间」 |
| [src/electron/ipcChannels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/ipcChannels.ts) · [preload.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/preload.ts) · [src/desktop/hostBridge.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/desktop/hostBridge.ts) | `setup:{state,reselectDirs,setL0Password,regenCode,exportCard,finish}` 六条 + `l0:blobs`/`l0:splitPreview`/`l0:splitRun`/`l0:rebuildPreview`/`l0:rebuildRun`/`l0:recovery*`；闸门：预览类需会话、执行类需管理员 + 逐字口令（`SPLIT`/`REBUILD`）、恢复类**全部仅管理员** | 四层都要接通页面才点得到；口令逐字是为了「不是手滑回车就把库动了」 |
| [src/web/security/L0SplitCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/L0SplitCard.tsx) / [RebuildFromL0Card.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/RebuildFromL0Card.tsx) / [L0RecoveryCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/L0RecoveryCard.tsx)（均**新**），挂在 [SecurityPage.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/SecurityPage.tsx) | 预览→逐字口令→执行→回执（回执里**不含任何原文**，有 `not.toContain` 断言）；重建卡内解锁/锁上查阅会话走 `l0:unlock`/`l0:lock`，解锁后带 `l0_session_id` 重拉预览 | 这三件事都会动真实账本或动密钥环，只能做成「管理员在应用内亲手点」的形态，我不能替用户点 |
| [src/web/params/KbManagementCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/params/KbManagementCard.tsx) · [src/web/memory/dataRoot.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/memory/dataRoot.ts) · [backup.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/memory/backup.ts) | 设置页展示两个库的**真实路径**与三类备份历史（按前缀分组） | 用户要能在界面上确认「L0 库到底落在哪、有没有被备份到」，否则双库备份不可核对 |
| [src/web/Home/programLogLabels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/Home/programLogLabels.ts) | 新增 `dataRoot:setup:*` 八条 + `kernel:l0:split-*` 四条 + `kernel:l0:rebuild-*` 四条 + `kernel:l0:recovery-*` 四条 + `kernel:l0:store-corrupt`，加 `setup:*` 与新 `l0:*` 通道说明 | 「有动作就有日志」，且日志页要用人话看得懂这次为什么被拒（§5 逐条核对表） |

## 4. 管理员实机走查步骤（**本批次这些路径还没有在真机点过**，见 §6）

### 4.1 首启强制向导

前置：安装 §0 的包并启动。**预期第一眼就是向导页**，不是主界面（本机指针没有 `setupDone`）。

| 步 | 操作 | 预期回显 |
|---|---|---|
| ① | 启动时的系统目录对话框分别选两个库目录（可以选同一个） | 向导第①步变「已完成」，卡片上显示两个库的**绝对路径**与文件名（文件名固定不可改）；同目录时如实标注 |
| ①′ | 在对话框里点**取消** | 应用**诚实退出**，不塞默认值、不带半配置继续启动（日志：`库位置未选择，已退出（向导不接受半配置）`） |
| ①″ | 点「重选目录并重启」 | 只写指针并重启，**不删任何原文件**；下一轮启动把库文件补送到新目录（目标已有同名文件则不动）。改完必须重启才生效（路径在 `app ready` 前解析） |
| ② | 本机是「已设过密码」分支：输入 11-01 那次设的 L0 管理密码 → 点「重新生成恢复码」 | 页面显示**一次性**的恢复码分组明文 + 指纹徽标；同时出现「导出恢复卡（另存为）」。日志只有 `L0 恢复码已生成（旧码当场作废）` + 8 位指纹，**没有码、没有密码** |
| ②′ | 密码输错 | 原样显示内核原因 `E_AUTH_L0`（文案「管理密码错误（§4.4.4）」），并计入同一套 5 次锁定（审计 `reason='bad_password'`，第 5 次 `bad_password_5`）；页面绝不跳主界面 |
| ③ | 点「导出恢复卡（另存为）」并存到某个**与这台电脑分开**的位置 | 原生另存为对话框；卡面纯文本（可打印/可抄/存密码管理器），含码、库指纹、对应文件路径、红线；**卡面不落数据根** |
| ③′ | 不导卡就点「完成设置」 | 被拒：`恢复卡还没导出：没有这张卡，忘记管理密码时 L0 原文就找不回来`（用户拍板⑤：强制先导出才能继续） |
| ④ | 导卡后点「完成设置」 | 落 `setupDone`，主进程返回 `next_url` 并进入主界面；日志 `首启向导完成（恢复卡已导出）` |
| ⑤ | 重启第二次 | 不再进向导（日志 `首启设置已完成，直接进入主界面`） |

**必须自己确认的一件事**：恢复码明文**只在发码那一次**出现。关掉那页就再也看不到，只能再「重新生成」（旧码当场作废）——所以第③步要**真的存下来**。

### 4.2 双库备份（参数页 →「数据目录 / 知识库管理」卡片）

1. 点「立即备份」→ 数据根 `backups/` 应出现**同一时间戳的三类文件**：`memories-<UTC>.json`、`meml0-<UTC>.json`、`l0key-<UTC>.json`。
2. **本机现在第 2、3 类会不会缺？** 会——`memories.l0.json` 还不存在。回执应**明说缺哪个源**，而不是伪造三份齐全。跑完 4.3 的存量拆分后再点一次，三类都应齐。
3. 备份份数：每个前缀**各留 keep 份**（互不挤占）。多点几次立即备份，确认 L0 库与密钥环的历史不会因为记忆库备份变多而被删掉。

### 4.3 存量搬家（安全页 →「L0 存量拆分迁移」卡）

1. 管理员进入 → 先看**只读预览**（明文行数、已有信封行数、解析不出的行数）。本机预期明文侧命中 ≈1641 行。
2. 直接点执行会被拒两次，都是**对的**：没解锁 L0 写密钥 → `存量拆分迁移被拒（口令不符或未解锁 L0 写密钥）`；口令不是逐字 `SPLIT` → 同样拒绝。
3. 先在卡上解锁 L0 写密钥，逐字输入 `SPLIT` 执行 → 回执 + 备份目录（**先双库备份，备份失败直接拒绝**）。
4. 事后核对：`memories.l0.json` 出现且有 1641 个条目、`memories.db.json` 里这些行 `content_orig` 消失、`has_l0=true`、`content_l1` 一字未动；在 `memories.db.json` 里 **grep 不到一个字节的历史原文**。
5. 再点一次执行应**幂等**（零写盘）。

### 4.4 忘记管理密码找回（安全页 →「L0 恢复卡 / 恢复码」卡）

1. 卡上状态只回「有没有恢复码 / 指纹 / 最近时间」，**不回码明文**。
2. 找回是**一步两件事**：`recoverWithCode({code, newPassword})` —— 用码解开 `recovery_wrap` 的同时**当场设新的 L0 管理密码**（新密码同样有 ≥ 位数的长度门槛）。成功即：旧码作废 → 新码当场发一次（这是它唯一一次露面）→ **必须重新导出一张新卡**。审计落 `security_change`/`op='l0_recovered'`，只有新旧指纹与账号，**没有码、没有密码**。
3. 连续输错恢复码 5 次 → 与密码错误**同一条锁定链路**（5 次锁 15 分钟）：恢复码也是凭据，一样可以被暴力试探，一样按凭据来限流。绝不因为「这是找回通道」就放宽。
4. 用已经作废的旧卡来找回 → 明确拒绝：`这张恢复卡已作废（一次性）：请使用最新一次导出的那张`；本机从没发过码 → `本机从未生成过 L0 恢复码：无法用恢复码找回`（**本机现在就是这个状态**，要先走 §4.1 第②步发第一张码）。

### 4.5 按 L0 重建 L1–L6（安全页 →「按 L0 重建」卡）

1. 预览（需会话）回显：可读原文行数 + 四类取不到原因码分布 + `rebuild_deep_cleared`（不勾 LLM 时会被清空的深层行数）。
2. 有 `view_locked` 行时，**在备份之前就整轮拒绝**——这是有意的：不解密就重建等于凭空丢数据。先在卡内解锁 L0 查阅会话（管理员密码），带 `l0_session_id` 重拉预览。
3. 逐字 `REBUILD` 执行 → 强制双库备份 → 回执（每行只记来源字段、产出层名、计数，**L0 原文与新正文都不进回执/日志/审计**）。
4. 「同时用 LLM 重炼 L2–L6」是显式开关，且要求引擎可用（参数页至少一个引擎「启用 + 拨测通过」）；不勾则 L2–L6 清空并如实记 `refined_by=stub`。
5. `pinned` / `locked` 与取不到原文的行**一行不碰**，只在回执里计数。

## 5. 日志页（日志记录页 → 程序运行日志窗口）中文标签核对表

出现以下任一行都应在「人话」视图里有对应中文标题（原文视图保留 `scope:action` 可 grep）：

| 日志键 | 中文标题 |
|---|---|
| `dataRoot:setup:dirs-set` | 已指定两个库的存放目录 |
| `dataRoot:setup:dirs-canceled` | 库位置未选择，已退出（向导不接受半配置） |
| `dataRoot:setup:library-adopted` | 库文件已核对/补送到指定目录 |
| `dataRoot:setup:l0-password-set` | 首启已设置 L0 管理密码 |
| `dataRoot:setup:set-password-denied` | 首启设密码被拒（本机已设过 L0 管理密码） |
| `dataRoot:setup:wizard-open` | 进入首启向导（设置尚未完成） |
| `dataRoot:setup:wizard-skipped` | 首启设置已完成，直接进入主界面 |
| `dataRoot:setup:done` | 首启向导完成（恢复卡已导出） |
| `kernel:l0:split-backup` | 存量拆分迁移前备份（记忆库 + L0 库 + 密钥环） |
| `kernel:l0:split-backup-fail` | 存量拆分迁移备份失败 |
| `kernel:l0:split-rejected` | 存量拆分迁移被拒（口令不符或未解锁 L0 写密钥） |
| `kernel:l0:split-run` | 存量 L0 原文搬入原数据库完成 |
| `kernel:l0:rebuild-backup` | 按 L0 重建前备份（记忆库 + L0 库 + 密钥环） |
| `kernel:l0:rebuild-backup-fail` | 按 L0 重建备份失败 |
| `kernel:l0:rebuild-rejected` | 按 L0 重建被拒（口令不符或未解锁 L0 查阅会话） |
| `kernel:l0:rebuild-run` | 按 L0 原文重建 L1–L6 完成 |
| `kernel:l0:recovery-issued` | L0 恢复码已生成（旧码当场作废） |
| `kernel:l0:recovery-exported` | L0 恢复卡已导出到文件 |
| `kernel:l0:recovery-export-canceled` | L0 恢复卡未导出（用户取消保存） |
| `kernel:l0:recovery-export-fail` | L0 恢复卡写入失败 |
| `kernel:l0:store-corrupt` | L0 原数据库读不动（原件已改名隔离，本次按空库启动） |

**隐私核对（必做）**：在 `actions.log` 里 grep 自己刚设过的 L0 管理密码片段与恢复码任意 8 位连续字符，**应当 0 命中**。日志只允许出现指纹（8 位散列）与目录/文件名。

## 6. 已知限制与「待用户实机验证」清单（不猜，留给真机）

1. **真实账本一行未动**：本机 1642 行、1641 行明文原样躺在 `memories.db.json`。拆库（SPLIT）、重判（REJUDGE）、清空重采（RESET）、按 L0 重建（REBUILD）都是**不可逆动作，必须由管理员在应用内亲手点**，我没有替用户执行，也不该执行。
2. **E2E 对 `setup.html` 的缺口已补（2026-11-02 补记，见 §8）**：`e2e/setup.spec.ts` 12 例跑在真构建产物上，覆盖向导的**页面侧全部闸门与诚实降级**。**E2E 仍然覆盖不到的**是主进程与真文件那一段——`setupDone` 落盘、主窗口是否真被拦在 `setup.html`、原生「选目录 / 另存为」对话框、真密钥环与 DEK 封装，以及拆库（SPLIT）路径。这些只能靠单测（`dataRoot.test.ts` 20 例 + `SetupPage.test.tsx` 14 例 + `l0*` 各测）与 §4.1 的实机走查，而 §4.1 **尚未走过一遍**——这一段仍是本批次最需要你亲自验的。
3. **四张 L0 卡（拆分 / 重建 / 恢复 / 双库备份展示）从未在真机点过**，只过了组件单测（11 + 12 + 13 例）与 `SecurityPage.test.tsx`（9 例）。§4 的预期回显是从代码与单测推出来的，**不是实机观察**。
4. **红线（卡面、恢复卡正文、`AGENTS.md §9` 三处都写了）：管理密码与恢复码同时丢失 = L0 原数据库不可恢复。** 解密能力没有任何服务端兜底、没有后门、没有万能密钥。
5. 恢复码**一次性**：用过即作废并当场换新码，**新卡必须重新导出**；旧卡用过之后就不作数了，别留旧卡当备份。
6. 拆完库后 `memories.l0.json` 是**唯一的原件副本**。双库备份只保证「这台机器上三个文件都有退路」，**不能替代离线副本**——L0 库、密钥环、恢复卡三者请**分开存放**（都放在同一台机器上等于没分）。
7. 纯浏览器（`npm run dev`）没有主进程 → 向导与四张 L0 卡如实显示不可用，绝不用页面内存对象冒充真文件。
8. 升级上来的老指针**照样进向导**（拍板①），这不是 bug；走完一次之后就再也不进。

## 7. 排障第一入口

- **进不了主界面**：先看是不是向导没走完（`dataRoot:setup:wizard-open` 后没有 `setup:done`）；再确认指针里 `ledgerDir`/`l0Dir`/`setupDone` 三个字段。
- **点「重新生成恢复码」一直失败**：那是管理密码不对（本机 `admin_wrap` 是 11-01 建的）；连续 5 次会锁，等锁定过去或走 §2 第 4 条的「键环改名」退路（**仅限 L0 库里还没有任何信封**这一条前提）。
- **拆分/重建「被拒」**：`actions.log` 里对应 `kernel:l0:split-rejected` / `rebuild-rejected` 的 `reason` 字段就是真因（口令不符 / 没解锁 / `view_locked>0`），不是网络问题。
- **备份只有 `memories-` 一个前缀**：说明 L0 库或密钥环还不存在，回执里会明说缺哪个——不是备份功能坏了。
- 时间一律看 UTC+08:00（日志页已按此时区渲染），审计 `ts` 是 epoch 毫秒。

## 8. 补记（2026-11-02 21:12 UTC+08:00）：`setup.html` 的点击级 E2E 已补上

起因就是 §6 第 2 条自己声明的缺口。新增 [e2e/setup.spec.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/e2e/setup.spec.ts)（12 例），跑在**真构建产物**上（`run.mjs` 先 `vite build`，规格用 `startStatic(0,'dist')` 直接服务 dist）。

**必须先说清的口径**：这套 E2E 栈里**没有 Electron 主进程**——`e2e/harness.ts` 用 CDP 连外部 Chromium，页面拿不到 preload 注入的 `window.api`。所以规格分两类，各自证明的东西不同：

| 类别 | 用例 | 真实执行的代码 | 桩/无桩 |
|---|---|---|---|
| 诚实降级 | `setup.html` 真产物只给「纯浏览器模式」说明、三步卡片与「完成设置」一个都不渲染；宿主只有半个 `api`（`setup` 里没方法）时同样如实报「首启进度读取失败」并禁用 finish | `hostBridge.hostCapability()` 真判定 + 打包后 `SetupPage` 的降级分支 | **不打桩**（这条最有价值：证明纯浏览器不假装设置成功） |
| 向导主流程 | 三步进度严格来自 `setup:state`；密码 ≥8 位且两次一致才可提交；设密码→恢复码只在这一屏出现一次→导出→finish **真导航**；导出点取消；已设密码分支（只给重新发码、不再出现设密码表单）；重新发码→导出→进入应用；密码错原样显示；已设密码时直接敲 `setL0Password` 通道被拒；改选目录点取消；三步看着都完成但 `setup:finish` 被拒→停在向导页 | dist 里的 `SetupPage` + `desktop/hostBridge` 的 **native 调用链**（`CHANNEL_TO_NATIVE` 六条 `setup.*` 映射、参数透传、每步后的 `refresh` 重拉、`setupEntry` 未注入 `onNavigate` 时那次真 `window.location.replace`） | 打桩 `window.__ELECTRON__` + `window.api.setup.*`，桩逐条镜像 `main.ts` §6e 的真返回与状态机（`admin_wrap` / `pendingRecoveryCard` / `recoveryCardExported`），四条拒绝文案常量与源码逐字对齐——源码改了这里会红 |

**桩证明不了的部分（别把绿当验过）**：`setupDone` 真的落盘、主窗口是否真被 `isWizardIncomplete()` 拦在 `setup.html`、原生「选目录 / 另存为」对话框、真密钥环与 DEK 封装、两个库文件真的被创建、以及 SPLIT/REBUILD 路径。这些仍归 §4.1 的实机走查。

**防「永远绿的测试」——变异验证（实测）**：把 `SetupPage.tsx:330` 的闸门 `disabled={!(step1Done && step2Done && step3Done) || busy}` 临时改成 `disabled={busy}` 重跑 → **12 例里 6 失败**；改回原样再跑 → 12/12 通过（该行已 grep 确认复原）。

**本轮门禁实测**：`node e2e/run.mjs e2e/setup.spec.ts --workers=1` → 12 passed (3.9s)；**`npm run verify` 全绿**（typecheck → oxlint → 索引 301 文件 → vitest 143 files / 1624 tests，覆盖率 81.01 / 73.15 / 77.11 / 84.09 → `build:electron` → Playwright **106 passed (35.3s)**，原 94 + 新增 12）。

**没有重新打包**：本轮只新增 `e2e/` 测试与文档，`src/` 一行未变（变异那两处改动已复原并复核），安装包内容字节不变，所以 §0 的 116.38 MB / `97D9606A…2CDEEB22` 仍然有效。要一份新的 SHA256 随时说，`npm run package` 即可。
