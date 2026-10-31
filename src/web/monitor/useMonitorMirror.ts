// 监控仪表盘后端镜像：挂载视图上抛（G6 fire-and-forget，monitor_view）。
import { useEffect, useRef } from 'react';
import { mirrorReport } from '../mirrorClient.ts';

export function useMonitorMirror(filter: { level: string; window: string; agent: string }) {
  const seq = useRef(0);
  const { level, window: win, agent } = filter;
  useEffect(() => {
    seq.current += 1;
    mirrorReport('monitor', 'monitor_view', `req_mon${seq.current}`, { filter: { level, window: win, agent } });
  }, [level, win, agent]);
}
