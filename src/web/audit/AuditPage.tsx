// 审计日志页（REQ-006 / P11）· 定稿 9 列 / 链路视图 / 双导出
// 过滤栏 4 维（动作 / 时间 / request_id / Agent）查询时下推真实 storage.queryAudit；
// 数据真相 = 内核审计账本（append-only，挂载拉取）。空态与加载失败分开呈现，绝不静默空表。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilterBar } from './FilterBar.tsx';
import { AuditTable } from './AuditTable.tsx';
import { ChainView } from './ChainView.tsx';
import { useToast } from './useToast.tsx';
import { useAuditMirror } from './useAuditMirror.ts';
import { chainByRequest, exportCsv, exportJson, filterEntries, initialAuditChain, initialAuditFilter } from './logic.ts';
import { coreLoadAudit } from './coreAudit.ts';
import { DEFAULT_PAGE_SIZE, paginate } from '../shared/paginate.ts';
import { PageNav } from '../shared/PageNav.tsx';
import { KernelLoadError, kernelErrorText } from '../shared/kernelLoad.tsx';
import type { AuditFilter, AuditEntry } from './types.ts';
import './theme.css';

type Phase = 'loading' | 'ok' | 'error';

/** 合并两次查询结果（按账本行唯一键去重；保留并集，避免筛选查询后重置拿不到全量） */
function mergeAudit(prev: AuditEntry[], next: AuditEntry[]): AuditEntry[] {
  const seen = new Set(prev.map((e) => `${e.request_id}|${e.action}|${e.created_at}|${e.resource_id}`));
  const out = prev.slice();
  for (const e of next) {
    const k = `${e.request_id}|${e.action}|${e.created_at}|${e.resource_id}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

export function AuditPage() {
  const initialFilter = initialAuditFilter(location.search);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<AuditFilter>(initialFilter);
  const [applied, setApplied] = useState<AuditFilter>(initialFilter);
  const [chainId, setChainId] = useState<string | null>(() => initialAuditChain(location.search));
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pager, setPager] = useState({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const toast = useToast();
  const mirror = useAuditMirror();

  const fetchAudit = useCallback((f: AuditFilter) => {
    return coreLoadAudit(f).then(
      (list) => { setEntries((prev) => mergeAudit(prev, list)); setPhase('ok'); setError(null); },
      (e: unknown) => { setPhase('error'); setError(kernelErrorText(e)); },
    );
  }, []);

  useEffect(() => { void fetchAudit({}); }, [fetchAudit]);

  const displayed = useMemo(() => {
    if (chainId) return chainByRequest(entries, chainId);
    return filterEntries(entries, applied);
  }, [entries, applied, chainId]);

  const paged = useMemo(() => paginate(displayed, pager), [displayed, pager]);

  function resetPage() {
    setPager((p) => (p.page === 1 ? p : { ...p, page: 1 }));
  }
  function handleQuery() {
    setChainId(null);
    setApplied(filter);
    resetPage();
    void fetchAudit(filter);
    mirror.audit('audit_query');
  }
  function handleReset() {
    setFilter({});
    setApplied({});
    setChainId(null);
    resetPage();
    void fetchAudit({});
  }
  function handleToggleChain(requestId: string) {
    setChainId((cur) => (cur === requestId ? null : requestId));
    resetPage();
    mirror.audit('audit_chain');
  }

  function download(filename: string, content: string, mime: string) {
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.show(`已导出 ${filename}`);
    } catch {
      toast.show('已生成导出内容（当前环境不支持下载）');
    }
  }

  return (
    <div className="p0-page" data-testid="audit-page">
      <div className="p0-hd">
        <h2>审计日志</h2>
        <span className="p0-tag">REQ-006 · P11</span>
        <span className="p0-sub">4.3 统一审计 · append-only · 9 列 · request_id 链路追踪（18.2-E）</span>
        <span className="p0-right">
          <span className="p0-tag info">数据真相 = 内核审计账本</span>
          {phase === 'ok' && <span className="p0-tag">账本 {entries.length} 条</span>}
        </span>
      </div>

      <FilterBar filter={filter} onChange={setFilter} onQuery={handleQuery} onReset={handleReset} />

      {phase === 'error' ? (
        <KernelLoadError what="读取审计账本" error={error} onRetry={() => void fetchAudit(applied)} />
      ) : (
        <>
          {phase === 'loading' && entries.length === 0 && (
            <div className="p0-card" data-testid="audit-loading">
              <div className="p0-note">加载真实审计账本中…</div>
            </div>
          )}

          {phase === 'ok' && displayed.length === 0 && (
            <div className="p0-card" data-testid="audit-empty">
              {entries.length === 0 ? (
                <>
                  <b>审计账本为空（append-only，尚无真实动作）。</b>
                  <div className="p0-note">本页不注入演示/种子数据；写入、检索、授权等真实操作发生后会写入账本。</div>
                </>
              ) : (
                <>
                  <b>当前过滤条件下没有事件。</b>
                  <div className="p0-note">账本共 {entries.length} 条，本次 0 命中——不是账本为空，也不会静默显示空表。</div>
                </>
              )}
            </div>
          )}

          {chainId && <ChainView requestId={chainId} rows={displayed} />}

          <div className="p0-card">
            <div className="p0-hd">
              <h3>事件流</h3>
              <span className="p0-sub">当前视图 {displayed.length} 条</span>
              <span className="p0-right">
                <button type="button" className="p0-btn" data-testid="export-csv"
                  onClick={() => download('audit.csv', exportCsv(displayed), 'text/csv')}>
                  导出 CSV（{displayed.length}）
                </button>
                <button type="button" className="p0-btn" data-testid="export-json"
                  onClick={() => download('audit.json', exportJson(displayed), 'application/json')}>
                  导出 JSON（{displayed.length}）
                </button>
                {chainId && (
                  <button type="button" className="p0-btn" data-testid="clear-chain" onClick={() => setChainId(null)}>
                    退出链路视图（{chainId}）
                  </button>
                )}
              </span>
            </div>
            <AuditTable
              entries={paged.items}
              indexOffset={(paged.page - 1) * paged.pageSize}
              activeRequestId={chainId}
              onToggleChain={handleToggleChain}
            />
            <PageNav
              paged={paged}
              onPage={(page) => setPager((p) => ({ ...p, page }))}
              onPageSize={(pageSize) => setPager({ page: 1, pageSize })}
              note={`每页 ${paged.pageSize} 条 · 当前视图 ${displayed.length} 条`}
            />
          </div>
        </>
      )}

      <div className="p0-card">
        <div className="p0-note">
          红线：enterprise_id 租户隔离（3.x/18.2-A）；所有操作写审计（G6）；request_id 串链（18.2-E）。
          审计上抛经 mirrorClient 真接 home server 的 POST /api/mirror/audit（?backend= 可指定后端；显式关闭时跳过）。
          点 request_id 展开链路视图：只连真实存在的 5 段事件，缺失段显示「—」；备注列 ↗ 跳检索页查看该 request_id 的真实审计链路上下文。
        </div>
      </div>

      {toast.node}
    </div>
  );
}
