import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CloudOff, RefreshCw } from "lucide-react";
import {
  documentStatus,
  type DocumentStatus,
} from "@/lib/editor/document-status";
import {
  getConnectivity,
  retrySync,
  subscribeConnectivity,
  type ConnectivitySnapshot,
} from "@/lib/offline/connectivity";
import { useEditor } from "@/lib/editor/store";
import { WORKSPACE_ROUTE } from "@/lib/site-routes";

/**
 * The ONE visible document/sync status.
 *
 * House rule, and the reason this file replaced three separate indicators:
 *
 *   · exactly ONE component renders the document's state at a time — the
 *     editor's chrome chip (`EditorDocumentStatus`) or, outside the editor, the
 *     compact site pill (`OfflineStatus`), and never both on the same screen;
 *   · the state comes from ONE projection (`documentStatus()`), so «جارٍ
 *     الحفظ» can never be painted by two components and «تحميل» can never mean
 *     a save or a sync;
 *   · the status lives in CHROME (the header capsule / a status pill), never
 *     over the canvas, the artboard, the text or the toolbars;
 *   · no timer decides what the author sees: a state disappears when the state
 *     itself changes, not because a few seconds passed.
 */

function useConnectivity(): ConnectivitySnapshot {
  return useSyncExternalStore(
    subscribeConnectivity,
    getConnectivity,
    getConnectivity,
  );
}

function useDocumentStatus(): DocumentStatus {
  const phase = useEditor((s) => s.documentPhase);
  const save = useEditor((s) => s.saveState);
  const saveArmed = useEditor((s) => s.saveArmed);
  const showcase = useEditor((s) => s.showcase);
  const conn = useConnectivity();
  return useMemo(
    () =>
      documentStatus({
        phase,
        save,
        saveArmed,
        online: conn.online,
        sync: conn.sync,
        pendingSync: conn.pending,
        lastSyncedAt: conn.lastSyncedAt,
        /* The showcase preview is interactive but never persisted. */
        persisted: !showcase,
      }),
    [phase, save, saveArmed, showcase, conn],
  );
}

/**
 * Always-visible document status for the editor header capsule.
 *
 * It owns the save state, the sync state and the connection state — the
 * `SaveNowButton` beside it is an ACTION, so the same state is never rendered
 * twice. A `retryable` state turns the chip into the retry control.
 */
export function EditorDocumentStatus({ compact = false }: { compact?: boolean }) {
  const status = useDocumentStatus();
  const retry = useCallback(() => {
    if (status.kind === "sync-error") retrySync();
    else if (status.kind === "save-error") void useEditor.getState().saveNow();
  }, [status.kind]);

  const label = compact ? status.short : status.label;
  const className = [
    "editor-sync-status",
    `is-${status.tone}`,
    status.busy && "is-busy",
    status.retryable && "is-action",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {status.degradedByOffline ? (
        <CloudOff className="glyph" aria-hidden />
      ) : (
        <span className="dot" aria-hidden />
      )}
      <span className="label">{label}</span>
      {status.retryable && <RefreshCw className="glyph" aria-hidden />}
    </>
  );

  if (status.retryable)
    return (
      <button
        type="button"
        role="status"
        aria-live="polite"
        data-testid="editor-sync-status"
        data-status={status.kind}
        className={className}
        title={`${status.detail} — انقر لإعادة المحاولة`}
        aria-label={`${status.label}. ${status.detail} اضغط لإعادة المحاولة`}
        onClick={retry}
      >
        {body}
      </button>
    );

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="editor-sync-status"
      data-status={status.kind}
      className={className}
      title={status.detail}
      aria-label={`${status.label}. ${status.detail}`}
    >
      {body}
    </span>
  );
}

/**
 * Compact connectivity pill for pages OUTSIDE the editor.
 *
 * Only actionable states are shown at all (`offline`, a real `syncing`, or a
 * failed sync): «متصل» / «تمت المزامنة» were noise that floated over page
 * content indefinitely. It sits inside the safe area, below dialogs and toasts
 * in the z order, and never swallows a pointer event — the retry button is the
 * only interactive part.
 */
export function OfflineStatus() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const conn = useConnectivity();

  const offline = !conn.online;
  const error = conn.sync === "error";
  const syncing = conn.sync === "syncing";

  /* The editor has ONE status, in its chrome; never a second floating one. */
  if (path.startsWith("/editor")) return null;
  /* Nothing actionable to say. This is why the old pill never left the screen. */
  if (!offline && !error && !syncing) return null;
  /*
   * مساحة العمل paints its own in-flow offline notice (it also explains that
   * saving and syncing resume on reconnection). One fact, one surface: while
   * offline this pill would be saying the same thing twice on that page.
   */
  if (offline && path.startsWith(WORKSPACE_ROUTE)) return null;

  const text = offline ? "دون اتصال" : syncing ? "جارٍ المزامنة…" : "تعذر التزامن";
  const detail = offline
    ? "المشاريع والمستندات المحفوظة متاحة للعمل دون اتصال — ستتم المزامنة تلقائيًا عند عودة الاتصال."
    : syncing
      ? "تُزامن تغييراتك المحفوظة محليًا مع الخدمة."
      : "تعذر إرسال بعض التغييرات إلى الخدمة. بياناتك المحلية سليمة.";

  return (
    <div
      className={[
        /* Chrome, not content: centred inside the safe area, below dialogs and
         * toasts in the z order, and never a target for stray taps. */
        "pointer-events-none fixed inset-x-0 bottom-[calc(12px+var(--safe-bottom,0px))] z-[var(--z-dropdown)] flex justify-center px-3",
        "print:hidden",
      ].join(" ")}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-status"
        data-status={offline ? "offline" : conn.sync}
        className={[
          "inline-flex max-w-[min(92vw,32rem)] items-center gap-2 rounded-full border bg-surface px-3 py-1.5 text-[11px] font-bold text-ink shadow-lg",
          offline ? "border-warning" : error ? "border-error" : "border-line",
        ].join(" ")}
        title={detail}
      >
        {offline ? (
          <CloudOff className="size-3.5 shrink-0 text-warning" aria-hidden />
        ) : (
          <span
            className={[
              "size-2 shrink-0 rounded-full",
              error ? "bg-error" : "bg-brand",
            ].join(" ")}
            aria-hidden
          />
        )}
        <span>{text}</span>
        {offline && (
          <span className="hidden text-muted sm:inline">
            · المستندات المحفوظة متاحة للعمل
          </span>
        )}
        {error && (
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-line px-2 py-0.5 font-extrabold"
            onClick={() => retrySync()}
          >
            إعادة المحاولة
          </button>
        )}
      </div>
    </div>
  );
}
