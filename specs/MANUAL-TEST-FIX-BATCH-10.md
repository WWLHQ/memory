---
status: done
---

# 手动测试报告 · 功能批次 10（噪声规则扩展 + 脱敏补齐 + 质量门旁路收口）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（121,954,473 B = **116.31 MiB**）
- SHA256：`2ecea2087aa2d5b36e1a675e09803f048fd92393a6c03e9ce11823bfb9d0ba0d`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-9.md`
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次无内核数据格式变更，可直接覆盖安装**：不新增/不修改落盘字段，只在既有审计 `detail` 中追加信息——
> 1) `memory_op`（手动编辑被拦截时）增加 `action:'filtered_l0_to_l1'`、`source:'manual_edit'`、脱敏预览；
> 2) `gc` 增加 `summaries_filtered` 与 `summary_filter_reasons`。
> 旧账本、旧安装包产生的数据无需迁移；覆盖安装前仍建议备份数据根（默认 `%APPDATA%\MultiAgent Memory`）。

## 0. 本轮用户需求

1. 「噪声规则：增加询问，打招呼等过滤，另外也要判断回复内容是否有可用价值，比如只回复了我是哪个模型，我可以帮你做哪些工作等都要进行过滤。」
2. 「把裸 IP / 证件号未脱敏，未覆盖的协议/认证，两条旁路不过 L0→L1 门排入下一批统一收口。」

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 10-A 元对话噪声 | `checkL0ToL1Quality` 在原有 12 条整句 `NOISE_PATTERNS` 之后新增**子句级元对话判定** `metaReplyReason`：按 `。！？；换行` 与 `，、` 切子句，逐句分类为寒暄/客套/身份询问/身份陈述/身份续述/免责声明/能力清单/列表碎片；**任一子句含实质证据（数字、代码符号、文件扩展名、非停用英文技术词）→ 整条放行**；仅当所有子句都是元对话时拦截，原因区分「纯问候/客套」「纯身份或能力询问」「助手自述/能力清单」。问候词扩充（当然/好呀/好滴/好嘞/可以呀/行呀） | `src/core/memagent/qualityGate.ts` |
| 10-B 脱敏补齐 | `sanitizeL1` 重排为九条按序规则：①任意协议 URL（http/ws/tcp/ftp/sftp/ssh/git/ldap/smb/file/db/postgres/mysql/redis/mongodb…）→ `[服务地址]`；②`Authorization`/`Proxy-Authorization`/`Cookie`/`Set-Cookie` 头 → `[API_KEY]`；③`curl -u/--user` → `[API_KEY]`；④扩展 `key=value`（`client_secret`/`x-api-key`/`session_id`/`access_token` 等）；⑤Bearer/JWT(`eyJ`)/`sk-`/`ghp_`/`github_pat_`/`xox`/`AKIA`；⑥18/15 位证件号 → `[证件号]`；⑦电话/邮箱；⑧裸 IPv4（可带端口）/IPv6/方括号 IPv6 → `[IP]`（`v1.2.3.4` 等版本号保留）；⑨姓名启发式 | `src/core/memagent/layerRules.ts`、`crypto.ts`（`MASK.idcard`/`MASK.ip`） |
| 10-C 旁路①：手动编辑 | `coreUpdateContent` 先过同一个 `checkL0ToL1Quality`：不过门 → 拒绝保存并写 `memory_op` 审计（`filtered_l0_to_l1`、`source=manual_edit`、脱敏预览），账本不变；过门 → 写入**脱敏产物**，重算 `sha256` 与 `content_l{k}`，L1 记录重算 `embedding`（维度沿用原向量），L0 密文一字不动 | `src/web/memory/coreMemoryOps.ts` |
| 10-C 旁路②：自动摘要 | `buildSummary` 校验**每个成员**与**聚合文本**都过质量门；`SummaryBuildResult` 改为 `{ok:true,summary,originals}` / `{ok:false,reason}` / `null`；`runForgettingCycle` 记 `summaries_filtered`，拦截时原文不降级、不删除，`gc` 审计追加 `summary_filter_reasons`（最多 10 条） | `src/core/memagent/forgetting.ts` |
| 测试 | 单测新增/更新：`qualityGate.test.ts`（元对话正反例）、`refine.test.ts`（IP/证件号/协议/认证/版本号保留）、`forgetting.test.ts`（成员噪声拦截、聚合脱敏、周期审计）、`MemoryPage.test.tsx`（编辑被拦/保存内容改为过门文本）、新增 `coreMemoryOps.test.ts`（编辑过门、PII 脱敏、sha256/embedding/content_lN、locked） | `src/core/memagent/__tests__/*`、`src/web/memory/__tests__/*` |
| 文档 | 需求规格书 §2.1 占位符与覆盖范围、§2.2 不变量 5 与新增不变量 9（质量门不得有旁路）；`AGENTS.md` §9；`specs/code-map.md` 批次10 区块；`specs/MANUAL-TEST.md` §3.3；`npm run code:index -- --write` 刷新符号索引 | `specs/*.md`、`AGENTS.md` |

### 关键设计（为什么这样实现）

- **子句级而非整句级**：真实噪声常是组合句（「你好，我是 DeepSeek，我可以帮你写代码、分析数据、回答问题。」）或编号列表，整句正则无法穷举；逐子句分类 + 白名单续接可覆盖组合，又不需要 LLM。
- **证据优先放行**：只要出现数字/代码符号/文件扩展名/非停用英文词，就视为有可用信息，整条放行。宁可漏过一句寒暄，也不误杀「你好，部署前请检查 nginx upstream 超时配置」这类有价值内容。
- **脱敏顺序敏感**：URL 规则必须先于 IP（否则 URL 主机被拆成 `[IP]` 后残片难清理）；认证头先于键值（整行替换，不残留 `Basic …`）；证件号先于电话（18 位号码包含 11 位手机号子串）。
- **旁路收口只收「进入可检索层」的两条路**：L0 密文不参与质量门（它本来就是原文证据层）；手动编辑失败是非破坏性的（不写账本、不改版本）；摘要被拦也是非破坏性的（原文不降级、不删除），只在审计里说明原因。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint，403 文件 / 123 规则） | **0 error / 0 warning** |
| 单元/集成测试 | `npm run test:coverage` | **101 文件 / 998 用例全过** |
| 覆盖率 | 同上 | 语句 74.72%（6985/9347）、分支 65.78%（4529/6885）、函数 70.19%（1679/2392）、行 77.68%（6085/7833）；阈值 71/61/67/74，通过 |
| Web 构建 | `npm run build`（vite） | 通过（19 个 HTML 入口；`main` 38.83 kB / gzip 13.53 kB，`kernel` 48.16 kB / gzip 19.19 kB，`security` 28.95 kB / gzip 8.39 kB） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功（存量 `import.meta` CJS 提示不变） |
| 真浏览器 E2E | `npm run test:e2e` | **21 spec / 93 用例全过（39.4s）** |
| 总门禁 | `npm run verify` | 退出码 0 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

> 说明：相较批次 9（980 例）净增 **18 例**：`qualityGate.test.ts` +4（元对话正反例）、`refine.test.ts` +6（IP/证件号/协议/认证/版本号）、`forgetting.test.ts` +3（成员噪声/聚合脱敏/周期审计）、`MemoryPage.test.tsx` +1（编辑被拦）、新增 `coreMemoryOps.test.ts` 4 例（编辑过门/脱敏/sha256+embedding/locked）。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` | 121,954,473 B = **116.31 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer/win-unpacked/` | `MultiAgent Memory.exe` 249,934,848 B，可直接运行 |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

> 本次打包输出到 `release/installer/`（上一批因索引器占用曾自动改时间戳目录；本批无占用，无需备用路径）。

## 4. 手动测试用例（重点）

> 日志位置：`<数据根>\actions.log`（默认 `%APPDATA%\MultiAgent Memory\actions.log`）；账本与内核审计：`memories.db.json`。
> 红线：任何日志/审计/UI 都不得出现被脱敏前的手机号、证件号、IP、密钥、Cookie/Authorization 原文。

### 4.1 寒暄 / 询问 / 无价值自述被过滤（10-A）

1. 登录（`admin` / `Admin@123456`），安全页确认 L0 写密钥已解锁（未设置则先设置管理密码）。
2. 打开「写入」页，逐条提交以下内容（每条应被**过滤**，无记忆 ID 回执、账本不新增）：
   - `你好`
   - `你好，有什么可以帮您的吗？`
   - `你是谁？你是什么模型？`
   - `你能做什么？我可以帮你做哪些工作？`
   - `你好，我是 DeepSeek，我可以帮你写代码、分析数据、回答问题。`
   - 多行编号清单：`我能做的事情：\n1. 编写代码\n2. 分析数据\n3. 回答问题`
3. 预期：
   - 页面提示「已过滤（未通过 L0→L1 质量门）」类文案，**不显示**记忆 ID；
   - 账本 `memories` 数量不变；内核 `write` 审计 detail 含 `filtered` 与拦截原因，`content_preview` 为脱敏后前 60 字（不含原始 PII）。
4. **不误杀**对照（以下必须正常入库）：
   - `你好，部署前请检查 nginx upstream 超时配置`
   - `你能帮我排查 Redis 连接池超时吗`
   - `我可以帮你优化 PostgreSQL 的索引配置`
   - `用户登录失败，错误码 E_AUTH`
5. 预期对照条回执动作为 `create`（或 `graft`），账本新增/命中，L1 文本完整保留。

### 4.2 脱敏补齐：裸 IP / 证件号 / 协议 / 认证（10-B）

1. 写密钥已解锁时，在「写入」页提交（≥10 个有效字符）：
   ```
   故障排查：数据库 10.0.0.9 连接超时，备份机 192.168.1.20:8080 正常；
   IPv6 地址 2001:db8::1；身份证 110101199003071234；
   备份源 ftp://files.example.com/pub，跳板 ssh://root@10.1.1.1；
   请求头 Authorization: Basic dXNlcjpwYXNz，Cookie: sid=abc123456；
   客户端版本 v1.2.3.4 保持不变。
   ```
2. 提交成功后，在记忆页打开该条（或检查 `memories.db.json` 的 `content_l1`），预期 L1：
   - `10.0.0.9`、`192.168.1.20:8080`、`2001:db8::1` → `[IP]`；
   - `110101199003071234` → `[证件号]`；
   - 两个协议 URL → `[服务地址]`；
   - `Authorization: Basic …` → `Authorization: [API_KEY]`；`Cookie: …` → `Cookie: [API_KEY]`；
   - `v1.2.3.4` **保持原样**（版本号不误伤）。
3. 在账本文件中 grep `10.0.0.9`、`110101199003071234`、`dXNlcjpwYXNz`、`sid=abc123456`、`files.example.com` → **均无命中**（L0 为密文，L1 已脱敏）。
4. 边界对照：写入 `订单号 202610301234567890 已生成，请核对数据库迁移脚本` → 订单号**不应**被当作证件号；若被误伤，记录为缺陷。

### 4.3 手动编辑必须过 L0→L1 门（10-C①）

1. 记忆页选择一条真实记忆，点「📖 打开」抽屉，把内容改为 `你好，我是一个 AI 助手`，点「保存」。
2. 预期：
   - toast 提示「内容未通过 L0→L1 质量门：…」，抽屉保持编辑态但**不落库**；
   - 该记忆内容与 `version` 不变（刷新后仍是原文）；
   - 审计页/账本审计查到 `memory_op`，detail 含 `action:'filtered_l0_to_l1'`、`source:'manual_edit'`、`masked:true`。
3. 改为含 PII 的技术内容：`数据库在 10.0.0.9，联系人：张三，登录失败要查连接池` → 保存成功：
   - 内容显示为 `数据库在 [IP]，联系人：[姓名]，登录失败要查连接池`；
   - `version +1`、`sha256` 变化；`memory_op` detail 含 `masked:true`、`l0_unchanged:true`；
   - L1 记忆的 `embedding` 被重算（同维度），L0 密文未变。
4. locked 记忆：抽屉只读、保存禁用，提示先解锁。

### 4.4 自动摘要必须过 L0→L1 门（10-C②）

> 说明：写入页已无法产生噪声记忆（10-A 已拦截），因此本条需用**旧数据或手工构造**的账本验证。操作前请退出应用并备份 `memories.db.json`。

1. 退出应用；备份数据根 `memories.db.json`。
2. 在 `memories.db.json` 中复制 3 条同 `enterprise_id/team_id/project_id`、`category:'decision'`、`decay_class:'hot'`、`locked:false`、`merged_into` 为空、内容前 8 字相同的记忆，内容统一为 `你好，我是一个 AI 助手`（三条完全一致即可）；保存。
3. 以缩短首个周期的环境变量启动应用：`set MAM_FORGETTING_FIRST_DELAY_MS=5000` 后启动（参数页「自动整理」保持开启）。
4. 等待 ≥5 秒，检查：
   - `memories.db.json` 中这 3 条**仍在**，`decay_class` 未变、未新增 `sum_` 摘要；
   - 内核审计 `gc` 的 detail 含 `summaries_filtered ≥ 1`、`summaries_created: 0`，且 `summary_filter_reasons[0]` 含「质量门」；
   - `actions.log` 可 grep 到 `forgetting:cycle:done`（含同一组计数）。
5. 对照组：把 3 条改为带真实技术内容的相似文本（例如都含「部署脚本必须校验 Redis 连接」）→ 下一轮 `gc` 应生成 `sum_` 摘要（`decay_class:'warm'`），3 条原文降 `cold` 且 `merged_into` 指向摘要，摘要内容已脱敏（若含手机号/姓名则显示占位符）。
6. 测试完成后恢复备份，或删除手工构造的条目。

### 4.5 回归检查

1. 正常写入一条技术记忆 → 仍能入库、L1 脱敏、查重/嫁接行为不变（批次 9 用例 4.3）。
2. 检索页能命中 L1 技术关键词；L0 原文敏感串不可检索。
3. 记忆页列表/抽屉/记住/忘记按钮行为不变；图谱正常渲染。
4. `actions.log` 无未脱敏的密码/密钥/手机号/证件号。

## 5. 已知限制（不应作为缺陷）

- **元对话检测是保守启发式，不是语义理解**：
  - 含数字的助手自述会被放行（如「我是 GPT-4」因为数字被视为实质证据）；
  - 英文能力清单超出内置白名单子句时会放行；
  - 过短但有价值的内容（有效字符 <10，如「重启 nginx」）会被有效长度规则拦截——这是既有规则，不是本批新增。
- **脱敏是规则匹配，不是语义识别**：畸形/跨行拼接的敏感串（如证件号中间插入空格、`Bearer` 后换行）可能漏网；裸 IPv6 只覆盖标准结构形式，带 zone id 等非常规写法可能不匹配。
- **手动编辑不做逐层规格校验**：编辑 L2–L6 记录时只过 L0→L1 质量门（噪声/脱敏/长度），不重新校验 L4「适用场景」、L5「边界条件」、L6 JSON 等层规格；层规格仍只在 LLM 生成时校验。
- **摘要被拦截后不重试/不重新生成**：本轮只做「跳过合并 + 审计原因」，不自动改写摘要内容；需人工或后续接入 LLM 处理。
- **未接入真实 LLM 时仍只有 L1**：`refined_by=stub`，L2–L6 不生成（沿用批次 9 边界）。
- `sync()` 仍未接线：显式返回 `E_NOT_IMPLEMENTED`，页面标注「未实现」。
- 覆盖安装不会清理旧版本已落库的噪声记忆；如需清理请在记忆页手动删除或等待后续清洗工具。
