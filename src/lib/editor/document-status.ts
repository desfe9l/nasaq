/**
 * ONE document state machine for the editor.
 *
 * Before this module the studio answered "what is happening?" from three
 * independent sources at once: `hydrated` (a boolean that a second hydration
 * could flip back), the autosave badge's own label, and the connectivity
 * module's `syncing/synced/online` cycle. Every one of them could paint a
 * loading-looking chip, so a fully loaded document could keep reporting
 * «جارٍ …» — and a later save or sync could put the editor back into what
 * looked like its opening state.
 *
 * The fix is a single, ordered projection:
 *
 *   idle → loading → ready                (the DOCUMENT, owned by the store)
 *   ready → saving  → saved               (autosave, owned by the store)
 *   ready → syncing → synced              (cloud mirror, owned by the engine)
 *   ready → sync-error                    (synchronisation failed, retryable)
 *
 * Only the first line may show an opening/loading affordance, and only the
 * store can move the phase; saving, syncing and the network never touch it.
 * Everything that renders a state renders THIS object, so one state can never
 * be painted twice and two states can never be painted at once.
 *
 * The phase unions are declared structurally rather than imported: the store's
 * `SaveState` and the engine's `SyncState` are assignable to them without
 * either module depending on the other.
 */

/** Where the document ITSELF is. Nothing but a document open moves this. */
export type DocumentPhase = "idle" | "loading" | "ready";

/** Autosave phases — structurally the store's `SaveState`. */
export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "error";

/** Background sync phases — structurally the connectivity engine's state. */
export type SyncPhase = "idle" | "syncing" | "error";

export type DocumentStatusKind =
  /** The document is being read. The ONLY state that renders as loading. */
  | "opening"
  /** Resting state: the document is in memory and there is nothing to report. */
  | "ready"
  /** Edits are covered by an armed autosave (debounce or in-flight write). */
  | "pending-save"
  /** Edits are held back (autosave paused, access not resolved yet). */
  | "unsaved"
  /** Saved on this device; the cloud mirror is still waiting. */
  | "local"
  | "syncing"
  | "synced"
  | "offline"
  | "save-error"
  | "sync-error";

/** Tone is a theme role, never a fixed colour (see `styles.css`). */
export type StatusTone = "neutral" | "pending" | "ok" | "warn" | "danger";

export interface DocumentStatusInput {
  /** The document lifecycle — the single source of truth. */
  phase: DocumentPhase;
  /** The autosave phase published by the store. */
  save: SavePhase;
  /**
   * True while autosave is armed (a debounce timer is pending or a write is in
   * flight). `dirty` without an armed save is honestly reported as unsaved
   * instead of pretending a write is happening.
   */
  saveArmed?: boolean;
  /** Navigator/engine view of the connection. */
  online: boolean;
  /** The background sync engine's phase. */
  sync: SyncPhase;
  /** The local sync queue holds this owner's operations. */
  pendingSync?: boolean;
  /** When a sync last completed (sticky — a real fact, not a flash message). */
  lastSyncedAt?: number | null;
  /** The open document lives on this device, so offline work is safe. */
  persisted?: boolean;
}

export interface DocumentStatus {
  kind: DocumentStatusKind;
  /** Full Arabic label for wide chrome. */
  label: string;
  /** Short label for phones, where the header has one line to spare. */
  short: string;
  tone: StatusTone;
  /** True only while the document itself is being read. */
  busy: boolean;
  /** What is true, and what happens next — the tooltip and the a11y sentence. */
  detail: string;
  /** The canvas is editable. Sync, saving and offline never change this. */
  ready: boolean;
  /** The document is safe on this device (offline-capable). */
  persisted: boolean;
  /** Offline is the CAUSE behind this state (renders the offline glyph). */
  degradedByOffline: boolean;
  /** A one-tap retry is meaningful for this state. */
  retryable: boolean;
}

/**
 * Project the whole editor into exactly ONE visible document state.
 *
 * The order is the priority. It encodes two product rules that the old code
 * broke: (1) «loading» belongs to opening a document and to nothing else, and
 * (2) what the author must act on (a failure) outranks what is merely
 * happening (a write, a sync, a connection).
 */
