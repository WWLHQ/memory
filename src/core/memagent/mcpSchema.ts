// MCP 工具清单与初始化指令（批次11/12/13）：HTTP(8204) 与 TCP(8202) 共用同一份 schema/instructions，
// 避免两套协议漂移。instructions 由 MCP 客户端注入 Agent，负责「关键词触发召回 + 回显提示」。
// 批次12：客户端不保证注入 instructions（Qoder 实测未注入）→ 工具描述与结果末块同步加「先调用 + 回显」硬约束。
// 批次47（L1）：在 tools/list 下发的每个工具描述前置「首步召回」刚性提示，从工具元数据层把召回优先级顶到最高，
// 不依赖客户端是否注入 initialize.instructions。recall_memory 用更强口径，其余工具统一口径。

/** recall_memory 自己的描述前缀：强调它是本会话第一个工具调用 */
export const RECALL_FIRST_SELF_NOTE =
  '🔴【本会话第一步】在回答任何问题或调用其它工具前，必须先调用本工具检索记忆库；未调用前不要回答、也不要调用其它工具。';
/** 其余工具的描述前缀：调用前必须已先召回 */
export const RECALL_FIRST_TOOL_NOTE =
  '⚠️ 调用本工具前，本会话必须已先调用过 recall_memory（首步检索记忆库）；若尚未调用，请先调 recall_memory 再继续。';
/** 读类工具在可靠会话未召回时追加的软提醒（不拦截，保体验） */
export const RECALL_FIRST_REMINDER =
  '⚠️ 本会话尚未调用 recall_memory：继续处理前请先调用它以检索记忆库（回答/写入前优先采信记忆库内容）。';
/** L2 硬门禁提示：可靠会话（带 Mcp-Session-Id）尚未召回即调用写入/治理类工具的拒绝文案 */
export const RECALL_FIRST_GATE_MSG =
  '⛔ 本会话尚未调用 recall_memory（首步检索记忆库）。服务端已临时锁定写入与治理类工具：请先调用一次 recall_memory 检索记忆库，再继续本操作。';
/** C 方案（严格门禁）：服务端显式开启后，未召回即调用**任意非 recall 工具**的拒绝文案。
 *  默认关闭时本常量不参与任何返回，老客户端与既有测试逐字不变。 */
export const RECALL_FIRST_STRICT_GATE_MSG =
  '⛔ 本会话尚未调用 recall_memory（首步检索记忆库）。服务端已开启严格首步召回门禁，本会话除 recall_memory 外的所有工具均已锁定：请先调用一次 recall_memory，再继续本操作。';
/** 严格门禁开启时追加到 initialize.instructions 的声明（默认不下发，保证老客户端逐字不变） */
export const RECALL_GATE_STRICT_INSTRUCTIONS =
  '\n10. 严格首步召回门禁（服务端已开启）：本会话调用 recall_memory 之前，除 recall_memory 自身外的**所有**工具都会被服务端硬拦并返回 isError；读类工具不再只是软提醒。不要试图绕过，先调用一次 recall_memory 即解锁。';
/** 严格门禁开启时追加到 tools/list 非 recall 工具描述的后缀 */
export const RECALL_GATE_STRICT_TOOL_NOTE =
  '【严格门禁已开启】未先调用 recall_memory 时本工具会被服务端硬拦。';

/** 按服务端是否开启严格门禁生成 initialize.instructions；默认与原常量逐字相同。 */
export function mcpInstructions(strictGate = false): string {
  return strictGate ? MCP_INSTRUCTIONS + RECALL_GATE_STRICT_INSTRUCTIONS : MCP_INSTRUCTIONS;
}
/** 批次47（L3-a）：recall 结果末块追加的刚性「信息来源边界」——要求 agent 基于真实账本作答、未命中明说、绝不编造 */
export const RECALL_SOURCE_BOUNDARY =
  '【信息来源边界】以下记忆来自本机真实账本；若本次 recall 命中数为 0（hits=0），请如实说明「未检索到相关记忆」，不要编造记忆内容或省量；回答的事实应优先采信命中记忆；工具不可用或网络失败时不得假装检索过记忆。';

/**
 * 给 tools/list 返回的工具清单统一加「首步召回」提示：recall_memory 用更强口径，其余工具统一口径。
 * 返回新数组（不改动 MCP_TOOLS 原常量），避免两套协议漂移。
 */
