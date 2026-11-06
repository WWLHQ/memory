// 层级规则单一真源（§2.1/§2.2/§6.1/§6.2/§16.1/§4.4）：每层规格、查重阈值/权重、L0 授权常量、L1 脱敏与规格校验。
// 任何页面/入口/测试都引用本文件，不得各自复制一套规则。
import { MASK } from './crypto.ts';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../../shared/growthConfig.ts';

/** 精炼层顺序（L0 不在内：L0 是落盘密文层，不参与生成/查重/检索） */
export const LAYER_ORDER = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
export type RefineLayer = (typeof LAYER_ORDER)[number];

export interface LayerSpec {
  id: RefineLayer;
  name: string;
  /** 字数上限（按字符计；null = 不限） */
  maxChars: number | null;
  /**
   * 绝对字数下限（批次40 起语义变更）：它**不是**「产物至少要写这么多字」，
   * 而是**相对下限的兜底地板**——源文很短、或调用方没传源文时用它。
   * 有源文时真正的下限由 `minRatio` 算出（见 `layerBand`）。
   */
  minChars: number | null;
  /**
   * 相对下限系数（批次40）：产物下限 = 源文字数 × 本系数。
   * 摘要是**压缩**不是扩写——绝对字数下限对短源等于要求模型编料（批次39 实测 4/4 失败样例
   * 全是「18 字源 → 要求 ≥50 字摘要」这类结构性不可能）。
   */
  minRatio?: number;
  /** 源文出现则本层不得丢弃的关键词（不得凭空补造） */
  preserve?: string[];
  /**
   * 格式契约前缀（批次40，替代原 `mustInclude` 全文扫描）：产物必须以该串开头。
   * 原 `mustInclude` 用 `text.includes(k)` 判，模型写了同义表述就整层判废——
   * 实测 L4 三次全死在缺「适用场景」四字（库面 L3 116 行 vs L4 1 行）。
   * 现在把字面要求**写进提示词的输出格式**，判定查开头：标准没放宽，只是变成可达成。
   */
  mustStartWith?: string;
  /** 该层输入来源（阶梯依赖） */
  from: string;
  /** L6 专用：keywords 上限 */
  maxKeywords?: number;
}

/** 每层生成规格（§16.1，批次40 重新梳理）。 */
export const LAYER_SPECS: readonly LayerSpec[] = [
  { id: 'L1', name: '清洗脱敏', maxChars: null, minChars: null, from: 'L0 原始对话（仅本次写入，不落 LLM）' },
  { id: 'L2', name: '会话摘要', maxChars: 300, minChars: 12, minRatio: 0.4, preserve: ['错误码', '状态码', '配置项'], from: 'L1 脱敏原文' },
  { id: 'L3', name: '得失分析', maxChars: 200, minChars: 12, minRatio: 0.35, preserve: ['成功', '失败', '教训'], from: 'L2 会话摘要' },
  { id: 'L4', name: '模式归纳', maxChars: 120, minChars: 12, minRatio: 0.3, mustStartWith: '适用场景', from: 'L3 得失分析' },
  { id: 'L5', name: '洞察提炼', maxChars: 60, minChars: 10, minRatio: 0.25, mustStartWith: '边界条件', from: 'L4 模式归纳' },
  { id: 'L6', name: '投影索引', maxChars: null, minChars: null, from: 'L1–L5 相关内容 + relevance', maxKeywords: 30 },
];

export function layerSpecOf(id: RefineLayer): LayerSpec {
  return LAYER_SPECS.find((s) => s.id === id)!;
}

/** 逐层查重阈值（§6.1）——默认值单一真源在 shared/growthConfig.ts（页面可改，内核按账本配置执行） */
export const DEDUP_THRESHOLDS: Record<RefineLayer, number> = { ...DEFAULT_THRESHOLDS };

/** 五维查重权重（§6.1 全层统一）——默认值单一真源同上；`judge` 是 `llm_judge` 的内核别名 */
export const DEDUP_WEIGHTS = {
  semantic: DEFAULT_WEIGHTS.semantic,
  keyword: DEFAULT_WEIGHTS.keyword,
  entity: DEFAULT_WEIGHTS.entity,
  structure: DEFAULT_WEIGHTS.structure,
  judge: DEFAULT_WEIGHTS.llm_judge,
};

