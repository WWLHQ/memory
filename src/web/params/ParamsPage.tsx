// 全局参数页（REQ-006 / P5）T4 编排
// ⚠ 内核读不到（批次25 P0-7）：不再静默把默认值当成「已保存参数」——三态加载 + 来源说明 + 重试。
// 阶段5-E / B9：知识库策略表恒为内核 policyFor() 真值的只读镜像，不再是可编辑偏好，
// 因此挂载/重试回填只覆盖 cfg / dev，旧快照里的 kbs（可能是原型期中文分类与旧数值）不再回流 UI。
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, DEFAULT_DEV, DEFAULT_KB_POLICIES } from './defaults.ts';
import { validateAll } from './logic.ts';
import { useParamsMirror } from './useParamsMirror.ts';
import { coreLoadParams, coreSaveParams } from './coreParams.ts';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { newRequestId } from '../kernel.ts';
import { NormalConfigCard } from './NormalConfigCard.tsx';
import { KbPolicyTable } from './KbPolicyTable.tsx';
import { KbManagementCard } from './KbManagementCard.tsx';
import { LlmEngineCard } from './LlmEngineCard.tsx';
import { RefineQueueCard } from './RefineQueueCard.tsx';
import { RecallHardCard } from './RecallHardCard.tsx';
import { DevPanel } from './DevPanel.tsx';
import { useToast } from './useToast.tsx';
import type { DevParams, NormalConfig } from './types.ts';

type ParamsSnapshot = Awaited<ReturnType<typeof coreLoadParams>>;

export function ParamsPage({ load = coreLoadParams }: { load?: () => Promise<ParamsSnapshot> } = {}) {
  const [cfg, setCfg] = useState<NormalConfig>(DEFAULT_CONFIG);
  const [dev, setDev] = useState<DevParams>(DEFAULT_DEV);
  // 知识库策略不是页面状态：它恒等于内核当下真实策略，不随用户编辑或旧快照变化。
  const kbs = DEFAULT_KB_POLICIES;
  const [changed, setChanged] = useState<string[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useParamsMirror();
  const snapshot = useKernelLoad<ParamsSnapshot>('params', load);
  const { phase, data: saved, error: loadError, retry } = snapshot;
  const touchedRef = useRef(false);

  // 挂载/重试回填：只有真读到内核快照才覆盖默认值（null = 内核里没有快照，保持默认并如实标注）；
  // 用户一旦改过任意字段就不再回填，避免异步快照迟到后覆盖用户已输入的编辑。
  useEffect(() => {
    if (phase !== 'ok' || !saved || touchedRef.current) return;
    setCfg(saved.cfg);
    setDev(saved.dev);
  }, [phase, saved]);

  const errors = validateAll(cfg, kbs, dev);

  const track = (label: string) => {
    touchedRef.current = true;
    setChanged((prev) => [...new Set([...prev, label])]);
  };

  const handleSave = async () => {
    if (errors.length > 0) {
      show(`保存被拦截：${errors[0]}`);
      return;
    }
    const requestId = newRequestId('req');
    try {
      const receipt = await coreSaveParams(cfg, kbs, dev, requestId); // 内核真写 + param_save 审计
      mirror.save(cfg, kbs, dev, receipt.request_id);
      show(`已保存全局参数（${receipt.request_id}）`);
      setChanged([]);
    } catch (e) {
      show(`保存失败：${kernelErrorText(e)}`); // 内核真实原因，不写成「暂不可达」猜测
    }
  };

  return (
    <div className="p0-page" data-testid="params-page">
      <div className="p0-hd">
        <h2>🧩 参数</h2>
        <span className="p0-tag">REQ-006 · P5</span>
        <span className="p0-tag info">params:v1 · param_save 审计</span>
      </div>
      <div className="sub">
        17.6 文案化配置（G7 不暴露参数名）· 内核 preference 快照为真相 ·
        卡片：普通配置 / 知识库策略（内核真值只读）/ 知识库管理 / 引擎 / 提炼队列 / 硬前置召回（A/B/C 三层开关）/ 开发者（仅记录）
      </div>

      {phase === 'loading' && <div className="note" data-testid="params-loading">正在从内核读取已保存参数…</div>}
      {phase === 'error' && <KernelLoadError what="读取内核已保存参数" error={loadError} onRetry={retry} />}
      {phase === 'ok' && !saved && (
        <div className="note" data-testid="params-default">
          内核暂无已保存参数快照，其余表单是<b>默认值</b>（不是内核里的设置）；「知识库策略表」是内核真实策略的只读展示，不属快照。点「保存全局参数」即写入内核账本并记 param_save 审计。
        </div>
      )}
      {phase === 'ok' && saved && <div className="note" data-testid="params-from-kernel">当前表单已回填内核中已保存的参数快照。</div>}

      <NormalConfigCard
        cfg={cfg}
        onChange={(next, label) => { setCfg(next); track(label); }}
      />
      <KbPolicyTable />
      <KbManagementCard />
      <LlmEngineCard />
      <RefineQueueCard />
      <RecallHardCard />
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
