import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scanSessionLogs,
  defaultAgentSources,
  parseDshProjcache,
  type SessionLogSource,
} from '../sessionCollector.ts';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── dsh-projcache 解析器（DSH 完整会话记录：turnOutline prompt/response 全文） ──

describe('parseDshProjcache', () => {
  const sample = JSON.stringify({
    version: 7,
    record: {
      identity: { formatVersion: 4, createdAt: 1790990229618, cwd: 'D:\\test', isSeeded: false },
      rows: {
        turnOutline: {
          ver: 2, seq: 100,
          val: {
            turns: [
              { turn: 1, seq: 5, prompt: '帮我看看为什么不能用', response: '让我先看看配置情况' },
              { turn: 2, seq: 30, prompt: '继续', response: '' }, // response 空 → 只采 user
              { turn: 3, seq: 40, prompt: '', response: '只有助手回复（跳过 user）' },
            ],
          },
        },
      },
    },
  });

  it('按 turn 采 user + assistant 全文（一字不漏）', () => {
    const out = parseDshProjcache(sample, 'deepseek-harness');
    expect(out).toHaveLength(4);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe('帮我看看为什么不能用');
    expect(out[0].session_id).toBe('dsht1');
    expect(out[1].role).toBe('assistant');
    expect(out[1].content).toBe('让我先看看配置情况');
    // turn 2：response 空 → 只采 user
    expect(out[2].role).toBe('user');
    expect(out[2].content).toBe('继续');
    // turn 3：prompt 空 → 只采 assistant
    expect(out[3].role).toBe('assistant');
    expect(out[3].content).toBe('只有助手回复（跳过 user）');
  });

  it('无 turnOutline / 坏 JSON → 空（诚实不造假）', () => {
    expect(parseDshProjcache('{}', 'dsh')).toEqual([]);
    expect(parseDshProjcache('{bad json', 'dsh')).toEqual([]);
    expect(parseDshProjcache(JSON.stringify({ record: { rows: {} } }), 'dsh')).toEqual([]);
  });
});

describe('defaultAgentSources DSH 源', () => {
  it('缺省（无白名单）→ 包含 deepseek-harness projcache 源（默认 P0 源）', () => {
    const home = tmpDir('dsh-all-');
    const srcs = defaultAgentSources({ home });
    const dsh = srcs.find((s) => s.name === 'deepseek-harness');
    expect(dsh).toBeDefined();
    expect(dsh!.parser).toBe('dsh-projcache');
    expect(dsh!.dir).toContain('session_projcache');
  });
});

describe('scanSessionLogs dsh-projcache 端到端', () => {
  it('真实 projcache JSON → 增量采集 + 幂等去重', async () => {
    const dir = tmpDir('dsh-e2e-');
    const rec1 = JSON.stringify({
      version: 7,
      record: {
        identity: { createdAt: 1000 },
        rows: { turnOutline: { val: { turns: [{ turn: 1, seq: 1, prompt: '问题一', response: '回答一' }] } } },
      },
    });
    fs.writeFileSync(path.join(dir, 'session-abc.json'), rec1);
    const src: SessionLogSource = {
      name: 'deepseek-harness', parser: 'dsh-projcache',
      dir, recursive: false, maxDepth: 1,
      filePattern: /^session-.*\.json$/, category: 'context',
    };
    const r1 = await scanSessionLogs({ sources: [src], seenHashes: new Set() });
    // 批次35：采集口缺省只采 user → 同 turn 的 response（助手正文）不进库
    expect(r1.collected).toBe(1);
    expect(r1.roleSkipped).toBe(1);
    expect(r1.items[0].role).toBe('user');
    expect(r1.items[0].content).toBe('问题一');
    // 第二轮：无内容变化 + seenHashes 命中 → 0 新采（幂等，按过滤后的消息数统计）
    const seen = new Set(r1.items.map((i) => i.hash));
    const r2 = await scanSessionLogs({ sources: [src], cursor: r1.cursors, seenHashes: seen });
    expect(r2.collected).toBe(0);
    expect(r2.deduped).toBe(1);
    // 放开白名单 → user + assistant 全文都采（历史口径可复现）
    const r3 = await scanSessionLogs({
      sources: [{ ...src, roles: ['user', 'assistant'] }], seenHashes: new Set(),
    });
    expect(r3.collected).toBe(2);
    expect(r3.items.map((i) => `${i.role}:${i.content}`)).toEqual(['user:问题一', 'assistant:回答一']);
  });
});
