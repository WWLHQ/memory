/**
 * 网页对话导出完整性审计（纯逻辑层，可单测、无 IO）。
 *
 * 为什么要有它（2026-11-17 用户诉求）：
 *   「请判断一下导出文档和原对话有无差异，是不是全部导出有无遗漏，正确率如何统计」
 *   —— 之前只有「导出成功/失败」的二元信号，没有任何「导全了没有」的口径。
 *
 * 审计对象是**导出 Markdown 与页面原对话**的差异。页面原对话在哪？
 *   · 插件侧：content.js 读到的那份 messages（DOM 抽取结果）＝「原对话」
 *   · 落盘侧：导出 Markdown ＝「导出文档」
 * 所以比对必须发生在**同一次抽取内**——插件把两份都带上来，后台/应用做逐条比对。
 * 事后拿磁盘上的 md 跟「原对话」比是做不到的：原对话不在磁盘上（DeepSeek 的
 * IndexedDB 只存会话元数据，不存正文，已实测确认）。
 *
 * 口径定义（全部可复算，缺证据一律记「未知」而不是猜）：
 *   · 条目一致率   = 两边条数相同的消息数 / 消息总数
 *   · 角色一致率   = role 相同的消息数 / 消息总数
 *   · 文本逐字一致 = 正文完全相同（归一化空白后）的消息数 / 消息总数
 *   · 遗漏条数     = 原对话有、导出没有
 *   · 多余条数     = 导出有、原对话没有
 *   · 截断条数     = 导出正文是原对话正文的前缀（少了尾巴）
 *   · 改写条数     = 两边都有但既不相同、也不是前缀关系
 *   · 综合正确率   = 完全一致条数 / 消息总数（严格口径：一字不差才算对）
 *
 * 诚实边界：原对话侧缺失时（没带 messages 快照）只报「无法比对」，不估数。
 */

/** 一条消息（两侧统一形态） */
export interface AuditMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** 单次导出的比对结果 */
export interface AuditOneResult {
  /** 原对话条数（页面 DOM 抽取结果）；未提供时为 null */
  sourceCount: number | null;
  /** 导出文档解析出的条数 */
  exportedCount: number;
  /** 两边都有、且角色与正文都一致的条数（「完全一致」） */
  matched: number;
  /** 角色判错的条数（正文可能逐字相同，但用户/助手归错了） */
  roleMismatch: number;
  /** 正文逐字相同的条数（不看角色） */
  textExact: number;
  /** 遗漏条数 */
  missing: number;
  /** 多余条数 */
  extra: number;
  /** 截断条数 */
  truncated: number;
  /** 改写条数 */
  rewritten: number;
  /** 综合正确率（0..1）；sourceCount 未知时为 null */
  accuracy: number | null;
  /** 首批不一致条目的可读说明（最多 5 条） */
  issues: string[];
}

/** 归一化：统一换行、压缩空白、去首尾。用于「同一段话」的等价判定 */
export function normalizeText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/**
 * 解析导出 Markdown → 消息序列。
 * 格式由 core.formatMarkdown 固定产出：`- 站点：` / `## 用户` / `## 助手`。
 * 这里刻意只认本插件自己的格式，不复用记忆库那个宽松解析器
 * （那个认 12 种角色别名，会把「## 用户」以外的行也算进来，审计口径会失真）。
 *
 * 关键边界（2026-11-17 修）：**头部元信息只在「还没进入任何一条消息」时才跳过**。
 * 旧实现对每一行都判 `startsWith('# ')` / `=== '---'`，于是 AI 回答里自己写的
 * markdown 标题（`# 结论`）和分隔线会被当成头部丢掉 → 正文少一截 →
 * 审计误报「被截断/被改写」，把正确率算低。
 */
export function parseExportMarkdown(markdown: string): AuditMessage[] {
  const out: AuditMessage[] = [];
  const lines = String(markdown ?? '').split(/\r?\n/);
  let current: AuditMessage | null = null;
  const flush = (): void => {
    if (current) {
      const text = current.text.replace(/\n{3,}/g, '\n\n').trim();
      out.push({ role: current.role, text });
    }
    current = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '## 用户') { flush(); current = { role: 'user', text: '' }; continue; }
    if (line === '## 助手') { flush(); current = { role: 'assistant', text: '' }; continue; }
    // 还没进消息 → 这行是文件头（元信息 / 一级标题 / 分隔线），跳过
    if (!current) {
      if (line.startsWith('# ') || line === '---') continue;
      if (/^-\s*(站点|来源|导出时间|标题)\s*[:：]/.test(line)) continue;
      continue;
    }
    // 已进消息 → 每一行都是正文，一个字都不能丢
    current.text += (current.text ? '\n' : '') + raw;
  }
  flush();
  return out;
}

