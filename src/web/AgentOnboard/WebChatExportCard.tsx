// 网页版对话接入引导卡（chat-exports）：
// ① 一键增加本项目自带的浏览器插件（Edge / QQ 浏览器）② 在支持站点导出 ③ 导出和同步目录
// ④ 首次安装采集验收（采一轮，确认真的进了库）。
// 文案全是人话（UI 铁律）：不渲染 JSON / payload；采集回执只给计数与原因句。
// 诚实边界：目录读不到 / 插件没装 / 未登录 / 导出未完成 / 换机后旧路径失效，都如实显示，不伪造「已就绪」。
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { hostCall, HOST_ACCEPTED_ERROR_PREFIX } from '../../desktop/hostBridge.ts';
import { WEBCHAT_SITES, webchatSiteLabel } from '../../shared/webchatSites.ts';
import { currentSessionId } from '../shared/session.ts';
import { requestShellView } from '../shared/shellNavigate.ts';

interface TriggerReceipt {
  ok: boolean;
  advanced?: boolean;
  collected: number;
  deduped: number;
  roleSkipped: number;
  skipped: string[];
  error?: string;
}

interface SiteStat {
  site: string;
  count: number;
}

/** 审计回执：人话报告 + 计数（不给 JSON 原文） */
interface AuditReceipt {
  ok: boolean;
  report?: string;
  diffCount?: number;
  summary?: {
    sessions: number;
    sessionsWithSnapshot: number;
    sourceMessages: number;
    exportedMessages: number;
    matched: number;
    missing: number;
    extra: number;
    truncated: number;
    rewritten: number;
    roleMismatch: number;
    accuracy: number | null;
  };
  error?: string;
}

type BrowserKind = 'edge' | 'qq';

/** 清理预览（只读计数）：给二次确认卡看清「要删多少、都在哪个站点、有没有原文密文」 */
interface PurgePreview {
  total: number;
  by_site: Record<string, number>;
  by_layer: Record<string, number>;
  with_l0_cipher: number;
  tombstones: number;
  sample_ids: string[];
}

/** 清理回执（人话计数 + 备份位置，不渲染 JSON） */
interface PurgeReceipt {
  ok: boolean;
  report?: { total: number; purged: number; failed: number; vector_failed: number };
  backup_dir?: string;
  error?: string;
}

/** 区块小标题：编号 + 一句话，替代原来「步骤列表 + 按钮组」两段重复描述 */
function SectionTitle(props: { n: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 6, fontWeight: 600 }}>
      <span className="dim" style={{ marginRight: 6 }}>{props.n}</span>
      {props.children}
    </div>
  );
}

