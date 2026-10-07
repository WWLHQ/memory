// 真实后端镜像（接T13/T14）：把 UI 动作 best-effort 打到后端，并在挂载时 GET /agents 回填。
// ⚠ 不改变原型视觉与同步交互：失败仅静默（页面与原型完全一致）。
import { useEffect, useRef } from 'react';
import { AgentOnboardService } from '../../agentOnboard/service.ts';
import { AgentOnboardClient } from '../../agentOnboard/client.ts';
import type { AgentCardInput, Form } from '../../types/agentOnboard.ts';
import type { UiAgentCard } from '../../types/agentOnboard.ts';

/** 默认本地 T13 后端；留空则纯前端（与原型一致）。可用 ?backend= 覆盖。 */
export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export function createService(url: string): AgentOnboardService<AgentOnboardClient | null> {
  return url ? new AgentOnboardService<AgentOnboardClient>(new AgentOnboardClient(url)) : new AgentOnboardService();
}

/** UiAgentCard（原型形状）→ 服务层入参（只取可映射字段） */
export function toServiceInput(a: UiAgentCard): AgentCardInput {
  return {
    agent_name: a.name,
    priority: a.badge.toUpperCase() as AgentCardInput['priority'],
    circuit: a.circuit === 'HALF_OPEN' ? 'HALF_OPEN' : a.circuit === 'OPEN' ? 'OPEN' : 'CLOSED',
    tenantManual: false, // R1：租户仅全局注入
    mcpTools: {
      recall_memory: { project_id: 'p1', scene: a.tools.recall.scene, mode: a.tools.recall.mode || null, top_k: a.tools.recall.topk },
      write_memory: { project_id: 'p1' },
      get_user_preferences: { user_id: 'u1' },
    },
    channels: { webhook: a.chan.webhook, apiPull: a.chan.api },
  };
}

export interface BackendMirror {
  svc: AgentOnboardService<AgentOnboardClient | null>;
  test: (name: string) => void;
  rotate: (name: string) => void;
  save: (a: UiAgentCard) => void;
  discover: (names: Array<{ name: string; priority: string; signal: string }>, form: Form) => void;
  unbind: (name: string) => void;
}

/**
 * 挂载一个后端镜像。返回的各方法均为 fire-and-forget：
 * 后端不可达时不抛、不阻塞 UI（原型语义优先）。
 */
export function useBackendMirror(): BackendMirror {
  const svcRef = useRef<ReturnType<typeof createService> | null>(null);
  if (!svcRef.current) svcRef.current = createService(resolveBackendUrl());

  useEffect(() => {
    const svc = svcRef.current!;
    // 初始加载：拉取后端已有卡片（失败静默，页面仍与原型一致）
    void Promise.resolve(svc.getCards()).catch(() => {});
  }, []);

  const bg = (fn: (svc: ReturnType<typeof createService>) => unknown) => {
    const svc = svcRef.current!;
    try {
      const r = fn(svc);
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
    } catch {
      /* 后端不可达：忽略，保持原型同步交互 */
    }
  };

  return {
    svc: svcRef.current,
    test: (name) => bg((s) => s.testConnect(name)),
    rotate: (name) => bg((s) => s.rotateKey(name)),
    save: (a) => bg((s) => s.configure(toServiceInput(a))),
    discover: (agents, f) => bg((s) => s.oneClickOnboard(agents as never, f)),
    unbind: (name) => bg((s) => s.revokeBind(name)),
  };
}