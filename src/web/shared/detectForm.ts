// 端形态识别（19.10）：真实端壳注入，这里用 UA 粗判。
//
// 单独成文件的原因：接入页（AgentOnboardPage）与壳层「启动即自动接入」（startupAutoOnboard.ts）
// 都要用它。若留在页面组件里，壳层为了一个 UA 判断就得整页导入接入页（含 McpClientsPanel 等），
// 白白把接入页打进壳层 bundle。
import type { Form } from '../../types/agentOnboard.ts';

export function detectForm(): Form {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}
