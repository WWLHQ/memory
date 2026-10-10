// 全局参数页（REQ-006 / P5）接真内核：参数快照存内核 preference 记忆（params:v1: JSON，
// pinned 防 gc），保存真写 storage 账本 + param_save 审计，加载 getPrefs 口径回填。
import type { MemAgent, Memory } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

const PREF_PREFIX = 'params:v1:';

interface ParamsCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<ParamsCtx> | null = null;

function getCtx(): Promise<ParamsCtx> {
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

function packContent(payload: { cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams }): string {
  return PREF_PREFIX + JSON.stringify(payload);
}

function tryParsePayload(content: string): { cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams } | null {
  if (!content.startsWith(PREF_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(PREF_PREFIX.length));
  } catch {
    return null;
  }
}

async function findParamsMemory(storage: InMemoryStorage): Promise<Memory | null> {
  const mems = await storage.listMemories({});
  return mems.find((m) => m.category === 'preference' && m.user_id === 'system' && m.content.startsWith(PREF_PREFIX)) ?? null;
}

/** 加载：内核 preference 记忆回填；无已保存快照 → null（页面用默认值） */
export async function coreLoadParams(): Promise<{ cfg: NormalConfig; kbs: KbPolicyRow[]; dev: DevParams } | null> {
  const { storage } = await getCtx();
  const m = await findParamsMemory(storage);
  return m ? tryParsePayload(m.content) : null;
}

/** 保存：快照写内核（旧快照 delete + 新快照 put，pinned 豁免 gc）+ param_save 审计落账本 */
export async function coreSaveParams(
  cfg: NormalConfig, kbs: KbPolicyRow[], dev: DevParams, requestId: string,
): Promise<{ request_id: string; mem_id: string; version: number }> {
  const { storage } = await getCtx();
  const old = await findParamsMemory(storage);
  if (old) await storage.deleteMemory(old.mem_id);
  const mem: Memory = {
    mem_id: `params_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: 'e_demo', team_id: 't_demo',
    category: 'preference', layer: 'L2',
    content: packContent({ cfg, kbs, dev }),
    decay_class: 'hot', pinned: true, locked: false,
    version: (old?.version ?? 0) + 1, created_at: Date.now(), updated_at: Date.now(),
  };
  await storage.putMemory(mem);
  await storage.appendAudit({
    request_id: requestId, action: 'param_save', form: 'web', project_id: 'P_SYSTEM', user_id: 'system',
    ts: Date.now(), detail: { cfg, kbs, dev, version: mem.version },
  });
  return { request_id: requestId, mem_id: mem.mem_id, version: mem.version };
}
