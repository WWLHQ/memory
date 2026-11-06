import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { SecurityPage } from '../SecurityPage.tsx';
import { coreLoadSecurityAudit } from '../coreSecurity.ts';
import { resetKernelForTests, setKernelL0ForTests, setKernelStorageForTests } from '../../kernel.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { InMemoryMemberStore } from '../../../core/memagent/memberStore.ts';
import { createTestVault } from '../../../core/memagent/__tests__/l0Kit.ts';
import { createServer } from '../../../home/server.ts';

// 批次7：页面按登录角色做门禁。单测不连后端，直接注入会话角色（真实校验在 home server / IPC）。
const session = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | null }));
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => (session.role ? 's_test' : null),
  useSessionContext: () => ({
    sid: session.role ? 's_test' : null,
    context: session.role ? { user_id: 'u_test', role: session.role } : null,
    role: session.role,
    loading: false,
  }),
}));

/** 真实登录态键（accountsClient 直接读 localStorage，不走上面被 mock 的 session 模块） */
const SESSION_KEY = 'session:realpage';

const ACCOUNTS = [
  { account: 'admin', role: 'admin', team_id: 'T0', enterprise_id: 'E1', perspective: 'enterprise' },
  { account: 'user_001', role: 'member', team_id: 'T1', enterprise_id: 'E1', perspective: 'team' },
];
// 时间戳与服务端一致：毫秒数字（不是 ISO 字符串）
const KEYS = [
  { key_id: 'key_aaaaaa', owner_member_id: 'm1', scope_project_ids: ['P1'], label: 'coder', created_at: Date.parse('2026-11-01T00:00:00.000Z') },
  { key_id: 'key_bbbbbb', owner_member_id: 'm1', scope_project_ids: ['P1'], label: 'old', created_at: Date.parse('2026-08-01T00:00:00.000Z'), revoked_at: Date.parse('2026-10-01T00:00:00.000Z') },
];

interface Req { url: string; method: string; sid: string | undefined; body: string | undefined }

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/**
 * 只 mock 安全页真实用到的后端端点（有状态：吊销/新建会改动返回列表）；
 * 未覆盖的请求一律失败 —— 避免「假后端全通过」掩盖页面发错请求。
 */
