# 手动测试报告 · Phase D（内核正确性收口）

- 日期：2026-10-30
- 分支：main（未提交；工作区状态见文末）
- 产物：`release/win-unpacked/MultiAgent Memory.exe`（11:29 重新打包，Electron 45.1.0）
- 数据目录：`%APPDATA%\MultiAgent Memory`（日志 `main.log`）
- 冒烟实例：当前保持运行（PID 24984，11:29:31 启动），可直接手动点验；重新打包前请先关闭
- 关联报告：`specs/MANUAL-TEST-PHASE-A.md`、`MANUAL-TEST-PHASE-B.md`、`MANUAL-TEST-PHASE-C.md`
- 演练脚本（不提交，`.data/` 已 gitignore）：`.data/drill-entry.mts` → `.data/drill-run.mjs`

## 1. 本轮改了什么（D1–D5）

| 项 | 内容 |
| --- | --- |
| D1 merge | 合并写不再沿用旧摘要：总是按合并后内容重算 embedding / sha256；stub 模式重算 L1 并清空旧 L2–L6（不留假摘要），真实 LLM 才重建全部层；加密记忆合并不写 `content_orig` 明文，仅在同密码可解密时重加密 L0，解密失败保留旧密文；返回与审计带 `refined_by` |
| D2 sync | 上行结果新增 `behind`：因果落后 / 远端 LWW 胜时本地 version、pending、正文一律不动，等下行覆盖；`conflict` 同样不动本地，裁决后下行 + 重试收敛；删除改为墓碑（清正文/L0/层/向量，版本 +1，`pending_sync`），`getMemory`/默认列表隐藏墓碑，同步用 `include_deleted` 传播；墓碑不参与跨 mem_id 的 sha 幂等（多个删除可分别入账）；**演练补强**：`syncDown` 对墓碑以中枢为准（见 §3.1） |
| D3 存储 | `FileStorage` 仅在 ENOENT 时视为空库；JSON 解析失败 / 结构非法 → 原件改名备份 `<db>.corrupt`（已存在则 `.corrupt.N`）并抛 `StorageCorruptError(E_STORAGE_CORRUPT)`；端壳 `handleBootFailure` 弹窗显式报错并退出，绝不静默清空；下次启动为全新空库 |
| D4 采集器 | 游标改为字节偏移 + 前缀 sha（`v:2`），中文多字节不再漂移；只消费完整行 / 完整 zstd frame，单文件与全局限流都停在边界（下轮续采）；前缀指纹不一致 / 文件截断 / 旧版字符游标 → 单文件重置重扫（去重防重复入库）；zstd frame 结构完整性校验，避免 Node 对截断帧静默返回空串丢消息 |
| D5 GC | `coreGc` 只委托 `forgetting.classifyLayer`（17.7 固定天数单一衰减引擎）；半衰期统一在 `freshnessOf` 解析：显式 `half_life_days` 优先，否则 category policy；pinned/locked 豁免同源；重复 GC 不连续降档 |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **89 文件 / 793 用例全过** |
| 总门禁 | `npm run verify` | 退出码 0（类型检查 + 测试 + Web 构建 + Electron 构建） |

新增/强化的回归（与本轮验收一一对应）：

- `__tests__/merge.test.ts`（新增 5 例）：stub 合并重算 L1/embedding/sha256 并清空 L2–L6；LLM 合并重建 L1–L6；同密码加密合并重加密 L0 且无 `content_orig`；不带密码不落明文；错密码保留旧密文。
- `__tests__/sync.test.ts`（17 例，新增 4 例）：conflict/behind 本地不动 + resolve 后下行重试收敛；双墓碑传播 + 对账不重复补单；**resolve 抬版本后墓碑仍下行**（§3.1 回归）。
- `__tests__/fileStorage.test.ts`（12 例）：损坏 JSON / 非法结构 → `E_STORAGE_CORRUPT` + `.corrupt` 备份保留原件，重启空库；序号备份。
- `__tests__/sessionCollector.test.ts`（27 例）：中文字节游标、半行、等长重写、截断、zstd 不完整帧、v1 游标重置、单文件/全局限流停在行/帧边界。
- `__tests__/memop.test.ts`：删除断言墓碑字段 + 向量移除。
- `__tests__/contract.test.ts`：GC 用例改为 17.7 固定天数语义。
- `__tests__/pgSyncHub.test.ts`：因果落后 / 远端 LWW 胜的期望改为 `behind`。

已知非阻塞告警：esbuild 对 `src/agentOnboard/server.ts` 的 `import.meta` 在 CJS 下告警（`typeof __dirname !== 'undefined'` 分支保护，CJS 部署不会执行该分支），与 Phase C 相同。

## 3. 双端同步演练（真实内核）

