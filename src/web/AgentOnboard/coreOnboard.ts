// AgentOnboard 接入页接真内核：一键接入第 4 段「测通并写审计」走 ma.discover
// （desktop 口径：宿主本机扫描 mcp/proc/hb 全信号，auto_bind 审计内核真写）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';

interface OnboardCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<OnboardCtx> | null = null;

function getCtx(): Promise<OnboardCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'desktop', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 内核 discover（desktop：mcp/proc/hb 全信号）→ 自动绑定 + auto_bind 审计内核真写 */
export async function coreDiscover(): Promise<{
  agents: Array<{ name: string; signal: string; bound: boolean }>;
  skipped: string[];
}> {
  const { ma } = await getCtx();
  const r = await ma.discover({ form: 'desktop', signals: ['mcp', 'proc', 'hb'] });
  return { agents: r.agents, skipped: r.skipped };
}
