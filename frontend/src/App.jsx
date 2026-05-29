import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  LayoutDashboard,
  LogOut,
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

import WebsiteMonitorPanel from "./components/WebsiteMonitorPanel";
import RegisteredDevicesPanel from "./components/RegisteredDevicesPanel";

const MAX_HISTORY = 42;
const MAX_ALERTS = 30;
const NODE_TIMEOUT_MS = 20000;

const GATEWAY_API_BASE =
  import.meta.env.VITE_GATEWAY_API_BASE || "http://localhost:8000";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8765";

const STREAMER_HEALTH_URL =
  import.meta.env.VITE_STREAMER_HEALTH_URL || "http://localhost:8766/health";

const GATEWAY_HEALTH_URL = `${GATEWAY_API_BASE}/health`;

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getStoredOrganization() {
  return safeJsonParse(localStorage.getItem("aether_organization"), null);
}

function getOrgNodeStorageKey(orgId) {
  return `aether_nodes_${orgId}`;
}

function loadNodesForOrg(orgId) {
  if (!orgId) return {};

  try {
    const saved = localStorage.getItem(getOrgNodeStorageKey(orgId));
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
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

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("accounta@example.com");
  const [password, setPassword] = useState("Password123!");
  const [fullName, setFullName] = useState("Tanuj");
  const [organizationName, setOrganizationName] = useState("Account A Workspace");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submitAuth(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint =
        mode === "signup"
          ? `${GATEWAY_API_BASE}/api/v1/auth/signup`
          : `${GATEWAY_API_BASE}/api/v1/auth/login`;

      const body =
        mode === "signup"
          ? {
              email,
              password,
              full_name: fullName,
              organization_name: organizationName,
            }
          : {
              email,
              password,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();

        if (response.status === 409) {
          throw new Error("That email already exists. Switch to Login.");
        }

        if (response.status === 401) {
          throw new Error("Invalid email or password.");
        }

        throw new Error(text || "Authentication failed");
      }

      const data = await response.json();
      onAuthenticated(data);
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-10 px-6 py-8 lg:grid-cols-2">
        <section className="flex flex-col justify-center">
          <div className="mb-5 inline-flex w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
            AETHER Cloud
          </div>

          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Enterprise observability for websites, APIs, and infrastructure.
          </h1>

          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-400">
            Create a workspace, add uptime checks without installing anything,
            and enroll machines with an agent when you need CPU, memory, disk,
            and anomaly telemetry.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#0d1527]/70 p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Auth
              </p>
              <p className="mt-2 text-2xl font-bold text-white">JWT</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0d1527]/70 p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Storage
              </p>
              <p className="mt-2 text-2xl font-bold text-white">Postgres</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0d1527]/70 p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Stream
              </p>
              <p className="mt-2 text-2xl font-bold text-white">Kafka</p>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <form
            onSubmit={submitAuth}
            className="w-full rounded-2xl border border-slate-800/80 bg-[#0d1527]/60 p-6 shadow-2xl shadow-black/30 backdrop-blur"
          >
            <div className="mb-6">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                {mode === "signup" ? "Create Workspace" : "Login"}
              </p>
              <h2 className="mt-1 text-2xl font-bold text-white">
                {mode === "signup" ? "Start monitoring" : "Welcome back"}
              </h2>
            </div>

            <div className="space-y-4">
              {mode === "signup" && (
                <>
                  <div>
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Full Name
                    </label>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Organization
                    </label>
                    <input
                      value={organizationName}
                      onChange={(event) =>
                        setOrganizationName(event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {loading
                ? "Processing..."
                : mode === "signup"
                ? "Create Account"
                : "Login"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setMode((prev) => (prev === "signup" ? "login" : "signup"));
                setError(null);
              }}
              className="mt-4 w-full text-center text-xs text-slate-500 hover:text-cyan-300"
            >
              {mode === "signup"
                ? "Already have an account? Login"
                : "Need an account? Sign up"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function OnboardingScreen({ onStartWebsite, onStartServer, onOpenDashboard }) {
  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight text-white">
              AETHER
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Website uptime, API health, and infrastructure telemetry.
            </p>
          </div>

          <button
            onClick={onOpenDashboard}
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 font-mono text-xs text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300"
          >
            Open Dashboard
          </button>
        </header>

        <main className="flex flex-1 items-center">
          <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-2">
            <section className="flex flex-col justify-center">
              <div className="mb-5 inline-flex w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                Enterprise Monitoring Platform
              </div>

              <h2 className="max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
                Monitor websites, APIs, and machines from one live operations
                dashboard.
              </h2>

              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-400">
                Start with a website check without installing anything. Add an
                agent later if you want server-level metrics like CPU, RAM,
                disk, and anomaly scoring.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-800/80 bg-[#0d1527]/60 p-5 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="mb-5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Onboarding
                </p>
                <h3 className="mt-1 text-2xl font-bold text-white">
                  What do you want to monitor?
                </h3>
              </div>

              <div className="space-y-4">
                <button
                  onClick={onStartWebsite}
                  className="group w-full rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-5 text-left transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300">
                        <Globe className="h-5 w-5" />
                      </div>

                      <div>
                        <h4 className="font-semibold text-white">
                          Add Website / API
                        </h4>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Check uptime, latency, HTTP status, API health, and
                          failure events. No script required.
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-1 h-4 w-4 text-slate-500 transition group-hover:text-cyan-300" />
                  </div>
                </button>

                <button
                  onClick={onStartServer}
                  className="group w-full rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-left transition hover:border-emerald-400/40 hover:bg-emerald-500/15"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-300">
                        <Server className="h-5 w-5" />
                      </div>

                      <div>
                        <h4 className="font-semibold text-white">
                          Add Server / Laptop
                        </h4>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Install the AETHER agent to collect CPU, RAM, disk,
                          throughput, and anomaly metrics from a machine.
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-1 h-4 w-4 text-slate-500 transition group-hover:text-emerald-300" />
                  </div>
                </button>

                <button
                  onClick={onOpenDashboard}
                  className="group w-full rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-left transition hover:border-slate-600 hover:bg-slate-900/70"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-300">
                        <LayoutDashboard className="h-5 w-5" />
                      </div>

                      <div>
                        <h4 className="font-semibold text-white">
                          Open Dashboard
                        </h4>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Skip onboarding and go directly to your monitoring
                          dashboard.
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-1 h-4 w-4 text-slate-500 transition group-hover:text-slate-300" />
                  </div>
                </button>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, detail, tone = "cyan" }) {
  const toneMap = {
    cyan: "from-cyan-500/10 to-blue-500/5 border-cyan-500/20 text-cyan-400",
    emerald:
      "from-emerald-500/10 to-teal-500/5 border-emerald-500/20 text-emerald-400",
    amber:
      "from-amber-500/10 to-orange-500/5 border-amber-500/20 text-amber-400",
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

  const databaseOnline = Boolean(gatewayHealth?.database_connected);
  const streamerOnline = streamerHealth?.status === "online";

  const items = [
    {
      label: "Gateway",
      value: gatewayOnline ? "Online" : "Offline",
      detail: "FastAPI ingestion layer",
      online: gatewayOnline,
    },
    {
      label: "Database",
      value: databaseOnline ? "Online" : "Offline",
      detail: "Postgres persistence layer",
      online: databaseOnline,
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
      label: "Telemetry Events",
      value: streamerHealth?.message_counts?.["telemetry-stream"] ?? 0,
      detail: "Kafka telemetry messages",
      online: streamerOnline,
    },
    {
      label: "Website Events",
      value: streamerHealth?.message_counts?.["website-monitor-stream"] ?? 0,
      detail: "Website monitor checks",
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
        {items.map((item) => (
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
  const cleanServerUrl = (enrollmentServerUrl || GATEWAY_API_BASE).replace(
    /\/$/,
    ""
  );

  const token = enrollmentResult?.enrollment_token;

  const windowsCommand = token
    ? `cd C:\\Users\\Tanuj\\telemetry-platform\nSet-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned\n.\\install\\install_windows_agent.ps1 -EnrollmentToken "${token}" -GatewayUrl "${cleanServerUrl}" -UseLocalSource`
    : "";

  const linuxGatewayUrl = cleanServerUrl.includes("localhost")
    ? "http://$(ip route | awk '/default/ {print $3}'):8000"
    : cleanServerUrl;

  const linuxCommand = token
    ? `cd /mnt/c/Users/Tanuj/telemetry-platform\n./install/install_linux_agent.sh --token "${token}" --gateway-url "${linuxGatewayUrl}" --use-local-source`
    : "";

  return (
    <Panel
      title="Add Server / Laptop"
      subtitle="Generate an enrollment token and installer command for machine telemetry"
      icon={Server}
      right={
        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-400">
          Agent Required
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
            placeholder="Friend-Laptop-Node01"
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Organization
          </label>
          <input
            value={enrollmentOrgName}
            onChange={(event) => setEnrollmentOrgName(event.target.value)}
            placeholder="Local Development Tenant"
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Gateway Server URL
          </label>
          <input
            value={enrollmentServerUrl}
            onChange={(event) => setEnrollmentServerUrl(event.target.value)}
            placeholder="http://localhost:8000"
            className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
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
          Use this only when you want to monitor CPU, memory, disk, and system
          metrics.
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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <textarea
              readOnly
              value={windowsCommand}
              className="h-40 w-full rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono text-xs text-slate-300 outline-none"
            />

            <textarea
              readOnly
              value={linuxCommand}
              className="h-40 w-full rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono text-xs text-slate-300 outline-none"
            />
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
          ["CORE_UTIL", cpu, Cpu],
          ["MEM_COMMIT", ram, HardDrive],
          ["AI_ANOMALY", anomaly, Activity],
        ].map(([label, value, Icon]) => (
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
                className="h-full rounded-full bg-cyan-400 transition-all duration-500 ease-out"
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
  const [authToken, setAuthToken] = useState(
    () => localStorage.getItem("aether_access_token") || ""
  );

  const [currentUser, setCurrentUser] = useState(() =>
    safeJsonParse(localStorage.getItem("aether_user"), null)
  );

  const [currentOrganization, setCurrentOrganization] = useState(() =>
    getStoredOrganization()
  );

  const currentOrgId = currentOrganization?.organization_id || "";

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => localStorage.getItem("aether_onboarded") === "true"
  );

  const [metrics, setMetrics] = useState(() => loadNodesForOrg(currentOrgId));
  const [loadedOrgId, setLoadedOrgId] = useState(currentOrgId);

  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState("OFFLINE");
  const [history, setHistory] = useState([]);

  const [gatewayHealth, setGatewayHealth] = useState(null);
  const [streamerHealth, setStreamerHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);

  const [websites, setWebsites] = useState([]);
  const [registeredDevices, setRegisteredDevices] = useState([]);
  const [registeredDevicesError, setRegisteredDevicesError] = useState(null);

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

  function clearLiveDashboardState() {
    setWebsites([]);
    setRegisteredDevices([]);
    setMetrics({});
    setAlerts([]);
    setHistory([]);
    setEnrollmentResult(null);
    setEnrollmentError(null);
    setRegisteredDevicesError(null);
  }

  function logout() {
    localStorage.removeItem("aether_access_token");
    localStorage.removeItem("aether_user");
    localStorage.removeItem("aether_organization");
    localStorage.removeItem("aether_onboarded");

    setAuthToken("");
    setCurrentUser(null);
    setCurrentOrganization(null);
    setLoadedOrgId("");
    setHasCompletedOnboarding(false);
    clearLiveDashboardState();
  }

  function handleAuthenticated(payload) {
    localStorage.setItem("aether_access_token", payload.access_token);
    localStorage.setItem("aether_user", JSON.stringify(payload.user));
    localStorage.setItem(
      "aether_organization",
      JSON.stringify(payload.organization)
    );

    setAuthToken(payload.access_token);
    setCurrentUser(payload.user);
    setCurrentOrganization(payload.organization);
    setHasCompletedOnboarding(false);
    localStorage.removeItem("aether_onboarded");

    clearLiveDashboardState();
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      logout();
    }

    return response;
  }

  function completeOnboarding() {
    localStorage.setItem("aether_onboarded", "true");
    setHasCompletedOnboarding(true);
  }

  function resetOnboarding() {
    localStorage.removeItem("aether_onboarded");
    setHasCompletedOnboarding(false);
  }

  useEffect(() => {
    if (!currentOrgId) {
      setMetrics({});
      setLoadedOrgId("");
      return;
    }

    setMetrics(loadNodesForOrg(currentOrgId));
    setLoadedOrgId(currentOrgId);
    setAlerts([]);
    setHistory([]);
    setWebsites([]);
    setRegisteredDevices([]);
    setEnrollmentResult(null);
  }, [currentOrgId]);

  useEffect(() => {
    if (!currentOrgId || loadedOrgId !== currentOrgId) return;

    localStorage.setItem(
      getOrgNodeStorageKey(currentOrgId),
      JSON.stringify(metrics)
    );
  }, [metrics, currentOrgId, loadedOrgId]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!authToken) return;

    async function loadMe() {
      try {
        const response = await apiFetch(`${GATEWAY_API_BASE}/api/v1/me`);

        if (!response.ok) {
          throw new Error("Failed to load current user");
        }

        const data = await response.json();

        setCurrentUser(data.user);
        setCurrentOrganization(data.organization);
        localStorage.setItem("aether_user", JSON.stringify(data.user));
        localStorage.setItem(
          "aether_organization",
          JSON.stringify(data.organization)
        );
      } catch {
        logout();
      }
    }

    loadMe();
  }, [authToken]);

  async function refreshWebsites() {
    if (!authToken || !currentOrgId) return;

    try {
      const response = await apiFetch(`${GATEWAY_API_BASE}/api/v1/websites`);

      if (!response.ok) {
        throw new Error("Failed to fetch websites");
      }

      const data = await response.json();
      setWebsites(data.websites || []);
    } catch (err) {
      console.error("refreshWebsites:", err);
    }
  }

  async function refreshRegisteredDevices() {
    if (!authToken || !currentOrgId) return;

    try {
      const response = await apiFetch(`${GATEWAY_API_BASE}/api/v1/devices`);

      if (!response.ok) {
        throw new Error("Failed to fetch registered devices");
      }

      const data = await response.json();
      setRegisteredDevices(data.devices || []);
      setRegisteredDevicesError(null);
    } catch (err) {
      setRegisteredDevicesError(
        err.message || "Failed to fetch registered devices"
      );
    }
  }

  function handleDeleteRegisteredDevice(deviceId) {
    setRegisteredDevices((prev) =>
      prev.filter((device) => device.device_id !== deviceId)
    );

    setMetrics((prev) => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }

  useEffect(() => {
    if (!authToken || !currentOrgId) return;

    refreshWebsites();
    const interval = setInterval(refreshWebsites, 5000);

    return () => clearInterval(interval);
  }, [authToken, currentOrgId]);

  useEffect(() => {
    if (!authToken || !currentOrgId) return;

    refreshRegisteredDevices();
    const interval = setInterval(refreshRegisteredDevices, 5000);

    return () => clearInterval(interval);
  }, [authToken, currentOrgId]);

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

        const [gatewayData, streamerData] = await Promise.all([
          gatewayResponse.json(),
          streamerResponse.json(),
        ]);

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
    if (!authToken || !currentOrgId) return;

    let socket;

    try {
      socket = new WebSocket(WS_URL);
    } catch (err) {
      console.error("WebSocket initialization failed:", err);
      return undefined;
    }

    socket.onopen = () => setStatus("OPERATIONAL");
    socket.onclose = () => setStatus("OFFLINE");
    socket.onerror = () => setStatus("DEGRADED");

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const now = new Date();

        if (!data.organization_id || data.organization_id !== currentOrgId) {
          return;
        }

        if (data.packet_type === "WEBSITE") {
          setWebsites((prev) => {
            const updated = {
              website_id: data.website_id,
              organization_id: data.organization_id,
              name: data.name,
              url: data.url,
              status: data.status,
              expected_status: data.expected_status,
              last_checked: data.timestamp,
              last_status_code: data.status_code,
              last_latency_ms: data.latency_ms,
              last_error: data.error,
            };

            const exists = prev.some(
              (site) => site.website_id === data.website_id
            );

            if (!exists) return [updated, ...prev];

            return prev.map((site) =>
              site.website_id === data.website_id
                ? { ...site, ...updated }
                : site
            );
          });

          return;
        }

        const inner = data.metrics || {};
        const cpu = clamp(inner.cpu_usage_pct ?? data.cpu_usage_pct ?? 0);
        const ram = clamp(inner.memory_usage_pct ?? data.memory_usage_pct ?? 0);
        const anomaly = clamp(inner.anomaly_score ?? data.anomaly_score ?? 0);
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
        console.error("WS parse error:", err);
      }
    };

    return () => socket?.close();
  }, [authToken, currentOrgId]);

  async function createEnrollmentToken() {
    setEnrollmentLoading(true);
    setEnrollmentError(null);
    setEnrollmentResult(null);

    try {
      const cleanUrl = enrollmentServerUrl.replace(/\/$/, "");

      const response = await apiFetch(
        `${cleanUrl}/api/v1/devices/enrollment-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organization_name: currentOrganization?.name || enrollmentOrgName,
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
    } catch (err) {
      setEnrollmentError(err.message || "Failed to create enrollment token");
    } finally {
      setEnrollmentLoading(false);
    }
  }

  const devices = Object.entries(metrics);

  const summary = useMemo(() => {
    const active = devices
      .map(([, node]) => node)
      .filter(
        (node) =>
          nowMs - Number(node.lastUpdatedTimestamp || 0) <= NODE_TIMEOUT_MS
      );

    const avgCpu = active.length
      ? active.reduce((sum, node) => sum + clamp(node.cpu), 0) / active.length
      : 0;

    const avgRam = active.length
      ? active.reduce((sum, node) => sum + clamp(node.ram), 0) / active.length
      : 0;

    const critical = active.filter(
      (node) =>
        clamp(node.cpu) >= 85 ||
        clamp(node.ram) >= 90 ||
        clamp(node.anomaly) >= 75
    ).length;

    const throughput = active.reduce(
      (sum, node) => sum + (Number(node.throughput) || 0),
      0
    );

    const websiteDownCount = websites.filter(
      (site) => site.status === "down"
    ).length;

    return {
      avgCpu,
      avgRam,
      critical,
      websiteDownCount,
      throughput: throughput || 12000,
      fleetHealth: active.length
        ? Math.max(0, 100 - critical * 20 - avgCpu * 0.1)
        : 100,
    };
  }, [devices, websites, nowMs]);

  if (!authToken) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (!hasCompletedOnboarding) {
    return (
      <OnboardingScreen
        onStartWebsite={completeOnboarding}
        onStartServer={completeOnboarding}
        onOpenDashboard={completeOnboarding}
      />
    );
  }

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
              {currentOrganization?.name || "Workspace"} ·{" "}
              {currentUser?.email || "Authenticated user"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={resetOnboarding}
              className="rounded-full border border-slate-800 bg-slate-900/40 px-3.5 py-1.5 font-mono text-[10px] text-slate-400 hover:text-cyan-300"
            >
              ONBOARDING
            </button>

            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3.5 py-1.5 font-mono text-[10px] text-rose-300 hover:bg-rose-500/20"
            >
              <LogOut className="h-3 w-3" />
              LOGOUT
            </button>

            <span className="rounded-full border border-slate-800 bg-slate-900/40 px-3.5 py-1.5 font-mono text-[10px] text-cyan-400">
              API: {GATEWAY_API_BASE}
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
            detail="Active infrastructure health matrix"
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
            label="Active Issues"
            value={alerts.length + summary.websiteDownCount}
            detail={`${summary.critical} node breaches, ${summary.websiteDownCount} website failures`}
            tone="rose"
          />
        </section>

        <SystemStatusPanel
          gatewayHealth={gatewayHealth}
          streamerHealth={streamerHealth}
          healthError={healthError}
        />

        <WebsiteMonitorPanel
          gatewayBaseUrl={GATEWAY_API_BASE}
          apiFetch={apiFetch}
          websites={websites}
          setWebsites={setWebsites}
          refreshWebsites={refreshWebsites}
        />

        <RegisteredDevicesPanel
          gatewayBaseUrl={GATEWAY_API_BASE}
          apiFetch={apiFetch}
          devices={registeredDevices}
          refreshDevices={refreshRegisteredDevices}
          onDeleteDevice={handleDeleteRegisteredDevice}
          error={registeredDevicesError}
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
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#475569", fontSize: 10 }}
                    />
                    <YAxis
                      tick={{ fill: "#475569", fontSize: 10 }}
                      domain={[0, 100]}
                    />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="cpu"
                      name="CPU Core"
                      stroke="#22d3ee"
                      fill="#22d3ee"
                      fillOpacity={0.05}
                    />
                    <Area
                      type="monotone"
                      dataKey="ram"
                      name="Memory Commit"
                      stroke="#818cf8"
                      fill="#818cf8"
                      fillOpacity={0.04}
                    />
                    <Area
                      type="monotone"
                      dataKey="anomaly"
                      name="Anomaly Score"
                      stroke="#f43f5e"
                      fill="#f43f5e"
                      fillOpacity={0.04}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="xl:col-span-4">
            <Panel title="SLA Breach Pipeline Feed" icon={AlertTriangle}>
              <div className="custom-scrollbar max-h-[220px] space-y-2 overflow-y-auto">
                {alerts.length === 0 ? (
                  <div className="rounded-xl border border-slate-800/60 bg-[#070b14]/50 py-12 text-center">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      No node SLA breaches detected
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Alert stream is currently quiet.
                    </p>
                  </div>
                ) : (
                  alerts.map((alert, idx) => (
                    <div
                      key={`${alert.device_id}-${alert.timestamp}-${idx}`}
                      className="rounded border border-l-2 border-rose-950/40 border-l-rose-500 bg-[#070b14] p-3 font-mono text-[11px]"
                    >
                      <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                        <span>{severityFromAlert(alert)}</span>
                        <span>{formatTime(new Date(alert.timestamp))}</span>
                      </div>
                      <p className="text-slate-300">
                        Node{" "}
                        <span className="font-bold text-white">
                          {alert.device_id || "unknown-device"}
                        </span>{" "}
                        breached SLA boundary.
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}