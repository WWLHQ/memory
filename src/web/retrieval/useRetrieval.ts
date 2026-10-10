// REQ-012 T6 状态机 hook（§0/§6）：IDLE→LOADING→RESULT/EMPTY/ERROR；二次查询保留 session，request_id 每次新生成（R7/§7.6）。
import { useCallback, useRef, useState } from 'react';
import type { ModeSel, Scene } from './types.ts';
import { fakeEngine } from './fakeEngine.ts';

export type Phase = 'IDLE' | 'LOADING' | 'RESULT' | 'EMPTY' | 'ERROR';

export interface RetrievalState {
  phase: Phase;
  errorKind: 'timeout' | 'breach' | null;
  requestSeq: number;
}

export function useRetrieval() {
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [errorKind, setErrorKind] = useState<'timeout' | 'breach' | null>(null);
  const [result, setResult] = useState<ReturnType<typeof fakeEngine> | null>(null);
  const seq = useRef(0);
  const sessionRef = useRef(`sess_${Math.random().toString(36).slice(2, 8)}`);
  /** 硬熔断禁用检索 3s（§6） */
  const [cooldown, setCooldown] = useState(false);

  const search = useCallback((query: string, scene: Scene, mode: ModeSel, opts?: { forceBreach?: boolean; forceTimeout?: boolean }) => {
    if (cooldown) return;
    seq.current += 1;
    const requestId = `req_r${seq.current}`;
    setPhase('LOADING');
    setErrorKind(null);
    // demo：假引擎同步计算，用 setTimeout 模拟网络 + §6 超时/熔断触发
    setTimeout(() => {
      if (opts?.forceTimeout) {
        setErrorKind('timeout');
        setPhase('ERROR');
        return;
      }
      const r = fakeEngine(query, scene, mode, requestId);
      if (opts?.forceBreach) {
        r.budget.payload_tokens = 3100;
        r.budget.budget_breach = true;
        r.budget.breach_detail = ['L2 摘要 × 3 条', '关联记忆 × 2 条'];
        r.breach = true;
      }
      if (r.breach) {
        setErrorKind('breach');
        setPhase('ERROR');
        setCooldown(true);
        setTimeout(() => setCooldown(false), 3000);
        return;
      }
      setResult(r);
      setPhase(r.hits.length === 0 ? 'EMPTY' : 'RESULT');
    }, 120);
  }, [cooldown]);

  return { phase, errorKind, result, cooldown, session: sessionRef.current, search, requestSeq: seq.current };
}
