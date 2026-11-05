// 阶段5-C：mirror 真接口径 + 失败可见的契约与变异杀手。
// ① 服务端端点真实存在；② HTTP 非 2xx / 网络错误都记录为可见失败；③ 全局提示条只在真实页面创建 DOM；
// ④ 7 个 useXxxMirror 与页面文案不再自称无端点/空操作。
// 源码断言走 resolve(process.cwd(), ...) 字符串路径（node-brokered-fs-shim 不接受 file: URL）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mirrorBackendUrl, mirrorReport, mirrorFetch, getLastMirrorFailure,
  resetMirrorFailures, subscribeMirrorFailure, MIRROR_FAILURE_EVENT,
} from '../../mirrorClient.ts';
import { installMirrorFailureNotice, resetMirrorFailureNoticeForTests } from '../mirrorFailureNotice.ts';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const setBackend = (search: string) => window.history.replaceState({}, '', `/${search}`);
const emitFailure = (reason = 'HTTP 503') => window.dispatchEvent(new CustomEvent(MIRROR_FAILURE_EVENT, {
  detail: { source: 'write', action: 'save', reason, at: Date.now() },
}));

let fetchSpy: ReturnType<typeof vi.fn>;

describe('阶段5-C · mirror 真接 + 失败可见', () => {
  beforeEach(() => {
    setBackend('');
    sessionStorage.clear();
    resetMirrorFailures();
    resetMirrorFailureNoticeForTests();
    document.body.innerHTML = '';
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMirrorFailureNoticeForTests();
    document.body.innerHTML = '';
    setBackend('');
  });

  it('① 未显式关闭后端时基址是回环地址（真会尝试上抛，不是空操作）', () => {
    expect(mirrorBackendUrl()).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/);
  });

  it('② ?backend= 显式关闭 → 不 fetch、不记失败（未尝试不算失败）', () => {
    setBackend('?backend=');
    mirrorReport('write', 'x');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getLastMirrorFailure()).toBeNull();
  });

  it('③ HTTP 503 → 订阅者收到可见失败（旧实现只吞网络错误，会当成功）', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 });
    const seen: string[] = [];
    const off = subscribeMirrorFailure((f) => seen.push(`${f.source}/${f.action}/${f.reason}`));
    mirrorReport('write', 'write_dedup', 'r1');
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBe('write/write_dedup/HTTP 503');
    expect(getLastMirrorFailure()?.reason).toBe('HTTP 503');
    off();
  });

  it('④ 网络拒绝 → 记录失败原因，且不抛错中断调用方', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const seen: string[] = [];
    subscribeMirrorFailure((f) => seen.push(f.reason));
    expect(() => mirrorReport('memory', 'pin')).not.toThrow();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toContain('ECONNREFUSED');
  });

  it('⑤ fetch 同步抛错 → 同样记录失败', () => {
    fetchSpy.mockImplementationOnce(() => { throw new Error('blocked'); });
    const seen: string[] = [];
    subscribeMirrorFailure((f) => seen.push(f.reason));
    expect(() => mirrorReport('security', 'change')).not.toThrow();
    expect(seen).toContain('blocked');
  });

  it('⑥ HTTP 200 → 不记录失败（不把成功当失败）', async () => {
    mirrorReport('params', 'params_save');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(getLastMirrorFailure()).toBeNull();
  });

  it('⑦ mirrorFetch HTTP 500 → 返回空且记录失败（不把「连不上」冒充「查无」）', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await mirrorFetch('audit')).toEqual({ items: [], total: 0 });
    expect(getLastMirrorFailure()?.reason).toBe('HTTP 500');
  });

  it('⑧ mirrorFetch 成功 → 返回真实账本数据，无失败记录', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ seq: 1 }], total: 1 }) });
    expect(await mirrorFetch('audit')).toEqual({ items: [{ seq: 1 }], total: 1 });
    expect(getLastMirrorFailure()).toBeNull();
  });

  it('⑨ 取消订阅生效；⑩ resetMirrorFailures 清空最近失败', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 502 });
    const a: string[] = [];
    const b: string[] = [];
    const offA = subscribeMirrorFailure((f) => a.push(f.reason));
    subscribeMirrorFailure((f) => b.push(f.reason));
    offA();
    mirrorReport('dispute', 'resolve');
    await vi.waitFor(() => expect(b).toHaveLength(1));
    expect(a).toHaveLength(0);
    expect(getLastMirrorFailure()).not.toBeNull();
    resetMirrorFailures();
    expect(getLastMirrorFailure()).toBeNull();
  });

  it('⑪ 真实页面（#root 存在）收到失败事件 → 显示不拦截交互的提示条，可关闭', () => {
    document.body.innerHTML = '<div id="root"></div>';
    installMirrorFailureNotice();
    emitFailure();
    const el = document.querySelector('[data-testid="mirror-failure-notice"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('HTTP 503');
    expect(el?.textContent).toContain('本地数据未受影响');
    expect(el?.style.pointerEvents).toBe('none');
    (document.querySelector('[data-testid="mirror-failure-dismiss"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mirror-failure-notice"]')).toBeNull();
  });

  it('⑫ 单测/无 #root 环境 → 不创建 DOM，不污染文档', () => {
    document.body.innerHTML = '';
    installMirrorFailureNotice();
    emitFailure();
    expect(document.querySelector('[data-testid="mirror-failure-notice"]')).toBeNull();
  });

  it('⑬ 源码声明：8 个 mirror hook + 页面文案 + 客户端不再自称无端点/空操作', () => {
    const files = [
      'src/web/mirrorClient.ts',
      'src/web/audit/useAuditMirror.ts',
      'src/web/write/useWriteMirror.ts',
      'src/web/memory/useMemoryMirror.ts',
      'src/web/feedback/useFeedbackMirror.ts',
      'src/web/dispute/useDisputeMirror.ts',
      'src/web/lifecycle/useLifecycleMirror.ts',
      'src/web/params/useParamsMirror.ts',
      'src/web/security/useSecurityMirror.ts',
      'src/web/audit/AuditPage.tsx',
      'src/web/write/WritePage.tsx',
      'src/web/memory/MemoryPage.tsx',
      'src/web/feedback/FeedbackPage.tsx',
      'src/web/dispute/DisputePage.tsx',
      'src/web/lifecycle/LifecyclePage.tsx',
      'src/web/Home/coreHome.ts',
      'src/web/shared/actionLog.ts',
    ];
    for (const p of files) {
      const s = src(p);
      expect(s, p).not.toMatch(/safe-noop/);
      expect(s, p).not.toMatch(/暂无 .* 端点/);
      expect(s, p).not.toMatch(/预留：/);
      expect(s, p).not.toMatch(/失败静默/);
    }
    for (const p of files.slice(1, 9)) {
      expect(src(p), p).toContain('/api/mirror/audit');
    }
  });

  it('⑭ 源码声明：mirrorClient 真查 HTTP 状态、派发事件、写运行日志', () => {
    const s = src('src/web/mirrorClient.ts');
    expect(s).toContain('if (!res.ok) recordFailure');
    expect(s).toContain('MIRROR_FAILURE_EVENT');
    expect(s).toContain("uiLog('mirror', 'report_failed'");
    expect(s).toContain('/api/mirror/audit');
  });

  it('⑮ 源码声明：actionLog 安装全局提示条，提示条只在真实页面建 DOM', () => {
    expect(src('src/web/shared/actionLog.ts')).toContain('installMirrorFailureNotice()');
    const s = src('src/web/shared/mirrorFailureNotice.ts');
    expect(s).toContain("getElementById('root')");
    expect(s).toContain("pointerEvents: 'none'");
    expect(src('src/web/shared/mirrorFailureEvent.ts')).toContain("export const MIRROR_FAILURE_EVENT");
  });

  it('⑯ 服务端事实：home server 真的实现并持久化 POST/GET /api/mirror/audit', () => {
    const s = src('src/home/server.ts');
    expect(s).toContain("path === '/api/mirror/audit'");
    expect(s).toContain("req.method === 'POST'");
    expect(s).toContain("req.method === 'GET'");
    expect(s).toContain('persistMirror()');
  });
});
