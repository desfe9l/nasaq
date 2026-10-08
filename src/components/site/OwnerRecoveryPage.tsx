/**
 * The owner's production recovery console.
 *
 * ## Why a page and not a script
 *
 * The migration has to run where the production configuration lives — the
 * deployment's own `process.env`. A runner outside the deployment does not
 * hold the database URL, the object-storage credentials or the licence
 * provider token, and copying them anywhere to obtain them would be the worst
 * possible fix. The deployment can already do all of it; what was missing was
 * a way for the owner to ASK it to, from the session that proves who they are.
 *
 * This page is that way. It drives `/api/ops/owner-recovery` — the same
 * guarded endpoint, the same stages, in the required order — using the
 * owner's existing authenticated session. Nothing here decides anything: every
 * refusal, every verdict and every number comes from the server, and the page
 * only renders what it was handed.
 *
 * The response is sanitized at the source (fingerprints, counts, booleans), so
 * the report shown here — and the copy button next to it — can be pasted into
 * a ticket without redacting anything.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  PlayCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { SiteHeader } from "@/components/site/SiteChrome";

type StageId =
  | "recover"
  | "plan"
  | "migrate"
  | "storage-rekey"
  | "identity"
  | "provider"
  | "storage"
  | "admin-probe"
  | "report";

type StageSpec = {
  id: StageId;
  title: string;
  description: string;
  confirm?: string;
  /** A red stage here stops the chain: later stages would be meaningless. */
  blocking: boolean;
  /** Re-run while the result reports work left (bounded, resumable stages). */
  repeatWhile?: (result: unknown) => boolean;
};

/** The required order, exactly as the recovery plan specifies it. */
const STAGES: StageSpec[] = [
  {
    id: "recover",
    title: "ربط هوية المالك",
    description: "نقل سلطة المالك إلى الحساب الذي تسجّل الدخول به الآن.",
    blocking: true,
  },
  {
    id: "plan",
    title: "خطة الترحيل",
    description: "ما الذي سينتقل — دون أي كتابة.",
    blocking: true,
  },
  {
    id: "migrate",
    title: "تنفيذ الترحيل",
    description: "نقل السجلات والسلطة والتخزين إلى الحساب القانوني.",
    confirm: "MIGRATE-OWNER",
    blocking: true,
  },
  {
    id: "storage-rekey",
    title: "نقل ملفات التخزين",
    description: "نسخ كائنات التخزين إلى مسار الحساب القانوني والتحقق منها.",
    confirm: "REKEY-STORAGE",
    blocking: false,
    repeatWhile: (result) => {
      const rekey = (result as { rekey?: { complete?: boolean; moved?: number } } | null)?.rekey;
      return Boolean(rekey && rekey.complete === false && (rekey.moved ?? 0) > 0);
    },
  },
  {
    id: "identity",
    title: "التحقق من الهوية والتراخيص",
    description: "سلسلة: الجلسة = المالك = قاعدة البيانات = الترخيص = المحرر.",
    blocking: false,
  },
  {
    id: "provider",
    title: "التحقق من Keygen",
    description: "الترخيص نفسه، بالمفتاح نفسه، في نطاق المالك.",
    blocking: false,
  },
  {
    id: "storage",
    title: "اختبار التخزين",
    description: "رفع ← قراءة ← حذف، على الكائن والبيانات الوصفية.",
    blocking: false,
  },
  {
    id: "admin-probe",
    title: "اختبار صلاحيات الإدارة",
    description: "كتابة فعلية على سجلات اصطناعية تُحذف في نفس التشغيل.",
    confirm: "ADMIN-PROBE",
    blocking: false,
  },
  {
    id: "report",
    title: "التقرير النهائي",
    description: "إثبات: المالك القانوني يملك كل شيء، والهوية القديمة لا تملك شيئًا.",
    blocking: false,
  },
];

type StageState = {
  status: "idle" | "running" | "ok" | "failed";
  httpStatus?: number;
  payload?: unknown;
  runs?: number;
};

const MAX_REPEATS = 40;

async function callStage(stage: StageSpec): Promise<{ status: number; body: unknown }> {
  const response = await fetch("/api/ops/owner-recovery", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage: stage.id, confirm: stage.confirm }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, error: "استجابة غير مقروءة من الخادم." };
  }
  return { status: response.status, body };
}

function verdict(body: unknown): boolean {
  return (body as { ok?: boolean } | null)?.ok === true;
}

function message(body: unknown): string | null {
  const record = body as { error?: unknown; reason?: unknown } | null;
  const error = typeof record?.error === "string" ? record.error : null;
  const reason = typeof record?.reason === "string" ? record.reason : null;
  if (error && reason) return `${error} (${reason})`;
  return error ?? reason;
}

