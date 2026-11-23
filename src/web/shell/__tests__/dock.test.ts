// S6：底部面板数据口径 —— 不可用给原因、真实空集才显示 0、映射不造假。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostCall, hostCapability } from '../../../desktop/hostBridge.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import { currentSessionId } from '../../shared/session.ts';
import { getKernelStorage } from '../../kernel.ts';
import {
  auditMentions, countActionableProblems, loadAuditForMemory, loadOutputLog, loadScheduleRuns, problemsFromLog,
  type OutputLogView,
} from '../dock.ts';
import { humanActionLabel, humanizeLogLine, problemsIntro } from '../humanLog.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({ hostCapability: vi.fn(), hostCall: vi.fn() }));
vi.mock('../../kernel.ts', () => ({ getKernelStorage: vi.fn() }));
vi.mock('../../shared/session.ts', () => ({ currentSessionId: vi.fn() }));

const queryAudit = vi.fn();

function audit(partial: Partial<AuditRecord> & { request_id: string; action: AuditRecord['action'] }): AuditRecord {
  return { ts: 1, detail: {}, ...partial } as AuditRecord;
}

beforeEach(() => {
  vi.mocked(hostCapability).mockReset();
  vi.mocked(hostCall).mockReset();
  vi.mocked(currentSessionId).mockReset();
  vi.mocked(getKernelStorage).mockReset();
  queryAudit.mockReset();
  vi.mocked(getKernelStorage).mockReturnValue({ queryAudit } as unknown as ReturnType<typeof getKernelStorage>);
});

describe('loadOutputLog', () => {
  it('浏览器模式：如实不可用，且不试探宿主通道', async () => {
    vi.mocked(hostCapability).mockReturnValue('none');
    const r = await loadOutputLog();
    expect(r).toEqual({ status: 'unavailable', detail: expect.stringContaining('浏览器模式') });
    expect(hostCall).not.toHaveBeenCalled();
  });

  it('主进程 ok=false → error 带上主进程原因，不返回空行冒充成功', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(hostCall).mockResolvedValue({ ok: false, path: null, lines: [], error: '日志未初始化' });
    const r = await loadOutputLog();
    expect(r).toEqual({ status: 'error', detail: '日志未初始化' });
  });

  it('真实尾读 → 解析每行并保留日志路径', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(hostCall).mockResolvedValue({
      ok: true,
      path: '/tmp/actions.log',
      lines: [
        '[2026-11-08T01:00:00.000Z] [error] [kernel:schedule:tick-error] {"why":"interval"}',
        '畸形行',
      ],
    });
    const r = await loadOutputLog(2);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.path).toBe('/tmp/actions.log');
    expect(r.view.scanLines).toBe(2);
    expect(r.view.lines).toHaveLength(2);
    expect(r.view.lines[0].level).toBe('error');
    expect(r.view.lines[0].action).toBe('schedule:tick-error');
    // 畸形行不丢弃，按 unknown 原样展示
    expect(r.view.lines[1].level).toBe('unknown');
    expect(hostCall).toHaveBeenCalledWith('log:tail', [2]);
  });
});

describe('problemsFromLog', () => {
  it('只保留 warn/error，info 不冒充告警', () => {
    const view: OutputLogView = {
      path: null,
      scanLines: 3,
      capturedAt: 1,
      lines: [
        { raw: 'a', ts: null, level: 'info', scope: 's', action: 'a', message: 'ok' },
        { raw: 'b', ts: null, level: 'warn', scope: 's', action: 'a', message: 'w' },
        { raw: 'c', ts: null, level: 'error', scope: 's', action: 'a', message: 'e' },
      ],
    };
    expect(problemsFromLog(view).map((r) => r.level)).toEqual(['warn', 'error']);
  });
});

describe('底部面板说人话（humanLog）', () => {
  const rawFieldFree = (s: string) => {
    expect(s).not.toMatch(/\bipc:/);
    expect(s).not.toMatch(/no_session/);
    expect(s).not.toMatch(/refine:state/);
    expect(s).not.toContain('{"');
  };

  it('未登录的 refine:state 不再写内部字段，只当提醒并给出影响/处理', () => {
    const h = humanizeLogLine({ level: 'warn', scope: 'ipc', action: 'refine:state', message: '{"denied":"no_session"}' });
    expect(h.severity).toBe('notice');
    rawFieldFree(h.title);
    expect(h.effect).toContain('不受影响');
    expect(h.todo).toContain('不用处理');
    // 原始字段只进技术详情
    expect(h.tech).toContain('ipc:refine:state');
    expect(h.tech).toContain('no_session');
  });

  it('启动地址参数错误：说明已自动兜底、无需处理', () => {
    const h = humanizeLogLine({
      level: 'error', scope: 'ui', action: 'backend_param_rejected',
      message: '{"param":"backend","host":"http://127.0.0.1:64991:8201"}',
    });
    expect(h.severity).toBe('notice');
    expect(h.title).toContain('已自动改用本机地址');
    rawFieldFree(h.title);
  });

  it('未知动作也不泄漏 scope:action，只给中文类别名', () => {
    const h = humanizeLogLine({ level: 'error', scope: 'gateway', action: 'rotate_hook', message: '{"code":"E_X"}' });
    expect(h.title).toContain('大模型调用');
    expect(h.title).not.toMatch(/[a-z]+:[a-z]/);
    expect(h.title).not.toContain('rotate_hook');
    expect(h.severity).toBe('action');
  });

  it('写密钥读不到 → 需要处理，并指向「去解锁」', () => {
    const h = humanizeLogLine({ level: 'error', scope: 'l0', action: 'writeUnlocked', message: 'E_AUTH_L0' });
    expect(h.severity).toBe('action');
    expect(h.todo).toContain('去解锁');
  });

  it('可处理条数只统计 action 级，提醒不算问题', () => {
    const rows = [
      { level: 'warn' as const, scope: 'ipc', action: 'refine:state', message: '{"denied":"no_session"}', ts: '2026-11-22T13:00:00.000Z' },
      { level: 'error' as const, scope: 'l0', action: 'writeUnlocked', message: 'E_AUTH_L0', ts: '2026-11-22T13:00:01.000Z' },
    ];
    expect(countActionableProblems(rows)).toBe(1);
  });

  it('面板说明按「总数 / 需处理」给两种人话', () => {
    expect(problemsIntro(0, 0)).toContain('没有发现问题');
    expect(problemsIntro(4, 0)).toContain('都不需要你处理');
    expect(problemsIntro(4, 1)).toContain('1 条需要你处理');
  });

  it('输出页动作名是中文，未知也只给类别名', () => {
    expect(humanActionLabel('ipc', 'mcp:clients')).toBe('检查本机 AI 客户端');
    expect(humanActionLabel('weird', 'x')).toBe('后台动作');
  });
});

