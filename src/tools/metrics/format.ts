import {
  LiveProcess,
  MetricsAction,
  MetricsEvent,
  MetricsInsight,
  MetricsPoint,
  MetricsSummary,
  ProcessMetrics,
} from "../../client/metrics.js";

// The process metrics as text an assistant can reason about: what runs now,
// how the period went, what stands out and which tools act on it. The
// numbers come from the API as they are; only the units are made readable.

const MB = 1024 * 1024;
const MAX_TEXT = 100;
const MAX_EVENTS = 12;
const MAX_ROWS = 24;

const RANGE_WORDS: Record<string, string> = {
  "1h": "the last hour",
  "6h": "the last 6 hours",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

/** What an insight says can be done, as the tools that do it */
const ACTION_TOOLS: Record<MetricsAction, string> = {
  upgradeEngine: "list_engines shows the engines and their prices, set_engine changes it (it affects billing)",
  addEngines: "scale_app sets how many engines run or turns auto-scaling on, set_high_availability keeps a second one",
  viewLogs: "get_error_logs and get_logs, around the times of the restarts",
};

// Names of engines and processes are reported by what runs in the app, so
// they are text from outside: one line, no control characters, short.
function plain(text: unknown): string {
  const line = (String(text || "").split(/\r?\n/)[0] || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .trim();
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

// CPU is measured in percent of one core; engines are sold in millicores
const cpu = (percent: number) => `${Math.round(percent * 10)}m`;
const memory = (bytes: number) => `${Math.round(bytes / MB)} MB`;
const lag = (ms: number | undefined) => (ms === undefined ? "n/a" : `${ms >= 10 ? Math.round(ms) : Math.round(ms * 10) / 10} ms`);
const time = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes >= 24 * 60) {
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  }
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function share(used: number, limit: number | undefined): string {
  return limit ? ` of ${limit >= MB ? memory(limit) : cpu(limit)} (${Math.round((used / limit) * 100)}%)` : "";
}

function describeLive(m: ProcessMetrics): string[] {
  if (!m.live.length) {
    return ["Running now: nothing has reported in the last two minutes."];
  }
  const hosts = Array.from(new Set(m.live.map((p) => p.hostname)));
  const engine = m.engine;
  const has = [
    engine && engine.name ? plain(engine.name) : "",
    engine && engine.memoryLimit ? `${memory(engine.memoryLimit)} memory` : "",
    engine && engine.cpuLimit ? `${cpu(engine.cpuLimit)} CPU` : "",
  ].filter(Boolean);
  const lines = [`Running now: ${plural(hosts.length, "engine")}${has.length ? ` (${has.join(", ")} each)` : ""}`];
  for (const hostname of hosts) {
    const total = (m.engines || []).find((e) => e.hostname === hostname);
    lines.push(
      total
        ? `- ${plain(hostname)}: ${memory(total.mem)}${share(total.mem, engine && engine.memoryLimit)} memory, ${cpu(total.cpu)}${share(total.cpu, engine && engine.cpuLimit)} CPU, everything in it`
        : `- ${plain(hostname)}`,
    );
    for (const p of m.live.filter((l) => l.hostname === hostname)) {
      lines.push(`  ${describeProcess(p)}`);
    }
  }
  return lines;
}

function describeProcess(p: LiveProcess): string {
  return `${plain(p.name)}: ${plain(p.state)}, ${cpu(p.cpu)} CPU, ${memory(p.mem)}, event loop lag ${lag(p.eventLoopDelay)}, up ${duration(p.uptimeMs)}, ${plural(p.restarts, "restart")} since the engine started`;
}

function describeSummary(name: string, s: MetricsSummary, limits?: { memory?: number; cpu?: number }): string {
  const parts = [
    `CPU ${cpu(s.cpuAvg)} / ${cpu(s.cpuMax)}${share(s.cpuMax, limits && limits.cpu)}`,
    `memory ${memory(s.memAvg)} / ${memory(s.memMax)}${share(s.memMax, limits && limits.memory)}`,
  ];
  if (s.eldAvg !== undefined) {
    parts.push(`event loop lag ${lag(s.eldAvg)} / ${lag(s.eldMax)}`);
  }
  if (!limits) {
    parts.push(plural(s.restarts, "restart"));
  }
  return `- ${plain(name)}: ${parts.join(", ")}`;
}

function describeInsight(insight: MetricsInsight, index: number): string[] {
  const lines = [
    `${index + 1}. [${insight.severity}] ${plain(insight.title)}`,
    `   ${insight.detail}`,
    `   What to do: ${insight.suggestion}`,
  ];
  const tools = (insight.actions || []).map((a) => ACTION_TOOLS[a]).filter(Boolean);
  if (tools.length) {
    lines.push(`   Tools: ${tools.join("; ")}.`);
  }
  if (insight.evidence && Object.keys(insight.evidence).length) {
    lines.push(
      `   Numbers: ${Object.entries(insight.evidence)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`,
    );
  }
  return lines;
}

function describeEvent(e: MetricsEvent): string {
  return e.type === "deploy"
    ? `- ${time(e.t)} deploy ${plain(e.deployment)}`
    : `- ${time(e.t)} ${plain(e.process)} restarted${e.count && e.count > 1 ? ` ${e.count} times` : ""} on ${plain(e.hostname)}`;
}

/** The buckets joined into at most MAX_ROWS rows, one line each */
function describeSeries(name: string, points: MetricsPoint[]): string[] {
  const step = Math.ceil(points.length / MAX_ROWS);
  const rows: string[] = [];
  for (let i = 0; i < points.length; i += step) {
    const group = points.slice(i, i + step);
    const samples = group.reduce((sum, p) => sum + p.n, 0) || 1;
    const weighted = (pick: (p: MetricsPoint) => number) => group.reduce((sum, p) => sum + pick(p) * p.n, 0) / samples;
    const lags = group.map((p) => p.eldMax).filter((v): v is number => v !== undefined);
    rows.push(
      [
        time(group[0]!.t),
        cpu(weighted((p) => p.cpuAvg)),
        cpu(Math.max(...group.map((p) => p.cpuMax))),
        memory(weighted((p) => p.memAvg)),
        memory(Math.max(...group.map((p) => p.memMax))),
        lags.length ? lag(Math.max(...lags)) : "n/a",
        String(group.reduce((sum, p) => sum + p.restarts, 0)),
      ].join(" | "),
    );
  }
  return [`${plain(name)} (UTC | CPU avg | CPU peak | memory avg | memory peak | lag peak | restarts):`, ...rows];
}

export interface FormatOptions {
  /** The app's name, for the first line */
  appName: string;
  /** Also the buckets over time, a table per process */
  series?: boolean;
}

export function formatProcessMetrics(m: ProcessMetrics, options: FormatOptions): string {
  const words = RANGE_WORDS[m.range] || m.range;
  const lines = [
    `Process metrics of ${plain(options.appName)}, ${words}.`,
    `Health: ${m.health.status}${m.health.status === "unknown" ? "" : ` (${m.health.score} of 100)`}.`,
  ];
  if (m.dataFrom && m.dataFrom - m.from > (m.to - m.from) * 0.1) {
    lines.push(`The history only starts at ${time(m.dataFrom)} UTC: what is below covers the time since then, not the whole period.`);
  }
  lines.push("", ...describeLive(m));

  if (m.processes.length) {
    lines.push("", "Over the period, average / peak:");
    for (const p of m.processes) {
      lines.push(describeSummary(p.name, p.summary));
    }
    if (m.engine) {
      lines.push(
        describeSummary(
          m.processes.length && m.engine.summary.pods > 1 ? "a whole engine (busiest one at the peak)" : "the whole engine",
          m.engine.summary,
          { memory: m.engine.memoryLimit, cpu: m.engine.cpuLimit },
        ),
      );
    }
    for (const one of m.perEngine || []) {
      lines.push(describeSummary(`engine ${one.hostname}`, one.summary, { memory: m.engine && m.engine.memoryLimit, cpu: m.engine && m.engine.cpuLimit }));
    }
  }

  lines.push("", m.insights.length ? "What stands out:" : "Nothing stands out in this period.");
  m.insights.forEach((insight, i) => lines.push(...describeInsight(insight, i)));

  if (m.events.length) {
    const shown = m.events.slice(-MAX_EVENTS);
    lines.push("", `Events (${m.events.length}${shown.length < m.events.length ? `, the last ${shown.length} shown` : ""}, UTC):`);
    lines.push(...shown.map(describeEvent));
  }

  if (options.series) {
    for (const p of m.processes) {
      lines.push("", ...describeSeries(p.name, p.points));
    }
  }
  return lines.join("\n");
}
