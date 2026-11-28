#!/usr/bin/env node
// tools/eval-auto-mode-weights.mjs — 只读离线 A/B：growth:v1 固定权重 vs auto 建议模式专属权重
// 复用审计 mems_detail 的同一批 relevance/分量重排，唯一变量=权重；不写库/不改配置/不调 LLM/不为凑数调参。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/Work Folder/Agnet/Deepseek Harness/2026-10-06-16-15-17';
const APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
const dr = JSON.parse(readFileSync(join(APPDATA, 'MultiAgent Memory', 'data-root.json'), 'utf8'));
const ledgerDir = dr.ledgerDir;

let resolveMode, RECALL_MODE_SPECS;
try {
  const m = await import(pathToFileURL(join(ROOT, 'src/core/memagent/recallModes.ts')).href);
  resolveMode = m.resolveMode; RECALL_MODE_SPECS = m.RECALL_MODE_SPECS;
} catch (e) { console.error('IMPORT_RECALL_MODES_FAILED', e?.message ?? String(e)); process.exit(2); }

const gcSrc = readFileSync(join(ROOT, 'src/shared/growthConfig.ts'), 'utf8');
const gm = gcSrc.match(/DEFAULT_RECALL_WEIGHTS[^}]*}/);
const gn = gm ? (gm[0].match(/[0-9]+\.[0-9]+/g) ?? []).map(Number) : [];
const gw = gn.length >= 4 ? { w_f: gn[0], w_i: gn[1], w_c: gn[2], w_a: gn[3] } : { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 };

const normW = (w) => { const s = w.f + w.i + w.c + w.a; return { w_f: w.f/s, w_i: w.i/s, w_c: w.c/s, w_a: w.a/s }; };
const modeW = Object.fromEntries(Object.entries(RECALL_MODE_SPECS).map(([k,v]) => [k, normW(v.weights)]));
const growthW = { w_f: gw.w_f, w_i: gw.w_i, w_c: gw.w_c, w_a: gw.w_a };

function auditFiles() {
  const out = [join(ledgerDir, 'audit.jsonl')];
  const arc = join(ledgerDir, 'audit-archive');
  if (existsSync(arc)) for (const f of readdirSync(arc).sort()) if (f.endsWith('.jsonl')) out.push(join(arc, f));
  return out.filter(existsSync);
}
const files = auditFiles();
const disp = new Map(), recalls = [];
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  if (r.action === 'mode_dispatch' && r.detail) { disp.set(r.request_id, r.detail); continue; }
  if (r.action !== 'recall') continue;
  const d = r.detail ?? {};
  if (Array.isArray(d.mems_detail) && d.mems_detail.length) recalls.push({ ts: r.ts, rid: r.request_id, d });
}

const skip = { manual: 0, no_dispatch: 0, no_query: 0, bad_row: 0 };
const samples = [];
for (const r of recalls) {
  const dsp = disp.get(r.rid);
  if (!dsp) { skip.no_dispatch++; continue; }
  if ((dsp.source ?? '') === 'manual' || dsp.weights_source === 'manual') { skip.manual++; continue; }
  if ((dsp.source ?? '') !== 'auto') { skip.no_dispatch++; continue; }
  const q = r.d.query;
  if (typeof q !== 'string' || !q) { skip.no_query++; continue; }
  let res; try { res = resolveMode({ query: q, scene: r.d.scene, explicitMode: 'auto' }); } catch { skip.no_query++; continue; }
  const rows = [];
  for (const row of r.d.mems_detail) {
    if (!Array.isArray(row) || row.length < 6) { skip.bad_row++; continue; }
    const vals = row.slice(1).map(Number);
    if (vals.some(v => !isFinite(v))) { skip.bad_row++; continue; }
    rows.push({ relevance: vals[0], f: vals[1], imp: vals[2], conf: vals[3], boost: vals[4] });
  }
  if (!rows.length) { skip.bad_row++; continue; }
  samples.push({ ts: r.ts, scene: r.d.scene ?? 'default', suggested: res.mode, rows });
}

const rerank = (rows, w) => rows.map(x => ({ ...x, score: Math.round(x.relevance * (w.w_f*x.f + w.w_i*x.imp + w.w_c*x.conf + w.w_a*x.boost) * 1000) / 1000 })).sort((a,b) => b.score - a.score || b.relevance - a.relevance);
const evaluate = (rows, w) => { const t = rerank(rows, w)[0]; return { top1_relevance: t.relevance, top1_score: t.score, thin: t.score < 0.3 }; };
const agg = (list) => { if (!list.length) return null; const n = list.length; return { n, top1_relevance: +(list.reduce((s,x)=>s+x.top1_relevance,0)/n).toFixed(4), avg_top1_score: +(list.reduce((s,x)=>s+x.top1_score,0)/n).toFixed(4), thin_rate: +(list.filter(x=>x.thin).length/n).toFixed(4) }; };
const group = (list, keyFn) => { const m = new Map(); for (const x of list) { const k = keyFn(x); m.set(k, [...(m.get(k)??[]), x]); } return Object.fromEntries([...m].map(([k,v])=>[k, agg(v)])); };

const base = samples.map(s => ({ ...evaluate(s.rows, growthW), scene: s.scene, suggested: s.suggested }));
const exp  = samples.map(s => ({ ...evaluate(s.rows, modeW[s.suggested]), scene: s.scene, suggested: s.suggested }));
const sorted = [...samples].sort((a,b)=>a.ts-b.ts), half = Math.floor(sorted.length/2);
const pairEval = (sl) => ({ growth_v1: agg(sl.map(s=>evaluate(s.rows, growthW))), auto_mode: agg(sl.map(s=>evaluate(s.rows, modeW[s.suggested]))) });

const out = {
  meta: { generatedAtBj: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), ledgerDir, files, growthW, modeW, note: '口径A=top1 relevance(已融合token coverage,λ=0.6); 口径B=top1 score<0.3为证据不足; pattern_reasoning权重和0.90已归一到1; pinned+0.15因mems_detail无该字段未计(两方案对称)' },
  counts: { recalls_with_detail: recalls.length, mode_dispatch_rows: disp.size, usable_samples: samples.length, skip },
  overall: { growth_v1: agg(base), auto_mode: agg(exp) },
  by_suggested: { growth_v1: group(base, x=>x.suggested), auto_mode: group(exp, x=>x.suggested) },
  by_scene: { growth_v1: group(base, x=>x.scene), auto_mode: group(exp, x=>x.scene) },
  time_split: { boundary_ts: sorted[half]?.ts, first_half: pairEval(sorted.slice(0,half)), second_half: pairEval(sorted.slice(half)) },
};
console.log(JSON.stringify(out, null, 2));