export function withRecallFirstNotes(strictGate = false): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: (t.name === 'recall_memory' ? RECALL_FIRST_SELF_NOTE : RECALL_FIRST_TOOL_NOTE)
      + (strictGate && t.name !== 'recall_memory' ? RECALL_GATE_STRICT_TOOL_NOTE : '')
      + t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}
// 批次13：回显物为 display.markdown（<details> 可收起/展开），不渲染 HTML 的客户端回退 display.line。
// 批次 RAG：改为「短收 summary + 📊 本次召回统计汇总 + 🎯 本次用上的依据 [n] + 四段二级折叠」，
//         并要求回答正文就地标注 [n]（编号与依据段一致、不得编造）；三档与明细页段名逐字一致。
// 批次14：触发措辞由「禁用本地检索」改为「优先用本库」——未命中/不可用时允许回退代码与本地笔记，
//         避免客户端在工具未命中时无法继续；同时明示客户端自带 memory 文件不是本记忆库。
// 批次32-C：不支持 HTML 折叠的客户端（DSH 实测只渲染 Markdown）默认只给一行摘要，明细改由 recall_memory 的 detail=true 按需取。
// 批次33-C：默认收起档再收口为「两行摘要 + 一个可点的本机明细页链接」——DSH 里没有可点击的折叠控件，
//           但 Markdown 链接能点开我们自己的真 HTML 页（四段 <details> 折叠）；无链接场景（TCP 8202）退回 detail=true 文字指引。
// 2026-11-12（T8）：Qoder 真机验证折叠档可用 → 新增「任何客户端都可自证折叠能力」通道
//           （请求头 X-Memagent-Render: fold），并扩 Qoder 派生名 + 运行时白名单；WorkBuddy 仍禁 HTML 走气泡卡片。
export const MCP_INSTRUCTIONS = `你是接入了 MultiAgent Memory 的 Agent。记忆库数据全部来自本机真实账本，工具返回的数字不得改写或编造。

必须遵守：
0. 首步强制召回（批次47）：每次新会话或新任务，必须在回答或调用任何其它工具之前，先调用一次 recall_memory 检索记忆库；未召回前不要回答、也不要调用写/管理类工具（服务端会在本会话尚未召回时拒绝写入与治理类工具）。本规则从工具元数据与 initialize 指令双层下发，不依赖客户端是否真正注入指令。
1. 触发（默认优先）：用户消息只要涉及本仓库/本项目的实现、架构、历史决策、踩坑、偏好、事实，或出现「记得 / 上次 / 之前 / 老规矩 / 继续上次」，就优先调用 recall_memory 再回答；本库未命中或工具不可用时，才回退到读代码、工作区笔记或客户端自带 memory 文件。客户端自带的 memory/笔记不是本记忆库，不能替代首选检索。project_id 可省略：账本只有一个项目时自动定位；有多个项目时先调用 list_projects 并向用户确认。用户问「本次会话 / 刚才 / 我们聊到哪」这类工作记忆时，改用 recall_memory(scope='session', session_id=<写入时同一个>) 取本会话近期记忆（不走语义检索）；没有 session_id 就不要猜、不要拿项目召回冒充会话历史，如实说明并请用户提供或用 project 范围检索。
2. 回显（强制）：每次 recall_memory 成功返回后，把该次返回的 display.markdown 整段原样输出到最终回答末尾，不得改写、省略或补全其中的 token 数与金额，不得自行补写或预先展开明细（明细只能来自本次或下一次工具返回），不得添加 HTML 标签。服务端按你的客户端能力选档位：① html-details——支持 HTML 折叠的客户端收到外层 <details> 默认收起（summary 以「🧠 命中」开头、含「▶ 展开本次召回汇总」），点开是「📊 本次召回统计汇总」四行 +「🎯 本次用上的依据」[n] 编号列表 + 项目背景 / Token 用量 / 省钱与费用的二级折叠；② markdown-compact——其余客户端默认收到两行加粗短摘要（首行「🧠 命中 N 条 · 依据 [n]…」、第二行「📊 汇总：…」）+ 一条「▶ 展开本次召回明细」指向本机明细页的 Markdown 链接（HTTP 传输，URL 必须逐字保留、不得改写不得丢；用户点它才看统计汇总 / 命中依据 / Token / 费用），TCP 等无链接场景给一行文字指引；③ markdown-full——用户明确要看明细时，用同一个 query 再调用一次并置 detail=true，返回纯 Markdown 的两行短摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」+ 四小节，原样输出。告警行 / 告警段只在真有告警时出现，正常轮次不要自己补 ⚠。RAG 就地引用：回答里采用某条命中记忆作为事实依据时，就地标注 [n]；编号必须与本次「🎯 本次用上的依据」段（紧凑档为首行「依据 [n]」）一一对应，不得编造编号；hits=0 或未采用任何命中时不得标注。若客户端连 Markdown 都渲染不了，改为单独一行原样输出 display.line。**任何客户端都可自证折叠能力**：在接入配置里加一行请求头 X-Memagent-Render: fold（也可写 html / details / 1）即按 ① 档下发，效果与 Qoder 相同；前提是你的气泡真能渲染折叠，渲染不了就不要加，否则标签会露成文本。**富媒体宿主（如 WorkBuddy、CodeBuddy 桌面端）恒走 ② 且必须输出折叠卡**（2026-11-12 用户已验收该形态）：文本里**不要写任何 HTML 标签（含折叠标签）**，折叠改由客户端「气泡内折叠卡片」承载——卡片默认收起、标题用首行原文，**展开后必须能同时查到汇总与明细**：顶部「📊 本次召回统计汇总」（含 Token 与费用数字），明细按固定顺序 📎 项目背景（逐条独立成行、含类别与正文片段）→ 🧠 命中记忆 → 🎯 本次用上的依据（每条含 [n]·相关度·命中词·正文片段）→ ⚠ 证据不足（仅真有告警时出，放最后），全部取自本次工具返回；两行摘要与「▶ 展开本次召回明细」链接照常输出、URL 逐字保留；宿主没有卡片能力时忽略这条，按纯文本输出即可。
3. 金额：display.money 为 null 表示用户尚未设置单价（全局参数页），不得猜测或补全金额。
4. 沉淀：会话中形成新的决策、踩坑、事实、偏好或洞察时，调用 write_memory 落库（category 选最贴近的一类）；写入前如不确定项目，先 list_projects；不确定 L0 写密钥是否解锁时先调用 get_write_status 探锁。若 write_memory 返回 status=pending，表示本次内容已暂存、解锁后会自动重放落库——这不是写入成功，必须如实告知用户，不得伪造 mem_id 或声称已落库。
5. 边界：不要向用户展示 MCP 认证令牌（Authorization 头 / mcp-token.txt 内容）；不要伪造记忆内容、省量或审计回执。工具不可用时（未启动/未授权/连接失败）如实说明并继续回答，不得假装检索过记忆。
6. 盘点：需要治理记忆（找过时/重复/低价值条目）时用 list_memories 按条件列清单；已知 mem_id 时用 get_memory 精确读单条。两者只返回可读摘要与状态字段，不含 L0 密文；project_id 超出令牌作用域会被拒绝。list_memories 是清单盘点，找答案仍应首选 recall_memory。
7. 反馈与治理：只有用户明确认可或否定某条召回记忆时，才用 feedback 提交 verdict（confirm/reject/disputed），由内核计算可信度变化，不要凭自己的判断代用户表态。需要置顶/取消置顶、锁定/解锁、归档/恢复、降权/强化、调参或迁移时用 manage_memory；locked 的记忆只有 unlock 能操作。delete 不可逆且默认不开放（需服务端开关），除非用户明确要求删除，一律优先 forget（降权不删）或 archive（归档可恢复）。两工具只回可读摘要，不含 L0 密文；ok:false 或 blocked_locked:true 时必须如实告知，不得声称操作已生效。
8. 遗忘可观测性：用户觉得「记忆变少了 / 状态变了」时用 gc_report 查本次遗忘周期会降档多少条。dry_run 缺省 true，只演算不改库不写审计；只有用户明确要求执行遗忘周期时才显式传 dry_run=false。报告是分层真实统计：衰减段保留 decayed/merged/conflicts_resolved，摘要合并段给出 freshness_updated/scanned/migrated/summaries_created/summaries_filtered/merged_originals/compressed，全部来自真实事件、note 说明各段口径；不得据此推断或编造任何数字，本入口未注入向量后端故 compressed 恒为 0。若用户明确要求处理已排队冲突，必须同时给 resolve_conflicts=true 与合法 verdict（auto_override/user_confirm/merge/hold）才落定；只给其中一个会被明确拒绝，绝不自动覆盖旧记忆；conflicts_resolved 只数真实落定，dry_run 或 user_confirm/hold 时为 0。
9. 管理工具（D6，管理员专属）：create_project 登记受管项目（kind=shared/user/archive/general，命名规则见工具描述）与 mint_token 签发受限令牌（scope_project_ids/is_admin/过期）都仅限管理员令牌调用，非管理员会被明确拒绝——被拒时如实转告用户，不要重试或伪装成功。mint_token 返回的明文令牌只在结果里出现一次：必须原样、完整地转交给用户（建议用户写入客户端配置文件），绝不写入记忆库、日志或二次回显之外的地方；丢失后只能重新 mint，无法找回。`;