/** 无真实 LLM 时四维归一化（去掉 20% 的 LLM 仲裁） */
export const DEDUP_WEIGHTS_NO_LLM = {
  semantic: DEDUP_WEIGHTS.semantic / 0.8,
  keyword: DEDUP_WEIGHTS.keyword / 0.8,
  entity: DEDUP_WEIGHTS.entity / 0.8,
  structure: DEDUP_WEIGHTS.structure / 0.8,
} as const;

/** L0 密钥/会话策略（§4.4） */
export const L0_POLICY = {
  envelopeVersion: 2,
  dekBytes: 32,
  kdfIterations: 100_000,
  adminPasswordMin: 8,
  grantPasswordMin: 8,
  /** 连续查阅会话：最后一次活动后 5 分钟无操作即锁定 */
  idleTimeoutMs: 5 * 60_000,
  /** 查阅面板可见且有焦点时的心跳间隔 */
  heartbeatIntervalMs: 60_000,
  /** 同一账号连续密码错误次数 */
  maxFailedAttempts: 5,
  /** 连续失败后的锁定时长 */
  lockMs: 15 * 60_000,
} as const;

/** 最低有效字符数（去空白/标点/占位符后；§2.1 质量门） */
export const MIN_MEANINGFUL_CHARS = 10;

/**
 * 「短且无硬事实」入库门槛（批次40-B，§2.1）。
 * 双条件而不是纯字数一刀：本机真实账本 1585 行实测「有效字 <50」占 **51.8%**，
 * 且该区间里混着「C# 7.3 不支持 dynamic」这类最该留的短记忆（30–49 字带 36% 含硬事实），
 * 纯字数会把它们一起删掉。所以「短」只在**同时没有硬事实**时才构成拦下的理由。
 * 与 `MIN_MEANINGFUL_CHARS` 的分工：10 = 空串/纯符号兜底；30 = 没有事实就太短、不值得占用记忆位。
 */
export const MIN_MEANINGFUL_WITHOUT_FACTS = 30;

/**
 * 深度上限档位（批次40）：按 L1 有效字数决定这一行**最深可以炼到哪一层**。
 * 依据：L2→L5 是逐级压缩，每深一层可用的料更少；源文不够长还硬往下炼，唯一「达标」的办法就是编造
 *   （批次24 整批清掉的 stub 幻觉产物就是这么来的）。故要求每深一层源料大致翻倍。
 * **L6 不在此表内**：它是检索索引（keywords/projections）不是压缩摘要，任何深度都能单独生成。
 */
export const DEPTH_CAP_BANDS: readonly { minMeaningful: number; cap: RefineLayer }[] = [
  { minMeaningful: 240, cap: 'L5' },
  { minMeaningful: 120, cap: 'L4' },
  { minMeaningful: 60, cap: 'L3' },
  { minMeaningful: MIN_MEANINGFUL_WITHOUT_FACTS, cap: 'L2' },
];

/** 这行的 L1 有料炼到第几层；null = 连 L2 的料都不够（就停在 L1，仍可正常检索） */
export function depthCapFor(meaningful: number): RefineLayer | null {
  for (const b of DEPTH_CAP_BANDS) if (meaningful >= b.minMeaningful) return b.cap;
  return null;
}

