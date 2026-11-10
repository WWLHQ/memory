// 个人记忆常驻面板（N8 回退改良版）组件契约：
// - 界面回到原「左已确认 / 右收件箱」双窗，与记忆库全页共用同一个 PersonalMemoryPane（narrow 模式）；
// - 「快速记一条 + 记一条」置顶通栏（由 Pane 提供，两处同时生效）；
// - 壳层额外提供 Agent 记忆归并区：读取会话时自动拉取 + agent 主动投递 + 手动拉取兜底；
// - 一次点击完成分流：是我的 → 私人池（import + confirm）；不是我的 → 进共享（reject_from_agent）；
// - 人机交互：Esc 收起；导入成功但确认失败时如实说明，绝不谎报已归入私人池。
// 数据面全部 mock（本用例只验证组件契约与分流调用，真实落账由 personal.test.ts / E2E 覆盖）。
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadPersonalSnapshot: vi.fn(),
  importPersonalFromAgent: vi.fn(),
  rejectPersonalFromAgent: vi.fn(),
  splitAgentIngest: vi.fn(),
  getPersonalPort: vi.fn(),
  invoke: vi.fn(),
  paneProps: [] as Record<string, unknown>[],
}));

vi.mock('../../shared/personalPort.ts', () => ({
  getPersonalPort: h.getPersonalPort,
  importPersonalFromAgent: h.importPersonalFromAgent,
  rejectPersonalFromAgent: h.rejectPersonalFromAgent,
  loadPersonalSnapshot: h.loadPersonalSnapshot,
  quickAddPersonal: vi.fn(),
  confirmPersonal: vi.fn(),
  rejectPersonal: vi.fn(),
  revokePersonal: vi.fn(),
  removePersonal: vi.fn(),
  pushPersonalToTeam: vi.fn(),
  retryPersonalSync: vi.fn(),
}));

vi.mock('../../memory/coreMemoryOps.ts', () => ({
  splitAgentIngest: h.splitAgentIngest,
}));

// 双窗 Pane 由独立测试 / E2E 覆盖；这里只记录 props，验证「共用同一组件 + narrow」契约
vi.mock('../../memory/PersonalMemoryPane.tsx', () => ({
  PersonalMemoryPane: (props: Record<string, unknown>) => {
    h.paneProps.push(props);
    return (
      <div data-testid="mm-personal-pane">
        <div data-testid="pm-quick-top"><textarea data-testid="pm-quick-input" /></div>
        <div data-testid="pm-confirmed" />
        <div data-testid="pm-inbox" />
      </div>
    );
  },
}));

import { PersonalMemoryPanel } from '../PersonalMemoryPanel.tsx';
import type { PersonalEntry } from '../../../core/memagent/personalStore.ts';
import type { PersonalSnapshot } from '../../../core/memagent/personal.ts';

function entry(fields: Partial<PersonalEntry> & Pick<PersonalEntry, 'id' | 'content'>): PersonalEntry {
  return {
    state: 'pending',
    owner: 'u1', source: 'agent', source_agent: 'cursor', origin_ref_id: null,
    delivered_at: Date.parse('2026-11-09T05:00:00Z'), confirmed_at: null, rejected_at: null,
    layer: 'L1', content_hash: 'aaaaaaaabbbbbbbb', sha256: 'x'.repeat(64), vclock: { web: 1 },
    sync_state: 'local', sync_error: null, sync_result: null, team_shared: false, team_id: null,
    version: 1, deleted: false, deleted_at: null,
    ...fields,
  };
}

function snapshot(over: Partial<PersonalSnapshot> = {}): PersonalSnapshot {
  return {
    owner: 'u1',
    owner_binding: { owner: 'u1', login_account: 'u1', kernel_user_id: 'u1', bound: true, via: 'same_name' },
    confirmed: [], pending: [], rejected: [], sync_queue: [],
    counts: {
      confirmed: 0, pending: 0, pending_agent: 0, pending_quick: 0, rejected: 0,
      pending_sync: 0, sync_failed: 0, synced: 0, team_shared: 0,
    },
    ...over,
  };
}

