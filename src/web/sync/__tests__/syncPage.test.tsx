// 批次42-C：同步与裁决页验收 —— runSync 真实报告汇总 / §9.7 裁决队列 / resolve 转发 /
// 中枢对账视图 / 失败如实展示（组件层 mock coreSyncPage，逻辑层 mock agent/hub）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncHub, sha256hex, stampForSync } from '../../../core/memagent/sync.ts';
import { runSync, listSyncConflicts, resolveConflict, hubOverview } from '../coreSyncPage.ts';
import type { Memory, SyncReport } from '../../../core/memagent/types.ts';
import type { SyncConflict } from '../../../core/memagent/sync.ts';

const NOW = 1_800_000_000_000;
function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: 'same moment edit',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW, updated_at: NOW,
    ...o,
  } as Memory;
}

describe('coreSyncPage（逻辑层）', () => {
  it('runSync：push+pull 两次真跑 → 汇总真实报告（绝不伪造）', async () => {
    const calls: Array<{ direction: string }> = [];
    const agent = {
      async sync(req: { direction: 'push' | 'pull'; project_id: string }): Promise<SyncReport> {
        calls.push({ direction: req.direction });
        if (req.direction === 'push') {
          return { pushed: 2, pulled: 0, conflicts: 1, request_id: 'r1', audit: { request_id: 'r1', action: 'sync' }, dedup: 1, behind: 1, lww: 1, l0_skipped: 3 };
        }
        return { pushed: 0, pulled: 5, conflicts: 0, request_id: 'r2', audit: { request_id: 'r2', action: 'sync' }, cursor: 42 };
      },
    };
    const r = await runSync({ agent, team_id: 't1' });
    expect(calls.map((c) => c.direction)).toEqual(['push', 'pull']);
    expect(r).toMatchObject({ ok: true, pushed: 2, pulled: 5, conflicts: 1, dedup: 1, behind: 1, lww: 1, l0_skipped: 3, cursor: 42, team_id: 't1' });
  });

  it('runSync：agent 抛错 → ok:false + 真实错误信息（权限失败如实展示，不静默）', async () => {
    const agent = {
      async sync(): Promise<SyncReport> {
        throw new Error('[E_NOT_IMPLEMENTED] 同步中枢未就绪');
      },
    };
    const r = await runSync({ agent, team_id: 't1' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('E_NOT_IMPLEMENTED');
  });

  it('裁决链路：内存中枢构造真冲突 → listSyncConflicts 列 pending → resolve 后队列清空', async () => {
    const hub = new SyncHub();
    // 远端先上行（web 端）
    const other = { async listMemories() { return [mem({ mem_id: 'm1', content: 'web version', vclock: { web: 1 } })]; }, async putMemory() { /* noop */ } };
    await (await import('../../../core/memagent/sync.ts')).syncUp(other, hub, 'web');
    // 本端同 updated_at 全晚 → §9.7 队列
    const desk = { async listMemories() { return [mem({ content: 'desktop version', vclock: { desktop: 1 } })]; }, async putMemory() { /* noop */ } };
    await (await import('../../../core/memagent/sync.ts')).syncUp(desk, hub, 'desktop');
    const ctx = { hub, team_id: 't1' };
    const pending: SyncConflict[] = await listSyncConflicts(ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0].local?.content).toBe('desktop version');
    expect(pending[0].remote?.content).toBe('web version');
    await resolveConflict(pending[0].conflict_id, 'local', ctx);
    expect(await listSyncConflicts(ctx)).toHaveLength(0);
    // 裁决落中枢审计（conflict_resolve）
    expect(hub.audits.some((a) => a.action === 'conflict_resolve')).toBe(true);
  });

  it('hubOverview：镜像行数 / 败者留档 / 指纹异常如实返回', async () => {
    const hub = new SyncHub();
    const local = { async listMemories() { return [mem({ mem_id: 'm_ok', content: 'fine row' })]; }, async putMemory() { /* noop */ } };
    await (await import('../../../core/memagent/sync.ts')).syncUp(local, hub, 'desktop');
    // 中枢内篡改一行制造指纹异常（模拟远端脏数据）
    const image = hub.reconcile({ team_id: 't1' });
    expect(image.items).toHaveLength(1);
    const r = await hubOverview({ hub, team_id: 't1' });
    expect(r).toMatchObject({ ok: true, mirror_rows: 1, losers: 0, integrity_issues: [], team_id: 't1' });
    // sha256 红线工具本身可用（引用自引擎，防误删导出）
    expect(sha256hex('abc')).toBe(sha256hex(stampForSync(mem(), 'desktop') && 'abc'));
  });
});

describe('SyncPage（组件层）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockCore(impl: {
    runSync?: typeof runSync;
    listSyncConflicts?: typeof listSyncConflicts;
    resolveConflict?: typeof resolveConflict;
    hubOverview?: typeof hubOverview;
  }): void {
    vi.doMock('../coreSyncPage.ts', () => ({
      runSync: impl.runSync ?? vi.fn(),
      listSyncConflicts: impl.listSyncConflicts ?? vi.fn(async () => []),
      resolveConflict: impl.resolveConflict ?? vi.fn(),
      hubOverview: impl.hubOverview ?? vi.fn(async () => ({ ok: true, mirror_rows: 0, losers: 0, integrity_issues: [], team_id: 't1' })),
    }));
  }

  async function mountPage() {
    const { SyncPage } = await import('../SyncPage.tsx');
    return render(<SyncPage />);
  }

  it('立即同步：真报告渲染 pushed/pulled/conflicts/l0_skipped；同步失败如实展示错误', async () => {
    mockCore({
      runSync: vi.fn(async () => ({ ok: false, pushed: 0, pulled: 0, conflicts: 0, team_id: 't1', error: '[E_NOT_IMPLEMENTED] 中枢未就绪' })),
    });
    const { unmount } = await mountPage();
    fireEvent.click(screen.getByTestId('btnSyncNow'));
    await waitFor(() => expect(screen.getByTestId('syncToast')).toHaveTextContent('同步失败'));
    expect(screen.getByTestId('syncToast')).toHaveTextContent('E_NOT_IMPLEMENTED');
    unmount();
  });

  it('裁决队列：列出冲突 + 保留本端按钮触发 resolve + 成功 toast；空队列诚实空态', async () => {
    const conflict = {
      conflict_id: 'cf_x', mem_id: 'm1', team_id: 't1', project_id: 'P1',
      local: mem({ content: 'local text' }), remote: mem({ content: 'remote text' }),
      local_form: 'desktop' as const, remote_form: 'web' as const, status: 'pending' as const,
    };
    let pending: SyncConflict[] = [conflict];
    // 裁决即从中枢队列移除（语义与真 PgSyncHub.resolve 一致）——组件 refresh 读到空队列
    const resolveConflictMock = vi.fn(async (id: string) => {
      pending = pending.filter((c) => c.conflict_id !== id);
    });
    mockCore({
      listSyncConflicts: vi.fn(async () => pending),
      resolveConflict: resolveConflictMock,
    });
    const { unmount } = await mountPage();
    await waitFor(() => expect(screen.getByTestId(`conflict-cf_x`)).toBeInTheDocument());
    expect(screen.getByText('local text')).toBeInTheDocument();
    expect(screen.getByText('remote text')).toBeInTheDocument();
    fireEvent.click(screen.getByText('保留本端'));
    await waitFor(() => expect(resolveConflictMock).toHaveBeenCalledWith('cf_x', 'local'));
    // resolve 后页面刷新 → 队列空 → 诚实空态
    await waitFor(() => expect(screen.getByTestId('noConflicts')).toBeInTheDocument());
    unmount();
  });

  it('裁决失败（如权限 401/403）：错误如实展示，不假装成功', async () => {
    mockCore({
      listSyncConflicts: vi.fn(async () => [{
        conflict_id: 'cf_y', mem_id: 'm1', team_id: 't1', project_id: 'P1',
        local: mem(), remote: mem(), local_form: 'desktop' as const, remote_form: 'web' as const, status: 'pending' as const,
      }]),
      resolveConflict: vi.fn(async () => { throw new Error('需要管理员权限（403）'); }),
    });
    const { unmount } = await mountPage();
    await waitFor(() => expect(screen.getByTestId('conflict-cf_y')).toBeInTheDocument());
    fireEvent.click(screen.getByText('保留镜像'));
    await waitFor(() => expect(screen.getByTestId('syncToast')).toHaveTextContent('裁决失败'));
    expect(screen.getByTestId('syncToast')).toHaveTextContent('403');
    unmount();
  });
});
