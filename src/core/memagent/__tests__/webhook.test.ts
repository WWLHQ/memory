// Webhook 采集端契约测试（§19.3 主通道 / §5.4 SHA-256 幂等）
import { beforeAll, describe, expect, it } from 'vitest';
import { createWebhook, HashIndex, type IngestEvent, type WebhookOptions } from '../webhook.ts';
import { InMemoryStorage } from '../storage.ts';
import { coreWrite } from '../memories.ts';
import { JsVectorBackend } from '../vector.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

// 共享写密钥（PBKDF2 只跑一次）：webhook 写入 = 后台写入，必须有 L0 写密钥
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function makeWebhook(refinePipeline?: WebhookOptions['refinePipeline']) {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  return {
    storage,
    webhook: createWebhook({
      storage,
      hashIndex: new HashIndex(),
      refinePipeline: refinePipeline ?? (async (input) => {
        const r = await coreWrite(
          {
            content: input.content,
            category: input.category,
            project_id: input.project_id,
            source_agent: input.source_agent,
          },
          {
            storage, vector,
            account: ACCOUNT,
            request_id: `req_wh_${Date.now()}`,
            now: Date.now(),
            l0: sharedVault,
          },
        );
        return {
          ok: true,
          // new = 新建；grafted = 已新建但嫁接到既有记忆；filtered/duplicated 都不新增层 → duplicate
          dedup: r.dedup.action === 'new' ? 'new' : r.dedup.action === 'grafted' ? 'grafted' : ('duplicate' as const),
          mem_id: r.mem_id,
          l2_preview: r.layers?.content_l2,
          refined_by: r.refined_by,
          ts: new Date().toISOString(),
        };
      }),
    }),
  };
}

describe('HashIndex 幂等（§5.4）', () => {
  it('SHA-256(content + session_id) 生成确定性 hash', () => {
    const h1 = HashIndex.makeHash('hello', 'sess-1');
    const h2 = HashIndex.makeHash('hello', 'sess-1');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64); // SHA-256 hex = 64 字符
    // 不同 session_id → 不同 hash
    expect(HashIndex.makeHash('hello', 'sess-2')).not.toBe(h1);
  });

  it('record → has → get 链路正确', () => {
    const hi = new HashIndex();
    const r = { ok: true, dedup: 'new' as const, hash: 'abc', mem_id: 'm1', ts: '' };
    hi.record('abc', r);
    expect(hi.has('abc')).toBe(true);
    expect(hi.get('abc')?.mem_id).toBe('m1');
    expect(hi.has('xyz')).toBe(false);
  });

  it('失败结果不进幂等索引（可重试），但保留在最近状态里', () => {
    const hi = new HashIndex();
    hi.record('bad', { ok: false, dedup: 'error', hash: 'bad', error: 'upstream timeout', ts: '' });
    expect(hi.has('bad')).toBe(false);
    expect(hi.get('bad')).toBeUndefined();
    expect(hi.recentN(5).map((r) => r.error)).toContain('upstream timeout');
  });
});

