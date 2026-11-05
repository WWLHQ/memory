// 阶段5-D 诚实边界契约（变异杀手）：A13/A14「接真登录态」。
// ① A14：localStorage 里只有 sessionId，不是租户身份；身份只认 /api/me 的真实 context，
//    恢复失败/非 2xx/无 session/显式关后端一律保持 null，绝不造 'restored-user' 占位。
// ② A13：内联标识演示页不再跳过登录门控，不再硬编码 project=P1 / user=U1；
//    未登录显示真门禁且不挂载数据层，已登录只显示 /api/me 的真实租户标识。
// ③ 关账文档必须如实记录 5-D，不得回退成「演示占位/跳过门控」口径。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TenantProvider, useTenant, useTenantRestoring } from '../../Home/tenantContext.tsx';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const TENANT = 'src/web/Home/tenantContext.tsx';
const DEMO = 'src/web/InlineAttribution/AgentConversationDemo.tsx';
const HOME = 'src/web/Home/HomePage.tsx';
const REPORT = 'specs/MANUAL-TEST-FIX-BATCH-42.md';
const BASELINE = 'specs/demo-data-baseline.md';

const REAL_CTX = {
  enterprise_id: 'ent_real', team_id: 'team_real', user_id: 'user_real',
  perspective: 'team', session_id: 'sess_real_123',
};

function wrap(children: ReactNode) {
  return (
    <TenantProvider backendUrl="http://localhost:8201">{children}</TenantProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem('session:realpage');
});

describe('5-D / A14 租户上下文：未登录就是未登录', () => {
  it('源码不再出现 restored-user / local-readonly / 占位 context 构造', () => {
    const s = src(TENANT);
    expect(s).not.toContain('restored-user');
    expect(s).not.toContain('local-readonly');
    expect(s).not.toContain("enterprise_id: 'local'");
    expect(s).not.toContain('生成一个占位 context');
    expect(s).not.toContain('保持占位上下文');
  });

  it('初始 context 恒为 null，不凭 sid 造身份；restoring 只由 sid 决定', () => {
    const s = src(TENANT);
    expect(s).toContain('useState<TenantContext | null>(null)');
    expect(s).toContain('useState<boolean>(() => !!getSessionId())');
    expect(s).toContain('未登录就是未登录');
  });

  it('只认 /api/me 的 2xx + context 真响应，网络错误不伪造', () => {
    const s = src(TENANT);
    expect(s).toContain('res.ok ? await res.json() : null');
    expect(s).toContain('data?.context');
    expect(s).toContain('只认后端返回的真实 context');
  });

  it('显式关闭后端（空 base）不发起请求、不伪造身份，直接结束确认', () => {
    const s = src(TENANT);
    expect(s).toContain('if (!sid || !base) { setRestoring(false); return; }');
  });

  it('暴露 useTenantRestoring，供 UI 区分「确认中」与「未登录」', () => {
    expect(src(TENANT)).toContain('export function useTenantRestoring(): boolean');
    expect(src(DEMO)).toContain('useTenantRestoring()');
  });

  it('运行时：无 session → null + restoring=false，且零 /api/me 请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(
      () => ({ t: useTenant(), restoring: useTenantRestoring() }),
      { wrapper: ({ children }) => wrap(children) },
    );
    expect(result.current.t).toBeNull();
    expect(result.current.restoring).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('运行时：/api/me 非 2xx → 保持未登录，不回落占位身份', async () => {
    localStorage.setItem('session:realpage', 'sess_bad');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const { result } = renderHook(
      () => ({ t: useTenant(), restoring: useTenantRestoring() }),
      { wrapper: ({ children }) => wrap(children) },
    );
    expect(result.current.t).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current.t).toBeNull();
    expect(result.current.restoring).toBe(false);
  });

  it('运行时：/api/me 真响应 → 真实租户，确认态结束', async () => {
    localStorage.setItem('session:realpage', REAL_CTX.session_id);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ context: REAL_CTX }),
    })));
    const { result } = renderHook(
      () => ({ t: useTenant(), restoring: useTenantRestoring() }),
      { wrapper: ({ children }) => wrap(children) },
    );
    expect(result.current.restoring).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current.t?.user_id).toBe('user_real');
    expect(result.current.restoring).toBe(false);
  });
});

