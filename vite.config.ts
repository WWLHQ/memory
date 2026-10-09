import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // UI 源码在 src/web/AgentOnboard/，产物落在 src/agentOnboard/（保持与规格 T1~T12 路径约定一致）
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 多入口：index.html（REQ-005 首页，默认路由）/ agentonboard.html（REQ-003 接入页）
    rollupOptions: {
      input: {
        main: 'index.html',
        agentonboard: 'agentonboard.html',
        overview: 'overview.html',
        inlineattribution: 'inlineAttribution.html',
      },
    },
  },
  server: { host: '127.0.0.1', port: 5180, open: 'overview.html' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/web/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});