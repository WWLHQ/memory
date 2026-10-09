// REQ-004 T9 配置上下文 + 可开关与降级（诚实约束）
// 来源：需求规格书_Agent界面内联记忆标识.md §4（可开关、降级）、设计/ui 原型 177-192 行开关逻辑
// 各标记组件消费 useAttributionConfig().isVisible(kind) 决定自身是否渲染；
// aging / evidence_thin 恒显示（诚实约束，不可被 off 关闭）。
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AttributionConfig as Config, AttributionLevel } from '../../types/inlineAttribution.ts';

/** 标识种类（用于 isVisible 判断） */
export type MarkKind = 'injection' | 'token' | 'background' | 'writeback' | 'aging' | 'evidence_thin';

export interface AttributionConfigApi {
  config: Config;
  level: AttributionLevel;
  /** 某类标识是否应渲染。aging/evidence_thin 恒 true（诚实约束） */
  isVisible: (kind: MarkKind) => boolean;
  setLevel: (level: AttributionLevel) => void;
  setEnabled: (on: boolean) => void;
}

const Ctx = createContext<AttributionConfigApi | null>(null);

const DEFAULT: Config = { show_memory_attribution: true, attribution_level: 'full' };

export function AttributionConfigProvider({
  value,
  children,
}: {
  value?: Config;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<Config>(value ?? DEFAULT);
  const api = useMemo<AttributionConfigApi>(() => {
    const isVisible = (kind: MarkKind): boolean => {
      // 诚实约束：老化/证据警示必须显示，不可被关闭
      if (kind === 'aging' || kind === 'evidence_thin') return true;
      if (!config.show_memory_attribution) return false;
      if (config.attribution_level === 'full') return true;
      if (config.attribution_level === 'token_only') return kind !== 'injection';
      // off：仅 aging/evidence_thin 仍显示，其余全隐
      return false;
    };
    return {
      config,
      level: config.attribution_level,
      isVisible,
      setLevel: (level) => setConfig((c) => ({ ...c, attribution_level: level })),
      setEnabled: (on) => setConfig((c) => ({ ...c, show_memory_attribution: on })),
    };
  }, [config]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAttributionConfig(): AttributionConfigApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useAttributionConfig 必须在 AttributionConfigProvider 内使用');
  return api;
}
