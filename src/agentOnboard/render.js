// Agent 接入页 UI 渲染（REQ-003 T3~T8 / T10 / 接原型 HTML）
// 纯函数：proto 形状的数据 -> HTML 字符串，便于单测（无需浏览器/jsdom）。
// ⚠ 严格对齐 design/ui/Agent接入页_原型.html：结构/样式 class/文案/交互点(data-tool/data-iso/data-chan/data-act/data-rid/data-inject/data-err/data-mask) 均与原型一致，禁止偏离。
//
// 原型参考：design/ui/Agent接入页_原型.html（AGENTS/DISCOVERED/GAINS + renderCards/bindCard/act/discover）

/**
 * 单家宿主 Agent 接入卡片（对齐原型 renderCards，19.2/19.3/5.2）。
 * a 字段（proto 形状）：name, badge, label, method, conn, circuit, latency,
 *   tenant, tools{recall{on,topk,scene,mode},write{on,category},pref{on}},
 *   iso{projShare,prefCross}, chan{webhook,api,recon}, key{mask,last,grace}, state(connected|degraded|onboard)
 */
export function renderCard(a) {
  const connClass = a.conn < 95 ? 'warn' : '';
  const deg = a.state === 'degraded';
  const stTxt = a.state === 'connected' ? '已连通' : (a.state === 'degraded' ? '降级（仅补偿）' : '未配置');
  const stDot = a.state === 'connected' ? 'connected' : a.state === 'degraded' ? 'degraded' : 'onboard';
  const circuitColor = a.circuit === 'OPEN' ? 'var(--err)' : a.circuit === 'HALF_OPEN' ? 'var(--warn)' : 'var(--ok)';
  return `
<div class="card${deg ? ' degraded' : ''}" data-agent="${a.name}">
  <div class="top">
    <span class="badge ${a.badge}">${a.label}</span>
    <span class="agent-name">${a.name}</span>
    <span class="method">${a.method}</span>
    <span style="margin-left:auto"><span class="statusdot st-${stDot}"></span>${stTxt}</span>
  </div>
  <div class="metrics">
    <div class="metric"><div class="k">连通成功率（&lt;95% ⚠）</div><div class="v ${connClass}">${a.conn}%</div></div>
    <div class="metric"><div class="k">熔断状态（5.2）</div><div class="v" style="color:${circuitColor}">${a.circuit}</div></div>
    <div class="metric"><div class="k">平均延迟（&gt;5s ⚠）</div><div class="v ${a.latency > 5 ? 'warn' : ''}">${a.latency}s</div></div>
    <div class="metric"><div class="k">租户（只读·全局）</div><div class="v" style="font-size:12px">${a.tenant}</div></div>
  </div>
  <div class="row">
    <span style="font-size:11px;color:var(--muted)">MCP 工具（19.5，须带 project_id）：</span>
    <label class="sw"><input type="checkbox" data-tool="recall" ${a.tools.recall.on ? 'checked' : ''}>recall_memory top_k=${a.tools.recall.topk} scene=${a.tools.recall.scene}</label>
    <label class="sw"><input type="checkbox" data-tool="write" ${a.tools.write.on ? 'checked' : ''}>write_memory</label>
    <label class="sw"><input type="checkbox" data-tool="pref" ${a.tools.pref.on ? 'checked' : ''}>get_user_preferences</label>
  </div>
  <div class="row">
    <span style="font-size:11px;color:var(--muted)">隔离粒度（19.4）：</span>
    <label class="sw"><input type="checkbox" data-iso="projShare" ${a.iso.projShare ? 'checked' : ''}>项目层按 project_id 跨 Agent 共享</label>
    <label class="sw"><input type="checkbox" data-iso="prefCross" ${a.iso.prefCross ? 'checked' : ''}>个人偏好跨项目共享（user_id 级）</label>
  </div>
  <div class="row">
    <span style="font-size:11px;color:var(--muted)">采集通道（19.3）：</span>
    <label class="sw"><input type="checkbox" data-chan="webhook" ${a.chan.webhook ? 'checked' : ''}>主 Webhook</label>
    <label class="sw"><input type="checkbox" data-chan="api" ${a.chan.api ? 'checked' : ''}>补偿 API 拉取</label>
    <span class="pill">对账 ${a.chan.recon}</span>
    <span class="pill on">SHA-256 幂等（不可关）</span>
  </div>
  <div class="row">
    <span style="font-size:11px;color:var(--muted)">密钥（4.1 脱敏）：</span>
    <span class="pill on" data-mask>${a.key.mask}</span>
    <span class="pill">轮换宽限 ${a.key.grace}h · 上次 ${a.key.last}</span>
    ${a.key.last.includes('92') ? '<span class="pill gold">⚠ 超 90 天未轮换</span>' : ''}
  </div>
  <div class="warn ${deg ? 'show' : ''}">${deg ? '⚠ 主通道 Webhook 熔断 OPEN，已降级为仅补偿通道（5min 延迟，数据完整性不受影响 · 5.4）' : ' '}</div>
  <div class="errbox" data-err></div>
  <div class="test" data-test>
    接入测试：<span class="rid" data-rid>req_test_${a.name}</span>
    <div class="inject" data-inject>注入预览：将注入 <b>5</b> 条记忆到 Agent prompt（payload ≈ 780 tokens）</div>
  </div>
  <div class="btns">
    <button class="btn primary" data-act="test" ${a.circuit === 'OPEN' ? 'disabled title="熔断 OPEN 已停止主通道"' : ''}>▶ 测试接入</button>
    <button class="btn" data-act="rotate">轮换密钥</button>
    <button class="btn" data-act="save">保存配置</button>
  </div>
</div>`;
}

/**
 * 一键接入·发现结果列表（对齐原型 renderFound / DISCOVERED）。
 * list 项：{name, badge, label, signal, bound, ok}
 */
export function renderFound(list = []) {
  return list.map((d, i) => {
    const st = d.bound
      ? (d.ok ? '<span class="pill on">自动发现 · 已绑定 ✓</span>' : '<span class="pill gold">自动发现 · 已绑定 ⚠ 待手动补</span>')
      : '<span class="pill">未发现信号 · 需手填端点</span>';
    return `
<div class="found${d.bound ? '' : ' unbound'}" data-disc="${i}">
  <span class="badge ${d.badge}">${d.label}</span>
  <span class="agent-name" style="font-size:13px">${d.name}</span>
  <span class="method">信号：${d.signal}</span>
  <span style="margin-left:auto">${st}</span>
  ${d.bound ? `<button class="btn" data-unbind="${i}" style="padding:4px 10px">撤销</button>` : ''}
</div>`;
  }).join('\n');
}

/**
 * 效果证据（对齐原型 renderGains / GAINS）。
 * g 项：{icon, title, big, desc, src}
 */
export function renderGains(g = []) {
  return g.map((x) => `
<div class="gain">
  <h3>${x.icon} ${x.title}</h3>
  <div class="big">${x.big}</div>
  <div class="desc">${x.desc}</div>
  <div class="src">依据：${x.src}</div>
</div>`).join('\n');
}