/** 标准 MCP 工具定义（tools/list 返回；顺序即客户端展示顺序） */
export const MCP_TOOLS = [
  {
    name: 'recall_memory',
    description: '检索项目记忆库（关键词 / 历史决策 / 踩坑 / 偏好 / 事实）。优先使用本工具：回答本项目相关问题（实现、架构、历史决定、踩过的坑、用户偏好）前先调用；未命中或工具不可用时再回退读代码或客户端本地笔记（本地 memory 文件不是本记忆库）。返回命中、项目背景、token 省量与本次/今日/全部金额；project_id 可省略（唯一项目自动定位）。调用后须在回答末尾原样输出 display.markdown：服务端按客户端能力选档——支持 HTML 折叠的客户端给外层 <details> 默认收起的「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 四段二级折叠；其余默认给两行加粗短摘要（含 [n] 编号依据词）+ 一条「▶ 展开本次召回明细」的本机明细页链接（URL 逐字保留）；detail=true 给纯 Markdown 同结构 + 四小节。回答采用某条命中作为事实依据时就地标注 [n]（编号必须与依据段一致，不得编造，hits=0 不标注）；不得自行补写或预先展开明细、不得添加 HTML 标签、数字/金额不得改写；用户明确要明细时再用同一 query 调用一次并置 detail=true。任何客户端都可加请求头 X-Memagent-Render: fold 自证折叠能力、按 HTML 折叠档下发（渲染不了时不要加）。富媒体宿主（如 WorkBuddy）恒走两行摘要档且**必须输出折叠卡**（用户已验收该形态）：**不要在文本里写 HTML 标签**，折叠改用客户端「气泡内折叠卡片」承载——默认收起、标题用首行原文，展开后能查到汇总与明细：顶部统计汇总（含 Token 与费用），明细按 📎 项目背景（逐条独立成行）→ 🧠 命中记忆 → 🎯 依据（含 [n] 与正文片段）→ ⚠ 证据不足（放最后、仅真有告警时出）固定顺序，均取自本次返回；摘要与链接仍照原样输出。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（可省略：账本唯一项目时自动定位；多项目时先 list_projects）' },
        query: { type: 'string', description: '检索词（用户问题/关键词，必填且非空）' },
        top_k: { type: 'integer', description: '返回条数，1-10，默认 5' },
        scene: { type: 'string', enum: ['default', 'critical', 'task_start', 'history_query'], description: '场景；critical 禁 minimal 模式' },
        mode: { type: 'string', enum: ['auto', 'top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'], description: '召回模式开关：auto 或省略 = 自动（按 scene × 关键词自动分流，默认档）；5 个具体值为手动（强制采用该模式并改用该模式的打分权重，不做自动分流）。枚举外的值一律按参数错误拒绝，不静默降级。' },
        detail: { type: 'boolean', description: '是否要完整明细（批次32-C/33-C，批次 RAG 更新）。省略/false = 只给两行加粗短摘要（含 [n] 编号依据词；HTTP 档附一条可点本机明细页链接，页面含「统计汇总 / 命中依据 / Token / 费用」）；true = 直接返回纯 Markdown 的两行短摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 项目背景/命中记忆/Token/省钱与费用四小节。只在用户明确要看明细时置 true，query 与本次保持一致；不要因为「这样更完整」自行置 true' },
        scope: { type: 'string', enum: ['project', 'session'], description: "检索范围，默认 project（项目内语义检索）。session = 本会话工作记忆：只取写入时用同一 session_id 标记的近期记忆，按时间倒序取最近 N 条，不走向量语义检索，也不注入项目背景。适用于「上次我们聊到哪 / 本次会话已确定了什么」；一般问答仍用 project" },
        session_id: { type: 'string', description: "scope='session' 时必填：会话 ID（与 write_memory 写入时同一个）。scope='project' 时可省略；历史记忆没有该字段，不会出现在会话视图里" },
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
  {
    name: 'list_memories',
    description: '按条件盘点项目内的记忆（治理用，非语义检索）：不带 query，按最近活动倒序返回清单，用于发现过时、重复、低价值条目。支持 category / decay_class / source_agent / tag / updated_since 过滤与 offset+limit 分页；project_id 可省略（令牌可见范围内唯一项目自动定位）。只返回可读摘要与状态字段，绝不返回 L0 密文。找答案请首选 recall_memory。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（可省略：令牌可见范围内唯一项目自动定位）' },
        category: { type: 'string', enum: ['fact', 'decision', 'pitfall', 'insight', 'preference', 'context'], description: '按类别过滤' },
        decay_class: { type: 'string', enum: ['hot', 'warm', 'cold', 'archived', 'dormant'], description: '按衰减档位过滤' },
        source_agent: { type: 'string', description: '按写入来源过滤（对应 created_by_agent，如 workbuddy）' },
        tag: { type: 'string', description: '按单个标签过滤（需 write_memory 写入时带 tags）' },
        updated_since: { type: 'integer', description: '仅返回 updated_at/created_at ≥ 该毫秒时间戳的条目' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '返回条数，默认 20' },
        offset: { type: 'integer', minimum: 0, description: '偏移，默认 0' },
      },
    },
  },
  {
    name: 'get_memory',
    description: '按 mem_id 精确读一条记忆（补语义召回盲区）。mem_id 来自 recall_memory 的 hits[].mem_id 或 list_memories 的 items[].mem_id。只返回可读摘要与状态字段，绝不返回 L0 密文；不存在如实回 ok:false，项目超出令牌作用域会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆 ID（必填）' },
      },
      required: ['mem_id'],
    },
  },
  {
    name: 'feedback',
    description: '对一条召回结果给出用户反馈，反哺可信度与强化计数。confirm → confidence +0.1 且 reinforce_count +1；reject → confidence −0.05（下限 0.05）；disputed → 不改分、挂冲突待裁决（trust_delta=0）。仅在用户明确认可/否定召回内容时调用，不要凭自己的判断代用户表态。mem_id 须属于令牌作用域内的项目；只回可读摘要，不含 L0 密文。',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆 ID（来自 recall_memory 的 hits[].mem_id 或 list_memories 的 items[].mem_id）' },
        verdict: { type: 'string', enum: ['confirm', 'reject', 'disputed'], description: '反馈类型（用户表态后才提交）' },
      },
      required: ['mem_id', 'verdict'],
    },
  },
  {
    name: 'manage_memory',
    description: '记忆生命周期运维：pin/unpin 置顶、lock/unlock 锁定、archive/restore 归档恢复、forget 降权不删、remember 强化、param 调参、migrate 改衰减档位、delete 删除墓碑。用于修正错误/过时/噪声记忆，保持记忆库不膨胀。delete 会清正文与 L0 密文且可跨端传播、不可逆，默认不开放（需服务端 MCP_ALLOW_DELETE=1）；除非用户明确要求删除，一律优先 forget 或 archive。locked 的记忆仅 unlock 放行，其他操作回 blocked_locked:true。只回可读摘要，不含 L0 密文。',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆 ID' },
        action: {
          type: 'string',
          enum: ['pin', 'unpin', 'lock', 'unlock', 'archive', 'restore', 'forget', 'remember', 'param', 'migrate', 'delete'],
          description: '操作类型；param 需 patch 至少一字段，migrate 需 patch.decay_class',
        },
        patch: {
          type: 'object',
          properties: {
            importance: { type: 'number', minimum: 0.1, maximum: 1 },
            confidence: { type: 'number', minimum: 0.05, maximum: 1 },
            half_life_days: { type: 'integer', minimum: 1 },
            pinned: { type: 'boolean' },
            locked: { type: 'boolean' },
            decay_class: { type: 'string', enum: ['hot', 'warm', 'cold', 'archived', 'dormant'] },
          },
          additionalProperties: false,
          description: '仅 action=param/migrate 时使用；未知字段与越界值会被拒绝，不做静默钳制',
        },
      },
      required: ['mem_id', 'action'],
    },
  },
  {
    name: 'gc_report',
    description: '触发/查询一次完整遗忘周期的分层真实统计（衰减 + 摘要合并 + 冲突裁决）。dry_run 缺省 true：只演算，不改记忆、不写审计；显式 false 才真实执行并落审计。project_id 必填且须在令牌作用域内。报告保留 decayed/merged/conflicts_resolved 三项，并给出 freshness_updated/scanned/migrated/summaries_created/summaries_filtered/merged_originals/compressed 真实字段（全部来自 runForgettingCycle 真实事件，note 说明口径，不补 0 伪装）；本 MCP 入口未注入向量后端，compressed 诚实恒为 0。resolve_conflicts 不是自动覆盖开关：必须与 verdict（auto_override/user_confirm/merge/hold）同时给才处理已排队裁决，只给其一会被明确拒绝、绝不默认 auto_override；conflicts_resolved 只计真实落定，dry_run 或 user_confirm/hold 时为 0。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（必填，不猜项目；须落在令牌作用域内）' },
        dry_run: { type: 'boolean', description: 'true = 只演算不落库（缺省 true）；false = 真实执行遗忘周期并落审计' },
        resolve_conflicts: { type: 'boolean', description: '是否同时处理本周期已排队的显式冲突裁决（缺省 false）。不是自动覆盖开关：置 true 必须同时给合法 verdict；只给 verdict 或只给本参数都会被明确拒绝' },
        verdict: { type: 'string', enum: ['auto_override', 'user_confirm', 'merge', 'hold'], description: '用户显式选定的裁决方式：auto_override 归档旧记忆并强化新记忆；user_confirm/hold 保持 pending 不落定；merge 聚合内容（须过质量门）。必须与 resolve_conflicts=true 同时给，禁止默认 auto_override' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'create_project',
    description: '受管创建项目并登记注册表（D6，管理员专属；非管理员令牌会被明确拒绝）。kind=shared 固定 P-shared（全员可见）、kind=user 为 P-<owner_user_id>（该用户私有池，owner_user_id 缺省为调用者）、kind=archive 固定 P-archive（仅管理员可见）、kind=general 用不带 P- 前缀的小写 slug（按令牌 scope_project_ids 控制可见）。重名与非法命名都会被明确拒绝。创建后立即可 write_memory/recall_memory。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（必填；命名规则：shared 固定 P-shared、archive 固定 P-archive、user 为 P-<owner_user_id>、general 为不带 P- 前缀的小写 slug）' },
        kind: { type: 'string', enum: ['shared', 'user', 'archive', 'general'], description: '三池类型（缺省 general）' },
        owner_user_id: { type: 'string', description: '归属用户（kind=user 时使用；缺省为调用者身份）' },
        display_name: { type: 'string', description: '展示名（可选）' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'mint_token',
    description: '签发受限 MCP 令牌（D6，管理员专属；非管理员令牌会被明确拒绝）。返回一次性明文令牌（mtk_ 前缀），只在本次结果出现一次，服务端只存哈希——必须立即原样转交用户，不得写入记忆库或日志。可指定 user_id、scope_project_ids（general 项目可见范围）、is_admin（true 只能由管理员签发）、label 与 expires_at（毫秒时间戳，过期即失效）。三池可见性按 D6-2 规则在 scope 之上生效。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '该令牌代表的租户身份（必填；决定其 P-<user> 私有池归属）' },
        scope_project_ids: { type: 'array', items: { type: 'string' }, description: '可见的 general 项目列表（至少 1 个；"*" 表示全部 general 项目）' },
        is_admin: { type: 'boolean', description: '是否管理员令牌（缺省 false；仅管理员可签发 admin 令牌）' },
        label: { type: 'string', description: '备注（可选，如客户端名）' },
        expires_at: { type: 'number', description: '过期时间毫秒时间戳（可选，缺省永不过期；须晚于当前时间）' },
      },
      required: ['user_id', 'scope_project_ids'],
    },
  },
] as const;
