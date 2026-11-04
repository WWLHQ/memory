// L0→L1 质量过滤器（§2.1 清洗红线）：拦截无用/低质信息，禁止其进入 L1 污染记忆库。
// 设计原则（诚实、不静默）：
//   · 纯函数（可单测），不做 IO
//   · 拦截 = 返回 { ok:false, reason }（调用方据此跳过入库 + 审计留痕，绝不静默吞掉）
//   · 规则按"宁严勿滥"：宁可多拦一条无用的，不留一条垃圾进 L1
//   · 批次10：新增「打招呼 / 纯身份询问 / 助手自述与能力清单」判定——
//     按子句切分后逐一归类，**任一子句含具体信息（数字/英文技术词/代码符号）即放行**，
//     只有全部子句都是元信息时才拦截（避免误伤“你能帮我排查 Redis 超时吗”这类真实问题）。
//   · 批次35：修批次10 的漏网口径（本机账本实测 22 条助手自述/过程旁白入库）——
//     ① 判定前先剥离 Markdown 装饰：`**需求分析**` 的 `*` 曾是「技术证据」，格式替内容逃过判定；
//     ② 停用词表补厂商/产品/通用IT词，且证据判定在**去停用词后**才看符号（“网站 / 桌面应用”的斜杠不算证据）；
//     ③ 新增「过程旁白 / 行动自述 / 记忆簿自操作」类别（我先看一下… / 接下来检查… / 现在写… / 更新 HANDOVER…）；
//     ④ 元信息段判定用「硬事实」豁免（错误码/实测数值/文件名/命令/带单位数值），
//       裸版本号与产品名不算硬事实（“我是 Claude Haiku 4.5”仍是自述）；
//     ⑤ 过程旁白按**整句**口径：同一行只要还有另一句是实际描述或要求就不当旁白丢弃
//       （本库实测「我验证下是否可以显示」「尽量在可控范围内完成」这类用户消息同样命中旁白句式，
//        祈使/约束词另判，见 NARRATION_GUARD_RE）。
//   · 批次36-A：判定口径变更须同步 `QUALITY_GATE_VERSION` +1，并按稳定 `QualityBlockCode`
//     发码（中文 reason 可改写，英文码不能随便换——存量重判/只读回放按码对账）。
import { sanitizeL1, meaningfulLength, MIN_MEANINGFUL_CHARS, MIN_MEANINGFUL_WITHOUT_FACTS } from './layerRules.ts';

/**
 * 质量门规则版本（批次36-A）：**改动本文件的判定口径必须 +1**。
 * 入库时把版本号盖在记忆行的 `quality_gate_v` 上，「存量重判」（rejudge）才能回答
 * 「这行是被哪一版规则放进来的」。历史行没有这个字段 → 按 v1（批次35 以前的口径）处理，
 * 绝不猜它是最新版。
 */
export const QUALITY_GATE_VERSION = 3;

/**
 * 拦截原因码（批次36-A）：跨版本**稳定**的英文码，专供回放器与重判统计用。
 * 中文 `reason` 给人看、可以随版本改写；要按类别对账的一律用 `code`。
 */
export type QualityBlockCode =
  | 'empty' | 'thin'
  | 'greeting' | 'separator' | 'empty_heading' | 'decoration' | 'bare_link' | 'bare_json'
  | 'bare_number' | 'comment_only' | 'import_only' | 'require_only'
  | 'meta_question' | 'identity' | 'capability_list' | 'disclaimer' | 'narration'
  /** 批次40-B：短**且**无硬事实（两个条件同时成立才拦，见 `MIN_MEANINGFUL_WITHOUT_FACTS`） */
  | 'short_low_signal';

export interface QualityCheckResult {
  /** 是否通过质量门（true = 可进 L1；false = 拦截） */
  ok: boolean;
  /** 拦截原因（ok=false 时填，供审计） */
  reason?: string;
  /** 拦截原因码（ok=false 时填；跨版本稳定，回放/重判按它统计） */
  code?: QualityBlockCode;
  /** 清洗后内容（ok=true 时返回 L1 脱敏产物；ok=false 时无意义） */
  content?: string;
}