/**
 * 比对「原对话」与「导出文档」。
 * @param source 原对话消息序列（页面 DOM 抽取结果）；传 null 表示拿不到
 * @param exportedMarkdown 导出 Markdown 原文
 */
export function auditExport(source: AuditMessage[] | null, exportedMarkdown: string): AuditOneResult {
  const exported = parseExportMarkdown(exportedMarkdown);
  const base: AuditOneResult = {
    sourceCount: source ? source.length : null,
    exportedCount: exported.length,
    matched: 0,
    roleMismatch: 0,
    textExact: 0,
    missing: 0,
    extra: 0,
    truncated: 0,
    rewritten: 0,
    accuracy: null,
    issues: [],
  };
  if (!source) {
    base.issues.push('没有原对话快照，无法逐条比对（只报了导出侧的条数）');
    return base;
  }

  const src = source.map((m) => ({ role: m.role, text: normalizeText(m.text) }));
  const out = exported.map((m) => ({ role: m.role, text: normalizeText(m.text) }));

  // 序列对齐：按位置双指针走。role 不同但文本相同的算「角色错判」，
  // 但仍计入「正文逐字一致」——两条口径分开报，别把「谁说的话」和「说了什么」混成一个数。
  const n = Math.max(src.length, out.length);
  let matched = 0;
  let roleMismatch = 0;
  let textExact = 0;
  let truncated = 0;
  let rewritten = 0;
  const issues: string[] = [];

  for (let i = 0; i < n; i++) {
    const s = src[i];
    const o = out[i];
    if (!s) {
      base.extra += 1;
      if (issues.length < 5) issues.push(`导出多出第 ${i + 1} 条（${o.role}）`);
      continue;
    }
    if (!o) {
      base.missing += 1;
      if (issues.length < 5) issues.push(`遗漏第 ${i + 1} 条（${s.role}，原话前 20 字：${s.text.slice(0, 20)}）`);
      continue;
    }
    if (s.role !== o.role) {
      roleMismatch += 1;
      if (issues.length < 5) issues.push(`第 ${i + 1} 条角色不符：原对话 ${s.role} / 导出 ${o.role}`);
    }
    if (s.text === o.text) {
      textExact += 1;
      if (s.role === o.role) matched += 1; // 「完全一致」= 角色对得上 + 正文一字不差
      continue;
    }
    // 导出比原话短且是前缀 → 截断；否则算改写
    if (s.text.startsWith(o.text) && o.text.length > 0) {
      truncated += 1;
      if (issues.length < 5) issues.push(`第 ${i + 1} 条被截断（导出 ${o.text.length} 字 / 原话 ${s.text.length} 字）`);
    } else {
      rewritten += 1;
      if (issues.length < 5) issues.push(`第 ${i + 1} 条与原话不一致（导出 ${o.text.length} 字 / 原话 ${s.text.length} 字）`);
    }
  }

  base.matched = matched;
  base.roleMismatch = roleMismatch;
  base.textExact = textExact;
  base.truncated = truncated;
  base.rewritten = rewritten;
  base.issues = issues;
  // 严格口径：一条消息要「角色正确 + 正文一字不差」才算对。分母用原对话条数（原话是基准）。
  base.accuracy = src.length === 0 ? null : matched / src.length;
  return base;
}

/**
 * 汇总多次导出 → 一个总账（跨会话的正确率）。
 * 口径：条数按「原对话条数之和」为分母；导出了但没有原对话快照的会话单独计数，
 * 绝不混进分母里拉低或拉高正确率。
 */
export interface AuditSummary {
  sessions: number;
  sessionsWithSnapshot: number;
  sourceMessages: number;
  exportedMessages: number;
  /** 完全一致（角色对 + 正文一字不差）的条数 */
  matched: number;
  /** 正文逐字相同（不看角色）的条数 */
  textExact: number;
  roleMismatch: number;
  missing: number;
  extra: number;
  truncated: number;
  rewritten: number;
  accuracy: number | null;
}

