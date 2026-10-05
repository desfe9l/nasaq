import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clock3,
  Filter,
  Inbox,
  Loader2,
  Phone,
  Save,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  adminListClientRequestsFn,
  adminSaveRequestSettingsFn,
  adminUpdateClientRequestFn,
} from "@/lib/requests/functions";
import type { AdminRequestRow, RequestFilters } from "@/lib/requests/server";
import {
  DEFAULT_REQUEST_SETTINGS,
  REQUEST_KIND_LABELS,
  REQUEST_PRIORITIES,
  REQUEST_PRIORITY_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  type RequestKind,
  type RequestPriority,
  type RequestSettings,
  type RequestStatus,
} from "@/lib/requests/types";

/**
 * «الطلبات والمراسلات» — the administration's inbox.
 *
 * One destination for everything customers send through the platform: filter by
 * status or type, read the request with the customer's contact details and the
 * licence they held when they wrote, assign it, move it through the workflow,
 * and write the answer the customer will see in their own history.
 *
 * The customer's data is rendered here and nowhere public: this component is
 * only reachable behind `/admin`, and every call it makes re-derives the
 * caller's authority on the server.
 */

const STATUS_TONE: Record<RequestStatus, string> = {
  new: "border-gold/40 bg-gold/12 text-warning",
  in_progress: "border-brand/30 bg-brand/10 text-brand",
  answered: "border-ok/30 bg-ok/10 text-success",
  closed: "border-line bg-surface-2 text-muted",
};

const PRIORITY_TONE: Record<RequestPriority, string> = {
  low: "border-line bg-surface-2 text-muted",
  normal: "border-brand/25 bg-brand/8 text-brand",
  high: "border-danger/35 bg-danger/10 text-error",
};

const FIELD_CLASS =
  "h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";

function when(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : value;
}

/** The customer's entitlement at submission time, stated plainly. */
function EntitlementLine({ row }: { row: AdminRequestRow }) {
  if (!row.userId)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">
        <UserRound className="size-3" aria-hidden />
        زائر — بدون حساب
      </span>
    );
  const label = row.licensePlan
    ? `${row.licensePlan}${row.licenseStatus ? ` · ${row.licenseStatus}` : ""}`
    : (row.licenseStatus ?? "حساب مسجّل");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/8 px-2 py-0.5 text-[11px] font-bold text-brand">
      <BadgeCheck className="size-3" aria-hidden />
      حساب: {row.userEmail ?? row.userId} · {label}
    </span>
  );
}

/* ── one request, with its workspace ─────────────────────────────────────── */

