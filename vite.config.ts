import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // UI 源码在 src/web/AgentOnboard/，产物落在 src/agentOnboard/（保持与规格 T1~T12 路径约定一致）
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5180 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/web/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});