const LEDGER = {
  id: 'mem_agent_1', content: '项目部署约定：蓝绿发布 + 旧槽回滚',
  sourceAgent: 'cursor', createdAt: '2026-11-09T05:00:00.000Z', layer: 'L1', type: 'fact' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.paneProps.length = 0;
  h.getPersonalPort.mockReturnValue({ channel: 'host', invoke: h.invoke });
  h.invoke.mockResolvedValue({ request_id: 'r_confirm' });
  h.splitAgentIngest.mockResolvedValue({ sessionInfoCount: 12, candidates: [LEDGER] });
  h.loadPersonalSnapshot.mockResolvedValue(snapshot());
  h.importPersonalFromAgent.mockResolvedValue({
    request_id: 'r_import', ok: true, action: 'import_from_agent',
    entry: entry({ id: 'pm_imported', content: LEDGER.content }),
  });
  h.rejectPersonalFromAgent.mockResolvedValue({
    request_id: 'r_reject', ok: true, action: 'reject_from_agent',
    entry: entry({ id: 'pm_rejected', content: LEDGER.content }),
  });
});

async function renderPanel(onClose = vi.fn()) {
  const r = render(<PersonalMemoryPanel open onClose={onClose} />);
  // 归并区可能是列表或空态，两者都表示「已读取完成」
  await screen.findByTestId('pm-ingest-count');
  await waitFor(() => expect(screen.getByTestId('pm-ingest-refresh')).not.toBeDisabled());
  return { ...r, onClose };
}

describe('个人记忆常驻面板：回退原双窗界面', () => {
  it('内嵌与全页共用的原双窗 Pane（narrow），快速记一条置顶通栏', async () => {
    await renderPanel();
    expect(screen.getByTestId('personal-memory-panel')).toBeTruthy();
    expect(screen.getByTestId('mm-personal-pane')).toBeTruthy();
    expect(screen.getByTestId('pm-quick-top')).toBeTruthy();
    expect(screen.getByTestId('pm-quick-input')).toBeTruthy();
    expect(screen.getByTestId('pm-confirmed')).toBeTruthy();
    expect(screen.getByTestId('pm-inbox')).toBeTruthy();
    // 共用同一组件：narrow=true 让窄面板双窗上下堆叠
    expect(h.paneProps.at(-1)?.narrow).toBe(true);
  });

  it('面板打开即自动拉取账本 agent 记忆（读取会话时自动读 + 手动兜底）', async () => {
    await renderPanel();
    await waitFor(() => expect(h.splitAgentIngest).toHaveBeenCalled());
    expect(h.splitAgentIngest.mock.calls[0][0]).toBeInstanceOf(Set);
    fireEvent.click(screen.getByTestId('pm-ingest-refresh'));
    await waitFor(() => expect(h.splitAgentIngest).toHaveBeenCalledTimes(2));
  });

  it('进库分流口径明示：会话信息直接放行，agent 提取的记忆才进发件箱', async () => {
    await renderPanel();
    const split = screen.getByTestId('pm-ingest-split');
    expect(split.textContent).toContain('会话信息');
    expect(split.textContent).toContain('直接放行');
    expect(split.textContent).toContain('12');   // 会话信息条数
    expect(split.textContent).toContain('待判定 1'); // 发件箱里的 agent 记忆
  });

  it('归并候选逐条显示来源与日期，按钮文案直接标明去向', async () => {
    await renderPanel();
    const card = screen.getByTestId('pm-ingest-mem_agent_1');
    expect(card.textContent).toContain('来源 agent · cursor');
    expect(card.querySelector('.pm-time')?.textContent).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
    expect(screen.getByTestId('pm-ingest-mine-mem_agent_1').textContent).toContain('归入私人池');
    expect(screen.getByTestId('pm-ingest-notmine-mem_agent_1').textContent).toContain('进共享');
  });

  it('收起时不渲染（状态保留由壳层负责）', async () => {
    render(<PersonalMemoryPanel open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('personal-memory-panel')).toBeNull();
    // 等 useKernelLoad 的异步快照落地，避免 act 警告（不影响渲染契约）
    await waitFor(() => expect(h.loadPersonalSnapshot).toHaveBeenCalled());
  });
});