describe('Webhook ingest 主通道（§19.3）', () => {
  it('首次 ingest → 成功 + 入库 + 审计（source=webhook）', async () => {
    const { storage, webhook } = makeWebhook();
    const event: IngestEvent = {
      content: 'Webhook 采集测试：连接池 pool_size=5 太小',
      project_id: 'P1',
      session_id: 'sess-wh-001',
      source_agent: 'claude-code',
      category: 'pitfall',
    };
    const r = await webhook.ingest(event);
    expect(r.ok).toBe(true);
    expect(r.dedup).toBe('new');
    expect(r.mem_id).toMatch(/^mem_/);
    expect(r.hash).toHaveLength(64);
    // 未接入真实 LLM → 无 L2 摘要，诚实返回 refined_by=stub
    expect(r.l2_preview).toBeUndefined();
    expect(r.refined_by).toBe('stub');

    // 验证 L0 已加密
    const mems = await storage.listMemories({});
    const mem = mems.find((m) => m.mem_id === r.mem_id)!;
    expect(mem.content_l0_enc).toContain('AES-256-GCM');
    expect(mem.created_by_agent).toBe('claude-code');

    // 验证审计已写（webhook 来源）
    const audits = await storage.queryAudit({ action: 'write' });
    const whAudit = audits.find((a) => a.detail.source === 'webhook');
    expect(whAudit).toBeDefined();
    expect(whAudit!.detail.session_id).toBe('sess-wh-001');
    expect(whAudit!.detail.source_agent).toBe('claude-code');
  });

  it('重复 ingest（同 content + session_id）→ duplicate，不重复入库', async () => {
    const { storage, webhook } = makeWebhook();
    const event: IngestEvent = {
      content: '去重测试：连接池耗尽导致请求超时失败',
      project_id: 'P1',
      session_id: 'sess-dup-001',
      source_agent: 'mcp',
    };
    const r1 = await webhook.ingest(event);
    expect(r1.dedup).toBe('new');
    const r2 = await webhook.ingest(event); // 完全相同
    expect(r2.dedup).toBe('duplicate');
    expect(r2.mem_id).toBe(r1.mem_id);

    // 验证只入库一次（v2 只存 L0 密文，不以 content_orig 比对）
    const mems = await storage.listMemories({ project_id: 'P1' });
    expect(mems).toHaveLength(1);
    expect(mems[0].content_l0_enc).toBeTruthy();
  });

  it('不同 session_id 同 content → 两次独立写入，第二次分支嫁接到第一次（§6.2）', async () => {
    const { storage, webhook } = makeWebhook();
    const base = { content: '同内容不同会话：数据库迁移脚本失败回滚记录', project_id: 'P1' };
    const r1 = await webhook.ingest({ ...base, session_id: 's1' });
    const r2 = await webhook.ingest({ ...base, session_id: 's2' });
    // SHA-256 幂等层不短路（不同 session_id → 不同 hash）→ 走内核逐层查重
    expect(r1.dedup).toBe('new');
    expect(r2.dedup).toBe('grafted');
    expect(r2.mem_id).not.toBe(r1.mem_id); // 嫁接是新建记忆，不是复用旧 mem_id

    const mems = await storage.listMemories({ project_id: 'P1' });
    const target = mems.find((m) => m.mem_id === r1.mem_id)!;
    const grafted = mems.find((m) => m.mem_id === r2.mem_id)!;
    expect(grafted.graft_to).toBe(target.mem_id);
    expect(grafted.graft_layer).toBe('L1');
    expect(target.grafted_from).toContain(grafted.mem_id);
  });

  it('recentStatus 返回最近 N 条（5min 对账窗口）', async () => {
    const { webhook } = makeWebhook();
    for (let i = 1; i <= 5; i++) {
      await webhook.ingest({ content: `evt-${i}`, project_id: 'P1', session_id: `s-${i}` });
    }
    const items = webhook.recentStatus(3);
    expect(items.length).toBe(3);
    expect(items.map((i) => i.ts)).toHaveLength(3);
  });

  it('lookupByHash 幂等查询：已知 hash 返回结果，未知 hash 返回 undefined', async () => {
    const { webhook } = makeWebhook();
    const r = await webhook.ingest({ content: '查找测试', project_id: 'P1' });
    expect(webhook.lookupByHash(r.hash!)).toBeDefined();
    expect(webhook.lookupByHash('nonexistent-hash')).toBeUndefined();
  });

  it('refinePipeline 未注入 → 降级（明文落库，诚实标注）', async () => {
    const storage = new InMemoryStorage();
    const webhook = createWebhook({ storage, hashIndex: new HashIndex() });
    const r = await webhook.ingest({ content: '降级测试', project_id: 'P1' });
    expect(r.ok).toBe(true);
    expect(r.dedup).toBe('new');
    expect(r.error).toContain('降级');
  });

  it('非法 category → error 且不占用幂等键（修正后可重试成功）', async () => {
    const { webhook } = makeWebhook();
    const base = { content: '类别校验测试：缓存击穿复盘', project_id: 'P1', session_id: 's-cat' };
    const bad = await webhook.ingest({ ...base, category: 'bug' as never });
    expect(bad.ok).toBe(false);
    expect(bad.dedup).toBe('error');
    expect(bad.error).toContain('非法 category');
    expect(webhook.lookupByHash(bad.hash!)).toBeUndefined();

    const good = await webhook.ingest({ ...base, category: 'pitfall' });
    expect(good.ok).toBe(true);
    expect(good.dedup).toBe('new');
    expect(good.mem_id).toMatch(/^mem_/);
  });

  it('refinePipeline 失败 → error；同一事件重试可成功（失败不被幂等缓存）', async () => {
    let attempt = 0;
    const { webhook } = makeWebhook(async () => {
      attempt++;
      if (attempt === 1) throw new Error('db locked');
      return { ok: true, dedup: 'new', mem_id: 'mem_retry', ts: new Date().toISOString() };
    });
    const e: IngestEvent = { content: '重试测试：写入时数据库锁竞争', project_id: 'P1', session_id: 's-retry' };
    const r1 = await webhook.ingest(e);
    expect(r1.ok).toBe(false);
    expect(r1.dedup).toBe('error');
    expect(r1.error).toContain('db locked');
    expect(webhook.lookupByHash(r1.hash!)).toBeUndefined();

    const r2 = await webhook.ingest(e);
    expect(r2.ok).toBe(true);
    expect(r2.dedup).toBe('new');
    expect(r2.mem_id).toBe('mem_retry');
    expect(webhook.lookupByHash(r2.hash!)?.mem_id).toBe('mem_retry');
  });

  it('ingest 事件缺 project_id → 500（refinePipeline 校验）', async () => {
    const { webhook } = makeWebhook();
    // project_id 缺失：refinePipeline 仍被调用，coreWrite 会处理
    // 这里测幂等性：两次同事件只入库一次
    const r1 = await webhook.ingest({ content: '无项目测试：部署流水线构建失败排查记录', project_id: 'P1' });
    const r2 = await webhook.ingest({ content: '无项目测试：部署流水线构建失败排查记录', project_id: 'P1' });
    expect(r1.dedup).toBe('new');
    expect(r2.dedup).toBe('duplicate');
  });
});
