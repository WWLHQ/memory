/**
 * auto_feedback.mjs 解析逻辑测试
 *
 * 测试对象：Stop 钩子脚本的核心解析函数（从转录提取 recall 结果、[n] 引用、显式排除）
 * 运行方式：node tools/test-auto-feedback.mjs
 *
 * 这些函数从钩子脚本中提炼，此处直接内联复制以做纯逻辑验证，
 * 不依赖 MCP 服务、不依赖文件系统（用内联数据）。
 */

// ── 从 auto_feedback.mjs 提取的纯函数 ─────────────────────────────────────

/** 解析 DeferExecuteTool 的 recall_memory 结果 → { request_id, hits: [{mem_id}] } */
function parseRecallResult(obj) {
  if (obj?.type !== 'function_call_result' || obj?.name !== 'DeferExecuteTool') return null;
  const outText = obj?.output?.text || '';
  if (!outText.includes('"request_id"') || !outText.includes('"hits"')) return null;
  const jsonStart = outText.indexOf('{');
  if (jsonStart < 0) return null;
  let depth = 0, inStr = false, esc = false;
  let jsonEnd = -1;
  for (let i = jsonStart; i < outText.length; i++) {
    const ch = outText[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  if (jsonEnd < 0) return null;
  try {
    const j = JSON.parse(outText.substring(jsonStart, jsonEnd));
    if (!j.request_id || !Array.isArray(j.hits)) return null;
    return { request_id: j.request_id, hits: j.hits.map(h => ({ mem_id: h.mem_id })) };
  } catch { return null; }
}

/** 提取最后一条 assistant 消息文本 */
function extractLastAssistantText(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const texts = obj.content
        .filter(c => c?.type === 'output_text')
        .map(c => c.text || '')
        .join('\n');
      if (texts) return texts;
    }
  }
  return '';
}

/** 检测正文 [n] 引用（跳过末尾卡片区） */
function extractNRefs(text) {
  const lines = text.split('\n');
  let cutoff = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('▶') || trimmed.startsWith('⚙') || trimmed.startsWith('**▶') || trimmed.startsWith('**⚙')) {
      cutoff = i; break;
    }
  }
  const body = lines.slice(0, cutoff).join('\n');
  const refs = new Set();
  const re = /\[(\d{1,2})\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) refs.add(n);
  }
  return [...refs];
}

/** 检测用户已显式表态的条目 */
function collectExplicitMemIds(lines) {
  const explicit = new Set();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type === 'function_call' && obj.name === 'DeferExecuteTool') {
      const argsStr = JSON.stringify(obj.arguments || {});
      if (argsStr.includes('"feedback"') || argsStr.includes('"verdict"')) {
        const memMatch = argsStr.match(/"mem_id"\s*:\s*"(mem_[^"]+)"/);
        if (memMatch) explicit.add(memMatch[1]);
      }
    }
    if (obj.type === 'message' && obj.role === 'user') {
      for (const c of (obj.content || [])) {
        if (c?.type !== 'input_text') continue;
        const text = (c.text || '').trim();
        const m = text.match(/^(?:\d{1,2}\s*(?:有用|没用)\s*↗?[\s.。]*)+$/);
        if (m) {
          const nums = text.match(/\d{1,2}/g) || [];
          for (const n of nums) explicit.add('idx:' + n);
        }
      }
    }
  }
  return explicit;
}

// ── 测试 ─────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

