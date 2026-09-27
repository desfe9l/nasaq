import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FolderInput } from "lucide-react";
import { toast } from "sonner";
import { useNsqSignedIn } from "@/lib/nsq/use-nsq-session";
import { isNsqFileName, likelyNsqDrag } from "@/lib/nsq/format";
import { clearPending, getPending, type PendingSummary } from "@/lib/nsq/inbox";
import {
  NSQ_PENDING_EVENT,
  receiveProjectFile,
  resumePending,
} from "@/lib/nsq/intake";
import { NsqAccountGate } from "@/components/nsq/NsqAccountGate";

/** Session flag: the visitor chose «لاحقًا» for this particular file. */
const DEFER_KEY = "nasaq-nsq-gate-deferred";

/**
 * Editor-side `.nsq` intake: drag & drop anywhere in the studio, resuming a
 * preserved file after sign-in, and the account gate for visitors.
 */
export function NsqIntake() {
  const { signedIn, resolving } = useNsqSignedIn();
  const [pending, setPending] = useState<
    (PendingSummary & { id: string; receivedAt: number }) | null
  >(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  const check = useCallback(async () => {
    if (resolving) return;
    const entry = await getPending();
    if (!entry) {
      setPending(null);
      setGateOpen(false);
      return;
    }
    if (signedIn) {
      setGateOpen(false);
      const ok = await resumePending();
      setRestoreFailed(!ok);
      setPending(
        ok
          ? null
          : { ...entry.summary, id: entry.id, receivedAt: entry.receivedAt },
      );
      return;
    }
    setPending({
      ...entry.summary,
      id: entry.id,
      receivedAt: entry.receivedAt,
    });
    let deferred = false;
    try {
      deferred = sessionStorage.getItem(DEFER_KEY) === String(entry.receivedAt);
    } catch {
      /* storage blocked — show the gate */
    }
    const explicit =
      new URLSearchParams(window.location.search).get("nsq") === "resume";
    setGateOpen(explicit || !deferred);
  }, [resolving, signedIn]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const onPending = () => {
      try {
        sessionStorage.removeItem(DEFER_KEY);
      } catch {
        /* ignore */
      }
      void check();
    };
    window.addEventListener(NSQ_PENDING_EVENT, onPending);
    return () => window.removeEventListener(NSQ_PENDING_EVENT, onPending);
  }, [check]);

  // Drag & drop an `.nsq` anywhere in the editor.
  useEffect(() => {
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      // Allow dropping files anywhere (panels, toolbar) instead of letting the
      // browser navigate away to the file. Canvas image drops keep their own
      // handler — it runs first and marks the event handled.
      e.preventDefault();
      if (likelyNsqDrag(e.dataTransfer)) {
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => setDragging(false), 250);
      }
    };
    const onDropCapture = (e: DragEvent) => {
      const file = Array.from(e.dataTransfer?.files || []).find((f) =>
        isNsqFileName(f.name),
      );
      setDragging(false);
      if (!file) return;
      // Capture phase on window: runs before the canvas/library handlers, so
      // an `.nsq` is opened as a project, never mistaken for an image.
      e.preventDefault();
      e.stopPropagation();
      void receiveProjectFile(file, signedInRef.current);
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDropCapture, true);
    window.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(leaveTimer);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDropCapture, true);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const later = useCallback(() => {
    setGateOpen(false);
    if (pending) {
      try {
        sessionStorage.setItem(DEFER_KEY, String(pending.receivedAt));
      } catch {
        /* ignore */
      }
    }
  }, [pending]);

  const discard = useCallback(async () => {
    try {
      await clearPending(pending?.id);
    } catch {
      toast.error("تعذر إزالة الملف من التخزين. حاول مجددًا.");
      return;
    }
    setRestoreFailed(false);
    setGateOpen(false);
    setPending(null);
    toast.message("أُزيل الملف المستلم");
  }, [pending?.id]);

  return (
    <>
      {dragging && (
        <div
          className="pointer-events-none fixed inset-0 z-[calc(var(--z-dialog)+1)] grid place-items-center bg-navy/35 p-6 backdrop-blur-[1px]"
          aria-hidden
        >
          <div className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-gold bg-surface/95 px-6 py-4 text-[14px] font-extrabold text-brand shadow-2xl">
            <FileDown className="size-5" />
            أفلت ملف نَسَق (.nsq) لفتحه كمشروع قابل للتعديل
          </div>
        </div>
      )}

      {pending && signedIn && restoreFailed && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 z-[var(--z-dialog)] max-w-sm rounded-xl border bg-surface p-4 text-sm text-brand shadow-xl"
        >
          <p>
            لم يكتمل فتح «{pending.title}». الملف محفوظ، ولم يتغير مشروعك
            الحالي.
          </p>
          <button
            type="button"
            className="mt-2 px-3 font-bold underline"
            onClick={() => void check()}
          >
            إعادة المحاولة
          </button>
          <button
            type="button"
            className="mt-2 px-3 underline"
            onClick={() => void discard()}
          >
            إزالة الملف
          </button>
        </div>
      )}

      {pending && gateOpen && !signedIn && (
        <NsqAccountGate
          summary={pending}
          onLater={later}
          onDiscard={() => void discard()}
        />
      )}

      {pending && !gateOpen && !signedIn && (
        <button
          type="button"
          onClick={() => setGateOpen(true)}
          className="fixed bottom-[max(1rem,var(--safe-bottom,0px))] left-4 z-[var(--z-dropdown)] inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-gold/50 bg-surface px-4 py-2 text-[12px] font-extrabold text-brand shadow-lg transition hover:bg-line-2"
        >
          <FolderInput className="size-4 shrink-0" />
          <span className="truncate">
            «{pending.title}» بانتظارك — سجّل الدخول لفتحه
          </span>
        </button>
      )}
    </>
  );
}
