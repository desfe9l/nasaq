import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  editorStatusLabel,
  getConnectivityStatus,
  subscribeConnectivity,
  type SyncStatus,
} from "@/lib/offline/connectivity";
import { useEditor } from "@/lib/editor/store";

const LABEL: Record<SyncStatus, { text: string; tone: string }> = {
  offline: { text: "دون اتصال", tone: "bg-amber-500" },
  online: { text: "متصل", tone: "bg-emerald-500" },
  syncing: { text: "جاري المزامنة", tone: "bg-sky-500 animate-pulse" },
  synced: { text: "تمت المزامنة", tone: "bg-emerald-600" },
  error: { text: "تعذر المزامنة", tone: "bg-red-500" },
};

/**
 * Compact Offline / Syncing / Synced status for pages outside the editor.
 * The editor has its own header indicator (`EditorSyncStatus`).
 */
export function OfflineStatus({ compact = false }: { compact?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
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

  useEffect(() => {
    if (status === "online" || status === "synced") {
      const t = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(t);
    }
    setVisible(true);
  }, [status]);

  if (path.startsWith("/editor")) return null;
  if (!visible && (status === "online" || status === "synced")) return null;

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

/** Always-visible save + sync state in the editor header. */
export function EditorSyncStatus() {
  const saveState = useEditor((s) => s.saveState);
  const [status, setStatus] = useState<SyncStatus>(getConnectivityStatus().status);
  const [online, setOnline] = useState(getConnectivityStatus().online);

  useEffect(() => {
    return subscribeConnectivity((next, isOnline) => {
      setStatus(next);
      setOnline(isOnline);
    });
  }, []);

  const label = editorStatusLabel(saveState, status, online);
  const tone =
    label === "دون اتصال"
      ? "is-offline"
      : label === "جاري الحفظ"
        ? "is-pending"
        : label === "جاري المزامنة"
          ? "is-sync"
          : label === "تمت المزامنة"
            ? "is-synced"
            : "is-saved";

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="editor-sync-status"
      className={`editor-sync-status ${tone}`}
      title={label}
    >
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}