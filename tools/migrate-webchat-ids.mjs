// 一次性迁移：把 <导出目录>/<站点>/<时间戳>.md 改成 <会话ID>.md。
//
// 为什么要迁移：新采集架构用「导出目录里有没有 <ID>.md」当账本（文件系统即账本）。
// 旧文件是时间戳命名，同一会话被导出多次会产生 -1/-2 副本（实测 135 md / 101 唯一 ID），
// 不迁移就会出现「新账本认为没采过 → 重复导出」。
//
// 安全口径：
//   · 默认 dry-run，只读、不写任何导出文件；必须显式 --apply 才动盘。
//   · 同名 ID 的多份只保留「导出时间」最新的一份，其余移到 _dedup_backup/<site>/，不删除。
//   · 每一步 old → new 都写进报告 JSON，可按报告反向还原。
//   · 无「- 来源：」URL 的文件保持原名，绝不猜 ID。
//
// 用法：
//   node tools/migrate-webchat-ids.mjs [导出目录]
//   node tools/migrate-webchat-ids.mjs [导出目录] --apply
//   node tools/migrate-webchat-ids.mjs [导出目录] --report <json路径>
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const reportIdx = args.indexOf('--report');
const REPORT = reportIdx >= 0 && args[reportIdx + 1]
  ? args[reportIdx + 1]
  : 'specs/reports/WEBCHAT-ID-MIGRATION-PREVIEW.json';
const positional = args.filter((a, i) => !a.startsWith('--') && !(reportIdx >= 0 && i === reportIdx + 1));
const ROOT = positional[0] || 'C:/Users/LHQ/Downloads/chat-exports';

const SITES = ['deepseek', 'doubao', 'yiyan', 'qianwen', 'kimi', 'mimo', 'chatglm'];
const ID_PATTERNS = [
  /\/a\/chat\/s\/([0-9a-fA-F-]{8,})/,
  /\/chat\/([0-9]{8,})/,
  /\/search\/([0-9]{8,})/,
  /[?&]chat(?:id)?=([0-9a-zA-Z_-]{8,})/,
];
const STAMP_RE = /^\d{8}-\d{6}(?:-\d+)?\.md$/i;
const UUID_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i;
const SOURCE_RE = /^-\s*来源：\s*(\S+)/m;
const EXPORTED_RE = /^-\s*导出时间：\s*(.+)$/m;
const TITLE_RE = /^-\s*标题：\s*(.+)$/m;

function idFromUrl(url) {
  for (const re of ID_PATTERNS) {
    const m = re.exec(String(url || ''));
    if (m?.[1]) return m[1];
  }
  return null;
}

function safeId(raw) {
  return String(raw || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

const actions = [];
const skipped = [];
const errors = [];

if (!existsSync(ROOT)) {
  console.error(`导出目录不存在：${ROOT}`);
  process.exit(2);
}

for (const site of SITES) {
  const siteDir = join(ROOT, site);
  if (!existsSync(siteDir)) continue;
  const groups = new Map();
  for (const ent of readdirSync(siteDir, { withFileTypes: true })) {
    if (!ent.isFile() || !/\.md$/i.test(ent.name)) continue;
    const name = ent.name;
    // 时间戳文件要迁移；UUID 文件已在册，也要纳入分组才能和旧副本比新旧；其余保持原样
    if (!STAMP_RE.test(name) && !UUID_FILE_RE.test(name)) {
      skipped.push({ site, name, reason: '不是时间戳也不是 UUID 命名，保持原样' });
      continue;
    }
    let text;
    try { text = readFileSync(join(siteDir, name), 'utf8'); } catch (e) {
      errors.push({ site, name, reason: `读取失败：${String(e?.message ?? e)}` });
      continue;
    }
    const source = SOURCE_RE.exec(text)?.[1] ?? '';
    const id = source ? idFromUrl(source) : null;
    if (!id) {
      skipped.push({ site, name, reason: '没有可解析的「来源」会话 ID，保持原样' });
      continue;
    }
    const safe = safeId(id);
    const at = Date.parse(EXPORTED_RE.exec(text)?.[1] ?? '') || 0;
    const title = (TITLE_RE.exec(text)?.[1] ?? '').trim();
    const arr = groups.get(safe) ?? [];
    arr.push({ name, safe, at, title });
    groups.set(safe, arr);
  }

  for (const [id, list] of groups) {
    // 最新一份为主；时间相同按文件名字典序，保证结果可复现
    list.sort((a, b) => (b.at - a.at) || a.name.localeCompare(b.name));
    const keep = list[0];
    const targetName = `${id}.md`;
    for (const item of list.slice(1)) {
      actions.push({
        site, kind: 'backup', id, title: item.title,
        from: join(site, item.name), to: join(site, '_dedup_backup', item.name),
      });
    }
    if (keep.name !== targetName) {
      actions.push({
        site, kind: 'rename', id, title: keep.title,
        from: join(site, keep.name), to: join(site, targetName),
      });
    }
  }
}

const bySite = new Map();
for (const a of actions) bySite.set(a.site, (bySite.get(a.site) ?? 0) + 1);

console.log(`导出根目录：${ROOT}`);
console.log(`模式：${APPLY ? 'APPLY（会改盘）' : 'DRY-RUN（只读）'}`);
console.log(`动作总数：${actions.length}（重命名 ${actions.filter((a) => a.kind === 'rename').length} / 备份 ${actions.filter((a) => a.kind === 'backup').length}）`);
for (const [site, n] of bySite) console.log(`  ${site}: ${n}`);
console.log('--- 清单（old → new）---');
for (const a of actions) console.log(`[${a.kind}] ${a.site}/${basename(a.from)} → ${a.to}${a.title ? `  # ${a.title}` : ''}`);
if (skipped.length) {
  console.log(`--- 保持原样 ${skipped.length} 份（前 10 条）---`);
  for (const s of skipped.slice(0, 10)) console.log(`[skip] ${s.site}/${s.name}：${s.reason}`);
}
if (errors.length) {
  console.log(`--- 读取失败 ${errors.length} 份 ---`);
  for (const e of errors) console.log(`[error] ${e.site}/${e.name}：${e.reason}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  apply: APPLY,
  summary: {
    actions: actions.length,
    renames: actions.filter((a) => a.kind === 'rename').length,
    backups: actions.filter((a) => a.kind === 'backup').length,
    skipped: skipped.length,
    errors: errors.length,
  },
  actions,
  skipped,
  errors,
};
mkdirSync(REPORT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`报告：${REPORT}`);

if (APPLY) {
  for (const a of actions) {
    const from = join(ROOT, a.from);
    let to = join(ROOT, a.to);
    mkdirSync(join(to, '..'), { recursive: true });
    if (!existsSync(from)) {
      console.error(`源文件已不存在，跳过：${from}`);
      continue;
    }
    // 绝不覆盖已有文件：撞名就加 -bakN，保证反向还原时每条都有唯一落点
    if (existsSync(to)) {
      const stem = to.replace(/\.md$/i, '');
      let n = 1;
      while (existsSync(`${stem}-bak${n}.md`)) n += 1;
      to = `${stem}-bak${n}.md`;
      console.error(`目标已存在，改用 ${to}`);
    }
    renameSync(from, to);
  }
  console.log('迁移完成；如需回滚，按报告里的 from/to 反向 rename。');
}
