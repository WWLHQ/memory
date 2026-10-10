// SqliteStorage（§5.3 桌面 P0 主源）验收：与 InMemoryStorage 行为一致 + 落盘重启保留 + agent 集成冒烟
// @vitest-environment node
// （node:sqlite 仅存在于 Node 运行时，jsdom 客户端环境无法打包内建模块）
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { SqliteStorage } from '../sqliteStorage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { AuditRecord, Memory, StorageBackend } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

const MEM_A: Memory = {
  mem_id: 'mem_a', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
  category: 'fact', layer: 'L2', content: 'deploy docker compose v2', embedding: [1, 0],
  decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: 1000,
};
const MEM_B: Memory = {
  mem_id: 'mem_b', project_id: 'P2', enterprise_id: 'e1', team_id: 't1',
  category: 'pitfall', layer: 'L2', content: 'api gateway retry storm', embedding: [0, 1],
  decay_class: 'warm', pinned: false, locked: false, version: 1, created_at: 2000,
};

const AUDITS: AuditRecord[] = [
  { request_id: 'req_1', action: 'write', ts: 100, detail: { op: 'write' } },
  { request_id: 'req_2', action: 'recall', ts: 200, detail: { op: 'recall' } },
  { request_id: 'req_2', action: 'write', ts: 300, detail: { op: 'write2' } },
];

describe('SqliteStorage 与 InMemoryStorage 行为一致', () => {
  let dbPath: string;
  let sqlite: SqliteStorage;

  beforeEach(() => {
    dbPath = join(tmpdir(), `memagent-test-${randomUUID()}.db`);
    sqlite = new SqliteStorage(dbPath);
  });
  afterEach(() => {
    sqlite.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });

  async function expectSameBehavior(a: StorageBackend, b: StorageBackend) {
    await a.putMemory(MEM_A);
    await a.putMemory(MEM_B);
    await b.putMemory(MEM_A);
    await b.putMemory(MEM_B);

    // get
    expect(await a.getMemory('mem_a')).toEqual(await b.getMemory('mem_a'));
    expect(await a.getMemory('nope')).toBeNull();

    // filter 单条件 / 组合 / 空结果
    expect(await a.listMemories({ project_id: 'P1' })).toEqual(await b.listMemories({ project_id: 'P1' }));
    expect(await a.listMemories({ project_id: 'P2', layer: 'L2' })).toEqual(
      await b.listMemories({ project_id: 'P2', layer: 'L2' }),
    );
    expect(await a.listMemories({ decay_class: 'cold' })).toEqual([]);
    // InMemory 是 Map 插入序，SQLite 是 rowid 序，同为插入序
    expect((await a.listMemories({})).map((m) => m.mem_id)).toEqual(['mem_a', 'mem_b']);

    // upsert 覆盖（同 id 写第二次 → 更新不新增）
    const updated = { ...MEM_A, content: 'updated content v2', version: 2, updated_at: 9999 };
    await a.putMemory(updated);
    await b.putMemory(updated);
    const ma = await a.getMemory('mem_a');
    expect(ma).toEqual(await b.getMemory('mem_a'));
    expect(ma!.version).toBe(2);

    // delete
    await a.deleteMemory('mem_b');
    await b.deleteMemory('mem_b');
    expect(await a.getMemory('mem_b')).toBeNull();
    expect(await b.getMemory('mem_b')).toBeNull();

    // audit append-only + 三种过滤 + 组合过滤
    for (const rec of AUDITS) {
      await a.appendAudit(rec);
      await b.appendAudit(rec);
    }
    expect(await a.queryAudit({})).toEqual(await b.queryAudit({}));
    expect(await a.queryAudit({ request_id: 'req_2' })).toEqual(await b.queryAudit({ request_id: 'req_2' }));
    expect(await a.queryAudit({ action: 'write' })).toEqual(await b.queryAudit({ action: 'write' }));
    expect(await a.queryAudit({ since: 250 })).toEqual(await b.queryAudit({ since: 250 }));
    expect(await a.queryAudit({ request_id: 'req_2', action: 'write' })).toEqual(
      await b.queryAudit({ request_id: 'req_2', action: 'write' }),
    );
    expect((await a.queryAudit({ request_id: 'req_2' })).map((x) => x.ts)).toEqual([200, 300]); // 插入序
  }

  it('CRUD + Filter + Audit 全量对比', async () => {
    await expectSameBehavior(sqlite, new InMemoryStorage());
  });
});

describe('SqliteStorage 落盘持久化（桌面 P0 主源）', () => {
  let dbPath: string;
  let sqlite: SqliteStorage;

  beforeEach(() => {
    dbPath = join(tmpdir(), `memagent-test-${randomUUID()}.db`);
    sqlite = new SqliteStorage(dbPath);
  });
  afterEach(() => {
    sqlite.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });

  it('close 后重开同路径：记忆与审计保留（重启持久化）', async () => {
    await sqlite.putMemory(MEM_A);
    await sqlite.appendAudit(AUDITS[0]);
    sqlite.close();

    const reopened = new SqliteStorage(dbPath);
    const m = await reopened.getMemory('mem_a');
    expect(m).not.toBeNull();
    expect(m!.content).toBe(MEM_A.content);
    expect((await reopened.listMemories({ project_id: 'P1' })).map((x) => x.mem_id)).toEqual(['mem_a']);
    const audits = await reopened.queryAudit({ action: 'write' });
    expect(audits).toHaveLength(1);
    expect(audits[0].request_id).toBe('req_1');
    reopened.close();
  });

  it('可选字段往返保真（vclock/importance/tags 嵌套结构）', async () => {
    const rich: Memory = {
      ...MEM_A,
      vclock: { desktop: 3 },
      importance: 0.8, confidence: 0.6,
      tags: ['deploy', 'docker'], merged_from: ['mem_x'],
      pending_sync: true, sha256: 'abc', updated_at: 12345,
    };
    await sqlite.putMemory(rich);
    expect(await sqlite.getMemory('mem_a')).toEqual(rich);
  });
});

describe('SqliteStorage × createMemAgent 集成冒烟', () => {
  let dbPath: string;
  let storages: SqliteStorage[];

  beforeEach(() => {
    dbPath = join(tmpdir(), `memagent-test-${randomUUID()}.db`);
    storages = [];
  });
  afterEach(() => {
    for (const s of storages) s.close(); // Windows 下先关连接再清理文件
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });

  function makeDesktopAgent(path: string) {
    const storage = new SqliteStorage(path);
    storages.push(storage);
    return createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
  }

  it('desktop 端 write → recall → 重启后 recall 命中同一 mem_id', async () => {
    const agent = makeDesktopAgent(dbPath);
    const seed = await agent._seedMemory({ content: 'k8s rolling update strategy tips', category: 'fact', project_id: 'P1' });
    const before = await agent.recall({ query: 'k8s rolling update strategy', project_id: 'P1' });
    expect(before.hits).toHaveLength(1);
    expect(before.hits[0].mem_id).toBe(seed.mem_id);
    // 内核存储句柄未直接暴露 close，进程级测试用第二个 agent 复开同库验证
    const agent2 = makeDesktopAgent(dbPath);
    const after = await agent2.recall({ query: 'k8s rolling update strategy', project_id: 'P1' });
    expect(after.hits).toHaveLength(1);
    expect(after.hits[0].mem_id).toBe(seed.mem_id);
    expect(after.hits[0].content).toBe('k8s rolling update strategy tips');
  });
});
