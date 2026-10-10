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
        memory: 'memory.html',
        write: 'write.html',
        audit: 'audit.html',
        lifecycle: 'lifecycle.html',
        dispute: 'dispute.html',
        params: 'params.html',
        monitor: 'monitor.html',
        feedback: 'feedback.html',
        security: 'security.html',
        retrieval: 'retrieval.html',
        logs: 'logs.html',
      },
    },
  },
  server: { host: '127.0.0.1', port: 5180, open: 'overview.html' },
  test: {
    environment: 'jsdom',
    globals: true,
    // vmThreads 池：同一 VM 上下文内共享模块实例，避免 'vitest' 被双实例化
    // （否则测试文件静态 import { describe } from 'vitest' 拿到的 runner 未初始化，
    //  报 "Cannot read properties of undefined (reading 'config')"）
    pool: 'vmThreads',
    setupFiles: ['./src/web/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});