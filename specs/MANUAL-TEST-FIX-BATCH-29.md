---
status: done
---

# 批次 29 手动测试报告 —— MCP 召回展示按客户端适配（DSH 不渲染 HTML → 纯 Markdown）

- 日期：2026-10-31
- 起因：用户在 DeepSeek Harness（DSH）聊天窗口实测截图——模型回显的 `display.markdown` 中 `<details>/<summary>` 以**字面文本**露出（红框截图）；对照 Qoder 客户端截图是正常的单行提示 + 可折叠明细。结论：**DSH 只渲染 Markdown，不渲染 HTML**，批次13 的 `<details>` 折叠版对它不适用。
- 修复方向：**服务端按调用方客户端分发展示格式**（不是让每个客户端自己适配）。代码改动 + 测试 + 文档收口，未动内核召回语义，数字两变体完全同源。

## 1. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,990,494 B（116.33 MiB） |
| SHA256 | `AD292261824A4E3DA6F0F49F50BE4DAC06CCA4A1394A79474D5C9B8F87F1B12E` |
| 清理 | `release/` 只留最新一份；打包前强制结束本仓库 `release/` 下运行中的旧实例（批次19/27 口径） |

## 2. 改动清单（逐文件理由）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/core/memagent/recallInsight.ts` | `buildRecallMarkdown` 加第 4 参 `{htmlDetails}`：`false` 时输出**纯 Markdown 四小节**（`**标题**` + 正文，`plainClip` 不做 HTML 转义——转义串 `&lt;` 在纯 Markdown 客户端会原样露出）；`true`（默认）行为与批次13 完全一致 | 两种格式的唯一纯函数真源，数据不变只变外壳 |
| `src/core/memagent/mcpRecall.ts` | 新增 `clientSupportsHtmlDetails(client)` 白名单：仅实测支持 HTML 的客户端（当前 `qoder/*`，大小写不敏感）返回 true；**其余一律 false（fail-safe 纯 Markdown）**；`runRecallTool` 按 client 分发 | 新客户端默认拿到最保守格式，未实测过绝不发 HTML |
| `src/core/memagent/mcpHttp.ts` | `RECALL_ECHO_NOTE` 常量 → `recallEchoNote(htmlDetails)` 函数（两种措辞：HTML 版讲 `<details>` 四段，纯 Markdown 版讲四个小节并明示「不得添加任何 HTML 标签」）；tools/call 末块按 client 选措辞 | 展示要求必须与实际下发的 markdown 格式一致，否则模型会自行加回 `<details>` |
| `src/core/memagent/mcpSchema.ts` | `MCP_INSTRUCTIONS` 规则 2 与 `recall_memory` 工具描述改为**格式中立**：「服务端已按你的客户端下发适配格式（HTML 折叠或纯 Markdown），原样输出即可，不要自行改写格式或添加 HTML 标签」 | 指令不再预设 HTML，DSH 等客户端照做也不会露标签 |
| `__tests__/recallInsight.test.ts` | 新增纯 Markdown 变体用例（无 `<details>/<summary>/&lt;`、`**小节标题**`、首行 `**提示行**`）+ 两变体转义差异对照（`<script>` 在 HTML 版被转义、纯 Markdown 版原样保留）+ `clientSupportsHtmlDetails` 白名单 6 用例 | 契约固化：零 HTML 标签是硬断言 |
| `__tests__/mcpHttp.test.ts` | 无会话 recall：`content[2]`（display.markdown）与 `content[3]`（展示要求）均断言不含 `<details>` 且含 `**📎 项目背景` 等四小节；批次15 Qoder 会话用例追加：`structuredContent.display.markdown` 含 `<details>`、末块含「<details> 四段」 | HTTP 两分支（Qoder=HTML / 其余=纯 Markdown）全覆盖 |
| `__tests__/mcp.test.ts` | TCP 8202 recall 断言不含 `<details>`、含 `**📎 项目背景` | TCP 无 clientInfo → 恒为纯 Markdown fail-safe |
| `AGENTS.md` | §1.1 改为「批次29 起服务端按客户端适配格式，原样输出即可」；§9 批次11-15 条目追加批次29 段（白名单/纯 Markdown/fail-safe/echoNote） | 触发规则兜底必须与实际下发格式一致 |
| `specs/code-map.md` | 批次13 表两行更新：`RECALL_ECHO_NOTE` → `recallEchoNote(htmlDetails)`；content 块长度 3→4；四段折叠明细行补纯 Markdown 变体 | 人工模块地图与实现同步 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 刷新（281 文件） | 门禁要求 |

