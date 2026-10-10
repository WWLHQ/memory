// 审计日志页（REQ-006 / P11）· 完整编排（T5）
// 过滤栏(T3) + 列表(T4) + 导出 CSV/JSON（§P11）+ toast + 后端 mirror 注入点。
// 数据本地种子为真相；request_id 链路追踪（18.2-E）。
import { useMemo, useState } from 'react';
import { FilterBar } from './FilterBar.tsx';
import { AuditTable } from './AuditTable.tsx';
import { useToast } from './useToast.tsx';
import { useAuditMirror } from './useAuditMirror.ts';
import { chainByRequest, exportCsv, exportJson, filterEntries } from './logic.ts';
import { SEED_AUDIT } from './seed.ts';
import type { AuditFilter } from './types.ts';

export function AuditPage() {
  const [filter, setFilter] = useState<AuditFilter>({});
  const [applied, setApplied] = useState<AuditFilter>({});
  const [chainId, setChainId] = useState<string | null>(null);
  const toast = useToast();
  const mirror = useAuditMirror();

  const displayed = useMemo(() => {
    if (chainId) return chainByRequest(SEED_AUDIT, chainId);
    return filterEntries(SEED_AUDIT, applied);
  }, [applied, chainId]);

  function handleQuery() {
    setChainId(null);
    setApplied(filter);
    mirror.audit('audit_query');
  }
  function handleReset() {
    setFilter({});
    setApplied({});
    setChainId(null);
  }
  function handleToggleChain(requestId: string) {
    setChainId((cur) => (cur === requestId ? null : requestId));
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
      <div className="sub">4.3 统一审计 + request_id 链路追踪（18.2-E）· 数据本地种子为真相</div>

      <FilterBar filter={filter} onChange={setFilter} onQuery={handleQuery} onReset={handleReset} />

      <div className="card">
        <div className="actions" style={{ marginBottom: 10 }}>
          <button type="button" className="btn" data-testid="export-csv"
            onClick={() => download('audit.csv', exportCsv(displayed), 'text/csv')}>
            导出 CSV
          </button>
          <button type="button" className="btn" data-testid="export-json"
            onClick={() => download('audit.json', exportJson(displayed), 'application/json')}>
            导出 JSON
          </button>
          {chainId && (
            <button type="button" className="btn" data-testid="clear-chain" onClick={() => setChainId(null)}>
              退出链路视图（{chainId}）
            </button>
          )}
        </div>
        <AuditTable entries={displayed} activeRequestId={chainId} onToggleChain={handleToggleChain} />
      </div>

      <div className="note">
        红线：enterprise_id 租户隔离（3.x/18.2-A）；所有操作写审计（G6）；request_id 串链（18.2-E）。
        后端镜像当前为 safe-noop（home server 暂无 audit 端点）。跳检索页为占位（检索页 REQ-012 待实现）。
      </div>

      {toast.node}
    </div>
  );
}
