// 网页端接入页（2026-11-19 新增；2026-11-22 按真实使用场景重排）
//
// 版式对齐概览页：顶部摘要读数条 + af-panel 三列网格（宽项跨列）。
// 分组：导入入口 / 导入结果与去重 / 来源与最近导入时间 / 导出卡；
// 读数全部来自 WebchatAutoCard 上报的主进程真值（onSummary），取不到就写未采样/不可用并给原因。
// 原有自动采集与导出卡的全部控件（站点、周期、每轮条数、登录窗、立即采一轮、补齐历史、导出目录、
// 插件安装、体检、清理）一个未删，深链 tab 参数不涉及本页。
import { useState } from 'react';
import { useHostTheme } from '../shared/hostTheme.ts';
import { WebchatAutoCard, type WebchatAutoSummary } from './WebchatAutoCard.tsx';
import { AUTO_STATUS_LABEL } from './webchatAuto.ts';
import { WebChatExportCard } from '../AgentOnboard/WebChatExportCard.tsx';
import '../shared/afPage.css';

/** 时间显示：无值写人话，不用破折号冒充读数 */
function fmt(ts: number | null): string {
  if (!ts) return '还没有采过';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 页面级动作 = 真点下方卡片里的真实按钮（不复制业务逻辑，回执由卡片原样显示） */
function clickIn(testid: string) {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)?.click();
}
function scrollTo(testid: string) {
  document.querySelector(`[data-testid="${testid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function WebOnboardPage() {
  useHostTheme();
  const [sum, setSum] = useState<WebchatAutoSummary | null>(null);
  const s = sum;

  return (
    <div className="p0-page af-page" data-testid="webonboard-page">
      <div className="af-head" data-testid="webonboard-head">
        <h1>网页端接入</h1>
        <span className="sub">
          网页会话自动采集 · 站点登录 / 定时巡检 / 立即采一轮 / 补齐历史 / 导出目录 · 读数来自主进程回执
        </span>
        <span className="right">
          <span className="p0-tag info">{s?.available ? '桌面宿主 · 自动采集可用' : '非桌面宿主 · 自动采集不可用'}</span>
          {s?.running && <span className="p0-tag warn">正在采集</span>}
        </span>
      </div>

      {/* ── 摘要读数条（WebchatAutoCard 主进程真值上报） ── */}
      <section className="af-panel" data-testid="webonboard-summary">
        <div className="af-ph"><h3>接入摘要</h3><span className="hint">主进程回执 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">定时采集 <span>config.enabled</span></div>
              <div className="v sm">
                {!s ? '读取中' : !s.available ? '不可用' : s.enabled ? '已启用' : '已停用'}
              </div>
              <div className={s?.available ? 'd mut' : 'd bad'}>
                {!s ? '读取主进程状态中' : !s.available ? '浏览器模式没有隐藏浏览器与落盘通道' : `每 ${s.intervalMinutes ?? '未读取'} 分钟 · 每轮 ${s.perRound ?? '未读取'} 条`}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">采集站点 <span>config.sites</span></div>
              <div className="v">{s?.sites ?? 0}</div>
              <div className="d mut">启用站点按下方「采集站点」按钮增减</div>
            </div>
            <div className="af-stat">
              <div className="k">上次采集 <span>lastRound.at</span></div>
              <div className="v sm">{fmt(s?.lastAt ?? null)}</div>
              <div className="d mut">{s ? `本轮新增 ${s.exported} 条 · 去重跳过 ${s.skipped} 条` : '尚未读取主进程状态'}</div>
            </div>
            <div className="af-stat">
              <div className="k">需处理 <span>missing / relogin</span></div>
              <div className={`v${s && (s.needRelogin > 0 || s.failed > 0) ? ' bad' : ''}`}>
                {s ? s.needRelogin + s.failed : 0}
              </div>
              <div className={s && (s.needRelogin > 0 || s.failed > 0) ? 'd bad' : 'd mut'}>
                {s && (s.needRelogin > 0 || s.failed > 0)
                  ? `需重新登录 ${s.needRelogin} · 失败 ${s.failed}${s?.failures.length ? `（${s.failures.map((f) => f.label).join('、')}）` : ''}`
                  : '没有登录失效或失败站点'}
              </div>
              {!!s?.failures.length && (
                <div className="af-actions">
                  <button type="button" className="btn" data-testid="webonboard-failure-help"
                    onClick={() => scrollTo('wa-failure-guide')}>看失败原因与处理办法</button>
                </div>
              )}
            </div>
          </div>
          {s?.error && <p className="af-note bad" data-testid="webonboard-err">主进程错误：{s.error}</p>}
          {s?.dirError && <p className="af-note bad" data-testid="webonboard-dir-err">导出目录：{s.dirError}</p>}
          <p className="af-note">
            数据来源：主进程 webchatAutoState / webchatExportDir 回执（WebchatAutoCard 上报）。缺失字段写「未采样 / 不可用」并给原因，
            不伪造「已就绪」。
          </p>
        </div>
      </section>

      {/* ── 场景分组：导入入口 / 结果去重 / 来源时间 / 导出卡 ── */}
      <div className="af-g3" data-testid="webonboard-groups">
        <section className="af-panel" data-testid="webonboard-group-entry">
          <div className="af-ph"><h3>网页版对话导入入口</h3><span className="hint">定时巡检 · 立即采一轮</span></div>
          <div className="af-pb">
            <p className="af-q">自动采集开没开、多久跑一次、一轮抓几条？</p>
            <div className="af-mini">
              <span>启用 <b>{s ? (s.enabled ? '是' : '否') : '读取中'}</b></span>
              <span>周期 <b>{s?.intervalMinutes ?? '未读取'} 分钟</b></span>
              <span>每轮 <b>{s?.perRound ?? '未读取'} 条</b></span>
            </div>
            <p className="af-note">来源：AutoConfigView 主进程真值；改动即写配置。</p>
            <div className="af-actions">
              <button type="button" className="btn primary" data-testid="webonboard-run" disabled={!s?.available || s?.running} onClick={() => clickIn('wa-run-btn')}>立即采一轮</button>
              <button type="button" className="btn" data-testid="webonboard-enable" disabled={!s?.available}
                onClick={() => document.querySelector<HTMLButtonElement>(`[data-testid="wa-enable-pick"] [data-value="${s?.enabled ? 'off' : 'on'}"]`)?.click()}>
                {s?.enabled ? '停用' : '启用'}定时采集
              </button>
              <button type="button" className="btn" data-testid="webonboard-jump-entry" onClick={() => scrollTo('wa-enable')}>展开全部控件</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="webonboard-group-result">
          <div className="af-ph"><h3>导入结果与去重</h3><span className="hint">wa-results</span></div>
          <div className="af-pb">
            <p className="af-q">这一轮发现、采到、去重跳过、漏掉各多少？</p>
            <div className="af-mini">
              <span>新增 <b>{s?.exported ?? 0}</b></span>
              <span>去重跳过 <b>{s?.skipped ?? 0}</b></span>
              <span className={s && s.missing > 0 ? 'bad' : ''}>缺失 <b className={s && s.missing > 0 ? 'bad' : ''}>{s?.missing ?? 0}</b></span>
              <span className={s && s.failed > 0 ? 'bad' : ''}>失败 <b className={s && s.failed > 0 ? 'bad' : ''}>{s?.failed ?? 0}</b></span>
            </div>
            {!!s?.failures.length && (
              <div className="af-note bad" data-testid="webonboard-failure-detail">
                {s.failures.map((f) => `${f.label}（${AUTO_STATUS_LABEL[f.status]}）：${f.reason} → ${f.advice}`).join('；')}
              </div>
            )}
            <p className="af-note">来源：lastRound.results；去重 = 导出目录已有同名会话跳过。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="webonboard-sweep" disabled={!s?.available || s?.running} onClick={() => clickIn('wa-sweep-btn')}>补齐历史会话</button>
              <button type="button" className="btn" data-testid="webonboard-jump-results" onClick={() => scrollTo('wa-results')}>看本轮明细</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="webonboard-group-source">
          <div className="af-ph"><h3>来源与最近导入时间</h3><span className="hint">lastRound.at · exportDir</span></div>
          <div className="af-pb">
            <p className="af-q">文件落在哪、上次导入何时、哪些站点需登录？</p>
            <div className="af-mini">
              <span>最近导入 <b>{fmt(s?.lastAt ?? null)}</b></span>
              <span>需登录 <b className={s && s.needRelogin > 0 ? 'bad' : ''}>{s?.needRelogin ?? 0}</b></span>
            </div>
            <p className="af-note" style={{ wordBreak: 'break-all' }}>导出目录：{s?.dir ?? (s?.dirError ?? '读取中…')}</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="webonboard-open-dir" disabled={!s?.available || !s?.dir} onClick={() => clickIn('wa-export-dir-open')}>打开导出目录</button>
              <button type="button" className="btn" data-testid="webonboard-jump-login" onClick={() => scrollTo('wa-login-win')}>打开登录窗</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="webonboard-group-export">
          <div className="af-ph"><h3>自带插件导出卡</h3><span className="hint">已迁入本页 · 未删减</span></div>
          <div className="af-pb">
            <p className="af-q">不想用自动采集时的插件导出 / 安装验收 / 体检 / 清理入口。</p>
            <div className="af-mini">
              <span>位置 <b>下方完整卡片</b></span>
              <span>能力 <b>插件安装 · 导出 · 体检 · 清理</b></span>
            </div>
            <p className="af-note">来源：WebChatExportCard 主进程回执；本页只做导航。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="webonboard-jump-export" onClick={() => scrollTo('webchat-export-card')}>跳到导出卡</button>
            </div>
          </div>
        </section>

        <div className="af-span2" data-testid="webonboard-group-auto">
          <WebchatAutoCard onSummary={setSum} />
        </div>
      </div>

      {/* 迁入卡沿用 af-* 版式：外层补 .aob-page 以提供其设计令牌，高度自适应不撑满 */}
      <div className="aob-page" style={{ height: 'auto', minHeight: 0, background: 'transparent' }}>
        <WebChatExportCard />
      </div>
    </div>
  );
}