export function documentStatus(input: DocumentStatusInput): DocumentStatus {
  const {
    phase,
    save,
    saveArmed = false,
    online,
    sync,
    pendingSync = false,
    lastSyncedAt = null,
    persisted = false,
  } = input;

  const base = {
    ready: phase === "ready",
    persisted,
    degradedByOffline: !online,
    retryable: false,
    busy: false,
  } as const;

  /* 1 ─ Opening the document. The store owns this phase; a save, a sync or a
   *     network change can never re-enter it. */
  if (phase !== "ready")
    return {
      ...base,
      kind: "opening",
      label: "جارٍ فتح المستند…",
      short: "جارٍ الفتح…",
      tone: "neutral",
      busy: true,
      detail: persisted
        ? "يُفتح المستند من هذا الجهاز؛ لن ينتظر الشبكة."
        : "يُفتح المستند من هذا الجهاز…",
      ready: false,
    };

  /* 2 ─ Failures first: they are the only states that ask for an action. */
  if (save === "error")
    return {
      ...base,
      kind: "save-error",
      label: "تعذر الحفظ",
      short: "تعذر الحفظ",
      tone: "danger",
      detail:
        "لم يُحفظ آخر تعديل على هذا الجهاز. تحقق من مساحة تخزين المتصفح ثم أعد المحاولة.",
      retryable: true,
    };

  if (sync === "error")
    return {
      ...base,
      kind: "sync-error",
      label: "تعذر التزامن",
      short: "تعذر التزامن",
      tone: "danger",
      detail: persisted
        ? "نسخة هذا الجهاز سليمة ومتاحة، لكن مزامنتها مع الخدمة فشلت. أعد المحاولة أو اطبع من هنا."
        : "فشلت مزامنة المستند مع الخدمة. أعد المحاولة.",
      retryable: true,
    };

  /* 3 ─ Writing. `dirty` only counts as writing while a save is armed; an
   *     unarmed dirty document is reported as unsaved instead of silently
   *     showing a save that will never happen. */
  if (save === "saving" || (save === "dirty" && saveArmed))
    return {
      ...base,
      kind: "pending-save",
      label: "جارٍ الحفظ…",
      short: "حفظ…",
      tone: "pending",
      busy: true,
      detail: persisted
        ? "يُحفظ التعديل على هذا الجهاز أولًا، ثم يُزامن في الخلفية."
        : "يُحفظ التعديل الآن.",
    };

  if (save === "dirty")
    return {
      ...base,
      kind: "unsaved",
      label: "غير محفوظ",
      short: "غير محفوظ",
      tone: "warn",
      detail:
        "تغييرات غير محفوظة بانتظار الحفظ التلقائي. يمكنك الحفظ الآن من زر الحفظ أو ⌘S.",
    };

  /* 4 ─ Cloud mirror in flight (only emitted when there is real work). */
  if (sync === "syncing")
    return {
      ...base,
      kind: "syncing",
      label: "جارٍ المزامنة…",
      short: "مزامنة…",
      tone: "pending",
      busy: true,
      detail: persisted
        ? "المستند محفوظ على هذا الجهاز بالكامل، ويُزامن الآن مع الخدمة."
        : "تُزامن نسخة المستند مع الخدمة.",
    };

  /* 5 ─ Connection. Offline is never a loading state, and the label says out
   *     loud that the document is workable here. */
  if (!online)
    return {
      ...base,
      kind: "offline",
      label: persisted ? "دون اتصال · متاح محليًا" : "دون اتصال",
      short: persisted ? "متاح محليًا" : "دون اتصال",
      tone: "warn",
      detail: persisted
        ? "المستند محفوظ على هذا الجهاز ومتاح للعمل دون اتصال — ستتم المزامنة تلقائيًا عند عودة الاتصال."
        : "لا يوجد اتصال. سيُحفظ عملك على هذا الجهاز ويُزامن عند عودة الاتصال.",
    };

  /* 6 ─ Done. «محفوظ محليًا» means the local copy is durable and the cloud
   *     mirror still has work; «متزامن» is a real, sticky fact. */
  if (pendingSync)
    return {
      ...base,
      kind: "local",
      label: "محفوظ محليًا",
      short: "محفوظ محليًا",
      tone: "ok",
      detail:
        "المستند محفوظ على هذا الجهاز. تبقّى إرسال التغييرات إلى الخدمة وسيتم في الخلفية.",
    };

  if (lastSyncedAt)
    return {
      ...base,
      kind: "synced",
      label: "متزامن",
      short: "متزامن",
      tone: "ok",
      detail: "نسخة هذا الجهاز ونسخة الخدمة متطابقتان.",
    };

  return {
    ...base,
    kind: "ready",
    label: "جاهز",
    short: "جاهز",
    tone: "ok",
    detail: persisted
      ? "المستند محفوظ على هذا الجهاز ومتاح للعمل دون اتصال."
      : "المستند جاهز للتحرير.",
  };
}

/** The studio may paint the shell (and enable the canvas) only in this phase. */
export function isDocumentReady(phase: DocumentPhase): boolean {
  return phase === "ready";
}

/** Debug/telemetry friendly one-liner for a status. */
export function documentStatusKey(status: DocumentStatus): string {
  return `document:${status.kind}`;
}