## 3. 分发规则（一句话版）

| 调用方 | display.markdown 格式 | 依据 |
|---|---|---|
| `initialize.clientInfo` 为 `qoder/*`（HTTP 8204） | `<details>` 折叠版（批次13 原样） | 实测支持 HTML |
| 其它 clientInfo（`dsh-mcp-client/0.0.1`、`zcode/0.16.9`、`Cursor (UA)`…） | 纯 Markdown 四小节，零 HTML 标签 | fail-safe：未实测过 HTML 渲染能力的客户端一律不发 HTML |
| 无会话 / TCP 8202 | 纯 Markdown 四小节 | 无 clientInfo 可判 |

## 4. 自动化验证（真实跑过）

- 门禁：`npm run verify:fast` **exit 0**（typecheck 双配置 0 错、oxlint 0/0、索引新鲜度通过）。
- 单测：**122 文件 / 1346 用例全过**（本批次新增/修改 3 个测试文件的批次29 用例全部通过）。
- 覆盖率：语句 79.60% / 分支 71.95% / 函数 75.47% / 行 82.64%（高于门禁阈值）。

## 5. 端到端实测（DSH + 本服务，2026-10-31）

| 步骤 | 结果 |
|---|---|
| DSH 内通过宿主 Qoder 接入后发起召回 | DSH 聊天出现「工具调用 · mcp__memagent__recall_memory · 偏好约定 preference conventions」徽标，工具真实执行 |
| 服务端审计 | 审计页 recall 行 `client=dsh-mcp-client/0.0.1`（基线 18 行后新增 #19），query「偏好约定 preference conventions」，时间 2026-10-31 21:48:26（UTC+08:00） |
| 修复后格式验证 | 重新打包安装 + 重启 DSH 后：recall 返回纯 Markdown 四小节，`<details>` 字面标签不再出现（Qoder 侧折叠版不受影响） |
| 已知无关失败 | DSH 免费模型限流（`our-free-model/* exceeded 10 req/min`、EAC 模型需 GitHub 授权）导致部分完整回复中断——**与 MCP 无关**，MCP 工具调用本身成功 |

## 6. 手动测试步骤（验收用）

1. 安装新包并启动桌面端（管理员登录）。
2. 在 Qoder 客户端问一个本仓库问题 → 回答末尾应为「🧠 Memory ｜ …」单行 + **可折叠**四段明细（`<details>` 版，与批次13 一致）。
3. 在 DeepSeek Harness 客户端问同类问题 → 回答末尾应为**纯 Markdown 四个小节**（`📎 项目背景…` / `🧠 命中记忆…` / `⚡ Token 用量…` / `💰 省钱与费用…`），**不得出现任何 `<details>`/`<summary>` 字面文本**。
4. 桌面端审计页：两条召回各自的 `client` 分别为 `Qoder/x.y.z` 与 `dsh-mcp-client/…`，数字（命中/背景/token）与聊天窗口展示一致。
5. 参数页不设单价时，两客户端金额段均显示「金额未开：未设置单价」，绝不编造金额。

## 7. 已知边界与残留（诚实声明）

- 白名单目前只含 `qoder/*`：其它客户端即使实际支持 HTML 也先给纯 Markdown（多一节正文、无折叠）——**功能无损，只是不折叠**；要扩白名单必须先在真实客户端实测（教训：写分发规则前先实测再落笔，本批次起因即 28-B 类推断错误的镜像）。
- 纯 Markdown 版不做 HTML 转义：记忆内容里的尖括号在纯 Markdown 客户端按原样展示（如 `<script>` 会显示为字面文本但**不会执行**——Markdown 渲染器不执行 HTML 时无注入面；若某客户端既渲染 HTML 又自称非 Qoder，白名单 fail-safe 保证不会给它 HTML 版）。
- **安全事件记录**：本次排查中查看 DSH `cordis.patch.yml` 时，sed 脱敏因 YAML 令牌值换行而失效，MCP Bearer 令牌完整显示在会话输出中。建议尽快在「账号与安全」页**轮换 MCP 令牌**（轮换后 `cordis.patch.yml` 的 `Authorization` 需同步更新；接入页一键适配可自动补齐）。
- MCP 令牌已于本批次前入 `.gitignore` 管控（`dsh-bundles/` 含令牌不入库，提交 `3424c06`）。
