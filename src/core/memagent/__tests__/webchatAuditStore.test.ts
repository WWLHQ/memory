// 审计快照的读写口径（真文件系统）。
//
// 2026-11-17 实测事故：接收端把快照写成 `<数据根>/webchat-audit/<时间戳>.json`（扁平），
// 而读取端只扫 `<dir>/<站点>/*.json`（按站点分子目录）→ 磁盘上明明有 191 份快照，
// 界面上却报「还没有可比对的原对话快照」。这类「写了读不到」的缺陷单看任一侧都正常，
// 必须用真目录把两侧钉在一起。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuditSnapshots, resolveAuditDir, runAudit } from '../webchatAuditStore.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'audit-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    try { rmSync(dirs.pop() as string, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  }
});

function snapshot(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    site: 'deepseek',
    title: '会话一',
    url: 'https://chat.deepseek.com/a/chat/s/1',
    exportedAt: 1794900000000,
    source: [{ role: 'user', text: '问' }, { role: 'assistant', text: '答' }],
    exportedMarkdown: '# 会话一\n\n- 站点：DeepSeek\n\n## 用户\n\n问\n\n## 助手\n\n答\n',
    ...over,
  });
}

describe('审计快照读取：布局兼容', () => {
  it('扁平静态（接收端实际写出来的布局）能被读到', () => {
    const dir = tmp();
    writeFileSync(join(dir, '20261117-180608.json'), snapshot(), 'utf8');
    writeFileSync(join(dir, '20261117-180609.json'), snapshot({ title: '会话二' }), 'utf8');

    expect(readAuditSnapshots(dir)).toHaveLength(2);
  });

  it('按站点分子目录的布局也能读到（设计稿布局，向后兼容）', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'deepseek'), { recursive: true });
    writeFileSync(join(dir, 'deepseek', 'a.json'), snapshot(), 'utf8');

    const snaps = readAuditSnapshots(dir);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].site).toBe('deepseek');
  });

  it('坏快照 / 非 json 不影响其它文件', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'ok.json'), snapshot(), 'utf8');
    writeFileSync(join(dir, 'bad.json'), '{ 不是 json', 'utf8');
    writeFileSync(join(dir, 'note.txt'), 'ignored', 'utf8');

    expect(readAuditSnapshots(dir)).toHaveLength(1);
  });

  it('扁平布局跑一次审计 → 会话数与正确率都是真数字（不是 0）', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), snapshot(), 'utf8');
    writeFileSync(join(dir, 'b.json'), snapshot({ title: '会话二', url: 'https://x/2' }), 'utf8');

    const out = runAudit(dir);
    expect(out.summary.sessions).toBe(2);
    expect(out.summary.sessionsWithSnapshot).toBe(2);
    expect(out.summary.accuracy).toBe(1); // 导出与原文逐字一致
  });

  it('目录不存在 → 空结果，不抛错', () => {
    expect(readAuditSnapshots(join(tmp(), 'nope'))).toEqual([]);
  });

  it('审计目录固定在数据根下（不跟导出目录走，避免污染用户下载目录）', () => {
    expect(resolveAuditDir('C:\\data')).toBe('C:\\data\\webchat-audit');
  });
});
