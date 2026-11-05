// 审计日志页后端镜像（T5）：沿用 ?backend= 覆盖模式。
// 内核审计账本是真相；mirrorClient 真接 home server 的 POST /api/mirror/audit（见 src/home/server.ts，持久账本）。
// 阶段5-A 纠正旧声明：旧注释误称端点不存在、把真上抛说成空操作；端点已实现且有服务端测试。
// 实际语义是：?backend= 显式关闭时跳过上抛；fire-and-forget 失败由 mirrorClient 记录，经全局提示条与运行日志可见（不谎报已上抛）。
import { mirrorReport } from '../mirrorClient.ts';

export interface AuditMirror {
  /** 审计查询/导出上抛：真发 /api/mirror/audit；未配置后端时跳过 */
  audit: (action: string) => void;
}

export function useAuditMirror(): AuditMirror {
  return {
    audit: (action) => {
      // G6 上抛：audit_query / audit_chain
      mirrorReport('audit', action);
    },
  };
}
