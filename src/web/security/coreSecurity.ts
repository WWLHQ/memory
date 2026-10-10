// 账号与安全页（REQ-006 / P12）接真内核：安全操作真写 storage 审计账本
// （action='security_change'），成员/密钥实体保留页面种子（内核无此域模型）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';

interface SecurityCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<SecurityCtx> | null = null;

function getCtx(): Promise<SecurityCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 安全操作真写内核审计账本（策略变更/成员调整/密钥吊销），返回回执 */
export async function coreSecurityAudit(
  action: string, requestId: string, detail: Record<string, unknown> = {},
): Promise<{ request_id: string; total: number }> {
  const { storage } = await getCtx();
  await storage.appendAudit({
    request_id: requestId, action: 'security_change', form: 'web',
    project_id: 'P_SYSTEM', user_id: 'system', ts: Date.now(), detail: { op: action, ...detail },
  });
  const total = (await storage.queryAudit({ action: 'security_change' })).length;
  return { request_id: requestId, total };
}

/** 审计回放（验证/展示用） */
export async function coreLoadSecurityAudit(): Promise<{ request_id: string; op: string; ts: number }[]> {
  const { storage } = await getCtx();
  return (await storage.queryAudit({ action: 'security_change' })).map((a) => ({
    request_id: a.request_id, op: String((a.detail as { op?: string }).op ?? ''), ts: a.ts,
  }));
}
