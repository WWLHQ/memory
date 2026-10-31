// REQ-003 接入页入口（原 index.html 默认页，因 REQ-005 首页路由决策迁至独立入口，保留 REQ-003 验证）
// 包 TenantProvider + useLoginMirror：接入页与首页共享同一登录上下文，
// 租户字段（enterprise_id / team_id）从真实 TenantContext 读取，不再用种子硬编码。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { AgentOnboardPage } from './AgentOnboardPage.tsx';
import { TenantProvider } from '../Home/tenantContext.tsx';
import { useLoginMirror } from '../Home/useLoginMirror.ts';
import { homeBaseUrl } from '../backend.ts';

function OnboardApp() {
  const mirror = useLoginMirror();
  // home server URL（?backend= 覆盖），用于 /api/me 恢复租户上下文
  const backendUrl = homeBaseUrl();
  return (
    <TenantProvider loginFn={mirror.login} onLogout={mirror.logout} backendUrl={backendUrl}>
      <AgentOnboardPage />
    </TenantProvider>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 agentonboard.html）');

createRoot(el).render(
  <StrictMode>
    <OnboardApp />
  </StrictMode>,
);
