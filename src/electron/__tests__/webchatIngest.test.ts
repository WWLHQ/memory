// 插件导出接收端（webchat-ingest）单测。
// 覆盖：令牌 / 站点判据 / 落盘路径 / 同名冲突 / HTTP 层（预检、ping、413）/ runtime.json。
// 背景：QQ 浏览器把 chrome.downloads 的子目录剥掉、把文件丢进 %TEMP%，
// 应用却去 Downloads\chat-exports 扫 → 「采到 0 条」。改为应用自己落盘后此路径不再依赖浏览器。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  WEBCHAT_SITE_RE,
  createWebchatIngestServer,
  handleClearRequest,
  handleExportRequest,
  newWebchatIngestToken,
  webchatExportFileName,
  writeWebchatRuntime,
} from '../webchatIngest.ts';

const TOKEN = 'tok_test_123';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'wci-'));
}

describe('webchatIngest：令牌与入参判据', () => {
  it('无令牌 / 错令牌 → 401，且一个字节都不写', () => {
    const writes: string[] = [];
    const opts = {
      token: TOKEN,
      resolveExportDir: () => 'C:\\exports',
      mkdirp: () => {},
      writeFile: (p: string) => {
        writes.push(p);
      },
    };
    expect(handleExportRequest(opts, {}, { site: 'deepseek', markdown: 'x' }).code).toBe(401);
    expect(handleExportRequest(opts, { authorization: 'Bearer nope' }, { site: 'deepseek', markdown: 'x' }).code).toBe(401);
    expect(handleExportRequest(opts, { authorization: TOKEN }, { site: 'deepseek', markdown: 'x' }).code).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('站点名必须过 ^[a-z0-9_-]{1,40}$：路径穿越被拒', () => {
    const writes: string[] = [];
    const opts = {
      token: TOKEN,
      resolveExportDir: () => 'C:\\exports',
      mkdirp: () => {},
      writeFile: (p: string) => {
        writes.push(p);
      },
    };
    for (const site of ['../../evil', 'a\\b', 'DeepSeek', '', 'x'.repeat(41)]) {
      const r = handleExportRequest(opts, { authorization: `Bearer ${TOKEN}` }, { site, markdown: 'x' });
      expect(r.code).toBe(400);
    }
    expect(writes).toHaveLength(0);
    // 与采集侧同一判据
    expect(WEBCHAT_SITE_RE.test('deepseek')).toBe(true);
    expect(WEBCHAT_SITE_RE.test('../evil')).toBe(false);
  });

  it('正文为空 → 400（不产生空文件）', () => {
    const writes: string[] = [];
    const r = handleExportRequest(
      { token: TOKEN, resolveExportDir: () => 'C:\\exports', mkdirp: () => {}, writeFile: (p: string) => writes.push(p) },
      { authorization: `Bearer ${TOKEN}` },
      { site: 'deepseek', markdown: '' },
    );
    expect(r.code).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('合法请求 → 写进 <导出目录>/<站点>/<时间戳>.md，内容原样', () => {
    const dir = tmpDir();
    try {
      const at = new Date(2026, 10, 16, 22, 23, 5).getTime();
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => dir, now: () => at },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: '# 网页对话导出\n\n## 助手\n内容', exportedAt: at },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.site).toBe('deepseek');
      expect(r.body.path).toBe(join(dir, 'deepseek', '20261116-222305.md'));
      expect(readFileSync(r.body.path as string, 'utf8')).toBe('# 网页对话导出\n\n## 助手\n内容');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同一秒写两次 → 第二次加 -1 后缀，绝不覆盖已采过的文件', () => {
    const dir = tmpDir();
    try {
      const at = new Date(2026, 10, 16, 22, 23, 5).getTime();
      const opts = { token: TOKEN, resolveExportDir: () => dir, now: () => at };
      const headers = { authorization: `Bearer ${TOKEN}` };
      const first = handleExportRequest(opts, headers, { site: 'deepseek', markdown: 'A', exportedAt: at });
      const second = handleExportRequest(opts, headers, { site: 'deepseek', markdown: 'B', exportedAt: at });
      expect(first.body.path).toBe(join(dir, 'deepseek', '20261116-222305.md'));
      expect(second.body.path).toBe(join(dir, 'deepseek', '20261116-222305-1.md'));
      expect(readFileSync(first.body.path as string, 'utf8')).toBe('A');
      expect(readFileSync(second.body.path as string, 'utf8')).toBe('B');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录读取抛错 → 500 且如实带原因（不静默成功）', () => {
    const r = handleExportRequest(
      {
        token: TOKEN,
        resolveExportDir: () => {
          throw new Error('盘符不可用');
        },
        mkdirp: () => {},
        writeFile: () => {},
      },
      { authorization: `Bearer ${TOKEN}` },
      { site: 'deepseek', markdown: 'x' },
    );
    expect(r.code).toBe(500);
    expect(String(r.body.error)).toContain('盘符不可用');
  });

  it('文件名格式与插件侧一致（YYYYMMDD-HHmmss.md）', () => {
    expect(webchatExportFileName(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('20260102-030405.md');
  });
});

describe('webchatIngest：HTTP 层', () => {
  it('预检 204 + ping + 带令牌 POST 真的落盘；无令牌 401', async () => {
    const dir = tmpDir();
    const token = newWebchatIngestToken();
    const srv = createWebchatIngestServer({ token, resolveExportDir: () => dir });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      const pre = await fetch(`http://127.0.0.1:${port}/export`, { method: 'OPTIONS' });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      expect(String(pre.headers.get('access-control-allow-headers'))).toContain('authorization');

      const ping = await fetch(`http://127.0.0.1:${port}/ping`);
      expect(((await ping.json()) as { ok: boolean }).ok).toBe(true);

      const denied = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: 'deepseek', markdown: 'x' }),
      });
      expect(denied.status).toBe(401);

      const okRes = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ site: 'doubao', markdown: '## 助手\n你好' }),
      });
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as { ok: boolean; path: string; site: string };
      expect(body.ok).toBe(true);
      expect(body.site).toBe('doubao');
      expect(existsSync(body.path)).toBe(true);
      expect(readFileSync(body.path, 'utf8')).toBe('## 助手\n你好');
    } finally {
      await new Promise<void>((ok) => srv.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('超过体积上限 → 413（不是连接重置，也不是静默截断）', async () => {
    const dir = tmpDir();
    const srv = createWebchatIngestServer({ token: TOKEN, resolveExportDir: () => dir, maxBodyBytes: 128 });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ site: 'deepseek', markdown: 'x'.repeat(4096) }),
      });
      expect(res.status).toBe(413);
      expect(String(((await res.json()) as { error: string }).error)).toContain('上限');
    } finally {
      await new Promise<void>((ok) => srv.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非法 JSON / 未知路径 / 错误方法都被明确拒绝', async () => {
    const dir = tmpDir();
    const srv = createWebchatIngestServer({ token: TOKEN, resolveExportDir: () => dir });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      const bad = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: 'not-json',
      });
      expect(bad.status).toBe(400);
      const unknown = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(unknown.status).toBe(404);
      const wrongMethod = await fetch(`http://127.0.0.1:${port}/export`);
      expect(wrongMethod.status).toBe(405);
    } finally {
      await new Promise<void>((ok) => srv.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('0.3.0 记账：成功落盘才触发 onSaved（站点/路径/字节）；401/400 一律不触发', async () => {
    const dir = tmpDir();
    const saved: { site: string; path: string; bytes: number }[] = [];
    const srv = createWebchatIngestServer({
      token: TOKEN,
      resolveExportDir: () => dir,
      onSaved: (info) => saved.push({ site: info.site, path: info.path, bytes: info.bytes }),
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: 'deepseek', markdown: 'x' }),
      });
      expect(denied.status).toBe(401);
      expect(saved).toHaveLength(0);

      const empty = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ site: 'deepseek', markdown: '' }),
      });
      expect(empty.status).toBe(400);
      expect(saved).toHaveLength(0);

      const okRes = await fetch(`http://127.0.0.1:${port}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ site: 'doubao', markdown: '## 用户\n历史会话也导' }),
      });
      expect(okRes.status).toBe(200);
      expect(saved).toHaveLength(1);
      expect(saved[0].site).toBe('doubao');
      expect(saved[0].bytes).toBeGreaterThan(0);
      expect(existsSync(saved[0].path)).toBe(true);
    } finally {
      await new Promise<void>((ok) => srv.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('webchatIngest：页面结构诊断（只在没认出用户提问时附带）', () => {
  it('诊断落在独立目录，导出目录里只出现 .md（采集器不会误扫）', () => {
    const exportDir = tmpDir();
    const diagDir = tmpDir();
    try {
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveDiagDir: () => diagDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: '## 助手\n答', diag: { site: 'deepseek', counted: { user: 0 } } },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(String(r.body.diagPath)).toBeTruthy();
      expect(String(r.body.diagPath).startsWith(diagDir)).toBe(true);
      // 与对话文件同名、不同后缀
      expect(basename(String(r.body.diagPath))).toBe(
        basename(String(r.body.path)).replace(/\.md$/, '.json'),
      );
      const parsed = JSON.parse(readFileSync(String(r.body.diagPath), 'utf8')) as { site: string };
      expect(parsed.site).toBe('deepseek');
      // 关键：导出目录里不能出现 json，否则会被当成对话文件
      const inExport = readdirSync(join(exportDir, 'deepseek'));
      expect(inExport).toHaveLength(1);
      expect(inExport[0].endsWith('.md')).toBe(true);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(diagDir, { recursive: true, force: true });
    }
  });

  it('不带诊断时一个诊断文件都不产生', () => {
    const exportDir = tmpDir();
    const diagDir = tmpDir();
    try {
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveDiagDir: () => diagDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'doubao', markdown: '## 用户\n问\n\n## 助手\n答' },
      );
      expect(r.body.ok).toBe(true);
      expect(r.body.diagPath).toBeUndefined();
      expect(readdirSync(diagDir)).toHaveLength(0);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(diagDir, { recursive: true, force: true });
    }
  });

  it('诊断超大 → 跳过诊断但对话文件照常落盘（不能因诊断拖垮主流程）', () => {
    const exportDir = tmpDir();
    const diagDir = tmpDir();
    try {
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveDiagDir: () => diagDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: '## 助手\n答', diag: { blob: 'x'.repeat(300 * 1024) } },
      );
      expect(r.body.ok).toBe(true);
      expect(existsSync(String(r.body.path))).toBe(true);
      expect(String(r.body.diagSkipped)).toContain('上限');
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(diagDir, { recursive: true, force: true });
    }
  });

  it('诊断目录写不进去 → 只记原因，对话文件仍是成功', () => {
    const exportDir = tmpDir();
    try {
      const r = handleExportRequest(
        {
          token: TOKEN,
          resolveExportDir: () => exportDir,
          resolveDiagDir: () => {
            throw new Error('E_TEST_NO_DIR');
          },
        },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: '## 助手\n答', diag: { site: 'deepseek' } },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(String(r.body.diagSkipped)).toContain('写诊断失败');
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
});

describe('webchatIngest：runtime.json', () => {
  it('写进插件目录，含端口与令牌（扩展据此直连本机）', () => {
    const dir = tmpDir();
    try {
      const file = writeWebchatRuntime({ extDir: dir, port: 8206, token: 'abc123' });
      expect(file).toBe(join(dir, 'runtime.json'));
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string; updatedAt: number };
      expect(parsed.port).toBe(8206);
      expect(parsed.token).toBe('abc123');
      expect(parsed.updatedAt).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 2026-11-17 用户诉求：「请判断一下导出文档和原对话有无差异，是不是全部导出有无遗漏，
// 正确率如何统计好请汇报」。
//
// 关键前提（实测确认）：原对话**不在本机磁盘上** —— DeepSeek 的 IndexedDB 只存会话元数据
// （id/title/updated_at/is_empty），正文搜不到。所以「导出后拿文件跟原对话比」这条路不存在，
// 唯一可行是**插件抽取时把原对话一起带上来**。这里钉死这条链路真的通。
describe('webchatIngest：审计快照（原对话 + 导出文档成对落盘）', () => {
  const MARKDOWN = '# 网页对话导出\n\n## 用户\n问题一\n\n## 助手\n回答一\n';

  it('带 auditSource → 原对话与导出文档成对写进审计目录', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      const r = handleExportRequest(
        {
          token: TOKEN,
          resolveExportDir: () => exportDir,
          resolveAuditDir: () => auditDir,
        },
        { authorization: `Bearer ${TOKEN}` },
        {
          site: 'deepseek',
          title: '会话一',
          url: 'https://chat.deepseek.com/a/chat/s/1',
          markdown: MARKDOWN,
          auditSource: [{ role: 'user', text: '问题一' }, { role: 'assistant', text: '回答一' }],
        },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(String(r.body.auditPath).startsWith(auditDir)).toBe(true);

      const snap = JSON.parse(readFileSync(String(r.body.auditPath), 'utf8')) as {
        site: string; title: string; url: string; source: { role: string; text: string }[]; exportedMarkdown: string;
      };
      expect(snap.site).toBe('deepseek');
      expect(snap.title).toBe('会话一');
      expect(snap.source).toHaveLength(2);
      expect(snap.source[0].text).toBe('问题一');
      expect(snap.exportedMarkdown).toBe(MARKDOWN);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('审计文件不进导出目录（采集器只扫 chat-exports，不能把 json 当对话）', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveAuditDir: () => auditDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: MARKDOWN, auditSource: [{ role: 'user', text: '问题一' }] },
      );
      const inExport = readdirSync(join(exportDir, 'deepseek'));
      expect(inExport).toHaveLength(1);
      expect(inExport[0].endsWith('.md')).toBe(true);
      // 审计目录里才有 json
      expect(readdirSync(auditDir).some((f) => f.endsWith('.json'))).toBe(true);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('角色不合法的条目被剔除（只有 user/assistant 才算数）', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveAuditDir: () => auditDir },
        { authorization: `Bearer ${TOKEN}` },
        {
          site: 'deepseek',
          markdown: MARKDOWN,
          auditSource: [
            { role: 'user', text: '问题一' },
            { role: 'system', text: '系统提示' },
            { role: 'assistant', text: 42 },
          ],
        },
      );
      const snap = JSON.parse(readFileSync(String(r.body.auditPath), 'utf8')) as { source: unknown[] };
      expect(snap.source).toHaveLength(1);
      expect((snap.source[0] as { text: string }).text).toBe('问题一');
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('不带 auditSource → 不产生审计文件（老插件没带快照，不许凭空造）', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveAuditDir: () => auditDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: MARKDOWN },
      );
      expect(r.body.ok).toBe(true);
      expect(r.body.auditPath).toBeUndefined();
      expect(readdirSync(auditDir)).toHaveLength(0);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('审计快照超大 → 跳过审计但对话文件照常落盘（不能因审计拖垮主流程）', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      const huge = 'x'.repeat(9 * 1024 * 1024);
      const r = handleExportRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveAuditDir: () => auditDir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: MARKDOWN, auditSource: [{ role: 'user', text: huge }] },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.auditPath).toBeUndefined();
      expect(String(r.body.auditSkipped)).toContain('超过上限');
      // 对话文件照常在
      expect(readdirSync(join(exportDir, 'deepseek'))[0].endsWith('.md')).toBe(true);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('审计目录写不进去 → 只记原因，对话文件仍是成功', () => {
    const exportDir = tmpDir();
    try {
      const r = handleExportRequest(
        {
          token: TOKEN,
          resolveExportDir: () => exportDir,
          resolveAuditDir: () => { throw new Error('审计目录不可写'); },
        },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'deepseek', markdown: MARKDOWN, auditSource: [{ role: 'user', text: '问题一' }] },
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(String(r.body.auditSkipped)).toContain('审计目录不可写');
      expect(readdirSync(join(exportDir, 'deepseek'))[0].endsWith('.md')).toBe(true);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
});

// ── 0.5.3：清空旧导出（2026-11-17 用户要求「重导前先清空」）──────────────────
// 背景：抽取层补结构后同一段对话的文本变了 → 内容指纹也变了 → 去重账对不上 →
// 重导会在导出目录里再落一份。所以重导前必须先把旧 md 清掉，否则越导越多。
// 边界同样要钉死：只删「站点目录里、直接位于该层的 .md」，诊断目录与记忆库一概不碰。
describe('webchatIngest：清空旧导出', () => {
  function seed(exportDir: string): void {
    mkdirSync(join(exportDir, 'deepseek'), { recursive: true });
    mkdirSync(join(exportDir, 'doubao'), { recursive: true });
    writeFileSync(join(exportDir, 'deepseek', '20261117-100000.md'), 'a', 'utf8');
    writeFileSync(join(exportDir, 'deepseek', '20261117-100001.md'), 'b', 'utf8');
    writeFileSync(join(exportDir, 'doubao', '20261117-100002.md'), 'c', 'utf8');
    // 这些都不该被删：非 md、站点目录下的子目录、非法站点名目录
    writeFileSync(join(exportDir, 'deepseek', 'note.txt'), 'keep', 'utf8');
    mkdirSync(join(exportDir, 'deepseek', 'nested'), { recursive: true });
    writeFileSync(join(exportDir, 'deepseek', 'nested', 'x.md'), 'keep', 'utf8');
    mkdirSync(join(exportDir, 'Bad Name'), { recursive: true });
    writeFileSync(join(exportDir, 'Bad Name', 'y.md'), 'keep', 'utf8');
  }

  it('无令牌 → 401，一个文件都不删', () => {
    const dir = tmpDir();
    try {
      seed(dir);
      const r = handleClearRequest({ token: TOKEN, resolveExportDir: () => dir }, {}, {});
      expect(r.code).toBe(401);
      expect(r.body.deleted).toBe(0);
      expect(existsSync(join(dir, 'deepseek', '20261117-100000.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('删掉各站点目录里的 .md，但不动非 md / 子目录 / 非法站点目录', () => {
    const dir = tmpDir();
    try {
      seed(dir);
      const r = handleClearRequest(
        { token: TOKEN, resolveExportDir: () => dir },
        { authorization: `Bearer ${TOKEN}` },
        {},
      );
      expect(r.code).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.deleted).toBe(3);
      expect(r.body.sites.sort()).toEqual(['deepseek', 'doubao']);
      expect(readdirSync(join(dir, 'deepseek')).sort()).toEqual(['nested', 'note.txt']);
      expect(existsSync(join(dir, 'deepseek', 'nested', 'x.md'))).toBe(true);
      expect(existsSync(join(dir, 'Bad Name', 'y.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('指定站点时只清那一个；站点名不合法 → 400', () => {
    const dir = tmpDir();
    try {
      seed(dir);
      const r = handleClearRequest(
        { token: TOKEN, resolveExportDir: () => dir },
        { authorization: `Bearer ${TOKEN}` },
        { site: 'doubao' },
      );
      expect(r.code).toBe(200);
      expect(r.body.deleted).toBe(1);
      expect(r.body.sites).toEqual(['doubao']);
      expect(existsSync(join(dir, 'deepseek', '20261117-100000.md'))).toBe(true);

      const bad = handleClearRequest(
        { token: TOKEN, resolveExportDir: () => dir },
        { authorization: `Bearer ${TOKEN}` },
        { site: '../evil' },
      );
      expect(bad.code).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('audit=true 时连审计快照一起清（平铺 + 按站点子目录两种摆法）', () => {
    const exportDir = tmpDir();
    const auditDir = tmpDir();
    try {
      seed(exportDir);
      writeFileSync(join(auditDir, 'flat.json'), '{}', 'utf8');
      mkdirSync(join(auditDir, 'deepseek'), { recursive: true });
      writeFileSync(join(auditDir, 'deepseek', 'one.json'), '{}', 'utf8');
      writeFileSync(join(auditDir, 'keep.txt'), 'x', 'utf8');

      const r = handleClearRequest(
        { token: TOKEN, resolveExportDir: () => exportDir, resolveAuditDir: () => auditDir },
        { authorization: `Bearer ${TOKEN}` },
        { audit: true },
      );

      expect(r.code).toBe(200);
      expect(r.body.deleted).toBe(3);
      expect(r.body.deletedAudit).toBe(2);
      expect(existsSync(join(auditDir, 'flat.json'))).toBe(false);
      expect(existsSync(join(auditDir, 'deepseek', 'one.json'))).toBe(false);
      expect(existsSync(join(auditDir, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('有文件删不掉 → 如实报失败（调用方据此不重置去重账，避免文件半删、账已清）', () => {
    const dir = tmpDir();
    try {
      seed(dir);
      const r = handleClearRequest(
        {
          token: TOKEN,
          resolveExportDir: () => dir,
          unlinkFile: (p) => {
            if (p.endsWith('100001.md')) throw new Error('EBUSY');
            rmSync(p, { force: true });
          },
        },
        { authorization: `Bearer ${TOKEN}` },
        {},
      );
      expect(r.code).toBe(500);
      expect(r.body.ok).toBe(false);
      expect(r.body.deleted).toBe(2);
      expect(String(r.body.error)).toContain('EBUSY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('HTTP 层：POST /clear 走同一把令牌，GET 拒绝', async () => {
    const dir = tmpDir();
    const srv = createWebchatIngestServer({ token: TOKEN, resolveExportDir: () => dir });
    try {
      seed(dir);
      await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
      const port = (srv.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/clear`;

      const noAuth = await fetch(url, { method: 'POST', body: '{}' });
      expect(noAuth.status).toBe(401);

      const got = await fetch(url);
      expect(got.status).toBe(405);

      const okRes = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit: false }),
      });
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as { ok: boolean; deleted: number };
      expect(body.ok).toBe(true);
      expect(body.deleted).toBe(3);
    } finally {
      await new Promise<void>((ok) => srv.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
