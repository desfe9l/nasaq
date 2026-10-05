import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  MessageSquarePlus,
  Phone,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  requestFormSettingsFn,
  myClientRequestsFn,
  submitClientRequestFn,
} from "@/lib/requests/functions";
import {
  DEFAULT_REQUEST_SETTINGS,
  REQUEST_STATUS_LABELS,
  type ClientRequestSummary,
  type RequestKind,
  type RequestSettings,
} from "@/lib/requests/types";
import { REQUEST_LIMITS } from "@/lib/requests/validation";

/**
 * «تواصل معنا / اطلب خدمة» — the platform's own request system.
 *
 * This replaces dependence on a displayed phone number with a real, native
 * flow: the customer writes the request here, the platform stores it, and the
 * administration answers it from its inbox. The phone numbers are still shown —
 * a customer who prefers to call must always be able to — but they are no
 * longer the only way in.
 *
 * Who may submit: everyone. A visitor sends one exactly (and as freely) as a
 * registered customer; the server attaches the account only when a verified
 * session exists, which is also what lets a signed-in customer see their own
 * history and lets the administration see the licence the customer held when
 * they wrote.
 *
 * The form's service types, contact numbers and response copy come from the
 * administration's settings (`requestFormSettingsFn`), never from this file.
 */

/* ── settings, fetched once per session ──────────────────────────────────── */

let cachedSettings: RequestSettings | null = null;
let settingsInFlight: Promise<RequestSettings> | null = null;