describe('loadScheduleRuns', () => {
  it('浏览器未登录：如实不可用，不去读进程内空账本冒充 0 条', async () => {
    vi.mocked(hostCapability).mockReturnValue('none');
    vi.mocked(currentSessionId).mockReturnValue(null);
    const r = await loadScheduleRuns();
    expect(r.status).toBe('unavailable');
    if (r.status === 'unavailable') expect(r.detail).toContain('读不到主进程的调度运行记录');
    expect(queryAudit).not.toHaveBeenCalled();
  });

  it('真实记录 → 按任务 key 映射中文名、按开始时间倒序、截断上限', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    queryAudit.mockResolvedValue([
      audit({ request_id: 'req_1', action: 'schedule_run', ts: 100, detail: { task: 'decay', trigger: 'cron', status: 'ok', started_at: 100, duration_ms: 5, next_due_at: 200 } }),
      audit({ request_id: 'req_2', action: 'schedule_run', ts: 300, detail: { task: 'archive', trigger: 'first', status: 'error', started_at: 300, error: 'boom' } }),
      audit({ request_id: 'req_3', action: 'schedule_run', ts: 200, detail: { task: 'unknown_task' } }),
    ]);
    const r = await loadScheduleRuns(2);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.map((x) => x.requestId)).toEqual(['req_2', 'req_3']);
    expect(r.view[0].label).toBe('冷记忆归档');
    expect(r.view[0].status).toBe('error');
    expect(r.view[0].error).toBe('boom');
    expect(r.view[1].label).toBe('unknown_task');
    expect(r.view[1].status).toBe('未记录');
    expect(queryAudit).toHaveBeenCalledWith({ action: 'schedule_run' });
  });

  it('账本读取抛错 → error 保留原始原因', async () => {
    vi.mocked(hostCapability).mockReturnValue('bridge');
    queryAudit.mockRejectedValue(new Error('尚未登录'));
    const r = await loadScheduleRuns();
    expect(r).toEqual({ status: 'error', detail: '请先登录，登录后即可查看' });
  });
});

describe('auditMentions / loadAuditForMemory', () => {
  const MEM = 'mem_01HQ';

  it('优先认已知字段，再退回 detail 全文精确包含', () => {
    expect(auditMentions(audit({ request_id: 'a', action: 'memory_op', detail: { mem_id: MEM } }), MEM)).toBe(true);
    expect(auditMentions(audit({ request_id: 'b', action: 'write', detail: { text: `noise ${MEM}` } }), MEM)).toBe(true);
    expect(auditMentions(audit({ request_id: 'c', action: 'write', detail: { mem_id: 'other' } }), MEM)).toBe(false);
    expect(auditMentions(audit({ request_id: 'd', action: 'write', detail: {} }), '')).toBe(false);
  });

  it('未选中对象：不查询、不返回 0 条', async () => {
    const r = await loadAuditForMemory('');
    expect(r.status).toBe('unavailable');
    expect(queryAudit).not.toHaveBeenCalled();
  });

  it('真实过滤：只留提及该 ID 的行，倒序截断', async () => {
    queryAudit.mockResolvedValue([
      audit({ request_id: 'old', action: 'memory_op', ts: 100, detail: { mem_id: MEM, op: 'remember' } }),
      audit({ request_id: 'other', action: 'memory_op', ts: 300, detail: { mem_id: 'mem_other' } }),
      audit({ request_id: 'new', action: 'memory_op', ts: 200, detail: { mem_id: MEM, op: 'pin' } }),
    ]);
    const r = await loadAuditForMemory(MEM, 1);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.map((x) => x.requestId)).toEqual(['new']);
    expect(r.view[0].summary).toContain('"op":"pin"');
  });

  it('真查失败 → error，不把失败当空集', async () => {
    queryAudit.mockRejectedValue(new Error('E_STORAGE_LOCKED'));
    const r = await loadAuditForMemory(MEM);
    expect(r).toEqual({ status: 'error', detail: '账本暂时被占用，请稍后重试' });
  });
});