function mockHomeBackend(): Req[] {
  const reqs: Req[] = [];
  let keys = KEYS.map((k) => ({ ...k }));
  let policy = {
    min_len: 8, max_len: 64, upper: true, lower: true, digit: true, special: true, history_count: 5,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    reqs.push({ url, method: (init?.method ?? 'GET').toUpperCase(), sid: headers['x-session-id'], body });

    // 批次48 A10：策略读写真实后端（POST 有状态，下次 GET 返回已保存值）
    if (url.includes('/api/policy')) {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        policy = { ...policy, ...(JSON.parse(body ?? '{}') as Partial<typeof policy>) };
        return jsonResponse({ ok: true, policy });
      }
      return jsonResponse({ ok: true, policy });
    }
    if (url.includes('/api/keys/revoke')) {
      const id = (JSON.parse(body ?? '{}') as { key_id?: string }).key_id ?? '';
      const rec = keys.find((k) => k.key_id === id);
      if (!rec) return jsonResponse({ ok: false, error: '密钥不存在' }, 404);
      rec.revoked_at = Date.parse('2026-11-06T00:00:00.000Z');
      return jsonResponse({ ok: true, record: rec });
    }
    if (url.includes('/api/keys/mint')) {
      const rec = {
        key_id: 'key_new0001', owner_member_id: 'm1', scope_project_ids: ['P1'],
        label: 'coder', created_at: Date.parse('2026-11-06T00:00:00.000Z'),
      };
      keys = [rec, ...keys];
      return jsonResponse({ ok: true, key: 'sk_new_secret_once', record: rec });
    }
    if (url.includes('/api/keys')) return jsonResponse({ ok: true, items: keys });
    if (url.includes('/api/accounts')) return jsonResponse({ ok: true, items: ACCOUNTS });
    if (url.includes('/api/mirror/audit')) return jsonResponse({ ok: true });
    if (url.includes('/api/me')) {
      return jsonResponse({ context: { user_id: 'admin', role: 'admin', team_id: 'T0', enterprise_id: 'E1', perspective: 'enterprise' } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return reqs;
}

describe('SecurityPage (P12-T4 编排)', () => {
  beforeEach(() => {
    resetKernelForTests(); // 账本从真空态起算（无种子）
    // 批次28-A：mock 会话会让账本走 HTTP 数据面，单测仍用内存账本
    setKernelStorageForTests(new InMemoryStorage());
    session.role = 'admin';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
  });

  it('挂载渲染五区块；账号/密钥表格读真实后端返回', async () => {
    localStorage.setItem(SESSION_KEY, 's_test');
    mockHomeBackend();
    render(<SecurityPage />);
    expect(screen.getByTestId('security-page')).toBeInTheDocument();
    expect(screen.getByTestId('pwd-policy')).toBeInTheDocument();
    expect(screen.getByTestId('encrypt-card')).toHaveTextContent('TLS');
    expect(screen.getByTestId('role-matrix')).toBeInTheDocument();
    expect(screen.getByTestId('member-table')).toBeInTheDocument();
    expect(screen.getByTestId('key-table')).toBeInTheDocument();
    // 批次24：遗留账本清理卡挂在安全页（浏览器环境如实不可用）
    expect(screen.getByTestId('legacy-card')).toBeInTheDocument();
    expect(screen.getByTestId('legacy-unavailable')).toBeInTheDocument();

    // 真实返回的账号行（不再有前端 useState 假行）
    await waitFor(() => expect(screen.getByTestId('member-admin')).toBeInTheDocument());
    expect(screen.getByTestId('member-user_001')).toBeInTheDocument();
    expect(screen.getByTestId('member-table').querySelectorAll('tbody tr')).toHaveLength(2);
    // 真实返回的密钥行；已吊销的 key_bbbbbb 不再显示轮换/吊销按钮
    expect(screen.getByTestId('key-key_aaaaaa')).toBeInTheDocument();
    // 服务端毫秒时间戳 → 页面按日期展示（不是把数字当字符串）
    expect(within(screen.getByTestId('key-key_aaaaaa')).getByText('2026-11-01')).toBeInTheDocument();
    expect(within(screen.getByTestId('key-key_bbbbbb')).getByText('已吊销')).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-key_bbbbbb')).toBeNull();
    expect(screen.queryByTestId('member-source-error')).toBeNull();
    expect(screen.queryByTestId('key-source-error')).toBeNull();
  });

  it('jsdom 为 http：TLS 徽标如实显示未启用（不假报加密）', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('encrypt-card')).toHaveTextContent('TLS 未启用');
    expect(screen.getByTestId('encrypt-card')).not.toHaveTextContent('TLS 开');
  });

  it('后端不可达：如实报错（空表 + 来源错误提示），不显示演示行', async () => {
    localStorage.setItem(SESSION_KEY, 's_test');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    render(<SecurityPage />);
    await waitFor(() => expect(screen.getByTestId('member-source-error')).toBeInTheDocument());
    expect(screen.getByTestId('member-source-error')).toHaveTextContent('登录后端不可达');
    expect(screen.getByTestId('key-source-error')).toHaveTextContent('登录后端不可达');
    expect(screen.getByTestId('member-table').querySelectorAll('tbody tr')).toHaveLength(0);
    expect(screen.getByTestId('key-table').querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('吊销：真实 POST /api/keys/revoke（带会话）→ 刷新列表 → 写内核审计', async () => {
    localStorage.setItem(SESSION_KEY, 's_test');
    const reqs = mockHomeBackend();
    render(<SecurityPage />);
    await waitFor(() => expect(screen.getByTestId('revoke-key_aaaaaa')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('revoke-key_aaaaaa'));

    await waitFor(() => expect(within(screen.getByTestId('key-key_aaaaaa')).getByText('已吊销')).toBeInTheDocument());
    const revokeReq = reqs.find((r) => r.url.includes('/api/keys/revoke'));
    expect(revokeReq).toBeTruthy();
    expect(revokeReq!.method).toBe('POST');
    expect(revokeReq!.sid).toBe('s_test'); // 真实会话头，不再允许匿名写
    expect(JSON.parse(revokeReq!.body ?? '{}')).toEqual({ key_id: 'key_aaaaaa' });
    expect(screen.queryByTestId('revoke-key_aaaaaa')).toBeNull();

    await waitFor(async () => {
      const log = await coreLoadSecurityAudit();
      expect(log.some((l) => l.op === 'security_change')).toBe(true);
    });
  });

  it('轮换：先 mint 新钥再吊销旧钥（两次真实 POST），明文只提示一次', async () => {
    localStorage.setItem(SESSION_KEY, 's_test');
    const reqs = mockHomeBackend();
    render(<SecurityPage />);
    await waitFor(() => expect(screen.getByTestId('rotate-key_aaaaaa')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('rotate-key_aaaaaa'));

    await waitFor(() => expect(screen.getByTestId('key-key_new0001')).toBeInTheDocument());
    const mintIdx = reqs.findIndex((r) => r.url.includes('/api/keys/mint'));
    const revokeIdx = reqs.findIndex((r) => r.url.includes('/api/keys/revoke'));
    expect(mintIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeGreaterThan(mintIdx); // 先建后吊销
    expect(reqs[mintIdx].method).toBe('POST');
    expect(reqs[mintIdx].sid).toBe('s_test');
    expect(JSON.parse(reqs[mintIdx].body ?? '{}')).toEqual({
      owner_member_id: 'm1', scope_project_ids: ['P1'], label: 'coder',
    });
    expect(within(screen.getByTestId('key-key_aaaaaa')).getByText('已吊销')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('sk_new_secret_once'));
  });

  it('真实 home server 联调：admin 登录 → 页面读到真实密钥；吊销后服务端状态真实变化', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mam-sec-'));
    const memberStore = new InMemoryMemberStore();
    memberStore.createMember({
      member_id: 'm1', name: 'M1', role: 'member', user_id: 'u1',
      team_id: 'T1', enterprise_id: 'E1', created_by: 'admin',
    });
    const server = createServer({ port: 0, dataFile: join(dir, 'audit.json'), memberStore });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      // 真实登录（内置管理员种子账号）
      const loginRes = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'admin', password: 'Admin@123456', form: 'desktop' }),
      });
      expect(loginRes.status).toBe(200);
      const { sessionId } = (await loginRes.json()) as { sessionId: string };

      // 真实签一把钥，让页面有真实数据可读（mint 要求 owner 为 active 成员）
      const mintRes = await fetch(`${base}/api/keys/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ owner_member_id: 'm1', scope_project_ids: ['P1'], label: 'real' }),
      });
      expect(mintRes.status).toBe(200);
      const { record } = (await mintRes.json()) as { record: { key_id: string; created_at: number } };

      // 页面请求指向这台真实服务（?backend= 只允许 http 回环）
      history.replaceState({}, '', `/?backend=${encodeURIComponent(base)}`);
      localStorage.setItem(SESSION_KEY, sessionId);

      render(<SecurityPage />);
      await waitFor(() => expect(screen.getByTestId(`key-${record.key_id}`)).toBeInTheDocument());
      // 服务端毫秒时间戳被正确渲染成日期（此前当字符串 .slice() 会崩）
      const expectedDay = new Date(record.created_at).toISOString().slice(0, 10);
      expect(within(screen.getByTestId(`key-${record.key_id}`)).getByText(expectedDay)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId(`revoke-${record.key_id}`));
      await waitFor(() =>
        expect(within(screen.getByTestId(`key-${record.key_id}`)).getByText('已吊销')).toBeInTheDocument());

      // 服务端真实状态也已变更（不是只改了前端 state）
      const after = await fetch(`${base}/api/keys`, { headers: { 'x-session-id': sessionId } });
      const body = (await after.json()) as { items: { key_id: string; revoked_at?: number }[] };
      const rec2 = body.items.find((k) => k.key_id === record.key_id);
      expect(typeof rec2?.revoked_at).toBe('number');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('示例密码实时校验：禁用词拦截 + 合规通过', () => {
    render(<SecurityPage />);
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'MyPassword1!' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent('含禁用词');
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'Abc' } });
    expect(screen.getByTestId('pwd-err')).toHaveTextContent(/长度/);
    fireEvent.change(screen.getByTestId('pwd-sample'), { target: { value: 'N3w^Secret9' } });
    expect(screen.getByTestId('pwd-ok')).toHaveTextContent('通过');
  });

  it('策略变更真写内核审计账本（security_change）+ toast 带真实 request_id', async () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('pwd-special'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
    const log = await coreLoadSecurityAudit();
    expect(log).toHaveLength(1);
    expect(log[0].op).toBe('security_change');
  });

  it('策略卡如实标注：已保存到后端并对注册/改密生效，历史查重未接入', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('pwd-policy-scope')).toHaveTextContent('已保存到本机登录后端');
    expect(screen.getByTestId('pwd-policy-scope')).toHaveTextContent('历史密码查重');
  });

  it('多次安全操作逐条落账（append-only，不复写）', async () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('pwd-upper'));
    fireEvent.click(screen.getByTestId('pwd-digit'));
    await waitFor(async () => {
      const log = await coreLoadSecurityAudit();
      expect(log).toHaveLength(2);
    });
  });

  it('普通成员/未登录：策略只读（控件禁用）、不拉账号/密钥、不落账', async () => {
    session.role = 'member';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SecurityPage />);
    expect(screen.getByTestId('pwd-policy-admin-required')).toBeInTheDocument();
    expect(screen.getByTestId('pwd-policy-controls')).toBeDisabled();
    expect(screen.getByTestId('member-source-error')).toHaveTextContent('需管理员权限');
    expect(screen.getByTestId('key-source-error')).toHaveTextContent('需管理员权限');
    // 成员不拉账号/密钥；仅允许读策略（只读展示也不该用前端默认值冒充后端值）
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/accounts') || u.includes('/api/keys'))).toBe(false);
    expect(urls.every((u) => u.includes('/api/policy'))).toBe(true);

    fireEvent.click(screen.getByTestId('pwd-special'));
    expect(await coreLoadSecurityAudit()).toHaveLength(0);
  });

  it('L0 管理（管理员）：首次设置管理密码 → 写密钥解锁 → 发放一次性授权', async () => {
    const { vault } = await createTestVault({ setup: false });
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
    render(<SecurityPage />);

    await waitFor(() => expect(screen.getByTestId('l0-setup')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('l0-setup-pw'), { target: { value: 'adminpass-9' } });
    fireEvent.change(screen.getByTestId('l0-setup-pw2'), { target: { value: 'adminpass-9' } });
    fireEvent.click(screen.getByTestId('l0-setup-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-status-has')).toHaveTextContent('已设置'));
    expect(screen.getByTestId('l0-status-write')).toHaveTextContent('已解锁');

    fireEvent.change(screen.getByTestId('l0-grantee'), { target: { value: 'u_reader' } });
    fireEvent.change(screen.getByTestId('l0-scope'), { target: { value: 'P1, P2' } });
    fireEvent.click(screen.getByTestId('l0-grant-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-issued')).toBeInTheDocument());
    expect(screen.getByTestId('l0-issued-pw').textContent).toMatch(/[0-9a-f]{16,}/);
    expect(screen.getByTestId('l0-grant-table').querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByTestId('l0-status-grants')).toHaveTextContent('有效授权 1');
  });

  it('L0 管理（非管理员）：仅只读提示，不展示管理表单', () => {
    session.role = 'member';
    render(<SecurityPage />);
    expect(screen.getByTestId('l0-admin-required')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-setup')).toBeNull();
    expect(screen.queryByTestId('l0-write')).toBeNull();
  });

  it('批次37-E：按 L0 重建卡挂在安全页，浏览器环境如实不可用（数据面在主进程）', () => {
    render(<SecurityPage />);
    expect(screen.getByTestId('l0-rebuild-card')).toBeInTheDocument();
    expect(screen.getByTestId('l0-rebuild-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-rebuild-run')).toBeNull();
  });

  it('批次38：旧数据迁移从 L0 管理卡拆出为独立卡片（管理卡里不再内嵌）', () => {
    render(<SecurityPage />);
    const migrate = screen.getByTestId('l0-migrate-card');
    expect(migrate.classList.contains('card')).toBe(true);
    expect(within(migrate).getByTestId('l0-migrate-form')).toBeInTheDocument();
    const admin = screen.getByTestId('l0-admin-card');
    expect(within(admin).queryByTestId('l0-migrate-form')).toBeNull();
  });
});
