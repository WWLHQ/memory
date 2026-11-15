// 全站 UI「人话名」唯一真源（2026-11-14 用户硬性要求：UI 不出原始字段名 / JSON / 英文枚举）。
// 两处用途共用本文件，禁止在页面里再写第二套词表：
//   ① 召回权重四分量 w_f/w_i/w_c/w_a → 新鲜度/重要性/置信度/访问热度；
//   ② 监控仪表盘 13 张指标卡 + 5 个分组 → 短中文名（专业术语 ≤5 字）、一句白话、阈值与依据的人话。
// 数据层/审计层仍用原始键（账本契约不动），只在渲染时翻译；查不到键时给「没有可翻译的明细」，
// 不拿原始字段名 / 英文枚举 / JSON 兜底给用户。
// 2026-11-15 用户拍板：短名 ≤5 字 + 一句白话；删死信卡，队列组改「精炼队列」。
import { RECALL_KEYS, type RecallWeights } from '../../shared/growthConfig.ts';

export const RECALL_KEY_LABEL: Record<keyof RecallWeights, string> = {
  w_f: '新鲜度',
  w_i: '重要性',
  w_c: '置信度',
  w_a: '访问热度',
};

/** 四维权重 → 人话串：`新鲜度 0.35 · 重要性 0.30 · 置信度 0.15 · 访问热度 0.20` */
export function fmtRecallWeights(w: RecallWeights): string {
  return RECALL_KEYS.map((k) => `${RECALL_KEY_LABEL[k]} ${w[k].toFixed(2)}`).join(' · ');
}

/* ---------- 监控仪表盘（REQ-006 · 12.1）人话文案 ---------- */

export interface MonitorText {
  /** 卡片短名：纯中文，专业术语 ≤5 字，不含字段名 / 英文枚举 / 规格编号 */
  label: string;
  /** 一句白话：说明这项在量什么、数字怎么来的 */
  hint: string;
  /** 数值单位的人话 */
  unit: string;
  /** 阈值的人话 */
  threshold: string;
  /** 口径来源的人话（不显示 2.4.1、P10 之类编号） */
  basis: string;
}

/**
 * 键 = useMonitorReal.ts 里稳定的内部指标键（账本/测试标识，不进 UI）。
 * 值 = 用户看到的全部文案。新增指标必须同时在这里补一条，否则 UI 会显示「没有可翻译的明细」。
 */
export const MONITOR_METRIC_TEXT: Record<string, MonitorText> = {
  '连通成功率(5min)': {
    label: '连通率',
    hint: '近 5 分钟里，本机服务能连上的次数占比；由主进程定时拨测真实记录。',
    unit: '%',
    threshold: '低于 95% 提醒',
    basis: '拨测记录',
  },
  '熔断状态': {
    label: '熔断',
    hint: '连续连不上时自动暂停连接，避免一直重试；这里显示当前是否被切断。',
    unit: '',
    threshold: '切断即严重',
    basis: '拨测记录',
  },
  '平均延迟': {
    label: '平均延迟',
    hint: '最近几次拨测的平均等待时间。',
    unit: '秒',
    threshold: '超过 5 秒提醒',
    basis: '拨测记录',
  },
  '精炼队列': {
    label: '精炼队列',
    hint: '原始记忆排队整理成可检索内容的进度：成功、失败、等待各多少条。',
    unit: '',
    threshold: '等待超 1000 提醒',
    basis: '补炼队列',
  },
  '写入成功率': {
    label: '写入率',
    hint: '写记忆时真正成功落盘的比例。',
    unit: '%',
    threshold: '低于 99.5% 提醒',
    basis: '落盘校验',
  },
  '哈希校验失败(24h)': {
    label: '校验异常',
    hint: '用内容指纹核对记忆有没有被改坏，这里显示对不上的条数。',
    unit: '条',
    threshold: '出现 1 条即严重',
    basis: '落盘校验',
  },
  '待裁决': {
    label: '待裁决',
    hint: '两份记忆说法打架，需要你人工挑一个留下来。',
    unit: '条',
    threshold: '超过 20 条提醒',
    basis: '冲突裁决',
  },
  '超期 7d': {
    label: '超期未办',
    hint: '挂了超过 7 天仍没人处理的冲突条数。',
    unit: '条',
    threshold: '出现 1 条就提醒',
    basis: '冲突裁决',
  },
  '命中率': {
    label: '命中率',
    hint: '近 1 小时的检索里，有多少次真的找到了相关记忆。',
    unit: '%',
    threshold: '低于 60% 提醒',
    basis: '召回审计',
  },
  'payload_tokens p95': {
    label: '注入量',
    hint: '近 1 小时里，95% 的检索给 Agent 附带的记忆内容量都不超过这个数，按字计量；越大越费、越容易挤掉别的内容。',
    unit: '字',
    threshold: '超过 2000 提醒',
    basis: '预算规则',
  },
  'pipeline_llm_tokens p95': {
    label: '链路开销',
    hint: '检索自己调用大模型做整理、重排花的量，和「注入量」分开算；本地检索不调大模型，所以是 0。',
    unit: '字',
    threshold: '超过 3000 提醒',
    basis: '检索审计',
  },
  '延迟 p99': {
    label: '尾延迟',
    hint: '近 1 小时里，99% 的检索都在这个时间内完成，专门盯最慢的少数几次。',
    unit: '秒',
    threshold: '超过 2 秒提醒',
    basis: '检索审计',
  },
  '极简证据不足率(1d)': {
    label: '证据不足',
    hint: '走「极简」快速档的检索里，有多少比例连一条可靠依据都没凑够。',
    unit: '%',
    threshold: '超过 20% 提醒',
    basis: '极简规则',
  },
};

/** 分组名的人话（≤5 字；内部键保持不变，测试与账本口径不受影响） */
export const MONITOR_GROUP_TEXT: Record<string, string> = {
  'Agent 健康': '连接状况',
  '队列': '精炼队列',
  '冷存储': '落盘校验',
  '人工审核': '人工裁决',
  '检索性能(1h)': '检索表现',
};

/** 查不到键时的诚实兜底：不把原始字段名 / 英文枚举吐给用户 */
const MONITOR_MISSING: MonitorText = {
  label: '未命名指标',
  hint: '没有可翻译的明细',
  unit: '',
  threshold: '暂无阈值说明',
  basis: '暂无依据说明',
};

export function monitorText(metric: string): MonitorText {
  return MONITOR_METRIC_TEXT[metric] ?? MONITOR_MISSING;
}

export function monitorGroupText(group: string): string {
  return MONITOR_GROUP_TEXT[group] ?? '其他指标';
}

/** 状态类取值的人话（英文枚举不进 UI） */
const MONITOR_VALUE_TEXT: Record<string, string> = {
  OPEN: '已切断',
  CLOSED: '正常',
  HALF_OPEN: '恢复中',
  DEGRADED: '已降级',
  CONNECTED: '已连接',
};

/** 值位人话：数字原样，英文枚举翻译，中文原文保留，认不出就诚实说没有可翻译的明细 */
export function monitorValueText(v: number | string): string {
  if (typeof v === 'number') return String(v);
  if (v === '未取数') return '暂无数据';
  if (v === '无极简') return '近 1 天没有极简检索';
  if (MONITOR_VALUE_TEXT[v]) return MONITOR_VALUE_TEXT[v];
  if (/[\u4e00-\u9fff]/.test(v)) return v;
  return '没有可翻译的明细';
}

/** 供测试锁定「13 张卡全部有中文短名」 */
export function monitorMetricKeys(): string[] {
  return Object.keys(MONITOR_METRIC_TEXT);
}