describe('5-D / A13 内联标识演示页：接真登录门控', () => {
  it('源码不再出现 project=P1 / U1 回落 / 演示占位 / 跳过门控', () => {
    const s = src(DEMO);
    expect(s).not.toContain('project=P1');
    expect(s).not.toContain("?? 'U1'");
    expect(s).not.toContain('（演示占位）');
    expect(s).not.toContain('显式跳过门控');
    expect(s).not.toContain('不要求登录');
  });

  it('挂载 InlineGate：确认中 / 未登录 / 已登录三态分流，未登录不挂数据层', () => {
    const s = src(DEMO);
    expect(s).toContain('<InlineGate />');
    expect(s).toContain('function InlineGate()');
    expect(s).toContain('if (!ctx) return <InlineLoginGate />;');
    expect(s).toContain('return <InlineInner ctx={ctx} />;');
    expect(s).toContain('inline-tenant-restoring');
    expect(s).toContain('inline-login-gate');
  });

  it('门禁是真跳登录页的按钮，且明写不渲染账本数据/身份占位', () => {
    const s = src(DEMO);
    expect(s).toContain('inline-goto-login');
    expect(s).toContain("window.location.href = '/index.html'");
    expect(s).toContain('不渲染账本数据');
  });

  it('user 标识直接取真实 ctx.user_id，无兜底假值', () => {
    const s = src(DEMO);
    expect(s).toContain('function InlineInner({ ctx }: { ctx: TenantContext })');
    expect(s).toContain('const userId = ctx.user_id;');
  });

  it('头部只显示真实租户字段（enterprise_id / team_id），带 inline-tenant 测试锚点', () => {
    const s = src(DEMO);
    expect(s).toContain('data-testid="inline-tenant"');
    expect(s).toContain('ctx.enterprise_id');
    expect(s).toContain('ctx.team_id');
  });

  it('头注释写明「不再跳过登录门控」「不显示身份占位」', () => {
    const s = src(DEMO);
    expect(s).toContain('本页不再跳过登录门控');
    expect(s).toContain('不显示身份占位');
    expect(s).toContain('阶段5-D / A13·接真登录态');
  });

  it('HomePage 注释不再把内联标识演示页举为「跳过门控」的例子', () => {
    expect(src(HOME)).not.toContain('false 时跳过门控（如内联标识演示页）');
    expect(src(HOME)).toContain('阶段5-D：内联标识演示页已改为接真登录态');
  });

  it('全仓生产代码 restored-user 零命中（排除 __tests__）', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(resolve(process.cwd(), 'src/web'));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('restored-user'));
    expect(hits).toEqual([]);
  });

  it('e2e 真登录 homeBackend + 未登录门禁用例齐备', () => {
    const s = src('e2e/inlineAttribution.spec.ts');
    expect(s).toContain('startHomeBackend');
    expect(s).toContain('seedRealSession');
    expect(s).toContain('inline-login-gate');
    expect(s).not.toContain('project=P1 · user=');
  });
});

describe('5-D / 关账文档', () => {
  it('关账报告有独立 5-D 小节，记录 A13/A14 与接真登录态口径', () => {
    const s = src(REPORT);
    expect(s).toContain('### 5-D');
    expect(s).toContain('A13');
    expect(s).toContain('A14');
    expect(s).toContain('接真登录态');
  });

  it('baseline 记录 A13/A14 已清除，且 A 类不再剩余', () => {
    const s = src(BASELINE);
    expect(s).toContain('阶段5-D');
    expect(s).toContain('A13');
    expect(s).toContain('A14');
    expect(s).not.toContain('A 类剩 A13 / A14');
  });
});
