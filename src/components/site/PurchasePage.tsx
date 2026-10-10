import { useEffect, useMemo, useState } from "react";
import { WifiOff } from "lucide-react";
import { CheckCircle2, ChevronDown, CreditCard, Key, ShieldCheck, Lock } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getGumroadCheckoutLinksFn } from "@/lib/gumroad/functions";
import {
  isGumroadPlanKey,
  withGumroadPrefilledEmail,
} from "@/lib/gumroad/mapping";
import { getMyAccountPage } from "@/lib/commercial/functions";
import { getLicenseStatusFn } from "@/lib/license/functions";
import type { LicenseInfo } from "@/lib/license/types";
import { purchaseStateView, type PurchaseStateTone } from "@/lib/commercial/plan-state";
import type { CustomerAccount } from "@/lib/commercial/types";
import { CENTRAL_PLANS, FREE_PLAN, planSavings, planKeyFor, type PlanFamily, type PlanKey } from "@/lib/commercial/catalog";
import {
  billingPeriodsWithCheckout,
  PERIOD_LABELS,
  purchasePeriodFromQuery,
  type SwitchablePeriod,
} from "@/lib/commercial/plan-cards";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CREATE_ROUTE } from "@/lib/site-routes";
import { cardClass } from "@/components/site/cards";

const FAQS: { q: string; a: string }[] = [
  { q: "كيف تُفعَّل التراخيص؟", a: "بعد إتمام الدفع، يتحقق النظام من العملية خادميًا ثم يُنشئ ترخيصًا رقميًا ويربطه بحسابك تلقائيًا بنفس بريد الشراء. تدير الترخيص من صفحة التراخيص." },
  { q: "هل أحتاج إدخال مفتاح ترخيص أثناء الدفع؟", a: "لا. لا يُطلب منك أي مفتاح أثناء الشراء ولا بعده: الترخيص يُنشأ ويُربط بحسابك تلقائيًا. استخدم البريد المرتبط بحسابك وأكمل بيانات الدفع المطلوبة." },
  { q: "ما حالات الاشتراك في نَسَق؟", a: "النوع: Free (مجاني)، Trial (تجريبي)، Pro (احترافي شهري أو ربع سنوي)، Lifetime (مدى الحياة). والحالة: Active (نشط)، Expired (منتهي)، Revoked (ملغى أو موقوف). تظهر حالتك الحالية في أعلى هذه الصفحة." },
  { q: "ماذا لو لم أكن مسجلًا قبل الشراء؟", a: "لا مشكلة: أكمل الدفع باستخدام البريد الذي ستسجّل به في نَسَق، وعند أول تسجيل دخول يُربط الاشتراك بحسابك تلقائيًا." },
  { q: "ما مدد الاشتراك المتاحة؟", a: "تتوفر الخطط الشهرية والربع سنوية بحسب روابط الشراء المتاحة." },
  { q: "أين تُعالج ملفاتي؟", a: "المحرر يعمل بتخزين محلي أولًا: المشاريع والصور والهويات تُحفظ داخل المتصفح عبر IndexedDB. الاتصال مطلوب فقط للتحقق من الترخيص." },
  { q: "هل يمكنني العمل بدون اتصال؟", a: "نعم، بعد التفعيل تعمل أدوات التحرير والحفظ والتصدير محليًا حتى عند انقطاع الشبكة." },
  { q: "هل الخطة المجانية محدودة المدة؟", a: "لا، الخطة المجانية دائمة دون تاريخ انتهاء، مع قيود على المزايا المتقدمة." },
];

const TONE_STYLES: Record<PurchaseStateTone, string> = {
  ok: "bg-ok/15 text-success",
  muted: "bg-line-2 text-muted",
  warn: "bg-gold/20 text-ink",
  danger: "bg-danger/10 text-error",
};

const PURCHASE_FAMILIES: readonly PlanFamily[] = ["individual", "team"];

