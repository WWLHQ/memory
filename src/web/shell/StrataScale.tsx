// 功能导航栏底部的「层级刻度」（批次53）：L0–L6 七档真实计数。
// 版式沿用导航树的 .tree-group / .tree-row 规格，不另起一套独立皮肤；
// 批次55：数据来自概览页 getHomeFeed 同一次真实账本读取派生的 strata 计数；
// 不再独立读 storage，读取失败显式标注，绝不拿 0 或演示数字代替。

import { Icon } from './Icons.tsx';
import type { DockResult } from './dock.ts';
import type { StrataScaleView } from './strataScale.ts';

interface Props {
  data: DockResult<StrataScaleView> | null;
  onRefresh: () => void;
}

export function StrataScale({ data, onRefresh }: Props) {
  return (
    <div className="strata-scale" data-testid="strata-scale" role="group" aria-label="层级刻度">
      <div className="tree-group">层级刻度</div>
      {!data ? (
        <div className="strata-note">读取中…</div>
      ) : data.status !== 'ok' ? (
        <div className="strata-note err" data-testid="strata-scale-error">读取失败：{data.detail}</div>
      ) : (
        <>
          {data.view.rows.map((r) => (
            <div
              className={`strata-row${r.count == null ? ' err' : ''}`}
              key={r.layer}
              data-layer={r.layer}
              title={r.count == null
                ? `${r.layer} ${r.fullName}：该层读取失败（不是 0 条）`
                : `${r.layer} ${r.fullName}：${r.count} 条`}
            >
              <span className="strata-mark" style={{ background: r.color }} aria-hidden="true" />
              <span className="strata-layer">{r.layer}</span>
              <span className="strata-name">{r.label}</span>
              <span className="strata-count">{r.count == null ? '读取失败' : r.count}</span>
            </div>
          ))}
          <div className="strata-foot">
            <span>{data.view.kernelMode === 'browser' ? '浏览器内存账本（非本机库）' : '本机账本'}</span>
            <button className="strata-refresh" type="button" onClick={onRefresh} title="重新读取层级计数">
              <Icon name="refresh" size={11} />重读
            </button>
          </div>
        </>
      )}
    </div>
  );
}
