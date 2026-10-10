// 日志记录页（REQ-011 / P15）T4 编排
// 审计流来自内核 InMemoryStorage（append-only）；L0 解锁走 ma.browse 真实写 l0_view 审计。
import { useEffect, useMemo, useState } from 'react';
import type { L0State, LogEntry, LogFilter } from './types.ts';
import { ensureRequestId, filterLogs, l0Auth } from './logic.ts';
import { coreL0Unlock, coreLoadLogs } from './coreLogs.ts';
import { LogFilterBar } from './LogFilterBar.tsx';
import { AuditModal, ErrorAggr, L0AuthCard, LogTable } from './LogCards.tsx';
import { useToast } from './useToast.tsx';
import './extras.css';

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [l0Sample, setL0Sample] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', form: 'all', actions: [], window: '24h', keyword: '', onlyAbnormal: false });
  const [auditRid, setAuditRid] = useState<string | null>(null);
  const [l0, setL0] = useState<L0State>({ role: 'admin', unlocked: false, failCount: 0, lockedUntil: null });
  const [l0Msg, setL0Msg] = useState<string | null>(null);
  const { node: toast, show } = useToast();

  // 数据源 = 内核审计账本（挂载拉取；L0 解锁后刷新可见新增 l0_view）
  useEffect(() => {
    let alive = true;
    coreLoadLogs().then((l) => { if (alive) setLogs(l); });
    return () => { alive = false; };
  }, []);

  const { fixed, missing } = useMemo(() => ensureRequestId(logs), [logs]);
  const now = Date.now();
  const shown = useMemo(() => filterLogs(fixed, filter, now), [fixed, filter, now]);

  const handleAuth = async (pwd: string) => {
    const r = l0Auth(pwd, l0);
    setL0(r.state);
    setL0Msg(r.message);
    if (r.ok) {
      // 真实内核授权：browse 写 l0_view 审计 + 回填解密样例（端壳剥 ENC 包装）
      const k = await coreL0Unlock(pwd);
      if (k.ok) {
        setL0Sample(k.sample?.replace(/^ENC\((.*)\)$/, '$1'));
        coreLoadLogs().then(setLogs); // 日志流实时可见新增 l0_view
      }
      show('l0_view 已记审计（4.3）');
    }
  };

  return (
    <div className="wrap" data-testid="logs-page">
      <h1>📜 日志记录页 <span className="badge p2">REQ-011 · P15</span></h1>
      <div className="sub">系统事件流 + 异常（与审计页互补）· software.log 全动作可查 · 数据本地种子为真相</div>

      {missing > 0 && (
        <div className="card" data-testid="missing-warn">
          ⚠ {missing} 条日志缺少 request_id，已标 n/a —— 动作没记审计是严重 bug（R-LOG2）。
        </div>
      )}

      <L0AuthCard state={l0} message={l0Msg} onAuth={handleAuth} sample={l0Sample} />
      <LogFilterBar filter={filter} onChange={setFilter} count={shown.length} />
      <ErrorAggr logs={shown} onJump={(t) => show(`跳转处置：${t}（占位）`)} />
      <LogTable logs={shown} onAudit={(rid) => setAuditRid(rid)} />

      {auditRid && <AuditModal requestId={auditRid} onClose={() => setAuditRid(null)} />}
      <div className="card">
        <b>保存与删除策略（4.3.2 / R-LOG7/8）</b>
        <div className="note">
          `software.log` 与 `audit.log` 同目录独立文件；软件日志可滚动删除（30 天，超期归档不删）；
          审计日志 append-only，本页**无普通删除按钮**——删除/归档需 Admin + 二次确认 + 写审计 audit_delete。
        </div>
      </div>
      {toast}
    </div>
  );
}
