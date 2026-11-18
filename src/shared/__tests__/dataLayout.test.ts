// 档2 子目录归类映射的回归锁（2026-11-18）。
// 变异锚点：把 FILE_PLACEMENT 任一关键项改回根目录 / 把 audit 拆出 / 把 backups 双层映射，
// 下列用例必须红灯——它们是「写 A 读 B 分叉」的第一道防线。
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  DATA_SUBDIRS, classifiedPath, classifiedDir, libraryDir, isChromiumReservedSubdir, subdirForFile, subdirForDir,
} from '../dataLayout.ts';

const ROOT = 'D:\\MultiAgent Memory';

describe('档2 · 数据根子目录归类布局', () => {
  it('七个子目录名固定不漂移', () => {
    expect(DATA_SUBDIRS).toEqual({
      data: 'data', config: 'config', keys: 'keys', accounts: 'accounts',
      logs: 'logs', exports: 'exports', backups: 'backups',
    });
  });

  // 2026-11-18 事故锁：库目录曾叫 databases，撞 Chromium userData 保留名 → 每次启动被引擎整目录删除。
  // 这条断言是唯一能提前拦住「好心改个名字」的防线，宁可红灯也不要再清一次库。
  it('任何归类子目录名都不得撞 Chromium 保留名（databases 事故锁）', () => {
    for (const name of Object.values(DATA_SUBDIRS)) {
      expect(isChromiumReservedSubdir(name), `子目录 ${name} 撞了 Chromium 保留名`).toBe(false);
    }
    expect(isChromiumReservedSubdir('databases')).toBe(true);
    expect(isChromiumReservedSubdir('DataBases')).toBe(true);
    expect(isChromiumReservedSubdir('data')).toBe(false);
  });

  it('密钥与令牌归 keys（与钩子 / 网关 / 主进程同落点）', () => {
    for (const f of ['mcp-token.txt', 'mcp-tokens.json', 'llm-keys.json', 'llm-billing-keys.json', 'llm-deepseek-key.txt', 'tenant.json', 'members.json', 'personal-owner-bindings.json']) {
      expect(classifiedPath(ROOT, f)).toBe(join(ROOT, 'keys', f));
    }
  });

  it('配置类 json 归 config', () => {
    for (const f of ['llm-config.json', 'recall-hard-config.json', 'collector-cursor.json', 'backup-config.json', 'agent-onboard.json', 'chat-exports.json', 'webchat-ingest.json', 'webchat-export-status.json', 'refine-queue.json']) {
      expect(classifiedPath(ROOT, f)).toBe(join(ROOT, 'config', f));
    }
  });

  it('日志与召回状态归 logs', () => {
    for (const f of ['main.log', 'actions.log', 'float.log', 'recall-hook-status.json', 'recall-hook-log.jsonl']) {
      expect(classifiedPath(ROOT, f)).toBe(join(ROOT, 'logs', f));
    }
  });

  it('home-* 全家（含镜像密钥）归 accounts 且同目录（home/server.ts 依赖 dirname(auditFile)）', () => {
    for (const f of ['home-accounts.json', 'home-locks.json', 'home-audit.json', 'home-mirror.json', 'home-policy.json', 'home-mirror.key']) {
      expect(classifiedPath(ROOT, f)).toBe(join(ROOT, 'accounts', f));
    }
  });

  it('个人记忆库归 data（独立于主库）', () => {
    expect(classifiedPath(ROOT, 'personal-memory.db.json')).toBe(join(ROOT, 'data', 'personal-memory.db.json'));
  });

  it('两库默认目录指向 data；审计不单独归类（随库走，铁律）', () => {
    expect(libraryDir(ROOT)).toBe(join(ROOT, 'data'));
    expect(subdirForFile('audit.jsonl')).toBeNull();
    expect(subdirForFile('memories.db.json')).toBeNull();
    expect(subdirForFile('memories.l0.json')).toBeNull();
    expect(subdirForFile('l0-keyring.json')).toBeNull();
  });

  it('backups 保持根级，不产生 backups/backups 双层', () => {
    expect(subdirForDir('backups')).toBeNull();
    expect(classifiedDir(ROOT, 'backups')).toBe(join(ROOT, 'backups'));
  });

  it('导出类目录归 exports；Electron 自管目录不留映射', () => {
    expect(classifiedDir(ROOT, 'memories-export')).toBe(join(ROOT, 'exports', 'memories-export'));
    expect(classifiedDir(ROOT, 'webchat-verify')).toBe(join(ROOT, 'exports', 'webchat-verify'));
    for (const d of ['Cache', 'Code Cache', 'Local Storage', 'GPUCache', 'sync-hub', 'recall-hard', 'webchat-extension']) {
      expect(subdirForDir(d)).toBeNull();
      expect(classifiedDir(ROOT, d)).toBe(join(ROOT, d));
    }
  });

  it('未登记文件保持根级（后方兼容面，绝不误搬）', () => {
    expect(classifiedPath(ROOT, 'some-unknown-file.json')).toBe(join(ROOT, 'some-unknown-file.json'));
    expect(subdirForFile('some-unknown-file.json')).toBeNull();
  });
});
