"use client";

import { useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw } from "lucide-react";
import { isPerformanceHistory, metricSegments, PERFORMANCE_RANGES, type PerformanceHistory, type PerformanceRange, type UsageMetric } from "@/lib/performance/metrics";

const metrics = [
  { key: "cpu_usage", label: "CPU usage", icon: Cpu, color: "#34d399" },
  { key: "ram_usage", label: "Memory usage", icon: MemoryStick, color: "#38bdf8" },
  { key: "disk_usage", label: "Disk space used", icon: HardDrive, color: "#a78bfa" },
] as const;
const percent = (value: number | null | undefined) => value == null ? "Not reported" : `${value.toFixed(1)}%`;
const timeLabel = (time: number, range: PerformanceRange) => new Date(time).toLocaleString(undefined,
  range === "1h" || range === "24h" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit" });

export default function DevicePerformance({ deviceId }: { deviceId: string }) {
  const [range, setRange] = useState<PerformanceRange>("1h");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ deviceId: string; range: PerformanceRange; data?: PerformanceHistory; error?: string; loading: boolean }>({ deviceId, range: "1h", loading: true });
  const current = state.deviceId === deviceId && state.range === range ? state : undefined;

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (disposed || document.hidden || controller) return;
      controller = new AbortController();
      const active = controller;
      setState((previous) => ({ deviceId, range, loading: true,
        data: previous.deviceId === deviceId && previous.range === range ? previous.data : undefined }));
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/performance?range=${range}`, {
          cache: "no-store", signal: AbortSignal.any([active.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.redirected || response.status === 401) throw new Error("Session expired. Sign in again to view performance.");
        if (!response.ok) throw new Error(response.status === 404 ? "Device not found or access denied." : "Could not load performance history. Please retry.");
        const data: unknown = await response.json();
        if (!isPerformanceHistory(data, range)) throw new Error("Invalid performance response. Please retry.");
        if (!disposed && !active.signal.aborted) setState({ deviceId, range, data, loading: false });
      } catch (error) {
        if (!disposed && !active.signal.aborted) setState((previous) => ({ ...previous, loading: false,
          error: error instanceof Error ? error.message : "Could not load performance history. Please retry." }));
      } finally {
        controller = undefined;
        if (!disposed && !document.hidden) timer = setTimeout(load, active.signal.aborted ? 0 : 30_000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else void load();
    }
    void load();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [deviceId, range, revision]);

  const data = current?.data;
  const latest = data?.samples.at(-1);
  const stale = latest && Date.now() - latest.timestamp > 90_000;
  const loading = !current || current.loading;
  return (
    <section className="mt-6 space-y-4" aria-label="Device performance" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Performance period">
          {(Object.keys(PERFORMANCE_RANGES) as PerformanceRange[]).map((value) => (
            <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-emerald-400 ${range === value ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"}`}>
              {PERFORMANCE_RANGES[value].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh
        </button>
      </div>
      {current?.error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">{current.error}{data ? " Showing the last loaded history." : ""}</p>}
      {!data && !current?.error && <div role="status" className="rounded-2xl border border-zinc-800 bg-white/[0.02] p-12 text-center text-sm text-zinc-400">Loading performance history...</div>}
      {data && !latest && <div role="status" className="rounded-2xl border border-dashed border-zinc-800 bg-white/[0.02] p-10 text-center">
        <Activity size={24} className="mx-auto mb-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Waiting for metric samples</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-500">No measurements in this period yet. An online Agent sends metrics with its heartbeats, normally every 30 seconds. History starts when collection is enabled; previous values cannot be recovered.</p>
      </div>}
      {data && latest && <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span className={stale || current?.error ? "text-amber-400" : "text-emerald-400"}>{current?.error ? "Refresh unavailable" : stale ? "No recent metric sample" : "Receiving metrics"}</span>
          <span>Last sample: {new Date(latest.timestamp).toLocaleString()}</span>
        </div>
        {metrics.map((metric) => <PerformanceChart key={metric.key} data={data} metric={metric.key} label={metric.label} color={metric.color} icon={metric.icon} />)}
        <p className="text-xs leading-5 text-zinc-500">{data.samples.length} recorded samples. Latest measurement per {data.interval < 60_000 ? "30-second" : `${data.interval / 60_000}-minute`} interval, not an average. Gaps indicate missing samples. Disk shows capacity used, not I/O. Refreshes every 30 seconds only while this tab is visible.</p>
      </>}
    </section>
  );
}

export function PerformanceChart({ data, metric, label, color, icon: Icon }: {
  data: PerformanceHistory; metric: UsageMetric; label: string; color: string; icon: typeof Cpu;
}) {
  const latest = data.samples.at(-1)?.[metric];
  const values = data.samples.flatMap((sample) => sample[metric] === null ? [] : [sample[metric]]);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const peak = values.length ? Math.max(...values) : null;
  const x = (timestamp: number) => 36 + (timestamp - data.from) / (data.to - data.from) * 640;
  const y = (value: number) => 154 - value * 1.3;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-white/[0.02] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-medium text-zinc-300"><Icon size={15} style={{ color }} />{label}</h3>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{percent(latest)}</p><p className="mt-1 text-[10px] text-zinc-500">Last sample</p></div>
        <p className="text-xs text-zinc-500">Sample avg <span className="text-zinc-300">{percent(average)}</span><span className="mx-2">/</span>Peak <span className="text-zinc-300">{percent(peak)}</span></p>
      </div>
      {values.length ? <svg viewBox="0 0 700 195" className="mt-3 w-full" role="img" aria-label={`${label}: ${percent(latest)} at last sample; sample average ${percent(average)}, peak ${percent(peak)}`}>
        {[0, 50, 100].map((value) => <g key={value}><line x1="36" x2="676" y1={y(value)} y2={y(value)} stroke="#27272a" strokeDasharray="3 5" /><text x="27" y={y(value) + 3} textAnchor="end" fill="#71717a" fontSize="10">{value}%</text></g>)}
        {metricSegments(data.samples, metric, data.interval).map((segment) => <g key={segment[0].timestamp}>
          <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={segment.map((sample) => `${x(sample.timestamp)},${y(sample[metric]!)}`).join(" ")} />
          {segment.map((sample) => <circle key={sample.timestamp} cx={x(sample.timestamp)} cy={y(sample[metric]!)} r={segment.length === 1 ? 3 : 2} fill={color}>
            <title>{`${new Date(sample.timestamp).toLocaleString()}: ${percent(sample[metric])}`}</title>
          </circle>)}
        </g>)}
        {[data.from, (data.from + data.to) / 2, data.to].map((time, index) => <text key={time} x={x(time)} y="185" textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} fill="#71717a" fontSize="10">{timeLabel(time, data.range)}</text>)}
      </svg> : <p className="py-8 text-center text-xs text-zinc-500">This metric was not reported in this period.</p>}
    </div>
  );
}
