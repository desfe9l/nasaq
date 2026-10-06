import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  editorStatusLabel,
  getConnectivityStatus,
  subscribeConnectivity,
  triggerSync,
  type EditorStatusCopy,
  type SyncStatus,
} from "@/lib/offline/connectivity";
import { useEditor } from "@/lib/editor/store";

const LABEL: Record<SyncStatus, { text: string; tone: string }> = {
  offline: { text: "متاح دون اتصال", tone: "bg-amber-500" },
  online: { text: "متصل", tone: "bg-emerald-500" },
  syncing: { text: "تتم المزامنة", tone: "bg-sky-500" },
  synced: { text: "متزامن", tone: "bg-emerald-600" },
  error: { text: "تعذر التزامن", tone: "bg-red-500" },
};

/**
 * Reveal a blocker only after it has actually lasted. Clearing `active`
 * hides immediately — this does not keep a finished load on screen.
 */
export function useRevealWhile(active: boolean, delay = 280): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  return visible;
}

/**
 * Compact Offline / Syncing / Synced status for pages outside the editor.
 * The editor has one status, in the workspace status bar — never a floating
 * badge over the page.
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
  if (
    path === "/" ||
    path.startsWith("/projects") ||
    path.startsWith("/purchase") ||
    path.startsWith("/account")
  ) {
    return null;
  }
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
        "pointer-events-none flex justify-center px-3",
        compact ? "py-1" : "py-2",
      ].join(" ")}
    >
      <div
        className={[
          "inline-flex max-w-full items-center gap-2 rounded-full border bg-surface/95 px-3 py-1.5 text-[11px] font-bold shadow-sm backdrop-blur",
          status === "offline" ? "border-amber-300 text-amber-900" : "border-line text-ink",
        ].join(" ")}
      >
        <span className={["size-2 shrink-0 rounded-full", meta.tone].join(" ")} aria-hidden />
        <span className="truncate">{meta.text}</span>
        {!online && status !== "offline" && <span className="text-muted">· دون اتصال</span>}
      </div>
    </div>
  );
}

const TONE: Record<EditorStatusCopy, string> = {
  "جارٍ فتح المستند": "is-sync",
  "محفوظ محليًا": "is-saved",
  "تتم المزامنة": "is-sync",
  "متزامن": "is-synced",
  "متاح دون اتصال": "is-offline",
  "تعذر التزامن": "is-error",
  "جارٍ الحفظ": "is-pending",
  "تغييرات محلية": "is-pending",
  "تعذر الحفظ": "is-error",
};

/** The only document status. Lives in editor chrome, never on the artboard. */
export function EditorSyncStatus() {
  const saveState = useEditor((s) => s.saveState);
  const phase = useEditor((s) => s.documentPhase);
  const [status, setStatus] = useState<SyncStatus>(getConnectivityStatus().status);
  const [online, setOnline] = useState(getConnectivityStatus().online);

  useEffect(() => {
    return subscribeConnectivity((next, isOnline) => {
      setStatus(next);
      setOnline(isOnline);
    });
  }, []);

  const label = editorStatusLabel(saveState, status, online, phase);
  const failed = label === "تعذر التزامن";

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="editor-sync-status"
      className={`editor-sync-status ${TONE[label]}`}
      title={label}
    >
      <span className="dot" aria-hidden />
      <span className="editor-sync-label">{label}</span>
      {failed && (
        <button
          type="button"
          className="editor-sync-retry"
          onClick={() => triggerSync()}
        >
          إعادة المحاولة
        </button>
      )}
    </span>
  );
}