import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 渲染层动作日志（批次7）由各页面入口显式 import '../shared/actionLog.ts' 安装。
// 不用 transformIndexHtml 注入脚本：构建产物会保留源码路径（/src/...），打包后 404。
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
        workspace: 'workspace.html',
        login: 'login.html',
        agentonboard: 'agentonboard.html',
        overview: 'overview.html',
        memory: 'memory.html',
        write: 'write.html',
        audit: 'audit.html',
        lifecycle: 'lifecycle.html',
        dispute: 'dispute.html',
        sync: 'sync.html',
        params: 'params.html',
        monitor: 'monitor.html',
        feedback: 'feedback.html',
        security: 'security.html',
        retrieval: 'retrieval.html',
        logs: 'logs.html',
        models: 'models.html',
        growth: 'growth.html',
        layered: 'memory-layered.html',
        setup: 'setup.html',
        assistant: 'assistant.html',
      },
    },
  },
  // strictPort：dev 源固定 5180 才在 CORS 白名单内；端口被占时直接失败，禁止静默漂移到 5181+
  // （漂移后的来源不在白名单，登录会表现为「后端不可达」，批次22 已修正该误导文案）
  // DEV_NO_OPEN：批次24 登录后端落到备用端口时，由 tools/dev.mjs 用 --open 带上 ?backend= 打开，
  // 这里让位，避免先把无参地址（默认 8201）开出来导致登录报「来源未被信任」。
  server: { host: '127.0.0.1', port: 5180, strictPort: true, open: process.env.DEV_NO_OPEN ? false : 'overview.html' },
  test: {
    environment: 'jsdom',
    globals: true,
    // vmThreads 池：同一 VM 上下文内共享模块实例，避免 'vitest' 被双实例化
    // （否则测试文件静态 import { describe } from 'vitest' 拿到的 runner 未初始化，
    //  报 "Cannot read properties of undefined (reading 'config')"）
    pool: 'vmThreads',
    setupFiles: ['./src/web/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/web/test-setup.ts',
        'src/**/*.d.ts',
        // 单测环境无法加载 Electron 主进程与页面入口胶水，这部分由 E2E 覆盖
        'src/electron/main.ts',
        'src/electron/preload.ts',
        'src/web/main.tsx',
        'src/**/*Entry.tsx',
      ],
      // 基线见 specs/MANUAL-TEST-FIX-BATCH-5.md；低于基线即失败，防覆盖率回退
      thresholds: {
        lines: 74,
        statements: 71,
        functions: 67,
        branches: 61,
      },
    },
  },
});