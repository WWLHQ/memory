// MCP 接入页（2026-11-21 新增；2026-11-22 按真实使用场景重排）
//
// 职责：承载 MCP 客户端接入状态面板（自 Agent 接入页整块迁入，避免两处重复展示）。
// 版式对齐概览页：顶部摘要读数条 + af-panel 三列网格（宽项跨列），按
// 「接入状态 / 服务端监听与端口 / 扫描探测结果 / 客户端清单 / 错误码」分组。
// 数据口径与迁入前完全一致：全部来自主进程 mcp:clients 真扫（onSummary 上报），
// 无宿主桥时如实降级，绝不伪造「已接入」。
import { useState } from 'react';
import { useHostTheme } from '../shared/hostTheme.ts';
import { McpClientsPanel, type McpSummary } from '../AgentOnboard/McpClientsPanel.tsx';
import '../AgentOnboard/theme.css';
import '../shared/afPage.css';

function clock(ts: number | null): string {
  if (!ts) return '尚未扫描';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
function scrollTo(testid: string) {
  document.querySelector(`[data-testid="${testid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function McpPage() {
  useHostTheme();
  const [sum, setSum] = useState<McpSummary | null>(null);
  const s = sum;
  const errCount = s ? s.missingAuth + s.conflict + s.invalid + s.failed : 0;

  return (
    <div className="p0-page af-page" data-testid="mcp-page">
      <div className="af-head" data-testid="mcp-head">
        <h1>MCP 接入</h1>
        <span className="sub">
          MCP 客户端（Claude Desktop / Cursor / Cline 等）接入状态 · 配置写入 · 实测连通 · 数据来自主进程只读扫描
        </span>
        <span className="right">
          <span className="p0-tag info">{s?.available ? '桌面宿主 · 本机配置真扫' : '浏览器模式 · 只读说明'}</span>
          {s?.scanError && <span className="p0-tag warn">扫描失败</span>}
        </span>
      </div>

      {/* ── 摘要读数条（mcp:clients 真实回执上报） ── */}
      <section className="af-panel" data-testid="mcp-summary">
        <div className="af-ph"><h3>接入摘要</h3><span className="hint">主进程回执 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">客户端接入 <span>installed / wired</span></div>
              <div className="v">{s?.installed ?? 0}</div>
              <div className="d mut">已安装中已接入 {s?.wired ?? 0} 个</div>
            </div>
            <div className="af-stat">
              <div className="k">服务端监听 <span>endpoint</span></div>
              <div className="v sm" style={{ wordBreak: 'break-all' }}>{s?.endpoint ?? '读取中'}</div>
              <div className={s?.serverOk === false ? 'd bad' : 'd mut'}>
                {s?.serverOk === null || s?.serverOk === undefined
                  ? '服务端实测未返回（未扫描或浏览器模式）'
                  : s.serverOk ? `服务端 ✓ HTTP ${s.serverStatus}` : `服务端 ✗ HTTP ${s.serverStatus ?? '不可达'}`}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">扫描时间 <span>scannedAt</span></div>
              <div className="v sm">{clock(s?.scannedAt ?? null)}</div>
              <div className="d mut">每 12 秒静默复检（含实测连通失败数）</div>
            </div>
            <div className="af-stat">
              <div className="k">错误码 / 异常 <span>missing · conflict · failed</span></div>
              <div className={`v${errCount > 0 ? ' bad' : ''}`}>{errCount}</div>
              <div className={errCount > 0 ? 'd bad' : 'd'}>
                {errCount > 0 ? `缺令牌 ${s?.missingAuth ?? 0} · 冲突 ${s?.conflict ?? 0} · 解析失败 ${s?.invalid ?? 0} · 实测失败 ${s?.failed ?? 0}` : '当前没有异常客户端'}
              </div>
            </div>
          </div>
          {s?.scanError && <p className="af-note bad" data-testid="mcp-page-scan-error">扫描错误：{s.scanError}（下方不展示客户端状态，避免把未知当成已接入）</p>}
          <p className="af-note">
            数据来源：主进程 mcp:clients 回执（本机配置文件 + 安装痕迹 + tools/list 实测）。未扫描时显示 0 / 尚未扫描，
            不伪造「已接入」；错误码原样展示。
          </p>
        </div>
      </section>

      {/* ── 场景分组：状态 / 端口 / 探测 / 清单 / 错误码 ── */}
      <div className="af-g3" data-testid="mcp-groups">
        <section className="af-panel" data-testid="mcp-group-status">
          <div className="af-ph"><h3>MCP 客户端接入状态</h3><span className="hint">七态真扫</span></div>
          <div className="af-pb">
            <p className="af-q">回答：本机哪些客户端已经接上本服务，哪些还缺令牌或未配置？</p>
            <div className="af-mini">
              <span>已接入 <b>{s?.wired ?? 0}</b></span>
              <span>缺令牌 <b className={s && s.missingAuth > 0 ? 'bad' : ''}>{s?.missingAuth ?? 0}</b></span>
              <span>冲突 <b className={s && s.conflict > 0 ? 'bad' : ''}>{s?.conflict ?? 0}</b></span>
              <span>解析失败 <b className={s && s.invalid > 0 ? 'bad' : ''}>{s?.invalid ?? 0}</b></span>
            </div>
            <p className="af-note">来源：mcp:clients 对每个已安装客户端读取配置并判定七态（未安装不占位）。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="mcp-rescan" onClick={() => document.querySelector<HTMLButtonElement>('[data-act="mcp-refresh"]')?.click()}>刷新状态（真扫）</button>
              <button type="button" className="btn" data-testid="mcp-jump-state" onClick={() => scrollTo('mcp-state-summary')}>看七态总览</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="mcp-group-server">
          <div className="af-ph"><h3>服务端监听与端口</h3><span className="hint">8204 · HTTP MCP</span></div>
          <div className="af-pb">
            <p className="af-q">回答：本机 MCP 服务监听在哪个端点，服务本身通不通？</p>
            <div className="af-mini">
              <span>端点 <b style={{ wordBreak: 'break-all' }}>{s?.endpoint ?? '读取中'}</b></span>
              <span>服务端 <b className={s?.serverOk === false ? 'bad' : ''}>{s?.serverOk === null || s?.serverOk === undefined ? '未实测' : s.serverOk ? '通' : '不通'}</b></span>
              <span>HTTP <b>{s?.serverStatus ?? '未返回'}</b></span>
            </div>
            <p className="af-note">来源：用当前 mcp-token.txt 实测本机端点；8204 被占用或桌面端未运行时如实报不可达。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="mcp-jump-server" onClick={() => scrollTo('mcp-server-live')}>查看实测徽标</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="mcp-group-probe">
          <div className="af-ph"><h3>扫描 / 探测结果</h3><span className="hint">tools/list</span></div>
          <div className="af-pb">
            <p className="af-q">回答：上一轮扫描与 tools/list 探测什么时候跑的，几个客户端调不通？</p>
            <div className="af-mini">
              <span>扫描时间 <b>{clock(s?.scannedAt ?? null)}</b></span>
              <span>实测失败 <b className={s && s.failed > 0 ? 'bad' : ''}>{s?.failed ?? 0}</b></span>
              <span>服务端探测 <b>{s?.serverOk === null || s?.serverOk === undefined ? '未返回' : s.serverOk ? '成功' : '失败'}</b></span>
            </div>
            <p className="af-note">来源：mcp:clients live 汇总（checked / failed / server）；只认 HTTP 状态码，不认「配置里看着像」。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="mcp-probe-now" onClick={() => document.querySelector<HTMLButtonElement>('[data-act="mcp-refresh"]')?.click()}>立即重新扫描 + 探测</button>
              <button type="button" className="btn" data-testid="mcp-jump-live" onClick={() => scrollTo('mcp-live-alert')}>看异常详情</button>
            </div>
          </div>
        </section>

      </div>

      {/* ── 清单与错误码同列同宽（2026-11-22） ── */}
      <div className="af-g3 mcp-pair" data-testid="mcp-groups-pair">
        <section className="af-panel" data-testid="mcp-group-clients">
          <div className="af-ph"><h3>客户端清单与状态</h3><span className="hint">mcp-table</span></div>
          <div className="af-pb">
            <p className="af-q">回答：每个客户端具体是什么状态、令牌怎么维护、下一步该点哪个按钮？</p>
            <div className="af-mini">
              <span>已安装 <b>{s?.installed ?? 0}</b></span>
              <span>可写/需片段等逐行动作见下表</span>
            </div>
            <p className="af-note">来源：逐客户端真实配置路径、传输形态（stdio / HTTP）、实测徽标与修复指引均在下方面板原样保留。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="mcp-jump-table" onClick={() => scrollTo('mcp-table')}>跳到客户端清单</button>
              <button type="button" className="btn" data-testid="mcp-jump-empty" onClick={() => scrollTo('mcp-empty')}>为什么没列出客户端</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="mcp-group-errors">
          <div className="af-ph"><h3>错误码如实展示</h3><span className="hint">401 / 冲突 / 解析失败</span></div>
          <div className="af-pb">
            <p className="af-q">回答：失败到底是令牌过期、同名条目冲突，还是配置文件坏了？</p>
            <div className="af-mini">
              <span>缺令牌 <b className={s && s.missingAuth > 0 ? 'bad' : ''}>{s?.missingAuth ?? 0}</b></span>
              <span>冲突 <b className={s && s.conflict > 0 ? 'bad' : ''}>{s?.conflict ?? 0}</b></span>
              <span>解析失败 <b className={s && s.invalid > 0 ? 'bad' : ''}>{s?.invalid ?? 0}</b></span>
              <span>扫描错误 <b className={s?.scanError ? 'bad' : ''}>{s?.scanError || '无'}</b></span>
            </div>
            <p className="af-note">来源：主进程回执原样展示；401 = 配置里的令牌与当前 mcp-token.txt 不一致，不是服务端故障。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="mcp-jump-actions" onClick={() => scrollTo('mcp-actions-help')}>看动作说明</button>
            </div>
          </div>
        </section>
      </div>

      <McpClientsPanel onSummary={setSum} />
    </div>
  );
}

export default McpPage;
