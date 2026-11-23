// 全局参数页（REQ-006 / P5）T4 编排
// ⚠ 内核读不到（批次25 P0-7）：不再静默把默认值当成「已保存参数」——三态加载 + 来源说明 + 重试。
// 阶段5-E / B9：知识库策略表恒为内核 policyFor() 真值的只读镜像，不再是可编辑偏好，
// 因此挂载/重试回填只覆盖 cfg / dev，旧快照里的 kbs（可能是原型期中文分类与旧数值）不再回流 UI。
// 批次63：按真实使用场景重排为「摘要 + 五组卡片」，版式对齐概览页（af-panel / af-g3 / af-stat）；
// 每个分组写明默认值与来源，改动显示「已修改未保存」，保存后持久显示 param_save 审计回执。
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, DEFAULT_DEV, DEFAULT_KB_POLICIES } from './defaults.ts';
import { validateAll } from './logic.ts';
import { useParamsMirror } from './useParamsMirror.ts';
import { coreLoadParams, coreSaveParams } from './coreParams.ts';
import {
  KernelLoadError, kernelErrorRaw, kernelErrorText, useKernelLoad,
} from '../shared/kernelLoad.tsx';
import { getTenant, newRequestId } from '../kernel.ts';
import { NormalConfigCard } from './NormalConfigCard.tsx';
import { KbPolicyTable } from './KbPolicyTable.tsx';
import { KbManagementCard } from './KbManagementCard.tsx';
import { RefineQueueCard } from './RefineQueueCard.tsx';
import { RecallHardCard } from './RecallHardCard.tsx';
import { AppShellCard } from './AppShellCard.tsx';
import { SyncTeamCard } from './SyncTeamCard.tsx';
import { DevPanel } from './DevPanel.tsx';
import { useToast } from './useToast.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { fetchMirrorIntegrity, type MirrorIntegrityView } from '../security/accountsClient.ts';
import type { DevParams, NormalConfig } from './types.ts';
import './paramsPage.css';

type ParamsSnapshot = Awaited<ReturnType<typeof coreLoadParams>>;

/** 可编辑参数量：普通配置 7（遗忘/保留/自动整理/重要程度/成本单价/反代理单价/日配额）+ 底层 13（权重 4 + payload 3 + 补查 4 + N/M 2） */
const CFG_FIELD_COUNT = 7;
const DEV_FIELD_COUNT = 13;
const EDITABLE_PARAM_COUNT = CFG_FIELD_COUNT + DEV_FIELD_COUNT;

interface SaveReceipt {
  request_id: string;
  version: number;
  savedAt: number;
}

function fmtShort(ts: number | undefined): string {
  if (!ts) return '尚无保存记录';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '时间戳无效（内核未给可解析时间）';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 真实错误码：优先异常 code，其次从原始文本里抽 E_XXX；抽不到就如实写「无错误码」 */
function errorCode(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code) return code;
  const m = kernelErrorRaw(e).match(/E_[A-Z0-9_]+/);
  return m?.[0] ?? '无错误码';
}