export function OwnerRecoveryPage() {
  const [states, setStates] = useState<Record<string, StageState>>({});
  const [running, setRunning] = useState(false);
  const [ledger, setLedger] = useState<unknown>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const readLedger = useCallback(async () => {
    try {
      const response = await fetch("/api/ops/owner-recovery", {
        method: "GET",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setLedger(body);
        setLedgerError(null);
      } else {
        setLedger(null);
        setLedgerError(message(body) ?? `تعذّر قراءة السجل (${response.status}).`);
      }
    } catch {
      setLedgerError("تعذّر الوصول إلى الخادم.");
    }
  }, []);

  useEffect(() => {
    void readLedger();
  }, [readLedger]);

  const runOne = useCallback(async (stage: StageSpec): Promise<boolean> => {
    setStates((prev) => ({ ...prev, [stage.id]: { status: "running" } }));
    let runs = 0;
    let last: { status: number; body: unknown } = { status: 0, body: null };
    do {
      runs += 1;
      last = await callStage(stage);
      setStates((prev) => ({
        ...prev,
        [stage.id]: { status: "running", httpStatus: last.status, payload: last.body, runs },
      }));
      if (!stage.repeatWhile || runs >= MAX_REPEATS) break;
    } while (
      last.status === 200 &&
      stage.repeatWhile((last.body as { result?: unknown } | null)?.result ?? null)
    );

    const ok = last.status === 200 && verdict(last.body);
    setStates((prev) => ({
      ...prev,
      [stage.id]: {
        status: ok ? "ok" : "failed",
        httpStatus: last.status,
        payload: last.body,
        runs,
      },
    }));
    return ok;
  }, []);

  /**
   * Invalidate ONLY the caches the migration makes stale.
   *
   * The entitlement the page is holding was computed for the previous owner
   * id; the licence hook refreshes on a five-minute interval, so without a
   * nudge the owner sees "no licence" after a successful migration and
   * concludes it failed. Nothing else is cleared: the cached licence key, the
   * editor library and the offline snapshots belong to this same account and
   * are still correct.
   */
  const invalidateOwnerCaches = useCallback(async () => {
    try {
      const { refreshLicenseState } = await import("@/lib/license/client");
      refreshLicenseState();
    } catch {
      /* the licence module is not loaded on this page — nothing to refresh */
    }
  }, []);

  const runAll = useCallback(async () => {
    setRunning(true);
    setStates({});
    try {
      for (const stage of STAGES) {
        const ok = await runOne(stage);
        if (!ok && stage.blocking) {
          /*
           * `already_completed` is a success for the chain: the one-shot
           * migration has already run, so the verification stages that follow
           * are exactly what should happen next.
           */
          const reason = (
            (states[stage.id]?.payload ?? null) as { reason?: string } | null
          )?.reason;
          if (reason !== "already_completed") break;
        }
      }
    } finally {
      setRunning(false);
      await invalidateOwnerCaches();
      void readLedger();
    }
  }, [runOne, readLedger, states, invalidateOwnerCaches]);

  const transcript = useMemo(
    () =>
      JSON.stringify(
        {
          at: new Date().toISOString(),
          ledger,
          stages: STAGES.map((stage) => ({
            stage: stage.id,
            status: states[stage.id]?.status ?? "idle",
            httpStatus: states[stage.id]?.httpStatus ?? null,
            runs: states[stage.id]?.runs ?? 0,
            response: states[stage.id]?.payload ?? null,
          })),
        },
        null,
        2,
      ),
    [ledger, states],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/owner-recovery" />
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 md:py-14">
        <header>
          <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
            NASAQ · OWNER RECOVERY
          </p>
          <h1 className="mt-1.5 text-[27px] font-extrabold text-ink">استعادة ملكية الحساب</h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-muted">
            يُنفَّذ الترحيل داخل نشر الإنتاج نفسه، بجلستك أنت. كل مرحلة تُدقَّق وتُسجَّل،
            والمراحل التي تكتب تعمل مرة واحدة فقط. لا يُعرض هنا أي معرّف أو بريد أو مفتاح —
            بصمات وأعداد فقط.
          </p>
        </header>

        {ledgerError && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-[12.5px] font-bold text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {ledgerError} — ابدأ بمرحلة «ربط هوية المالك»: فهي المرحلة الوحيدة التي لا تتطلّب
              صلاحية قائمة مسبقًا.
            </span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={running}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <PlayCircle className="size-4" aria-hidden />
            )}
            تشغيل الاستعادة الكاملة
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-bold text-ink transition hover:border-brand"
          >
            <ClipboardCopy className="size-4" aria-hidden />
            {copied ? "تم النسخ" : "نسخ التقرير"}
          </button>
          <Link
            to="/admin"
            className="inline-flex h-11 items-center rounded-[10px] border border-line bg-surface px-4 text-[13px] font-bold text-ink transition hover:border-brand"
          >
            لوحة الإدارة
          </Link>
        </div>

        <ol className="mt-8 space-y-3">
          {STAGES.map((stage, index) => {
            const state = states[stage.id];
            const status = state?.status ?? "idle";
            return (
              <li
                key={stage.id}
                className="rounded-xl border border-line bg-surface px-4 py-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-extrabold text-ink">
                      <span className="text-muted">{index + 1}.</span> {stage.title}
                      {(state?.runs ?? 0) > 1 && (
                        <span className="ms-2 text-[11px] font-bold text-muted">
                          ×{state?.runs}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-6 text-muted">{stage.description}</p>
                    {state?.payload != null && (
                      <>
                        {message(state.payload) && (
                          <p className="mt-1.5 text-[12px] font-bold text-warning">
                            {message(state.payload)}
                          </p>
                        )}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11.5px] font-bold text-muted">
                            التفاصيل
                          </summary>
                          <pre
                            dir="ltr"
                            className="mt-2 max-h-72 overflow-auto rounded-lg bg-paper p-3 text-left text-[11px] leading-5 text-ink"
                          >
                            {JSON.stringify(state.payload, null, 2)}
                          </pre>
                        </details>
                      </>
                    )}
                  </div>
                  <span className="mt-0.5 shrink-0" aria-label={status}>
                    {status === "running" && (
                      <Loader2 className="size-5 animate-spin text-muted" aria-hidden />
                    )}
                    {status === "ok" && <CheckCircle2 className="size-5 text-ok" aria-hidden />}
                    {status === "failed" && <XCircle className="size-5 text-danger" aria-hidden />}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}
