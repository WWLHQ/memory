#!/usr/bin/env node
// 代码索引生成器（批次7 可维护性）：扫描源码导出符号 + 正式文档标题 → 一页可 grep 的 Markdown 地图。
// 目的：人和 LLM 先用索引定位文件，再读局部代码，减少整仓扫描与 token 消耗。
//
// 覆盖范围：
//   - 源码：src/、e2e/（.ts/.tsx/.mjs/.cjs，跳过测试文件与构建产物）；
//   - 文档：specs/**/*.md 与根 README.md（自动排除本索引自身）。
// 规则（本轮起）：
//   - 新程序 / 新文档完成后 → --write 增加条目；
//   - 旧程序 / 旧文档修改后 → --write 更新对应条目（hash 变化即视为过期）；
//   - --check 报出未收录文档 → 修本脚本覆盖面，不得绕过。
//
// 用法：
//   node tools/code-index.mjs            # 打印到 stdout
//   node tools/code-index.mjs --write    # 写入 specs/code-index.generated.md
//   node tools/code-index.mjs --check    # 只检查索引是否最新（过期退出码 1）
//   node tools/code-index.mjs --json     # 机器可读 JSON（供脚本/Agent 使用）
//
// 只读源码与文档，不修改任何业务文件；索引过期时重跑即可（无需手工维护）。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'e2e'];
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', 'coverage', '__tests__', 'archive']);
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** 文档覆盖：specs 下全部 .md + 根 README.md；排除自动生成的索引自身 */
const DOC_DIRS = ['specs'];
const DOC_EXTS = new Set(['.md']);
const DOC_SKIP = new Set(['code-index.generated.md']);

const EXPORT_RULES = [
  [/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, 'fn'],
  [/^export\s+const\s+([A-Za-z_$][\w$]*)/gm, 'const'],
  [/^export\s+let\s+([A-Za-z_$][\w$]*)/gm, 'let'],
  [/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, 'class'],
  [/^export\s+interface\s+([A-Za-z_$][\w$]*)/gm, 'type'],
  [/^export\s+type\s+([A-Za-z_$][\w$]*)/gm, 'type'],
  [/^export\s+enum\s+([A-Za-z_$][\w$]*)/gm, 'enum'],
];

/** 顶层注释摘要：取文件前 15 行里的首条有信息量的注释 */
function summaryOf(text) {
  const head = text.split('\n', 15);
  for (const raw of head) {
    const line = raw.trim();
    if (!line.startsWith('//')) continue;
    const body = line.replace(/^\/\/\s*/, '').trim();
    if (!body || /^[=\-─═*#\s]+$/.test(body)) continue;
    return body.length > 110 ? `${body.slice(0, 110)}…` : body;
  }
  return '';
}

function exportsOf(text) {
  const names = [];
  for (const [re, kind] of EXPORT_RULES) {
    for (const m of text.matchAll(re)) names.push(`${m[1]}(${kind})`);
  }
  return [...new Set(names)];
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...(await walk(full)));
      continue;
    }
    if (!EXTS.has(e.name.slice(e.name.lastIndexOf('.')))) continue;
    if (SKIP_FILE.test(e.name)) continue;
    out.push(full);
  }
  return out;
}

/** 文档首行标题（# 开头）；没有标题取首个非空正文行 */
function docSummaryOf(text) {
  const head = text.split('\n', 40);
  for (const raw of head) {
    const line = raw.trim();
    if (line.startsWith('# ')) return line.slice(2).trim().slice(0, 110);
    if (line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('---')) {
      return line.slice(0, 110);
    }
  }
  return '';
}

async function walkDocs(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkDocs(full)));
      continue;
    }
    if (!DOC_EXTS.has(e.name.slice(e.name.lastIndexOf('.')))) continue;
    if (DOC_SKIP.has(e.name)) continue;
    out.push(full);
  }
  return out;
}

const files = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) files.push(...(await walk(abs)));
}
files.sort();

const entries = [];
for (const abs of files) {
  let text = '';
  try { text = await readFile(abs, 'utf8'); } catch { continue; }
  entries.push({
    file: relative(ROOT, abs).split(sep).join('/'),
    summary: summaryOf(text),
    exports: exportsOf(text),
    lines: text.split('\n').length,
    // 批次27 P2-18：内容指纹——符号名/行数不变的单行函数体改动也会让 --check 失败（强制重跑索引）
    hash: createHash('sha256').update(text).digest('hex').slice(0, 12),
  });
}

const docFiles = [];
for (const dir of DOC_DIRS) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) docFiles.push(...(await walkDocs(abs)));
}
const readme = join(ROOT, 'README.md');
if (existsSync(readme)) docFiles.push(readme);
docFiles.sort();

const docEntries = [];
for (const abs of docFiles) {
  let text = '';
  try { text = await readFile(abs, 'utf8'); } catch { continue; }
  docEntries.push({
    file: relative(ROOT, abs).split(sep).join('/'),
    summary: docSummaryOf(text),
    lines: text.split('\n').length,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 12),
  });
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ sources: entries, docs: docEntries }, null, 2) + '\n');
  process.exit(0);
}

const groups = new Map();
for (const e of entries) {
  const parts = e.file.split('/');
  const top = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  if (!groups.has(top)) groups.set(top, []);
  groups.get(top).push(e);
}

const lines = [
  '# 代码索引（自动生成）',
  '',
  '> 由 `npm run code:index` 生成，请勿手改；改代码/文档后重跑即可。',
  '> 用法：先在本表定位文件与导出符号，再只读该文件的局部区间（省 token、少误改）。',
  '',
  `共 ${entries.length} 个源码文件、${docEntries.length} 个文档。`,
  '',
];
for (const [top, list] of groups) {
  lines.push(`## ${top}`, '', '| 文件 | 行数 | 摘要 | 导出 |', '|---|---|---|---|');
  for (const e of list) {
    const ex = e.exports.length ? e.exports.join(', ') : '—';
    lines.push(`| [${e.file}](${e.file}) | ${e.lines} | ${e.summary.replace(/\|/g, '\\|') || '—'} | ${ex.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
}
if (docEntries.length > 0) {
  lines.push('## 文档', '', '| 文件 | 行数 | 摘要 |', '|---|---|---|');
  for (const e of docEntries) {
    lines.push(`| [${e.file}](${e.file}) | ${e.lines} | ${e.summary.replace(/\|/g, '\\|') || '—'} |`);
  }
  lines.push('');
}

const md = lines.join('\n')
  + `\n## 指纹（P2-18）\n\n任一源码/文档文件内容变化都会让 --check 失败（单行改动也不例外）。\n\n`
  + [...entries, ...docEntries].map((e) => `${e.file} ${e.hash}`).join('\n') + '\n';
const out = join(ROOT, 'specs', 'code-index.generated.md');
if (process.argv.includes('--write')) {
  await writeFile(out, md, 'utf8');
  console.log(`已写入 ${relative(ROOT, out)}（${entries.length} 个源码文件、${docEntries.length} 个文档）`);
} else if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(out, 'utf8');
  } catch {
    // 索引文件缺失按过期处理
  }
  if (current !== md) {
    console.error(`代码索引已过期：请运行 npm run code:index -- --write（${relative(ROOT, out)}）`);
    process.exit(1);
  }
  console.log(`代码索引已是最新（${entries.length} 个源码文件、${docEntries.length} 个文档）`);
} else {
  process.stdout.write(md);
}
