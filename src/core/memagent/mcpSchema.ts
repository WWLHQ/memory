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
/**
 * 第四层·轮级放行的专用文案（2026-11-17）。
 * 为什么必须另写一句：轮级判定下「本会话尚未调用」会变成假话——上一轮明明召回过。
 * 用户看到「没查」和「上一轮查了但这轮没查」要做的事完全不同，文案不能混。
 */
export const RECALL_ROUND_GATE_MSG =
  '⛔ 本轮尚未调用 recall_memory：你上一轮调用过，但用户这次的新问题还没有重新检索记忆库。服务端按「轮」判定，除 recall_memory 外的所有工具在本轮均被锁定——请先针对本轮问题调用一次 recall_memory（换 query，不要原样重复上一轮），再继续本操作。';
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
 * 反馈快捷通道（2026-11-22 用户拍板方案一）：卡片「N 有用 ↗」「N 没用 ↗」按钮经宿主 sendPrompt 变成用户消息。
 * 单一真源——initialize 指令、feedback 工具描述、recallEchoNote 三处均引用本常量，杜绝第二套词表彼此矛盾。
 * 用户已明确豁免「首步必须全文召回」铁律的**这一个特例**：只做 top_k=1 解锁门禁（仍在首步调 recall_memory，
 * 不违背铁律的「先召回」，只是降级为极轻量、不回显、不作答案来源），直接拿到上一条卡片的 mem_id 提交反馈。
 */
