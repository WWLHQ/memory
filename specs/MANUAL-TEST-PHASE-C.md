---
status: done
---

# 手动测试报告 · Phase C（接真 / 去假）

- 日期：2026-10-30
- 分支：main（未提交；工作区状态见文末）
- 产物：`release/win-unpacked/MultiAgent Memory.exe`（10:02 重新打包，Electron 45.1.0）
- 数据目录：`%APPDATA%\MultiAgent Memory`（日志 `main.log`）
- 冒烟实例：当前保持运行（PID 7768，10:06 启动），可直接手动点验；重新打包前请先关闭
- 关联报告：`specs/MANUAL-TEST-PHASE-A.md`、`specs/MANUAL-TEST-PHASE-B.md`

## 1. 本轮改了什么（C1–C3）

| 项 | 内容 |
| --- | --- |
| C1 精炼诚实化 | `Memory.refined_by: 'stub' \| 'llm'`；未接入 LLM 时写管线只产出 L1（清洗脱敏），不生成 L2–L6 占位文本；分层页/记忆表标「未精炼」；L2–L6 查阅只返回 `refined_by='llm'` 的记录 |
| C2 真拨测 / 真密钥 | `AgentOnboardService` 支持注入 `AgentProbe`；服务器默认使用 `createHostAgentProbe()`（CLI/安装目录/开始菜单/配置/卸载注册表五路真探测）。测通成功只认探测命中；失败返回真实原因并写 `lastTest`，卡片由 CONNECTED 回落 DEGRADED，不再滞留「已连通」。轮换密钥生成 `mam_sk_`+48 hex 真随机键（仅内存/持久化卡片，审计只落末 4 位） |
| C3 模型配置真落盘 | 新增 `src/web/models/modelConfig.ts`（localStorage `mam.modelConfig.v1`，API Key 明文不落盘）。保存后：写入配置 → 维度变化时按新维度重嵌入全部记忆 → 重建全局内核（`rebuildKernelFromModelConfig`）→ 记 `param_save` 审计。内核 `getKernel`/`createKernelOnSameStorage` 按落盘维度构造 `JsVectorBackend`；`cosine` 对维度不一致返回 0；移除页面级旧内核缓存。**「模拟」改为 dry-run**：不写账本、不扣额度；向量卡「连通测试」改为真嵌入探测，云端未接入一律「未验证」；删除伪造的重建进度动画 |
| 测试 | 新增 `coreModels.test.ts`（9）、`ModelsPage.test.tsx`（3）；更新 `e2e/models.spec.ts`（8 条全部改为当前真实语义） |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **88 文件 / 775 用例全过** |
| Web 构建 | `vite build` | 19 个 HTML 入口构建成功 |
| Electron 构建 | `node tools/build-electron.cjs` | `main.cjs` / `preload.cjs` 构建成功 |
| 总门禁 | `npm run verify` | 退出码 0 |
| 模型页浏览器 E2E | `npm run test:e2e -- e2e/models.spec.ts` | **8/8 通过**（含保存后刷新仍生效、dry-run 不写账本） |

已知非阻塞告警：esbuild 对 `src/agentOnboard/server.ts` 的 `import.meta` 在 CJS 下告警；该处走 `typeof __dirname !== 'undefined'` 分支，CJS 部署不会执行 `import.meta` 分支，属无害告警。

## 3. 打包与启动冒烟（本轮实机）

启动方式（PowerShell 清除本 shell 的 `ELECTRON_RUN_AS_NODE` 后直接运行 exe；资源管理器双击不受影响）：

```powershell
$env:ELECTRON_RUN_AS_NODE=''
& 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\win-unpacked\MultiAgent Memory.exe'
```

| 检查点 | 期望 | 实测 |
| --- | --- | --- |
| 进程启动 | 主进程存活 | PID 7768，10:06:42 启动 |
| 启动完成 | `bootstrap:done` | 已记录（10:06:45） |
| 端口 | 8200–8204 全部 LISTENING | 5/5 通过（归属 PID 7768） |
| 首轮采集 | 延迟 10s 后执行并落盘 | 10:06:55 开始，10:06:58 完成：`collected:50, deduped:2134, skipped:8` |
| 接入服务 | `GET :8200/agents` → 200 | 200 |
| 镜像账本 | `GET :8201/api/mirror/audit` → 200 | 200 |
| Origin 收口 | 恶意 Origin 返回 403 | 8200 / 8201 均为 403 |
| 调试残留 | 不生成 exe 目录新 `debug.log` | 未新增（目录内仅有 10-29 旧文件，时间戳未变） |

## 4. 本轮手动测试用例（Phase C 验收）

### C1 精炼诚实化