/** 审计窗口 / 签名封存：读真实服务端 integrity（只读，不在本页做封存） */
function MirrorSealHint() {
  const [view, setView] = useState<MirrorIntegrityView | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMirrorIntegrity().then((v) => { if (alive) setView(v); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="card" data-testid="params-audit-seal">
      <b>审计窗口与签名封存</b>
      <div className="note">
        审计账本为追加式（在档行数与路径见下方「记忆库管理」）；下面读的是服务端 <code>/api/mirror/audit</code> 的链式签名校验真值。
        本页只读，封存动作在「账号与安全 → 检查摘要」的「需处理」清单里执行。
      </div>
      {view === null ? (
        <div className="note">正在读取签名封存状态…</div>
      ) : view.error ? (
        <div className="note" data-testid="params-audit-seal-state">读取失败：{view.error}（如实显示，不显示猜测值）</div>
      ) : (
        <div className="note" data-testid="params-audit-seal-state">
          已签名封存 <b>{view.sealed}</b> 条 · 旧版未签名 <b>{view.legacy_unsealed}</b> 条
          {view.algorithm ? ` · 算法 ${view.algorithm}` : ''}
          {view.legacy_unsealed > 0 ? ' · 未签名段可在「账号与安全」一键封存' : ''}
        </div>
      )}
    </div>
  );
}

export function ParamsPage({ load = coreLoadParams }: { load?: () => Promise<ParamsSnapshot> } = {}) {
  useHostTheme();
  const tenant = getTenant();
  const [cfg, setCfg] = useState<NormalConfig>(DEFAULT_CONFIG);
  const [dev, setDev] = useState<DevParams>(DEFAULT_DEV);
  // 知识库策略不是页面状态：它恒等于内核当下真实策略，不随用户编辑或旧快照变化。
  const kbs = DEFAULT_KB_POLICIES;
  const [changed, setChanged] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<SaveReceipt | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
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
      const r = await coreSaveParams(cfg, kbs, dev, requestId); // 内核真写 + param_save 审计
      mirror.save(cfg, kbs, dev, r.request_id);
      setReceipt({ request_id: r.request_id, version: r.version, savedAt: r.savedAt });
      setSaveErr(null);
      show(`已保存全局参数（${r.request_id}）`);
      setChanged([]);
    } catch (e) {
      const code = errorCode(e);
      setSaveErr(`[${code}] ${kernelErrorText(e)}`);
      show(`保存失败：${code}`); // 真实错误码，不写成「暂不可达」猜测
    }
  };

  const lastSavedAt = receipt?.savedAt ?? saved?.savedAt;
  const lastVersion = receipt?.version ?? saved?.version;

  return (
    <div className="p0-page params-page" data-testid="params-page">
      <div className="af-head">
        <h1>🧩 全局参数</h1>
        <span className="sub">按真实使用场景分组 · 内核 preference 快照为真相 · 保存写 param_save 审计</span>
        <span className="right">
          <span className="p0-tag info">params:v1</span>
        </span>
      </div>

      {/* ── 顶部摘要：参数量 / 最近保存 / 生效范围 / 未保存改动 ── */}
      <section className="af-panel" data-testid="params-summary">
        <div className="af-ph">
          <h3>参数摘要</h3>
          <span className="hint">{saved ? `内核快照 v${saved.version}` : '内核暂无快照'}</span>
        </div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat" data-testid="sum-param-count">
              <div className="k">可编辑参数<span>params:v1</span></div>
              <div className="v">{EDITABLE_PARAM_COUNT}<em>项</em></div>
              <div className="d mut">普通配置 {CFG_FIELD_COUNT} · 底层 {DEV_FIELD_COUNT}</div>
            </div>
            <div className="af-stat" data-testid="sum-saved-at">
              <div className="k">最近保存<span>{lastVersion ? `v${lastVersion}` : '无记录'}</span></div>
              <div className="v">{fmtShort(lastSavedAt)}</div>
              <div className="d mut">{lastSavedAt ? '账本 updated_at' : '尚未保存过参数'}</div>
            </div>
            <div className="af-stat" data-testid="sum-scope">
              <div className="k">生效范围<span>本机内核</span></div>
              <div className="v">本机<em>内核</em></div>
              <div className="d mut">{tenant.enterprise_id} / {tenant.team_id}</div>
            </div>
            <div className="af-stat" data-testid="sum-dirty">
              <div className="k">未保存改动<span>changed</span></div>
              <div className="v">{changed.length}<em>项</em></div>
              <div className={`d ${changed.length > 0 ? 'mut' : ''}`}>
                {changed.length > 0 ? '已修改未保存' : '与内核快照一致'}
              </div>
            </div>
          </div>
          <div className="af-note" data-testid="params-receipt" style={{ marginTop: 10 }}>
            {receipt
              ? `最近保存回执：${receipt.request_id} · v${receipt.version} · ${fmtShort(receipt.savedAt)}（param_save 审计已落账本）`
              : saved
                ? `当前表单回填自内核快照：v${saved.version} · ${fmtShort(saved.savedAt)}；本次会话尚无新保存回执。`
                : '内核暂无 params:v1 快照；下方表单显示默认值，点「保存全局参数」才会写入内核并记 param_save 审计。'}
          </div>
          {saveErr && (
            <div className="af-note bad" data-testid="params-save-error" style={{ marginTop: 6 }}>
              保存失败：{saveErr}
            </div>
          )}
          {phase === 'loading' && <div className="af-note" data-testid="params-loading" style={{ marginTop: 8 }}>正在从内核读取已保存参数…</div>}
          {phase === 'error' && (
            <div style={{ marginTop: 8 }}>
              <KernelLoadError what="读取内核已保存参数" error={loadError} onRetry={retry} />
            </div>
          )}
          {phase === 'ok' && !saved && (
            <div className="af-note" data-testid="params-default" style={{ marginTop: 8 }}>
              内核暂无已保存参数快照，其余表单是<b>默认值</b>（不是内核里的设置）；「知识库策略表」是内核真实策略的只读展示，不属快照。
              点「保存全局参数」即写入内核账本并记 param_save 审计。
            </div>
          )}
          {phase === 'ok' && saved && (
            <div className="af-note" data-testid="params-from-kernel" style={{ marginTop: 8 }}>
              当前表单已回填内核中已保存的参数快照。
            </div>
          )}
        </div>
      </section>

      {/* ── 六组场景卡（三列网格，版式同概览页；增长/召回已按用户要求左右互换） ── */}
      <div className="af-g3 params-groups">
        <section className="af-panel" data-testid="param-group-growth">
          <div className="af-ph">
            <h3>增长与遗忘</h3>
            <span className="hint">growth:v1 / 快照</span>
          </div>
          <div className="af-pb af-stack">
            <div className="af-note">
              默认：中 / 数月 / 开 / 重要。来源 params:v1 快照；内核 6h 遗忘调度生效，知识库策略表只读。
            </div>
            <NormalConfigCard
              cfg={cfg}
              section="growth"
              onChange={(next, label) => { setCfg(next); track(label); }}
            />
            <KbPolicyTable />
          </div>
        </section>

        <section className="af-panel" data-testid="param-group-recall">
          <div className="af-ph">
            <h3>召回与注入</h3>
            <span className="hint">A/B/C · 权重 · payload</span>
          </div>
          <div className="af-pb af-stack">
            <div className="af-note">
              默认：权重 .35/.30/.15/.20、payload 1500/2000/3000、补查 .85/.90/.60/200、N/M 90/180；来源 params:v1。
            </div>
            <RecallHardCard />
          </div>
        </section>

        <section className="af-panel" data-testid="param-group-sync">
          <div className="af-ph">
            <h3>同步与团队</h3>
            <span className="hint">只读 · 非 params:v1</span>
          </div>
          <div className="af-pb af-stack">
            <div className="af-note">
              本组没有可编辑参数：租户三元组由内核/登录会话下发，中枢游标来自真实 PgSyncHub，只读展示。
            </div>
            <SyncTeamCard />
          </div>
        </section>

        <section className="af-panel" data-testid="param-group-audit">
          <div className="af-ph">
            <h3>审计与安全</h3>
            <span className="hint">审计窗口 · 签名封存</span>
          </div>
          <div className="af-pb af-stack">
            <div className="af-note">
              数据根、L0 原数据库、审计账本路径与备份策略都在这里真实落盘（桌面壳）；签名封存状态读服务端 integrity 真值。
            </div>
            <MirrorSealHint />
            <KbManagementCard />
          </div>
        </section>

        <section className="af-panel" data-testid="param-group-cost">
          <div className="af-ph">
            <h3>成本与配额</h3>
            <span className="hint">单价 · 日额度</span>
          </div>
          <div className="af-pb af-stack">
            <div className="af-note">
              默认：三项均「未设置」。来源 params:v1；金额估算与内核路由共用同一份取值；单价来源见「模型与成本 → 引擎」页。
            </div>
            <NormalConfigCard
              cfg={cfg}
              section="cost"
              onChange={(next, label) => { setCfg(next); track(label); }}
            />
            <RefineQueueCard />
          </div>
        </section>

        {/* 2026-11-22：后台常驻移入网格，与「成本与配额」同列同宽 */}
        <section className="af-panel" data-testid="param-group-shell">
          <div className="af-ph">
            <h3>后台常驻</h3>
            <span className="hint">托盘 · 开机自启</span>
          </div>
          <div className="af-pb">
            <AppShellCard />
          </div>
        </section>

        {/* 2026-11-22：开发者模式从「召回与注入」抽出，独立成卡置于最后 */}
        <section className="af-panel af-span3" data-testid="param-group-dev">
          <div className="af-ph">
            <h3>开发者模式</h3>
            <span className="hint">底层参数 · 仅记录，不折算生效</span>
          </div>
          <div className="af-pb">
            <div className="af-note">底层参数仅写入 params:v1 并记录审计，不影响 A/B/C 实际召回与注入。</div>
            <DevPanel
              dev={dev}
              onChange={(next, label) => { setDev(next); track(label); }}
            />
          </div>
        </section>
      </div>

      {/* ── 保存 ── */}
      <section className="af-panel" data-testid="params-save-bar">
        <div className="af-ph">
          <h3>保存</h3>
          <span className="hint">内核 preference + param_save 审计</span>
        </div>
        <div className="af-pb">
          {errors.length > 0 && (
            <div className="note" data-testid="save-errors">{errors.map((e, i) => <div key={i}>· {e}</div>)}</div>
          )}
          {changed.length > 0 && (
            <div className="note" data-testid="changed-list">
              已修改未保存（{changed.length} 项）：{changed.join('、')}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="af-note">
              保存只影响 params:v1 快照；知识库策略表、同步/团队与签名封存状态是只读真值，不会被本按钮改写。
            </span>
            <button type="button" className="btn primary" data-testid="save-btn" onClick={handleSave}>保存全局参数</button>
          </div>
        </div>
      </section>
      {toast}
    </div>
  );
}
