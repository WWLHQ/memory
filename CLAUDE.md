# CLAUDE.md — Claude Code 协作入口（批次15）

本仓库的完整协作指南在 [AGENTS.md](AGENTS.md)；Claude Code 会加载本文件，因此下面用 `@` 导入同一份规则，再补充本客户端专属的 MCP 触发说明。

@AGENTS.md

## 记忆库优先（与 AGENTS.md §1.1 同源，非重复发明）

桌面端在 `127.0.0.1:8204/mcp` 暴露 MCP 服务 `multiagent_memory`。回答本仓库的实现、架构、历史决策、踩坑、偏好类问题前：

1. **优先调用** `recall_memory`（query = 用户问题关键词，project_id 可省略）；
2. 回答末尾**原样输出**工具返回的 `display.markdown`——服务端按调用方客户端分三档下发，`display.mode` 说明本次是哪一档（批次32）：
   - `html-details`：能渲染 HTML 的客户端（当前实测只有 Qoder 系）得到 `<details>` 折叠版，summary = 🧠 Memory 提示行，内层四段可点击收起/展开；
   - `markdown-compact`（**Claude Code 走这一档**）：一行加粗摘要 + 收起说明，默认不再把四段明细铺满聊天窗口；
   - `markdown-full`：用户明确要看明细时，**用同一个 query 再调用一次 `recall_memory` 并置 `detail=true`**，得到纯 Markdown 四小节（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）；
3. 不要自行改写格式、添加 HTML 标签或补写明细；数字与金额不得改写、省略或补全。客户端连 Markdown 都渲染不了时改为输出 `display.line` 单行；
4. 本库未命中或工具不可用时，才回退读代码/工作区笔记/客户端自带 memory 文件；
5. 形成新结论时用 `write_memory` 落库。

注意：

- 桌面端未运行则 8204 不可达：如实说明，不编造记忆、不假装检索过。
- 这里的 MCP 端点需要一个 Bearer 令牌（数据根 `mcp-token.txt`）；若 `~/.claude.json` 的 `mcpServers.memagent` 缺少 `headers.Authorization`，调用会 401——请在应用「Agent 接入配置页 → MCP 客户端接入状态」里点「补齐令牌」，或复制片段手工合并。
- 是否真的检索过，以数据根 `memories.db.json` 的 `recall` 审计为准（批次15 起审计会记录调用方 `client`）。
