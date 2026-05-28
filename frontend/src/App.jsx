import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  Copy,
  Cpu,
  Gauge,
  HardDrive,
  Network,
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
const NODE_TIMEOUT_MS = 20000;

const WS_URL = "ws://localhost:8765";
const GATEWAY_API_BASE = "http://localhost:8000";
const GATEWAY_HEALTH_URL = `${GATEWAY_API_BASE}/health`;
const STREAMER_HEALTH_URL = "http://localhost:8766/health";

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
  const cpu = innerMetrics.cpu_usage_pct ?? alert.cpu_usage_pct ?? alert.cpu ?? 0;

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
    <div
      className={cx(
        "rounded-xl border bg-[#0d1527]/60 p-5 shadow-lg shadow-black/20 backdrop-blur-sm",
        toneMap[tone]
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-white">
            {value}
          </p>
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
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
            )}
          </div>
        </div>

        {right}
      </div>

      <div className="p-5">{children}</div>
    </section>
  );
}

function SystemStatusPanel({ gatewayHealth, streamerHealth, healthError }) {
  const gatewayOnline =
    gatewayHealth?.status === "gateway-online" ||
    gatewayHealth?.status === "online";

  const kafkaOnline = Boolean(
    gatewayHealth?.kafka_enabled || gatewayHealth?.kafka_connected
  );

  const streamerOnline = streamerHealth?.status === "online";

  const statusItems = [
    {
      label: "Gateway",
      value: gatewayOnline ? "Online" : "Offline",
      detail: "FastAPI ingestion layer",
      online: gatewayOnline,
    },
    {
      label: "Kafka",
      value: kafkaOnline ? "Online" : "Offline",
      detail: "Event streaming backbone",
      online: kafkaOnline,
    },
    {
      label: "Streamer",
      value: streamerOnline ? "Online" : "Offline",
      detail: "WebSocket broadcast layer",
      online: streamerOnline,
    },
    {
      label: "Browsers",
      value: streamerHealth?.connected_clients ?? 0,
      detail: "Connected dashboard clients",
      online: streamerOnline,
    },
    {
      label: "Telemetry Events",
      value: streamerHealth?.message_counts?.["telemetry-stream"] ?? 0,
      detail: "Kafka telemetry messages",
      online: streamerOnline,
    },
    {
      label: "Alert Events",
      value: streamerHealth?.message_counts?.["alerts-stream"] ?? 0,
      detail: "Kafka alert messages",
      online: streamerOnline,
    },
  ];

  return (
    <Panel
      title="System Status"
      subtitle="Live backend service health checks"
      icon={ShieldCheck}
      right={
        <span
          className={cx(
            "rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest",
            healthError
              ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
          )}
        >
          {healthError ? "DEGRADED" : "HEALTHY"}
        </span>
      }
    >
      {healthError && (
        <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {healthError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {statusItems.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-slate-800/70 bg-[#070b14]/60 p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {item.label}
              </p>

              <span
                className={cx(
                  "h-2 w-2 rounded-full",
                  item.online
                    ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                    : "bg-rose-500 shadow-[0_0_8px_#f43f5e]"
                )}
              />
            </div>

            <p className="text-lg font-bold text-white">{item.value}</p>
            <p className="mt-1 text-[11px] text-slate-500">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800/60 bg-[#070b14]/50 px-4 py-3 font-mono text-[11px] text-slate-500">
        Last Kafka message:{" "}
        <span className="text-cyan-400">
          {streamerHealth?.last_message_topic || "none yet"}
        </span>{" "}
        at{" "}
        <span className="text-slate-300">
          {streamerHealth?.last_message_received_at || "waiting"}
        </span>
      </div>
    </Panel>
  );
}

function AddDevicePanel({
  enrollmentDeviceName,
  setEnrollmentDeviceName,
  enrollmentOrgName,
  setEnrollmentOrgName,
  enrollmentServerUrl,
  setEnrollmentServerUrl,
  enrollmentResult,
  enrollmentLoading,
  enrollmentError,
  onCreateEnrollmentToken,
}) {
  const [copiedCommand, setCopiedCommand] = useState(null);

  const cleanServerUrl = (enrollmentServerUrl || GATEWAY_API_BASE).replace(
    /\/$/,
    ""
  );

  const token = enrollmentResult?.enrollment_token;

  const windowsCommand = token
    ? `cd C:\\Users\\Tanuj\\telemetry-platform\nSet-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned\n.\\install\\install_windows_agent.ps1 -EnrollmentToken "${token}" -GatewayUrl "${cleanServerUrl}" -UseLocalSource`
    : "";

  const linuxCommand = token
    ? `cd /mnt/c/Users/Tanuj/telemetry-platform\n./install/install_linux_agent.sh --token "${token}" --gateway-url "${cleanServerUrl}" --use-local-source`
    : "";

  async function copyCommand(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCommand(label);
      setTimeout(() => setCopiedCommand(null), 1500);
    } catch {
      setCopiedCommand(null);
    }
  }

  return (
    <Panel
      title="Add Device"
      subtitle="Generate an enrollment token and installer command for a new machine"
      icon={Server}
      right={
        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-400">
          Enrollment
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div>
          <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Device Name
          </label>
          <input
            value={enrollmentDeviceName}
            onChange={(event) => setEnrollmentDeviceName(event.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            placeholder="Friend-Laptop-Node01"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Organization
          </label>
          <input
            value={enrollmentOrgName}
            onChange={(event) => setEnrollmentOrgName(event.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            placeholder="Local Development Tenant"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Gateway Server URL
          </label>
          <input
            value={enrollmentServerUrl}
            onChange={(event) => setEnrollmentServerUrl(event.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            placeholder="http://localhost:8000"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onCreateEnrollmentToken}
          disabled={enrollmentLoading}
          className={cx(
            "rounded-lg border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition",
            enrollmentLoading
              ? "border-slate-800 bg-slate-900 text-slate-500"
              : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
          )}
        >
          {enrollmentLoading ? "Generating..." : "Generate Enrollment Token"}
        </button>

        <p className="text-[11px] text-slate-500">
          For another computer, use your Windows LAN IP instead of localhost.
        </p>
      </div>

      {enrollmentError && (
        <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {enrollmentError}
        </div>
      )}

      {enrollmentResult && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              Enrollment Token Created
            </p>
            <p className="mt-1 break-all font-mono text-xs text-slate-300">
              {enrollmentResult.enrollment_token}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Expires at: {enrollmentResult.expires_at}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/60 bg-[#070b14]/50 p-4 text-[11px] text-slate-500">
            Run the command from the project root folder. The installer copies
            the agent, creates a virtual environment, installs dependencies,
            registers the device, saves config, and starts telemetry.
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Windows Installer Command
                </p>

                <button
                  onClick={() => copyCommand("windows", windowsCommand)}
                  className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono text-[10px] text-slate-400 hover:text-cyan-300"
                >
                  {copiedCommand === "windows" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedCommand === "windows" ? "Copied" : "Copy"}
                </button>
              </div>

              <textarea
                readOnly
                value={windowsCommand}
                className="h-40 w-full rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono text-xs text-slate-300 outline-none"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Linux / Ubuntu Installer Command
                </p>

                <button
                  onClick={() => copyCommand("linux", linuxCommand)}
                  className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono text-[10px] text-slate-400 hover:text-cyan-300"
                >
                  {copiedCommand === "linux" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedCommand === "linux" ? "Copied" : "Copy"}
                </button>
              </div>

              <textarea
                readOnly
                value={linuxCommand}
                className="h-40 w-full rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono text-xs text-slate-300 outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DeviceCard({ deviceId, node, nowMs }) {
  const cpu = clamp(node.cpu);
  const ram = clamp(node.ram);
  const anomaly = clamp(node.anomaly);

  const lastUpdated = Number(node.lastUpdatedTimestamp || 0);
  const isOffline = nowMs - lastUpdated > NODE_TIMEOUT_MS;

  const isCritical = !isOffline && (cpu >= 85 || ram >= 90 || anomaly >= 75);
  const isWarn =
    !isOffline && !isCritical && (cpu >= 70 || ram >= 85 || anomaly >= 50);

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
            <Server
              className={cx(
                "h-4 w-4",
                isOffline
                  ? "text-slate-600"
                  : isCritical
                  ? "text-rose-400"
                  : isWarn
                  ? "text-amber-400"
                  : "text-emerald-400"
              )}
            />

            <h3 className="truncate text-sm font-semibold text-white">
              {deviceId}
            </h3>
          </div>

          <p className="mt-1 font-mono text-[10px] text-slate-500">
            Last seen: {node.lastSeen}
          </p>
        </div>

        <span
          className={cx(
            "rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest",
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
          [
            "CORE_UTIL",
            cpu,
            Cpu,
            isOffline
              ? "bg-slate-800"
              : cpu >= 85
              ? "bg-rose-500"
              : cpu >= 70
              ? "bg-amber-400"
              : "bg-emerald-400",
          ],
          [
            "MEM_COMMIT",
            ram,
            HardDrive,
            isOffline
              ? "bg-slate-800"
              : ram >= 90
              ? "bg-rose-500"
              : ram >= 85
              ? "bg-amber-400"
              : "bg-cyan-400",
          ],
          [
            "AI_ANOMALY",
            anomaly,
            Activity,
            isOffline
              ? "bg-slate-800"
              : anomaly >= 75
              ? "bg-rose-500"
              : anomaly >= 50
              ? "bg-amber-400"
              : "bg-indigo-400",
          ],
        ].map(([label, value, Icon, progressColor]) => (
          <div
            key={label}
            className="rounded-lg border border-slate-900/60 bg-[#070b14] p-2.5"
          >
            <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-slate-500">
                <Icon className="h-3 w-3" /> {label}
              </span>

              <span className={isOffline ? "text-slate-600" : metricColor(value)}>
                {Number(value).toFixed(1)}%
              </span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
              <div
                className={cx(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  progressColor
                )}
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

  const [gatewayHealth, setGatewayHealth] = useState(null);
  const [streamerHealth, setStreamerHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);

  const [enrollmentDeviceName, setEnrollmentDeviceName] =
    useState("New-Laptop-Node01");
  const [enrollmentOrgName, setEnrollmentOrgName] =
    useState("Local Development Tenant");
  const [enrollmentServerUrl, setEnrollmentServerUrl] =
    useState(GATEWAY_API_BASE);
  const [enrollmentResult, setEnrollmentResult] = useState(null);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState(null);

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem("aether_nodes", JSON.stringify(metrics));
  }, [metrics]);

  useEffect(() => {
    let cancelled = false;

    async function fetchHealth() {
      try {
        const [gatewayResponse, streamerResponse] = await Promise.all([
          fetch(GATEWAY_HEALTH_URL),
          fetch(STREAMER_HEALTH_URL),
        ]);

        if (!gatewayResponse.ok || !streamerResponse.ok) {
          throw new Error("Health endpoint returned non-200 response");
        }

        const gatewayData = await gatewayResponse.json();
        const streamerData = await streamerResponse.json();

        if (!cancelled) {
          setGatewayHealth(gatewayData);
          setStreamerHealth(streamerData);
          setHealthError(null);
        }
      } catch {
        if (!cancelled) {
          setHealthError("Unable to reach one or more health endpoints");
        }
      }
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let socket;

    try {
      socket = new WebSocket(WS_URL);
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

          if (prefixes.includes("cpu") && payload.cpu_usage_pct !== undefined) {
            return payload.cpu_usage_pct;
          }

          if (prefixes.includes("ram") && payload.memory_usage_pct !== undefined) {
            return payload.memory_usage_pct;
          }

          if (
            prefixes.includes("anomaly") &&
            payload.anomaly_score !== undefined
          ) {
            return payload.anomaly_score;
          }

          const keys = Object.keys(payload);

          for (const key of keys) {
            const lowerKey = key.toLowerCase();

            for (const p of prefixes) {
              if (
                lowerKey.startsWith(p) ||
                lowerKey.includes("_" + p) ||
                lowerKey.includes(p + "_")
              ) {
                if (typeof payload[key] === "number" || !isNaN(payload[key])) {
                  return Number(payload[key]);
                }
              }
            }
          }

          return null;
        };

        const inner = data.metrics || {};

        const cpu = clamp(
          lookupMetric(inner, ["cpu", "util"]) ??
            lookupMetric(data, ["cpu", "util", "value"]) ??
            0
        );

        const ram = clamp(
          lookupMetric(inner, ["ram", "mem"]) ??
            lookupMetric(data, ["ram", "mem", "memory"]) ??
            0
        );

        const anomaly = clamp(
          lookupMetric(inner, ["anom", "score"]) ??
            lookupMetric(data, ["anom", "score"]) ??
            0
        );

        const throughput = Math.round(inner.throughput ?? data.throughput ?? 12500);

        setHistory((prev) => [
          ...prev.slice(-(MAX_HISTORY - 1)),
          {
            time: formatTime(now),
            cpu,
            ram,
            anomaly,
            throughput,
          },
        ]);

        const isAlertPacket =
          data.packet_type === "ALERT" ||
          data.event_type === "CRITICAL_SPIKE" ||
          data.severity;

        if (isAlertPacket || cpu >= 85 || ram >= 90 || anomaly >= 75) {
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

        const deviceId = data.device_id || "Default-Windows-Workstation";

        setMetrics((prev) => ({
          ...prev,
          [deviceId]: {
            cpu,
            ram,
            anomaly,
            throughput,
            lastSeen: formatTime(now),
            lastUpdatedTimestamp: Date.now(),
          },
        }));
      } catch (err) {
        console.error("Parse exception:", err);
      }
    };

    return () => socket?.close();
  }, []);

  async function createEnrollmentToken() {
    setEnrollmentLoading(true);
    setEnrollmentError(null);
    setEnrollmentResult(null);

    try {
      const cleanServerUrl = enrollmentServerUrl.replace(/\/$/, "");

      const response = await fetch(
        `${cleanServerUrl}/api/v1/devices/enrollment-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organization_name: enrollmentOrgName,
            device_name: enrollmentDeviceName,
            expires_in_minutes: 60,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to create enrollment token");
      }

      const data = await response.json();
      setEnrollmentResult(data);
    } catch (error) {
      setEnrollmentError(error.message || "Failed to create enrollment token");
    } finally {
      setEnrollmentLoading(false);
    }
  }

  const devices = Object.entries(metrics);

  const summary = useMemo(() => {
    const activeNodes = devices
      .map(([, node]) => node)
      .filter(
        (node) => nowMs - Number(node.lastUpdatedTimestamp || 0) <= NODE_TIMEOUT_MS
      );

    const avgCpu = activeNodes.length
      ? activeNodes.reduce((sum, n) => sum + clamp(n.cpu), 0) / activeNodes.length
      : 0;

    const avgRam = activeNodes.length
      ? activeNodes.reduce((sum, n) => sum + clamp(n.ram), 0) / activeNodes.length
      : 0;

    const critical = activeNodes.filter(
      (n) => clamp(n.cpu) >= 85 || clamp(n.ram) >= 90 || clamp(n.anomaly) >= 75
    ).length;

    const totalThroughput = activeNodes.reduce(
      (sum, n) => sum + (Number(n.throughput) || 0),
      0
    );

    return {
      avgCpu,
      avgRam,
      critical,
      throughput: totalThroughput || 12000,
      fleetHealth: activeNodes.length
        ? Math.max(0, 100 - critical * 20 - avgCpu * 0.1)
        : 100,
    };
  }, [devices, nowMs]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 antialiased">
      <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-[#090d16]/80 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-mono text-lg font-bold tracking-tight text-white">
              AETHER //{" "}
              <span className="font-sans text-sm font-normal text-slate-400">
                Telemetry Center
              </span>
            </h1>
            <p className="text-[11px] text-slate-500">
              Persistent Enterprise Infrastructure Node Evaluator
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3.5 py-1.5 font-mono text-[10px] text-cyan-400">
              LIVE STREAM: {WS_URL}
            </span>
            <span
              className={cx(
                "rounded-full border px-3.5 py-1.5 font-mono text-[10px] font-bold",
                status === "OPERATIONAL"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : status === "DEGRADED"
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-400"
              )}
            >
              {status}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] space-y-6 p-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={ShieldCheck}
            label="Global Fleet Health"
            value={`${summary.fleetHealth.toFixed(1)}%`}
            detail="Active cluster health matrix"
            tone="emerald"
          />
          <KpiCard
            icon={Gauge}
            label="Cluster Avg CPU"
            value={`${summary.avgCpu.toFixed(1)}%`}
            detail={`Cluster memory at ${summary.avgRam.toFixed(1)}%`}
            tone="cyan"
          />
          <KpiCard
            icon={Zap}
            label="Ingest Throughput"
            value={`${summary.throughput.toLocaleString()}/s`}
            detail="Metrics processed per second"
            tone="amber"
          />
          <KpiCard
            icon={Bell}
            label="Active SLA Alerts"
            value={alerts.length}
            detail={`${summary.critical} dynamic breaches tracked`}
            tone="rose"
          />
        </section>

        <SystemStatusPanel
          gatewayHealth={gatewayHealth}
          streamerHealth={streamerHealth}
          healthError={healthError}
        />

        <AddDevicePanel
          enrollmentDeviceName={enrollmentDeviceName}
          setEnrollmentDeviceName={setEnrollmentDeviceName}
          enrollmentOrgName={enrollmentOrgName}
          setEnrollmentOrgName={setEnrollmentOrgName}
          enrollmentServerUrl={enrollmentServerUrl}
          setEnrollmentServerUrl={setEnrollmentServerUrl}
          enrollmentResult={enrollmentResult}
          enrollmentLoading={enrollmentLoading}
          enrollmentError={enrollmentError}
          onCreateEnrollmentToken={createEnrollmentToken}
        />

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-12">
            <Panel
              title="Active Target Infrastructure Nodes"
              subtitle="Persistent hardware blocks with auto-timeout indicators"
              icon={Network}
            >
              {devices.length === 0 ? (
                <div className="py-12 text-center font-mono text-xs text-slate-500">
                  Awaiting ingest hooks...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {devices.map(([deviceId, node]) => (
                    <DeviceCard
                      key={deviceId}
                      deviceId={deviceId}
                      node={node}
                      nowMs={nowMs}
                    />
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
                  <AreaChart
                    data={history}
                    margin={{ left: -20, right: 10, top: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#131b2e" />
                    <XAxis dataKey="time" tick={{ fill: "#475569", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#475569", fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0d1527", borderColor: "#1e293b" }}
                      itemStyle={{ color: "#f1f5f9" }}
                    />
                    <Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="url(#colorCpu)" fillOpacity={0.1} strokeWidth={2} name="CPU %" />
                    <Area type="monotone" dataKey="ram" stroke="#818cf8" fill="url(#colorRam)" fillOpacity={0.05} strokeWidth={2} name="RAM %" />
                    <defs>
                      <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="xl:col-span-4">
            <Panel title="Real-time Alert Log" icon={AlertTriangle}>
              <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                {alerts.length === 0 ? (
                  <div className="py-12 text-center font-mono text-xs text-slate-500">
                    No active threshold breaches.
                  </div>
                ) : (
                  alerts.map((alert, idx) => {
                    const severity = severityFromAlert(alert);
                    return (
                      <div key={idx} className="flex items-start gap-2.5 rounded-lg border border-slate-800/60 bg-[#070b14]/80 p-2.5 text-xs">
                        <span className={cx(
                          "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider",
                          severity === "CRITICAL" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400"
                        )}>
                          {severity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-200 truncate font-semibold">{alert.device_id || "Node Event"}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{alert.message || `Resource spike detected: CPU ${alert.cpu}%`}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}