import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { getMyAccountPage } from "@/lib/commercial/functions";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

type ReturnState = "WAITING" | "ACTIVE" | "FAILED";

/**
 * صفحة العودة بعد الدفع في Gumroad.
 *
 * العودة نفسها ليست دليل سداد: التفعيل الحقيقي يتم خادميًا عبر
 * Gumroad Ping/API ← تحقق ← Keygen ← صلاحيات NASAQ. هذه الصفحة تعرض فقط
 * حالة الحساب الفعلية كما يقرؤها الخادم (مع محاولة ربط الاشتراك تلقائيًا
 * ببريد الجلسة عند كل تحديث)، ولا تعتمد على أي معامل في الرابط.
 */
export default function PaymentSuccessPage() {
  const [state, setState] = useState<ReturnState>("WAITING");
  const [planName, setPlanName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await getMyAccountPage();
      const account = result.account;
      if (account.status === "ACTIVE") {
        setPlanName(account.planArabicName || account.planName);
        setExpiresAt(account.expiresAt);
        setState("ACTIVE");
        return true;
      }
      setState("WAITING");
      return false;
    } catch {
      // لا توجد جلسة موثّقة (أو تعذّرت القراءة): لا نؤكد أي تفعيل.
      setAuthFailed(true);
      setState("FAILED");
      return true;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const done = await refresh();
      if (done || !active) return;
      const timer = window.setInterval(async () => {
        const finished = await refresh();
        if (finished || !active) window.clearInterval(timer);
      }, 4000);
      // التأكيد الخادمي قد يستغرق لحظات؛ نتوقف عن السؤال بعد دقيقتين.
      window.setTimeout(() => window.clearInterval(timer), 120_000);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/purchase" />
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm dark:border-white/10">
          {state === "ACTIVE" ? (
            <>
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
              <h1 className="mt-4 text-2xl font-extrabold text-ok">تم تفعيل اشتراكك</h1>
              <p className="mt-3 text-sm leading-7 text-muted">
                تحقّق النظام من عملية الدفع في Gumroad خادميًا، وأصدر ترخيص Keygen وربطه بحسابك.
                {planName ? <> الباقة المفعّلة: <span className="font-extrabold text-ink dark:text-white">{planName}</span>.</> : null}
                {expiresAt ? <> سارية حتى <span className="font-extrabold" dir="ltr">{new Date(expiresAt).toLocaleDateString("ar-SA")}</span>.</> : null}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <a href="/editor" className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-extrabold text-white">افتح المحرر</a>
                <a href="/account" className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-6 text-sm font-extrabold">حسابي</a>
              </div>
            </>
          ) : state === "FAILED" ? (
            <>
              <ShieldCheck className="mx-auto size-10 text-navy" aria-hidden />
              <h1 className="mt-4 text-2xl font-extrabold">سجّل الدخول لمتابعة التفعيل</h1>
              <p className="mt-3 text-sm leading-7 text-muted">
                {authFailed
                  ? "لم نتعرّف على حسابك بعد. سجّل الدخول بنفس البريد الذي استخدمته في Gumroad، وسيُربط الاشتراك بحسابك تلقائيًا بعد التحقق الخادمي."
                  : "لم نتمكن من قراءة حالة الحساب حاليًا."}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <a href="/login" className="inline-flex h-11 items-center justify-center rounded-xl bg-navy px-6 text-sm font-extrabold text-white">تسجيل الدخول</a>
                <a href="/purchase" className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-6 text-sm font-extrabold">العودة إلى الباقات</a>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto size-10 animate-spin text-emerald-600" aria-hidden />
              <h1 className="mt-4 text-2xl font-extrabold">جارٍ تأكيد الاشتراك…</h1>
              <p className="mt-3 text-sm leading-7 text-muted">
                وصلتنا عودتك من Gumroad. يجري التحقق من العملية وإصدار ترخيص Keygen على الخادم،
                وقد يستغرق ذلك لحظات. لا تعتمد هذه الصفحة على معاملات الرابط؛ ستظهر حالة التفعيل هنا فور اكتمالها.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => void refresh()} className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-6 text-sm font-extrabold">إعادة الفحص</button>
                <a href="/account" className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-6 text-sm font-extrabold">حسابي</a>
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export const Route = createFileRoute("/payment/success")({ ssr: false, component: PaymentSuccessPage });