const MASK_TOKENS = Object.values(MASK);
const MASK_RE = new RegExp(MASK_TOKENS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

/** 有效字符数：排除空白、标点/符号、已知脱敏占位符，只数真实内容 */
export function meaningfulLength(text: string): number {
  const stripped = (text ?? '')
    .replace(MASK_RE, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
  return [...stripped].length;
}

/**
 * L1 清洗脱敏（§2.1）：姓名/电话/邮箱/证件号/裸 IP/API Key/服务地址/认证头 → 占位符；
 * 保留技术内容、代码与逻辑推理。姓名启发式必须带分隔符（避免“用户登录失败”误判）。
 */
export function sanitizeL1(raw: string): string {
  let out = raw ?? '';
  // 1) 服务地址：任意协议 URL（http/https/ws/wss/tcp/ftp/sftp/ssh/git/ldap/smb/file/db…），
  //    遇中文/英文标点即终止，避免吞掉后续字段
  out = out.replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>，。；、,;]+/gi, MASK.addr);
  // 2) 认证头：Authorization / Proxy-Authorization / Cookie 整段值（Basic / Digest / 自定义 token）
  out = out.replace(
    /\b((?:proxy-)?authorization)\s*[:：]\s*[^\r\n,;，；]{8,200}/gi,
    (_m, header: string) => `${header}: ${MASK.key}`,
  );
  out = out.replace(
    /\b((?:set-)?cookie)\s*[:：]\s*[^\r\n,;，；]{6,200}/gi,
    (_m, header: string) => `${header}: ${MASK.key}`,
  );
  // 3) curl 基础认证：-u user:pass / --user user:pass
  out = out.replace(
    /(^|[\s"'])(-u|--user)(\s+)[^\s"']+/g,
    (_m, pre: string, flag: string, sp: string) => `${pre}${flag}${sp}${MASK.key}`,
  );
  // 4) 键值型密钥（api_key=… / client_secret: … / session_id=…；至少 6 位值）
  out = out.replace(
    /(?:api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|x-api-key|x-auth-token|x-access-token|token|secret|password|passwd|pwd|credential(?:s)?|session[_-]?id|sessionid)\s*[:=：]\s*["']?([^\s"'，。；;,]{6,})["']?/gi,
    MASK.key,
  );
  // 5) Authorization: Bearer <token> / JWT / 前缀式密钥（OpenAI/GitHub/Slack/AWS）
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, `Bearer ${MASK.key}`);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK.secret);
  out = out.replace(/\b(?:sk|pk|ak)[-_][A-Za-z0-9]{16,}\b/g, MASK.secret);
  out = out.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    MASK.secret,
  );
  // 6) 证件号（18 位含 X / 15 位）→ 先于电话，避免长数字被误判
  out = out.replace(
    /(?<![\dA-Za-z])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g,
    MASK.idcard,
  );
  out = out.replace(
    /(?<!\d)[1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?!\d)/g,
    MASK.idcard,
  );
  // 7) 电话 / 邮箱（数字边界，避免误伤长数字）
  out = out.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, MASK.phone);
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MASK.email);
  // 8) 裸 IP：[::1] 这类方括号 IPv6 → 裸 IPv6 → IPv4（含端口；版本号 v1.2.3.4 不受影响）
  out = out.replace(/\[[0-9a-f:]{2,45}\]/gi, (m) => (m.split(':').length >= 3 ? MASK.ip : m));
  out = out.replace(
    /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?)(?![\w:])/gi,
    MASK.ip,
  );
  out = out.replace(
    /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?::\d{1,5})?(?![\w.])/g,
    MASK.ip,
  );
  // 9) 姓名：触发词 + 分隔符 + 2-4 汉字（无分隔符不脱敏，防止误伤技术词）
  out = out.replace(
    /((?:联系人|对接人|负责人|作者|开发者|测试人员|产品经理|申请人|审批人|用户)[:：\s]+)([\u4e00-\u9fa5]{2,4})(?=$|[\s，。；、,.;!?！？)\]])/g,
    (_m, role: string) => `${role}${MASK.name}`,
  );
  return out;
}

/** 单层产物字数区间（批次40：有源文按相对系数算，无源文退回绝对地板） */
export interface LayerBand {
  min: number | null;
  max: number | null;
}

/**
 * 算出这一层允许的字数区间。三条夹逼规则：
 * 1. 相对下限 = 源文字数 × `minRatio`，不低于绝对地板 `minChars`；
 * 2. 相对下限最多吃掉本层上限的 80%（否则长源会把下限顶到超过上限，变成写不进去的死规格）；
 * 3. **上限同时受源文长度约束**——产物不得长于源（摘要是压缩不是扩写）。
 */
export function layerBand(spec: LayerSpec, source?: string): LayerBand {
  const floor = spec.minChars ?? 0;
  const src = source?.trim().length ?? 0;
  if (spec.minRatio === undefined || !source || src === 0) {
    return { min: spec.minChars === null ? null : floor, max: spec.maxChars };
  }
  let min = Math.round(src * spec.minRatio);
  if (spec.maxChars !== null) min = Math.min(min, Math.floor(spec.maxChars * 0.8));
  min = Math.max(min, floor);
  const max = spec.maxChars === null ? null : Math.max(min, Math.min(spec.maxChars, Math.max(src, min)));
  return { min, max };
}

/**
 * 单层产物的违规码（批次40-C，稳定英文码；中文 reason 可改，码不能随便换）。
 * 补炼队列与审计按码统计「这行卡在哪一步」，不再只有一句含混的「不合规格」。
 */
export type LayerViolationCode =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'missing_keyword'
  | 'bad_prefix'
  | 'bad_json';

export interface LayerViolation {
  layer: RefineLayer;
  code: LayerViolationCode;
  reason: string;
}

