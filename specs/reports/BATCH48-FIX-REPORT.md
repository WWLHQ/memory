# 批次48 审计修复收尾报告

日期：2026-11-06　分支：`main`　远端：`origin git@github.com:WWLHQ/memory.git`

## 1. 提交与推送记录

| 序号 | 提交 | 范围 | 推送结果 |
| --- | --- | --- | --- |
| 1 | `02cbec4` | A7–A18（63 文件，+2513/−405） | `f20e63f..02cbec4 main -> main` 成功 |
| 2 | `6edf6c8` | A16（22 文件，+409/−91） | `02cbec4..6edf6c8 main -> main` 成功 |
| 3 | `6c0a2b0` | A21（E2E 断言修正） | `6edf6c8..6c0a2b0 main -> main` 成功 |
| 4 | 本报告 | A22（收尾） | 见推送回报 |

无 force push，无改动远端配置；每次推送前先 `git fetch origin main` 确认未落后。

**偏差说明**：A7–A18 在“禁止 commit”期间交错修改同一批文件（`server.ts`、`main.ts`、`memories.ts` 及测试），无法事后拆成可独立编译的原子提交，故合为一个提交，body 内逐项列出动作与闸门证据；A16、A21、A22 各自独立提交。

## 2. 逐动作改动与闸门证据

闸门定义：A = 影响面回归（相关测试 + typecheck + lint + 索引重建/校验）；B = 真实链路验证；C = 变异验证（破坏修复后对应验证必须失败）。

| 编号 | 修复内容 | A 证据 | B 证据 | C 证据 |
| --- | --- | --- | --- | --- |
| A7 | `putMemory` 跨租户归属校验（HTTP 403 + 审计，IPC 注入会话） | storageIpc/server 相关测试通过；typecheck/lint/索引通过 | 越权请求被拒并落审计 | 去掉校验后越权用例失败 |
| A8 | mirror 账本 `prev_hash/hash/sig` 链式 HMAC（0600 密钥、fail-closed、GET integrity） | mirrorLedger 单测通过 | 篡改条目 integrity=false | 篡改检测被移除后测试失败 |
| A9 | 账号文件损坏 fail-closed（备份 `.corrupt-<ts>`，不播种默认管理员，503） | server 账号测试通过 | 损坏文件下登录/注册 503，health 暴露状态 | 回退播种默认管理员后测试失败 |
| A10 | 密码策略持久化（`home-policy.json`，注册/改密真实校验，仅 admin 可改） | policy 相关测试通过 | 注册/改密按策略拒绝；安全页读写真实值 | 跳过策略校验后测试失败 |
| A11/A19/A20 | request_id 真实化（首页保留真实 id、裁决页 `kernel_request_ids[0]`、生命周期不预生成/不覆盖 toast、TraceRef 无链路标注） | dashboard/audit 相关测试通过 | 真实审计链路 id 回填 | 伪造 id 回归后测试失败 |
| A12/A15 | 生长页 `avg_cost_samples` 真实采样；监控 `pendingReview` 真实冲突数 | growth/monitor 测试通过 | 写入审计 `cost_ms` 采样可见 | 用固定假值回归后测试失败 |
| A13/A14 | 反馈评分/注释落审计并读回；内联归因取最近 write 审计 | feedback 相关测试通过 | 评分写入后重载可见 | 不出现在审计时测试失败 |
| A17/A18 | 参数四项普通配置真实生效（半衰期覆盖/到龄归档/exemptAll/6h 调度）；写入页策略预览改由 `policyFor()` 生成 | 11 文件 133 用例；typecheck/lint/索引通过 | 保存后调度行为改变；预览值 = 内核真源 | C1–C4 四项变异均被捕获 |
| A16 | 反代理单价/日配额改为参数页可配置并真实持久化；移除 `0.01/100000` 占位数字；未设置如实显示 | 11 文件 169 用例；typecheck/lint/索引 338 文件通过 | 参数页保存 → 快照 → `coreLoadSources`/内核 provider 回读生效 | 3/3 捕获（占位数字回归、配额 null 返 0、保存未下发内核） |
| A21 | 覆盖率基线 + 真实浏览器 E2E | typecheck/lint/索引通过 | `npm run test:e2e` 全量 107 passed | 租户改回 `user_001`、密码策略误拒均被 E2E 捕获 |