export function useRequestSettings(enabled = true): RequestSettings {
  const [settings, setSettings] = useState<RequestSettings>(
    cachedSettings ?? DEFAULT_REQUEST_SETTINGS,
  );
  useEffect(() => {
    if (!enabled) return;
    if (cachedSettings) return;
    let alive = true;
    settingsInFlight ??= requestFormSettingsFn().catch(() => DEFAULT_REQUEST_SETTINGS);
    void settingsInFlight.then((value) => {
      cachedSettings = value;
      if (alive) setSettings(value);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return settings;
}

/** The channels the administration publishes, as pressable actions. */
function ContactChannels({
  settings,
  className,
}: {
  settings: RequestSettings;
  className?: string;
}) {
  const numbers = settings.contactNumbers.filter(Boolean);
  if (!numbers.length && !settings.contactEmail) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {numbers.map((number) => (
        <a
          key={number}
          href={`tel:+${number.replace(/\D/g, "")}`}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand-hover"
        >
          <Phone className="size-3.5 text-brand" aria-hidden />
          <span className="tabular-nums" dir="ltr">
            {number}
          </span>
        </a>
      ))}
      {settings.contactEmail && (
        <a
          href={`mailto:${settings.contactEmail}`}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand-hover"
          dir="ltr"
        >
          {settings.contactEmail}
        </a>
      )}
    </div>
  );
}

/* ── the form ────────────────────────────────────────────────────────────── */

interface FormState {
  kind: RequestKind;
  name: string;
  contact: string;
  email: string;
  organization: string;
  details: string;
  deadline: string;
  files: string;
}

const EMPTY_FORM: FormState = {
  kind: "design",
  name: "",
  contact: "",
  email: "",
  organization: "",
  details: "",
  deadline: "",
  files: "",
};

const FIELD_CLASS =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink placeholder:text-muted/80 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";
const LABEL_CLASS = "block text-[12px] font-extrabold text-ink";

export function ClientRequestForm({
  source = "site",
  templateId = null,
  defaultKind = "design",
  serviceLabel,
  onSubmitted,
  className,
}: {
  source?: string;
  templateId?: string | null;
  defaultKind?: RequestKind;
  /** Pre-selects a service by label (e.g. the design page's own service). */
  serviceLabel?: string;
  onSubmitted?: (result: { confirmation: string; serviceLabel: string }) => void;
  className?: string;
}) {
  const settings = useRequestSettings();
  const { user } = useCurrentUserState();
  const services = useMemo(
    () => settings.services.filter((service) => service.enabled),
    [settings.services],
  );
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    kind: defaultKind,
    name: user?.displayName ?? "",
    email: user?.primaryEmail ?? "",
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ confirmation: string; serviceLabel: string } | null>(
    null,
  );

  // A pre-selected service (the design page names its own) wins over the kind.
  useEffect(() => {
    if (!serviceLabel) return;
    const match = services.find((service) => service.label === serviceLabel);
    if (match) setForm((current) => ({ ...current, kind: match.id as RequestKind }));
  }, [serviceLabel, services]);

  // A session that resolves after mount fills the identity fields, so a
  // customer never retypes what the platform already knows.
  useEffect(() => {
    if (!user) return;
    setForm((current) => ({
      ...current,
      name: current.name || user.displayName || "",
      email: current.email || user.primaryEmail || "",
    }));
  }, [user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setErrors([]);
      /*
       * The optional lines the administration enabled are folded into the
       * request body as labelled lines. That keeps the stored record complete
       * without inventing columns for context that is genuinely free text.
       */
      const extras: string[] = [];
      if (settings.fields.deadline && form.deadline.trim())
        extras.push(`الموعد المطلوب: ${form.deadline.trim()}`);
      if (settings.fields.attachmentNote && form.files.trim())
        extras.push(`ملفات يرغب العميل بمشاركتها: ${form.files.trim()}`);
      const details = [form.details.trim(), ...extras].filter(Boolean).join("\n");
      try {
        const result = await submitClientRequestFn({
          data: {
            kind: form.kind,
            name: form.name,
            contact: form.contact,
            email: form.email,
            organization: form.organization,
            details,
            source,
            templateId,
          },
        });
        if (!result.ok) {
          setErrors(result.errors);
          if (result.throttled) toast.error(result.errors[0]);
          return;
        }
        const payload = {
          confirmation: result.request?.confirmation ?? settings.confirmationNote,
          serviceLabel: result.request?.serviceLabel ?? "",
        };
        setDone(payload);
        setForm((current) => ({ ...EMPTY_FORM, kind: current.kind, name: current.name, email: current.email }));
        onSubmitted?.(payload);
        toast.success("تم إرسال طلبك");
      } catch (error) {
        console.error("[requests] submit failed", error);
        setErrors(["تعذّر إرسال الطلب حاليًا. حاول مرة أخرى بعد قليل."]);
      } finally {
        setBusy(false);
      }
    },
    [busy, form, onSubmitted, settings, source, templateId],
  );

  if (done) {
    return (
      <div className={cn("rounded-2xl border border-brand/25 bg-navy/[0.06] p-5 sm:p-6", className)}>
        <p className="flex items-center gap-2 text-[15px] font-extrabold text-success">
          <CheckCircle2 className="size-5" aria-hidden />
          تم استلام طلبك
        </p>
        <p className="mt-2 text-[13px] leading-7 text-ink">{done.confirmation}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <Clock3 className="size-3.5" aria-hidden />
          {settings.responseWindow}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDone(null)}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand"
          >
            <MessageSquarePlus className="size-4" aria-hidden />
            إرسال طلب آخر
          </button>
          <ContactChannels settings={settings} />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={cn("grid gap-5", className)}>
      {/* Service type — the first decision, presented as real options. */}
      <fieldset>
        <legend className={LABEL_CLASS}>نوع الطلب</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {services.map((service) => {
            const active = form.kind === service.id;
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => set("kind", service.id as RequestKind)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3 text-right transition",
                  active
                    ? "border-brand bg-navy/[0.07] ring-1 ring-brand/30"
                    : "border-line bg-surface hover:border-brand/50",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border",
                      active ? "border-brand bg-navy text-on-brand" : "border-line",
                    )}
                  >
                    {active && <CheckCircle2 className="size-3" />}
                  </span>
                  {service.label}
                </span>
                {service.hint && (
                  <span className="mt-1 block text-[11.5px] leading-5 text-muted">
                    {service.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>الاسم *</span>
          <input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            className={FIELD_CLASS}
            maxLength={REQUEST_LIMITS.name.max}
            autoComplete="name"
            placeholder="الاسم الكامل"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>رقم التواصل *</span>
          <input
            value={form.contact}
            onChange={(event) => set("contact", event.target.value)}
            className={FIELD_CLASS}
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="05xxxxxxxx"
          />
        </label>
        {settings.fields.email && (
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>البريد الإلكتروني</span>
            <input
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
              className={FIELD_CLASS}
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@entity.sa"
            />
          </label>
        )}
        {settings.fields.organization && (
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>الجهة</span>
            <input
              value={form.organization}
              onChange={(event) => set("organization", event.target.value)}
              className={FIELD_CLASS}
              maxLength={REQUEST_LIMITS.organization.max}
              placeholder="اسم الجهة أو القطاع"
            />
          </label>
        )}
        {settings.fields.deadline && (
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>الموعد المطلوب</span>
            <input
              value={form.deadline}
              onChange={(event) => set("deadline", event.target.value)}
              className={FIELD_CLASS}
              placeholder="مثال: قبل نهاية الشهر"
            />
          </label>
        )}
        {settings.fields.attachmentNote && (
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>ملفات لديك</span>
            <input
              value={form.files}
              onChange={(event) => set("files", event.target.value)}
              className={FIELD_CLASS}
              placeholder="مثال: شعار الجهة، نص التقرير"
            />
          </label>
        )}
      </div>

      <label className="grid gap-1.5">
        <span className={LABEL_CLASS}>تفاصيل الطلب *</span>
        <textarea
          value={form.details}
          onChange={(event) => set("details", event.target.value)}
          rows={5}
          maxLength={REQUEST_LIMITS.details.max}
          className="w-full rounded-[10px] border border-line bg-surface p-3 text-[13px] font-semibold leading-7 text-ink placeholder:text-muted/80 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          placeholder="اكتب ما تحتاجه: نوع المستند، عدد الصفحات، الهوية المطلوبة، وأي تفاصيل تساعدنا على الرد بدقة."
        />
      </label>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="grid gap-1 rounded-xl border border-danger/30 bg-danger/5 p-3 text-[12.5px] font-semibold text-error"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex max-w-md items-start gap-1.5 text-[11.5px] leading-5 text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          {settings.privacyNote}
        </p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {busy ? "جارٍ الإرسال…" : "إرسال الطلب"}
        </button>
      </div>
    </form>
  );
}

/* ── the customer's own history ──────────────────────────────────────────── */

function MyRequests() {
  const { user, isPending } = useCurrentUserState();
  const [rows, setRows] = useState<ClientRequestSummary[] | null>(null);
  useEffect(() => {
    if (isPending || !user) return;
    let alive = true;
    void myClientRequestsFn()
      .then((result) => {
        if (alive) setRows(result.requests);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [isPending, user]);
  if (!user || !rows?.length) return null;
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
        <ClipboardList className="size-4 text-brand" aria-hidden />
        طلباتي السابقة
      </h3>
      <ul className="mt-3 grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-[12.5px] font-extrabold text-ink">
                {row.serviceLabel}
              </strong>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-bold",
                  row.status === "answered" || row.status === "closed"
                    ? "border-brand/25 bg-brand/10 text-brand"
                    : "border-gold/30 bg-gold/10 text-warning",
                )}
              >
                {REQUEST_STATUS_LABELS[row.status]}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
              <Clock3 className="size-3" aria-hidden />
              {new Date(row.createdAt).toLocaleDateString("ar-SA")}
            </p>
            {row.responseNote && (
              <p className="mt-2 rounded-lg border border-line-2 bg-surface-2 p-2 text-[12px] leading-6 text-ink">
                {row.responseNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────── */

export function ClientRequestPanel({
  open,
  onClose,
  source = "site",
  templateId = null,
  defaultKind = "design",
  serviceLabel,
  title = "تواصل معنا أو اطلب خدمة",
  intro,
}: {
  open: boolean;
  onClose: () => void;
  source?: string;
  templateId?: string | null;
  defaultKind?: RequestKind;
  serviceLabel?: string;
  title?: string;
  intro?: string;
}) {
  const settings = useRequestSettings(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-dialog)] flex items-start justify-center overflow-y-auto bg-scrim/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative my-4 w-full max-w-3xl rounded-2xl border border-line bg-page p-5 shadow-xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="absolute left-4 top-4 grid size-9 place-items-center rounded-[9px] border border-line bg-surface text-muted transition hover:border-brand hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
        <header className="max-w-2xl pr-10">
          <p className="text-[11px] font-extrabold tracking-[0.14em] text-brand">
            خدمة نَسَق
          </p>
          <h2 className="mt-2 text-[22px] font-extrabold text-ink sm:text-[24px]">{title}</h2>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            {intro ??
              "اكتب طلبك داخل المنصة وسيصل مباشرة إلى إدارة نَسَق — لا حاجة لمغادرة الموقع."}
          </p>
        </header>
        <div className="mt-5">
          <ClientRequestForm
            source={source}
            templateId={templateId}
            defaultKind={defaultKind}
            serviceLabel={serviceLabel}
          />
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-[11.5px] font-extrabold text-muted">قنوات مباشرة</p>
          <ContactChannels settings={settings} className="mt-2" />
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
            <Clock3 className="size-3.5" aria-hidden />
            {settings.responseWindow}
          </p>
        </div>
        <MyRequests />
      </div>
    </div>
  );
}

/**
 * The chrome's entry point.
 *
 * One button, one label that says what it does («اطلب خدمة»), and the panel
 * behind it. It is deliberately available to a signed-out visitor: the request
 * system is the platform's own channel, not a licensed feature.
 */
export function ContactRequestButton({
  className,
  label = "تواصل معنا",
  source = "site",
  templateId = null,
  defaultKind = "design",
  serviceLabel,
  variant = "outline",
  compact = false,
}: {
  className?: string;
  label?: string;
  source?: string;
  templateId?: string | null;
  defaultKind?: RequestKind;
  serviceLabel?: string;
  variant?: "outline" | "solid" | "quiet";
  /** Icon-first on phones, full label from `sm` up. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const styles =
    variant === "solid"
      ? "h-11 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"
      : variant === "quiet"
        ? "h-11 rounded-[10px] px-3 text-[13px] font-bold text-muted transition hover:text-ink"
        : "h-11 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-bold text-ink transition hover:border-brand hover:text-brand-hover";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn("inline-flex items-center gap-2 whitespace-nowrap", styles, className)}
      >
        <MessageSquarePlus className="size-4 shrink-0" aria-hidden />
        <span className={cn(compact && "hidden sm:inline")}>{label}</span>
      </button>
      <ClientRequestPanel
        open={open}
        onClose={() => setOpen(false)}
        source={source}
        templateId={templateId}
        defaultKind={defaultKind}
        serviceLabel={serviceLabel}
      />
    </>
  );
}
