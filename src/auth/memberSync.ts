// 批次45-B2：home 账号 ↔ 内核 Member 打通。
// home 侧（loginService 的 AccountView：account/role/team_id/enterprise_id）是账号身份的真源；
// 内核 memberStore 是「这是个 member」的域（45-B1 落地，此前无人登记、恒为空表）。
// 本模块做**单向 upsert 同步**（home → kernel）：
//   · home 新账号 → 内核登记 Member（member_id = home 账号名，user_id 同名——登录会话身份即账号名）；
//   · home 角色/团队/企业变更 → 内核 updateMember 跟随（member_id/user_id 是身份锚点，绝不改）；
//   · home 没有的内核成员（未来工具手工建的）**不删除**——同步只做 upsert，不越权清表。
// status 不参与同步：home 无「停用」概念，suspended 是内核侧保留状态（45-B3 门禁用），同步绝不覆盖。
// 幂等：第二次跑 created=updated=0。零明文（不碰密码哈希——那是 loginService 的域）。
import { listAccounts, type AccountView } from './loginService.ts';
import type { MemberStorePort } from '../core/memagent/memberStore.ts';

export interface MemberSyncReport {
  /** home 账号视图数 */
  scanned: number;
  /** 内核新登记的成员数 */
  created: number;
  /** 角色/团队/企业发生变更被跟随更新的成员数 */
  updated: number;
  /** 两边一致、零写盘的成员数 */
  unchanged: number;
  /** 变更明细样本（审计与日志用；不含任何秘密） */
  changes: Array<{ member_id: string; fields: string[] }>;
}

/** 单向 upsert 同步：home 账号视图 → 内核成员库（幂等；by 固定 'home-sync' 留痕） */
export function syncMembersFromHome(store: MemberStorePort, views: AccountView[], now?: number): MemberSyncReport {
  const report: MemberSyncReport = { scanned: 0, created: 0, updated: 0, unchanged: 0, changes: [] };
  for (const v of views) {
    report.scanned++;
    const existing = store.getMember(v.account);
    if (!existing) {
      store.createMember({
        member_id: v.account,
        name: v.account,
        role: v.role,
        user_id: v.account,
        team_id: v.team_id,
        enterprise_id: v.enterprise_id,
        status: 'active',
        created_by: 'home-sync',
      }, now);
      report.created++;
      report.changes.push({ member_id: v.account, fields: ['created'] });
      continue;
    }
    const fields: string[] = [];
    if (existing.role !== v.role) fields.push('role');
    if (existing.team_id !== v.team_id) fields.push('team_id');
    if (existing.enterprise_id !== v.enterprise_id) fields.push('enterprise_id');
    if (fields.length === 0) { report.unchanged++; continue; }
    store.updateMember(v.account, {
      role: v.role,
      team_id: v.team_id,
      enterprise_id: v.enterprise_id,
    }, 'home-sync', now);
    report.updated++;
    report.changes.push({ member_id: v.account, fields });
  }
  return report;
}

/** 便捷入口：直接从 loginService 当前账号快照同步（server/main 两处接线共用） */
export function syncMembersFromHomeNow(store: MemberStorePort): MemberSyncReport {
  return syncMembersFromHome(store, listAccounts());
}
