---
status: done
---

# 批次 28 手动测试报告 —— web 端连接桌面数据库 + 三客户端自动接入再审查 + 无 LLM 的 L2–L6 自动清理

- 日期：2026-10-31
- 范围：① 28-A 浏览器数据面接真（回答「web 端打开什么数据都没有」）；② 28-B WorkBuddy / Zcode / deepseek harness 一键自动接入 MCP 再审查（禁止让用户手工配置）；③ 28-C 无 LLM 时 L2–L6 层数据清查与启动自动清理
- 原则：与前批一致；诚实偏差与残留已固化在 `AGENTS.md` §9（批次28 / 28-B / 28-C 三条）

## 1. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,990,135 B（116.33 MiB） |
| SHA256 | `AD3C286C0E6717F2FA1C3C4F5ABF7CFB8BCB2E717E8720BD94A9A78DDF3D71A3` |
| 清理 | `release/` 只留最新 `installer/` 一份；本次 `release/installer` 被外部进程占用（EPERM）→ 输出到时间戳目录 → 构建成功后复制+删除收口回固定目录（批次21 口径），时间戳目录已删 |

## 2. 改动清单（按主题提交）

| 提交 | 主题 |
|---|---|
| `9a81043` | 28-A 浏览器数据面接真（写锁 / HTTP 内核端点 / HttpStorageBackend / 三态账本 / dev 镜像 / E2E 同构） |
| `075c6d6` | 28-B 三客户端自动接入再审查（宿主继承 / 动态检出 / 诚实手工） |
| `2fc7f41` | 28-C 无 LLM 的 L2–L6 启动自动清理（含 28-A 主进程接线） |
| `7c6cf48` | 批次28 文档（AGENTS §9 / code-map / 索引） |

### 28-A web 端连接桌面数据库（浏览器数据面接真）

**web 端逻辑（三态账本）**：
1. **Electron 桌面壳内**：页面走 IPC 数据面直连主进程 FileStorage（原行为不变）。
2. **纯浏览器（`npm run dev`）+ 已登录**：页面经 `POST /api/kernel/invoke`（会话门禁 + 六方法白名单 putMemory/getMemory/listMemories/deleteMemory/appendAudit/queryAudit）直连**真实桌面账本** `memories.db.json`——打开页面就有真实数据，不再是空账本。
3. **纯浏览器未登录**：进程内空账本（登录成功 `rebuildKernelForDataPlane()` 立即切换到真实账本）。

实现要点：
1. **FileStorage 建议性写锁**（`<db>.lock` O_EXCL + pid 存活探测）：桌面端持锁是**唯一写者**；dev 后端 / 第二个进程自动降级**只读镜像**（写入诚实报 `E_STORAGE_LOCKED`，文案指向桌面端或 MCP 写入）；陈旧锁（pid 已死）自动回收；`readonly` 选项永不抢锁；`reloadOnMtime` 让镜像随账本文件变化自动重载。
2. **home server 内核数据面**：`POST /api/kernel/invoke`（会话校验 + 方法白名单 + `appendAudit` 形状校验，校验实现抽 `src/shared/auditShape.ts` 与 IPC 数据面同口径）+ `GET /api/kernel/info`（账本可用性/只读态/路径）；结果统一 `{ok, result|error}` 信封。
3. **渲染层**：新 `src/web/httpStorage.ts`（HttpStorageBackend，无会话/不可达/401/501 → `KernelUnavailableError`）；`kernel.ts` 三态选择；约 15 个页面 core 加载器统一改走 `getKernelStorage()`。
4. **dev 后端**：`tools/dev-backend.mjs` 以只读镜像挂真实数据根账本（data-root.json 指针定位，绝不抢桌面端写锁）。
5. **E2E 生产同构**：`e2e/servers.ts` 的 home 后端默认挂内核；overview spec 改真实 admin 登录会话（伪造会话 id 会被会话门禁 401——这正是数据面安全模型的证明）。

### 28-B WorkBuddy / Zcode / deepseek harness 自动接入再审查

| 客户端 | 结论 | 自动化程度 |
|---|---|---|
| deepseek harness | MCP 由宿主 Qoder 下发（无独立配置面）→ **宿主继承**：宿主已接入即显示已接入；一键接入委托写入 Qoder 配置后本客户端自动接通 | ✅ 全自动（委托宿主） |
| WorkBuddy | 连接器配置 `~/.workbuddy/connectors/<企业ID>/mcp.json` **自动检出**（`dynamicConfigGlob`）；但文件由应用托管并跨设备同步，**绝不代写**（写入会被同步覆盖） | ⚠️ 自动检出 + 手工确认 |
| Zcode | 实机排查配置全树无 MCP 段，自动写入无落点 | ❌ 诚实手工（不伪造） |

1. `McpClientSpec` 新增 `dynamicConfigGlob`（WorkBuddy）与 `inheritsFrom`（deepseek-harness ← qoder-cn，`writable: true` 走委托）；`probeClientConfig` 门禁只按 `format==='unknown'` 判手工。
2. `resolveDynamicConfigPath`（单星段、确定性排序、尾分隔符兼容的 dirname）；扫描新增宿主继承 pass（宿主 wired → 本客户端 wired + note 注明来源）。
3. `wireMcpClient` 委托：`!spec.configPath && spec.inheritsFrom` → 直接写宿主配方（备份 + 合并写入不变）。
4. **边界（诚实声明）**：WorkBuddy 的「一键接入」仍会拒绝自动写入——这是设计而非遗漏；Zcode 给精确指引而非假成功。

### 28-C 无 LLM 时 L2–L6 层数据（审查结论 + 自动清理）

