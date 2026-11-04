// 批次37-D 双库备份配方单测：各源前缀/份数滚动/历史排序，全部是纯函数（不落盘）。
// 关注点：只备记忆库=不完整备份；份数按库分算；历史列表按时间戳段排（前缀长度不同不能整串排）。
// 批次41-A：审计账本（audit.jsonl）纳进配方——审计搬出记忆库后，「备了记忆库」不再等于「备了审计」；
// 审计是 JSONL，扩展名也参与归属判定，避免 `.json` 与 `.jsonl` 互相冒充。
// 批次41-F：滚动删除只认「本配方产出」的确切时间戳形状（`isRecipeBackupName`），
// 共享目录里外来的、恰好同前缀但中间不是时间戳的文件不再被删。
import { describe, it, expect } from 'vitest';
import {
  BACKUP_EXT, BACKUP_PREFIX, isRecipeBackupName, kindOfBackupName, planBackupFiles, selectBackupsToDelete, sortBackupsNewestFirst,
  type BackupKind,
} from '../backupFiles.ts';

const PATHS: Record<BackupKind, string> = {
  ledger: 'D:/data/memories.db.json',
  l0: 'D:/data/memories.l0.json',
  keyring: 'D:/data/l0-keyring.json',
  audit: 'D:/data/audit.jsonl',
};
const TS = '2026-11-02T03-00-00-000Z';
const has = (...present: string[]) => (p: string) => present.includes(p);

describe('planBackupFiles（一次备份要复制哪些文件）', () => {
  it('四源齐全 → 四条回执，前缀分别是 memories- / meml0- / l0key- / memaudit-，missing 为空', () => {
    const plan = planBackupFiles(TS, PATHS, has(PATHS.ledger, PATHS.l0, PATHS.keyring, PATHS.audit));
    expect(plan.missing).toEqual([]);
    expect(plan.files.map((f) => f.kind)).toEqual(['ledger', 'l0', 'keyring', 'audit']);
    expect(plan.files.map((f) => f.name)).toEqual([
      `memories-${TS}.json`, `meml0-${TS}.json`, `l0key-${TS}.json`, `memaudit-${TS}.jsonl`,
    ]);
    expect(plan.files[1].src).toBe(PATHS.l0);
    expect(plan.files[3].src).toBe(PATHS.audit);
  });

  it('L0 库还没生成（新装未写入）→ 如实标 missing，不冒充"已备份原数据库"', () => {
    const plan = planBackupFiles(TS, PATHS, has(PATHS.ledger, PATHS.keyring, PATHS.audit));
    expect(plan.files.map((f) => f.kind)).toEqual(['ledger', 'keyring', 'audit']);
    expect(plan.missing).toEqual(['l0']);
  });

  it('审计账本还没生成 → missing 里点名 audit（回执不能说"四件都备好了"）', () => {
    const plan = planBackupFiles(TS, PATHS, has(PATHS.ledger, PATHS.l0, PATHS.keyring));
    expect(plan.files.map((f) => f.kind)).toEqual(['ledger', 'l0', 'keyring']);
    expect(plan.missing).toEqual(['audit']);
  });

  it('四源全无 → files 空（调用方据此判"没有可备份的数据"）', () => {
    const plan = planBackupFiles(TS, PATHS, has());
    expect(plan.files).toEqual([]);
    expect(plan.missing).toEqual(['ledger', 'l0', 'keyring', 'audit']);
  });

  it('只有 L0 原数据库（拆库后记忆库被清空）→ 仍然有备份要做，不能因为缺记忆库就整体拒绝', () => {
    const plan = planBackupFiles(TS, PATHS, has(PATHS.l0));
    expect(plan.files.map((f) => f.name)).toEqual([`meml0-${TS}.json`]);
    expect(plan.missing).toEqual(['ledger', 'keyring', 'audit']);
  });
});

