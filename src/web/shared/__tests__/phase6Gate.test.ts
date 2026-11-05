// 阶段6 门禁固化契约（变异杀手）：`tools/check-no-demo.mjs` 零白名单 + verify:fast/CI 接线 + 注释收口。
// ① 白名单恒为空，判据只锁已清除且在 src/ 生产代码零命中的伪造标识；范围界定不是白名单例外。
// ② 不锁 E 类种子口令（Admin@123456 / demo1234）与合法用途（slice(0,8) / 真实 /overview.html 入口）。
// ③ 变异验证用**临时根目录**实测：注入旧值 → 门禁退出 1 → 撤销 → 退出 0，全程不碰真实源码。
import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'tools/check-no-demo.mjs');

function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function gate(args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 在临时根下建 src/ 并返回清理函数；门禁的 --root 指向这里，不污染真实仓库 */
function tempRoot(files: Record<string, string>): { root: string; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'mam6-gate-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'src', name), body, 'utf8');
  }
  return { root, clean: () => rmSync(root, { recursive: true, force: true }) };
}

describe('阶段6 / ① 零白名单与判据边界', () => {
  it('脚本存在，ALLOWLIST 为空数组且启动自检不为空即失败', () => {
    const s = src('tools/check-no-demo.mjs');
    expect(s).toContain('const ALLOWLIST = [];');
    expect(s).toContain('if (ALLOWLIST.length !== 0)');
    expect(s).toContain('不要登记例外');
  });

  it('判据覆盖阶段2–5 的关键伪造标识，且范围只扫 src 生产代码', () => {
    const s = src('tools/check-no-demo.mjs');
    expect(s).toContain("const SCAN_DIRS = ['src']");
    for (const id of [
      'A01-proxy-catalog', 'A02-fake-models', 'A03-demo-flags', 'A11-restored-user',
      'A12-demo-tenant', 'B01-demo-algo', 'C01-safe-noop', 'C02-token-bill',
    ]) {
      expect(s).toContain(`id: '${id}'`);
    }
    expect(s).toContain("'__tests__'");
    expect(s).toContain('SKIP_FILE');
  });

  it('口径边界：不把 E 类种子口令 / dev 演示账号列为判据', () => {
    const s = src('tools/check-no-demo.mjs');
    expect(s).not.toContain('Admin@123456');
    expect(s).not.toContain('demo1234');
    expect(s).toContain('不锁种子口令');
  });

  it('不误伤合法用途：slice(0,8) 与真实 /overview.html 入口都不做判据', () => {
    const s = src('tools/check-no-demo.mjs');
    const rules = s.slice(s.indexOf('const RULES = ['), s.indexOf('function parseArgs'));
    expect(rules).not.toContain('slice(');
    // A09 只锁旧声明；真实入口 URL 本身不列判据
    expect(rules).toContain("id: 'A09-fake-audit-link', re: /跳检索页占位|REQ-012 待实现/");
    expect(s).toContain('真实入口 URL');
    expect(s).toContain('不误伤合法用途');
  });
});

describe('阶段6 / ② 接线 verify:fast + CI', () => {
  it('package.json 有 check:no-demo script，且 verify:fast 串行包含它', () => {
    const pkg = JSON.parse(src('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:no-demo']).toBe('node tools/check-no-demo.mjs');
    const fast = pkg.scripts['verify:fast'];
    expect(fast).toContain('npm run check:no-demo');
    // 门禁必须在覆盖率之前，失败即短路，不浪费一次全量覆盖率
    expect(fast.indexOf('check:no-demo')).toBeLessThan(fast.indexOf('test:coverage'));
    expect(pkg.scripts.verify).toContain('verify:fast');
  });

  it('ci.yml 两个 job 仍跑 verify:fast，注释写明内含零白名单门禁', () => {
    const ci = src('.github/workflows/ci.yml');
    expect(ci.match(/run: npm run verify:fast/g)).toHaveLength(2);
    expect(ci).toContain('check:no-demo');
    expect(ci).toContain('tools/check-no-demo.mjs');
    expect(ci).toContain('零白名单');
  });
});

describe('阶段6 / ③ 注释收口：生产代码不再复现旧值', () => {
  it('阶段3/4/5 的 5 处历史说明已改为不复现旧标识', () => {
    const files = [
      'src/web/models/catalog.ts',
      'src/web/models/coreModels.ts',
      'src/core/memagent/llm.ts',
      'src/web/growth/useGrowthReal.ts',
      'src/web/retrieval/RetrievalPage.tsx',
    ];
    for (const f of files) {
      const s = src(f);
      expect(s).not.toContain('PROXY_CATALOG');
      expect(s).not.toContain('claude-free');
      expect(s).not.toContain('演示级');
      expect(s).not.toContain('占位 toast');
    }
  });

  it('首跑门禁扫出的 4 处历史说明已就地更正', () => {
    expect(src('src/web/audit/auditLink.ts')).not.toContain('占位假链接');
    expect(src('src/web/growth/useGrowthReal.ts')).not.toContain('编造 0.5');
    expect(src('src/web/growth/useGrowthReal.ts')).not.toContain('0.2+0.2×');
    expect(src('src/web/write/DedupCard.tsx')).not.toContain('三模式按钮');
  });
});

describe('阶段6 / ④ 门禁实测（含变异红/绿切换）', () => {
  it('干净仓库 → 退出 0，输出「通过」，JSON 里白名单 0、命中 0', () => {
    const ok = gate();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('✅ 通过');
    expect(ok.stdout).toContain('白名单 0 条');
    const j = JSON.parse(gate(['--json']).stdout) as {
      ok: boolean; allowlist: number; hits: unknown[]; scanned: number; rules: number;
    };
    expect(j.ok).toBe(true);
    expect(j.allowlist).toBe(0);
    expect(j.hits).toEqual([]);
    expect(j.scanned).toBeGreaterThan(300);
    expect(j.rules).toBe(21);
  });

  it('变异杀手：临时根注入旧值 → 退出 1 且报出判据 id；撤销 → 退出 0', () => {
    const t = tempRoot({ 'evil.ts': "export const x = 'PROXY_CATALOG';\n" });
    try {
      const bad = gate([`--root=${t.root}`, '--json']);
      expect(bad.status).toBe(1);
      const j = JSON.parse(bad.stdout) as { ok: boolean; hits: Array<{ rule: string; file: string }> };
      expect(j.ok).toBe(false);
      expect(j.hits.some((h) => h.rule === 'A01-proxy-catalog' && h.file === 'src/evil.ts')).toBe(true);

      // 撤销变异（删掉伪造值，保留干净文件）→ 门禁转绿
      writeFileSync(join(t.root, 'src', 'evil.ts'), 'export const x = 1;\n', 'utf8');
      const good = gate([`--root=${t.root}`]);
      expect(good.status).toBe(0);
      expect(good.stdout).toContain('✅ 通过');
    } finally {
      t.clean();
    }
  });

  it('不误伤：临时根写入种子口令 / 分页截断 / 真实入口 URL → 仍退出 0', () => {
    const t = tempRoot({
      'legit.ts': [
        "export const pwd = 'Admin@123456';",
        "export const short = hash.slice(0, 8);",
        "export const entry = '/overview.html';",
        "export const dry = 'dry-run 明示标注';",
      ].join('\n'),
    });
    try {
      const r = gate([`--root=${t.root}`]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('✅ 通过');
    } finally {
      t.clean();
    }
  });
});