/**
 * 校验单层产物并给出**分层原因码**（空数组 = 合规）。
 * `source` 为上游文本：① preserve 关键词只在源文确实出现时才要求保留；
 * ② 批次40 起字数区间由源文算出（见 `layerBand`），源文缺失时按绝对地板判。
 */
export function checkLayerSpecDetailed(spec: LayerSpec, text: string, source?: string): LayerViolation[] {
  const bad: LayerViolation[] = [];
  const push = (code: LayerViolationCode, reason: string): void => { bad.push({ layer: spec.id, code, reason }); };
  const t = (text ?? '').trim();
  if (!t) { push('empty', `${spec.id} 产物为空`); return bad; }
  const band = layerBand(spec, source);
  if (band.max !== null && t.length > band.max) {
    push('too_long', `${spec.id} 超长：${t.length} > ${band.max} 字（${spec.name}；源文 ${source?.trim().length ?? 0} 字，产物不得长于源）`);
  }
  if (band.min !== null && t.length < band.min) {
    push('too_short', `${spec.id} 过短：${t.length} < ${band.min} 字（过度压缩，§16.1）`);
  }
  for (const k of spec.preserve ?? []) {
    if (source && source.includes(k) && !t.includes(k)) {
      push('missing_keyword', `${spec.id} 丢失源文关键词「${k}」（§16.1 preserve_keywords）`);
    }
  }
  if (spec.mustStartWith && !t.startsWith(spec.mustStartWith)) {
    push('bad_prefix', `${spec.id} 未按格式契约以「${spec.mustStartWith}」开头`);
  }
  if (spec.id === 'L6') {
    try {
      const o = JSON.parse(t) as { keywords?: unknown; projections?: unknown };
      if (!Array.isArray(o.keywords) || o.keywords.length === 0) {
        push('bad_json', 'L6 keywords 须为非空数组');
      } else if (spec.maxKeywords !== undefined && o.keywords.length > spec.maxKeywords) {
        push('bad_json', `L6 keywords 超限：${o.keywords.length} > ${spec.maxKeywords}`);
      }
      if (!Array.isArray(o.projections)) push('bad_json', 'L6 projections 须为数组');
    } catch {
      push('bad_json', 'L6 须为合法 JSON（{"keywords":[…],"projections":[…]}）');
    }
  }
  return bad;
}

/** 人类可读的违规清单（§16.1）；需要原因码时用 `checkLayerSpecDetailed` */
export function checkLayerSpec(spec: LayerSpec, text: string, source?: string): string[] {
  return checkLayerSpecDetailed(spec, text, source).map((v) => v.reason);
}

/**
 * 这一行**应当**炼到哪几层（批次40-C，写入 / 补炼 / 重建三条管道共用同一口径）。
 * 深度由 L1 的有效字数决定（`depthCapFor`），L6 永远在列——它是检索索引不是压缩摘要，
 * 任何深度都能单独生成，也不该因为 L4 判废而丢掉已经到手的 L2/L3。
 * `['L1']` = 连 L2 的料都不够，这行就停在 L1（仍可正常检索）。
 */
export function targetLayers(meaningful: number): RefineLayer[] {
  const cap = depthCapFor(meaningful);
  if (!cap) return ['L1'];
  return [...LAYER_ORDER.slice(0, LAYER_ORDER.indexOf(cap) + 1), 'L6'];
}

/** 产出层是否已「炼满本行该炼的层」——残缺判 `llm_partial` 的唯一依据，不再拿 LAYER_ORDER 长度硬比 */
export function isFullyRefined(produced: RefineLayer[], targets: RefineLayer[]): boolean {
  return targets.every((t) => produced.includes(t));
}

/**
 * 行上的 `layer` / `content` 取哪一层（批次40-C）。
 * L6 是检索索引，中间层判废时也会独立产出，所以**不能**再用「产出了 L6」倒推这行炼到了多深：
 * 只有叙事层（L2–L5 里本行该炼的那些）一层不缺时，L6 才算这行的最深层；
 * 否则回落到产出链上最后一个连续层。索引本身照常落 `content_l6`，不因这个判定而丢弃。
 */
export function headlineLayer(produced: RefineLayer[], targets: RefineLayer[]): RefineLayer {
  const narrative = targets.filter((t) => t !== 'L6');
  let depth: RefineLayer = 'L1';
  for (const t of narrative) {
    if (!produced.includes(t)) return depth;
    depth = t;
  }
  return produced.includes('L6') ? 'L6' : depth;
}