describe('selectBackupsToDelete（每个库单独算保留份数）', () => {
  const names = [
    'memories-2026-11-01T00-00-00-000Z.json', 'memories-2026-11-02T00-00-00-000Z.json',
    'memories-2026-11-03T00-00-00-000Z.json',
    'meml0-2026-11-01T00-00-00-000Z.json', 'meml0-2026-11-02T00-00-00-000Z.json',
    'meml0-2026-11-03T00-00-00-000Z.json',
    'l0key-2026-11-01T00-00-00-000Z.json',
    'memaudit-2026-11-01T00-00-00-000Z.jsonl', 'memaudit-2026-11-02T00-00-00-000Z.jsonl',
    'memaudit-2026-11-03T00-00-00-000Z.jsonl',
  ];

  it('keep=2 时删各库最旧的一份，绝不跨库凑数（否则 L0/审计备份会被记忆库挤掉）', () => {
    expect(selectBackupsToDelete(names, BACKUP_PREFIX.ledger, 2))
      .toEqual(['memories-2026-11-01T00-00-00-000Z.json']);
    expect(selectBackupsToDelete(names, BACKUP_PREFIX.l0, 2))
      .toEqual(['meml0-2026-11-01T00-00-00-000Z.json']);
    expect(selectBackupsToDelete(names, BACKUP_PREFIX.keyring, 2)).toEqual([]);
    expect(selectBackupsToDelete(names, BACKUP_PREFIX.audit, 2))
      .toEqual(['memaudit-2026-11-01T00-00-00-000Z.jsonl']);
  });

  it('份数不足保留数 → 一个都不删；keep 被钳到至少 1', () => {
    expect(selectBackupsToDelete(names, BACKUP_PREFIX.ledger, 7)).toEqual([]);
    expect(selectBackupsToDelete(
      ['memories-2026-11-01T00-00-00-000Z.json', 'memories-2026-11-02T00-00-00-000Z.json'], 'memories-', 0))
      .toEqual(['memories-2026-11-01T00-00-00-000Z.json']);
  });

  it('批次41-F：外来同前缀但中间非时间戳形状的文件不参与滚动（共享目录里塞进来的同名文件不被删）', () => {
    const foreign = [
      'memories-2026-11-01T00-00-00-000Z.json', // 本配方
      'memories-2026-11-02T00-00-00-000Z.json', // 本配方
      'memories-notes.json',                        // 外来：同前缀 + .json 但中间不是时间戳
      'meml0-template.json',                         // 外来
    ];
    // keep=1：本配方两份里最旧的应删；外来的 memories-notes.json 形状不同必须原样保留
    expect(selectBackupsToDelete(foreign, BACKUP_PREFIX.ledger, 1))
      .toEqual(['memories-2026-11-01T00-00-00-000Z.json']);
    // 全外来（没有一份是时间戳形状）→ 一个都不删
    expect(selectBackupsToDelete(['memories-notes.json', 'memories-2026.json'], BACKUP_PREFIX.ledger, 1))
      .toEqual([]);
    // 审计同理：.jsonl 之外的形状不是本配方产出
    expect(selectBackupsToDelete(['memaudit-notes.jsonl'], BACKUP_PREFIX.audit, 1)).toEqual([]);
  });

  it('批次41-F：isRecipeBackupName 认「前缀 + 合法时间戳段 + 扩展名」三者齐全', () => {
    expect(isRecipeBackupName('memories-2026-11-01T00-00-00-000Z.json')).toBe(true);
    expect(isRecipeBackupName('memaudit-2026-11-01T00-00-00-000Z.jsonl')).toBe(true);
    expect(isRecipeBackupName('memories-notes.json')).toBe(false);       // 中间非时间戳
    expect(isRecipeBackupName('memories-2026.json')).toBe(false);        // 缺完整时间戳段
    expect(isRecipeBackupName('meml0-template.json')).toBe(false);
    expect(isRecipeBackupName('other.json')).toBe(false);
  });

  it('忽略非本前缀与非本扩展名文件（*.lock / *.tmp 不会被当备份删掉）', () => {
    const mixed = [...names, 'memories-2026-11-04T00-00-00-000Z.json.tmp', 'memories.l0.json.lock'];
    const picked = selectBackupsToDelete(mixed, 'memories-', 2);
    expect(picked).toEqual(['memories-2026-11-01T00-00-00-000Z.json']);
  });

  it('审计的滚动只认 .jsonl：同名 .json（手放的/旧口径产物）不会被误删', () => {
    const mixed = [
      'memaudit-2026-11-01T00-00-00-000Z.jsonl', 'memaudit-2026-11-02T00-00-00-000Z.jsonl',
      'memaudit-2026-11-03T00-00-00-000Z.json', // 不是审计备份该产出的形状
    ];
    expect(selectBackupsToDelete(mixed, BACKUP_PREFIX.audit, 1))
      .toEqual(['memaudit-2026-11-01T00-00-00-000Z.jsonl']);
  });
});

describe('历史列表排序与归属识别', () => {
  it('按时间戳段倒序：最新在前，且不会被前缀字典序带偏', () => {
    const names = [
      'l0key-2026-11-02T00-00-00-000Z.json',
      'meml0-2026-11-03T00-00-00-000Z.json',
      'memories-2026-11-01T00-00-00-000Z.json',
      'memaudit-2026-11-04T00-00-00-000Z.jsonl',
    ];
    expect(sortBackupsNewestFirst(names).map((n) => n.slice(n.indexOf('-') + 1)))
      .toEqual([
        '2026-11-04T00-00-00-000Z.jsonl',
        '2026-11-03T00-00-00-000Z.json',
        '2026-11-02T00-00-00-000Z.json',
        '2026-11-01T00-00-00-000Z.json',
      ]);
  });

  it('未知文件（备份目录里的手放文件/临时文件）不进列表', () => {
    expect(sortBackupsNewestFirst(['readme.txt', 'memories-x.json.tmp', 'backup-2026.json', 'memaudit-x.jsonl.bak']))
      .toEqual([]);
  });

  it('kindOfBackupName：认库，meml0 不误判成 memories，memaudit 不误判成 audit 之外的谁', () => {
    expect(kindOfBackupName('meml0-2026.json')).toBe('l0');
    expect(kindOfBackupName('memories-2026.json')).toBe('ledger');
    expect(kindOfBackupName('l0key-2026.json')).toBe('keyring');
    expect(kindOfBackupName('memaudit-2026.jsonl')).toBe('audit');
    expect(kindOfBackupName('other.json')).toBeNull();
  });

  it('BACKUP_EXT：只有审计是 JSONL，其余仍是 .json（备份文件格式与源文件一致）', () => {
    expect(BACKUP_EXT.audit).toBe('.jsonl');
    expect([BACKUP_EXT.ledger, BACKUP_EXT.l0, BACKUP_EXT.keyring]).toEqual(['.json', '.json', '.json']);
  });
});
