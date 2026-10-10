import { useCallback, useRef, useState } from 'react';

export function useToast(timeout = 2200) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), timeout);
  }, [timeout]);
  return { node: msg ? <div className="toast" data-testid="toast" role="status">{msg}</div> : null, show };
}
