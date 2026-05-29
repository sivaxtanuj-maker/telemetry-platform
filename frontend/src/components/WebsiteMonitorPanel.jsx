import React, { useState } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function statusStyle(status) {
  if (status === "up") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  if (status === "degraded") return "border-amber-500/20 bg-amber-500/10 text-amber-400";
  if (status === "down") return "border-rose-500/20 bg-rose-500/10 text-rose-400";
  return "border-slate-700 bg-slate-900/60 text-slate-400";
}

function formatCheckedTime(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return "Unknown"; }
}

export default function WebsiteMonitorPanel({
  gatewayBaseUrl, apiFetch, websites, setWebsites, refreshWebsites,
}) {
  const [name, setName] = useState("My Website");
  const [url, setUrl] = useState("https://example.com");
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function createWebsiteMonitor() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${gatewayBaseUrl}/api/v1/websites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          expected_status: Number(expectedStatus),
          check_interval_seconds: Number(intervalSeconds),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to create website monitor");
      }
      setName("My Website");
      setUrl("https://example.com");
      setExpectedStatus(200);
      setIntervalSeconds(10);
      await refreshWebsites();
    } catch (err) {
      setError(err.message || "Failed to create website monitor");
    } finally {
      setLoading(false);
    }
  }

  async function deleteWebsiteMonitor(websiteId) {
    try {
      const response = await apiFetch(
        `${gatewayBaseUrl}/api/v1/websites/${encodeURIComponent(websiteId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to delete website monitor");
      }
      setWebsites((prev) => prev.filter((site) => site.website_id !== websiteId));
    } catch (err) {
      setError(err.message || "Failed to delete website monitor");
    }
  }

  return (
    <section className="rounded-xl border border-slate-800/60 bg-[#0d1527]/40 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/50 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-400">
            <Globe className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
              Website Monitors
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Uptime and latency checks without installing an agent
            </p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-400">
          No Agent Required
        </span>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div>
            <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Monitor Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
              placeholder="My Website"
            />
          </div>
          <div className="xl:col-span-2">
            <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
              placeholder="https://example.com"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Expected Status</label>
            <input
              type="number"
              value={expectedStatus}
              onChange={(e) => setExpectedStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Interval Sec</label>
            <input
              type="number"
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={createWebsiteMonitor}
            disabled={loading}
            className={cx(
              "flex items-center gap-2 rounded-lg border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition",
              loading
                ? "border-slate-800 bg-slate-900 text-slate-500"
                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {loading ? "Adding..." : "Add Website"}
          </button>
          <p className="text-[11px] text-slate-500">
            Website/API checks do not require the user to install anything.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {websites.length === 0 ? (
          <div className="rounded-xl border border-slate-800/60 bg-[#070b14]/50 py-12 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
              No website monitors configured
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              Add a website URL to start uptime checks.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {websites.map((site) => (
              <div key={site.website_id} className="rounded-xl border border-slate-800/70 bg-[#070b14]/60 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-cyan-400" />
                      <h3 className="truncate text-sm font-semibold text-white">{site.name}</h3>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{site.url}</p>
                  </div>
                  <span className={cx("rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest", statusStyle(site.status))}>
                    {site.status || "unknown"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
                  <div className="rounded-lg border border-slate-900/70 bg-slate-950/40 p-2">
                    <p className="text-slate-500">Status Code</p>
                    <p className="mt-1 font-bold text-slate-200">{site.last_status_code ?? "—"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-900/70 bg-slate-950/40 p-2">
                    <p className="text-slate-500">Latency</p>
                    <p className="mt-1 font-bold text-slate-200">
                      {site.last_latency_ms != null ? `${site.last_latency_ms}ms` : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-900/70 bg-slate-950/40 p-2">
                    <p className="text-slate-500">Expected</p>
                    <p className="mt-1 font-bold text-slate-200">{site.expected_status}</p>
                  </div>
                  <div className="rounded-lg border border-slate-900/70 bg-slate-950/40 p-2">
                    <p className="text-slate-500">Last Checked</p>
                    <p className="mt-1 font-bold text-slate-200">{formatCheckedTime(site.last_checked)}</p>
                  </div>
                </div>

                {site.last_error && (
                  <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                    {site.last_error}
                  </div>
                )}

                <button
                  onClick={() => deleteWebsiteMonitor(site.website_id)}
                  className="mt-4 flex items-center gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Monitor
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}