同步引擎当前只有内核入口、没有 UI 按钮（桌面端 ↔ 中枢 ↔ Web 端由内核 `syncUp/syncDown` 驱动）。本轮用真实模块做等价演练：`FileStorage`（桌面）+ `FileStorage`（Web）+ `PgSyncHub`（PGlite 持久化中枢）。

复现命令（仓库根目录）：

```bash
npx esbuild .data/drill-entry.mts --bundle --platform=node --format=esm \
  --outfile=.data/drill-run.mjs --external:@electric-sql/pglite
node .data/drill-run.mjs
```

实测结果：**30/30 通过**（数据目录 `.data/drill-d`，可整目录删除后重跑）。

| 阶段 | 覆盖 | 结果 |
| --- | --- | --- |
| D1 合并/加密（7 项） | 相似内容合并；stub 只落 L1 且清空 L2/L3；sha256/embedding 重算；`content_orig` 含新旧；加密合并无 `content_orig`；L0 重加密含新旧 | 通过 |
| D2 首推/下行（6 项） | 桌面 applied=2；Web 首次下行 pulled=2；Web 内容=桌面合并结果；桌面二推 applied=2/behind=0；Web 增量下行 pulled=2；内容收敛 | 通过 |
| D2 冲突/裁决（6 项） | 并发同时间戳 → conflict 挂 1 条；本地 version/pending/正文不动；resolve 后下行落地胜者；pending 清除；重试无冲突 | 通过 |
| D2 墓碑/behind（5 项） | 删除后本地隐藏；墓碑上行被采纳；Web 下行后不可见；Web 本地保留墓碑记录；因果落后直推 → `behind` | 通过 |
| D5 GC（2 项） | hot >3 天 → warm（单一引擎）；衰减类写入正确 | 通过 |
| D3 损坏库（3 项） | 抛 `E_STORAGE_CORRUPT`；`.corrupt` 备份保留原文；原路径不留存（下次空库） | 通过 |
| P8 中枢持久化（1 项） | 重启后镜像/墓碑仍在 | 通过 |

### 3.1 演练发现并修复的问题

演练在「先 resolve（胜者版本被抬高）→ 另一端删除」的组合下发现：墓碑镜像版本低于 Web 本地版本，`syncDown` 的版本比较直接跳过，删除无法传播（3 项断言失败）。已修复：`syncDown` 对墓碑以中枢为准（`m.deleted && !existing?.deleted` 时无条件落盘），并新增 `sync.test.ts` 回归用例「resolve 抬高胜者版本后，另一端的删除墓碑仍能下行」。修复后演练 30/30、全量测试 793/793。

## 4. 打包与启动冒烟（本轮实机）

