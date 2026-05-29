import React, { useState } from "react";
import { Activity, Cpu, HardDrive, Monitor, RefreshCw, Server, Trash2 } from "lucide-react";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(value) {
  if (!value) return "Never";
  try { return new Date(value).toLocaleString(); }
  catch { return "Unknown"; }
}

function statusStyle(status) {
  if (status === "online") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  if (status === "registered") return "border-cyan-500/20 bg-cyan-500/10 text-cyan-400";
  if (status === "offline") return "border-slate-700 bg-slate-900/60 text-slate-400";
  return "border-slate-700 bg-slate-900/60 text-slate-400";
}

export default function RegisteredDevicesPanel({
  gatewayBaseUrl, apiFetch, devices, refreshDevices, onDeleteDevice, error,
}) {
  const [deletingId, setDeletingId] = useState(null);

  async function deleteDevice(deviceId) {
    const confirmed = window.confirm(
      `Delete device "${deviceId}" from the registry? Stop the agent first or it may reappear.`
    );
    if (!confirmed) return;
    setDeletingId(deviceId);
    try {
      const response = await apiFetch(
        `${gatewayBaseUrl}/api/v1/devices/${encodeURIComponent(deviceId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to delete device");
      }
      onDeleteDevice(deviceId);
      await refreshDevices();
    } catch (err) {
      alert(err.message || "Failed to delete device");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800/60 bg-[#0d1527]/40 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/50 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-400">
            <Server className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
              Registered Devices
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Backend device registry and machine enrollment records
            </p>
          </div>
        </div>
        <button
          onClick={refreshDevices}
          className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {devices.length === 0 ? (
          <div className="rounded-xl border border-slate-800/60 bg-[#070b14]/50 py-12 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
              No registered devices
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              Use Add Server / Laptop to enroll a machine.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800/70">
            <div className="grid grid-cols-12 gap-3 border-b border-slate-800 bg-[#070b14] px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <div className="col-span-3">Device</div>
              <div className="col-span-2">Platform</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Last Seen</div>
              <div className="col-span-2">Last Metrics</div>
              <div className="col-span-1 text-right">Action</div>
            </div>

            <div className="divide-y divide-slate-800/70">
              {devices.map((device) => {
                const metrics = device.last_metrics || {};
                const cpu = metrics.cpu_usage_pct;
                const ram = metrics.memory_usage_pct;
                const anomaly = metrics.anomaly_score;

                return (
                  <div key={device.device_id} className="grid grid-cols-12 items-center gap-3 bg-[#0d1527]/40 px-4 py-4 text-sm">
                    <div className="col-span-3 min-w-0">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 shrink-0 text-cyan-400" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{device.device_id}</p>
                          <p className="truncate font-mono text-[10px] text-slate-500">{device.hostname || "unknown-host"}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <p className="font-mono text-xs text-slate-300">{device.platform || "unknown"}</p>
                      <p className="font-mono text-[10px] text-slate-600">v{device.agent_version || "unknown"}</p>
                    </div>
                    <div className="col-span-2">
                      <span className={cx("rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest", statusStyle(device.status))}>
                        {device.status || "unknown"}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <p className="font-mono text-[11px] text-slate-400">{formatTime(device.last_seen)}</p>
                    </div>
                    <div className="col-span-2">
                      {device.last_metrics ? (
                        <div className="space-y-1 font-mono text-[10px] text-slate-400">
                          <p className="flex items-center gap-1">
                            <Cpu className="h-3 w-3 text-cyan-400" />
                            CPU: {cpu != null ? `${Number(cpu).toFixed(1)}%` : "—"}
                          </p>
                          <p className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3 text-indigo-400" />
                            RAM: {ram != null ? `${Number(ram).toFixed(1)}%` : "—"}
                          </p>
                          <p className="flex items-center gap-1">
                            <Activity className="h-3 w-3 text-rose-400" />
                            AI: {anomaly != null ? `${Number(anomaly).toFixed(1)}%` : "—"}
                          </p>
                        </div>
                      ) : (
                        <p className="font-mono text-[11px] text-slate-600">No metrics yet</p>
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => deleteDevice(device.device_id)}
                        disabled={deletingId === device.device_id}
                        className="rounded border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                        title="Delete device"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}