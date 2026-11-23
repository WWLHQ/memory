// 个人记忆双窗 Pane：2026-11-21 用户定制的交互契约
// - 顶部快速记录整块删除；左「已确认显示窗」内置自由输入 textarea +「保存」；
// - 保存走真实写入路径 quick_add → confirm（已确认语义，参与召回），随后 list 重读回写页面级状态；
// - 召回归属整条移到页头右侧；空态文案不再指向已移除/错位的控件；
// - 右窗收件箱与判定口径保留，双窗结构不随数据有无消失。
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getPersonalPort: vi.fn(),
  invoke: vi.fn(),
  onChanged: vi.fn(),
  onRetry: vi.fn(),
}));

vi.mock('../../shared/personalPort.ts', () => ({
  getPersonalPort: h.getPersonalPort,
  importPersonalFromAgent: vi.fn(),
  rejectPersonalFromAgent: vi.fn(),
  pushPersonalToTeam: vi.fn(),
  retryPersonalSync: vi.fn(),
}));

import { PersonalMemoryPane } from '../PersonalMemoryPane.tsx';
import type { PersonalEntry } from '../../../core/memagent/personalStore.ts';
import type { PersonalSnapshot } from '../../../core/memagent/personal.ts';

function entry(fields: Partial<PersonalEntry> & Pick<PersonalEntry, 'id' | 'content'>): PersonalEntry {
  return {
    state: 'confirmed', owner: 'u1', source: 'quick_note', source_agent: null, origin_ref_id: null,
    delivered_at: Date.parse('2026-11-21T02:00:00Z'), confirmed_at: Date.parse('2026-11-21T02:01:00Z'),
    rejected_at: null, layer: 'L1', content_hash: 'aaaaaaaabbbbbbbb', sha256: 'x'.repeat(64),
    vclock: { web: 1 }, sync_state: 'local', sync_error: null, sync_result: null,
    team_shared: false, team_id: null, version: 1, deleted: false, deleted_at: null,
    ...fields,
  };
}

function snapshot(over: Partial<PersonalSnapshot> = {}): PersonalSnapshot {
  return {
    owner: 'u1',
    owner_binding: { owner: 'u1', login_account: '13838528400', kernel_user_id: 'u1', bound: true, via: 'binding' },
    confirmed: [], pending: [], rejected: [], sync_queue: [],
    counts: {
      confirmed: 0, pending: 0, pending_agent: 0, pending_quick: 0, rejected: 0,
      pending_sync: 0, sync_failed: 0, synced: 0, team_shared: 0,
    },
    ...over,
  };
}

function renderPane(data: PersonalSnapshot = snapshot()) {
  return render(
    <PersonalMemoryPane phase="ok" data={data} error={null} onRetry={h.onRetry} onChanged={h.onChanged} narrow={false} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getPersonalPort.mockReturnValue({ channel: 'host', invoke: h.invoke });
  h.invoke.mockImplementation(async (op: string) => {
    if (op === 'quick_add') {
      return {
        request_id: 'r_quick', ok: true, action: 'quick_add',
        entry: entry({ id: 'pm_new', content: '晨会前先看夜间告警', state: 'pending', confirmed_at: null }),
      };
    }
    if (op === 'confirm') {
      return {
        request_id: 'r_confirm', ok: true, action: 'confirm',
        entry: entry({ id: 'pm_new', content: '晨会前先看夜间告警' }),
      };
    }
    if (op === 'list') {
      return snapshot({
        confirmed: [entry({ id: 'pm_new', content: '晨会前先看夜间告警' })],
        counts: {
          confirmed: 1, pending: 0, pending_agent: 0, pending_quick: 0, rejected: 0,
          pending_sync: 0, sync_failed: 0, synced: 0, team_shared: 0,
        },
      });
    }
    if (op === 'edit') {
      return {
        request_id: 'r_edit', ok: true, action: 'edit',
        entry: entry({ id: 'pm_a', content: '新内容\n第二行', version: 2 }),
      };
    }
    if (op === 'delete') return { request_id: 'r_delete', ok: true, action: 'delete' };
    return { request_id: 'r_other', ok: true, action: op };
  });
});

