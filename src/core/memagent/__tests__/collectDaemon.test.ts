// 批次44-A/B：独立采集守护验收 —— daemon 只扫描+暂存（永不碰账本）、分片只创建不改旧、
// 交接 drain 全成功才删文件、部分失败保留待重试（崩溃安全：重复写由 dedup 兜底，绝不丢）。
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAEMON_DIR_NAME, drainCollectPending, PENDING_DIR_NAME, runDaemonRound,
} from '../collectDaemon.ts';
import type { CollectedItem } from '../sessionCollector.ts';

let root: string;

function makeSource(dir: string) {
  return { name: 'testagent', parser: 'claude-jsonl' as const, dir, filePattern: /\.jsonl$/ };
}

function writeLog(dir: string, lines: string[]): void {
  writeFileSync(join(dir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
}

const userLine = (text: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text }, sessionId: 's1' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'collect-daemon-'));
});

describe('批次44-A daemon 一轮采集（runDaemonRound）', () => {
  it('扫描新消息 → 写 pending 分片 + 状态落盘；二轮同日志 → 指纹命中不再产分片', async () => {
    const logDir = join(root, 'logs');
    mkdirSync(logDir, { recursive: true });
    writeLog(logDir, [userLine('daemon scan hello'), userLine('daemon scan second')]);
    const stateDir = join(root, DAEMON_DIR_NAME);
    const opts = { stateDir, scan: { sources: [makeSource(logDir)] } };

    const r1 = await runDaemonRound(opts);
    expect(r1.scanned).toBe(2);
    expect(r1.newItems).toBe(2);
    expect(r1.pendingFile).toBeTruthy();
    expect(r1.cursorAdvanced).toBe(true);
    // 分片内容 = 原始条目（content/hash 完整，交接可写）
    const shard = JSON.parse((r1.pendingFile ? await import('node:fs/promises').then((m) => m.readFile(r1.pendingFile!, 'utf8')) : '')!) as { items: CollectedItem[] };
    expect(shard.items.map((i) => i.content)).toContain('daemon scan hello');
    // 状态文件已落盘
    expect(existsSync(join(stateDir, 'state.json'))).toBe(true);

    // 二轮：同日志无新内容 → 全部指纹命中，零新分片
    const r2 = await runDaemonRound(opts);
    expect(r2.scanned).toBe(0);
    expect(r2.newItems).toBe(0);
    expect(r2.pendingFile).toBeNull();
  });

  it('分片只创建新文件、永不改旧文件（与桌面端 drain 的唯一删除权零竞争）', async () => {
    const logDir = join(root, 'logs');
    mkdirSync(logDir, { recursive: true });
    writeLog(logDir, [userLine('first round only')]);
    const stateDir = join(root, DAEMON_DIR_NAME);
    const opts = { stateDir, scan: { sources: [makeSource(logDir)] } };
    const r1 = await runDaemonRound(opts);
    const firstFile = r1.pendingFile!;
    const firstContent = await import('node:fs/promises').then((m) => m.readFile(firstFile, 'utf8'));

    // 第二轮追加新消息 → 产出第二个分片，第一个分片字节不变
    writeLog(logDir, [userLine('first round only'), userLine('second round adds this')]);
    const r2 = await runDaemonRound(opts);
    expect(r2.newItems).toBe(1);
    expect(r2.pendingFile).not.toBe(firstFile);
    const firstContentAfter = await import('node:fs/promises').then((m) => m.readFile(firstFile, 'utf8'));
    expect(firstContentAfter).toBe(firstContent);
    expect(readdirSync(join(stateDir, PENDING_DIR_NAME))).toHaveLength(2);
  });
});

describe('批次44-A 交接（drainCollectPending）', () => {
  it('write 全成功 → 分片删除 + written 计数；分片目录不存在 → 诚实空回执', async () => {
    const pendingDir = join(root, PENDING_DIR_NAME);
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, 'shard-a.json'), JSON.stringify({ ts: 1, items: [{ key: 'k', agent: 'a', role: 'user', content: 'x', hash: 'h1', seq: 1 }] }), 'utf8');
    const written: string[] = [];
    const r = await drainCollectPending({ pendingDir, write: async (it) => { written.push(it.content); } });
    expect(r.files).toBe(1);
    expect(r.written).toBe(1);
    expect(r.failedFiles).toEqual([]);
    expect(written).toEqual(['x']);
    expect(existsSync(join(pendingDir, 'shard-a.json'))).toBe(false);
    // 空目录（不存在）→ 零回执不报错
    const r2 = await drainCollectPending({ pendingDir: join(root, 'nope'), write: async () => undefined });
    expect(r2.files).toBe(0);
  });

  it('部分条目失败 → 整个分片保留待重试（绝不丢消息），失败如实进 errors', async () => {
    const pendingDir = join(root, PENDING_DIR_NAME);
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, 'shard-b.json'), JSON.stringify({ ts: 1, items: [
      { key: 'k', agent: 'a', role: 'user', content: 'ok one', hash: 'h1', seq: 1 },
      { key: 'k', agent: 'a', role: 'user', content: 'boom', hash: 'h2', seq: 2 },
    ] }), 'utf8');
    const r = await drainCollectPending({
      pendingDir,
      write: async (it) => { if (it.content === 'boom') throw new Error('E_L0_LOCKED 写密钥未解锁'); },
    });
    expect(r.written).toBe(1);          // 'ok one' 已写入
    expect(r.failedFiles).toContain('shard-b.json');
    expect(r.errors.join('\n')).toContain('E_L0_LOCKED');
    expect(existsSync(join(pendingDir, 'shard-b.json'))).toBe(true); // 保留待重试
  });

  it('损坏分片（半截 JSON）→ 保留并如实记错，不阻塞其余分片', async () => {
    const pendingDir = join(root, PENDING_DIR_NAME);
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, 'bad.json'), '{"items": [ {"content"', 'utf8'); // daemon 写半截的模拟
    writeFileSync(join(pendingDir, 'good.json'), JSON.stringify({ ts: 1, items: [{ key: 'k', agent: 'a', role: 'user', content: 'good row', hash: 'h', seq: 1 }] }), 'utf8');
    const r = await drainCollectPending({ pendingDir, write: async () => undefined });
    expect(r.failedFiles).toContain('bad.json');
    expect(r.written).toBe(1);
    expect(existsSync(join(pendingDir, 'bad.json'))).toBe(true);
    expect(existsSync(join(pendingDir, 'good.json'))).toBe(false);
  });
});
