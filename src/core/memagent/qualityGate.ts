// L0→L1 质量过滤器（§2.1 清洗红线）：拦截无用/低质信息，禁止其进入 L1 污染记忆库。
// 设计原则（诚实、不静默）：
//   · 纯函数（可单测），不做 IO
//   · 拦截 = 返回 { ok:false, reason }（调用方据此跳过入库 + 审计留痕，绝不静默吞掉）
//   · 规则按"宁严勿滥"：宁可多拦一条无用的，不留一条垃圾进 L1
//   · 批次10：新增「打招呼 / 纯身份询问 / 助手自述与能力清单」判定——
//     按子句切分后逐一归类，**任一子句含具体信息（数字/英文技术词/代码符号）即放行**，
//     只有全部子句都是元信息时才拦截（避免误伤“你能帮我排查 Redis 超时吗”这类真实问题）。
import { sanitizeL1, meaningfulLength, MIN_MEANINGFUL_CHARS } from './layerRules.ts';

export interface QualityCheckResult {
  /** 是否通过质量门（true = 可进 L1；false = 拦截） */
  ok: boolean;
  /** 拦截原因（ok=false 时填，供审计） */
  reason?: string;
  /** 清洗后内容（ok=true 时返回 L1 脱敏产物；ok=false 时无意义） */
  content?: string;
}

/** 无信息量模式（对脱敏后文本全匹配 → 拦截） */
const NOISE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /^\s*(ok|okay|好的|嗯|嗯嗯|哈哈|呵呵|行|可以|没问题|对的|是的|对|是的呢|好的好的|👍|okk|OK|Ok|嗯嗯嗯|收到|了解|明白|当然|当然可以|当然啦|好呀|好滴|好嘞|可以呀|行呀)\s*[!！.。~～]*\s*$/, reason: '纯寒暄/确认语，无信息量' },
  { re: /^\s*[\r\n\s]*$/, reason: '空内容' },
  { re: /^-{3,}\s*$/, reason: '分隔线' },
  { re: /^={3,}\s*$/, reason: '分隔线' },
  { re: /^\s*#{1,6}\s*$/, reason: '空标题（仅 # 符号）' },
  { re: /^\s*(\*{3,}|_{3,})\s*$/, reason: '装饰线' },
  { re: /^\[[^\]]*\]\s*$/, reason: '裸链接（无正文）' },
  { re: /^"[^"]*"\s*$/, reason: '裸 JSON 字符串值' },
  { re: /^\d+\s*$/, reason: '纯数字（无上下文）' },
  { re: /^\/\//, reason: '纯注释行（//）' },
  { re: /^\s*import\s+(?:[\w{}*,\s]+from\s+)?['"][\w@/.:-]+['"];?\s*$/, reason: '纯 import 语句（无逻辑）' },
  { re: /^\s*(?:const|let|var)?\s*[\w]+\s*=\s*require\s*\(\s*['"][^'"]*['"]\s*\);?\s*$/, reason: '纯 require 语句（无逻辑）' },
];

/* ---------- 批次10：元信息噪声（打招呼 / 纯身份询问 / 助手自述与能力清单） ---------- */

const AI_WORD_SRC = '(?:AI|ai|人工智能|大语言模型|大模型|语言模型|智能助手|聊天机器人|机器人|助手|模型)';
const MODEL_NAME_SRC =
  '(?:ChatGPT|GPT(?:-\\d+(?:\\.\\d+)?)?|Claude|DeepSeek(?:-[\\w.]+)?|Gemini|Qwen|通义千问|文心一言|豆包|' +
  'Kimi|Llama|Mistral|Grok|Copilot|GLM|智谱清言|腾讯元宝|讯飞星火|混元)';
const MODEL_NAME_RE = new RegExp(MODEL_NAME_SRC, 'gi');

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
]);

/** 具体信息证据：数字 / 代码符号 / 文件扩展名 / 非停用的英文技术词 → 该子句有实质内容 */
function hasTechEvidence(text: string): boolean {
  if (/\d/.test(text)) return true;
  if (/[_<>{}[\]()=+*/\\|`~^$#@]/.test(text)) return true;
  if (/\.(?:js|ts|tsx|jsx|py|go|rs|java|kt|json|ya?ml|toml|sql|sh|bat|ps1|md|log|env|ini|conf|db|csv|html|css)\b/i.test(text)) {
    return true;
  }
  for (const w of text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []) {
    if (!TECH_STOP.has(w.toLowerCase())) return true;
  }
  return false;
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
  return IDENTITY_RE.test(m[1].trim());
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

/**
 * 元信息回复判定：返回拦截原因，null = 未命中（放行）。
 * 任一子句无法证明是元信息 → 放行（保守优先，宁可放过不可错杀）。
 */
function metaReplyReason(text: string): string | null {
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
    if (prevIdentity && IDENTITY_CONT_RE.test(core)) { hasIdentity = true; continue; }
    if (isDisclaimerClause(core)) { hasDisclaimer = true; prevIdentity = false; continue; }
    if (isCapabilityClause(core)) { hasCapability = true; prevIdentity = false; continue; }
    if (isListFragment(core)) { hasCapability = true; prevIdentity = false; continue; }
    return null; // 任一实质性子句 → 放行
  }

  if (!anyClause) return null;
  if (hasQuestion) return '纯身份/能力询问，无可用信息';
  if (hasIdentity || hasCapability || hasDisclaimer) return '助手自我介绍/能力清单，无可用信息';
  if (hasGreeting || hasPolite) return '纯打招呼/客套话，无信息量';
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
  if (!trimmed) return { ok: false, reason: '空内容' };

  // 先脱敏，再检查脱敏后内容（防脱敏后只剩占位符；噪声规则也只看脱敏产物）
  const sanitized = sanitizeL1(trimmed);
  const meaningful = meaningfulLength(sanitized);
  if (meaningful < MIN_MEANINGFUL_CHARS) {
    return { ok: false, reason: `有效内容不足 ${MIN_MEANINGFUL_CHARS} 字符（脱敏后仅 ${meaningful} 字）` };
  }

  for (const { re, reason } of NOISE_PATTERNS) {
    if (re.test(sanitized)) {
      return { ok: false, reason };
    }
  }

  const metaReason = metaReplyReason(sanitized);
  if (metaReason) return { ok: false, reason: metaReason };

  return { ok: true, content: sanitized };
}

/** 被拦截时写入审计的 detail（诚实标注；预览取脱敏后文本，绝不泄露 PII） */
export function filteredAuditDetail(raw: string, reason: string): Record<string, unknown> {
  const sanitized = sanitizeL1(raw ?? '');
  return {
    action: 'filtered_l0_to_l1',
    reason,
    content_preview: sanitized.slice(0, 60) + (sanitized.length > 60 ? '…' : ''),
    content_length: sanitized.length,
    masked: true,
  };
}
