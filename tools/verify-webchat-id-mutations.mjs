// ID 对账架构的四项变异验证：把关键判据改回旧逻辑，相关测试必须转红。
// 每次变异都在 finally 里还原源文件；任何一项「变异后仍全绿」= 门禁失效，退出码 1。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  {
    name: '① 去重改回内容哈希（正文改一行应重新采 → T1 必须红）',
    file: 'src/electron/webchatIdReconcile.ts',
    from: 'return id ? `${id}.md` : fallbackFileName(chat);',
    to: 'return `${String((chat as Record<string, unknown>).sig ?? id)}.md`;',
    test: 'src/electron/__tests__/webchatIdReconcile.test.ts',
  },
  {
    name: '② 加回 startAt 封顶（位置游标死锁回归 → 顶部扫描测试必须红）',
    file: 'src/electron/webchatAutoConfig.ts',
    from: 'const startAt = 0;',
    to: 'const startAt = Math.max(0, Math.min(4, items.length));',
    test: 'src/electron/__tests__/webchatAutoConfig.test.ts',
  },
  {
    name: '③ 文件名改回时间戳（幂等落盘失效 → T1/T3 必须红）',
    file: 'src/electron/webchatIdReconcile.ts',
    from: 'if (id) return `${id}.md`;',
    to: 'if (id) return `${at}.md`;',
    test: 'src/electron/__tests__/webchatIdReconcile.test.ts',
  },
  {
    name: '④ 恢复写内容指纹账（双状态复活 → 无状态不变量测试必须红）',
    file: 'src/electron/webchatAutoCollect.ts',
    from: '// 不再写内容指纹账：文件本身（<ID>.md）就是账，删文件即重采。',
    to: 'state.doneKeys[chat.key] = Date.now(); // 变异：恢复旧双状态',
    test: 'src/electron/__tests__/webchatIdReconcile.test.ts',
  },
  {
    name: '⑤ 坏文件重新算已采（只有助手的旧文件永久跳过 → 有效性门禁必须红）',
    file: 'src/electron/webchatAutoCollect.ts',
    from: 'return [...listCollectedIds(join(deps.exportDir(), site), { requireUserMessage: true })];',
    to: 'return [...listCollectedIds(join(deps.exportDir(), site))];',
    test: 'src/electron/__tests__/webchatIdReconcile.test.ts',
  },
  {
    name: '⑥ 去掉 missing-user 硬校验（坏版本又能落盘 → 驱动真跑必须红）',
    file: 'src/electron/webchatAutoConfig.ts',
    from: "why = 'missing-user';",
    to: "why = 'ok-mutant';",
    test: 'src/electron/__tests__/webchatAutoConfig.test.ts',
  },
  {
    name: '⑦ 目录扫描忽略有效性参数（坏文件仍算已采 → 有效性单测必须红）',
    file: 'src/electron/webchatIdReconcile.ts',
    from: 'const requireUser = opts?.requireUserMessage === true;',
    to: 'const requireUser = false;',
    test: 'src/electron/__tests__/webchatIdReconcile.test.ts',
  },
];

let failed = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    console.error(`[SKIP] ${m.name}：找不到变异锚点 ${m.from}`);
    failed += 1;
    continue;
  }
  let red = false;
  try {
    writeFileSync(m.file, original.replace(m.from, m.to), 'utf8');
    const r = spawnSync('npx', ['vitest', 'run', m.test], { encoding: 'utf8', timeout: 180000 });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    red = r.status !== 0;
    console.log(`[${red ? 'OK 红' : 'FAIL 仍绿'}] ${m.name}`);
    if (!red) console.log(out.slice(-1200));
  } catch (e) {
    console.error(`[ERROR] ${m.name}：${String(e)}`);
    failed += 1;
  } finally {
    writeFileSync(m.file, original, 'utf8');
  }
  if (!red) failed += 1;
}
console.log(`变异验证：${MUTATIONS.length - failed}/${MUTATIONS.length} 按预期转红`);
process.exit(failed === 0 ? 0 : 1);
