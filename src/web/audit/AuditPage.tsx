// 审计日志页（REQ-006 / P11）· 完整编排（T5）
// 过滤栏(T3) + 列表(T4) + 导出 CSV/JSON（§P11）+ toast + 后端 mirror 注入点。
// 审计流来自内核 InMemoryStorage（append-only，挂载拉取）；request_id 链路追踪（18.2-E）。
import { useEffect, useMemo, useState } from 'react';
import { FilterBar } from './FilterBar.tsx';
import { AuditTable } from './AuditTable.tsx';
import { useToast } from './useToast.tsx';
import { useAuditMirror } from './useAuditMirror.ts';
import { chainByRequest, exportCsv, exportJson, filterEntries, initialAuditChain, initialAuditFilter } from './logic.ts';
import { coreLoadAudit } from './coreAudit.ts';
import { DEFAULT_PAGE_SIZE, paginate } from '../shared/paginate.ts';
import { PageNav } from '../shared/PageNav.tsx';
import type { AuditFilter, AuditEntry } from './types.ts';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  // D4：壳层深链初值（?user_id=... / ?chain=<request_id>）在页面侧真正生效
  const initialFilter = initialAuditFilter(location.search);
  const [filter, setFilter] = useState<AuditFilter>(initialFilter);
  const [applied, setApplied] = useState<AuditFilter>(initialFilter);
  const [chainId, setChainId] = useState<string | null>(() => initialAuditChain(location.search));
  const [pager, setPager] = useState({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const toast = useToast();
  const mirror = useAuditMirror();

  // 数据源 = 内核审计账本
  useEffect(() => {
    let alive = true;
    coreLoadAudit().then((l) => { if (alive) setEntries(l); });
    return () => { alive = false; };
  }, []);

  const displayed = useMemo(() => {
    if (chainId) return chainByRequest(entries, chainId);
    return filterEntries(entries, applied);
  }, [entries, applied, chainId]);

  const paged = useMemo(() => paginate(displayed, pager), [displayed, pager]);

  function handleQuery() {
    setChainId(null);
    setApplied(filter);
    setPager((p) => (p.page === 1 ? p : { ...p, page: 1 }));
    mirror.audit('audit_query');
  }
  function handleReset() {
    setFilter({});
    setApplied({});
    setChainId(null);
    setPager((p) => (p.page === 1 ? p : { ...p, page: 1 }));
  }
  function handleToggleChain(requestId: string) {
    setChainId((cur) => (cur === requestId ? null : requestId));
    setPager((p) => (p.page === 1 ? p : { ...p, page: 1 }));
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
    <div className="wrap" data-testid="audit-page">
      <h1>📋 审计日志页 <span className="badge p2">REQ-006 · P11</span></h1>
      <div className="sub">4.3 统一审计 + request_id 链路追踪（18.2-E）· 数据真相 = 内核审计账本（append-only）</div>

      <FilterBar filter={filter} onChange={setFilter} onQuery={handleQuery} onReset={handleReset} />

      <div className="card">
        <div className="actions" style={{ marginBottom: 10 }}>
          <button type="button" className="btn" data-testid="export-csv"
            onClick={() => download('audit.csv', exportCsv(displayed), 'text/csv')}>
            导出 CSV（全部 {displayed.length} 条）
          </button>
          <button type="button" className="btn" data-testid="export-json"
            onClick={() => download('audit.json', exportJson(displayed), 'application/json')}>
            导出 JSON（全部 {displayed.length} 条）
          </button>
          {chainId && (
            <button type="button" className="btn" data-testid="clear-chain" onClick={() => setChainId(null)}>
              退出链路视图（{chainId}）
            </button>
          )}
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

      <div className="note">
        红线：enterprise_id 租户隔离（3.x/18.2-A）；所有操作写审计（G6）；request_id 串链（18.2-E）。
        审计上抛经 mirrorClient 真接 home server 的 POST /api/mirror/audit（?backend= 可指定后端；显式关闭时跳过）。后端不可达时失败会显示提示，页面数据不受影响。
        点行末 ↗ 跳检索页（REQ-012）查看该 request_id 的真实审计链路上下文；账本查无此 id 时如实显示空，不生成模拟结果。
      </div>

      {toast.node}
    </div>
  );
}
