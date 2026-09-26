import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  generateAuthSecretFn,
  getOwnerSetupFn,
  testBetterAuthFn,
  testDatabaseFn,
  testGoogleOAuthFn,
  verifyTeamLicensingFn,
  verifyGoogleClientIdFn,
  verifyOwnerEmailFn,
  type OwnerSetupOverview,
} from "@/lib/owner/setup-functions";
import type { TeamSetupReport } from "@/lib/license/team-setup.server";
import { cn } from "@/lib/utils";

/**
 * «تهيئة» panel for the five auth/owner settings.
 *
 * Two deliberate properties:
 *   · A row turns green only after a real probe answered — env presence alone
 *     shows amber with "اضغط اختبار الاتصال".
 *   · No saved secret is ever rendered. The only secret that can appear is a
 *     freshly generated Better Auth secret, shown once so it can be pasted
 *     into the deployment provider, and cleared on demand.
 */

type RowId = OwnerSetupOverview["checks"][number]["id"];

const STATE_STYLES = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  missing: "border-red-400/30 bg-red-400/10 text-red-100",
} as const;

const STATE_LABELS = {
  ready: "🟢 جاهز",
  warning: "🟡 يحتاج تهيئة",
  missing: "🔴 بيانات ناقصة",
} as const;

export function OwnerSetupPanel() {
  const [overview, setOverview] = useState<OwnerSetupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<RowId | null>(null);
  const [results, setResults] = useState<Partial<Record<RowId, { ok: boolean; detail: string }>>>({});
  const [ownerEmail, setOwnerEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamSetupReport | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await getOwnerSetupFn());
    } catch {
      toast.error("تعذر قراءة حالة الإعدادات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: RowId, action: () => Promise<{ ok: boolean; detail: string }>) => {
    setBusy(id);
    try {
      const result = await action();
      setResults((current) => ({ ...current, [id]: result }));
      if (result.ok) toast.success(result.detail);
      else toast.error(result.detail);
    } catch {
      setResults((current) => ({
        ...current,
        [id]: { ok: false, detail: "تعذر تنفيذ الاختبار من الخادم." },
      }));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("تم النسخ إلى الحافظة");
    } catch {
      toast.error("تعذر النسخ من المتصفح");
    }
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-6">
        <Loader2 className="mx-auto size-6 animate-spin text-emerald-300" />
      </section>
    );
  }
  if (!overview) return null;

  const check = (id: RowId) => overview.checks.find((item) => item.id === id);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-300" />
          <div>
            <h2 className="text-base font-black">تهيئة المصادقة وهوية المالك</h2>
            <p className="text-[11px] leading-5 text-slate-400">
              الحالة الخضراء تعني اختبارًا حقيقيًا نجح — لا مجرد وجود متغيّر بيئة.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50"
        >
          <RefreshCw className="size-3.5" /> تحديث الحالة
        </button>
      </header>

      <div className="grid gap-3">
        {/* Owner identity */}
        <SetupRow id="owner" title="هوية المالك" variable="NASAQ_OWNER_EMAIL" check={check("owner")} result={results.owner} busy={busy === "owner"}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              dir="ltr"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder={overview.sessionEmail ?? "owner@example.com"}
              className="h-9 min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/25 px-3 text-xs outline-none placeholder:text-slate-600 focus:border-emerald-400/60"
            />
            <ActionButton
              busy={busy === "owner"}
              onClick={() =>
                void run("owner", () =>
                  verifyOwnerEmailFn({ data: { email: ownerEmail || overview.sessionEmail || "" } }),
                )
              }
            >
              تهيئة
            </ActionButton>
          </div>
        </SetupRow>

        {/* Better Auth */}
        <SetupRow id="better-auth" title="Better Auth" variable="BETTER_AUTH_SECRET" check={check("better-auth")} result={results["better-auth"]} busy={busy === "better-auth"}>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              busy={busy === "better-auth"}
              onClick={() => void run("better-auth", () => testBetterAuthFn())}
            >
              اختبار الاتصال
            </ActionButton>
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await generateAuthSecretFn();
                  setGeneratedSecret(result.secret);
                  toast.message(result.detail);
                } catch {
                  toast.error("تعذر توليد السر");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50"
            >
              توليد Secret
            </button>
          </div>
          {generatedSecret && (
            <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
              <p className="text-[11px] font-black text-amber-100">
                يُعرض مرة واحدة فقط — لم يُحفظ في أي مكان. الصقه في متغيّر BETTER_AUTH_SECRET لدى مزوّد النشر.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code dir="ltr" className="flex-1 break-all rounded bg-black/40 p-2 text-[11px] text-amber-50">
                  {generatedSecret}
                </code>
                <button type="button" onClick={() => void copy(generatedSecret)} className="grid size-8 shrink-0 place-items-center rounded-md border border-white/15 hover:border-emerald-400/50" aria-label="نسخ السر">
                  <Copy className="size-3.5" />
                </button>
                <button type="button" onClick={() => setGeneratedSecret(null)} className="h-8 shrink-0 rounded-md border border-white/15 px-2 text-[11px] font-bold hover:border-emerald-400/50">
                  إخفاء
                </button>
              </div>
            </div>
          )}
        </SetupRow>

        {/* Database */}
        <SetupRow id="database" title="قاعدة البيانات" variable="DATABASE_URL" check={check("database")} result={results.database} busy={busy === "database"}>
          <ActionButton
            busy={busy === "database"}
            onClick={() => void run("database", async () => testDatabaseFn())}
          >
            اختبار الاتصال
          </ActionButton>
        </SetupRow>

        {/* Google client id */}
        <SetupRow id="google-client-id" title="Google client ID" variable="GOOGLE_CLIENT_ID" check={check("google-client-id")} result={results["google-client-id"]} busy={busy === "google-client-id"}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              dir="ltr"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="123456-abc.apps.googleusercontent.com"
              className="h-9 min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/25 px-3 text-xs outline-none placeholder:text-slate-600 focus:border-emerald-400/60"
            />
            <ActionButton
              busy={busy === "google-client-id"}
              onClick={() => void run("google-client-id", () => verifyGoogleClientIdFn({ data: { clientId } }))}
            >
              تهيئة
            </ActionButton>
          </div>
        </SetupRow>

        {/* Google client secret */}
        <SetupRow id="google-client-secret" title="Google OAuth" variable="GOOGLE_CLIENT_SECRET" check={check("google-client-secret")} result={results["google-client-secret"]} busy={busy === "google-client-secret"}>
          <ActionButton
            busy={busy === "google-client-secret"}
            onClick={() => void run("google-client-secret", () => testGoogleOAuthFn())}
          >
            اختبار الاتصال
          </ActionButton>
        </SetupRow>
      </div>

      <TeamLicensingCard
        report={team}
        busy={teamBusy}
        onRun={async (repair) => {
          setTeamBusy(true);
          try {
            const result = await verifyTeamLicensingFn({ data: { repair } });
            setTeam(result);
            const ready = result.plans.filter((plan) => plan.state === "ready").length;
            if (!result.configured) toast.error("KEYGEN_API_TOKEN غير مضبوط في بيئة الخادم");
            else if (!result.connected) toast.error("تعذر الاتصال بـ Keygen");
            else toast.success(`اكتمل الفحص — ${ready} خطة Team جاهزة`);
          } catch {
            toast.error("تعذر تنفيذ فحص Team");
          } finally {
            setTeamBusy(false);
          }
        }}
      />

      <p className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-6 text-slate-400">
        الأسرار المحفوظة لا تُعرض هنا إطلاقًا، ولا تُرسل إلى المتصفح، ولا تُكتب في السجلات. بيئة النشر
        للقراءة فقط أثناء التشغيل: «تهيئة» تتحقق من القيمة وتخبرك بالمتغيّر الذي تضبطه لدى المزوّد،
        ثم أعد النشر.
      </p>
    </section>
  );
}