/** 无信息量模式（对脱敏后文本全匹配 → 拦截） */
const NOISE_PATTERNS: { re: RegExp; code: QualityBlockCode; reason: string }[] = [
  { re: /^\s*(ok|okay|好的|嗯|嗯嗯|哈哈|呵呵|行|可以|没问题|对的|是的|对|是的呢|好的好的|👍|okk|OK|Ok|嗯嗯嗯|收到|了解|明白|当然|当然可以|当然啦|好呀|好滴|好嘞|可以呀|行呀)\s*[!！.。~～]*\s*$/, code: 'greeting', reason: '纯寒暄/确认语，无信息量' },
  { re: /^\s*[\r\n\s]*$/, code: 'empty', reason: '空内容' },
  { re: /^-{3,}\s*$/, code: 'separator', reason: '分隔线' },
  { re: /^={3,}\s*$/, code: 'separator', reason: '分隔线' },
  { re: /^\s*#{1,6}\s*$/, code: 'empty_heading', reason: '空标题（仅 # 符号）' },
  { re: /^\s*(\*{3,}|_{3,})\s*$/, code: 'decoration', reason: '装饰线' },
  { re: /^\[[^\]]*\]\s*$/, code: 'bare_link', reason: '裸链接（无正文）' },
  { re: /^"[^"]*"\s*$/, code: 'bare_json', reason: '裸 JSON 字符串值' },
  { re: /^\d+\s*$/, code: 'bare_number', reason: '纯数字（无上下文）' },
  { re: /^\/\//, code: 'comment_only', reason: '纯注释行（//）' },
  { re: /^\s*import\s+(?:[\w{}*,\s]+from\s+)?['"][\w@/.:-]+['"];?\s*$/, code: 'import_only', reason: '纯 import 语句（无逻辑）' },
  { re: /^\s*(?:const|let|var)?\s*[\w]+\s*=\s*require\s*\(\s*['"][^'"]*['"]\s*\);?\s*$/, code: 'require_only', reason: '纯 require 语句（无逻辑）' },
];

/* ---------- 批次10：元信息噪声（打招呼 / 纯身份询问 / 助手自述与能力清单） ---------- */

const AI_WORD_SRC = '(?:AI|ai|人工智能|大语言模型|大模型|语言模型|智能助手|聊天机器人|机器人|助手|模型)';
// 厂商 / 产品 / 模型名（批次35 扩充）：这些词出现在「我是 X / 由 X 开发」里正是被拦对象，
// 因此既进身份正则，也从「技术证据」里扣掉（见 TECH_STOP）。技术实体名（Redis/nginx/PostgreSQL）不在此列。
const MODEL_NAME_SRC =
  '(?:ChatGPT|GPT(?:-\\d+(?:\\.\\d+)?)?|Claude(?:\\s*(?:Code|Code\\s*CLI|CLI|Agent|Desktop))?|Anthropic|OpenAI|' +
  'DeepSeek(?:-[\\w.]+)?|Gemini(?:\\s*CLI)?|Qwen(?:\\s*Code)?|通义千问|文心一言|豆包|Kimi|Llama|Mistral|Grok|' +
  'Copilot|GLM|智谱清言|腾讯元宝|讯飞星火|混元|Haiku|Sonnet|Opus|Agnes|Sapiens|WorkBuddy|Trae|Cursor|Codex|' +
  'MiniMax|阶跃|StepFun|Moonshot|iFlow|Qoder|CodeBuddy)';
const MODEL_NAME_RE = new RegExp(MODEL_NAME_SRC, 'gi');

/**
 * 模型 ID 形态（批次35）：`Agnes-3.0-flash` / `claude-haiku-4-5` / `gpt-4o-mini`
 * —— 连字符/点分 + 数字的名字串，出现在「我是 X」里就是身份自述，不是技术事实。
 */
const MODEL_ID_RE = /^[A-Za-z][A-Za-z0-9]*(?:[._+-]\d+(?:[._-]\d+)*)?(?:[._+-][A-Za-z0-9]+)+$/;

/**
 * 剥离 Markdown 装饰（批次35，只用于**判定**，落库正文不受影响）：
 * `**加粗**`/`__`/`~~`/行内 `` ` ``/`>` 引用/`#` 标题/`—`–` 破折号 → 去掉或换成空格。
 * 保留围栏代码块内容（代码本身就是强证据）。
 */
const DECOR_RE = /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s?|[|]\s*)|(?:\*\*|__|~~|`+)/g;
function stripDecoration(text: string): string {
  return text
    .replace(DECOR_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [文案](链接) → 文案
    .replace(/[—–‒]/g, ' ')
    .replace(/[ \t\u3000]+/g, ' ')            // 只压水平空白：清单结构（换行）要留给 bareListItems
    .trim();
}


/** 子句首部的打招呼（“你好，你是谁”先剥问候再判询问） */
const LEADING_GREETING_RE =
  /^(?:(?:你好|您好|大家好|嗨|哈喽|哈啰)[呀啊哈呢哦啦喔哟]?|\b(?:hello|hi|hey)\b)[，,\s]*/i;

/** 整句=纯问候（可带语气词/emoji，调用前已去尾部标点符号） */
const GREETING_RE = new RegExp(
  '^(?:你好|您好|大家好|嗨|哈喽|哈啰|早上好|上午好|中午好|下午好|晚上好|晚安|在吗|在不在|好久不见|' +
  'hello|hi|hey|yo|greetings|good (?:morning|afternoon|evening))[ 　]*(?:there|all)?(?:呀|啊|哈|呢|哦|啦|喔|哟)?$',
  'i',
);

/** 整句=客套/礼貌语 */
const POLITE_RE = new RegExp(
  '^(?:请问|请教一下|我想问一下|想问一下|麻烦(?:你|您)?|谢谢(?:你|您)?|多谢|感谢(?:你|您)?|thanks?|thank you|thx|' +
  '不客气|请|辛苦了|周末愉快|祝好|请多指教|多多关照|很高兴(?:为你|为您|能)?(?:服务|解答|提供帮助|见到你|认识你)|' +
  '很高兴(?:为你|为您)(?:服务|解答))$',
  'i',
);

/** 整句=身份/能力询问（“你是谁 / 你是什么模型 / 你能做什么 / 我可以帮你做什么”） */
const META_QUESTION_RE = new RegExp(
  '^(?:请问|问一下|我想(?:知道|了解)|想知道|想了解)?\\s*(?:你|您)\\s*(?:到底|究竟|现在|目前)?\\s*(?:' +
    '是\\s*(?:(?:谁|哪位|什么(?:' + AI_WORD_SRC + ')?|哪个(?:' + AI_WORD_SRC + ')?|真人|机器人)' +
      '(?:开发|训练|打造|出品|研发)?的?|哪家(?:公司)?(?:开发|训练|打造|出品|研发)?的?(?:' + AI_WORD_SRC + ')?)' +
    '|是\\s*(?:做|干)(?:什么|啥)(?:的|工作)?' +
    '|是\\s*' + AI_WORD_SRC + '(?:\\s*助手)?\\s*吗' +
    '|是\\s*' + MODEL_NAME_SRC + '\\s*吗' +
    '|是不是(?:AI|ai|人工智能|机器人|真人|' + AI_WORD_SRC + ')' +
    '|叫(?:什么|啥)(?:名字)?' +
    '|(?:会|能|可以|能够|可)(?:帮我|帮您|为我|给我)?(?:做|干|完成)?\\s*(?:什么|哪些|啥)(?:' + AI_WORD_SRC + '|工作|事情|任务|功能|能力|用处|服务)?' +
    '|有(?:什么|哪些|啥)(?:功能|能力|用处|作用|问题)' +
    '|的(?:功能|能力|用处|作用)(?:是)?(?:什么|哪些)?' +
    '|(?:会|能|可以|能够|可)(?:帮我|帮您|为我|给我)?(?:吗|么|嘛)' +
  ')(?:呀|啊|呢|哦|嘛)?\\s*[?？]?$',
);

/** 自问“我是谁/我是什么模型/我叫什么” */
const SELF_QUESTION_RE = new RegExp(
  '^我(?:是|叫)\\s*(?:谁|什么(?:' + AI_WORD_SRC + ')?|哪个(?:' + AI_WORD_SRC + ')?|啥(?:' + AI_WORD_SRC + ')?)' +
    '(?:呀|啊|呢|哦|嘛)?\\s*[?？]?$',
);

/** “还有/有什么可以帮您的吗”类服务性询问 */
const SERVICE_QUESTION_RE =
  /^(?:请问)?(?:还)?(?:有)?什么(?:可以|能|需要)?(?:帮|为)(?:到)?(?:你|您)(?:的|做的|什么)?(?:吗|么|嘛)?$/;

/** “我能帮你做什么”类自问（主句以“我”开头） */
const SELF_OFFER_QUESTION_RE = new RegExp(
  '^我(?:能|可以|会|能够|可)(?:帮你|帮您|为你|给您|给你)?(?:做|干|完成)?\\s*(?:什么|哪些|啥)' +
    '(?:' + AI_WORD_SRC + '|工作|事情|任务)?(?:呀|啊|呢|哦|嘛)?\\s*[?？]?$',
);

/** 身份自述（“我是 DeepSeek / 我是一个 AI 助手 / I'm an AI assistant”） */
const IDENTITY_RE = new RegExp(
  '^(?:(?:你的|您的)?\\s*(?:一个|一名|一款|一位)?\\s*' + AI_WORD_SRC + '(?:\\s*(?:助手|语言模型|模型|机器人))?|' +
  MODEL_NAME_SRC + '(?:\\s*(?:AI|助手|语言模型|模型|聊天机器人))?)$',
);
const EN_IDENTITY_RE = new RegExp(
  '^i(?:\'m| am)\\s+(?:an?\\s+|your\\s+)?(?:ai(?:\\s+(?:assistant|language model|model))?|artificial intelligence|' +
  'large language model|language model|chatbot|assistant|chatgpt|claude|deepseek|gemini|gpt(?:-?\\d+)?|qwen|llama)' +
  '(?:\\s+(?:assistant|model|chatbot))?$',
  'i',
);
/** 身份自述的续句（“由深度求索公司开发”）——仅在前一子句是身份自述时生效 */
const IDENTITY_CONT_RE = /^(?:是由|由|来自|基于|属于)\s*.{0,24}?(?:开发|训练|打造|出品|提供|推出|研发|构建|架构)(?:的)?$/;
/**
 * 批次35 续句扩表（仍只在身份自述之后生效）：
 *  · “Anthropic 开发的官方 CLI 工具”——厂商开头、不带“由”
 *  · “底层使用的是 Claude Haiku 4.5（模型 ID：claude-haiku-4-5）”
 *  · “这是 Anthropic 的轻量快速模型” / “专为高效对话和编程任务设计” / “可以切换到更高级的模型”
 */
const IDENTITY_CONT2_RE = new RegExp(
  '^(?:' +
    '[A-Za-z\\u4e00-\\u9fa5]{2,14}\\s*(?:公司|团队|实验室|机构)?\\s*(?:开发|训练|打造|出品|研发|推出)的?(?:\\s*(?:官方|开源|商业|旗下)?[\\w\\s\\u4e00-\\u9fa5]{0,14})?' +
    '|(?:底层|实际|背后|目前)?\\s*(?:使用|运行|接入)的是[^。]{0,60}$' +
    '|这?\\s*是\\s*[\\w.\\u4e00-\\u9fa5]{2,16}\\s*的[\\u4e00-\\u9fa5]{0,12}(?:模型|助手|产品|工具|插件)' +
    '|专为[\\u4e00-\\u9fa5]{2,16}(?:设计|优化|打造)' +
    '|如果?你?需要更强的[\\u4e00-\\u9fa5]{2,10}(?:能力|推理|表现)' +
    '|可以?切换到[\\w\\s\\u4e00-\\u9fa5（）()如]{2,30}' +
  ')$',
);


/** “作为 AI 助手”类免责/身份前缀（要求整句就是该短语，避免误伤“作为 AI 产品经理…”） */
const AS_AI_RE = new RegExp(
  '^(?:作为|身为)(?:一个|一名|一位)?\\s*(?:AI|ai|人工智能|大语言模型|大模型|语言模型|智能助手|聊天机器人|机器人)' +
    '(?:\\s*助手)?$',
);
const EN_DISCLAIMER_RE = /^i (?:cannot|can't|don't have access to|do not have access to|am unable to)\b/i;

/** 能力清单开头（“我可以帮你做以下工作”） */
const CAPABILITY_START_RE = /^我(?:还|也|现在|目前)?(?:可以|能|会|能够|可)(?:帮你|帮您|为你|给您|给你|帮|为)?\s*(.*)$/;
const CAPABILITY_HEAD_RE = /^(?:我的|我)?(?:主要)?(?:功能|能力|作用|用处|服务范围)(?:主要)?(?:包括|有|是|如下|这些)?[:：]?$/;
const CAPABILITY_INTRO_RE = /^(?:以下|下面|这些)是(?:我|我的)?(?:能做的|可以做的|能力|功能|服务范围|能帮你做的|可以帮你做的)[:：]?$/;
const EN_CAPABILITY_RE = /^i (?:can|will|am able to) (?:help|assist)(?: you)?(?: with| in)?\s*(.*)$/i;
const EN_LIST_FRAGMENT_RE = new RegExp(
  '^(?:and\\s+)?(?:writing|reading|coding|programming|debugging|analy[sz]ing|data analysis|answering questions?|' +
  'translating|summari[sz]ing|brainstorming|research|creative writing|problem[- ]solving|general questions?|' +
  'various tasks)(?: (?:tasks?|questions?|code|data|text))?$',
  'i',
);

/** 通用能力词（列表片段判定用） */
const CAPABILITY_VERB_RE =
  /写|编写|编程|生成|分析|整理|回答|解答|翻译|总结|汇总|处理|搜索|查询|检索|优化|创建|制作|设计|讲解|解释|调试|排查|聊天|陪聊|协助|解决|学习|润色|改写|扩写|续写|推荐|规划|阅读/;

/**
 * 通用能力用语片段（长词在前；用于“剔除后是否还剩实质内容”的判定）。
 * 只在这些片段全部剔除、且无技术证据时才判为能力清单，避免误伤真实任务描述。
 */
const GENERIC_FRAGMENTS = [
  'instructions', 'questions', '数据', '等等', '以及', '包括', '例如', '比如', '主要是', '主要',
  '我们', '你们', '帮你', '帮您', '为你', '为您', '给你', '给我', '帮助', '协助', '配合', '服务', '支持',
  '以下', '下面', '这些', '上述', '各种', '各类', '很多', '许多', '一些', '一下', '相关', '其他', '其它', '任何', '所有', '日常',
  '工作', '事情', '任务', '功能', '能力', '用处', '作用', '问题', '代码', '程序', '数据', '文本', '内容', '信息',
  '方案', '建议', '图片', '文档', '表格', '文件', '知识', '想法', '需求', '翻译', '聊天', '写作', '创意', '灵感',
  '编写', '编程', '生成', '分析', '整理', '回答', '解答', '总结', '汇总', '处理', '搜索', '查询', '检索', '优化',
  '创建', '制作', '设计', '讲解', '解释', '调试', '排查', '陪聊', '协助', '解决', '学习', '润色', '改写', '扩写', '续写',
  '推荐', '规划', '阅读', '理解', '交流', '沟通', '讨论', '写', '做', '干', '完成', '提供', '进行',
  '可以', '能够', '能', '会', '可', '还', '也', '都', '就', '是', '的', '地', '得',
  '以及', '和', '与', '及', '并且', '并', '等', '大家', '我', '你', '您', '帮', '为', '给', '做', '干',
].sort((a, b) => b.length - a.length);

/** 技术证据里的常见英文停用词（模型名/寒暄词不算“具体信息”） */
const TECH_STOP = new Set([
  'ai', 'llm', 'gpt', 'chatgpt', 'claude', 'deepseek', 'gemini', 'qwen', 'kimi', 'llama', 'mistral', 'grok',
  'copilot', 'glm', 'hello', 'hi', 'hey', 'yo', 'thanks', 'thank', 'thx', 'please', 'you', 'your', 'yours',
  'can', 'could', 'would', 'will', 'what', 'which', 'who', 'how', 'are', 'is', 'am', 'the', 'an', 'a',
  'and', 'or', 'to', 'of', 'in', 'with', 'for', 'do', 'does', 'model', 'models', 'assistant', 'chat',
  'chatbot', 'bot', 'help', 'able', 'this', 'that', 'there', 'here', 'good', 'morning', 'afternoon', 'evening',
  // 批次35：厂商名与「通用 IT 词」不算具体信息（“Anthropic 开发的官方 CLI 工具”仍是自述）
  'anthropic', 'openai', 'sapiens', 'moonshot', 'stepfun', 'minimax', 'haiku', 'sonnet', 'opus', 'agnes',
  'workbuddy', 'trae', 'cursor', 'codex', 'iflow', 'codebuddy', 'qoder',
  'code', 'codes', 'cli', 'api', 'sdk', 'ide', 'ui', 'ux', 'app', 'apps', 'web', 'tool', 'tools',
  'official', 'version', 'flash', 'lite', 'pro', 'max', 'mini', 'default', 'new', 'old',
]);

/** 空格分隔的排版符号（“网站 / 桌面应用”里的斜杠）不是代码证据；贴着字的（`E_AUTH`、`D:\tmp`）才是 */
const LOOSE_SYM_RE = /(?<=^|\s)[_<>{}[\]()=+*/\\|`~^$#@](?=$|\s)/g;

/**
 * 具体信息证据：数字 / 代码符号 / 文件扩展名 / 非停用的英文技术词 → 该子句有实质内容。
 * 批次35：先去 Markdown 装饰、再摘掉停用词，最后才看符号——否则 `**需求分析**` 的 `*`
 * 会自己充当“技术证据”，把能力清单救活（本机账本实测漏网的头号原因）。
 */
function hasTechEvidence(text: string): boolean {
  let t = stripDecoration(text);
  for (const w of t.match(/[A-Za-z][A-Za-z0-9-]{1,}/g) ?? []) {
    if (TECH_STOP.has(w.toLowerCase())) t = t.split(w).join(' ');
  }
  t = t.replace(LOOSE_SYM_RE, ' ');
  if (/\d/.test(t)) return true;
  if (/[_<>{}[\]()=+*/\\|`~^$#@]/.test(t)) return true;
  if (/\.(?:js|ts|tsx|jsx|py|go|rs|java|kt|json|ya?ml|toml|sql|sh|bat|ps1|md|log|env|ini|conf|db|csv|html|css)\b/i.test(t)) {
    return true;
  }
  for (const w of t.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []) {
    if (!TECH_STOP.has(w.toLowerCase())) return true;
  }
  return false;
}

/**
 * 硬事实（批次35 段级判定用）：错误码 / HTTP 状态码 / 带单位数值 / 配置项名 / 命令行 /
 * 带扩展名的文件名或路径。用于决定「身份自述段 / 能力清单段 / 过程旁白段」能否豁免入库。
 * 刻意**不含**裸版本号与裸产品名——“我是 Claude Haiku 4.5”里的 `4.5` 是自述的一部分，不是事实沉淀。
 */
const HARD_FACT_RES: RegExp[] = [
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,                       // E_AUTH / DATABASE_URL
  /\b[a-z][a-z0-9]*_[a-z0-9_]{2,}\b/,                    // proxy_read_timeout
  /\b[1-5]\d{2}\s*(?:状态码|code|错误|报错|返回)/i,          // 502 状态码
  /(?:错误|报错|返回|状态码|code)\D{0,4}\d{3}\b/i,            // 错误是 500
  /\d+(?:\.\d+)?\s*(?:ms|秒|分钟|小时|天|次|KB|MB|GB|%|x|倍|端口)/i, // 60s / 120 次
  /\d+\s*(?:处|个|条|项|轮|文件|模块|用例|会话|请求|行|列|表)/,  // 补 4 处 / 6 个会话
  /(?:版本|内部版本|version|build|sp)\s*(?:是|为|[:：])?\s*[\d.]+/i, // SolidWorks 版本是 2020 SP5
  /[A-Za-z_]\w*\s*\(/,                                   // apiData() 这类函数/调用现场
    /[A-Za-z_][\w.-]*\s*[=＝]\s*0?\.\d+/,                  // a=0.767 / ratio=0.42 这类实测数值
  /\b(?:npm|npx|pnpm|yarn|git|curl|docker|kubectl|make|pip|python|node|powershell|msbuild|regasm)\b/i,
  /[A-Za-z]:[\\/][\w.\-\\/]*\.\w{1,6}\b/,                // C:\app\nginx.conf
  /(?:^|[\s(=])[/.][\w.\-/]*\.\w{1,6}\b/,                // /etc/hosts
  /\b[\w.-]+\.(?:js|ts|tsx|jsx|py|go|rs|java|kt|kts|json|ya?ml|toml|sql|sh|bash|bat|cmd|ps1|md|log|env|ini|conf|cfg|xml|html?|css|scss|svg|cs|cpp|sln|csproj|zip|pdf|proto|sldprt|sldasm|dll|exe)\b/i,
  /\b(?:错误码|状态码|端口|阈值|超时|参数|配置项)\D{0,6}\d/,   // 端口 5432 / 超时 60
];

function hasHardFacts(text: string): boolean {
  const t = stripDecoration(text);
  return HARD_FACT_RES.some((re) => re.test(t));
}

/** 去掉列表序号/项目符号（“1. 写代码” / “- 分析数据”） */
function stripListMarker(clause: string): string {
  return clause.replace(/^\s*(?:\d{1,2}[.、)）]|[-*•·])\s+/, '').trim();
}

/** 剔除通用片段后是否不剩实质内容 */
function isGenericPhrase(text: string): boolean {
  let rest = stripListMarker(text).replace(/[\s\p{P}\p{S}]/gu, '');
  if (!rest) return true;
  for (let round = 0; round < 5 && rest; round++) {
    let changed = false;
    for (const frag of GENERIC_FRAGMENTS) {
      if (rest.includes(frag)) {
        rest = rest.split(frag).join('');
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rest.replace(/[的了呢吧啊哦呀哈嘛么]/g, '') === '';
}

function isIdentityClause(core: string): boolean {
  if (EN_IDENTITY_RE.test(core)) return true;
  const m = /^(?:我(?:是|叫)|我就(?:是|叫))\s*(.+)$/.exec(core);
  if (!m) return false;
  const tail = m[1].trim();
  // 批次35：模型 ID 形态（Agnes-3.0-flash / gpt-4o-mini）也是身份自述——名字里带版本号不构成事实
  return IDENTITY_RE.test(tail) || MODEL_ID_RE.test(tail);
}

function isDisclaimerClause(core: string): boolean {
  if (AS_AI_RE.test(core)) return true;
  if (EN_DISCLAIMER_RE.test(core)) return true;
  if (/^我(?:无法|不能|没办法|不具备|没有)/.test(core) && /(?:实时|最新|互联网|外部信息|个人数据|真实数据)/.test(core)) {
    return true;
  }
  if (/^(?:没有|无法获取|不能访问)/.test(core) && /(?:实时|最新|互联网|网络)/.test(core)) return true;
  return false;
}

function isCapabilityClause(core: string): boolean {
  const t = core.replace(/[:：]\s*$/, '').trim();
  if (CAPABILITY_HEAD_RE.test(t) || CAPABILITY_INTRO_RE.test(t)) return true;
  const en = EN_CAPABILITY_RE.exec(t);
  if (en) {
    const rest = (en[1] ?? '').trim();
    if (!rest) return true;
    return rest.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean).every((p) => EN_LIST_FRAGMENT_RE.test(p.trim()));
  }
  const m = CAPABILITY_START_RE.exec(t);
  if (!m) return false;
  const rest = m[1] ?? '';
  return !hasTechEvidence(rest) && isGenericPhrase(rest);
}

function isListFragment(core: string): boolean {
  const t = stripListMarker(core);
  if (!t || [...t].length > 40) return false;
  if (EN_LIST_FRAGMENT_RE.test(t)) return true; // 英文白名单先判（“answering questions” 含非停用词）
  if (hasTechEvidence(t)) return false;
  if (!CAPABILITY_VERB_RE.test(t)) return false;
  return isGenericPhrase(t);
}

/* ---------- 批次35：过程旁白 / 段级判定 ---------- */

/**
 * 第一人称「意图 / 进度」自述（助手旁白）：我先看一下…、接下来检查…、现在写…、我换用 X 工具、
 * 让我先…、X 完成了、X 能用了、目录是空的、是全新项目……
 * 刻意锚定句首且要求第一人称或未来/进度语气，避免误伤「部署前请检查 nginx upstream 超时配置」这类真实指引。
 */
const NARRATION_RE = new RegExp(
  '^(?:' +
    '我(?:先|这就|马上|来|去|再)?(?:看|检查|确认|查|看看|瞧|了解|熟悉|排查|试|跑|验证|读)(?:一下|一?下)?' +
    '|(?:接下来|下一步|然后|随后)我?(?:要|会|来|先|开始|继续)?(?:看|检查|确认|查|验证|测试|排查|写|实现|搭建|开发|处理|改|跑)' +
    '|现在(?:开始|我)?(?:写|做|实现|搭建|改|测试|开发|处理)' +
    '|我(?:换用|改用|使用|用|试试)(?:了)?[\\w\\s\\u4e00-\\u9fa5]{0,16}(?:工具|命令|方式|方法|方案|文件|目录)' +
    '|让我(?:先|来|看看|检查|确认|确认下)' +
    '|我?(?:这边|这里)?(?:开始|继续)(?:写|做|实现|处理|排查)' +
  ')',
);
/** 状态旁白：「X 能用了 / 跑通了 / 已就绪」「目录是空的」「是全新项目」「X 完成」 */
const NARRATION_STATE_RE =
  /(?:^|[\s，,、（(])(?:能用了|可以使用了|已就绪|跑通了|报错是噪音)(?:$|[\s（()）)。.，,、!！?？])/;
const NARRATION_DONE_RE = /^[\w\u4e00-\u9fa5 .-]{1,20}完成$/;
const NARRATION_EMPTY_RE = /^(?:目录|文件夹)?是空的$|^是全新项目$|^没有历史文件$/;
/** 顺带评价（「Shell CWD 环境有点问题」）：只对短片段生效，避免「有点问题」把真实故障描述也吃掉 */
const NARRATION_REMARK_RE = /^.{0,12}(?:有点|不太|有些)(?:问题|毛病|奇怪|麻烦|慢|卡)/;
/**
 * 助手对记忆/任务簿的自操作（批次35）：「更新记忆文件」「存记忆」「标记任务完成」「文档销项」「跑全链路回归」。
 * 这类句子描述的是助手怎么处置自己的账本，本身没有可复用的事实。
 */
const NARRATION_SELFOP_RE =
  /^(?:更新|存|写|记录|标记|建|跑|补|同步)(?:了)?[^。]{0,2}?(?:记忆|记忆文件|HANDOVER|状态|任务|待办|文档|销项|回归|全链路回归|自检|selftest)/i;

/**
 * 祈使/约束词（批次35）：带这些词的是**要求或约束**（用户指令常长这样），不是助手旁白。
 * 「尽量在可控范围内完成」「一定要保证效果」曾被 `…完成$` 误判为进度自述。
 * 只用多字词或句首词，别拿裸字判——裸「请」会把「有请求记录」当成指令，裸「要」会把「主要/需要」算进去。
 * 注意：本守卫只用于旁白判定，不影响质量门的其它规则。
 */
const NARRATION_GUARD_RE = new RegExp(
  '^(?:请|麻烦|记得|务必|最好|应该|需要|要|先|别)|不要|不可|不得|禁止|尽量|一定|必须|确保|保证|应当|需要|希望',
);

function isNarrationSentence(core: string): boolean {
  const t = stripDecoration(core);
  if (!t) return false;
  if (NARRATION_GUARD_RE.test(t)) return false; // 是要求，不是旁白
  return (
    NARRATION_RE.test(t) || NARRATION_STATE_RE.test(t) ||
    NARRATION_DONE_RE.test(t) || NARRATION_EMPTY_RE.test(t) ||
    NARRATION_SELFOP_RE.test(t) ||
    (t.length <= 24 && NARRATION_REMARK_RE.test(t))
  );
}

/** 项目符号列表项（“1. 写代码” / “- 分析数据”）→ 内容 + 是否短到像清单 */
const BULLET_RE = /^\s*(?:[-*•·]|\d{1,2}[.、)])\s+(.{1,24})$/;

/** 文本里「无技术证据的短列表项」条数（能力清单的结构性特征，不靠逐条词表穷举） */
function bareListItems(plain: string): number {
  let n = 0;
  for (const line of plain.split(/[\r\n]+/)) {
    const m = BULLET_RE.exec(line);
    if (m && !hasTechEvidence(m[1])) n++;
  }
  return n;
}

/** 短片段且无证据/无硬事实（「收到，明白」类），算元信息段里的「填充句」 */
function isFillerClause(t: string): boolean {
  if (t.length > 12) return false;
  return !hasTechEvidence(t) && !hasHardFacts(t);
}

/**
 * 整句是否为元信息（身份/免责/能力/清单/旁白/客套/填充）。
 * 先整句判旁白（锚定句首，整句是一句旁白就是旁白，不再被内部顿号切碎），
 * 再逐子句判——只有**每个**子句都是元信息，整句才算元信息。
 */
function isMetaSentence(sent: string): boolean {
  const s = stripListMarker(sent).trim();
  if (!s) return true;
  if (isNarrationSentence(s)) return true;
  const clauses = s.split(/[,，、]+/).map((c) => stripListMarker(c).trim()).filter((c) => c !== '');
  if (clauses.length === 0) return true;
  return clauses.every((c) => {
    const bare = c.replace(/[\s\p{P}\p{S}]+$/gu, '').trim();
    if (!bare) return true;
    if (GREETING_RE.test(bare) || POLITE_RE.test(bare)) return true;
    if (isNarrationSentence(bare)) return true;
    if (isIdentityClause(bare) || isDisclaimerClause(bare)) return true;
    if (isCapabilityClause(bare) || isListFragment(bare)) return true;
    const core = bare.replace(LEADING_GREETING_RE, '').trim();
    if (!core) return true;
    const qText = core.replace(MODEL_NAME_RE, '').trim();
    if (META_QUESTION_RE.test(qText) || SELF_QUESTION_RE.test(qText)
      || SERVICE_QUESTION_RE.test(core) || SELF_OFFER_QUESTION_RE.test(core)) {
      return !hasTechEvidence(qText);
    }
    return isFillerClause(bare);
  });
}

/**
 * 元信息回复判定：返回拦截原因，null = 未命中（放行）。
 * 任一子句无法证明是元信息 → 放行（保守优先，宁可放过不可错杀）。
 *
 * 批次35 补「段级判定」：逐子句口径要求**每个**子句都是元信息才拦，而助手自述/能力清单/过程旁白
 * 天然夹带产品名与版本号（“我是 Claude Haiku 4.5”“SolidWorks 版本、.NET 环境”），
 * 这些在旧 hasTechEvidence 里算“具体信息”→ 整段被放行（本机账本实测 22 条噪声就是这么进来的）。
 * 段级判定：**全段无硬事实**时，按「首句是身份自述 / 清单结构 / 旁白句式」整段拦。
 * 其中「过程旁白」用整句口径（每个句子都是旁白才拦）：本库 76 条实测回放显示，
 * 旁白句式同样出现在用户消息里（“我验证下是否可以显示”），只要同一段还有一句是
 * 实际描述或要求，就不能当成过程旁白丢弃。
 */
function metaReplyReason(text: string): { code: QualityBlockCode; reason: string } | null {
  const plain = stripDecoration(text);
  const parts = plain
    .split(/[。！？!?；;\r\n]+|[,，、]+/)
    .map((c) => stripListMarker(c).trim())
    .filter((c) => c !== '');

  if (parts.length > 0 && !hasHardFacts(plain)) {
    const lead = parts.find((c) => !GREETING_RE.test(c) && !POLITE_RE.test(c) && !LEADING_GREETING_RE.test(c));
    if (lead && (isIdentityClause(lead) || isDisclaimerClause(lead))) {
      return { code: 'identity', reason: '助手身份自述段，无可用信息' };
    }
    const capClauses = parts.filter((c) => isCapabilityClause(c) || isListFragment(c)).length;
    const bullets = bareListItems(plain);
    if (capClauses >= 2 || (bullets >= 3 && capClauses >= 1)) {
      return { code: 'capability_list', reason: '助手能力清单段，无可用信息' };
    }
    const sentences = plain
      .split(/[。！？!?；;\r\n]+/)
      .map((s) => stripListMarker(s).trim())
      .filter((s) => s !== '');
    const narration = parts.filter(isNarrationSentence).length;
    if (narration >= 1 && sentences.every(isMetaSentence)) {
      return { code: 'narration', reason: '助手过程旁白/进度自述，无可用信息' };
    }
  }

  const clauses = text.split(/[。！？!?；;\r\n]+|[,，、]+/);

  let hasGreeting = false;
  let hasPolite = false;
  let hasQuestion = false;
  let hasIdentity = false;
  let hasCapability = false;
  let hasDisclaimer = false;
  let anyClause = false;
  let prevIdentity = false;

  for (const rawClause of clauses) {
    const clause = stripListMarker(rawClause).trim();
    if (!clause) continue;
    anyClause = true;
    const bare = clause.replace(/[\s\p{P}\p{S}]+$/gu, '');
    // 整句问候先判（“Hi there” 不能再剥前缀，否则只剩 there）
    if (GREETING_RE.test(bare)) { hasGreeting = true; prevIdentity = false; continue; }
    const core = bare.replace(LEADING_GREETING_RE, '').trim();
    if (!core) { hasGreeting = true; prevIdentity = false; continue; }
    if (POLITE_RE.test(bare)) { hasPolite = true; prevIdentity = false; continue; }

    const qText = core.replace(MODEL_NAME_RE, '').trim();
    if (
      (META_QUESTION_RE.test(qText) || SELF_QUESTION_RE.test(qText)
        || SERVICE_QUESTION_RE.test(core) || SELF_OFFER_QUESTION_RE.test(core))
      && !hasTechEvidence(qText)
    ) {
      hasQuestion = true;
      prevIdentity = false;
      continue;
    }
    if (isIdentityClause(core)) { hasIdentity = true; prevIdentity = true; continue; }
    if (prevIdentity && (IDENTITY_CONT_RE.test(core) || IDENTITY_CONT2_RE.test(core))) { hasIdentity = true; continue; }
    if (isDisclaimerClause(core)) { hasDisclaimer = true; prevIdentity = false; continue; }
    if (isCapabilityClause(core)) { hasCapability = true; prevIdentity = false; continue; }
    if (isListFragment(core)) { hasCapability = true; prevIdentity = false; continue; }
    return null; // 任一实质性子句 → 放行
  }

  if (!anyClause) return null;
  if (hasQuestion) return { code: 'meta_question', reason: '纯身份/能力询问，无可用信息' };
  if (hasIdentity) return { code: 'identity', reason: '助手自我介绍/能力清单，无可用信息' };
  if (hasCapability) return { code: 'capability_list', reason: '助手自我介绍/能力清单，无可用信息' };
  if (hasDisclaimer) return { code: 'disclaimer', reason: '助手自我介绍/能力清单，无可用信息' };
  if (hasGreeting || hasPolite) return { code: 'greeting', reason: '纯打招呼/客套话，无信息量' };
  return null;
}

/**
 * L0→L1 质量门（§2.1 清洗红线）：
 * 1. 清洗（sanitizeL1）后的有效字符 < MIN_MEANINGFUL_CHARS → 拦截（标点/占位符不计）
 * 2. 噪声规则对**脱敏后文本**匹配，任一命中 → 拦截
 * 3. 元信息噪声（问候/身份询问/助手自述与能力清单）→ 拦截
 * 4. 通过 → 返回清洗后内容（L1 脱敏产物）
 * 调用方（coreWrite / 手动编辑 / 自动摘要）：ok=false 时跳过入库 + 写审计，绝不静默丢弃。
 */
export function checkL0ToL1Quality(raw: string): QualityCheckResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, code: 'empty', reason: '空内容' };

  // 先脱敏，再检查脱敏后内容（防脱敏后只剩占位符；噪声规则也只看脱敏产物）
  const sanitized = sanitizeL1(trimmed);
  const meaningful = meaningfulLength(sanitized);
  if (meaningful < MIN_MEANINGFUL_CHARS) {
    return {
      ok: false, code: 'thin',
      reason: `有效内容不足 ${MIN_MEANINGFUL_CHARS} 字符（脱敏后仅 ${meaningful} 字）`,
    };
  }

  for (const { re, code, reason } of NOISE_PATTERNS) {
    if (re.test(sanitized)) {
      return { ok: false, code, reason };
    }
  }

  const meta = metaReplyReason(sanitized);
  if (meta) return { ok: false, code: meta.code, reason: meta.reason };

  // 批次40-B：短且无硬事实 → 拦。放在所有具体码之后，保证噪声/元对话仍记它们自己的码。
  // 「短」单独不构成理由：实测 30–49 字带有 36% 含硬事实（「C# 7.3 不支持 dynamic」），那是最该留的短记忆。
  // 第三道 `hasTechEvidence` 是为了**不与批次35 已拍板口径打架**：「单句裸需求算有效内容」
  //   （「请帮我做一个SolidWorks插件,要求:批量转换文件格式」）与 PostgreSQL/nginx 这类具体技术名词
  //   必须继续放行——它们不是硬事实，但确实「说得出具体东西」。宁可放过，不可错杀。
  if (meaningful < MIN_MEANINGFUL_WITHOUT_FACTS
    && !hasHardFacts(sanitized)
    && !hasTechEvidence(sanitized)) {
    return {
      ok: false, code: 'short_low_signal',
      reason: `有效内容仅 ${meaningful} 字（< ${MIN_MEANINGFUL_WITHOUT_FACTS}），且既无硬事实也无任何具体技术信息`,
    };
  }

  return { ok: true, content: sanitized };
}

/** 被拦截时写入审计的 detail（诚实标注；预览取脱敏后文本，绝不泄露 PII） */
export function filteredAuditDetail(raw: string, result: QualityCheckResult): Record<string, unknown> {
  const sanitized = sanitizeL1(raw ?? '');
  return {
    action: 'filtered_l0_to_l1',
    reason: result.reason ?? '未通过质量门',
    filter_code: result.code ?? 'unspecified',
    gate_version: QUALITY_GATE_VERSION,
    content_preview: sanitized.slice(0, 60) + (sanitized.length > 60 ? '…' : ''),
    content_length: sanitized.length,
    masked: true,
  };
}