export function PurchasePage() {
  /**
   * The period a deep link may preselect (`/purchase?period=quarterly`): the
   * homepage switcher sends a buyer here when a tier's checkout link is
   * unavailable, and it should land on the period they were already looking at.
   * Anything else — including no parameter at all — stays on the default.
   */
  const [billing, setBilling] = useState<SwitchablePeriod>(() => {
    if (typeof window === "undefined") return "monthly";
    return purchasePeriodFromQuery(
      new URLSearchParams(window.location.search).get("period"),
    );
  });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [checkoutLinks, setCheckoutLinks] = useState<Partial<Record<PlanKey, string>>>({});
  const [checkoutResolved, setCheckoutResolved] = useState(false);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  useEffect(() => {
    let active = true;
    void getGumroadCheckoutLinksFn()
      .then((links) => {
        if (!active) return;
        const supported: Partial<Record<PlanKey, string>> = {};
        for (const link of links) {
          if (!isGumroadPlanKey(link.planKey)) continue;
          const url = typeof link.url === "string" ? link.url.trim() : "";
          if (url) supported[link.planKey] = url;
        }
        setCheckoutLinks(supported);
      })
      .catch(() => {
        if (active) setCheckoutLinks({});
      })
      .finally(() => {
        if (active) setCheckoutResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const { user } = useCurrentUserState();
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  useEffect(() => {
    const on = () => setIsOffline(false);
    const off = () => setIsOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Current subscription state. `getMyAccountPage` is also the Gumroad claim
  // point: a membership bought with this verified email (webhook missed or the
  // buyer registered later) is bound and fulfilled before the status is read,
  // so this strip shows the truth, not a stale "Free".
  const userId = user?.id ?? null;
  const isDevFallback = user?.isDevFallback ?? false;
  useEffect(() => {
    if (!userId || isDevFallback) return;
    let active = true;
    void (async () => {
      try {
        const page = await getMyAccountPage();
        if (active) setAccount(page.account);
      } catch {
        // Status is informational: never block buying because it could not load.
      }
      try {
        const status = await getLicenseStatusFn();
        if (!active) return;
        setLicense(status.license ?? null);
        setIsSuspended(status.isSuspended ?? false);
      } catch {
        // Same: the plan cards work without it.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, isDevFallback]);

  // The buyer email that will end up on the Gumroad receipt: the signed-in
  // user's verified address. The dev fallback identity is NOT a buyer — its
  // placeholder address must never be prefilled into a real checkout.
  const buyerEmail = user && !isDevFallback ? user.primaryEmail : null;

  const stateView = purchaseStateView({
    signedIn: Boolean(user) && !isDevFallback,
    account,
    license,
    isSuspended,
  });
  const currentPlanKey = account?.status === "ACTIVE" ? account.planId : null;

  /**
   * Gumroad is the only checkout: each card deep-links straight to the right
   * tier + recurrence payment form (`variant=<tier>&<recurrence>=true&wanted=true`),
   * so the buyer never passes through the public product page. The signed-in
   * buyer's email is prefilled so the purchase lands on the same address the
   * account uses — that address is what binds the license.
   */
  function gumroadUrlFor(planKey: PlanKey): string | null {
    const url = checkoutLinks[planKey];
    if (!url) return null;
    return withGumroadPrefilledEmail(url, buyerEmail);
  }

  const availablePeriods = useMemo(
    () => billingPeriodsWithCheckout(Object.keys(checkoutLinks), currentPlanKey),
    [checkoutLinks, currentPlanKey],
  );
  const activeBilling = availablePeriods.includes(billing)
    ? billing
    : (availablePeriods[0] ?? billing);
  useEffect(() => {
    if (availablePeriods.length && billing !== activeBilling) {
      setBilling(activeBilling);
    }
  }, [activeBilling, availablePeriods.length, billing]);

  const paidPlans = useMemo(
    () =>
      PURCHASE_FAMILIES
        .map((family) => {
          const planKey = planKeyFor(family, activeBilling);
          return { family, planKey, plan: CENTRAL_PLANS[planKey] };
        })
        .filter(
          ({ planKey }) =>
            currentPlanKey === planKey || Boolean(checkoutLinks[planKey]),
        ),
    [activeBilling, checkoutLinks, currentPlanKey],
  );
  /*
   * The plan ladder, read top to bottom: free → individual → team → the
   * institution. Each rung is colour-coded (neutral, brand, navy, gold) so the
   * difference between plans is visible before any word is read, and every rung
   * states either its price or exactly how it is acquired — never a blank
   * "تواصل معنا" with no reason.
   */
  const planLadderTone: Record<PlanFamily, string> = {
    individual: "border-brand/35 bg-navy/[0.04]",
    team: "border-navy bg-navy/[0.07] ring-1 ring-navy/20",
  };

  return (
    <div className="min-h-full bg-page">
      <SiteHeader current="/purchase" />
      {isOffline && (
        <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] font-bold text-warning">
            <WifiOff className="size-4" /> وضع عدم الاتصال — تُعرض معلومات الاشتراك المحفوظة، لكن إجراءات الشراء والدفع تتطلب اتصالاً. ستتم المزامنة عند عودة الاتصال.
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        {/* ── Hero: what is being bought, and the two doors ─────────────── */}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand">
              تراخيص نَسَق
            </p>
            <h1 className="mt-2 text-[30px] font-black leading-[1.3] text-ink sm:text-[38px]">
              ترخيص واحد يفتح كل أدوات نَسَق
            </h1>
            <p className="mt-3 text-[15px] leading-8 text-muted">
              ابدأ مجانًا بلا بطاقة، ثم ارتقِ إلى الترخيص الفردي أو ترخيص الفريق عند
              الحاجة: قوالب أكثر، وصفحات بلا حدود، وهويات مؤسسية، وطباعة جاهزة.
              الاشتراك السنوي وتراخيص الجهات تُرتَّب مباشرة مع المبيعات.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <a
                href={CREATE_ROUTE}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-navy px-6 text-[14px] font-extrabold text-on-brand transition hover:bg-ok"
              >
                ابدأ مجانًا الآن
              </a>
              <a
                href="/contact"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line bg-surface px-5 text-[13.5px] font-extrabold text-ink transition hover:border-brand"
              >
                تواصل مع المبيعات
              </a>
            </div>
          </div>

          {/* The reader's own state, stated once, in plain Arabic. */}
          <div className="rounded-[14px] border border-line bg-surface-2 p-4">
            <p className="text-[11px] font-extrabold text-muted">حالتك الحالية</p>
            <p className="mt-1.5">
              <span className={`rounded-full px-3 py-1 text-[12px] font-extrabold ${TONE_STYLES[stateView.tone]}`}>
                {stateView.label}
              </span>
            </p>
            <p className="mt-2 text-[12.5px] leading-6 text-muted">{stateView.detail}</p>
            <a href="/license" className="mt-2 inline-block text-[12.5px] font-bold text-brand underline">
              تفاصيل الترخيص وإدارته
            </a>
          </div>
        </section>

        {/* ── How licensing works: numbered, roomy, one idea per step ───── */}
        <section id="how" className="mt-10 rounded-[16px] border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-[22px] font-black text-ink">كيف تعمل تراخيص نَسَق</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-7 text-muted">
            ثلاث خطوات فقط من الاختيار إلى فتح المزايا — دون مفاتيح تُدخل يدويًا ودون
            تفاصيل تقنية.
          </p>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "اختر الباقة المناسبة",
                body: "فردية لمن يعمل بمفرده، وترخيص فريق للجهات التي تشارك القوالب والهوية بين عدة مستخدمين.",
              },
              {
                title: "حدّد الفترة وأكمل السداد",
                body: "الفترات المتاحة شهريًا أو كل 3 أشهر. الاشتراك السنوي وتراخيص الجهات يتم ترتيبها عبر المبيعات.",
              },
              {
                title: "يُفعَّل ترخيصك فورًا",
                body: "بعد التحقق من السداد يُربط الترخيص بحسابك تلقائيًا، وتُفتح القوالب والمزايا مباشرة.",
              },
            ].map((step, index) => (
              <li key={step.title} className="grid gap-2">
                <span className="grid size-9 place-items-center rounded-full bg-navy text-[15px] font-black text-on-brand">
                  {index + 1}
                </span>
                <strong className="text-[14.5px] font-extrabold text-ink">{step.title}</strong>
                <span className="text-[13px] leading-7 text-muted">{step.body}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Trust strip ───────────────────────────────────────────────── */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { Icon: Lock, label: "دفع إلكتروني آمن" },
            { Icon: CreditCard, label: "تجديد تلقائي قابل للإلغاء" },
            { Icon: Key, label: "ترخيص رقمي يُربط بحسابك" },
            { Icon: ShieldCheck, label: "مشاريعك محفوظة على جهازك أولًا" },
          ].map(({ Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-bold text-muted"
            >
              <Icon className="size-3.5 text-brand" />
              {label}
            </span>
          ))}
        </div>

        {/* ── Period switch: only what is actually sold is offered ──────── */}
        {checkoutResolved && availablePeriods.length > 0 && (
          <div
            id="plans"
            className="mt-9 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
          >
            <div>
              <p className="mb-2 text-[13px] font-extrabold text-ink">فترة الاشتراك</p>
              {availablePeriods.length > 1 ? (
                <div role="group" aria-label="فترة الاشتراك" className="inline-flex rounded-[10px] border border-line bg-surface p-1">
                  {availablePeriods.map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setBilling(period)}
                      aria-pressed={activeBilling === period}
                      className={`rounded-[8px] px-4 py-2 text-[13px] font-bold transition ${
                        activeBilling === period
                          ? "bg-navy text-on-brand shadow-sm"
                          : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      {period === "quarterly" ? "كل 3 أشهر — أفضل قيمة" : PERIOD_LABELS[period]}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] font-semibold text-muted">{PERIOD_LABELS[availablePeriods[0]]}</p>
              )}
            </div>
            {paidPlans.length > 0 && (
              <div className="max-w-md text-[12.5px] leading-6 text-muted">
                {buyerEmail ? (
                  <p>
                    سيظهر بريد حسابك في نموذج الدفع، ويُربط الترخيص بهذا الحساب بعد
                    الشراء. للشراء لحساب آخر، استخدم بريده في النموذج.
                  </p>
                ) : (
                  <p>
                    استخدم البريد الذي ستسجّل به في نَسَق؛ يُربط الترخيص بحسابك عند تسجيل
                    الدخول. لا يلزم التسجيل قبل الشراء.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── The ladder: free, individual, team, institution ───────────── */}
        <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {/* Rung 1 — Free. Colour: neutral. */}
          <div className="flex flex-col rounded-[16px] border border-line bg-surface-2 p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[16px] font-black text-ink">مجاني</h2>
              <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] font-extrabold text-muted">
                دائم
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-6 text-muted">
              للتقييم والبدء: مشروع تجريبي وقوالب أساسية، دون دفع أو تاريخ انتهاء.
            </p>
            <p className="mt-4 font-display text-[28px] font-black text-ink">
              0 <span className="text-[13px] font-bold text-muted">ر.س</span>
            </p>
            <p className="text-[11.5px] text-muted">لا يتطلب ترخيصًا — متاح للجميع</p>
            <ul className="mt-4 grid gap-1.5 border-t border-line/60 pt-3.5">
              {FREE_PLAN.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-6 text-muted">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-muted" /> {feature}
                </li>
              ))}
            </ul>
            <a
              href={CREATE_ROUTE}
              className="mt-auto inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-line bg-surface text-[13px] font-extrabold text-ink transition hover:border-brand"
            >
              جرّب مجانًا
            </a>
          </div>

          {/* Rungs 2–3 — the paid plans actually on sale. */}
          {paidPlans.map(({ family, planKey, plan }) => {
            const isTeam = family === "team";
            const isCurrentPlan = currentPlanKey === planKey;
            const checkoutUrl = gumroadUrlFor(planKey);
            return (
              <div
                key={planKey}
                className={cardClass(`flex flex-col rounded-[16px] p-5 ${planLadderTone[family]}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[16px] font-black text-ink">
                      {isTeam ? "نَسَق | فريق" : "نَسَق | فردي"}
                    </h2>
                    <p className="mt-1 text-[12.5px] leading-6 text-muted">{plan.description}</p>
                  </div>
                  {isCurrentPlan ? (
                    <span className="shrink-0 rounded-full bg-navy px-2.5 py-1 text-[10.5px] font-extrabold text-on-brand">
                      خطتك الحالية
                    </span>
                  ) : isTeam ? (
                    <span className="shrink-0 rounded-full bg-navy px-2.5 py-1 text-[10.5px] font-extrabold text-on-brand">
                      الأكثر طلبًا
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 font-display text-[28px] font-black text-ink">
                  {plan.amount.toLocaleString("en-US")}{" "}
                  <span className="text-[13px] font-bold text-muted">ر.س</span>{" "}
                  <span className="text-[12px] font-bold text-muted">
                    / {activeBilling === "quarterly" ? "كل 3 أشهر" : "شهريًا"}
                  </span>
                </p>
                <p className="text-[11.5px] text-muted">
                  مدة الترخيص {plan.durationDays} يومًا ·{" "}
                  {activeBilling === "quarterly" ? "تجديد كل 3 أشهر" : "تجديد شهري"}
                </p>
                {activeBilling === "quarterly" && (
                  <p className="mt-1 text-[11.5px] font-extrabold text-brand">
                    وفّر {planSavings(plan)} ر.س مقارنة بالدفع الشهري
                  </p>
                )}
                <p className="mt-2 rounded-[8px] bg-surface/70 px-2.5 py-1.5 text-[11.5px] font-bold text-ink">
                  يشمل القوالب المتميزة والتصدير الكامل
                </p>
                <ul className="mt-3.5 grid gap-1.5 border-t border-line/60 pt-3.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-6 text-muted">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" /> {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  {isCurrentPlan ? (
                    <a
                      href="/account"
                      className="inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-brand/40 bg-surface text-[13px] font-extrabold text-brand"
                    >
                      إدارة الاشتراك
                    </a>
                  ) : checkoutUrl ? (
                    isOffline ? (
                      <span className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-[10px] border border-line bg-line-2 text-[13px] font-extrabold text-muted">
                        <WifiOff className="ms-2 size-4" /> يتطلب اتصالاً
                      </span>
                    ) : (
                      <a
                        href={checkoutUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`اشترك الآن — ${plan.arabicName}`}
                        className="subscription-cta inline-flex h-10 w-full items-center justify-center rounded-[10px] text-[13px] font-extrabold transition"
                      >
                        اشترك الآن
                      </a>
                    )
                  ) : (
                    <a
                      href="/contact"
                      className="inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-line bg-surface text-[13px] font-extrabold text-ink"
                    >
                      تواصل مع المبيعات
                    </a>
                  )}
                  <p className="mt-2 text-center text-[11.5px] text-muted">
                    {isCurrentPlan ? "التجديد والتفاصيل في حسابك" : "ترخيص رقمي · دفع آمن"}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Rung 4 — the institution. Colour: gold, acquired by conversation. */}
          <div className="flex flex-col rounded-[16px] border border-gold/50 bg-gold/10 p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[16px] font-black text-ink">نَسَق | الجهات</h2>
              <span className="shrink-0 rounded-full bg-gold/25 px-2.5 py-1 text-[10.5px] font-extrabold text-ink">
                بحسب الجهة
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-6 text-muted">
              للجهات الحكومية والشركات: مقاعد متعددة، وفواتير رسمية، وهوية مؤسسية
              موحّدة، واشتراك سنوي باتفاق مباشر.
            </p>
            <p className="mt-4 font-display text-[20px] font-black text-ink">
              عرض سعر مخصّص
            </p>
            <p className="text-[11.5px] text-muted">
              يُحدَّد بعد معرفة عدد المقاعد ونطاق الاستخدام — دون أسعار مخفية.
            </p>
            <ul className="mt-4 grid gap-1.5 border-t border-gold/40 pt-3.5">
              {[
                "مقاعد متعددة لمستخدِمي الجهة",
                "اشتراك سنوي وفواتير رسمية",
                "قوالب وهوية مؤسسية مخصّصة",
                "دعم فني وتدريب للفريق",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-6 text-muted">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-gold" /> {feature}
                </li>
              ))}
            </ul>
            <a
              href="/contact"
              className="mt-auto inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-gold px-4 text-[13px] font-extrabold text-on-gold transition hover:bg-gold-2"
            >
              تواصل مع المبيعات
            </a>
          </div>
        </div>

        <p className="mt-4 text-[12.5px] leading-6 text-muted">
          كل الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة حيث تنطبق. الاشتراك
          الشهري أو ربع السنوي يُجدَّد تلقائيًا ويمكن إلغاؤه من حسابك في أي وقت؛
          الاشتراك السنوي متاح باتفاق مباشر مع المبيعات.
        </p>

        {/* ── FAQ ───────────────────────────────────────────────────────── */}
        <section className="mt-10 border-t border-line/60 pt-8">
          <h2 className="font-display text-[20px] font-black text-ink">الأسئلة الشائعة</h2>
          <div className="mt-5 grid gap-2">
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div key={faq.q} className="overflow-hidden rounded-[10px] border border-line/70 bg-surface">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-right text-[13.5px] font-extrabold text-ink"
                  >
                    {faq.q}
                    <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <p className="border-t border-line/60 px-4 py-3 text-[13px] leading-7 text-muted">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-line/60 bg-surface-2 p-5">
          <div>
            <h3 className="text-[14px] font-extrabold text-ink">
              لا تحتاج إدخال أي مفتاح ترخيص أثناء الدفع
            </h3>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-6 text-muted">
              يُنشأ الترخيص ويُربط بحسابك تلقائيًا بعد التحقق من السداد. وإن كان لديك
              مفتاح ترخيص سابق، فأدره من صفحة التراخيص.
            </p>
          </div>
          <a
            href="/license"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-extrabold text-ink hover:border-brand"
          >
            <Key className="size-3.5" /> إدارة الترخيص
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
