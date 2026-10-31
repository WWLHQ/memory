// 层级规则单一真源（§2.1/§2.2/§6.1/§6.2/§16.1/§4.4）：每层规格、查重阈值/权重、L0 授权常量、L1 脱敏与规格校验。
// 任何页面/入口/测试都引用本文件，不得各自复制一套规则。
import { MASK } from './crypto.ts';

/** 精炼层顺序（L0 不在内：L0 是落盘密文层，不参与生成/查重/检索） */
export const LAYER_ORDER = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;
export type RefineLayer = (typeof LAYER_ORDER)[number];

export interface LayerSpec {
  id: RefineLayer;
  name: string;
  /** 字数上限（按字符计；null = 不限） */
  maxChars: number | null;
  /** 字数下限（按字符计；null = 不限） */
  minChars: number | null;
  /** 源文出现则本层不得丢弃的关键词（不得凭空补造） */
  preserve?: string[];
  /** 本层必含要素 */
  mustInclude?: string[];
  /** 该层输入来源（阶梯依赖） */
  from: string;
  /** L6 专用：keywords 上限 */
  maxKeywords?: number;
}

/** 每层生成规格（§16.1）。L5 必含「边界条件」（不是只查“边界”二字）；L6 keywords ≤30。 */
export const LAYER_SPECS: readonly LayerSpec[] = [
  { id: 'L1', name: '清洗脱敏', maxChars: null, minChars: null, from: 'L0 原始对话（仅本次写入，不落 LLM）' },
  { id: 'L2', name: '会话摘要', maxChars: 300, minChars: 50, preserve: ['错误码', '状态码', '配置项'], from: 'L1 脱敏原文' },
  { id: 'L3', name: '得失分析', maxChars: 200, minChars: 30, preserve: ['成功', '失败', '教训'], from: 'L2 会话摘要' },
  { id: 'L4', name: '模式归纳', maxChars: 120, minChars: 20, mustInclude: ['适用场景'], from: 'L3 得失分析' },
  { id: 'L5', name: '洞察提炼', maxChars: 60, minChars: 10, mustInclude: ['边界条件'], from: 'L4 模式归纳' },
  { id: 'L6', name: '投影索引', maxChars: null, minChars: null, from: 'L1–L5 相关内容 + relevance', maxKeywords: 30 },
];

export function layerSpecOf(id: RefineLayer): LayerSpec {
  return LAYER_SPECS.find((s) => s.id === id)!;
}

/** 逐层查重阈值（§6.1） */
export const DEDUP_THRESHOLDS: Record<RefineLayer, number> = {
  L1: 0.70, L2: 0.75, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.90,
};

/** 五维查重权重（§6.1 全层统一） */
export const DEDUP_WEIGHTS = {
  semantic: 0.35,
  keyword: 0.20,
  entity: 0.15,
  structure: 0.10,
  judge: 0.20,
} as const;

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

/**
 * 校验单层产物是否满足规格（空数组 = 合规）。
 * `source` 为上游文本：preserve 关键词只在源文确实出现时才要求保留。
 */
export function checkLayerSpec(spec: LayerSpec, text: string, source?: string): string[] {
  const bad: string[] = [];
  const t = (text ?? '').trim();
  if (!t) { bad.push(`${spec.id} 产物为空`); return bad; }
  if (spec.maxChars !== null && t.length > spec.maxChars) {
    bad.push(`${spec.id} 超长：${t.length} > ${spec.maxChars} 字（${spec.name}）`);
  }
  if (spec.minChars !== null && t.length < spec.minChars) {
    bad.push(`${spec.id} 过短：${t.length} < ${spec.minChars} 字（过度压缩，§16.1）`);
  }
  for (const k of spec.preserve ?? []) {
    if (source && source.includes(k) && !t.includes(k)) {
      bad.push(`${spec.id} 丢失源文关键词「${k}」（§16.1 preserve_keywords）`);
    }
  }
  for (const k of spec.mustInclude ?? []) {
    if (!t.includes(k)) bad.push(`${spec.id} 缺必含要素「${k}」`);
  }
  if (spec.id === 'L6') {
    try {
      const o = JSON.parse(t) as { keywords?: unknown; projections?: unknown };
      if (!Array.isArray(o.keywords) || o.keywords.length === 0) {
        bad.push('L6 keywords 须为非空数组');
      } else if (spec.maxKeywords !== undefined && o.keywords.length > spec.maxKeywords) {
        bad.push(`L6 keywords 超限：${o.keywords.length} > ${spec.maxKeywords}`);
      }
      if (!Array.isArray(o.projections)) bad.push('L6 projections 须为数组');
    } catch {
      bad.push('L6 须为合法 JSON（{"keywords":[…],"projections":[…]}）');
    }
  }
  return bad;
}
