import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DisputePage } from '../DisputePage.tsx';
import { DisputeQueue } from '../DisputeQueue.tsx';
import { DisputeVerdict } from '../DisputeVerdict.tsx';
import { coreConflictHistory, coreConflicts, coreVerdict, type DisputeCtx } from '../coreDispute.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import type { Memory } from '../../../core/memagent/types.ts';
import { SEED_CONFLICTS } from './fixtures.ts';

const NOW = new Date('2026-10-10T09:00:00.000Z').getTime();

// 页面接真：队列 = 真实账本（jsdom/浏览器 = 内存态空账本 → 诚实空态，绝不伪造种子冲突）。
// SEED_CONFLICTS 仅作单元测试夹具（DisputeQueue/DisputeVerdict 组件直渲用法），页面不渲染。
describe('DisputePage (P7-T5 编排·真实账本接真版)', () => {
  it('空账本（jsdom 内存态）→ 诚实空态（不渲染种子冲突）', async () => {
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('dispute-empty')).toBeInTheDocument());
    expect(screen.getByTestId('dispute-empty')).toHaveTextContent('当前账本无待裁决冲突');
    // 批次54：空态与截图同构——面板内保留队列表头骨架（列头齐全），不是光秃秃一张说明卡
    expect(screen.getByTestId('dispute-empty').textContent).toContain('conflict_id');
    expect(screen.getByTestId('dispute-empty').textContent).toContain('old 置信度');
    expect(screen.getByTestId('dispute-empty').textContent).toContain('冲突队列（0）');
    // 诚实口径：无真实冲突 → 不渲染种子 cf_001~cf_005 队列项
    expect(screen.queryByTestId('queue')).toBeNull();
  });

  it('有真实冲突（coreConflicts 返回非空）→ 渲染队列 + 裁决面板', async () => {
    // 注入 1 条真实冲突（模拟账本有 pending 冲突）
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    expect(screen.getAllByTestId(/^queue-item-/)[0]).toHaveTextContent(SEED_CONFLICTS[0].old_content);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-old')).toBeInTheDocument();
    expect(screen.getByTestId('panel-new')).toBeInTheDocument();
  });

  it('批次63 对齐设计稿：双栏对比标题含 conflict_id、hint 含 mem_id 候选、旧值 del / 新值 ins 差异标记', async () => {
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    // 面板头：双栏对比 · <conflict_id> + <old_id> → <new_id> 候选
    expect(screen.getByText(`双栏对比 · ${SEED_CONFLICTS[0].id}`)).toBeInTheDocument();
    expect(screen.getByText(`${SEED_CONFLICTS[0].old_id} → ${SEED_CONFLICTS[0].new_id} 候选`)).toBeInTheDocument();
    // 旧值 <del> / 新值 <ins>（文本仍在，标记包裹）
    expect(screen.getByTestId('panel-old').querySelector('del')).toBeTruthy();
    expect(screen.getByTestId('panel-old').querySelector('del')?.textContent).toBe(SEED_CONFLICTS[0].old_content);
    expect(screen.getByTestId('panel-new').querySelector('ins')).toBeTruthy();
    expect(screen.getByTestId('panel-new').querySelector('ins')?.textContent).toBe(SEED_CONFLICTS[0].new_content);
  });

  it('裁决走内核（_memoryOp + 成对审计）→ 审计历史 + toast', async () => {
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    fireEvent.click(screen.getByTestId('verdict-auto_override'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/旧值 deprecated/));
    expect(screen.getByTestId('audit-log')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent(/req_/);
  });

  // 批次25 P0-7：内核读不到 ≠ 无待裁决冲突（原来 catch 里保持空列表 → 被说成「无冲突」）
  it('内核不可达 → 显示内核原因与重试，绝不显示「无待裁决冲突」', async () => {
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('本机服务响应超时，请重试');
    expect(screen.getByTestId('kernel-error-reason').textContent).not.toContain('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('dispute-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
  });
  // 2026-11-21：参考稿筛选行 / 裁决方式 / 真实裁决历史
  it('筛选行：超期 >7 天为真实筛选，类型筛选因内核未采样禁用并写原因', async () => {
    // 夹具 0 超期 3 天、夹具 1 超期 9 天：筛选必须按真实 overdue_days 生效
    const live = [SEED_CONFLICTS[0], SEED_CONFLICTS[1]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage load={async () => live} loadHistory={async () => []} />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(2));
    // 类型筛选：禁用且原因可见
    const typeBtn = screen.getByTestId('dispute-filter-type');
    expect(typeBtn).toBeDisabled();
    expect(typeBtn.getAttribute('title')).toContain('未采样');
    // 超期筛选：只剩 9 天那条，切回全部恢复两条
    expect(screen.getByTestId('dispute-filter-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('dispute-filter-overdue'));
    expect(screen.getByTestId('dispute-filter-overdue')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    expect(screen.getAllByTestId(/^queue-item-/)[0]).toHaveTextContent(SEED_CONFLICTS[1].id);
    fireEvent.click(screen.getByTestId('dispute-filter-all'));
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(2));
  });

  it('超期筛选无可匹配项 → 如实提示筛选为空，不伪造行', async () => {
    const fresh = { ...SEED_CONFLICTS[0], overdue_days: 0, created_at: new Date().toISOString(), wait_text: '刚刚' };
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue([fresh]);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('dispute-filter-overdue')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('dispute-filter-overdue'));
    await waitFor(() => expect(screen.getByTestId('queue-filter-empty')).toBeInTheDocument());
    expect(screen.getByTestId('queue-filter-empty')).toHaveTextContent(/账本共 1 条/);
    expect(screen.queryAllByTestId(/^queue-item-/).length).toBe(0);
  });

  it('裁决方式：人工可用；AI 裁决未接内核 → 禁用并写原因', async () => {
    render(<DisputePage load={async () => [SEED_CONFLICTS[0]]} loadHistory={async () => []} />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('dispute-mode-human')).toHaveAttribute('aria-pressed', 'true');
    const ai = screen.getByTestId('dispute-mode-ai');
    expect(ai).toBeDisabled();
    expect(ai.getAttribute('title')).toContain('内核未提供 AI 裁决通道');
  });

  it('裁决历史：读账本 conflict_resolve 审计（真实 request_id 与 pending/merged 如实展示）', async () => {
    render(<DisputePage
      load={async () => [SEED_CONFLICTS[0]]}
      loadHistory={async () => [
        {
          request_id: 'req_hist_01', verdict: 'user_confirm', pending: true, resolved: false,
          old_id: 'mem_a', new_id: 'mem_b', ts: 2, note: '人工确认 · 保持 pending（未落定）',
        },
        {
          request_id: 'req_hist_02', verdict: 'merge', pending: false, resolved: true,
          merged_mem_id: 'mem_merged', old_id: 'mem_c', new_id: 'mem_d', ts: 1,
          note: '合并 · 已落定 · 合并记忆 mem_merged',
        },
      ]}
    />);
    await waitFor(() => expect(screen.getByTestId('dispute-history')).toBeInTheDocument());
    // loadHistory 是异步账本回读：历史行到达前断言会撞空态（既有竞态），改为等真实行出现再逐条断言
    await waitFor(() => expect(screen.getByTestId('audit-row-0')).toBeInTheDocument());
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent('req_hist_01');
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent('保持 pending');
    expect(screen.getByTestId('audit-row-1')).toHaveTextContent('mem_merged');
  });

  // 2026-11-21 用户打回：空账本时双栏对比 / 裁决方式与动作 / 裁决历史被条件渲染整块吃掉。
  // 此处锁定四块结构常驻：只有「行 / 选中态」随数据变化，面板与表头不得隐藏。
  it('空账本 → 四块结构常驻（筛选行/双栏占位+禁用动作/裁决历史表头+如实空行）', async () => {
    const { container } = render(<DisputePage load={async () => []} loadHistory={async () => []} />);
    const $ = within(container);
    await waitFor(() => expect($.getByTestId('dispute-empty')).toBeInTheDocument());

    // ① 待裁决队列：筛选行 + 计数 + 表头骨架
    expect($.getByTestId('dispute-filter')).toBeInTheDocument();
    expect($.getByTestId('dispute-filter-all')).toHaveTextContent('待裁决队列（0）');
    expect($.getByTestId('dispute-filter-overdue')).toHaveTextContent('超期 >7 天（0）');
    expect($.getByTestId('dispute-filter-type')).toBeDisabled();
    expect($.getByTestId('dispute-empty').textContent).toContain('conflict_id');
    expect($.getByTestId('dispute-empty').textContent).toContain('new 置信度');
    expect($.queryByTestId('queue')).toBeNull();

    // ② 双栏对比：标题与两侧信息位常驻，未选中给占位而不是整块消失
    const compare = $.getByTestId('compare-panel');
    expect(compare).toBeInTheDocument();
    expect(compare).toHaveTextContent('双栏对比');
    expect($.getByTestId('compare-empty')).toHaveTextContent('在队列中选择一条冲突查看对照');
    expect($.queryByTestId('panel-old')).toBeNull();
    expect($.queryByTestId('panel-new')).toBeNull();

    // ③ 裁决方式与动作：人工可选、AI 禁用写原因、四项动作常驻但禁用并写原因
    expect($.getByTestId('dispute-verdict-mode')).toBeInTheDocument();
    expect($.getByTestId('dispute-mode-human')).toHaveAttribute('aria-pressed', 'true');
    const ai = $.getByTestId('dispute-mode-ai');
    expect(ai).toBeDisabled();
    expect(ai.getAttribute('title')).toContain('内核未提供 AI 裁决通道');
    expect($.getByTestId('verdict-panel')).toBeInTheDocument();
    for (const v of ['auto_override', 'user_confirm', 'merge', 'hold']) {
      const btn = $.getByTestId(`verdict-${v}`);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute('title')).toContain('请先在队列中选择一条冲突');
    }

    // ④ 裁决历史：表头常驻，无记录时表体一行如实空态（不整块隐藏）
    const history = $.getByTestId('dispute-history');
    expect(history).toBeInTheDocument();
    expect($.getByTestId('audit-log').textContent).toContain('request_id');
    expect($.getByTestId('audit-log').textContent).toContain('note');
    await waitFor(() => expect($.getByTestId('history-empty')).toBeInTheDocument());
    expect($.queryAllByTestId(/^audit-row-/).length).toBe(0);
  });

  // 2026-11-21 用户要求「真数据验证」：真实 InMemoryStorage 造 pending 冲突 →
  // 队列真实行 → 双栏真实两侧正文/版本 → 裁决写真实 conflict_resolve 审计 → 历史出现对应 request_id。
  it('真实账本闭环：InMemoryStorage 造冲突 → 四块齐全 → 裁决产生真实审计并出队', async () => {
    // 同文件前面的用例用 vi.spyOn 替换过 coreDispute 导出；此处要的是真实内核函数，先还原
    vi.restoreAllMocks();
    const storage = new InMemoryStorage();
    const DAY = 24 * 3600 * 1000;
    const now = Date.now();
    const mk = (id: string, content: string, confidence: number, created_at: number): Memory => ({
      mem_id: id,
      project_id: 'P1',
      enterprise_id: 'E1',
      team_id: 'T1',
      category: 'fact',
      layer: 'L1',
      content,
      content_l1: content,
      decay_class: 'warm',
      pinned: false,
      locked: false,
      version: 1,
      created_at,
      confidence,
      conflict_id: 'cf_real_01',
    });
    await storage.putMemory(mk('mem_real_old', '缓存 TTL 设为 300s', 0.7, now - 10 * DAY));
    await storage.putMemory(mk('mem_real_new', '缓存 TTL 设为 60s', 0.85, now - 60 * 1000));
    const ctx: DisputeCtx = { storage };

    const { container } = render(
      <DisputePage
        load={() => coreConflicts(ctx)}
        loadHistory={() => coreConflictHistory(ctx)}
        verdict={(rec, v) => coreVerdict(rec, v, ctx)}
      />,
    );
    const $ = within(container);

    // ① 队列出现真实行（conflict_id / 真实 mem_id / 真实置信度）
    await waitFor(() => expect($.getAllByTestId(/^queue-item-/).length).toBe(1));
    const row = $.getAllByTestId(/^queue-item-/)[0];
    expect(row).toHaveTextContent('cf_real_01');
    expect(row).toHaveTextContent('mem_real_old');
    expect(row).toHaveTextContent('0.7');
    // ② 双栏：真实两侧正文 + 版本信息位（默认选中第一条，占位消失）
    await waitFor(() => expect($.getByTestId('panel-old')).toBeInTheDocument());
    expect($.queryByTestId('compare-empty')).toBeNull();
    expect($.getByTestId('panel-old')).toHaveTextContent('缓存 TTL 设为 300s');
    expect($.getByTestId('panel-new')).toHaveTextContent('缓存 TTL 设为 60s');
    expect($.getByTestId('compare-panel')).toHaveTextContent('mem_real_old → mem_real_new 候选');
    // ③ 裁决产生真实 conflict_resolve 审计
    fireEvent.click($.getByTestId('verdict-auto_override'));
    await waitFor(async () => {
      const audits = await storage.queryAudit({ action: 'conflict_resolve' });
      expect(audits.length).toBe(1);
    });
    const [audit] = await storage.queryAudit({ action: 'conflict_resolve' });
    // ④ 历史表出现对应 request_id 行；队列真实出队（旧值归档）
    await waitFor(() => expect($.getByTestId('audit-row-0')).toHaveTextContent(audit.request_id));
    await waitFor(() => expect($.getByTestId('dispute-empty')).toBeInTheDocument());
    expect($.queryAllByTestId(/^queue-item-/).length).toBe(0);
    expect((await storage.getMemory('mem_real_old'))?.decay_class).toBe('archived');
  });
});

