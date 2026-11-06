// 全局参数页（REQ-006 / P5）数据模型
// 规格：17.6 文案化（G7 不暴露参数名）/ 2.4.3 权重 / 2.4.1 payload / 15.1 等级映射 / 9.10 N·M。

/** 遗忘速度档位（17.6） */
export type ForgetSpeed = 'slow' | 'mid' | 'fast';
/** 保留时长档位 */
export type Retention = 'long' | 'months' | 'weeks' | 'short';
/** 重要程度档位 */
export type ImportanceLevel = 'normal' | 'important' | 'locked';

/** 普通配置（文案化四项 + 批次11 成本单价） */
export interface NormalConfig {
  forget_speed: ForgetSpeed;
  retention: Retention;
  auto_organize: boolean;
  importance: ImportanceLevel;
  /** 成本单价（¥ / 百万预算单位 t）；null = 未设置，聊天提示不显示金额 */
  cost_cny_per_mtok: number | null;
  /** 批次48 A16 反代理单价（¥/千次，云端引擎）；null = 未设置（不伪造金额，该源不参与自动路由） */
  proxy_price_cny_per_kcall: number | null;
  /** 批次48 A16 反代理日配额（次/日）；null = 未设置（无法算预算/余量，该源不参与自动路由） */
  proxy_daily_quota: number | null;
}

/** 知识库策略行（17.6 六类知识库） */
export interface KbPolicyRow {
  kb: string;
  half_life_days: number;
  archive_days: number;
  merge_on: boolean;
}

/** 开发者模式底层参数 */
export interface DevParams {
  /** 各模式权重 w_f/w_i/w_c/w_a，和=1.0（2.4.3） */
  weights: { w_f: number; w_i: number; w_c: number; w_a: number };
  /** payload 软上限/告警/熔断（2.4.1 三档递增） */
  payload: { soft: number; warn: number; break: number };
  /** Cold/dormant 补查阈值（15.3） */
  cold: { cold_sim: number; dormant_sim: number; top1_min: number; l2_max_tokens: number };
  /** 老化 N/M 天（9.10，N<M） */
  n_days: number;
  m_days: number;
}
