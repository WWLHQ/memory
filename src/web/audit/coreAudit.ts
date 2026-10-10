// 审计日志页（REQ-006 / P11）接真内核：审计流存内核 InMemoryStorage（append-only），
// 查询经 storage.queryAudit（§3.2 全动作可查）。种子全字段进 detail.entry 保真回放。
import type { AuditAction, AuditRecord, MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_AUDIT } from './seed.ts';
import type { AuditEntry } from './types.ts';

interface AuditCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<AuditCtx> | null = null;

function getCtx(): Promise<AuditCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      // 种子审计 → 内核账本（detail.entry 全字段保真，回放零损失）
      for (const e of SEED_AUDIT) {
        const rec: AuditRecord = {
          request_id: e.request_id,
          action: e.action as AuditAction, // 页面动作枚举（recall_breach 等）运行时直存，契约枚举待 §4.3 扩全
          form: 'web',
          ts: Date.parse(e.created_at),
          project_id: 'P1',
          user_id: e.user_id,
          detail: { entry: e },
        };
        await storage.appendAudit(rec);
      }
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 内核审计账本 → 页面 AuditEntry（链路追踪/过滤/导出仍在页面纯逻辑层） */
export async function coreLoadAudit(): Promise<AuditEntry[]> {
  const { storage } = await getCtx();
  const audits = await storage.queryAudit({});
  return audits
    .map((a) => (a.detail as { entry?: AuditEntry }).entry)
    .filter((e): e is AuditEntry => Boolean(e))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}