export function summarizeAudit(results: AuditOneResult[]): AuditSummary {
  const sum: AuditSummary = {
    sessions: results.length,
    sessionsWithSnapshot: 0,
    sourceMessages: 0,
    exportedMessages: 0,
    matched: 0,
    textExact: 0,
    roleMismatch: 0,
    missing: 0,
    extra: 0,
    truncated: 0,
    rewritten: 0,
    accuracy: null,
  };
  for (const r of results) {
    sum.exportedMessages += r.exportedCount;
    if (r.sourceCount === null) continue;
    sum.sessionsWithSnapshot += 1;
    sum.sourceMessages += r.sourceCount;
    sum.matched += r.matched;
    sum.textExact += r.textExact;
    sum.roleMismatch += r.roleMismatch;
    sum.missing += r.missing;
    sum.extra += r.extra;
    sum.truncated += r.truncated;
    sum.rewritten += r.rewritten;
  }
  sum.accuracy = sum.sourceMessages === 0 ? null : sum.matched / sum.sourceMessages;
  return sum;
}

/**
 * 覆盖度审计：站点真实会话数 vs 已导出会话数。
 * 「有没有遗漏」在会话粒度上就靠这个——漏了会话，光看单会话正确率是看不出来的。
 *
 * 基准从哪来（2026-11-17 实测）：
 *   DeepSeek 的 IndexedDB（https_chat.deepseek.com_0.indexeddb.leveldb）里
 *   每条 chat_session 记录就是一个会话（id/title/updated_at/is_empty），
 *   实测账号下有 74 条；而插件只导出了 31 条 —— 漏 52 条（漏 70%）。
 *   侧栏 DOM 也能数（容器 `_3098d02` 下 29+60+9=98 个子节点，含分组标题，不能直接当会话数）。
 *   所以基准以插件遍历时看到的**去重侧栏条目数**为准（sidebarTotal），
 *   拿不到时退化为站点侧给出的总数（totalSessions）。
 */
export interface CoverageAudit {
  site: string;
  /** 站点侧真实会话总数（拿不到时为 null） */
  totalSessions: number | null;
  /** 已导出（落盘且有来源 URL）的会话数 */
  exportedSessions: number;
  /** 已导出但正文为空（导了等于没导）的会话数 */
  emptySessions: number;
  /** 漏掉的会话标题（最多 20 条；拿不到标题时只报数量） */
  missingTitles: string[];
  /** 还差多少条没导到（拿不到基准时为 null） */
  missingCount: number | null;
  /** 覆盖率 0..1；拿不到基准时为 null */
  coverage: number | null;
}

/** 一条已导出会话的记录 */
export interface ExportedSession {
  title: string;
  url: string;
  messages: number;
}

export function auditCoverage(
  site: string,
  totalSessions: number | null,
  exported: ExportedSession[],
  /** 站点侧会话清单（拿得到时才能报出「漏了哪几条」的标题） */
  known?: { title: string; url: string }[],
): CoverageAudit {
  const seen = new Set<string>();
  let emptySessions = 0;
  for (const e of exported) {
    const key = e.url || e.title;
    if (key) seen.add(key);
    if (e.messages <= 0) emptySessions += 1;
  }
  const exportedSessions = seen.size;
  const base = totalSessions === null || totalSessions <= 0 ? null : totalSessions;

  let missingTitles: string[] = [];
  if (known && known.length > 0) {
    const exportedUrls = new Set(exported.map((e) => e.url).filter(Boolean));
    const exportedTitles = new Set(exported.map((e) => e.title).filter(Boolean));
    missingTitles = known
      .filter((k) => {
        const byUrl = k.url && exportedUrls.has(k.url);
        const byTitle = k.title && exportedTitles.has(k.title);
        return !byUrl && !byTitle;
      })
      .map((k) => k.title || k.url)
      .slice(0, 20);
  }

  const missingCount = base === null ? null : Math.max(0, base - exportedSessions);
  return {
    site,
    totalSessions: base,
    exportedSessions,
    emptySessions,
    missingTitles,
    missingCount,
    coverage: base === null ? null : exportedSessions / base,
  };
}
