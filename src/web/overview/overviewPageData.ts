// 概览页（定稿 .ovx 版式）的纯派生层：把真实快照翻译成「一句话结论 / 4 卡 / 范围行 / 洞察 / 胶囊」。
// 问答（answerOverviewQuestion + 建议问题）由壳层「记忆助手」复用，不再挂在概览页底部。
//
// 口径：所有读数来自 OverviewSnapshot（同一次账本读取 + /api/health + llm:billing + 会话标记）。
// 读不到就显示「读不到 / 未取数」并给出原因，绝不用「—」或 0 冒充成功读数。
import type { OverviewSnapshot } from '../shell/overview.ts';

export type PillTone = 'err' | 'warn' | 'mut' | 'ok';

export interface OverviewStatView {
  label: string;
  /** 大号读数：真实数字，或「读不到 / 未取数」 */
  value: string;
  /** 数值后的单位/说明（如「条」） */
  em?: string;
  /** 卡片底部来源行（等宽字体） */
  note: string;
}

export interface OverviewInsightView {
  n: string;
  title: string;
  src: string;
  pill: string;
  tone: PillTone;
  /** 点击跳转的壳层导航 id（可选） */
  go?: string;
}

export interface OverviewScopeView {
  label: string;
  value: string;
}

export interface OverviewView {
  loadedAt: number;
  timeText: string;
  conclusion: string;
  stats: OverviewStatView[];
  scope: OverviewScopeView[];
  insights: OverviewInsightView[];
  quick: Array<{ label: string; go: string }>;
  /** 真实空账本（读到了但确实没有数据） */
  emptyLedger: boolean;
}

/** 问账本的固定建议问题（壳层记忆助手复用同一份） */
export const OVERVIEW_SUGGESTIONS = [
  '最近成本花在哪？',
  '审计里有什么异常？',
  '最近记住了什么？',
  '同步成功了吗？',
  '账本里有多少条记忆？',
];

