// REQ-012 T6 状态机 hook（§0/§6）：IDLE→LOADING→RESULT/EMPTY/ERROR；二次查询保留 session，request_id 每次新生成（R7/§7.6）。
// T7：引擎切换为 memagent-core 内核 recall（coreEngine），fakeEngine 保留作对照。
import { useCallback, useRef, useState } from 'react';
import type { ModeSel, Scene } from './types.ts';
import { coreEngine } from './coreEngine.ts';
import { newRequestId } from '../kernel.ts';

export type Phase = 'IDLE' | 'LOADING' | 'RESULT' | 'EMPTY' | 'ERROR';

export interface RetrievalState {
  phase: Phase;
  errorKind: 'timeout' | 'breach' | null;
  requestSeq: number;
}

export function useRetrieval() {
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [errorKind, setErrorKind] = useState<'timeout' | 'breach' | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof coreEngine>> | null>(null);
  const seq = useRef(0);
  const sessionRef = useRef(newRequestId('sess'));
  /** 硬熔断禁用检索 3s（§6） */
  const [cooldown, setCooldown] = useState(false);

  const search = useCallback((query: string, scene: Scene, mode: ModeSel) => {
    if (cooldown) return;
    seq.current += 1;
    const requestId = newRequestId('req');
    setPhase('LOADING');
    setErrorKind(null);
    // 引擎 = memagent-core 内核 recall（同步内存实现，微任务级）；setTimeout 仅模拟网络延迟，绝不伪造数据
    setTimeout(() => {
      void (async () => {
        const r = await coreEngine(query, scene, mode, requestId);
        if (r.breach) {
          setErrorKind('breach');
          setPhase('ERROR');
          setCooldown(true);
          setTimeout(() => setCooldown(false), 3000);
          return;
        }
        setResult(r);
        setPhase(r.hits.length === 0 ? 'EMPTY' : 'RESULT');
      })();
    }, 120);
  }, [cooldown]);

  return { phase, errorKind, result, cooldown, session: sessionRef.current, search, requestSeq: seq.current };
}