**根因**：批次9 之前规则尚未落地，当年 stub 精炼器给历史行编满了 L2–L6（本机实测 1642 行中 986 行是 stub 产物，0 行真实 LLM）。批次9 起「无真实大模型只落 L1」已是硬规则，问题只在**历史行**。

1. 启动**自动执行** `autoDemoteLegacyLayers`（main.ts bootstrap）：命中才备份 → 降级 → 内核审计 `security_change`（`op='legacy_layer_demote'`）；失败只记日志，绝不影响启动；不再等管理员点卡。
2. 判定口径扩展 `isMislabeledLayer`：标了 L2–L6 但无深层正文且 `refined_by` 非 llm/llm_partial（批次28 修复 `buildSummary` 摘要行误标 L3 的入口后新产生的形态一并覆盖）。
3. 堵源：`buildSummary` 不再误标；`coreUpdateContent` 手动改写时把 stub 行归回真实 L1。
4. 真实 LLM 产物与缺 L1 的行（`missing_l1`）一律不碰；降级不可逆，只能从备份恢复。

## 3. 自动化门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck`（双配置） | 0 错 |
| `npm run lint`（oxlint） | 0 warning / 0 error |
| 索引新鲜度 `code:index:check` | 通过（已 `--write` 刷新，281 文件） |
| 单测 + 覆盖率 | **122 文件 / 1343 例**全过；覆盖率 语句 79.57 / 分支 71.92 / 函数 75.36 / 行 82.62（阈值 74/71/67/74） |
| E2E（真构建产物 + 真后端） | **21 spec / 94 例**全过（34.0s，含修复后的 security 8 例与 overview 1 例） |
| `npm run package` | exit 0；打包前自动刷索引；EPERM 走复制+删除收口回 `release/installer` |

新增/更新测试（批次28）：
- 新 `src/web/__tests__/httpStorage.test.ts`：信封解析 / KernelUnavailableError（无会话、不可达、401、501）/ 方法白名单转发。
- `src/core/memagent/__tests__/fileStorage.test.ts` +86 行：写锁抢占（第二进程只读镜像）、陈旧锁回收、readonly 永不抢锁、reloadOnMtime、E_STORAGE_LOCKED 诚实报错。
- `src/home/__tests__/server.test.ts` +118 行：/api/kernel/invoke 会话门禁、六方法白名单、appendAudit 形状校验、/api/kernel/info、{ok,result|error} 信封。
- `src/electron/__tests__/mcpClients.test.ts` 新 describe（4 例）：WorkBuddy 动态检出/已接入/缺令牌/写入拒绝；deepseek 宿主继承 wired + 委托写入；zcode 手工。
- `src/core/memagent/__tests__/legacyLayers.test.ts` +44 行：isMislabeledLayer 新形态、降级保留向量、missing_l1 跳过。
- 测试缝：`kernel.ts` 新增 `setKernelStorageForTests()`；4 个页面测试文件注入内存账本（mock 会话不再误走 HTTP 数据面）。

## 4. 手动测试步骤（安装版）

1. **安装与启动**：双击安装包 → 启动 → 登录 admin → 首页图谱/记忆/审计等页面数据正常（桌面端 IPC 数据面回归确认）。
2. **浏览器接真（28-A 核心）**：保持桌面端运行，`npm run dev` → 浏览器打开 `http://127.0.0.1:5180/overview.html` → 登录 → **首页/记忆库应直接显示桌面端真实数据**（不再是空账本）；此时在浏览器写页尝试写入 → 应得到诚实 `E_STORAGE_LOCKED` 提示（桌面端持写锁，唯一写者）。
3. **只读镜像跟随（28-A）**：桌面端新增一条记忆 → 刷新/等待后浏览器记忆库应出现该条（mtime 重载）。
4. **桌面端未运行时**：关掉桌面端 → 重启 `npm run dev` → 浏览器登录后写入应**成功**（dev 后端直接挂账本，无锁竞争）。
5. **三客户端（28-B）**：接入页 MCP 面板「刷新状态」→ deepseek harness 显示「已接入（宿主 Qoder 下发）」；WorkBuddy 显示自动检出的连接器文件状态；Zcode 显示手工指引。对 deepseek harness 点「一键接入」→ 实际写 Qoder 配置并回执成功。
6. **L2–L6 自动清理（28-C）**：数据根若有历史 stub 行，重启应用后动作日志出现 `kernel:legacy:auto-demote`（含 scanned/hits/demoted/备份目录）；记忆层级管理页 L2–L6 应只剩真实 LLM 产物；安全页「遗留账本清理」卡预览 hits 应为 0（已清完）。
7. **日志可回查**：以上每步均可在数据根 `actions.log` 按 scope 过滤（`kernel:legacy:auto-demote`、`home:kernel_invoke` 拒绝行为 `auth_rejected` 类）。

## 5. 已知边界与残留（诚实声明）

- **浏览器 dev 模式登录后是只读镜像**（桌面端持写锁时）：能看真实数据，写入诚实报 `E_STORAGE_LOCKED`——写入请用桌面端或 MCP；桌面端未运行时 dev 后端直接挂账本，写入可用。
- WorkBuddy 检出但不代写（应用托管同步会覆盖）；Zcode 手工；deepseek harness 依赖宿主 Qoder 已接入。
- 页面测试注入 `setKernelStorageForTests` 后不覆盖 HTTP 数据面在 jsdom 的端到端行为（该路径由 httpStorage 单测 + E2E 真后端覆盖）。
- MCP 单令牌仍是机器级凭据（P1-10 残留）；`sync()` 仍未接线（`E_NOT_IMPLEMENTED`）。
- 28-C 降级不可逆，只能从备份文件恢复；真实 LLM 产物与缺 L1 的行永不触碰。
