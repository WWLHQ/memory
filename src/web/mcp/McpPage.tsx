// MCP 接入页（2026-11-21 新增）：导航「连接」组的独立视图。
//
// 职责：承载 MCP 客户端接入状态面板（自 Agent 接入页整块迁入，避免两处重复展示）。
// 数据口径与迁入前完全一致：客户端清单 / 已安装 / 连通 / 令牌状态全部来自主进程 mcp:clients 真扫，
// 无宿主桥时如实降级，绝不伪造「已接入」。
import { useHostTheme } from '../shared/hostTheme.ts';
import { McpClientsPanel } from '../AgentOnboard/McpClientsPanel.tsx';
import '../AgentOnboard/theme.css';

export function McpPage() {
  useHostTheme();
  return (
    <div className="p0-page" data-testid="mcp-page">
      <div className="p0-hd">
        <h2>🧩 MCP 接入</h2>
        <span className="p0-tag">连接 · MCP 客户端接入状态</span>
      </div>
      <div className="sub">
        MCP 客户端（Claude Desktop / Cursor / Cline 等）的接入状态、配置写入与实测连通。
        面板自 Agent 接入页迁入（2026-11-21），数据仍由主进程只读扫描本机真实配置，未安装的客户端不占位。
      </div>
      <McpClientsPanel />
    </div>
  );
}

export default McpPage;
