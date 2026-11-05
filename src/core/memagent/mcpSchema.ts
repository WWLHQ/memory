// MCP 工具清单与初始化指令（批次11/12/13）：HTTP(8204) 与 TCP(8202) 共用同一份 schema/instructions，
// 避免两套协议漂移。instructions 由 MCP 客户端注入 Agent，负责「关键词触发召回 + 回显提示」。
// 批次12：客户端不保证注入 instructions（Qoder 实测未注入）→ 工具描述与结果末块同步加「先调用 + 回显」硬约束。
// 批次13：回显物改为 display.markdown（四段 <details> 可收起/展开），不渲染 HTML 的客户端回退 display.line。
// 批次14：触发措辞由「禁用本地检索」改为「优先用本库」——未命中/不可用时允许回退代码与本地笔记，
//         避免客户端在工具未命中时无法继续；同时明示客户端自带 memory 文件不是本记忆库。
// 批次32-C：不支持 HTML 折叠的客户端（DSH 实测只渲染 Markdown）默认只给一行摘要，明细改由 recall_memory 的 detail=true 按需取。
// 批次33-C：默认收起档再收口为「两行摘要 + 一个可点的本机明细页链接」——DSH 里没有可点击的折叠控件，
//           但 Markdown 链接能点开我们自己的真 HTML 页（四段 <details> 折叠）；无链接场景（TCP 8202）退回 detail=true 文字指引。
export const MCP_INSTRUCTIONS = `你是接入了 MultiAgent Memory 的 Agent。记忆库数据全部来自本机真实账本，工具返回的数字不得改写或编造。

必须遵守：
1. 触发（默认优先）：用户消息只要涉及本仓库/本项目的实现、架构、历史决策、踩坑、偏好、事实，或出现「记得 / 上次 / 之前 / 老规矩 / 继续上次」，就优先调用 recall_memory 再回答；本库未命中或工具不可用时，才回退到读代码、工作区笔记或客户端自带 memory 文件。客户端自带的 memory/笔记不是本记忆库，不能替代首选检索。project_id 可省略：账本只有一个项目时自动定位；有多个项目时先调用 list_projects 并向用户确认。
2. 回显（强制）：每次 recall_memory 成功返回后，把该次返回的 display.markdown 整段原样输出到最终回答末尾。服务端按你的客户端能力选档位：支持 HTML 折叠的客户端收到 <details> 四段（项目背景/命中记忆/Token/省钱与费用，可点开收起）；其余客户端默认收到「两行 🧠 Memory 摘要 + 展开入口」——HTTP 传输给一条指向本机一次性明细页的 Markdown 链接（用户点链接才看四段，URL 必须逐字保留、不得改写不得丢），TCP 等无链接场景给一行文字指引。任何档位都禁止自行补写或预先展开明细（明细只能来自本次或下一次工具返回），不得添加 HTML 标签；token 数字与金额必须原样保留。需要明细时，用同一个 query 再调用 recall_memory 并置 detail=true，然后原样输出那次返回的 display.markdown。若客户端连 Markdown 都渲染不了，改为单独一行原样输出 display.line。
3. 金额：display.money 为 null 表示用户尚未设置单价（全局参数页），不得猜测或补全金额。
4. 沉淀：会话中形成新的决策、踩坑、事实、偏好或洞察时，调用 write_memory 落库（category 选最贴近的一类）；写入前如不确定项目，先 list_projects；不确定 L0 写密钥是否解锁时先调用 get_write_status 探锁。若 write_memory 返回 status=pending，表示本次内容已暂存、解锁后会自动重放落库——这不是写入成功，必须如实告知用户，不得伪造 mem_id 或声称已落库。
5. 边界：不要向用户展示 MCP 认证令牌（Authorization 头 / mcp-token.txt 内容）；不要伪造记忆内容、省量或审计回执。工具不可用时（未启动/未授权/连接失败）如实说明并继续回答，不得假装检索过记忆。`;