export const RECALL_FEEDBACK_FAST_NOTE =
  ' **反馈快捷通道（卡片按钮专用）**：当用户消息**整条只有**「N 有用」「N 没用」（可带 ↗ 或句末标点，如「2 有用 ↗」），且紧接你上一条召回回显卡：'
  + '① 这是用户对卡片 [N] 的明确表态——目标 mem_id = 上一条卡片 hits[N-1].mem_id（不是新召回结果），「有用」→ confirm、「没用」→ reject；'
  + '② 严格门禁下直接 feedback 会被硬拦：先调一次 recall_memory(top_k=1) 解锁本轮门禁，这次召回只为过门禁、不回显、不作答案来源；'
  + '③ 调 feedback(mem_id=<目标>, verdict=<confirm|reject>)，**不要加 implicit**（用户已明确表态）；若返回 duplicate:true 说明已记过，不要重试；'
  + '④ 只回一句「已记录：第 N 条标记有用/没用」，不要再输出召回回显卡、不要长篇分析；'
  + '⑤ 消息还含其它诉求、N 超出上一条卡片命中数、或定位不到上一条卡片时，不走本通道，按正常流程处理并如实说明。';

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
// 2026-11-21 用户明确「禁止用 HTML」：回显物 display.markdown 三档一律零标签（无折叠/高亮标签）。
// 2026-11-21 三次拍板：富媒体宿主（WorkBuddy/CodeBuddy 桌面端）「卡片即回显」——不再原样输出 `▶ ⚙ …` 文本行，
//          改用组件折叠卡独占回显区（卡片标题 2 行、无大黑三角 ▶、小箭头展开），文本行与卡片二选一、绝不并存；
//          无组件能力的客户端仍回退 display.line。
// 批次 RAG 保留：📊 本次召回统计汇总 + 🎯 本次用上的依据 [n] + 四段平铺（加粗标题），
//         回答正文就地标注 [n]（编号与依据段一致、不得编造）；三档与明细页段名逐字一致。
// 批次14：触发措辞由「禁用本地检索」改为「优先用本库」——未命中/不可用时允许回退代码与本地笔记，
//         避免客户端在工具未命中时无法继续；同时明示客户端自带 memory 文件不是本记忆库。
// 批次32-C：不支持 HTML 折叠的客户端（DSH 实测只渲染 Markdown）默认只给一行摘要，明细改由 recall_memory 的 detail=true 按需取。
// 2026-11-21 用户二次纠偏：默认收起档（compact）**只有一行摘要**——链接行与 📌 提示行全部删掉，
//           展开只靠行首黑三角 ▶ + 客户端气泡折叠卡；本机明细页 URL 仍下发在 detail_url 字段里给需要的客户端，但不写进 display.markdown。
// 2026-11-12（T8）：Qoder 真机验证折叠档可用 → 新增「任何客户端都可自证折叠能力」通道
//           （请求头 X-Memagent-Render: fold），并扩 Qoder 派生名 + 运行时白名单；判档逻辑不动，载体三档统一零 HTML 走气泡卡片。
export const MCP_INSTRUCTIONS = `你是接入了 MultiAgent Memory 的 Agent。记忆库数据全部来自本机真实账本，工具返回的数字不得改写或编造。

必须遵守：
0. 首步强制召回（批次47）：每次新会话或新任务，必须在回答或调用任何其它工具之前，先调用一次 recall_memory 检索记忆库；未召回前不要回答、也不要调用写/管理类工具（服务端会在本会话尚未召回时拒绝写入与治理类工具）。本规则从工具元数据与 initialize 指令双层下发，不依赖客户端是否真正注入指令。
1. 触发（默认优先）：用户消息只要涉及本仓库/本项目的实现、架构、历史决策、踩坑、偏好、事实，或出现「记得 / 上次 / 之前 / 老规矩 / 继续上次」，就优先调用 recall_memory 再回答；本库未命中或工具不可用时，才回退到读代码、工作区笔记或客户端自带 memory 文件。客户端自带的 memory/笔记不是本记忆库，不能替代首选检索。project_id 建议显式传入本机默认业务项目 P1；省略时账本若只有一个项目会自动定位，多项目（含系统共享池）会报错。严格首步门禁下必须先调用 recall_memory，完成首步后才可调用 list_projects 等其它工具，切勿在首步召回前先调 list_projects。用户问「本次会话 / 刚才 / 我们聊到哪」这类工作记忆时，改用 recall_memory(scope='session', session_id=<写入时同一个>) 取本会话近期记忆（不走语义检索）；没有 session_id 就不要猜、不要拿项目召回冒充会话历史，如实说明并请用户提供或用 project 范围检索。
2. 回显（强制）：每次 recall_memory 成功返回后，把该次返回的 display.markdown 整段原样输出到最终回答末尾，不得改写、省略或补全其中的 token 数与金额，不得自行补写或预先展开明细（明细只能来自本次或下一次工具返回），**不得添加任何 HTML 标签**（折叠标签、高亮标签一律不用）——**唯一例外**：当 display.mode 为 bubble-details（服务端下发的就是真 <details>/<summary> 折叠块）时本条不适用，必须把 <details>/<summary> 原样保留、不得转义、不得包进代码围栏，否则客户端收不到可点开的气泡。**必须整段原样输出 display.markdown，不得按「摘要行」自行重建（仅非富媒体宿主；WorkBuddy/CodeBuddy 须改用 show_widget 出卡、不输出文本摘要行）**——摘要就是**一整行**：行首「▶ ⚙ 模式简称」（黑三角 ▶ 是展开标记；⚙ 模式段 A6 起固定下发，摘要里只用简称如「事实优先」，完整分流来源 / 命中特征词见 detail 档；会话视图无模式段但仍有 ▶），接着「🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…） ｜ 今日 N 次 ｜ 全部 N 次」，告警短版（⚠ …）内联在行尾；金额只留本次、今日/全部只留次数（已压到约 2 行宽）。服务端按你的客户端能力选档位（**只有 bubble-details 档含真 HTML 折叠标签，其余各档一律零 HTML 标签**）：⓪ bubble-details——在接入配置声明 X-Memagent-Render: fold 的客户端（如 DSH 桌面端）收到**真 <details>/<summary> 折叠块**（外层默认收起、点击展开，展开是统计汇总 + [n] 依据 + 四段二级折叠），必须整段原样输出、不得删除标签、不得转义成 &lt;details&gt;、不得包进代码围栏；① html-details——白名单客户端（qoder 系）收到一整行摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 📎 项目背景 / 💠 命中记忆 / ⚡ Token 用量 / 💰 省钱与费用四段加粗平铺；② markdown-compact——其余客户端默认收到**仅一整行摘要**（同上），没有第二行、没有明细页链接、没有提示语，输出必须与 display.markdown 完全一致；③ markdown-full——用户明确要看明细时，用同一个 query 再调用一次并置 detail=true，返回纯 Markdown 的一行摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」+ 四段加粗小节，原样输出。告警只在真有告警时出现，正常轮次不要自己补 ⚠。RAG 就地引用：回答里采用某条命中记忆作为事实依据时，就地标注 [n]；编号必须与本次「🎯 本次用上的依据」段一一对应，不得编造编号；hits=0、未采用任何命中、或当前是 compact 档（摘要行不含编号，需 detail=true 才有依据段）时不得凭空标注。若客户端连 Markdown 都渲染不了，改为单独一行原样输出 display.line（该行同样以 ▶ 开头，不得省略）。**富媒体宿主（WorkBuddy、CodeBuddy 桌面端）走「卡片即回显」，卡片与文本摘要行二选一、绝不并存**（2026-11-21 用户最终拍板）：这类宿主能把回显渲染成组件折叠卡时，**不要再原样输出那行「▶ ⚙ 模式 …」文本摘要**——用宿主组件工具渲染一张**默认收起**的折叠卡，放在回答末尾的召回回显区（不要插在正文中间）；**卡片标题压成 2 行、不要大黑三角 ▶、用小箭头（▸/▾）标示可展开且箭头放大到清晰可见**，**标题固定排两行**：第一行 = 模式简称 ｜ 🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ **⚡ 省 …t（省量放第一行末尾）**；第二行 = 💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次，**在「全部 N 次」后紧跟灰色小字「点击查阅详细内容」**（不另起一行）；去掉行首 ▶；**卡片之后不要再输出任何文字**（不写「卡片已作为会话最后一条内容输出」这类括注/说明，卡片必须是回答最后一条）；**展开后必须能同时查到汇总与明细**：展开区最顶部先放一行召回模式——取 display.card.mode（如「⚙ 模式：自动（分流建议极简 · 本轮按默认口径执行）」），这是本次生效模式的完整分流依据，标题第一行只有简称、展开区必须补上完整口径；mode 为 null（会话视图）时不渲染这一行；紧接其下是「📊 本次召回统计汇总」（含 Token 与费用数字），明细按固定顺序 📎 项目背景（逐条独立成行、含类别与正文片段）→ 💠 命中记忆 → 🎯 本次用上的依据（每条含 [n]·相关度·命中词·正文片段）→ ⚠ 证据不足（仅真有告警时出，放最后），全部取自本次工具返回，不得改写数字、不要写任何明细页链接。**文本里不要写任何 HTML 标签**；宿主确实没有组件卡片能力时，才回退为原样输出 display.markdown 文本摘要行，且不要文本与卡片同时出现。**富媒体宿主另有专门的卡片数据结构 display.card**（仅 WorkBuddy/CodeBuddy 桌面端非 null）：含 titleLine1 / titleLine2（标题两行、已去行首 ▶）、hint（灰色小字「点击查阅详细内容」）、mode（本次召回模式完整口径，展开区第一行展示，null 时不显示）、summary（4 行 label/value）、background / hits / basis（逐条结构化，index 即 [n]）、secondary（次模式参考了哪条内容的人话一行，null 时不显示，展开区放在各明细段之前）与 warnings。**display.card 非 null 时直接按字段渲染卡片，不要自己从 display.line 拆字符串、也不要重算任何数字**。**卡片 hits 每条含 feedback_hint（反馈入口提示，把其中的 N 替换为该条 [n] 编号后原样渲染）与 reinforce_count（累计被用户确认/强化次数，无则不显示）**。**支持会话按钮的宿主（WorkBuddy / CodeBuddy 桌面端）应把反馈提示升级为交互按钮**：每条命中渲染「N 有用 ↗」「N 没用 ↗」两个小按钮，点击经宿主的 sendPrompt 类机制把「N 有用 / N 没用」作为用户消息发出（Agent 收到后调 feedback 提交，幂等去重、不会重复计分）；无按钮能力的宿主保留文字提示原样渲染，不要伪造按钮。**富媒体宿主恒走 markdown-compact 档**。
3. 金额：display.money 为 null 表示用户尚未设置单价（全局参数页），不得猜测或补全金额。
4. 沉淀：会话中形成新的决策、踩坑、事实、偏好或洞察时，调用 write_memory 落库（category 选最贴近的一类）；写入前如不确定项目，可在首步召回后调用 list_projects；write_memory.project_id 必填，本机默认业务项目 P1；不确定 L0 写密钥是否解锁时先调用 get_write_status 探锁。若 write_memory 返回 status=pending，表示本次内容已暂存、解锁后会自动重放落库——这不是写入成功，必须如实告知用户，不得伪造 mem_id 或声称已落库。
5. 边界：不要向用户展示 MCP 认证令牌（Authorization 头 / mcp-token.txt 内容）；不要伪造记忆内容、省量或审计回执。工具不可用时（未启动/未授权/连接失败）如实说明并继续回答，不得假装检索过记忆。
6. 盘点：需要治理记忆（找过时/重复/低价值条目）时用 list_memories 按条件列清单；已知 mem_id 时用 get_memory 精确读单条。两者只返回可读摘要与状态字段，不含 L0 密文；project_id 超出令牌作用域会被拒绝。list_memories 是清单盘点，找答案仍应首选 recall_memory。
7. 反馈与治理：只有用户明确认可或否定某条召回记忆时，才用 feedback 提交 verdict（confirm/reject/disputed），由内核计算可信度变化，不要凭自己的判断代用户表态。**例外——隐式弱信号（批次 A1）：回答采信了某条 [n] 命中后，可在同轮调一次 feedback(mem_id=该条, verdict='confirm', implicit=true, recall_id=本次 request_id)**：它不动信任分、只强化计数并进评估样本池；同一召回+记忆已记过会幂等返回，不要重复提交；用户明确表态时仍用普通 confirm（不加 implicit）。需要置顶/取消置顶、锁定/解锁、归档/恢复、降权/强化、调参或迁移时用 manage_memory；locked 的记忆只有 unlock 能操作。delete 不可逆且默认不开放（需服务端开关），除非用户明确要求删除，一律优先 forget（降权不删）或 archive（归档可恢复）。两工具只回可读摘要，不含 L0 密文；ok:false 或 blocked_locked:true 时必须如实告知，不得声称操作已生效。${RECALL_FEEDBACK_FAST_NOTE}
8. 遗忘可观测性：用户觉得「记忆变少了 / 状态变了」时用 gc_report 查本次遗忘周期会降档多少条。dry_run 缺省 true，只演算不改库不写审计；只有用户明确要求执行遗忘周期时才显式传 dry_run=false。报告是分层真实统计：衰减段保留 decayed/merged/conflicts_resolved，摘要合并段给出 freshness_updated/scanned/migrated/summaries_created/summaries_filtered/merged_originals/compressed，全部来自真实事件、note 说明各段口径；不得据此推断或编造任何数字，本入口未注入向量后端故 compressed 恒为 0。若用户明确要求处理已排队冲突，必须同时给 resolve_conflicts=true 与合法 verdict（auto_override/user_confirm/merge/hold）才落定；只给其中一个会被明确拒绝，绝不自动覆盖旧记忆；conflicts_resolved 只数真实落定，dry_run 或 user_confirm/hold 时为 0。
9. 管理工具（D6，管理员专属）：create_project 登记受管项目（kind=shared/user/archive/general，命名规则见工具描述）与 mint_token 签发受限令牌（scope_project_ids/is_admin/过期）都仅限管理员令牌调用，非管理员会被明确拒绝——被拒时如实转告用户，不要重试或伪装成功。mint_token 返回的明文令牌只在结果里出现一次：必须原样、完整地转交给用户（建议用户写入客户端配置文件），绝不写入记忆库、日志或二次回显之外的地方；丢失后只能重新 mint，无法找回。
10. 钩子健康度自检（recall_hook_status，第 13 个工具）：强制召回钩子跑在**宿主侧**、不在本服务进程内，失败时只写本机状态文件——Agent 侧原本完全看不见，这正是本项目历史上「钩子静默失效多日」的成因。出现以下情况必须调用它：① 用户问「记忆库是否正常 / 召回可不可信 / 今天怎么没读到记忆」；② 本轮召回结果可疑（命中 0 条但你确信库里有相关内容）、或召回工具报错；③ 你要在回答里断言「记忆库没有相关内容」之前。它返回最近一次执行结果（ok / empty / failed + 中文原因 + 时间 + 注入条数）、距今多久，以及最关键的「从未执行过」（状态文件不存在 = 钩子没装、安装路径写错、或从未触发）。**verdict 为 failed / never_ran / stale 时，必须在回答里如实写明「本轮强制召回未生效，我已回退现查」并给出原因，不得静默跳过、不得假装检索过**；verdict 为 ok / empty 时不要额外打扰用户。务必区分两件事：**「记忆库没命中」≠「钩子没生效」**——前者是真没有相关记忆，后者是根本没检索，混为一谈等于用「库里没有」掩盖「没查」。
11. 自进化与画像（growth_evolve，批次 B/C/D）：用户问「进化/权重/评估怎么样」→ action=status（只读）；评估产了建议且用户明确说「采纳」→ action=adopt（重过护栏后写 growth:v1，护栏不过会被明确拒绝，如实转告不要重试）；用户问「我常用什么场景/画像」→ action=profile（只读派生，可删，只提示不改配置）；用户明确要启用/停用「连续 reject 降档」→ action=policy（enabled 必填，全局真源与参数页同源）。富媒体宿主的卡片 summary 已带「进化」行（模式/最近评估/近期降档数），回答时可直接引用，不要重算数字；adopt/policy 是写操作，必须用户明确表态才调，不要替用户决定。`;

