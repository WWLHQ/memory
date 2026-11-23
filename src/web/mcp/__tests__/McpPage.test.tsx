// MCP 接入页（2026-11-21）：独立整页的渲染契约。
// 数据口径与迁入前一致：仅宿主真扫；浏览器（jsdom）无宿主桥时如实降级，不伪造客户端/「已接入」。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McpPage } from '../McpPage.tsx';

describe('MCP 接入页', () => {
  it('渲染独立页头与客户端接入状态面板（同一真值面板，不复制数据源）', async () => {
    render(<McpPage />);
    expect(screen.getByTestId('mcp-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MCP 接入' })).toBeInTheDocument();
    expect(await screen.findByTestId('mcp-clients')).toBeInTheDocument();
  });

  it('顶部摘要读数条 + 五个场景分组真实存在（浏览器模式如实空态）', async () => {
    render(<McpPage />);
    expect(screen.getByTestId('mcp-summary')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-groups')).toBeInTheDocument();
    for (const id of ['status', 'server', 'probe', 'clients', 'errors']) {
      expect(screen.getByTestId(`mcp-group-${id}`)).toBeInTheDocument();
    }
    // 浏览器模式：已安装 0、错误码 0，不伪造「已接入」
    expect(screen.getByTestId('mcp-group-status')).toHaveTextContent('已接入 0');
  });

  it('浏览器模式无宿主桥 → 如实说明无法读取本机配置，不列客户端、不写「已接入」', async () => {
    render(<McpPage />);
    expect(await screen.findByTestId('mcp-browser-note')).toHaveTextContent('浏览器模式无法读取本机客户端配置');
    expect(screen.getByTestId('mcp-browser-note')).toHaveTextContent('不列出任何客户端');
    // 状态摘要只可能为空态文案，不会出现客户端表格
    expect(screen.queryByTestId('mcp-table')).toBeNull();
  });
});