describe('个人记忆常驻面板：一次点击完成分流', () => {
  it('「是我的」→ import_from_agent + confirm（进入私人池、参与召回）', async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId('pm-ingest-mine-mem_agent_1'));
    await waitFor(() => expect(h.importPersonalFromAgent).toHaveBeenCalledTimes(1));
    expect(h.importPersonalFromAgent.mock.calls[0][0]).toMatchObject({
      content: LEDGER.content, sourceAgent: 'cursor', sourceRefId: LEDGER.id,
    });
    // 不给账本记忆打任何 scope/team_shared 标记，隔离靠个人独立存储
    expect(h.importPersonalFromAgent.mock.calls[0][0]).not.toHaveProperty('team_shared');
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('confirm', { id: 'pm_imported' }));
    expect(screen.getByTestId('pm-panel-msg').textContent).toContain('已归入私人池');
  });

  it('「不是我的」→ reject_from_agent（个人侧记录判定，账本原样留在共享池）', async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId('pm-ingest-notmine-mem_agent_1'));
    await waitFor(() => expect(h.rejectPersonalFromAgent).toHaveBeenCalledTimes(1));
    expect(h.rejectPersonalFromAgent.mock.calls[0][0]).toMatchObject({ sourceRefId: LEDGER.id });
    expect(h.importPersonalFromAgent).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-panel-msg').textContent).toContain('进共享');
  });

  it('导入成功但 confirm 失败：如实说明未进入私人池，绝不谎报成功', async () => {
    h.invoke.mockRejectedValueOnce(new Error('确认被拒'));
    await renderPanel();
    fireEvent.click(screen.getByTestId('pm-ingest-mine-mem_agent_1'));
    await waitFor(() => expect(screen.getByTestId('pm-panel-msg').textContent).toContain('确认失败'));
    expect(screen.getByTestId('pm-panel-msg').textContent).toContain('未进入私人池');
  });

  it('已归入的账本 ref 按 origin_ref_id 去重，不再作为候选出现', async () => {
    h.loadPersonalSnapshot.mockResolvedValue(snapshot({
      confirmed: [entry({ id: 'pm_done', content: '已确认', state: 'confirmed', origin_ref_id: LEDGER.id })],
    }));
    // 故意仍返回该候选：验证即使拉取早于快照、渲染层也会按 origin_ref_id 挡住，不重复出现
    h.splitAgentIngest.mockResolvedValue({ sessionInfoCount: 0, candidates: [LEDGER] });
    await renderPanel();
    expect(screen.queryByTestId('pm-ingest-mem_agent_1')).toBeNull();
    expect(screen.getByTestId('pm-ingest-empty')).toBeTruthy();
    expect(screen.getByTestId('pm-ingest-count').textContent).toContain('待判定 0');
  });
});

describe('个人记忆常驻面板：人机交互与诚实降级', () => {
  it('Esc 收起面板', async () => {
    const { onClose } = await renderPanel();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('账本候选读取失败时如实报错并可重试，不把「读不到」伪装成「空」', async () => {
    h.splitAgentIngest.mockRejectedValueOnce(new Error('账本不可达')).mockResolvedValue({ sessionInfoCount: 0, candidates: [] });
    render(<PersonalMemoryPanel open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('pm-ingest-error').textContent).toContain('账本不可达'));
    fireEvent.click(screen.getByTestId('pm-ingest-retry'));
    await waitFor(() => expect(screen.getByTestId('pm-ingest-empty')).toBeTruthy());
  });
});
