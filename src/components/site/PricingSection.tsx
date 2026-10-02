/**
 * «الخطط والأسعار» — the homepage pricing section.
 *
 * Three things it does that the previous static markup could not:
 *
 * 1. **A billing switch.** «شهري» ↔ «3 أشهر» rebuilds the card set from the
 *    pricing catalog, so the amount and the duration always move together
 *    (79 / 30 يومًا ↔ 199 / 90 يومًا for Pro). The numbers, the labels and the
 *    saving all come from `lib/commercial/plan-cards.ts` — this file never
 *    writes a price, so the card can never quote a number the invoice
 *    disagrees with.
 * 2. **Real actions.** Each card ends in a button: the free plan walks into the
 *    editor (`onStartFree`), a paid plan opens its Gumroad checkout deep link —
 *    the same `variant + recurrence` URL `/purchase` sells from, with the
 *    signed-in buyer's email prefilled so the membership lands on the address
 *    that binds the licence. A paid card appears only after its exact checkout
 *    link has been returned; unavailable plans are not presented as purchasable.
 * 3. **A whole card that is one target.** The card's surface is a stretched hit
 *    area over the same handler as its button, so clicking anywhere on a card
 *    acts — while the visible button stays the single keyboard-reachable
 *    control (no nested buttons, no duplicate names in the accessibility tree).
 *
 * RTL is the document's own direction, so the switcher, the ribbon and the
 * price block inherit it; every colour here is a theme role, never a hex.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { cardClass } from "@/components/site/cards";
import { whatsappHref } from "@/lib/brand";
import { getGumroadCheckoutLinksFn } from "@/lib/gumroad/functions";
import {
  isGumroadPlanKey,
  withGumroadPrefilledEmail,
} from "@/lib/gumroad/mapping";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  billingPeriodsWithCheckout,
  PERIOD_HINTS,
  PERIOD_LABELS,
  checkoutKeyFor,
  homePlanCards,
  institutionalAnnualCard,
  type HomePlanCard,
  type SwitchablePeriod,
} from "@/lib/commercial/plan-cards";
import type { PlanKey } from "@/lib/commercial/catalog";

export function PricingSection({
  onStartFree,
}: {
  /** «ابدأ مجانًا» — the same door the hero call-to-action opens. */
  onStartFree: () => void;
}) {
  const [period, setPeriod] = useState<SwitchablePeriod>("monthly");
  const [checkoutLinks, setCheckoutLinks] = useState<Partial<Record<PlanKey, string>>>({});
  const [checkoutResolved, setCheckoutResolved] = useState(false);
  const [pending, setPending] = useState<PlanKey | null>(null);
  const warmed = useRef(false);
  const busy = useRef(false);
  const { user } = useCurrentUserState();

  // Never pass the sandbox's fallback identity to a real payment provider.
  const buyerEmail = user && !user.isDevFallback ? user.primaryEmail : null;

  const loadLinks = useCallback(async (): Promise<Partial<Record<PlanKey, string>>> => {
    try {
      const links = await getGumroadCheckoutLinksFn();
      const resolved: Partial<Record<PlanKey, string>> = {};
      for (const link of links) {
        if (!isGumroadPlanKey(link.planKey)) continue;
        const url = typeof link.url === "string" ? link.url.trim() : "";
        if (url) resolved[link.planKey] = url;
      }
      setCheckoutLinks(resolved);
      setCheckoutResolved(true);
      return resolved;
    } catch (error) {
      setCheckoutLinks({});
      setCheckoutResolved(true);
      throw error;
    }
  }, []);

  const warmUp = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    void loadLinks().catch(() => {
      warmed.current = false;
    });
  }, [loadLinks]);

  // Only show paid plans after the server has confirmed a checkout URL.
  useEffect(() => {
    warmUp();
  }, [warmUp]);

  const availablePeriods = useMemo(
    () => billingPeriodsWithCheckout(Object.keys(checkoutLinks)),
    [checkoutLinks],
  );
  const activePeriod = availablePeriods.includes(period)
    ? period
    : (availablePeriods[0] ?? period);
  useEffect(() => {
    if (checkoutResolved && availablePeriods.length && period !== activePeriod) {
      setPeriod(activePeriod);
    }
  }, [activePeriod, availablePeriods.length, checkoutResolved, period]);

  const cards = useMemo(
    () => [
      ...homePlanCards(activePeriod).filter((card) => {
        const planKey = checkoutKeyFor(card);
        return !planKey || Boolean(checkoutLinks[planKey]);
      }),
      institutionalAnnualCard(),
    ],
    [activePeriod, checkoutLinks],
  );
  const subscribe = useCallback(
    async (card: HomePlanCard) => {
      const planKey = checkoutKeyFor(card);
      if (!planKey || busy.current) return;
      busy.current = true;
      setPending(planKey);
      const known = checkoutLinks[planKey];
      const tab = known ? null : window.open("", "_blank");
      try {
        const url = known ?? (await loadLinks())[planKey] ?? null;
        if (!url) {
          tab?.close();
          setCheckoutLinks((current) => {
            const next = { ...current };
            delete next[planKey];
            return next;
          });
          toast.error("خطة الشراء هذه غير متاحة حاليًا.");
          return;
        }

        const checkoutUrl = withGumroadPrefilledEmail(url, buyerEmail);
        if (tab) {
          tab.opener = null;
          tab.location.replace(checkoutUrl);
        } else if (known) {
          window.open(checkoutUrl, "_blank", "noopener,noreferrer");
        } else {
          window.location.assign(checkoutUrl);
        }
      } catch {
        tab?.close();
        toast.error("تعذّر تحميل رابط Gumroad. حاول مرة أخرى.");
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [buyerEmail, checkoutLinks, loadLinks],
  );

  const run = useCallback(
    (card: HomePlanCard) => {
      if (card.kind === "free") onStartFree();
      else if (card.kind === "contact") {
        window.open(
          whatsappHref(
            "السلام عليكم، أرغب بطلب الاشتراك السنوي للجهة المؤسسية من منصة نَسَق.",
          ),
          "_blank",
          "noopener,noreferrer",
        );
      } else void subscribe(card);
    },
    [onStartFree, subscribe],
  );

  return (
    <section
      className="bg-page py-12 sm:py-14"
      onPointerEnter={warmUp}
      onFocusCapture={warmUp}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.14em] text-brand">
              الخطط والتراخيص
            </p>
            <h2 className="mt-2 text-[20px] font-bold text-ink">
              اختر الخطة المناسبة
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-muted">
              تظهر الخطط المدفوعة فقط عند توفر رابط شراء فعلي.
            </p>
          </div>
          <a
            href="/purchase"
            className="text-[13px] font-bold text-brand transition hover:text-brand-hover hover:underline"
          >
            عرض جميع الباقات
          </a>
        </div>

        {checkoutResolved && availablePeriods.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[12px] font-bold text-ink">فترة الاشتراك</span>
            {availablePeriods.length > 1 ? (
              <div
                role="group"
                aria-label="فترة الاشتراك"
                className="inline-flex rounded-[10px] border border-line bg-surface p-1"
              >
                {availablePeriods.map((option) => {
                  const active = activePeriod === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPeriod(option)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-bold transition ${
                        active
                          ? "bg-inverse text-on-inverse shadow-sm ring-1 ring-inverse"
                          : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      {PERIOD_LABELS[option]}
                      {PERIOD_HINTS[option] === PERIOD_HINTS.monthly ? null : (
                        <span className="rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-extrabold text-on-gold">
                          {PERIOD_HINTS[option]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[13px] font-semibold text-muted">
                {PERIOD_LABELS[availablePeriods[0]]}
              </span>
            )}
          </div>
        )}

        {/* Cards */}
        <div className="mt-6 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <PlanCard
              key={card.id}
              card={card}
              busy={pending === card.id}
              onActivate={() => run(card)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  card,
  busy,
  onActivate,
}: {
  card: HomePlanCard;
  busy: boolean;
  onActivate: () => void;
}) {
  const free = card.kind === "free";
  return (
    <article
      className={cardClass(
        `relative flex flex-col overflow-hidden ${
          card.featured ? "border-brand/35 ring-1 ring-brand/15" : ""
        }`,
      )}
    >
      {/* The whole card is one target for the same action as its button. It is
          removed from the tab order and from the accessibility tree, so the
          visible button below stays the only control a keyboard or a screen
          reader ever lands on. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onActivate}
        className="absolute inset-0 z-0 cursor-pointer"
      />

      {card.featured ? (
        <span className="relative z-10 flex items-center justify-center gap-1.5 bg-navy py-1.5 text-[11px] font-extrabold tracking-wide text-on-brand">
          <Sparkles className="size-3.5" />
          الأكثر شعبية
        </span>
      ) : null}

      {/* `pointer-events-none` lets a click on the text reach the hit area above
          instead of dying on a non-interactive paragraph. */}
      <div className="pointer-events-none relative z-10 flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-bold text-ink">{card.name}</h3>
          {free ? (
            <span className="shrink-0 rounded-full border border-line/70 bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-muted">
              مجانية دائمًا
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-muted">{card.description}</p>

        <p className="mt-4 text-[24px] font-extrabold leading-tight text-ink">
          {card.formattedAmount}{" "}
          <span className="text-[13px] font-bold text-muted">ر.س</span>{" "}
          {free ? null : (
            <span className="text-[12px] font-bold text-muted">
              / {card.priceSuffix}
            </span>
          )}
        </p>
        <p className="mt-1 text-[11px] text-muted">{card.termLabel}</p>
        {card.renewalLabel ? (
          <p className="text-[11px] text-muted">{card.renewalLabel}</p>
        ) : null}
        {card.hasSavings ? (
          <p className="mt-1 text-[11px] font-bold text-brand">
            وفّر {card.savings} ر.س مقارنة بالشهري
          </p>
        ) : null}

        <ul className="mt-4 grid gap-1.5 border-t border-line/60 pt-3.5">
          {card.features.map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-2 text-[12px] leading-5 text-muted"
            >
              <CheckCircle2
                className={`size-3.5 shrink-0 ${card.featured ? "text-brand" : "text-muted"}`}
              />
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 px-5 pb-5">
        <button
          type="button"
          onClick={onActivate}
          disabled={busy}
          className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] text-[13px] font-bold transition ${
            free
              ? "border border-line bg-surface text-ink hover:bg-surface-2"
              : "subscription-cta"
          } disabled:cursor-wait disabled:opacity-70`}
        >
          {busy
            ? "جارٍ فتح Gumroad…"
            : card.ctaLabel}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted">
          {card.ctaHint}
        </p>
      </div>
    </article>
  );
}
