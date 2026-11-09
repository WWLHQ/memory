// 问账本（壳层「记忆助手」复用）：只转述真实账本快照能证实的内容，不编造模型回答。
// 批次57-B 起首页版式改由 OverviewPage.deriveHomeView 派生，本文件仅保留问答与建议问题。
// 口径：所有读数来自 OverviewSnapshot（同一次账本读取 + /api/health + llm:billing + 会话标记）。
// 读不到就显示「读不到 / 未取数」并给出原因，绝不用「—」或 0 冒充成功读数。
import type { OverviewSnapshot } from '../shell/overview.ts';

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
