# memagent-recall-card

给 DSH 桌面端用的客户端插件：把 `multiagent_memory`（memagent）的 **`recall_memory`** 工具结果渲染成一张
**默认收起的富媒体卡片**，点开看汇总 + `[n]` 依据 + 四段明细。

## 为什么需要它

DSH 的 Markdown 渲染器 `MarkdownText` 把 `html` 节点当**字符串子节点**交给 React
（`case "html": return r.omitHtml ? null : e.value`），React 转义后 `<details>` 只会显示成尖括号文本。
DSH 也没有 WorkBuddy / CodeBuddy 那种 `show_widget` 组件工具，所以「卡片」只能走它自己的工具视图插槽：

```js
ctx.slots.register({ name: 'tool.call.toolview', key: 'mcp__memagent__recall_memory' }, Card)
```

这条扩展点由 `@deepseek-ai/dsh-client-ui-tool` 的 README 明确给出（business UI packages register their tool views）。

## 装

DSH 桌面端 → **插件 → 添加插件 → 选择本地目录**，选中本目录 `memagent-recall-card`。

装完**刷新页面**（或重开一个会话）——客户端插件在页面启动时加载。

## 验

1. 在会话里让我调一次记忆库（`recall_memory`），或随便问一个涉及本项目的问题；
2. 该工具的卡片应变成：一行 `▸ <摘要行>` + 右侧「展开」；
3. 点开：⚙ 模式行 → 📊 统计汇总 4 行 → 🎯 依据 `[n]` 列表 → 四个二级折叠
   （📎 项目背景 / 💠 命中记忆 / ⚡ Token 用量 / 💰 省钱与费用）；
4. 报错或结果形状不符时，卡片会老实显示原始文本并标「记忆召回失败 / 原始结果」，不编造数字。

## 数据来源

只读工具结果里那段 JSON payload（`display` / `hits` / `background` / `savings` / `money` / `dispatch`），
**不改服务端、不改 `display` 契约、不新增请求**；其余工具（如 `write_memory`）不受影响，仍走通用卡。

## 卸载

DSH 插件页移除该插件即可；本目录只是源码，随时可重装。

## 已知限制

- 只接管 `mcp__memagent__recall_memory` 一个工具名；服务端改名则卡片退回通用视图（功能不受影响）。
- 卡片里的文字是写死的简体中文，未走 locale 服务（个人测试版）。
- 不做反馈按钮：本插槽拿不到 `sendPrompt` 类能力。
