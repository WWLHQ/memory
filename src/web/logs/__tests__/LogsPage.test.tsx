import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { LogsPage } from '../LogsPage.tsx';
import { LogTable, AuditModal } from '../LogCards.tsx';
import { SEED_LOGS, seedL0Memory, seedLogsLedger } from './fixtures.ts';
import { ensureRequestId } from '../logic.ts';
import { getKernelStorage, getTenant, resetKernelForTests, setKernelStorageForTests } from '../../kernel.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { TEST_ADMIN_ID } from '../../../core/memagent/__tests__/l0Kit.ts';
import type { L0Vault } from '../../../core/memagent/l0vault.ts';

// 页面订阅登录会话（role 门禁）：测试内可控 admin/member，避免依赖本机 home 后端
const sessionRole = vi.hoisted(() => ({ value: 'admin' as 'admin' | 'member' | null }));
vi.mock('../../shared/session.ts', () => ({
  useSessionContext: () => ({
    sid: 'sid_test',
    context: sessionRole.value ? { role: sessionRole.value } : null,
    role: sessionRole.value,
    loading: false,
  }),
  currentSessionId: () => 'sid_test',
  fetchSessionContext: async () => null,
}));

describe('LogsPage (P15-T4 编排，审计流来自内核)', () => {
  let vault: L0Vault;
  beforeEach(async () => {
    sessionRole.value = 'admin';
    localStorage.clear();
    resetKernelForTests();
    // 批次28-A：mock 会话会让账本走 HTTP 数据面，单测仍用内存账本（真 HTTP 行为在 server/httpStorage 单测覆盖）
    setKernelStorageForTests(new InMemoryStorage());
    await seedLogsLedger();
    ({ vault } = await seedL0Memory());
  });

  it('挂载渲染：全动作可见（验收用例①）+ n/a 告警卡（R-LOG2）', async () => {
    render(<LogsPage />);
    expect(screen.getByTestId('logs-page')).toBeInTheDocument();
    // 全动作：清理归档/团队分配等在动作多选区均可见（列表批次24 起分页，每页 10 条）
    await waitFor(() => expect(screen.getAllByText('清理归档').length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText('团队分配').length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getByTestId('missing-warn')).toHaveTextContent(/1 条日志缺少 request_id/));
  });

  it('程序运行日志卡（批次19 从首页迁入）：纯浏览器如实不可用，不渲染假日志', async () => {
    render(<LogsPage />);
    const panel = screen.getByTestId('program-log');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('id', 'programLog');
    expect(screen.getByText(/非桌面壳环境：无法读取本机程序日志/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('program-log-line')).toHaveLength(0);
    // 等待账本异步加载落定，避免 act 警告
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBeGreaterThan(0));
  });

  it('error 置顶（R-LOG1）+ 红底行', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBeGreaterThan(0));
    const first = screen.getAllByTestId(/^log-\d+$/)[0];
    expect(first).toHaveClass('err-row');
  });

  it('仅异常开关（验收用例②）', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('lf-abnormal'));
    expect(screen.getAllByTestId(/^log-\d+$/).every((el) => !el.textContent?.includes('info'))).toBe(true);
  });

  it('查阅审计 → 弹出 modal（R-LOG6 非常驻）→ 关闭收起', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^audit-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId(/^audit-\d+$/)[0]);
    expect(screen.getByTestId('audit-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('audit-modal')).toBeNull();
  });

  it('L0 授权走内核 browse：错密码已记审计；对密码解锁 + 样例回填', async () => {
    render(<LogsPage />);
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'badpass-1' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-msg')).toHaveTextContent('已记审计'));
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'l0pass-1' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-msg')).toHaveTextContent('l0_view'));
    await waitFor(() => expect(screen.getByTestId('l0-sample')).toHaveTextContent('tcp://prod-db:5432/app'));
  });

  it('成员：无 grant 被拒；凭 grant_id + 一次性密码解锁（§4.4.3）', async () => {
    sessionRole.value = 'member';
    const grant = await vault.grantAccess({
      grantee_user_id: getTenant().user_id,
      scope_project_ids: ['P1'],
      password: 'grantpass-9',
      admin_user_id: TEST_ADMIN_ID,
    });
    render(<LogsPage />);

    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'grantpass-9' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-msg')).toHaveTextContent('查阅申请'));

    fireEvent.change(screen.getByTestId('l0-grant-id'), { target: { value: grant.grant_id } });
    fireEvent.change(screen.getByTestId('l0-pwd'), { target: { value: 'grantpass-9' } });
    fireEvent.click(screen.getByTestId('l0-submit'));
    await waitFor(() => expect(screen.getByTestId('l0-msg')).toHaveTextContent('l0_view'));
    await waitFor(() => expect(screen.getByTestId('l0-sample')).toHaveTextContent('tcp://prod-db:5432/app'));
    expect(screen.getByTestId('l0-countdown')).toHaveTextContent('空闲 5 分钟自动锁定');
  });

  it('详情展开 extra', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^detail-\d+$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId(/^detail-\d+$/)[0]);
    expect(screen.getAllByTestId(/^extra-\d+$/)[0]).toBeInTheDocument();
  });

  // 批次24 #4：分页 + 可调表头（参考记忆库管理页口径，预设每页 10 条）
  it('分页：默认每页 10 条，翻页后行号连续不串位', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBe(10));
    expect(screen.getByTestId('pg-info').textContent).toContain('/ 2 页 · 共 15 条');
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(1);
    expect(screen.getByTestId('pg-note').textContent).toContain('每页 10 条 · 命中 15 条');
    expect(screen.getByTestId('log-0')).toBeInTheDocument();
    expect(screen.getByTestId('log-9')).toBeInTheDocument();
    expect(screen.queryByTestId('log-10')).toBeNull();
    // 首页按钮在第 1 页禁用，下一页可点
    expect(screen.getByTestId('pg-first')).toBeDisabled();
    expect(screen.getByTestId('pg-prev')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pg-next'));
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBe(5));
    // 第二页首行仍是全局序号 10（indexOffset），行详情不会串位
    expect(screen.getByTestId('log-10')).toBeInTheDocument();
    expect(screen.getByTestId('log-14')).toBeInTheDocument();
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(2);
    expect(screen.getByTestId('pg-next')).toBeDisabled();
    expect(screen.getByTestId('pg-last')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pg-first'));
    await waitFor(() => expect(screen.getByTestId('pg-goto-input')).toHaveValue(1));
  });

  it('分页：跳页输入 + 每页条数切换（10→100 一次看全 15 条）', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBe(10));

    fireEvent.change(screen.getByTestId('pg-goto-input'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByTestId('pg-goto-input')).toHaveValue(2));
    expect(screen.queryByTestId('log-0')).toBeNull();

    fireEvent.change(screen.getByTestId('pg-size'), { target: { value: '100' } });
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBe(15));
    // 换档回到第 1 页，且总数口径不变
    expect(screen.getByTestId('pg-info').textContent).toContain('/ 1 页 · 共 15 条');
    expect(screen.getByTestId('pg-goto-input')).toHaveValue(1);
  });

  it('分页：过滤后条数不足一页时不再停留在空页', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^log-\d+$/).length).toBe(10));
    fireEvent.click(screen.getByTestId('pg-next'));
    await waitFor(() => expect(screen.getByTestId('pg-goto-input')).toHaveValue(2));

    fireEvent.change(screen.getByTestId('lf-kw'), { target: { value: 'req_l11' } });
    // 关键词把结果收敛到 1 条 → 页码回第 1 页（不留在空页）
    await waitFor(() => expect(screen.getByTestId('pg-info').textContent).toContain('/ 1 页 · 共 1 条'));
    expect(screen.getAllByTestId(/^log-\d+$/)).toHaveLength(1);
  });

  it('表头：7 列固定表头 + 拖把手调宽并固化（重新挂载仍保持）', async () => {
    render(<LogsPage />);
    await waitFor(() => expect(screen.getByTestId('log-table-node')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^log-th-\d+$/)).toHaveLength(7);
    expect(screen.getByTestId('log-th-4')).toHaveAttribute('data-w', '300');
    expect(screen.queryByTestId('log-col-reset')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('col-resize-4'), { clientX: 300 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 420 });
      fireEvent.mouseUp(document);
    });
    expect(screen.getByTestId('log-th-4')).toHaveAttribute('data-w', '420');
    expect(JSON.parse(localStorage.getItem('logsColWidths') ?? '[]')[4]).toBe(420);
    expect(screen.getByTestId('log-col-reset')).toBeInTheDocument();

    // 等效「刷新 / 重新登录」：卸载重挂后宽度仍是调过的值，不需要每层重调
    cleanup();
    render(<LogsPage />);
    await waitFor(() => expect(screen.getByTestId('log-th-4')).toHaveAttribute('data-w', '420'));

    fireEvent.click(screen.getByTestId('log-col-reset'));
    expect(screen.getByTestId('log-th-4')).toHaveAttribute('data-w', '300');
    expect(localStorage.getItem('logsColWidths')).toBe('[]');
  });
});