### A16 口径说明

- 云端厂商无可用真实计费接口 → 不做占位：单价（¥/千次）与日配额（次/日）由参数页填写，随 preference 参数快照持久化，刷新/重启后仍在。
- 未填写 → 页面显示「未设置」，该云端源不进入自动路由；本地端点按定义记 0 元 / 不限量。
- 消费端三处同口径：`models/coreModels`、`web/hostLlm`、`electron/llmGateway`（main 启动与 params 写入后刷新）。

## 3. 全量基线（A22）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 全量测试 | `npx vitest run --pool=forks --maxWorkers=1` | 195 文件 / 2361 用例全部通过，退出码 0 |
| 类型检查 | `npm run typecheck` | 0 error |
| Lint | `npm run lint` | 0 warning / 0 error（581 文件、123 规则） |
| 演示标识扫描 | `npm run check:no-demo` | 通过（332 文件 / 21 判据 / 0 白名单） |
| 代码索引 | `node tools/code-index.mjs --check` | 最新（338 文件） |
| Web 构建 | `npm run build` | 成功 |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` built OK（`import.meta` esbuild 警告为存量提示） |
| E2E | `npm run test:e2e` | 107 passed（1 worker） |
| 覆盖率 | `npx vitest run --coverage --pool=forks --maxWorkers=1` | Statements 83.16% / Branches 76.42% / Functions 80.58% / Lines 86.14% |

## 4. 打包产物（Windows 桌面端）

- 命令：`$env:CI='false'; npm run package`（仓库既有脚本：build → build:electron → prepare-electron-dist → electron-builder）
- 退出码：0
- 产物：`release\installer\MultiAgent Memory-0.1.0-setup.exe`
- 体积：122,210,524 字节（约 116.55 MiB）
- SHA256：`778659480F4B431677F8A885265CA898F3A4DA74099BAE4C41C3FC3FA9ACA0BD`
- 附带：`MultiAgent Memory-0.1.0-setup.exe.blockmap`、`latest.yml`、`win-unpacked`

### 打包过程中的 warning / 限制

1. 首次 `npm run package` 退出码 1：electron-builder 依据 CI 环境触发隐式发布，报 `GH_TOKEN is not set`。安装包本身已在该次构建完成；关闭 CI 隐式发布（`CI=false`）后重跑得到退出码 0，产物收口到 `release\installer`。
2. 未配置代码签名证书（`no code signing certificate configured, signing is skipped`），安装包未签名，Windows 可能提示未知发布者。
3. `package.json` 缺少 `author` 字段（electron-builder 提示，未阻塞）。
4. 依赖重复引用警告：`pg@8.23.1`（未阻塞）。
5. 旧安装包目录清理受 Windows 目录句柄占用（EPERM）：5 个历史 `release\installer-*` 目录未删除，不影响本次产物。

## 5. 已知环境性 flaky（非代码缺陷）

- 覆盖率运行以退出码 1 结束：`mcp.test.ts` 所在 worker 原生崩溃（exit 3221226505 / 0xC0000409）。同一文件在无覆盖率插桩下单独复跑 54/54 通过，全量无插桩运行 2361/2361 通过，判定为覆盖率插桩触发的 Windows worker 崩溃。

## 6. 遗留与建议

- 无未修复的审计项。A16 的真实厂商单价/余额需接入各厂商计费 API 后才能替代手工配置（当前按用户决策使用可配置项）。
- 建议后续：配置代码签名证书；补齐 `package.json` 的 `author`；排查 `pg` 重复依赖来源。
