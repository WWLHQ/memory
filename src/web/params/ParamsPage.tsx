// 全局参数页（REQ-006 / P5）T4 编排
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, DEFAULT_DEV, SEED_KB_POLICIES } from './seed.ts';
import { validateAll } from './logic.ts';
import { useParamsMirror } from './useParamsMirror.ts';
import { coreLoadParams, coreSaveParams } from './coreParams.ts';
import { NormalConfigCard } from './NormalConfigCard.tsx';
import { KbPolicyTable } from './KbPolicyTable.tsx';
import { DevPanel } from './DevPanel.tsx';
import { useToast } from './useToast.tsx';
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

export function ParamsPage() {
  const [cfg, setCfg] = useState<NormalConfig>(DEFAULT_CONFIG);
  const [kbs, setKbs] = useState<KbPolicyRow[]>(SEED_KB_POLICIES);
  const [dev, setDev] = useState<DevParams>(DEFAULT_DEV);
  const [changed, setChanged] = useState<string[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useParamsMirror();
  const seq = useRef(0);

  // 挂载回填：内核 preference 快照（无快照 → 保持默认值）
  useEffect(() => {
    let alive = true;
    coreLoadParams()
      .then((saved) => {
        if (!saved || !alive) return;
        setCfg(saved.cfg);
        setKbs(saved.kbs);
        setDev(saved.dev);
      })
      .catch(() => {}); // 内核不可达 → 保持默认（safe-noop 语义）
    return () => {
      alive = false;
    };
  }, []);

  const errors = validateAll(cfg, kbs, dev);

  const track = (label: string) => setChanged((prev) => [...new Set([...prev, label])]);

  const handleSave = async () => {
    if (errors.length > 0) {
      show(`保存被拦截：${errors[0]}`);
      return;
    }
    seq.current += 1;
    const requestId = `req_p${seq.current}`;
    try {
      const receipt = await coreSaveParams(cfg, kbs, dev, requestId); // 内核真写 + param_save 审计
      mirror.save(cfg, kbs, dev, receipt.request_id);
      show(`已保存全局参数（${receipt.request_id}）`);
      setChanged([]);
    } catch {
      show('保存失败：内核暂不可达');
    }
  };

  return (
    <div className="wrap" data-testid="params-page">
      <h1>🧩 全局参数页 <span className="badge p2">REQ-006 · P5</span></h1>
      <div className="sub">17.6 文案化配置（G7 不暴露参数名）· 内核 preference 快照为真相</div>

      <NormalConfigCard
        cfg={cfg}
        onChange={(next, label) => { setCfg(next); track(label); }}
      />
      <KbPolicyTable
        rows={kbs}
        onChange={(next, label) => { setKbs(next); track(label); }}
      />
      <DevPanel
        dev={dev}
        onChange={(next, label) => { setDev(next); track(label); }}
      />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <b>保存</b>
            {errors.length > 0 && (
              <div className="note" data-testid="save-errors">{errors.map((e, i) => <div key={i}>· {e}</div>)}</div>
            )}
            {changed.length > 0 && <div className="note" data-testid="changed-list">待保存：{changed.join('、')}</div>}
          </div>
          <button type="button" className="btn primary" data-testid="save-btn" onClick={handleSave}>保存全局参数</button>
        </div>
      </div>
      {toast}
    </div>
  );
}