/** 标准 MCP 工具定义（tools/list 返回；顺序即客户端展示顺序） */
export const MCP_TOOLS = [
  {
    name: 'recall_memory',
    description: '检索项目记忆库（关键词 / 历史决策 / 踩坑 / 偏好 / 事实）。优先使用本工具：回答本项目相关问题（实现、架构、历史决定、踩过的坑、用户偏好）前先调用；未命中或工具不可用时再回退读代码或客户端本地笔记（本地 memory 文件不是本记忆库）。返回命中、项目背景、token 省量与本次/今日/全部金额；project_id 可省略（唯一项目自动定位）。调用后须在回答末尾原样输出 display.markdown：服务端按客户端能力选档——支持 HTML 的客户端给 <details> 四段（项目背景/命中记忆/Token/省钱与费用）；其余默认给两行摘要 + 一条「▶ 展开本次召回明细」的本机明细页链接（链接 URL 逐字保留，用户点开才看四段）；不得自行补写或预先展开明细、不得添加 HTML 标签、数字/金额不得改写；用户明确要明细时再用同一 query 调用一次并置 detail=true。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（可省略：账本唯一项目时自动定位；多项目时先 list_projects）' },
        query: { type: 'string', description: '检索词（用户问题/关键词，必填且非空）' },
        top_k: { type: 'integer', description: '返回条数，1-10，默认 5' },
        scene: { type: 'string', enum: ['default', 'critical', 'task_start', 'history_query'], description: '场景；critical 禁 minimal 模式' },
        mode: { type: 'string', enum: ['auto', 'top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'], description: '召回模式开关：auto=自动（Agent 按场景+关键词自动分配，默认）；其余 5 个为手动具体模式（用户/宿主显式指定，强制采用）。手动必须给出具体模式，未指定具体模式按自动处理' },
        detail: { type: 'boolean', description: '是否要四段明细（批次32-C/33-C）。省略/false = 只给两行摘要（不支持 HTML 折叠的客户端默认收起，HTTP 档附一条可点本机明细页链接）；true = 直接返回项目背景/命中记忆/Token/省钱与费用四小节纯 Markdown。只在用户明确要看明细时置 true，query 与本次保持一致；不要因为「这样更完整」自行置 true' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_memory',
    description: '写入一条记忆（L0 AES-256-GCM 加密 → L1–L6 阶梯精炼）。仅在形成新决策/踩坑/事实/偏好/洞察时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '原始会话片段（具体、可复用）' },
        project_id: { type: 'string', description: '项目 ID（必填；可先 list_projects 查询）' },
        category: { type: 'string', enum: ['fact', 'decision', 'pitfall', 'insight', 'preference', 'context'], description: '类别' },
        user_id: { type: 'string', description: '用户 ID（须与会话身份一致）' },
        session_id: { type: 'string', description: '会话 ID（溯源）' },
        source_agent: { type: 'string', description: '来源 agent 标识（必填，须显式标识：workbuddy / claude-desktop / cursor / gemini-cli / codex 或自定义小写连字符；禁止默认 mcp，命名见 §7.1）' },
        importance: { type: 'number', description: '重要程度 0–1（可选；显式传入才落库参与打分，不传按 0.5 计）' },
        confidence: { type: 'number', description: '可信度 0–1（可选；显式传入才落库参与打分，不传按 0.5 计）' },
        half_life_days: { type: 'integer', description: '半衰期天数 ≥1（可选；不传按类别默认策略）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签集合（可选，字符串数组）' },
      },
      required: ['content', 'project_id'],
    },
  },
  {
    name: 'list_projects',
    description: '列出记忆库中真实存在的项目（project_id / 记忆条数 / 最近活动时间）。用于不确定 project_id 或存在多项目时向用户确认。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_preferences',
    description: '读取用户偏好配置（跨 Agent 共享）。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '用户 ID（必填）' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_write_status',
    description: '写前探锁（批次44-D4）：返回 l0_unlocked（写入是否解锁）、writeDek_present（写密钥是否在内存）与 pending_count（待重放的暂存写入条数）；不返回任何密钥材料。已解锁时调用会顺带自动重放历史 pending 条目。write_memory 返回 status=pending 说明写密钥锁定、内容已暂存而非落库，解锁后可再用本工具确认重放结果。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;
