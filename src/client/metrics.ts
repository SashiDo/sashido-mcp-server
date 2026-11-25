// Process metrics as the API's /metrics/processes/{id}/overview answers
// them: CPU in percent of one core, memory in bytes, event loop lag in
// milliseconds, times in unix seconds.

export const PROCESS_METRICS_RANGES = ['1h', '6h', '24h', '7d', '30d'] as const;
export type ProcessMetricsRange = (typeof PROCESS_METRICS_RANGES)[number];

/** One time bucket of one process type over all its engines */
export interface MetricsPoint {
  t: number;
  n: number;
  pods: number;
  cpuAvg: number;
  cpuMax: number;
  memAvg: number;
  memMax: number;
  /** Missing when the process reports no lag */
  eldAvg?: number;
  eldMax?: number;
  /** Restarts that happened in the bucket */
  restarts: number;
}

export interface MetricsSummary {
  cpuAvg: number;
  cpuMax: number;
  memAvg: number;
  memMax: number;
  eldAvg?: number;
  eldMax?: number;
  restarts: number;
  pods: number;
}

export interface MetricsSeries {
  name: string;
  summary: MetricsSummary;
  points: MetricsPoint[];
}

/** A whole engine, everything in it, next to what it has */
export interface MetricsEngine {
  name?: string;
  memoryLimit?: number;
  cpuLimit?: number;
  summary: MetricsSummary;
  points: MetricsPoint[];
}

export interface LiveProcess {
  hostname: string;
  name: string;
  state: string;
  cpu: number;
  mem: number;
  eventLoopDelay?: number;
  uptimeMs: number;
  /** Since the engine started */
  restarts: number;
  timestamp: number;
}

export interface LiveEngine {
  hostname: string;
  cpu: number;
  mem: number;
}

export interface MetricsEvent {
  t: number;
  type: 'restart' | 'deploy';
  process?: string;
  hostname?: string;
  deployment?: string;
  count?: number;
}

export type MetricsAction = 'upgradeEngine' | 'addEngines' | 'viewLogs';

export interface MetricsInsight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  suggestion: string;
  process?: string;
  metric?: string;
  actions?: MetricsAction[];
  evidence?: Record<string, number>;
}

export interface ProcessMetrics {
  range: string;
  /** Seconds a bucket covers */
  resolution: number;
  from: number;
  to: number;
  /** Later than `from` when the history is shorter than the range */
  dataFrom?: number;
  processes: MetricsSeries[];
  engine?: MetricsEngine;
  /** Each engine by itself, with more than one and up to 24 hours */
  perEngine?: Array<{ hostname: string; summary: MetricsSummary; points: MetricsPoint[] }>;
  live: LiveProcess[];
  engines?: LiveEngine[];
  events: MetricsEvent[];
  insights: MetricsInsight[];
  health: { score: number; status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' };
}
