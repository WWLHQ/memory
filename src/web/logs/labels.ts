// 日志页展示标签（规格常量）。日志数据真相 = 内核审计账本，无演示日志。
export const ACTION_LABEL: Record<string, string> = {
  recall: '召回', write: '写入', graft: '分支嫁接', gc: '清理归档', auto_bind: 'Agent绑定', unbound: '解绑',
  sync_up: '同步上行', sync_down: '同步下行', sync_fail: '同步失败', sync_reconcile: '对账',
  conflict_resolve: '冲突裁决', llm_proxy: 'LLM代理', llm_fallback: 'LLM回退',
  l0_view: 'L0查阅', l0_auth_fail: 'L0授权失败', l0_auth_request: 'L0查阅申请',
  l0_auth_grant: 'L0授权发放', l0_auth_deny: 'L0申请拒绝', l0_auth_revoke: 'L0授权撤销',
  l0_auth_expire: 'L0授权过期', security_change: '安全变更', memory_op: '记忆操作',
  login: '登录', team_assign: '团队分配',
  mode_dispatch: '模式分流', mode_feedback: '模式反馈', dispatch_config_applied: '分流配置已生效', dispatch_config_fallback: '分流配置已回退', depth_guard: '深度守卫', conflict_arbitrated: '冲突仲裁', rerank_fallback: '重排回退', audit_delete: '审计删除',
  // P1-9：MCP 侧分段耗时埋点（技术账本）。日志页若收录也必须出中文，不得露出英文动作名。
  mcp_timing: '召回分段耗时',
};

export const FORM_LABEL: Record<string, string> = {
  desktop: '桌面', web: 'Web', mobile: '移动', mac: 'macOS', linux: 'Linux', cli: 'CLI',
};
