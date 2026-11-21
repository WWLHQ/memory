// 个人记忆独立页入口（批次57）：记忆库页签精简后 PersonalMemoryPane 的新宿主。
// E2E（e2e/personal.spec.ts）与直达 URL 都走本页；壳层常驻面板（PersonalMemoryPanel）不受影响。
// 样式自包含：PersonalMemoryPane 自己 import personalMemoryPane.css，不覆盖宿主全局。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import { useKernelLoad } from '../shared/kernelLoad.tsx';
import { loadPersonalSnapshot } from '../shared/personalPort.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import type { PersonalSnapshot } from '../../core/memagent/personal.ts';
import { PersonalMemoryPane } from './PersonalMemoryPane.tsx';
import './memoryManagement.css'; // 仅取 .mm-app 全页容器样式（pane 需要一个 flex 列宿主）

export function PersonalMemoryStandalonePage() {
  useHostTheme();
  const pm = useKernelLoad<PersonalSnapshot>('personal-standalone', loadPersonalSnapshot);
  return (
    <div className="mm-app" data-testid="pm-page">
      <PersonalMemoryPane
        phase={pm.phase}
        data={pm.data}
        error={pm.error}
        onRetry={pm.retry}
        onChanged={pm.replace}
      />
    </div>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <PersonalMemoryStandalonePage />
    </StrictMode>,
  );
}