/** 记账时间戳 → 本机时分秒（今天几点的导出一眼可见，不显示日期噪音） */
const fmtTime = (at: number): string => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export function WebChatExportCard() {
  const [dir, setDir] = useState<string | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  /** 采集目录在本机是否真的存在：false = 换机/被删后的旧配置（要引导重新对齐） */
  const [dirExists, setDirExists] = useState(true);
  /** 插件实际写入位置（主进程从浏览器 Preferences 探测出来的）；探不到为 null */
  const [pluginDir, setPluginDir] = useState<string | null>(null);
  /** 应用采集目录是否就是插件落点：null = 未知（没探到插件位置） */
  const [aligned, setAligned] = useState<boolean | null>(null);
  /** 已导出的来源统计（按站点目录里的 .md 计数；只回计数不回正文） */
  const [sites, setSites] = useState<SiteStat[]>([]);
  /**
   * 来源统计是否真的读到过。
   * 只有读到过、且确实是 0 个文件，才敢说「导出目录里还没有文件」——
   * 读失败时保持 false，绝不把「读不到」当成「没有」。
   */
  const [sitesReady, setSitesReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extPath, setExtPath] = useState<string | null>(null);
  const [extErr, setExtErr] = useState<string | null>(null);
  const [extCopied, setExtCopied] = useState(false);
  const [opening, setOpening] = useState<BrowserKind | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [receipt, setReceipt] = useState<TriggerReceipt | null>(null);
  const [triggerErr, setTriggerErr] = useState<string | null>(null);
  /** 接收端记账的「最近一次网页导出」（0.3.0）：null = 应用运行以来还没收到过 */
  const [statusLast, setStatusLast] = useState<{ at: number; site: string; file: string; bytes: number } | null>(null);
  const [statusTodayCount, setStatusTodayCount] = useState(0);
  /** 导出完整性审计回执（2026-11-17）：null = 还没点过核对 */
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const [auditing, setAuditing] = useState(false);
  /** 清理旧格式网页导出条目（2026-11-17）：preview 只读，run 需口令 PURGE + 管理员 */
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [purgeBusy, setPurgeBusy] = useState<'preview' | 'run' | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purgeReceipt, setPurgeReceipt] = useState<PurgeReceipt | null>(null);
  const [purgeErr, setPurgeErr] = useState<string | null>(null);

  /** 读导出目录 + 插件落点（改路径/跟随之后要重读，才能刷新「是否一致」） */
  const loadDirs = useCallback(async () => {
    const res = await hostCall<{
      ok: boolean; dir?: string; pluginDir?: string | null; aligned?: boolean | null; error?: string;
    }>('chatExports:get', []);
    if (res?.dir) {
      setDir(res.dir);
      setDirExists(res.ok === true);
      // 有路径就不算「读取失败」：目录不存在属于「换机/被删」这一种独立情况，由下方缺失提示用人话说
      setDirErr(null);
    } else {
      setDir(null);
      setDirErr(res?.error ?? '读取目录失败');
    }
    if (res && 'pluginDir' in res) setPluginDir(res.pluginDir ?? null);
    if (res && 'aligned' in res) setAligned(res.aligned ?? null);
  }, []);

  /** 读导出来源统计；读不到就是空数组（不编造来源） */
  const loadSites = useCallback(async () => {
    try {
      const res = await hostCall<{ ok: boolean; sites?: SiteStat[] }>('chatExports:sites', []);
      setSites(Array.isArray(res?.sites) ? res.sites : []);
      if (res?.ok) setSitesReady(true);
    } catch {
      setSites([]);
    }
  }, []);

  /** 读「最近一次网页导出」记账；读不到 = 还没收到过（不是错误） */
  const loadExportStatus = useCallback(async () => {
    try {
      const res = await hostCall<{ ok: boolean; todayCount?: number; last?: { at: number; site: string; file: string; bytes: number } | null }>('webchatExport:status', []);
      if (!res?.ok) return;
      setStatusLast(res.last ?? null);
      setStatusTodayCount(typeof res.todayCount === 'number' ? res.todayCount : 0);
    } catch {
      /* 状态读不到就保持空态，不打扰主流程 */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDirs().catch(() => {}), loadSites(), loadExportStatus()]);
  }, [loadDirs, loadSites, loadExportStatus]);

  useEffect(() => {
    let alive = true;
    void refreshAll();
    void hostCall<{ ok: boolean; path?: string; error?: string }>('webchatExt:get', [])
      .then((res) => {
        if (!alive) return;
        if (res?.ok && res.path) setExtPath(res.path);
        else setExtErr(res?.error ?? '读取插件目录失败');
      })
      .catch((e) => {
        if (alive) setExtErr(String((e as Error)?.message ?? e));
      });
    return () => { alive = false; };
  }, [refreshAll]);

  // 采集/导出进行中关闭页面：明确提示还有未完成任务，避免用户以为已经入库。
  useEffect(() => {
    if (!triggering) return;
    const warn = (event: BeforeUnloadEvent): string => {
      event.preventDefault();
      event.returnValue = '有未完成的采集任务：现在关闭可能漏掉本轮入库，确定离开吗？';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [triggering]);

  const openDir = useCallback(async () => {
    const res = await hostCall<{ ok: boolean; error?: string }>('chatExports:open', []);
    if (!res?.ok) setDirErr(res?.error ?? '打开目录失败');
    else setDirErr(null);
  }, []);

  const copyDir = useCallback(async () => {
    if (!dir) return;
    try {
      await navigator.clipboard.writeText(dir);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setDirErr('复制失败：请手动选中路径复制');
    }
  }, [dir]);

  /** 更改导出目录：弹系统目录选择框；成功后即时生效（采集源每轮现取主进程变量），取消不动现状 */
  const changeDir = useCallback(async () => {
    const res = await hostCall<{ ok: boolean; dir?: string; canceled?: boolean; error?: string }>('chatExports:set', []);
    if (!res) return;
    if (res.ok && res.dir) {
      setDir(res.dir);
      setDirExists(true);
      setDirErr(null);
      // 改完重读一次，刷新「是否等于插件落点」与来源统计——不一致要立刻让用户看见，而不是等采集出 0 条才发现
      await refreshAll();
    } else if (!res.canceled) {
      setDirErr(res.error ?? '更改目录失败');
    }
  }, [refreshAll]);

  /** 跟随插件落点：把采集目录直接设成插件真正写入的位置，用户不用自己找路径（换机后最常用） */
  const followPluginDir = useCallback(async () => {
    const res = await hostCall<{ ok: boolean; dir?: string; error?: string }>('chatExports:follow', []);
    if (!res?.ok) {
      setDirErr(res?.error ?? '跟随插件位置失败');
      return;
    }
    if (res.dir) {
      setDir(res.dir);
      setDirExists(true);
    }
    setDirErr(null);
    await refreshAll();
  }, [refreshAll]);

  const openExtensionFolder = useCallback(async () => {
    const res = await hostCall<{ ok: boolean; path?: string; error?: string }>('webchatExt:openFolder', []);
    if (!res?.ok) setExtErr(res?.error ?? '打开插件目录失败');
    else setExtErr(null);
  }, []);

  const openBrowserExtensions = useCallback(async (browser: BrowserKind) => {
    setOpening(browser);
    setExtErr(null);
    try {
      const res = await hostCall<{ ok: boolean; error?: string }>('webchatExt:openBrowser', [browser]);
      if (!res?.ok) setExtErr(res?.error ?? '打开浏览器扩展页失败');
    } catch (e) {
      setExtErr(String((e as Error)?.message ?? e));
    } finally {
      setOpening(null);
    }
  }, []);

  const copyExtPath = useCallback(async () => {
    if (!extPath) return;
    try {
      await navigator.clipboard.writeText(extPath);
      setExtCopied(true);
      setTimeout(() => setExtCopied(false), 2000);
    } catch {
      setExtErr('复制失败：请手动选中插件路径复制');
    }
  }, [extPath]);

  /** 跑一次「导出文档 vs 原对话」逐条比对：回答「导全了没有、有没有遗漏、正确率多少」 */
  const runAudit = useCallback(async () => {
    setAuditing(true);
    try {
      const res = await hostCall<AuditReceipt>('webchatAudit:run', []);
      setAudit(res ?? { ok: false, error: '审计没有返回结果' });
    } catch (e) {
      setAudit({ ok: false, error: String((e as Error)?.message ?? e) });
    } finally {
      setAuditing(false);
    }
  }, []);

  /**
   * 查看待清理的旧格式网页导出条目（只读）。
   * 为什么需要这一步：重导会让同一段对话按「新内容」再入一次库（幂等键含正文），
   * 旧格式条目丢掉列表/代码围栏，留着只会让同一段对话在召回里出现两次、且旧的那份缺结构。
   * 先给数量与来源分布，用户看清了再决定删。
   */
  const loadPurgePreview = useCallback(async () => {
    setPurgeBusy('preview');
    setPurgeErr(null);
    setPurgeReceipt(null);
    try {
      const res = await hostCall<{ ok: boolean; preview?: PurgePreview; error?: string }>(
        'webchatPurge:preview', [null, currentSessionId()],
      );
      if (!res?.ok || !res.preview) setPurgeErr(res?.error ?? '读取待清理条目失败');
      else setPurgePreview(res.preview);
    } catch (e) {
      setPurgeErr(String((e as Error)?.message ?? e));
    } finally {
      setPurgeBusy(null);
    }
  }, []);

  /** 执行清理：不可逆，必须逐字输入 PURGE；主进程会在删除前自动备份 */
  const runPurge = useCallback(async () => {
    if (purgeConfirm.trim().toUpperCase() !== 'PURGE') {
      setPurgeErr('请先输入确认口令 PURGE，再执行清理');
      return;
    }
    setPurgeBusy('run');
    setPurgeErr(null);
    try {
      const res = await hostCall<PurgeReceipt>('webchatPurge:run', [purgeConfirm, null, currentSessionId()]);
      if (!res?.ok) setPurgeErr(res?.error ?? '清理失败');
      else {
        setPurgeReceipt(res);
        setPurgePreview(null);
        setPurgeConfirm('');
      }
    } catch (e) {
      setPurgeErr(String((e as Error)?.message ?? e));
    } finally {
      setPurgeBusy(null);
    }
  }, [purgeConfirm]);

  const triggerNow = useCallback(async () => {
    setTriggering(true);
    setReceipt(null);
    setTriggerErr(null);
    try {
      // T1（数据使用门禁）：触发采集需登录会话，hostCall 展开参数须传 [agentNames, sessionId]
      const res = await hostCall<TriggerReceipt>('collector:triggerNow', [[], currentSessionId()]);
      if (!res?.ok) setTriggerErr(res?.error ?? '触发失败');
      else {
        setReceipt(res);
        void loadSites(); // 采完刷新来源计数：让「这轮真的从哪家导进来了」看得见
        void loadExportStatus();
      }
    } catch (e) {
      setTriggerErr(String((e as Error)?.message ?? e));
    } finally {
      setTriggering(false);
    }
  }, [loadSites, loadExportStatus]);

  const totalFiles = sites.reduce((n, s) => n + s.count, 0);
  /** 目录记着路径但这台机上没有 → 典型是从别的电脑带过来的配置 */
  const dirMissing = Boolean(dir) && !dirExists;

  return (
    <section className="af-panel" data-testid="webchat-export-card">
      <div className="af-ph">
        <h3>自带插件导出（网页版对话接入）</h3>
        <span className="hint">插件自动导 → 采集器每 5 分钟入库 · 重复内容自动去重</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 12 }}>
      <p className="dim" style={{ margin: '0 0 14px 0' }}>
        内置插件安装好后它会自动读取当前网页已显示的对话（含你的提问与 AI 回答），
        直接写进下面的「导出和同步目录」；记忆采集器每 5 分钟自动扫描入库，重复内容自动去重。
        本机服务没启动时插件会兜底存到浏览器下载目录，那种情况需要先把文件挪进上面目录。
      </p>

      {/* ① 装插件：只需一次 */}
      <div data-testid="webchat-ext-card" style={{ marginBottom: 16 }}>
        <SectionTitle n="①">一键增加插件</SectionTitle>
        <div className="dim" data-testid="webchat-step-1" style={{ marginBottom: 8 }}>
          打开扩展页 → 开启「开发者模式」→ 点「加载已解压的扩展程序」→ 选中下方插件目录。
          浏览器不允许静默安装，最后这一次确认需要你手动点一下。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="af-btn pri"
            data-testid="webchat-ext-open-edge"
            disabled={opening !== null}
            onClick={() => void openBrowserExtensions('edge')}
          >
            {opening === 'edge' ? '正在打开 Edge…' : '一键打开 Edge 扩展页'}
          </button>
          <button
            type="button"
            className="af-btn"
            data-testid="webchat-ext-open-qq"
            disabled={opening !== null}
            onClick={() => void openBrowserExtensions('qq')}
          >
            {opening === 'qq' ? '正在打开 QQ 浏览器…' : '一键打开 QQ 浏览器扩展页'}
          </button>
          <button type="button" className="af-btn" data-testid="webchat-ext-open-folder" onClick={() => void openExtensionFolder()}>
            一键打开插件目录
          </button>
          <button type="button" className="af-btn" data-testid="webchat-ext-copy-path" onClick={() => void copyExtPath()}>
            {extCopied ? '已复制' : '复制插件路径'}
          </button>
        </div>
        <div data-testid="webchat-ext-path-row" style={{ marginTop: 8, wordBreak: 'break-all' }}>
          <span className="dim">插件目录：</span>
          {extPath ? <code data-testid="webchat-ext-path">{extPath}</code> : <span data-testid="webchat-ext-err">{extErr ?? '读取中…'}</span>}
        </div>
        {extErr && extPath && (
          <div className="dim" data-testid="webchat-ext-action-err" style={{ marginTop: 4 }}>{extErr}</div>
        )}
        <div className="dim" data-testid="webchat-ext-fallback-hint" style={{ marginTop: 6 }}>
          浏览器不允许外部程序直接打开扩展页，自动跳转可能被拦。点完按钮地址会自动进剪贴板：
          若浏览器停在空白页，按 Ctrl+L，再按 Ctrl+V，回车即可。
        </div>
      </div>

      {/* ② 在支持站点导出 + 已导出的来源统计 */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle n="②">在任一支持的网站导出对话</SectionTitle>
        <div data-testid="webchat-step-2" style={{ marginBottom: 8 }}>
          <span className="dim">来源：</span>
          {WEBCHAT_SITES.map((s, i) => (
            <span key={s.key} data-testid={`webchat-site-${s.key}`}>
              {i > 0 && <span className="dim"> · </span>}
              {s.label}
            </span>
          ))}
        </div>
        <div data-testid="webchat-site-stats">
          {totalFiles > 0 ? (
            <span>
              <span className="dim">已导出：</span>
              {sites.map((s, i) => (
                <span key={s.site} data-testid={`webchat-site-count-${s.site}`}>
                  {i > 0 && <span className="dim"> · </span>}
                  {webchatSiteLabel(s.site)} <strong>{s.count}</strong> 个
                </span>
              ))}
              <span className="dim">（共 {totalFiles} 个文件，采集器都会扫）</span>
            </span>
          ) : (
            <span className="dim" data-testid="webchat-site-none">
              还没有导出文件：在支持站点点插件图标 →「导出当前对话」，文件会直接写进下面「导出和同步目录」的站点子目录里。
            </span>
          )}
        </div>
        <div data-testid="webchat-export-status" style={{ marginTop: 8 }}>
          {statusLast ? (
            <span data-testid="webchat-export-status-ok">
              <span className="dim">最近一次网页导出：</span>
              {webchatSiteLabel(statusLast.site)} · {fmtTime(statusLast.at)} · 今日 <strong>{statusTodayCount}</strong> 份
              <span className="dim">（插件每 5 分钟自动增量导一轮；对话没新增会被跳过，属正常）</span>
            </span>
          ) : (
            <span className="dim" data-testid="webchat-export-status-none">
              应用运行以来还没收到过网页导出：插件每 5 分钟自动导一次「已打开的受支持网页」，
              对话没新增会跳过；等下一轮或点插件弹窗「导出当前对话」强推一次即可。
            </span>
          )}
        </div>
        {/* 导出完整性核对：把「导出文档」和「页面原对话」逐条比一遍，回答导全了没有 */}
        <div data-testid="webchat-audit" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="af-btn"
            data-testid="webchat-audit-run"
            disabled={auditing}
            onClick={() => void runAudit()}
          >
            {auditing ? '核对中…' : '核对导出完整性'}
          </button>
          <span className="dim" style={{ marginLeft: 8 }}>
            逐条比对「导出文档」与「页面原对话」，看有没有遗漏、截断或错认角色
          </span>
          {audit && !audit.ok && (
            <div className="dim" data-testid="webchat-audit-err" style={{ marginTop: 4 }}>
              核对失败：{audit.error ?? '未知原因'}
            </div>
          )}
          {audit?.ok && audit.summary && (
            <div data-testid="webchat-audit-summary" style={{ marginTop: 6 }}>
              <div>
                <span className="dim">已核对：</span>
                {audit.summary.sessions} 个会话，其中 <strong>{audit.summary.sessionsWithSnapshot}</strong> 个带原对话快照可比对
                {audit.summary.sourceMessages > 0 && (
                  <>
                    {' '}· 原对话 <strong>{audit.summary.sourceMessages}</strong> 条 / 导出 <strong>{audit.summary.exportedMessages}</strong> 条
                  </>
                )}
              </div>
              {audit.summary.accuracy !== null && audit.summary.accuracy !== undefined && (
                <div data-testid="webchat-audit-accuracy" style={{ marginTop: 2 }}>
                  <span className="dim">逐字完全一致率：</span>
                  <strong>{(audit.summary.accuracy * 100).toFixed(1)}%</strong>
                  <span className="dim">
                    （{audit.summary.matched} / {audit.summary.sourceMessages} 条角色与正文都对得上）
                  </span>
                </div>
              )}
              {(audit.summary.missing > 0 || audit.summary.extra > 0 || audit.summary.truncated > 0
                || audit.summary.rewritten > 0 || audit.summary.roleMismatch > 0) && (
                <div className="dim" data-testid="webchat-audit-diffs" style={{ marginTop: 2 }}>
                  遗漏 {audit.summary.missing} 条 · 多余 {audit.summary.extra} 条 · 截断 {audit.summary.truncated} 条
                  {' '}· 改写 {audit.summary.rewritten} 条 · 角色判错 {audit.summary.roleMismatch} 条
                </div>
              )}
              {audit.summary.sessionsWithSnapshot === 0 && (
                <div className="dim" data-testid="webchat-audit-none" style={{ marginTop: 2 }}>
                  还没有可比对的原对话快照：这份功能上线之前导出的文件拿不到原对话，无法逐条核对。
                  用新版插件重新导一轮，之后就能逐条核对了。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ③ 导出和同步目录：插件写这里、采集器也扫这里 */}
      <div data-testid="webchat-export-dir" style={{ marginBottom: 16 }}>
        <SectionTitle n="③">导出和同步目录</SectionTitle>
        <div style={{ wordBreak: 'break-all' }}>
          {dir ? (
            <>
              <code data-testid="webchat-export-dir-path">{dir}</code>{' '}
              <button type="button" className="af-btn" data-testid="webchat-copy-dir" onClick={() => void copyDir()}>
                {copied ? '已复制' : '复制路径'}
              </button>{' '}
              <button type="button" className="af-btn" data-testid="webchat-open-dir" onClick={() => void openDir()}>
                打开目录
              </button>{' '}
              <button type="button" className="af-btn" data-testid="webchat-change-dir" onClick={() => void changeDir()}>
                更改路径
              </button>
            </>
          ) : (
            <span data-testid="webchat-export-dir-err">{dirErr ?? '读取中…'}</span>
          )}
        </div>
        {dirErr && dir && (
          <div className="dim" data-testid="webchat-dir-err" style={{ marginTop: 4 }}>{dirErr}</div>
        )}
        {/* 换机/被删：配置里记着的路径在这台机上不存在 → 采集恒 0 条，必须当场说清并给一键对齐 */}
        {dirMissing && (
          <div data-testid="webchat-dir-missing" style={{ marginTop: 6 }}>
            <div className="dim">
              这台电脑上没有这个目录（多半是从别的电脑带过来的配置，或目录被移动/删除了）。
              {pluginDir ? '点下面的按钮直接对齐到本机插件实际写入的位置。' : '点「更改路径」重新选一个目录。'}
            </div>
            {pluginDir && (
              <button type="button" className="af-btn pri" data-testid="webchat-dir-follow-missing" onClick={() => void followPluginDir()}>
                跟随插件位置
              </button>
            )}
          </div>
        )}
        {/* 插件落点 vs 采集目录：不一致时采集恒 0 条，必须当场说清并给一键对齐 */}
        {!dirMissing && pluginDir && aligned === false && (
          <div data-testid="webchat-dir-mismatch" style={{ marginTop: 6 }}>
            <div style={{ wordBreak: 'break-all' }}>
              <span className="dim">插件实际写到这里：</span>
              <code data-testid="webchat-plugin-dir">{pluginDir}</code>
            </div>
            <div className="dim" style={{ marginTop: 4 }}>
              和应用采集的位置不一致，现在点「立即采集」会是 0 条。
            </div>
            <button type="button" className="af-btn pri" data-testid="webchat-dir-follow" onClick={() => void followPluginDir()}>
              跟随插件位置
            </button>
          </div>
        )}
        {!dirMissing && pluginDir && aligned === true && (
          <div className="dim" data-testid="webchat-dir-aligned" style={{ marginTop: 6 }}>
            插件写这里、采集器也扫这里，两边已对齐，不用再设置。
          </div>
        )}
      </div>

      {/* ④ 首次安装采集验收 */}
      <div>
        <SectionTitle n="④">首次安装采集验收</SectionTitle>
        <div className="dim" data-testid="webchat-step-3" style={{ marginBottom: 8 }}>
          装好后先点一次「立即采集」，确认能采到条目（采到几条会写在下面）；之后每 5 分钟自动扫描，不用再点。
          要按来源核对就点「去记忆层级页验收」。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="af-btn pri"
            data-testid="webchat-trigger-now"
            disabled={triggering}
            onClick={() => void triggerNow()}
          >
            {triggering ? '采集中…' : '立即采集'}
          </button>
          <button type="button" className="af-btn" data-testid="webchat-verify-link" onClick={() => requestShellView('layered')}>
            去记忆层级页验收
          </button>
        </div>
      </div>

      {receipt && (
        <div data-testid="webchat-receipt" style={{ marginTop: 10 }}>
          {receipt.advanced === false
            ? <span className="dim">本轮采集未推进（可能连续失败已停自动重试），可稍后重试。</span>
            : (
              <span>
                采到 <strong data-testid="webchat-receipt-collected">{receipt.collected}</strong> 条 ·
                幂等跳过 {receipt.deduped} 条 · 角色跳过 {receipt.roleSkipped} 条
                {receipt.collected === 0 && receipt.deduped === 0 && (
                  <span className="dim">（目录里没有新内容：确认插件已导出文件到上方目录）</span>
                )}
              </span>
            )}
          {receipt.skipped.length > 0 && (
            <div className="dim" style={{ marginTop: 4 }}>
              跳过原因（前 3 条）：{receipt.skipped.slice(0, 3).join('；')}
            </div>
          )}
          {/*
            采到 0 条最容易被误读成「采集坏了」，而真实原因往往是导出目录里一个文件都没有
            （插件一次都没导出成功）。这里是验收卡，必须把「跳过计数来自本地 agent 日志、
            与网页导出的文件无关」说清，否则用户会以为 3000 多条都来自网页对话。
          */}
          {sitesReady && totalFiles === 0 && (
            <div className="dim" data-testid="webchat-no-exports" style={{ marginTop: 4 }}>
              导出目录里还没有任何文件：先在第②步的网站点插件图标「导出当前对话」，
              等上面目录里出现站点文件夹后再回来点采集。上面的「幂等跳过」是本地 agent 日志的去重计数，
              和网页导出的文件是两回事。
            </div>
          )}
        </div>
      )}
      {triggerErr && (
        <div data-testid="webchat-trigger-err" style={{ marginTop: 10 }}>
          {triggerErr.startsWith(HOST_ACCEPTED_ERROR_PREFIX)
            ? '采集已开始，但结果没取回：'
            : '采集未执行：'}
          {triggerErr}
        </div>
      )}

      {/* ⑤ 清理旧格式的网页导出条目：0.5.3 重导后必做一次，否则同一段对话会留着缺结构的那一份 */}
      <div data-testid="webchat-purge" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(127,127,127,0.25)' }}>
        <SectionTitle n="⑤">清理旧格式的网页导出条目</SectionTitle>
        <div className="dim" style={{ marginBottom: 8 }}>
          插件从 0.5.3 起导出的正文带上了列表、代码块、表格的结构。同一段对话重导后会按「新内容」重新入库，
          而早期入库的那批没有这些结构：留着会让同一段对话在记忆里出现两份，旧的那份召回时还缺结构。
          这里按来源只清「网页导出的旧条目」，其它来源的记忆、采集进度、导出文件都不动。
          <br />
          清理不可逆：执行前会自动备份，删除后原文只能从备份恢复。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="af-btn"
            data-testid="webchat-purge-preview-btn"
            disabled={purgeBusy !== null}
            onClick={() => void loadPurgePreview()}
          >
            {purgeBusy === 'preview' ? '统计中…' : '查看待清理条目'}
          </button>
          <input
            type="text"
            className="af-input"
            data-testid="webchat-purge-confirm"
            placeholder="输入 PURGE 确认"
            aria-label="清理确认口令"
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
            style={{ width: 160 }}
          />
          <button
            type="button"
            className="af-btn danger"
            data-testid="webchat-purge-run"
            disabled={purgeBusy !== null || purgeConfirm.trim().toUpperCase() !== 'PURGE'}
            onClick={() => void runPurge()}
          >
            {purgeBusy === 'run' ? '清理中…' : '清理这些旧条目'}
          </button>
        </div>

        {purgeErr && (
          <div className="dim" data-testid="webchat-purge-err" style={{ marginTop: 6 }}>{purgeErr}</div>
        )}

        {purgePreview && (
          <div data-testid="webchat-purge-preview" style={{ marginTop: 8 }}>
            {purgePreview.total > 0 ? (
              <>
                <div>
                  <span className="dim">待清理：</span>
                  共 <strong>{purgePreview.total}</strong> 条 ·
                  {Object.entries(purgePreview.by_site).map(([site, n], i) => (
                    <span key={site} data-testid={`webchat-purge-site-${site}`}>
                      {i > 0 && <span className="dim"> · </span>}
                      {site === '<未知>' ? '来源未标注' : webchatSiteLabel(site)} <strong>{n}</strong> 条
                    </span>
                  ))}
                </div>
                {purgePreview.with_l0_cipher > 0 && (
                  <div className="dim" data-testid="webchat-purge-l0" style={{ marginTop: 2 }}>
                    其中 {purgePreview.with_l0_cipher} 条带原始对话密文：删除后原文只能从备份恢复。
                  </div>
                )}
                {purgePreview.tombstones > 0 && (
                  <div className="dim" data-testid="webchat-purge-tombstones" style={{ marginTop: 2 }}>
                    另外还有 {purgePreview.tombstones} 条早就标记为已删除（界面上看不到），不在本次清理范围。
                  </div>
                )}
                <div className="dim" style={{ marginTop: 2 }}>
                  核对无误后在上面的输入框里输入 PURGE，再点「清理这些旧条目」。
                </div>
              </>
            ) : (
              <span className="dim" data-testid="webchat-purge-none">
                没有需要清理的旧格式网页导出条目：库里现有的网页导出记录都已是新格式。
              </span>
            )}
          </div>
        )}

        {purgeReceipt?.ok && purgeReceipt.report && (
          <div data-testid="webchat-purge-receipt" style={{ marginTop: 8 }}>
            <div>
              <span className="dim">清理完成：</span>
              删除 <strong data-testid="webchat-purge-purged">{purgeReceipt.report.purged}</strong> 条
              {purgeReceipt.report.failed > 0 && <> · 失败 {purgeReceipt.report.failed} 条（稍后可再试一次）</>}
              {purgeReceipt.report.vector_failed > 0 && <> · {purgeReceipt.report.vector_failed} 条索引未同步摘除（不影响正文，重启后重建索引即可）</>}
            </div>
            {purgeReceipt.backup_dir && (
              <div className="dim" style={{ marginTop: 2, wordBreak: 'break-all' }}>
                清理前的备份：<code data-testid="webchat-purge-backup">{purgeReceipt.backup_dir}</code>
              </div>
            )}
            <div className="dim" style={{ marginTop: 2 }}>
              想让新格式的对话重新进库：回到第②步点插件「导出当前对话」重导，再点第④步「立即采集」。
            </div>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