function TeamLicensingCard({
  report,
  busy,
  onRun,
}: {
  report: TeamSetupReport | null;
  busy: boolean;
  onRun: (repair: boolean) => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black">ترخيص الفريق (Keygen)</h3>
          <p className="text-[11px] text-slate-400">
            فحص حقيقي للحساب والمنتج وسياسات Team وربط الـentitlements. الإصلاح ينشئ ويربط
            entitlements فقط — لا ينشئ تراخيص ولا مشتريات.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton busy={busy} onClick={() => onRun(false)}>
            تحقق من Team
          </ActionButton>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRun(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50 disabled:opacity-60"
          >
            تحقق وإصلاح Team
          </button>
        </div>
      </div>

      {report && (
        <div className="mt-3 grid gap-2">
          {report.steps.map((step) => (
            <StatusLine key={step.step} state={step.state} title={step.step} detail={step.detail} />
          ))}
          {report.plans.map((plan) => (
            <StatusLine
              key={plan.plan}
              state={plan.state}
              title={plan.label}
              detail={`${plan.detail}${plan.repaired.length ? ` · ${plan.repaired.join(" · ")}` : ""}`}
            />
          ))}
          <StatusLine
            state={report.lifetime.state}
            title={report.lifetime.step}
            detail={report.lifetime.detail}
          />
          {report.missingEnvVars.length > 0 && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] font-black text-amber-100">
              متغيرات ناقصة في بيئة النشر: {report.missingEnvVars.join("، ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StatusLine({
  state,
  title,
  detail,
}: {
  state: "ready" | "missing" | "failed";
  title: string;
  detail: string;
}) {
  const tone =
    state === "ready" ? "text-emerald-200" : state === "failed" ? "text-red-200" : "text-amber-100";
  return (
    <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className={cn("text-[11px] font-black", tone)}>
        {state === "ready" ? "🟢" : state === "failed" ? "🔴" : "🟡"}
      </span>
      <span className="text-[11px] font-black">{title}</span>
      <span className="text-[11px] text-slate-400">{detail}</span>
    </div>
  );
}

function ActionButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-black text-[#07110f] hover:bg-emerald-400 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

function SetupRow({
  title,
  variable,
  check,
  result,
  children,
}: {
  id: RowId;
  title: string;
  variable: string;
  check: OwnerSetupOverview["checks"][number] | undefined;
  result?: { ok: boolean; detail: string };
  busy: boolean;
  children: React.ReactNode;
}) {
  // A probe result always wins over the static read: it is the newer, stronger
  // evidence. Without one, an unprobed row can never claim "ready".
  const state = result ? (result.ok ? "ready" : "missing") : (check?.state ?? "missing");
  const detail = result?.detail ?? check?.summary ?? "";

  return (
    <article className={cn("rounded-xl border p-4", STATE_STYLES[state])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {state === "ready" ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
            <h3 className="text-sm font-black">{title}</h3>
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-black">
              {STATE_LABELS[state]}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] opacity-70" dir="ltr">{variable}</p>
          <p className="mt-1 text-[11px] leading-6 opacity-90">{detail}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </article>
  );
}
