// 批次41-A 审计账本验收（auditLog.ts）：追加式 JSONL、归档轮转不删数据、只读镜像增量读、坏行可见。
// 契约核心：拆文件之后 queryAudit 仍是「全量真数据」，且任何路径都不允许已写入的审计行消失。
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIT_FILE_NAME, AuditLogCorruptError, AuditLogLockedError, FileAuditLog,
} from '../auditLog.ts';
import type { AuditRecord } from '../types.ts';

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return { request_id: `req_${Math.random().toString(36).slice(2)}`, action: 'write', ts: Date.now(), detail: {}, ...over } as AuditRecord;
}
function lines(dir: string, file: string): string[] {
  return readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => l.trim().length > 0);
}

describe('FileAuditLog（追加式审计账本 · 批次41-A）', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auditlog-'));
    file = join(dir, AUDIT_FILE_NAME);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('账本不存在 → 空账本（不抛、不预建文件）', () => {
    const log = new FileAuditLog(file);
    expect(log.count()).toBe(0);
    expect(existsSync(file)).toBe(false);
    const s = log.stats();
    expect(s).toMatchObject({ path: file, rows: 0, bytes: 0, archive_files: 0, skipped_lines: 0, readonly: false });
  });

  it('append 一行 = 文件里一行；新实例按写入顺序读回', () => {
    const log = new FileAuditLog(file);
    const a = rec({ request_id: 'req_a', ts: 100 });
    const b = rec({ request_id: 'req_b', ts: 200 });
    log.append(a);
    log.append(b);
    expect(lines(dir, AUDIT_FILE_NAME).length).toBe(2);
    log.close();
    const again = new FileAuditLog(file);
    expect(again.list().map((r) => r.request_id)).toEqual(['req_a', 'req_b']);
  });

  it('query 三种过滤都打到真数据（日志页「按 request_id 真查」依赖这条）', () => {
    const log = new FileAuditLog(file);
    log.append(rec({ request_id: 'req_x', action: 'write', ts: 10 }));
    log.append(rec({ request_id: 'req_y', action: 'recall', ts: 20 }));
    log.append(rec({ request_id: 'req_x', action: 'gc', ts: 30 }));
    expect(log.query({ request_id: 'req_x' }).map((r) => r.action)).toEqual(['write', 'gc']);
    expect(log.query({ action: 'recall' }).map((r) => r.request_id)).toEqual(['req_y']);
    expect(log.query({ since: 25 }).map((r) => r.request_id)).toEqual(['req_x']);
    expect(log.query({}).length).toBe(3);
  });

  it('尾行截断（掉电残留）：前面的行照读，坏行只计数不猜', () => {
    const good = rec({ request_id: 'req_ok' });
    writeFileSync(file, `${JSON.stringify(good)}\n{"request_id":"req_half","act`, 'utf8');
    const log = new FileAuditLog(file);
    expect(log.list().map((r) => r.request_id)).toEqual(['req_ok']);
    expect(log.stats().skipped_lines).toBe(1);
  });

  it('整档一行都认不出 → 显式抛错 + 原件改名保留；下一次启动按空账本继续（绝不静默空账本）', () => {
    writeFileSync(file, '这不是 JSON\n也不是 JSON\n', 'utf8');
    const before = readFileSync(file, 'utf8');
    let caught: unknown = null;
    try {
      new FileAuditLog(file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AuditLogCorruptError);
    const err = caught as AuditLogCorruptError;
    expect(err.code).toBe('E_AUDIT_LOG_CORRUPT');
    expect(err.backupPath).toContain('.corrupt');
    expect(readFileSync(err.backupPath as string, 'utf8')).toBe(before);
    const retry = new FileAuditLog(file);
    expect(retry.count()).toBe(0);
  });

  it('批量模式：未提交只在内存视图里，commit 一次落盘；close 兜底提交', () => {
    const log = new FileAuditLog(file);
    log.beginBatch();
    log.append(rec({ request_id: 'req_p1' }));
    log.append(rec({ request_id: 'req_p2' }));
    expect(log.count()).toBe(2);
    expect(existsSync(file)).toBe(false); // 攒批期间不落盘（写放大归零的另一半）
    log.commitBatch();
    expect(lines(dir, AUDIT_FILE_NAME).map((l) => JSON.parse(l).request_id)).toEqual(['req_p1', 'req_p2']);
    log.close();

    const log2 = new FileAuditLog(file);
    log2.beginBatch();
    log2.append(rec({ request_id: 'req_p3' }));
    log2.close(); // 没 commit 就关：缓冲必须落盘，否则「内存有、账本没有」
    expect(lines(dir, AUDIT_FILE_NAME).map((l) => JSON.parse(l).request_id))
      .toEqual(['req_p1', 'req_p2', 'req_p3']);
  });

  it('appendMany 一次补齐（存量迁移）：整批一个写动作，顺序与传入一致', () => {
    const log = new FileAuditLog(file);
    const legacy = [rec({ request_id: 'req_l1', ts: 1 }), rec({ request_id: 'req_l2', ts: 2 }), rec({ request_id: 'req_l3', ts: 3 })];
    log.appendMany(legacy);
    log.appendMany([]);
    expect(lines(dir, AUDIT_FILE_NAME).length).toBe(3);
    expect(log.list().map((r) => r.request_id)).toEqual(['req_l1', 'req_l2', 'req_l3']);
  });

  it('超闸门只「换文件」不删数据：整档进 audit-archive/，旧行仍在全量视图里可查', () => {
    const seed = new FileAuditLog(file);
    seed.append(rec({ request_id: 'req_old', action: 'write' }));
    seed.append(rec({ request_id: 'req_mid', action: 'recall' }));
    const twoLinesBytes = statSync(file).size;
    seed.close();

    // 闸门正好卡在「两行」：第三行写进来即触发轮转（轮转发生在写之后，所以整档三行一起进归档）
    const log = new FileAuditLog(file, { maxBytes: twoLinesBytes });
    expect(log.stats().archive_files).toBe(0);
    log.append(rec({ request_id: 'req_new', action: 'gc' }));
    const rotated = log.stats();
    expect(rotated.archive_files).toBe(1);
    expect(existsSync(file)).toBe(false); // 在档文件被整档移走，不是被清空
    expect(rotated.rows).toBe(3);
    expect(rotated.archived_rows).toBe(3);
    expect(rotated.bytes).toBe(0);

    log.append(rec({ request_id: 'req_after', action: 'write' }));
    const s = log.stats();
    expect(s.rows).toBe(4);
    expect(s.bytes).toBe(statSync(file).size);
    // 归档与在档在同一视图：按 request_id 真查照样命中轮转前的旧行
    expect(log.query({ request_id: 'req_old' }).map((r) => r.action)).toEqual(['write']);
    expect(log.list().map((r) => r.request_id)).toEqual(['req_old', 'req_mid', 'req_new', 'req_after']);
    const names = readdirSync(join(dir, 'audit-archive'));
    expect(names.length).toBe(1);
    expect(lines(dir, join('audit-archive', names[0])).length).toBe(3);
  });

  it('只读镜像：写方追加后按新字节增量可见；写方轮转（文件变短）后整体重载，一条不丢', () => {
    const writer = new FileAuditLog(file);
    writer.append(rec({ request_id: 'req_w1' }));
    const mirror = new FileAuditLog(file, { readonly: true });
    expect(mirror.list().map((r) => r.request_id)).toEqual(['req_w1']);
    expect(mirror.stats().readonly).toBe(true);

    writer.append(rec({ request_id: 'req_w2' }));
    writer.append(rec({ request_id: 'req_w3' }));
    expect(mirror.query({ request_id: 'req_w2' }).length).toBe(1); // 只读追加可见
    expect(mirror.count()).toBe(3);

    // 写方轮转后在档文件变短 → 镜像整体重载，把归档行也装回视图
    const sizeBefore = statSync(file).size;
    const rotator = new FileAuditLog(file, { maxBytes: sizeBefore - 1 }); // 下一次写即触发轮转
    rotator.append(rec({ request_id: 'req_w4' }));
    expect(mirror.list().map((r) => r.request_id))
      .toEqual(['req_w1', 'req_w2', 'req_w3', 'req_w4']);
    expect(mirror.stats().archive_files).toBe(1);
    writer.close();
    rotator.close();
  });

  it('只读实例绝不写盘、绝不改名别人的账本', () => {
    const writer = new FileAuditLog(file);
    writer.append(rec({ request_id: 'req_locked' }));
    const before = readFileSync(file, 'utf8');
    const mirror = new FileAuditLog(file, { readonly: true });
    expect(() => mirror.append(rec({ request_id: 'req_nope' }))).toThrow(AuditLogLockedError);
    expect(() => mirror.beginBatch()).toThrow(AuditLogLockedError);
    expect(() => mirror.appendMany([rec()])).toThrow(AuditLogLockedError);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('审计行原样保真（detail 结构不被改写）：日志页按 detail 字段回显依赖这条', () => {
    const log = new FileAuditLog(file);
    const a = rec({ request_id: 'req_shape', detail: { op: 'layer_refine', to_layer: 'L3', n: 1 } });
    log.append(a);
    log.close();
    const got = new FileAuditLog(file).query({ request_id: 'req_shape' })[0];
    expect(got.detail).toEqual({ op: 'layer_refine', to_layer: 'L3', n: 1 });
    expect(got.action).toBe('write');
  });
});