describe('DisputeQueue (T3)', () => {
  it('空队列显示占位', () => {
    render(<DisputeQueue list={[]} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-empty')).toHaveTextContent(/暂无/);
  });

  it('超期高亮 + 类型徽章渲染（测试夹具 SEED_CONFLICTS，仅组件单测用）', () => {
    render(<DisputeQueue list={SEED_CONFLICTS} now={NOW} onSelect={() => {}} />);
    const item = screen.getByText(/默认端口 8080/).closest('li');
    expect(item).toHaveClass('overdue');
    expect(screen.getAllByText('直接矛盾').length).toBe(2);
    expect(screen.getByText('部分重叠')).toBeInTheDocument();
  });
});

describe('DisputeVerdict (T4)', () => {
  const base = SEED_CONFLICTS[0];
  it('渲染 4 按钮，且不预生成假 request_id（真实 id 只能由内核裁决返回，批次48 A19）', () => {
    render(<DisputeVerdict record={base} onVerdict={() => {}} />);
    expect(screen.queryByText(/req_[0-9A-Za-z]+/)).toBeNull();
    expect(screen.getByTestId('req-hint')).toHaveTextContent('内核裁决返回');
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^verdict-(auto_override|user_confirm|merge|hold)$/).length).toBe(4);
  });
});
