import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Network,
  RadioTower,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MAX_HISTORY = 42;
const MAX_ALERTS = 30;
const NODE_TIMEOUT_MS = 20000; // Keep nodes alive for 20 seconds without packets

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function metricColor(value) {
  if (value >= 85) return "text-rose-400 font-bold";
  if (value >= 70) return "text-amber-400 font-bold";
  return "text-emerald-400 font-bold";
}

function severityFromAlert(alert) {
  if (alert.severity) return String(alert.severity).toUpperCase();
  const innerMetrics = alert.metrics || {};
  const cpu = innerMetrics.cpu_usage_pct ?? alert.cpu_usage_pct ?? 0;
  if (cpu >= 90) return "CRITICAL";
  if (cpu >= 80) return "HIGH";
  return "MEDIUM";
}

function KpiCard({ icon: Icon, label, value, detail, tone = "cyan" }) {
  const toneMap = {
    cyan: "from-cyan-500/10 to-blue-500/5 border-cyan-500/20 text-cyan-400",
    emerald: "from-emerald-500/10 to-teal-500/5 border-emerald-500/20 text-emerald-400",
    amber: "from-amber-500/10 to-orange-500/5 border-amber-500/20 text-amber-400",
    rose: "from-rose-500/10 to-pink-500/5 border-rose-500/20 text-rose-400",
  };

  return (
    <div className={cx("rounded-xl border bg-[#0d1527]/60 backdrop-blur-sm p-5 shadow-lg shadow-black/20", toneMap[tone])}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 font-mono">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-white">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{detail}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, icon: Icon, children, right }) {
  return (
    <section className="rounded-xl border border-slate-800/60 bg-[#0d1527]/40 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/50 px-5 py-3.5">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-400">
              <Icon className="h-3.5 w-3.5" />
            </div>
          )}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function DeviceCard({ deviceId, node }) {
  const cpu = clamp(node.cpu);
  const ram = clamp(node.ram);
  const anomaly = clamp(node.anomaly);
  
  // Calculate if node is offline based on heartbeat timeout
  const isOffline = Date.now() - node.lastUpdatedTimestamp > NODE_TIMEOUT_MS;

  const isCritical = !isOffline && (cpu >= 85 || anomaly >= 75);
  const isWarn = !isOffline && !isCritical && (cpu >= 70 || anomaly >= 50);

  return (
    <div
      className={cx(
        "group rounded-xl border bg-[#0d1527] p-5 shadow-md transition-all duration-300",
        isOffline
          ? "border-slate-900 bg-slate-950/40 opacity-40"
          : isCritical 
            ? "border-rose-500/40 bg-gradient-to-b from-[#1c1218] to-[#0d1527]" 
            : isWarn 
              ? "border-amber-500/30 bg-gradient-to-b from-[#1c1912] to-[#0d1527]" 
              : "border-slate-800/80 hover:border-slate-700/80"
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server className={cx("h-4 w-4", isOffline ? "text-slate-600" : isCritical ? "text-rose-400" : isWarn ? "text-amber-400" : "text-emerald-400")} />
            <h3 className="truncate text-sm font-semibold text-white">{deviceId}</h3>
          </div>
          <p className="mt-1 text-[10px] font-mono text-slate-500">Last seen: {node.lastSeen}</p>
        </div>
        <span
          className={cx(
            "rounded px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest border",
            isOffline
              ? "border-slate-800 bg-slate-900 text-slate-500"
              : isCritical
                ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
                : isWarn
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
          )}
        >
          {isOffline ? "DISCONNECTED" : isCritical ? "CRIT" : isWarn ? "WARN" : "OK"}
        </span>
      </div>

      <div className="space-y-3.5">
        {[
          ["CORE_UTIL", cpu, Cpu, isOffline ? "bg-slate-800" : isCritical ? "bg-rose-500" : cpu >= 70 ? "bg-amber-400" : "bg-emerald-400"],
          ["MEM_COMMIT", ram, HardDrive, isOffline ? "bg-slate-800" : "bg-cyan-400"],
          ["AI_ANOMALY", anomaly, Activity, isOffline ? "bg-slate-800" : anomaly >= 75 ? "bg-rose-500" : "bg-indigo-400"],
        ].map(([label, value, Icon, progressColor]) => (
          <div key={label} className="bg-[#070b14] border border-slate-900/60 rounded-lg p-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                <Icon className="h-3 w-3" /> {label}
              </span>
              <span className={isOffline ? "text-slate-600" : metricColor(value)}>{Number(value).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
              <div
                className={cx("h-full rounded-full transition-all duration-500 ease-out", progressColor)}
                style={{ width: `${Math.min(value, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  // Load initial persistent nodes state from localStorage to stop memory dropouts
  const [metrics, setMetrics] = useState(() => {
    try {
      const saved = localStorage.getItem("aether_nodes");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState("OFFLINE");
  const [history, setHistory] = useState([]);

  // Sync state to LocalStorage
  useEffect(() => {
    localStorage.setItem("aether_nodes", JSON.stringify(metrics));
  }, [metrics]);

  useEffect(() => {
    let socket;
    try {
      socket = new WebSocket("ws://localhost:8765");
    } catch (error) {
      console.error("WebSocket initialization failed:", error);
      return undefined;
    }

    socket.onopen = () => setStatus("OPERATIONAL");
    socket.onclose = () => setStatus("OFFLINE");
    socket.onerror = () => setStatus("DEGRADED");

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const now = new Date();
        
        const lookupMetric = (payload, prefixes) => {
          if (!payload || typeof payload !== "object") return null;
          if (prefixes.includes("cpu") && payload.cpu_usage_pct !== undefined) return payload.cpu_usage_pct;
          if (prefixes.includes("ram") && payload.memory_usage_pct !== undefined) return payload.memory_usage_pct;
          if (prefixes.includes("anomaly") && payload.anomaly_score !== undefined) return payload.anomaly_score;

          const keys = Object.keys(payload);
          for (const key of keys) {
            const lowerKey = key.toLowerCase();
            for (const p of prefixes) {
              if (lowerKey.startsWith(p) || lowerKey.includes("_" + p) || lowerKey.includes(p + "_")) {
                if (typeof payload[key] === "number" || !isNaN(payload[key])) {
                  return Number(payload[key]);
                }
              }
            }
          }
          return null;
        };

        const inner = data.metrics || {};
        const cpu = clamp(lookupMetric(inner, ["cpu", "util"]) ?? lookupMetric(data, ["cpu", "util", "value"]) ?? 0);
        const ram = clamp(lookupMetric(inner, ["ram", "mem"]) ?? lookupMetric(data, ["ram", "mem", "memory"]) ?? 0);
        const anomaly = clamp(lookupMetric(inner, ["anom", "score"]) ?? lookupMetric(data, ["anom", "score"]) ?? 0);
        const throughput = Math.round(inner.throughput ?? data.throughput ?? 12500);

        // UPDATE HISTORICAL WAVEFORMS
        setHistory((prev) => [
          ...prev.slice(-(MAX_HISTORY - 1)),
          { time: formatTime(now), cpu, ram, anomaly, throughput },
        ]);

        // SLA ALERT ENGINE BOUNDARY
        const isAlertPacket = data.packet_type === "ALERT" || data.event_type === "CRITICAL_SPIKE" || data.severity;
        if (isAlertPacket || cpu >= 85 || anomaly >= 75) {
          setAlerts((prev) => [
            {
              ...data,
              cpu: cpu || 85, 
              ram: ram || 75,
              anomaly,
              timestamp: data.timestamp || now.toISOString(),
            },
            ...prev.slice(0, MAX_ALERTS - 1),
          ]);
        }

        // WRITE NODE AGENT REGISTRY WITH TIMESTAMP SIGNALS
        const deviceId = data.device_id || "Default-Windows-Workstation";
        setMetrics((prev) => ({
          ...prev,
          [deviceId]: {
            cpu,
            ram,
            anomaly,
            throughput,
            lastSeen: formatTime(now),
            lastUpdatedTimestamp: Date.now(), // Epoch tracking flag
          },
        }));

      } catch (err) {
        console.error("Parse exception:", err);
      }
    };

    return () => socket?.close();
  }, []);

  const devices = Object.entries(metrics);

  // Compute stats ignoring disconnected nodes
  const summary = useMemo(() => {
    const activeNodes = devices
      .map(([, node]) => node)
      .filter((node) => Date.now() - node.lastUpdatedTimestamp <= NODE_TIMEOUT_MS);

    const avgCpu = activeNodes.length ? activeNodes.reduce((sum, n) => sum + n.cpu, 0) / activeNodes.length : 0;
    const avgRam = activeNodes.length ? activeNodes.reduce((sum, n) => sum + n.ram, 0) / activeNodes.length : 0;
    const critical = activeNodes.filter((n) => n.cpu >= 85 || n.anomaly >= 75).length;
    const totalThroughput = activeNodes.reduce((sum, n) => sum + n.throughput, 0);

    return {
      avgCpu,
      avgRam,
      critical,
      throughput: totalThroughput || 12000,
      fleetHealth: activeNodes.length ? Math.max(0, 100 - critical * 20 - avgCpu * 0.1) : 100,
    };
  }, [devices]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 antialiased">
      <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-[#090d16]/80 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white font-mono">
              AETHER // <span className="text-slate-400 font-sans font-normal text-sm">Telemetry Center</span>
            </h1>
            <p className="text-[11px] text-slate-500">Persistent Enterprise Infrastructure Node Evaluator</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3.5 py-1.5 font-mono text-[10px] text-cyan-400">
              GATEWAY: ws://localhost:8765
            </span>
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1.5 text-[10px] font-mono font-bold text-emerald-400">
              {status}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] space-y-6 p-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={ShieldCheck} label="Global Fleet Health" value={`${summary.fleetHealth.toFixed(1)}%`} detail="Active cluster health matrix" tone="emerald" />
          <KpiCard icon={Gauge} label="Cluster Avg CPU" value={`${summary.avgCpu.toFixed(1)}%`} detail={`Cluster memory at ${summary.avgRam.toFixed(1)}%`} tone="cyan" />
          <KpiCard icon={Zap} label="Ingest Throughput" value={`${summary.throughput.toLocaleString()}/s`} detail="Metrics processed per second" tone="amber" />
          <KpiCard icon={Bell} label="Active SLA Alerts" value={alerts.length} detail={`${summary.critical} dynamic breaches tracked`} tone="rose" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-12">
            <Panel title="Active Target Infrastructure Nodes" subtitle="Persistent hardware blocks with auto-timeout indicators" icon={Network}>
              {devices.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-mono text-xs">Awaiting ingest hooks...</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {devices.map(([deviceId, node]) => (
                    <DeviceCard key={deviceId} deviceId={deviceId} node={node} />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <Panel title="Aggregated Real-time Waveform" icon={Activity}>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#131b2e" />
                    <XAxis dataKey="time" tick={{ fill: "#475569", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#475569", fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip />
                    <Area type="monotone" dataKey="cpu" name="CPU Core" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.05} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="xl:col-span-4">
            <Panel title="SLA Breach Pipeline Feed" icon={AlertTriangle}>
              <div className="max-h-[220px] space-y-2 overflow-y-auto custom-scrollbar">
                {alerts.map((alert, idx) => (
                  <div key={idx} className="rounded border border-rose-950/40 bg-[#070b14] p-3 border-l-2 border-l-rose-500 font-mono text-[11px]">
                    <div className="flex justify-between text-slate-500 text-[10px] mb-1">
                      <span>{severityFromAlert(alert)}</span>
                      <span>{formatTime(new Date(alert.timestamp))}</span>
                    </div>
                    <p className="text-slate-300">Node <span className="text-white font-bold">{alert.device_id}</span> breached SLA boundary.</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}