| # | 操作 | 期望 |
| --- | --- | --- |
| C1-1 | 写入页提交一条全新记忆 | 回执显示「精炼 未精炼（未接入 LLM）」；不生成 L2–L6 任何摘要 |
| C1-2 | 打开分层记忆页，查看该条 L1–L6 | L1 有清洗脱敏内容；L2–L6 显示「该层暂无内容」；记忆表该行标「未精炼」 |
| C1-3 | 检索页召回该条 | 可凭 L1 内容命中；不出现伪造摘要/占位层 |

### C2 AgentOnboard 真拨测与真密钥

| # | 操作 | 期望 |
| --- | --- | --- |
| C2-1 | 接入页执行「一键接入」/ 本机检测 | 只有本机真实命中安装痕迹的 Agent 标「已连通」；未命中不建"已连通"卡，来源标注「宿主真扫 / 内核模拟降级」 |
| C2-2 | 对一台**未安装**的 Agent 卡片点「测通」 | toast 报失败并带真实原因；卡片状态变为「降级（仅补偿）」，告警框显示「最近一次真实拨测未通过：…」；**不得**显示「已连通」 |
| C2-3 | 对任意卡片点「轮换密钥」→ 重启应用 | 首次轮换成功；Key 掩码带「（新）」，重启后仍为已轮换（卡片持久化）；审计只有末 4 位，无明文 |
| C2-4 | 停掉本机服务后访问接入页 | 页面走后端镜像降级，不伪造连通/审计数据 |

### C3 模型配置真落盘 / dry-run

| # | 操作 | 期望 |
| --- | --- | --- |
| C3-1 | 模型页把向量切到 `bge-m3` | 确认弹窗提示「1024 维 / 重嵌入 N 条 / 估时」；选择后维度显示 1024；保存前不出现伪造的进度动画 |
| C3-2 | 点「保存 model_config」→ 刷新页面 | toast「已保存 model_config … 已持久化 · 重嵌入 N 条」；刷新后仍为 bge-m3 / 1024 维 |
| C3-3 | 保存后到写入页新增一条记忆，再回检索页召回 | 正常入库并可命中（新旧记忆同为 1024 维，不出现维度不一致零分） |
| C3-4 | 点「模拟一次代理调用（dry-run · 不写账本）」 | toast 以「dry-run（未写账本）」开头；命中免费源 claude-code；审计回显不新增条目；反代理余量不变 |
| C3-5 | 向量卡「连通测试」：本地 st / 云端 ds（不填 Key / 填 Key） | 本地：通过，文案注明「JsVectorBackend · hash 起步实现 · 384 维；权重尚未加载」；云端两种均「未验证：云端嵌入通道尚未接入」，**不得**报通过 |
| C3-6 | price_cap=0 → manual 勾选 codex 后模拟 | 显示仅免费提示；toast「R7 拒绝 …」且为 dry-run，不写账本 |

## 5. 回归清单

按 Phase A/B 报告执行：首页 / 记忆 / 写入 / 审计 / 生命周期 / 争议 / 参数 / 监控 / 反馈 / 安全 / 检索 / 日志 / 模型 / 成长 / 层级 15 个视图 + 接入页 + 浮窗。重点：

- 浮窗归因写入后，内联归因页可见同一条记录；
- 记忆页 `.rid` 溯源可打开（Home mirror 账本）；
- 安全页变更写入 `security_change` 审计；
- 关闭主窗后进程与 8200–8204 全部退出。

## 6. 已知问题 / 边界

- `e2e/app.spec.ts` 仍指向已退役的静态原型 DOM（`#cards/#found`），对当前 React 接入页 7 条用例失败（本轮实测）。当前接入页已由 `src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx`（页面级，含"断开后测通不得 CONNECTED"）与 `src/agentOnboard/__tests__/server.test.ts`（HTTP 级，含重启密钥持久化/拨测失败）覆盖，且全绿；该 e2e 文件待后续按 `data-testid` 重写。
- 向量模型名（st/bge-m3/deepseek-embed）目前只作为维度/部署声明；实际嵌入统一由 `JsVectorBackend` hash 起步实现执行，UI 已如实标注「权重尚未加载 / 云端通道尚未接入」。
- 内核 LLM 仍为显式 stub 装配点：写入管线按 19.8 记录路由审计（免费源），但不产生 L2–L6；模型页"已用次数/当日花费"由账本 `llm_proxy` 明细实算，不注入演示数字。
- 采集器账户仍为本地单账户（u1/t1/e1），未接真实登录；旧数据目录 `%APPDATA%\multi-agent-memory` 不做自动迁移。

## 7. 版本控制状态（本轮执行）

- 新增并已暂存（未提交）：`src/agentOnboard/probe.ts`、`src/web/models/modelConfig.ts`、`src/web/models/__tests__/coreModels.test.ts`、`src/web/models/__tests__/ModelsPage.test.tsx`
- 工作区统计：`83 A`（新增已暂存）、`11 AM`、`165 M`、`14 D`、`1 RM`
- 未执行 `git commit` / `git push`。