console.log('parseRecallResult');
{
  const obj = {
    type: 'function_call_result', name: 'DeferExecuteTool',
    output: { type: 'text', text: '摘要行\n{"request_id":"req_x","hits":[{"mem_id":"mem_a"},{"mem_id":"mem_b"}]}\n后续指令文本' }
  };
  const r = parseRecallResult(obj);
  assert(r?.request_id === 'req_x', 'request_id 提取');
  assert(r?.hits.length === 2, 'hits 数量');
  assert(r?.hits[0].mem_id === 'mem_a', 'hits[0].mem_id');
}
{
  // 非 DeferExecuteTool → null
  const r = parseRecallResult({ type: 'function_call_result', name: 'Bash', output: { type: 'text', text: '...' } });
  assert(r === null, '非 DeferExecuteTool 返回 null');
}
{
  // 无 request_id → null
  const r = parseRecallResult({
    type: 'function_call_result', name: 'DeferExecuteTool',
    output: { type: 'text', text: '{"hits":[{"mem_id":"mem_x"}]}' }
  });
  assert(r === null, '缺 request_id 返回 null');
}

console.log('extractNRefs');
{
  const text = '根据 [1] 和 [2] 的结论...\n▶ ⚙ 自动 ｜ 卡片摘要行\n更多卡片内容';
  const refs = extractNRefs(text);
  assert(refs.includes(1) && refs.includes(2), '正文 [1][2] 提取');
  assert(!refs.includes(99), '卡片区 [99] 不提取（超范围）');
}
{
  // 纯卡片（无正文引用）
  const text = '▶ ⚙ 自动\n[1] 某记忆';
  const refs = extractNRefs(text);
  assert(refs.length === 0, '卡片区 [n] 不提取');
}
{
  // 无卡片，正文有引用
  const text = '依据 [3] 判断';
  const refs = extractNRefs(text);
  assert(refs.includes(3), '无卡片时正文 [3] 提取');
}

console.log('collectExplicitMemIds');
{
  const lines = [
    JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '2 有用 ↗' }] }),
  ];
  const explicit = collectExplicitMemIds(lines);
  assert(explicit.has('idx:2'), '「2 有用」→ idx:2 标记');
}
{
  const lines = [
    JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '这是普通问题' }] }),
  ];
  const explicit = collectExplicitMemIds(lines);
  assert(explicit.size === 0, '普通消息不标记');
}
{
  // DeferExecuteTool feedback 调用
  const lines = [
    JSON.stringify({
      type: 'function_call', name: 'DeferExecuteTool',
      arguments: { toolName: 'mcp__MultiAgent Memory__feedback', params: { mem_id: 'mem_explicit', verdict: 'confirm' } }
    }),
  ];
  const explicit = collectExplicitMemIds(lines);
  assert(explicit.has('mem_explicit'), 'feedback 工具调用 → mem_id 标记');
}

console.log('综合场景');
{
  const recallLine = JSON.stringify({
    type: 'function_call_result', name: 'DeferExecuteTool',
    output: { type: 'text', text: '摘要\n{"request_id":"req_1","hits":[{"mem_id":"mem_A"},{"mem_id":"mem_B"},{"mem_id":"mem_C"}]}' }
  });
  const userLine = JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '1 有用 ↗' }] });
  const assistantLine = JSON.stringify({
    type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text: '根据 [2] 和 [3] 的证据...\n▶ 卡片摘要' }]
  });
  const lines = [recallLine, userLine, assistantLine];

  const recallData = parseRecallResult(JSON.parse(recallLine));
  assert(recallData?.request_id === 'req_1', '综合：recall 解析');

  const assistantText = extractLastAssistantText(lines);
  const nRefs = extractNRefs(assistantText);
  assert(nRefs.includes(2) && nRefs.includes(3), '综合：正文 [2][3] 提取');

  const explicit = collectExplicitMemIds(lines);
  assert(explicit.has('idx:1'), '综合：用户「1 有用」标记 idx:1');

  // 模拟候选映射
  const candidates = [];
  for (const n of nRefs) {
    const hit = recallData.hits[n - 1];
    if (!hit) continue;
    if (explicit.has(hit.mem_id) || explicit.has('idx:' + n)) continue;
    candidates.push(hit.mem_id);
  }
  assert(candidates.length === 2, '综合：排除 idx:1 后剩 2 条');
  assert(candidates.includes('mem_B') && candidates.includes('mem_C'), '综合：mem_B + mem_C');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
