import { useEffect, useState } from "react";
import { subscribeConnectivity, getConnectivityStatus, type SyncStatus } from "@/lib/offline/connectivity";

const LABEL: Record<SyncStatus, { text: string; tone: string }> = {
  offline: { text: "دون اتصال", tone: "bg-amber-500" },
  online: { text: "متصل", tone: "bg-emerald-500" },
  syncing: { text: "جاري المزامنة…", tone: "bg-sky-500 animate-pulse" },
  synced: { text: "تمت المزامنة", tone: "bg-emerald-600" },
  error: { text: "تعذر المزامنة", tone: "bg-red-500" },
};

/**
 * Compact Offline / Syncing / Synced status — never obstructs the editor canvas.
 * Fixed corner pill, RTL friendly, minimal footprint. Only shows offline/syncing
 * prominently; "online/synced" fades quickly.
 */
export function OfflineStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<SyncStatus>(getConnectivityStatus().status);
  const [online, setOnline] = useState(getConnectivityStatus().online);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const unsub = subscribeConnectivity((s, isOnline) => {
      setStatus(s);
      setOnline(isOnline);
      setVisible(true);
    });
    return unsub;
  }, []);

  // Auto-hide "online/synced" after 3s so it doesn't clutter editor
  useEffect(() => {
    if (status === "online" || status === "synced") {
      const t = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(t);
    }
    setVisible(true);
  }, [status]);

  if (!visible && (status === "online" || status === "synced")) return null;

  // Always show when offline or syncing/error
  const show = visible || status === "offline" || status === "syncing" || status === "error";
  if (!show) return null;

  const meta = LABEL[status];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-status"
      className={[
        "pointer-events-none fixed bottom-3 end-3 z-[9999] select-none",
        compact ? "bottom-2 end-2" : "",
      ].join(" ")}
    >
      <div
        className={[
          "inline-flex items-center gap-2 rounded-full border bg-surface/95 px-3 py-1.5 text-[11px] font-bold shadow-lg backdrop-blur",
          status === "offline" ? "border-amber-300 text-amber-900" : "border-line text-ink",
          "transition-opacity",
        ].join(" ")}
      >
        <span className={["size-2 rounded-full", meta.tone].join(" ")} aria-hidden />
        <span>{meta.text}</span>
        {!online && status !== "offline" && <span className="text-muted">· دون اتصال</span>}
      </div>
    </div>
  );
}

/** Inline badge for header/workspace — smaller, for toolbar areas */
export function OfflineBadge() {
  const [status, setStatus] = useState<SyncStatus>(getConnectivityStatus().status);
  useEffect(() => subscribeConnectivity((s) => setStatus(s)), []);
  if (status === "online" || status === "synced") return null;
  const meta = LABEL[status];
  return (
    <span
      data-testid="offline-badge"
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-bold"
    >
      <span className={["size-1.5 rounded-full", meta.tone].join(" ")} aria-hidden />
      {meta.text}
    </span>
  );
}