function RequestCard({
  row,
  onUpdated,
}: {
  row: AdminRequestRow;
  onUpdated: (next: AdminRequestRow) => void;
}) {
  const [status, setStatus] = useState<RequestStatus>(row.status);
  const [priority, setPriority] = useState<RequestPriority>(row.priority);
  const [assignedTo, setAssignedTo] = useState(row.assignedTo ?? "");
  const [note, setNote] = useState(row.responseNote ?? "");
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (markResponded = false) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await adminUpdateClientRequestFn({
          data: { id: row.id, status, priority, assignedTo, responseNote: note, markResponded },
        });
        if (!result.ok || !result.request) {
          toast.error(result.error ?? "تعذّر تحديث الطلب");
          return;
        }
        onUpdated(result.request);
        toast.success(markResponded ? "تم حفظ الرد وإبلاغ السجل" : "تم تحديث الطلب");
      } catch {
        toast.error("تعذّر تحديث الطلب حاليًا");
      } finally {
        setBusy(false);
      }
    },
    [assignedTo, busy, note, onUpdated, priority, row.id, status],
  );

  return (
    <article className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[14px] font-extrabold text-ink">{row.name}</strong>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[row.status])}>
              {REQUEST_STATUS_LABELS[row.status]}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", PRIORITY_TONE[row.priority])}>
              {REQUEST_PRIORITY_LABELS[row.priority]}
            </span>
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">
              {REQUEST_KIND_LABELS[row.kind]}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3" aria-hidden />
              {when(row.createdAt)}
            </span>
            <a
              href={`tel:+${row.contact.replace(/\D/g, "")}`}
              className="inline-flex items-center gap-1.5 font-bold text-ink hover:text-brand-hover"
              dir="ltr"
            >
              <Phone className="size-3" aria-hidden />
              {row.contact}
            </a>
            {row.email && (
              <a href={`mailto:${row.email}`} className="font-bold hover:text-brand-hover" dir="ltr">
                {row.email}
              </a>
            )}
            {row.organization && <span>الجهة: {row.organization}</span>}
            <EntitlementLine row={row} />
          </p>
        </div>
        {row.templateId && (
          <a
            href={`/templates/${encodeURIComponent(row.templateId)}`}
            className="inline-flex h-9 items-center rounded-[9px] border border-line px-3 text-[11.5px] font-bold text-ink transition hover:border-brand"
          >
            القالب المرتبط
          </a>
        )}
      </header>

      <p className="mt-3 whitespace-pre-wrap rounded-xl border border-line-2 bg-surface-2 p-3 text-[13px] leading-7 text-ink">
        {row.details}
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">الحالة</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as RequestStatus)}
            className={FIELD_CLASS}
          >
            {REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {REQUEST_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">الأولوية</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as RequestPriority)}
            className={FIELD_CLASS}
          >
            {REQUEST_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {REQUEST_PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">المسؤول</span>
          <input
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className={FIELD_CLASS}
            placeholder="اسم من يتابع الطلب"
          />
        </label>
      </div>

      <label className="mt-3 grid gap-1.5">
        <span className="text-[11.5px] font-extrabold text-muted">
          الرد المكتوب — يظهر للعميل في حسابته داخل المنصة
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="w-full rounded-[9px] border border-line bg-surface p-3 text-[12.5px] font-semibold leading-6 text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          placeholder="اكتب الرد أو الملخص الداخلي…"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          حفظ التحديث
        </button>
        <button
          type="button"
          onClick={() => {
            setStatus("answered");
            void save(true);
          }}
          disabled={busy || !note.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden />
          تسجيل الرد
        </button>
        {row.respondedAt && (
          <span className="text-[11.5px] text-muted">
            أول رد: {when(row.respondedAt)}
          </span>
        )}
      </div>
    </article>
  );
}

/* ── settings ────────────────────────────────────────────────────────────── */

function RequestSettingsForm({
  initial,
  onSaved,
}: {
  initial: RequestSettings;
  onSaved: (next: RequestSettings) => void;
}) {
  const [draft, setDraft] = useState<RequestSettings>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initial), [initial]);

  const save = async () => {
    setBusy(true);
    try {
      const result = await adminSaveRequestSettingsFn({ data: draft });
      if (!result.ok || !result.settings) {
        toast.error(result.error ?? "تعذّر حفظ الإعدادات");
        return;
      }
      onSaved(result.settings);
      toast.success("تم حفظ إعدادات الطلبات");
    } catch {
      toast.error("تعذّر حفظ الإعدادات حاليًا");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-[15px] font-extrabold text-ink">إعدادات الطلبات والتواصل</h2>
      <p className="mt-1 text-[12px] leading-6 text-muted">
        أرقام التواصل المعروضة، وأنواع الخدمات التي يختار منها العميل، والحقول الاختيارية،
        والوعد الزمني للرد. كل ما يُحفظ هنا يظهر للزائر مباشرة في نموذج الطلب.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">
            أرقام التواصل المعروضة (سطر لكل رقم)
          </span>
          <textarea
            value={draft.contactNumbers.join("\n")}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                contactNumbers: event.target.value.split("\n").map((line) => line.trim()),
              }))
            }
            rows={3}
            dir="ltr"
            className="w-full rounded-[9px] border border-line bg-surface p-3 text-[12.5px] font-semibold tabular-nums text-ink"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">البريد الإلكتروني للطلبات</span>
          <input
            value={draft.contactEmail}
            onChange={(event) =>
              setDraft((current) => ({ ...current, contactEmail: event.target.value }))
            }
            dir="ltr"
            className={FIELD_CLASS}
            placeholder="requests@…"
          />
        </label>
        <label className="grid gap-1.5 lg:col-span-2">
          <span className="text-[11.5px] font-extrabold text-muted">الوعد الزمني للرد</span>
          <input
            value={draft.responseWindow}
            onChange={(event) =>
              setDraft((current) => ({ ...current, responseWindow: event.target.value }))
            }
            className={FIELD_CLASS}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">نص تأكيد الاستلام</span>
          <textarea
            value={draft.confirmationNote}
            onChange={(event) =>
              setDraft((current) => ({ ...current, confirmationNote: event.target.value }))
            }
            rows={2}
            className="w-full rounded-[9px] border border-line bg-surface p-3 text-[12.5px] font-semibold leading-6 text-ink"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] font-extrabold text-muted">نص الخصوصية</span>
          <textarea
            value={draft.privacyNote}
            onChange={(event) =>
              setDraft((current) => ({ ...current, privacyNote: event.target.value }))
            }
            rows={2}
            className="w-full rounded-[9px] border border-line bg-surface p-3 text-[12.5px] font-semibold leading-6 text-ink"
          />
        </label>
      </div>

      <div className="mt-4">
        <p className="text-[11.5px] font-extrabold text-muted">أنواع الخدمات</p>
        <ul className="mt-2 grid gap-2">
          {draft.services.map((service, index) => (
            <li
              key={service.id}
              className="grid gap-2 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-[1fr_1.4fr_auto]"
            >
              <input
                value={service.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    services: current.services.map((entry, i) =>
                      i === index ? { ...entry, label: event.target.value } : entry,
                    ),
                  }))
                }
                className={FIELD_CLASS}
                aria-label="اسم الخدمة"
              />
              <input
                value={service.hint}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    services: current.services.map((entry, i) =>
                      i === index ? { ...entry, hint: event.target.value } : entry,
                    ),
                  }))
                }
                className={FIELD_CLASS}
                aria-label="وصف الخدمة"
              />
              <label className="inline-flex items-center gap-2 text-[12px] font-bold text-ink">
                <input
                  type="checkbox"
                  checked={service.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      services: current.services.map((entry, i) =>
                        i === index ? { ...entry, enabled: event.target.checked } : entry,
                      ),
                    }))
                  }
                  className="size-4 accent-[var(--color-navy)]"
                />
                معروضة
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {(
          [
            ["organization", "طلب اسم الجهة"],
            ["email", "طلب البريد الإلكتروني"],
            ["deadline", "طلب الموعد المطلوب"],
            ["attachmentNote", "سؤال عن الملفات المتوفرة"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-2 text-[12px] font-bold text-ink">
            <input
              type="checkbox"
              checked={draft.fields[key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  fields: { ...current.fields, [key]: event.target.checked },
                }))
              }
              className="size-4 accent-[var(--color-navy)]"
            />
            {label}
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-[9px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        حفظ الإعدادات
      </button>
    </section>
  );
}

/* ── the inbox ───────────────────────────────────────────────────────────── */

export function AdminRequestsPanel() {
  const [rows, setRows] = useState<AdminRequestRow[]>([]);
  const [counts, setCounts] = useState<Record<RequestStatus | "open", number>>({
    new: 0,
    in_progress: 0,
    answered: 0,
    closed: 0,
    open: 0,
  });
  const [settings, setSettings] = useState<RequestSettings>(DEFAULT_REQUEST_SETTINGS);
  const [status, setStatus] = useState<RequestFilters["status"]>("open");
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminListClientRequestsFn({
        data: { status, kind, search },
      });
      setRows(result.requests);
      setCounts(result.counts);
      setSettings(result.settings);
    } catch (err) {
      setError(
        err instanceof Error && /Forbidden/i.test(err.message)
          ? "هذا القسم متاح لمسؤول المنصة فقط."
          : "تعذّر تحميل الطلبات. تحقّق من الاتصال ثم أعد المحاولة.",
      );
    } finally {
      setLoading(false);
    }
  }, [kind, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const kinds = useMemo(() => Object.entries(REQUEST_KIND_LABELS), []);
  const replaceRow = useCallback((next: AdminRequestRow) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === next.id);
      if (index === -1) return current;
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
    setCounts((current) => {
      const updated = { ...current };
      const open = updated.new + updated.in_progress;
      return { ...updated, open };
    });
  }, []);

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-extrabold text-ink">
          <Inbox className="size-4 text-brand" aria-hidden />
          {counts.open} طلب قيد المعالجة
        </span>
        <span className="text-[11.5px] text-muted">
          جديد: {counts.new} · قيد المعالجة: {counts.in_progress} · تم الرد: {counts.answered} ·
          مغلق: {counts.closed}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالاسم أو الرقم أو النص"
              className="h-10 w-[220px] rounded-[9px] border border-line bg-surface pr-9 pl-3 text-[12.5px] font-semibold text-ink"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-[12px] font-bold text-muted">
            <Filter className="size-3.5" aria-hidden />
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as RequestKind | "all")}
              className="h-10 rounded-[9px] border border-line bg-surface px-2 text-[12.5px] font-bold text-ink"
            >
              <option value="all">كل الأنواع</option>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="inline-flex h-10 items-center rounded-[9px] border border-line px-3 text-[12px] font-bold text-ink transition hover:border-brand"
          >
            {showSettings ? "إخفاء الإعدادات" : "إعدادات الطلبات"}
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية الحالة">
        {(
          [
            ["open", "قيد المعالجة"],
            ["new", "جديد"],
            ["in_progress", "قيد المتابعة"],
            ["answered", "تم الرد"],
            ["closed", "مغلق"],
            ["all", "الكل"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            aria-pressed={status === value}
            className={cn(
              "rounded-full border px-4 py-1.5 text-[12px] font-bold transition",
              status === value
                ? "border-brand bg-navy text-on-brand"
                : "border-line bg-surface text-muted hover:border-brand hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {showSettings && <RequestSettingsForm initial={settings} onSaved={setSettings} />}

      {loading ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          جارٍ تحميل الطلبات…
        </p>
      ) : error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-[12.5px] font-semibold text-error">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
          لا توجد طلبات مطابقة. كل طلب يُرسل من المنصة يظهر هنا مباشرة.
        </p>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <RequestCard key={row.id} row={row} onUpdated={replaceRow} />
          ))}
        </div>
      )}
    </div>
  );
}