export interface OverviewAnswer {
  question: string;
  lead: string;
  body: string;
  state: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function clip(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function memoryLabel(count: number): string {
  return `${count} 条记忆`;
}

/** 洞察行：最多 4 条，不足时用真实核对行补足；超出的真实项不硬塞进列表 */
function buildInsights(s: OverviewSnapshot, timeText: string): OverviewInsightView[] {
  const items: Omit<OverviewInsightView, 'n'>[] = [];
  const facts = s.facts;
  const anomalies = s.raw.anomalies ?? [];
  const errors = anomalies.filter((a) => a.level === 'error');
  const warns = anomalies.filter((a) => a.level !== 'error');

  if (s.storageError) {
    items.push({
      title: '账本没读到',
      src: `storage 抛错：${clip(s.storageError, 72)}。这不是空账本，统计卡按读取失败显示。`,
      pill: '读取失败',
      tone: 'err',
    });
    items.push({
      title: '统计卡显示「读不到」而不是 0',
      src: '读失败时 UI 不拿 0 冒充成功读数；先确认内核/会话状态再刷新。',
      pill: '诚实空态',
      tone: 'mut',
    });
  } else {
    if (facts && facts.conflicts > 0) {
      items.push({
        title: `${facts.conflicts} 条冲突待裁决`,
        src: `内核记忆主表 conflict_id 计数 · 本次读取 ${memoryLabel(facts.memories)}`,
        pill: '待裁决',
        tone: 'warn',
        go: 'ledger-conflict',
      });
    }
    for (const a of [...errors, ...warns]) {
      items.push({
        title: a.title,
        src: `${clip(a.detail, 60)}${a.request_id ? ` · request_id ${a.request_id}` : ' · 账本无 request_id'}`,
        pill: a.level === 'error' ? '阻断' : '提醒',
        tone: a.level === 'error' ? 'err' : 'warn',
        go: 'audit',
      });
    }
    if (!s.session) {
      items.push({
        title: '未登录：需要会话的能力只读',
        src: 'hasActiveSession=false · 成本余额/同步等后端接口不可用；本地账本仍可读。',
        pill: '只读',
        tone: 'mut',
        go: 'login',
      });
    }
    if (s.billing.status === 'unavailable') {
      items.push({
        title: '今日成本未取数',
        src: `llm:billing · ${s.billing.detail}`,
        pill: '未取数',
        tone: 'mut',
        go: 'cost',
      });
    }
    if (s.pendingSync > 0) {
      items.push({
        title: `${s.pendingSync} 条记录待回传`,
        src: 'sync.wired=false · 本版本不提供云端同步，记录留在本机账本。',
        pill: '待回传',
        tone: 'warn',
        go: 'sync',
      });
    }
    if (facts && facts.memories === 0 && facts.audits === 0) {
      items.push({
        title: '账本为空',
        src: 'listMemories()=0 · queryAudit()=0（真实空账本，不是读取失败）',
        pill: '空账本',
        tone: 'mut',
        go: 'write',
      });
    }
  }

  if (!s.storageError && facts && items.length === 0) {
    items.push({
      title: '今天没有需要处理的异常',
      src: `已核对 ${memoryLabel(facts.memories)} / ${facts.audits} 条审计 · ${timeText}`,
      pill: '已核对',
      tone: 'ok',
    });
  }
  // 不足 4 行时补真实核对行（不编造事项）
  while (items.length < 4) {
    items.push({
      title: '没有更多需要处理的事项',
      src: facts
        ? `本次读取 ${memoryLabel(facts.memories)} / ${facts.audits} 条审计 · ${timeText}`
        : `读取失败 · ${timeText}`,
      pill: '已核对',
      tone: 'ok',
    });
  }
  return items.slice(0, 4).map((it, i) => ({ ...it, n: `0${i + 1}` }));
}

export function deriveOverviewView(s: OverviewSnapshot): OverviewView {
  const timeText = formatTime(s.loadedAt);
  const facts = s.facts;
  const anomalies = s.raw.anomalies ?? [];
  const errors = anomalies.filter((a) => a.level === 'error');
  const conflicts = facts?.conflicts ?? 0;

  const stats: OverviewStatView[] = [
    {
      label: '记忆条目',
      value: facts ? String(facts.memories) : '读不到',
      em: facts ? '条' : undefined,
      note: facts ? 'storage.listMemories · 真实计数' : 'storage 读取失败 · 原因见 01',
    },
    {
      label: '今日写入',
      value: facts ? String(facts.writeToday) : '读不到',
      em: facts ? '次' : undefined,
      note: '审计 action=write · 今日 00:00 起',
    },
    {
      label: '今日召回',
      value: facts ? String(facts.recallToday) : '读不到',
      em: facts ? '次' : undefined,
      note: '审计 action=recall · 今日 00:00 起',
    },
    {
      label: '今日成本',
      value: s.billing.status === 'ok' ? '可查' : '未取数',
      note: `llm:billing · ${s.billing.detail}`,
    },
  ];

  const scope: OverviewScopeView[] = [
    {
      label: '全库',
      value: s.kernelMode === 'host'
        ? '本机账本（桌面壳）'
        : s.session
          ? '会话账本（后端 HTTP 数据面）'
          : '浏览器临时账本（未登录）',
    },
    { label: '会话', value: s.session ? '已登录' : '未登录 · 只读' },
    { label: '后端', value: s.health.status === 'ok' ? '可达' : s.health.detail },
    { label: '账本读取', value: `${timeText}${facts ? '' : ' · 失败'}` },
  ];

  const quick = [
    { label: '看账本', go: 'ledger-all' },
    { label: '看生长是否生效', go: 'growth' },
    { label: '看成本从哪来', go: 'cost' },
    ...(s.session ? [] : [{ label: '去登录', go: 'login' }]),
  ];

  const pending = errors.length + conflicts;
  let conclusion: string;
  if (s.storageError) {
    conclusion = `账本没读到：${clip(s.storageError, 60)}。下面的读数按读取失败显示，不是 0。`;
  } else if (!facts) {
    conclusion = '账本读取中：还没有拿到真实读数。';
  } else if (pending > 0) {
    conclusion = `今天有 ${pending} 件事等你处理${conflicts > 0 ? `，其中 ${conflicts} 条冲突待裁决` : ''}。`;
  } else if (errors.length > 0) {
    conclusion = `今天有 ${errors.length} 条阻断性异常，建议先看审计。`;
  } else if (anomalies.length > 0) {
    conclusion = `今天有 ${anomalies.length} 条提醒，暂无阻断性异常。`;
  } else if (facts.memories === 0 && facts.audits === 0) {
    conclusion = '账本为空：还没有记忆与审计，先写入一条再回来看。';
  } else {
    conclusion = `今天没有需要处理的异常，账本可读：${memoryLabel(facts.memories)} / ${facts.audits} 条审计。`;
  }

  return {
    loadedAt: s.loadedAt,
    timeText,
    conclusion,
    stats,
    scope,
    insights: buildInsights(s, timeText),
    quick,
    emptyLedger: Boolean(facts && facts.memories === 0 && facts.audits === 0),
  };
}

/** 问账本（壳层记忆助手）：只回答账本快照能证实的问题，不编造模型回答 */
export function answerOverviewQuestion(question: string, s: OverviewSnapshot): OverviewAnswer {
  const q = question.trim();
  const facts = s.facts;
  const anomalies = s.raw.anomalies ?? [];
  const errors = anomalies.filter((a) => a.level === 'error');
  const conflicts = facts?.conflicts ?? 0;
  const base = `依据：本次账本读取（${formatTime(s.loadedAt)}）`;

  if (s.storageError) {
    return {
      question: q,
      lead: '账本没读到，无法回答。',
      body: `真实原因：${s.storageError}。这不是空账本，先确认内核/会话状态。`,
      state: base,
    };
  }
  if (!facts) {
    return { question: q, lead: '账本还没读完。', body: '请稍后重试；本页不会用占位数字回答。', state: base };
  }

  if (/成本|花费|余额|价钱|费用/.test(q)) {
    if (s.billing.status !== 'ok') {
      return {
        question: q,
        lead: '成本没有取到数。',
        body: `llm:billing 的真实状态：${s.billing.detail}。未取数时不显示金额，也不做本地推算。`,
        state: `依据：llm:billing · 会话 ${s.session ? '已登录' : '未登录'}`,
      };
    }
    return {
      question: q,
      lead: `${s.billing.live ?? 0} 个引擎厂商实时可查。`,
      body: `${s.billing.detail}。本页只转述余额视图状态，不做金额估算。`,
      state: '依据：llm:billing 实时视图',
    };
  }

  if (/异常|审计|报警|降级|阻断|问题/.test(q)) {
    if (errors.length === 0 && anomalies.length === 0) {
      return {
        question: q,
        lead: '审计里没有异常。',
        body: `已核对 ${facts.audits} 条审计：没有 LLM 降级、召回零命中或 L0 写入锁定记录。`,
        state: base,
      };
    }
    const titles = [...errors, ...anomalies].slice(0, 3).map((a) => `${a.title}（${clip(a.detail, 40)}）`);
    return {
      question: q,
      lead: `${errors.length} 条阻断 · ${anomalies.length - errors.length} 条提醒。`,
      body: titles.join('；'),
      state: base,
    };
  }

  if (/冲突|裁决/.test(q)) {
    return {
      question: q,
      lead: `${conflicts} 条冲突待裁决。`,
      body: conflicts > 0
        ? '来自记忆主表 conflict_id 计数；去「冲突待裁决」逐条处理。'
        : '记忆主表里没有 conflict_id 记录。',
      state: base,
    };
  }

  if (/同步|回传|上传/.test(q)) {
    return {
      question: q,
      lead: s.pendingSync > 0 ? `${s.pendingSync} 条待回传。` : '没有待回传记录。',
      body: '同步引擎尚未接入内核（sync.wired=false）：本版本不提供云端同步，记录只在本机账本。',
      state: base,
    };
  }

  if (/记忆|记住|条数|多少条|库/.test(q)) {
    return {
      question: q,
      lead: `账本里有 ${facts.memories} 条记忆。`,
      body: `今日写入 ${facts.writeToday} 次、召回 ${facts.recallToday} 次；累计审计 ${facts.audits} 条。`,
      state: base,
    };
  }

  if (/登录|会话|账号|权限/.test(q)) {
    return {
      question: q,
      lead: s.session ? '已登录，会话有效。' : '未登录，需要会话的能力只读。',
      body: s.session
        ? '后端接口（/api/me、成本余额、同步）按会话鉴权；本地账本读取不受影响。'
        : 'hasActiveSession=false：成本余额/同步/账号等后端接口不可用；本地账本仍可读。',
      state: '依据：会话标记 + /api/health',
    };
  }

  if (/召回|写入|调用/.test(q)) {
    return {
      question: q,
      lead: `今日写入 ${facts.writeToday} 次 · 召回 ${facts.recallToday} 次。`,
      body: `计数来自审计 action=write / action=recall（今日 00:00 起），累计审计 ${facts.audits} 条。`,
      state: base,
    };
  }

  return {
    question: q,
    lead: '本页只回答账本快照能证实的问题。',
    body: `可用指标：记忆 ${facts.memories} 条 / 今日写入 ${facts.writeToday} / 今日召回 ${facts.recallToday} / 冲突 ${conflicts} / 异常 ${anomalies.length}。可点上方建议问题，或去审计、模型与成本页看明细。`,
    state: base,
  };
}