describe('个人记忆 Pane：2026-11-21 交互改造', () => {
  it('页头：标题/计数/召回归属同一行，召回归属在页头右侧且来源文案不变', () => {
    renderPane();
    const hd = document.querySelector('.pmp-hd') as HTMLElement;
    expect(hd.querySelector('h3')?.textContent).toBe('个人记忆');
    const owner = screen.getByTestId('pm-owner-binding');
    expect(owner.parentElement).toBe(hd);
    expect(owner.textContent).toContain('召回归属：内核账号');
    expect(owner.textContent).toContain('13838528400');
    expect(owner.textContent).toContain('已按显式绑定映射');
    // 旧的下方整条 ownerbar 已不存在
    expect(document.querySelector('.pmp-ownerbar')).toBeNull();
  });

  it('顶部快速记录整块删除；左窗 textarea + 保存常驻，右窗收件箱保留', () => {
    renderPane();
    expect(screen.queryByTestId('pm-quick-top')).toBeNull();
    expect(screen.queryByTestId('pm-quick-input')).toBeNull();
    expect(screen.queryByRole('button', { name: '记一条' })).toBeNull();
    expect(screen.getByTestId('pm-note-save').textContent).toContain('保存');
    expect(screen.getByTestId('pm-inbox')).toBeTruthy();
    expect(screen.getByTestId('pm-rules')).toBeTruthy();
  });

  it('左窗 = 记事本：只有 textarea + 一个「保存」，下拉/删除/取消编辑/字数计数全部不渲染', () => {
    renderPane();
    const col = screen.getByTestId('pm-confirmed') as HTMLElement;
    expect(col.querySelectorAll('textarea')).toHaveLength(1);
    // 2026-11-22 定稿：顶部只留一个「保存」——不再有下拉/删除/取消编辑
    expect(col.querySelectorAll('input, select')).toHaveLength(0);
    expect(Array.from(col.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim())).toEqual(['保存']);
    expect(screen.getByTestId('pm-note-input').tagName).toBe('TEXTAREA');
    expect(screen.getByTestId('pm-confirmed-count').textContent).toBe('0');
    // 已保存条带 / 下拉 / 计数均不再渲染
    expect(screen.queryByTestId('pm-saved-list')).toBeNull();
    expect(screen.queryByTestId('pm-saved-empty')).toBeNull();
    expect(screen.queryByTestId('pm-forced-hint')).toBeNull();
    expect(screen.queryByTestId('pm-saved-pick')).toBeNull();
    expect(screen.queryByTestId('pm-delete-selected')).toBeNull();
    expect(screen.queryByTestId('pm-note-count')).toBeNull();
    expect(screen.queryByTestId('pm-note-cancel')).toBeNull();
    // 被用户点名的整块控件（图2 红框）都不再渲染
    expect(screen.queryByTestId('pm-search')).toBeNull();
    expect(screen.queryByTestId('pm-range')).toBeNull();
    expect(screen.queryByTestId('pm-confirmed-empty')).toBeNull();
    expect(screen.queryByTestId('pm-confirmed-foot')).toBeNull();
    expect(document.querySelector('.pmp-pin')).toBeNull();
  });

  it('整卡输入区：保存按钮在左卡右上角，记事本铺满（红框小输入框与已保存条带已取消）', () => {
    renderPane();
    const col = screen.getByTestId('pm-confirmed') as HTMLElement;
    const head = col.querySelector('.pmp-head') as HTMLElement;
    const save = screen.getByTestId('pm-note-save');
    expect(head.contains(save)).toBe(true);
    const body = screen.getByTestId('pm-confirmed-list') as HTMLElement;
    expect(body.contains(screen.getByTestId('pm-note-input'))).toBe(true);
    expect(body.children).toHaveLength(1);
    expect((body.firstElementChild as HTMLElement).getAttribute('data-testid')).toBe('pm-note-input');
    // 红框容器（.pmp-note 带边框小输入框）与已保存条带都不再渲染
    expect(document.querySelector('.pmp-note')).toBeNull();
    expect(document.querySelector('.pmp-note-actions')).toBeNull();
    expect(document.querySelector('.pmp-saved')).toBeNull();
  });

  it('已确认正文常驻框内：载入即回填真实内容，计数如实；强制召回口径仍写在右窗', () => {
    renderPane(snapshot({
      confirmed: [entry({ id: 'pm_a', content: '晨会前先看夜间告警' })],
      counts: { ...snapshot().counts, confirmed: 1 },
    }));
    expect((screen.getByTestId('pm-note-input') as HTMLTextAreaElement).value).toBe('晨会前先看夜间告警');
    expect(screen.getByTestId('pm-confirmed-count').textContent).toBe('1');
    // 不再渲染条带/条目徽标/条目按钮/下拉
    expect(screen.queryByTestId('pm-saved-pm_a')).toBeNull();
    expect(screen.queryByTestId('pm-forced-pm_a')).toBeNull();
    expect(screen.queryByTestId('pm-edit-pm_a')).toBeNull();
    expect(screen.queryByTestId('pm-delete-pm_a')).toBeNull();
    expect(screen.queryByTestId('pm-saved-pick')).toBeNull();
    // 口径仍完整写在右窗判定口径里（范围 / 配额 / 例外）
    const rules = screen.getByTestId('pm-rules');
    expect(rules.textContent).toContain('每次会话强制召回');
    expect(rules.textContent).toContain('top_k');
    expect(rules.textContent).toContain('注入预算');
    expect(rules.textContent).toContain('待确认 / 已剔除 / 已删除不进召回');
  });

  it('个人记忆不做转存：无上行 / 重试 / 晋级入口，也不渲染本机待上行队列', () => {
    renderPane();
    expect(screen.queryByTestId('pm-sect-sync')).toBeNull();
    expect(screen.queryByTestId('pm-sync-queue-count')).toBeNull();
    // 说明文字会写「不做转存」；这里断言的是没有任何转存/上行/晋级入口（按钮或链接）
    expect(screen.queryByRole('button', { name: /上行|转存|晋级/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /上行|转存|晋级/ })).toBeNull();
    expect(document.querySelector('[data-testid^="pm-uplink-"], [data-testid^="pm-retry-"]')).toBeNull();
  });

  it('右窗收件箱 / 判定口径保留，双窗结构不随数据有无消失', () => {
    renderPane();
    expect(screen.getByTestId('pm-inbox')).toBeTruthy();
    expect(screen.getByTestId('pm-rules')).toBeTruthy();
    expect(screen.getByTestId('pm-sect-quick').textContent).not.toContain('快速记录');
  });

  it('保存：真实走 quick_add → confirm → list，正文常驻框内并回写已确认快照', async () => {
    renderPane();
    fireEvent.change(screen.getByTestId('pm-note-input'), { target: { value: '晨会前先看夜间告警' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));

    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('quick_add', { content: '晨会前先看夜间告警' }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('confirm', { id: 'pm_new' }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('list'));
    // 用户定稿：保存后正文仍留在框内（记事本常驻），不再清空
    expect((screen.getByTestId('pm-note-input') as HTMLTextAreaElement).value).toBe('晨会前先看夜间告警');
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('已保存并确认'));
    expect(screen.getByTestId('pm-msg').textContent).toContain('request_id r_confirm');
    expect(h.onChanged).toHaveBeenCalled();
    const last = h.onChanged.mock.calls.at(-1)?.[0] as PersonalSnapshot | undefined;
    expect(last?.counts.confirmed).toBe(1);
  });

  it('空内容不写库：只提示，不调用任何写操作', async () => {
    renderPane();
    fireEvent.change(screen.getByTestId('pm-note-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('内容为空'));
    expect(h.invoke).not.toHaveBeenCalledWith('quick_add', expect.anything());
  });

  it('写入成功但确认失败：如实说明仍在待确认，不谎报已保存为已确认', async () => {
    h.invoke.mockImplementation(async (op: string) => {
      if (op === 'quick_add') {
        return {
          request_id: 'r_quick', ok: true, action: 'quick_add',
          entry: entry({ id: 'pm_new', content: '确认会失败的条目', state: 'pending', confirmed_at: null }),
        };
      }
      if (op === 'confirm') throw new Error('确认被拒');
      if (op === 'list') return snapshot();
      return { request_id: 'r_other', ok: true, action: op };
    });
    renderPane();
    fireEvent.change(screen.getByTestId('pm-note-input'), { target: { value: '确认会失败的条目' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('确认失败'));
    expect(screen.getByTestId('pm-msg').textContent).toContain('仍在待确认');
    expect(screen.getByTestId('pm-msg').textContent).not.toContain('已保存并确认');
  });

  // ── 2026-11-22 追加：框内直接编辑 / 多条分段写回 ──
  it('编辑：框内直接改，点「保存」走 edit 写回原条目（不新增），保存后正文仍在', async () => {
    const one = snapshot({
      confirmed: [entry({ id: 'pm_a', content: '旧内容' })],
      counts: { ...snapshot().counts, confirmed: 1 },
    });
    h.invoke.mockImplementation(async (op: string, args?: { content?: string }) => {
      if (op === 'edit') {
        return {
          request_id: 'r_edit', ok: true, action: 'edit',
          entry: entry({ id: 'pm_a', content: args?.content ?? '', version: 2 }),
        };
      }
      if (op === 'list') {
        return snapshot({
          confirmed: [entry({ id: 'pm_a', content: '新内容\n第二行', version: 2 })],
          counts: { ...snapshot().counts, confirmed: 1 },
        });
      }
      return { request_id: 'r_other', ok: true, action: op };
    });
    renderPane(one);
    const ta = screen.getByTestId('pm-note-input') as HTMLTextAreaElement;
    expect(ta.value).toBe('旧内容');
    expect(screen.getByTestId('pm-note-save').textContent).toBe('保存');

    fireEvent.change(ta, { target: { value: '新内容\n第二行' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('edit', { id: 'pm_a', content: '新内容\n第二行' }));
    expect(h.invoke).not.toHaveBeenCalledWith('quick_add', expect.anything());
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('写回原条目 pm_a'));
    expect(screen.getByTestId('pm-msg').textContent).toContain('未新增重复');
    // 保存后框内仍是刚写回的真实内容；条目数不变
    expect((screen.getByTestId('pm-note-input') as HTMLTextAreaElement).value).toBe('新内容\n第二行');
    expect(screen.getByTestId('pm-confirmed-count').textContent).toBe('1');
  });

  it('未改动直接保存：不调用 edit、不新增，提示内容未变化', async () => {
    const one = snapshot({
      confirmed: [entry({ id: 'pm_a', content: '旧内容' })],
      counts: { ...snapshot().counts, confirmed: 1 },
    });
    renderPane(one);
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('内容未变化'));
    expect(h.invoke).not.toHaveBeenCalledWith('edit', expect.anything());
    expect(h.invoke).not.toHaveBeenCalledWith('quick_add', expect.anything());
  });

  it('多条已确认：正文按空行分段逐条写回原条目；段数不符时提示且不写', async () => {
    const two = snapshot({
      confirmed: [entry({ id: 'pm_a', content: '甲' }), entry({ id: 'pm_b', content: '乙' })],
      counts: { ...snapshot().counts, confirmed: 2 },
    });
    h.invoke.mockImplementation(async (op: string, args?: { content?: string }) => {
      if (op === 'edit') return { request_id: 'r_edit', ok: true, action: 'edit', entry: entry({ id: 'x', content: args?.content ?? '' }) };
      if (op === 'list') {
        return snapshot({
          confirmed: [entry({ id: 'pm_a', content: '甲改', version: 2 }), entry({ id: 'pm_b', content: '乙改', version: 2 })],
          counts: { ...snapshot().counts, confirmed: 2 },
        });
      }
      return { request_id: 'r_other', ok: true, action: op };
    });
    renderPane(two);
    const ta = screen.getByTestId('pm-note-input') as HTMLTextAreaElement;
    expect(ta.value).toBe('甲\n\n乙');

    // 段数不符：如实提示，不写任何条目
    fireEvent.change(ta, { target: { value: '甲改' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('空行分成 2 段'));
    expect(h.invoke).not.toHaveBeenCalledWith('edit', expect.anything());

    // 段数一致：逐条写回原 id，不新增
    fireEvent.change(ta, { target: { value: '甲改\n\n乙改' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('edit', { id: 'pm_a', content: '甲改' }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('edit', { id: 'pm_b', content: '乙改' }));
    expect(h.invoke).not.toHaveBeenCalledWith('quick_add', expect.anything());
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('逐条写回 2 条原条目'));
  });

  it('多行自由写入：textarea 保留换行、maxLength=4000；空内容不保存', async () => {
    renderPane();
    const ta = screen.getByTestId('pm-note-input') as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.maxLength).toBe(4000);
    fireEvent.change(ta, { target: { value: '第一行\n第二行' } });
    expect(ta.value).toContain('\n第二行');
    // 2026-11-22：字数计数已按用户要求移除
    expect(screen.queryByTestId('pm-note-count')).toBeNull();
    // 空内容：不写库
    fireEvent.change(ta, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('pm-note-save'));
    await waitFor(() => expect(screen.getByTestId('pm-msg').textContent).toContain('内容为空'));
    expect(h.invoke).not.toHaveBeenCalledWith('quick_add', expect.anything());
  });
});
