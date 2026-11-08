// 日志记录页（REQ-011 / P15）· 定稿版式：级别过滤 + 异常聚合 6 类 + L0 授权跳转 + 行内详情
// 审计动作流来自内核 InMemoryStorage（append-only）；程序日志段取真实 log:tail（ProgramLogPanel）。
// L0 走连续会话（§4.4.3）：管理员=管理密码；被授权账号=grant_id + 一次性密码；5 分钟无操作自动锁定。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { L0State, LogEntry, LogFilter } from './types.ts';
import { ensureRequestId, filterLogs, l0Precheck, l0Record, L0_MIN_LEN } from './logic.ts';
import { coreL0Browse, coreLoadLogs } from './coreLogs.ts';
import { useL0Session } from '../shared/useL0Session.ts';
import { useSessionContext } from '../shared/session.ts';
import { DEFAULT_PAGE_SIZE, paginate } from '../shared/paginate.ts';
import { PageNav } from '../shared/PageNav.tsx';
import { LogFilterBar } from './LogFilterBar.tsx';
import { AuditModal, ErrorAggr, L0AuthCard, LogTable } from './LogCards.tsx';
import { ProgramLogPanel } from '../Home/ProgramLogPanel.tsx';
import { useToast } from './useToast.tsx';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import './extras.css';

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [l0Sample, setL0Sample] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', form: 'all', actions: [], window: '24h', keyword: '', onlyAbnormal: false });
  const [auditRid, setAuditRid] = useState<string | null>(null);
  const { role } = useSessionContext();
  const [l0, setL0] = useState<L0State>({ role: null, unlocked: false, failCount: 0, lockedUntil: null });
  const [l0Msg, setL0Msg] = useState<string | null>(null);
  const [grantId, setGrantId] = useState('');
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [pager, setPager] = useState({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const { node: toast, show } = useToast();

  const reload = useCallback(() => {
    return coreLoadLogs().then(
      (l) => { setLogs(l); setLoadErr(null); },
      (e: unknown) => { setLoadErr(kernelErrorText(e)); },
    );
  }, []);

  // 数据源 = 内核审计账本（挂载拉取；L0 解锁后刷新可见新增 l0_view）
  useEffect(() => { void reload(); }, [reload]);

  const onExpired = useCallback((reason: string) => {
    setL0((s) => ({ ...s, unlocked: false }));
    setL0Sample(undefined);
    setL0Msg(reason === 'idle_5min'
      ? 'L0 已因 5 分钟无操作自动锁定：如需再次查阅请重新解锁（成员需重新申请）'
      : 'L0 会话已被主进程回收（重启/锁屏/休眠或空闲到期），请重新解锁');
    void reload();
  }, [reload]);
  const l0Session = useL0Session({ onExpired });

  const { fixed, missing } = useMemo(() => ensureRequestId(logs), [logs]);
  const now = Date.now();
  const shown = useMemo(() => filterLogs(fixed, filter, now), [fixed, filter, now]);
  const paged = useMemo(() => paginate(shown, pager), [shown, pager]);

  const l0State: L0State = { ...l0, role, unlocked: !!l0Session.session };

  const jumpToL0 = () => {
    const card = document.querySelector('[data-testid="l0-card"]') as HTMLElement | null;
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const input = card?.querySelector('[data-testid="l0-pwd"], [data-testid="l0-grant-id"]') as HTMLInputElement | null;
    input?.focus();
  };

  const handleAuth = async (pwd: string, grant?: string) => {
    const pre = l0Precheck(l0State, Date.now(), role === 'member' ? grant : undefined);
    if (pre.blocked) {
      setL0Msg(pre.message);
      return;
    }
    if (pwd.length < L0_MIN_LEN) {
      setL0Msg(`L0 密码至少 ${L0_MIN_LEN} 位（§4.4.1）`);
      return;
    }
    const u = await l0Session.unlock(pwd, role === 'member' ? grant : undefined);
    if (!u.ok) {
      const r = l0Record(l0State, false);
      setL0(r.state);
      setL0Msg(`${u.error}（已记审计）`);
      return;
    }
    const b = await coreL0Browse(u.session.l0_session_id);
    if (!b) {
      void l0Session.lock();
      setL0Msg('已解锁但读取 L0 失败（会话可能已过期），请重新解锁');
      return;
    }
    const r = l0Record(l0State, true);
    setL0(r.state);
    if (b.status === 'empty') {
      setL0Sample(undefined);
      setL0Msg('已解锁：当前 L0 层无加密记忆');
    } else {
      setL0Sample(b.sample);
      setL0Msg(`${r.message} · 空闲 5 分钟自动锁定`);
      show('l0_view 已记审计（4.3）');
    }
    void reload(); // 日志流实时可见新增 l0_view
  };

  const handleLock = async () => {
    await l0Session.lock();
    setL0((s) => ({ ...s, unlocked: false }));
    setL0Sample(undefined);
    setL0Msg('L0 已锁定：wrapped DEK 已删除，再次查阅需重新解锁（成员需重新申请）');
    void reload();
  };

  const handleRequest = async (projectIds: string, reason: string) => {
    const ids = projectIds.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      setRequestMsg('请填写项目 ID（逗号分隔）');
      return;
    }
    const r = await l0Session.requestAccess(ids, reason.trim() || undefined);
    setRequestMsg(r.ok
      ? `已提交申请 ${r.request_id}：等待管理员在「账号与安全」页批准并发放一次性授权密码`
      : `申请失败：${r.error}`);
  };

  return (
    <div className="p0-page" data-testid="logs-page">
      <div className="p0-hd">
        <h2>日志记录</h2>
        <span className="p0-tag">REQ-011 · P15</span>
        <span className="p0-sub">审计动作流（真实账本）+ 程序日志（真实 log:tail）· error 恒置顶</span>
        <span className="p0-right">
          <button type="button" className="p0-btn" data-testid="logs-jump-l0" onClick={jumpToL0}>去 L0 授权</button>
        </span>
      </div>

      {loadErr && (
        <div className="p0-banner err" data-testid="logs-load-error">
          ⚠️ 读取审计动作流失败：{loadErr}——这是「加载失败」，不是「没有日志」。
          <button type="button" className="p0-btn" onClick={() => void reload()}>重试</button>
        </div>
      )}

      {missing > 0 && (
        <div className="p0-banner warn" data-testid="missing-warn">
          ⚠ {missing} 条日志缺少 request_id，已标 n/a —— 动作没记审计是严重 bug（R-LOG2）。
        </div>
      )}

      <LogFilterBar
        filter={filter}
        onChange={(f) => {
          setFilter(f);
          setPager((p) => (p.page === 1 ? p : { ...p, page: 1 }));
        }}
        count={shown.length}
      />
      <ErrorAggr logs={shown} />

      {/* 程序运行日志（数据取真实 log:tail；批次17 建，批次24 人话化 + 50 条可滚动窗口） */}
      <ProgramLogPanel />

      <LogTable
        logs={paged.items}
        indexOffset={(paged.page - 1) * paged.pageSize}
        onAudit={(rid) => setAuditRid(rid)}
      />
      <PageNav
        paged={paged}
        onPage={(page) => setPager((p) => ({ ...p, page }))}
        onPageSize={(pageSize) => setPager({ page: 1, pageSize })}
        note={`每页 ${paged.pageSize} 条 · 命中 ${shown.length} 条`}
      />

      <L0AuthCard
        role={role}
        unlocked={l0State.unlocked}
        message={l0Msg}
        sample={l0Sample}
        remainingMs={l0Session.remainingMs}
        lockedUntil={l0.lockedUntil}
        busy={l0Session.busy}
        grantId={grantId}
        onGrantIdChange={setGrantId}
        onAuth={(pwd, grant) => void handleAuth(pwd, grant)}
        onLock={() => void handleLock()}
        requestMsg={requestMsg}
        onRequest={(p, r) => void handleRequest(p, r)}
      />

      {auditRid && <AuditModal requestId={auditRid} onClose={() => setAuditRid(null)} />}
      <div className="p0-card">
        <div className="p0-hd"><h3>保存与删除策略（4.3.2 / R-LOG7/8）</h3></div>
        <div className="p0-note">
          `software.log` 与 `audit.log` 同目录独立文件；软件日志可滚动删除（30 天，超期归档不删）；
          审计日志 append-only，本页**无普通删除按钮**——删除/归档需 Admin + 二次确认 + 写审计 audit_delete。
        </div>
      </div>
      {toast}
    </div>
  );
}
