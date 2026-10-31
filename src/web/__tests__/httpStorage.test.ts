// 批次28-A：浏览器内核数据面（HttpStorageBackend）——fetch mock 三态契约：
// 正常回执解包 result；ok:false 抛服务端文案；401/501/不可达抛 KernelUnavailableError。
import { describe, expect, it, vi } from 'vitest';
import { HttpStorageBackend, KernelUnavailableError, fetchKernelInfo } from '../httpStorage.ts';

function backend(responses: Array<{ status?: number; body?: unknown; fail?: Error }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r.fail) throw r.fail;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const store = new HttpStorageBackend({
    baseUrl: 'http://127.0.0.1:8201',
    sessionId: () => 'sess_t1',
    fetchImpl,
  });
  return { store, calls };
}

describe('HttpStorageBackend invoke 契约', () => {
  it('ok:true → 解包 result；请求带 x-session-id 与白名单方法', async () => {
    const { store, calls } = backend([{ body: { ok: true, result: [{ mem_id: 'm1' }] } }]);
    const rows = await store.listMemories({});
    expect(rows.map((m) => m.mem_id)).toEqual(['m1']);
    expect(calls[0].url).toBe('http://127.0.0.1:8201/api/kernel/invoke');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-session-id']).toBe('sess_t1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ method: 'listMemories', args: [{}] });
  });

  it('ok:false → 抛服务端原样文案（如只读镜像的 E_STORAGE_LOCKED 提示）', async () => {
    const { store } = backend([{ body: { ok: false, error: '记忆库正被其它进程写入（桌面端运行中），当前为只读镜像；写入请用桌面端或 MCP。' } }]);
    await expect(store.putMemory({} as never)).rejects.toThrow(/只读镜像/);
  });

  it('401 → 未登录；501 → kernel_unavailable；fetch 失败 → 后端不可达', async () => {
    const noAuth = backend([{ status: 401, body: { ok: false, reason: 'no_session' } }]);
    await expect(noAuth.store.getMemory('m1')).rejects.toThrow(KernelUnavailableError);
    await expect(noAuth.store.getMemory('m1')).rejects.toThrow(/登录会话已失效/);

    const noKernel = backend([{ status: 501, body: { ok: false, reason: 'kernel_unavailable' } }]);
    await expect(noKernel.store.getMemory('m1')).rejects.toThrow(/kernel_unavailable/);

    const down = backend([{ fail: new Error('ECONNREFUSED') }]);
    await expect(down.store.getMemory('m1')).rejects.toThrow(/不可达/);
  });

  it('无会话 → 本地先拒绝，不打请求', async () => {
    const store = new HttpStorageBackend({ baseUrl: 'http://127.0.0.1:8201', sessionId: () => null });
    await expect(store.queryAudit({})).rejects.toThrow(/尚未登录/);
  });
});

describe('fetchKernelInfo', () => {
  it('available=true 回执透传；不可用/失败返回 null', async () => {
    const okFetch = (async () => new Response(JSON.stringify({ available: true, readonly: true, db_path: 'D:/x/memories.db.json' }), { status: 200 })) as unknown as typeof fetch;
    const info = await fetchKernelInfo('http://127.0.0.1:8201', okFetch, 'sess_t1');
    expect(info?.readonly).toBe(true);
    expect(info?.db_path).toContain('memories.db.json');

    const notAvailable = (async () => new Response(JSON.stringify({ available: false, readonly: false, db_path: null }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchKernelInfo('http://127.0.0.1:8201', notAvailable, 'sess_t1')).toBeNull();

    const downFetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await fetchKernelInfo('http://127.0.0.1:8201', downFetch, 'sess_t1')).toBeNull();
  });
});
