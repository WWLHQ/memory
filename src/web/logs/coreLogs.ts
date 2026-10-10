// 日志记录页（REQ-011 / P15）接真内核：审计流存内核 InMemoryStorage（append-only），
// L0 解锁走 ma.browse（真实写 l0_view 审计 → 日志流实时可见）。
// 种子动作含 4.3.1 全量（login/team_assign 等，超出内核 AuditAction 枚举）：运行时直存，
// 契约枚举待内核 §4.3 扩全（演示注释，类型收敛在 bridge 内）。
import type { AuditAction, AuditRecord, MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_LOGS } from './seed.ts';
import type { LogEntry } from './types.ts';

interface LogsCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<LogsCtx> | null = null;

function getCtx(): Promise<LogsCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      // 种子审计流 → 内核 append-only 账本（R-LOG2 缺失 request_id 原样保留演示）
      for (const l of SEED_LOGS) {
        const rec: AuditRecord = {
          request_id: l.request_id,
          action: l.action as AuditAction,
          form: l.form,
          ts: Date.parse(l.ts),
          detail: { message: l.message, level: l.level, extra: l.extra },
        };
        await storage.appendAudit(rec);
      }
      // L0 样例记忆（§2.4 演示：生产库连接串，授权可解）
      await ma._seedMemory({
        mem_id: 'mem_005',
        project_id: 'P1',
        content: '生产库连接串 tcp://prod-db:5432/app',
        category: 'context',
        layer: 'L1',
      });
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 内核审计流 → 页面 LogEntry（展示映射） */
export async function coreLoadLogs(): Promise<LogEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({});
  return audits.map((a) => {
    const d = a.detail as { message?: string; level?: LogEntry['level']; extra?: LogEntry['extra'] };
    return {
      ts: new Date(a.ts).toISOString(),
      level: d.level ?? (a.action === 'llm_fallback' ? 'warn' : 'info'),
      form: a.form ?? 'web',
      action: a.action as LogEntry['action'],
      request_id: a.request_id,
      message: d.message ?? JSON.stringify(a.detail).slice(0, 120),
      ref_audit: a.request_id || undefined,
      extra: d.extra,
    };
  });
}

/** L0 解锁：真实走内核 browse（对密码 ≥6 位解开；错密码 E_AUTH_L0 + l0_view 审计留痕） */
export async function coreL0Unlock(pwd: string): Promise<{ ok: boolean; sample?: string }> {
  const { ma } = await getCtx();
  try {
    const r = await ma.browse({ layer: 'L0', project_id: 'P1', l0_auth: { password: pwd } });
    return { ok: true, sample: r.rows[0]?.content };
  } catch {
    return { ok: false }; // E_AUTH_L0：内核已写 l0_view（遮罩保持）审计
  }
}