/** 标准 MCP 工具定义（tools/list 返回；顺序即客户端展示顺序） */
export const MCP_TOOLS = [
  {
    name: 'recall_memory',
    description: '检索项目记忆库（关键词 / 历史决策 / 踩坑 / 偏好 / 事实）。优先使用本工具：回答本项目相关问题（实现、架构、历史决定、踩过的坑、用户偏好）前先调用；未命中或工具不可用时再回退读代码或客户端本地笔记（本地 memory 文件不是本记忆库）。返回命中、项目背景、token 省量与本次/今日/全部金额；project_id 可省略（唯一项目自动定位）。调用后须在回答末尾原样输出 display.markdown：**文本通道零 HTML 标签**，摘要恒为一整行（行首「▶ ⚙ 模式简称」+「🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次」，告警短版内联行尾，已压到约 2 行宽）。服务端按客户端能力选档，但三档 markdown 都不含折叠/高亮标签：折叠能力自证客户端收到一行摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 📎 项目背景 / 💠 命中记忆 / ⚡ Token 用量 / 💰 省钱与费用四段平铺；其余默认仅一整行摘要（无链接、无提示语）；detail=true 给纯 Markdown 同结构（一行摘要 + 统计汇总 + 依据 + 四段小节）。原样整段输出 display.markdown，不得按「摘要行」重建而丢掉行首 ▶ 与 ⚙ 模式段。回答采用某条命中作为事实依据时就地标注 [n]（编号必须与依据段一致，不得编造；hits=0 或 compact 档摘要行无编号时不标注）；不得自行补写或预先展开明细、不得添加 HTML 标签（**唯一例外**：display.mode 为 bubble-details 时，服务端下发的 `<details>`/`<summary>` 必须原样保留、不得转义或包进代码围栏）、数字/金额不得改写；用户明确要明细时再用同一 query 调用一次并置 detail=true。任何客户端都可加请求头 X-Memagent-Render: fold 自证折叠能力（渲染不了不要加；声明后拿 bubble-details 档，即真 `<details>`/`<summary>` 气泡，默认收起、点击展开）。富媒体宿主（如 WorkBuddy、CodeBuddy 桌面端）恒走 markdown-compact 档且**卡片即回显**：**不要原样输出那行 `▶ ⚙ 模式 …` 文本摘要**（文本行与卡片二选一、绝不并存），改用 show_widget 工具渲染一张默认收起的折叠卡（必须调用，只输出文本摘要行不算出卡），放在回答末尾的召回回显区；卡片标题压 2 行、无大黑三角 ▶、用小箭头（▸/▾）标示可展开且箭头放大到清晰可见；第一行 = 模式简称 ｜ 命中/背景条数与 t ｜ ⚡ 省量（放第一行末尾），第二行 = 本次金额 ｜ 今日/全部次数，**「全部 N 次」后紧跟灰色小字「点击查阅详细内容」**（不另起一行）；去掉行首 ▶，卡片之后不输出任何文字（不写括注）；展开后能查到汇总与明细：展开区最顶部先放一行召回模式——取 display.card.mode（如「⚙ 模式：自动（分流建议极简 · 本轮按默认口径执行）」），这是本次生效模式的完整分流依据，标题第一行只有简称、展开区必须补上完整口径；mode 为 null（会话视图）时不渲染这一行；紧接其下是统计汇总（含 Token 与费用），明细按 📎 项目背景（逐条独立成行）→ 💠 命中记忆 → 🎯 依据（含 [n] 与正文片段）→ ⚠ 证据不足（放最后、仅真有告警时出）固定顺序，均取自本次返回；文本里不要写 HTML 标签、不要写任何明细页链接；宿主无组件能力才回退纯文本摘要行。**富媒体宿主另有专门的卡片数据结构 `display.card`**（2026-11-21 新增，仅 WorkBuddy/CodeBuddy 桌面端非 null）：含 `titleLine1`/`titleLine2`（卡片标题两行，已去行首 ▶）、`hint`（灰色小字「点击查阅详细内容」）、`mode`（本次召回模式完整口径，展开区第一行展示，null 时不显示）、`summary`（统计汇总 4 行 label/value）、`background`/`hits`/`basis`（逐条结构化，含 index 即 [n]，hits 每条另含 feedback_hint 反馈提示与 reinforce_count 强化次数）、`secondary`（次模式参考内容人话一行，null 不显示，展开区放在各明细段之前）与 `warnings`。**display.card 非 null 时，直接按它的字段渲染折叠卡，不要自己从 display.line 里拆字符串、也不要重算任何数字**——它是标题与明细的唯一真源，保证卡片与文本摘要同口径。卡片必须放在回答绝对末尾、其后零文字。',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID（建议显式传本机默认业务项目 P1；唯一项目时可省略自动定位，多项目会报错）' },
        query: { type: 'string', description: '检索词（用户问题/关键词，必填且非空）' },
        top_k: { type: 'integer', description: '返回条数，1-10，默认 5' },
        scene: { type: 'string', enum: ['default', 'critical', 'task_start', 'history_query'], description: '场景；critical 禁 minimal 模式' },
        mode: { type: 'string', enum: ['auto', 'top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'], description: '召回模式开关：auto 或省略 = 自动（按 scene × 关键词自动分流，默认档）；5 个具体值为手动（强制采用该模式并改用该模式的打分权重，不做自动分流）。枚举外的值一律按参数错误拒绝，不静默降级。' },
        detail: { type: 'boolean', description: '是否要完整明细（批次32-C/33-C，批次 RAG 更新）。省略/false = 只给一整行加粗摘要（行首 ▶ + ⚙ 模式段，没有链接行与提示行；展开靠气泡折叠卡，明细页 URL 在 detail_url 字段里按需取）；true = 直接返回纯 Markdown 的一行摘要 +「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 📎 项目背景/💠 命中记忆/⚡ Token 用量/💰 省钱与费用四小节。三档一律零 HTML 标签，折叠靠客户端气泡卡。只在用户明确要看明细时置 true，query 与本次保持一致；不要因为「这样更完整」自行置 true' },
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
        project_id: { type: 'string', description: '项目 ID（必填，本机默认业务项目 P1；不确定时可在首步召回后调用 list_projects 查询）' },
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
    name: 'recall_hook_status',
    description: '钩子健康度自检：确认「首步强制召回」是否真的生效。强制召回钩子跑在宿主侧，失败时只写本机状态文件，Agent 侧原本看不见——本工具把这个事实源暴露出来。返回最近一次执行结果（ok / empty / failed + 中文原因 + 时间 + 注入条数）、距今多久、状态文件路径，以及最关键的 verdict=never_ran（状态文件不存在 = 钩子没装 / 安装路径写错 / 从未触发，此时「首步强制召回」完全没生效）。verdict 也可能是 stale（超过 12 小时无新记录，钩子可能被卸载）。何时调用：用户问「记忆库是否正常 / 召回可不可信 / 怎么没读到记忆」时；本轮召回结果可疑或工具报错时；要在回答里断言「记忆库没有相关内容」之前。判定 failed / never_ran / stale 时必须如实告知用户「本轮强制召回未生效，我已回退现查」，不得静默或假装检索过；ok / empty 时不必额外打扰用户。「记忆库没命中」不等于「钩子没生效」，两者必须分开表述。只读本机状态文件，不含任何令牌、prompt 正文或记忆内容。',
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
    name: 'growth_evolve',
    description: '自进化与场景画像（批次 B/C/D + 7.2 分流族）。action=status：查进化状态（模式 off/suggest/auto、当前召回权重、最近一次评估结论、待采纳的召回权重建议与分流建议、分流基线来源），只读；action=adopt：一键采纳最近一条建议——family 省略/recall_weights 采纳召回权重（重过护栏后写 growth:v1，存历史、挂回诊计划）；family=mode_dispatch 采纳分流建议（重过冷却期后以内核快照/内核基线为基底整块重写 growth:v1.mode_dispatch，存历史），护栏不过或 mode=off 会明确拒绝；action=profile：场景画像（窗口内召回审计按 scene 聚合，只读派生、不落库，window_days 1–365 默认 30；删除对应审计画像即消失；只提示场景偏好，不自动改分流配置）；action=policy：反馈降档策略开关（enabled 必填布尔，可选 window_days 1–365 / reject_downgrade_threshold 1–50；全局真源与参数页同源，只降不升、不推 dormant）；action=rollback：分流族回诊（family 必填且仅 mode_dispatch，force 可选布尔=立即回诊；读采纳时写死的回诊计划，到期后用分流命中率=👍/(👍+👎模式选错) 判定，跌幅>max_drop 且负样本净增≥3 才局部回滚 mode_dispatch 块，配置已被后续采纳替换则跳过；快照/样本如实返回 insufficient/kept）。adopt/policy/rollback 会真实写配置，必须用户明确说「采纳」「启用/停用降档」「回诊/回滚」才调用，不要替用户决定。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'adopt', 'profile', 'policy', 'rollback'], description: '操作类型；status/profile 只读，adopt/policy/rollback 真实写配置（须用户明确表态）' },
        family: { type: 'string', enum: ['recall_weights', 'mode_dispatch'], description: '仅 action=adopt：要采纳哪一族建议，缺省 recall_weights（召回打分权重）；mode_dispatch = 召回模式自动分流词表' },
        enabled: { type: 'boolean', description: '仅 action=policy：反馈降档总开关' },
        window_days: { type: 'integer', description: 'action=profile 时为画像窗口 1–365（默认 30）；action=policy 时为降档统计窗口 1–365' },
        reject_downgrade_threshold: { type: 'integer', description: '仅 action=policy：窗口内累计 reject 降档阈值 1–50' },
        force: { type: 'boolean', description: '仅 action=rollback：忽略 due_at 立即回诊（仍需满足最小样本门槛）' },
      },
      required: ['action'],
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
    description: '对一条召回结果给出用户反馈，反哺可信度与强化计数。confirm → confidence +0.1 且 reinforce_count +1，并对已显式设置 half_life_days 的记忆延寿 +3 天（封顶 90，已 ≥90 不再动；未显式设置的不猜默认值）；reject → confidence −0.05（下限 0.05）；disputed → 不改分、挂冲突待裁决（trust_delta=0）。批次 A1 隐式弱信号：verdict=confirm 时可携 implicit=true（回答采信 [n] 后提交）——不动信任分、不延寿，只 reinforce_count+1 并进评估样本池；必须能归因到召回（建议携 recall_id=本次 request_id），同一召回+记忆幂等去重。仅在用户明确认可/否定召回内容时提交普通反馈，不要凭自己的判断代用户表态；implicit 只在回答确实采信了该条时提交。mem_id 须属于令牌作用域内的项目；只回可读摘要，不含 L0 密文。' + RECALL_FEEDBACK_FAST_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆 ID（来自 recall_memory 的 hits[].mem_id 或 list_memories 的 items[].mem_id）' },
        verdict: { type: 'string', enum: ['confirm', 'reject', 'disputed'], description: '反馈类型（用户表态后才提交）' },
        implicit: { type: 'boolean', description: '可选，仅 verdict=confirm 时允许：true = 「引用即隐式确认」弱信号（不动信任分，只强化计数并进评估样本池；同一召回+记忆幂等去重）。与 reject/disputed 组合会被拒绝' },
        recall_id: { type: 'string', description: '可选：产生这条记忆的召回 request_id（recall_memory 回执里的 request_id），把反馈归因到具体召回；缺省则按「最近一次含该 mem_id 的召回」自动关联；关联不到只做信任分更新，不伪造标签。implicit=true 时强烈建议携带' },
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