启动方式（PowerShell 清除本 shell 的 `ELECTRON_RUN_AS_NODE` 后直接运行 exe；资源管理器双击不受影响）：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\win-unpacked\MultiAgent Memory.exe'
```

| 检查点 | 期望 | 实测 |
| --- | --- | --- |
| 进程启动 | 主进程存活 | PID 24984，11:29:31 启动 |
| 启动完成 | `bootstrap:done` | 已记录（11:29:31） |
| 端口 | 8200–8204 全部 LISTENING | 5/5 通过（归属 PID 24984） |
| 首轮采集 | 延迟 10s 后执行并落盘 | 11:29:41 开始，11:29:44 完成：`collected:50, deduped:1, skipped:10` |
| 接入服务 | `GET :8200/agents` → 200 | 200 |
| 镜像账本 | `GET :8201/api/mirror/audit` → 200 | 200 |
| Origin 收口 | 恶意 Origin 返回 403 | 8200 / 8201 均为 403 |
| 调试残留 | 不生成 exe 目录新 `debug.log` | 未新增（目录内仅 10-29 旧文件，时间戳未变） |
| 启动致命错误 | 无 `bootstrap:fatal` | 0 条 |

D4 运行时佐证：本轮首扫 `deduped:1`（不再整库重采），游标文件 270 个条目中已有 6 个迁移为 `v:2`（字节偏移 + 前缀 sha），其余 264 个 v1 字符游标待逐步一次性重扫迁移（活跃会话文件每轮吃满 50 条上限，空闲轮次继续迁移；重扫内容经去重不会重复入库）。

## 5. 本轮手动测试用例（Phase D 验收）

### D1 合并重算 / 加密不落明文

| # | 操作 | 期望 |
| --- | --- | --- |
| D1-1 | 写入页连续提交两条高度相似的记忆 | 第二次回执为「合并」；分层页该条 L1 含新旧内容；不出现旧的 L2–L6 摘要 |
| D1-2 | 合并后到检索页召回 | 能命中最新 L1 内容（embedding/sha 已随内容重算，不出现旧向量召回偏差） |
| D1-3 | 勾选密码写入一条，再合并一条相似内容（同密码） | 合并成功；L0 可解密且含新旧内容；记忆库中该条无 `content_orig` 明文（可查 `%APPDATA%\MultiAgent Memory\memories.db.json`） |
| D1-4 | 带错密码合并加密记忆 | 合并正文正常、旧 L0 密文保留；不产生明文 `content_orig` |

### D2 同步收敛 / 删除传播

| # | 操作 | 期望 |
| --- | --- | --- |
| D2-1 | 运行 §3 演练命令 | 30/30 通过；重点看 `D2 冲突后本地 version/pending/内容原样`、`D2 Web 下行后墓碑不可见` |
| D2-2 | 演练后查看 `.data/drill-d/hub` 与两端 `memories.db.json` | 中枢镜像保留墓碑；Web 本地墓碑不可见但 `include_deleted` 可查 |
| D2-3 | 页面正常写入/删除后看审计 | 写入/删除/同步审计各按真实动作落账，无新增「模拟同步」 |

### D3 损坏库显式报错

| # | 操作 | 期望 |
| --- | --- | --- |
| D3-1 | 关闭应用，备份 `%APPDATA%\MultiAgent Memory\memories.db.json`，把原文件改成 `{`（非法 JSON），再启动 | 弹出错误框：「本地记忆库损坏，无法读取：…（原件已备份到 ….corrupt）」；进程退出 |
| D3-2 | 检查数据目录 | 存在 `memories.db.json.corrupt`（内容为损坏原文）；原 `memories.db.json` 不存在 |
| D3-3 | 再次启动 | 正常启动为空库（不静默删数据）；测试后可用备份恢复 |

### D4 采集器游标/边界

| # | 操作 | 期望 |
| --- | --- | --- |
| D4-1 | 启动应用看 `main.log` 首扫 | `collected` 受 50 上限约束；`deduped` 只统计重复，不出现整库重复入库 |
| D4-2 | 查看 `%APPDATA%\MultiAgent Memory\collector-cursor.json` | 已迁移条目含 `v:2`、字节 `offset`、`contentSha`；限流停采的 markdown 条目含 `msgIndex`（下轮续采） |
| D4-3 | 运行 `npx vitest run src/core/memagent/__tests__/sessionCollector.test.ts` | 27 例全过（中文多字节、半行、等长重写、截断、zstd 不完整帧、v1 重置、限流边界） |

### D5 GC 单一衰减引擎

| # | 操作 | 期望 |
| --- | --- | --- |
| D5-1 | 生命周期页触发 GC（或运行契约用例） | 只按 17.7 固定天数降档；pinned/locked 不动 |
| D5-2 | 连续触发两次 GC | 第二次 `decayed=0`（不连续降档） |
| D5-3 | 运行 `npx vitest run src/core/memagent/__tests__/contract.test.ts` | 12 例全过（含 GC 单一引擎 + sync 版本冲突） |

## 6. 回归清单

按 Phase A/B/C 报告执行：首页 / 记忆 / 写入 / 审计 / 生命周期 / 争议 / 参数 / 监控 / 反馈 / 安全 / 检索 / 日志 / 模型 / 成长 / 层级 15 个视图 + 接入页 + 浮窗。重点：

- 写入 → 检索闭环正常；合并回执如实；
- 删除后记忆页不可见；审计有删除记录；
- 浮窗归因写入后内联归因页可见；
- 安全页变更写入 `security_change` 审计；
- 关闭主窗后进程与 8200–8204 全部退出。

## 7. 已知问题 / 边界

- 同步引擎尚无 UI 入口（本轮验收用真实内核脚本演练）；后续接 UI 时按 §3 同样步骤点验即可。
- 采集器 v1 字符游标仍余 264 个，按活跃度逐步迁移；每次迁移对单文件一次性重扫（去重保证不重复入库）。
- 墓碑下行以中枢为准（D2 补强）：只要中枢已是删除态，本地未删除副本会被墓碑覆盖——这是删除传播的确定性语义。
- e2e/app.spec.ts 仍指向已退役的静态原型 DOM（Phase C 遗留，非本轮引入）。
- 向量模型名（st/bge-m3/deepseek-embed）只作维度/部署声明；实际嵌入统一由 `JsVectorBackend` hash 起步实现执行，UI 如实标注。
- 内核 LLM 仍为显式 stub 装配点：stub 下 merge 只重算 L1 并清空 L2–L6（不伪造摘要）。

## 8. 版本控制状态（本轮执行）

- 已暂存（未提交）：`src/core/memagent/{memories,sync,pgSyncHub,fileStorage,sessionCollector}.ts` 与对应 7 个测试文件（含新增 `__tests__/merge.test.ts`），以及本报告。
- 工作区统计：`86 A`（新增已暂存）、`11 AM`、`168 M`、`14 D`、`1 RM`。
- 演练脚本与数据均在 `.data/`（gitignore），不进仓库。
- 未执行 `git commit` / `git push`。