// 批次25 P0-2：审计全链路必须真查内核账本。旧 modal 只把 request_id 印在一句
// 「链路：xxx（真实审计记录）」上，一次账本都不查 → 用户以为看到了链路，实际什么都没发生。
describe('AuditModal 审计全链路真查（批次25 P0-2）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    resetKernelForTests();
    setKernelStorageForTests(new InMemoryStorage());
  });

  it('按 request_id 真查账本：命中几行列几行，按时间升序', async () => {
    const storage = getKernelStorage();
    const t0 = Date.now();
    await storage.appendAudit({ request_id: 'req_chain25', action: 'write', ts: t0 + 200, detail: { message: '链路25 写入完成' } });
    await storage.appendAudit({ request_id: 'req_chain25', action: 'recall', ts: t0 + 100, detail: { message: '链路25 召回命中' } });

    render(<AuditModal requestId="req_chain25" onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('modal-row')).toHaveLength(2));
    expect(screen.getByTestId('modal-chain')).toHaveTextContent('本机账本命中 2 行');
    expect(screen.getAllByTestId('modal-row')[0]).toHaveTextContent('链路25 召回命中');
    expect(screen.getByTestId('modal-title')).toHaveTextContent('req_chain25');
    expect(screen.queryByText(/（真实审计记录）/)).toBeNull();
  });

  it('账本查无该 request_id → 如实说查无，不假装有链路', async () => {
    render(<AuditModal requestId="req_absent_25" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('modal-empty')).toBeInTheDocument());
    expect(screen.getByTestId('modal-empty')).toHaveTextContent('查无审计行');
    expect(screen.queryAllByTestId('modal-row')).toHaveLength(0);
  });

  it('账本查询失败 → 说「查询失败 + 原因」，绝不显示「查无记录」', async () => {
    render(
      <AuditModal
        requestId="req_fail_25"
        onClose={() => {}}
        load={async () => { throw new Error('E_IPC_TIMEOUT'); }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-error')).toBeInTheDocument());
    expect(screen.getByTestId('modal-error')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('modal-empty')).toBeNull();
    expect(screen.queryAllByTestId('modal-row')).toHaveLength(0);
  });

  it('页面点 request_id → modal 列出该链路的真实账本行', async () => {
    await seedLogsLedger();
    render(<LogsPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^rid-\d+$/).length).toBeGreaterThan(0));
    const link = screen.getAllByTestId(/^rid-\d+$/)[0];
    const rid = link.textContent ?? '';
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('modal-chain')).toBeInTheDocument());
    expect(screen.getByTestId('modal-title')).toHaveTextContent(rid);
    expect(screen.getAllByTestId('modal-row').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('modal-row')[0].textContent).toContain(rid);
  });
});

describe('LogTable (T3)', () => {  it('n/a 行无审计链接', () => {
    const { fixed } = ensureRequestId(SEED_LOGS);
    render(<LogTable logs={fixed} onAudit={() => {}} />);
    expect(screen.getAllByTestId(/^na-\d+$/).length).toBe(1);
  });
  it('空结果显示占位', () => {
    render(<LogTable logs={[]} onAudit={() => {}} />);
    expect(screen.getByTestId('log-empty')).toBeInTheDocument();
  });
});
