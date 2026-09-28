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
 *    that binds the licence. No link for the tier, or a failed gateway, falls
 *    back to `/purchase` with the chosen period preselected.
 * 3. **A whole card that is one target.** The card's surface is a stretched hit
 *    area over the same handler as its button, so clicking anywhere on a card
 *    acts — while the visible button stays the single keyboard-reachable
 *    control (no nested buttons, no duplicate names in the accessibility tree).
 *
 * RTL is the document's own direction, so the switcher, the ribbon and the
 * price block inherit it; every colour here is a theme role, never a hex.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { cardClass } from "@/components/site/cards";
import { getGumroadCheckoutLinksFn } from "@/lib/gumroad/functions";
import { withGumroadPrefilledEmail } from "@/lib/gumroad/mapping";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  HOME_BILLING_PERIODS,
  PERIOD_HINTS,
  PERIOD_LABELS,
  checkoutKeyFor,
  homePlanCards,
  periodSaving,
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
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PlanKey | null>(null);
  const warmed = useRef(false);
  const busy = useRef(false);
  const { user } = useCurrentUserState();

  // The purchase lands on the email that binds the licence. The sandbox
  // fallback identity is NOT a buyer — its placeholder address must never be
  // pushed into a real payment form.
  const buyerEmail = user && !user.isDevFallback ? user.primaryEmail : null;

  const cards = useMemo(() => homePlanCards(period), [period]);
  const saving = periodSaving(period);

  const loadLinks = useCallback(async (): Promise<Record<string, string>> => {
    const links = await getGumroadCheckoutLinksFn();
    const resolved = Object.fromEntries(
      links.map((link) => [
        link.planKey,
        withGumroadPrefilledEmail(link.url, buyerEmail),
      ]),
    );
    setCheckoutLinks((current) => ({ ...current, ...resolved }));
    return resolved;
  }, [buyerEmail]);

  /**
   * Fetch the deep links the first time the buyer shows intent (hover, focus,
   * touch) rather than on page load: a visitor who only reads the section
   * never pays for a request it does not use, and by the time a click lands
   * the URL is already in memory — so the checkout tab opens inside the click
   * gesture, where no popup blocker can eat it.
   */
  const warmUp = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    void loadLinks().catch(() => {
      warmed.current = false; // a failed warm-up must not disable the button
    });
  }, [loadLinks]);

  const subscribe = useCallback(
    async (card: HomePlanCard) => {
      const planKey = checkoutKeyFor(card);
      // The ref, not `pending`: two clicks in the same tick would both read the
      // pre-render state and open two checkout tabs.
      if (!planKey || busy.current) return;
      busy.current = true;
      setPending(planKey);
      const cached = Boolean(checkoutLinks[planKey]);
      const known = checkoutLinks[planKey];
      // A tab opened synchronously, inside the click gesture, survives popup
      // blockers; one opened after the `await` often does not. So when the link
      // is not cached yet, the tab is opened first and navigated afterwards.
      const tab = cached ? null : window.open("", "_blank");
      const purchaseHref = `/purchase?period=${period}`;
      try {
        const url = known ?? (await loadLinks())[planKey] ?? null;
        if (url) {
          if (tab) {
            tab.opener = null; // the checkout page gets no handle on this window
            tab.location.replace(url);
          } else if (cached) {
            window.open(url, "_blank", "noopener,noreferrer");
          } else {
            // The tab was blocked: the click still has to reach checkout.
            window.location.assign(url);
          }
          return;
        }
        // No deep link for this tier: the full pricing page still sells it.
        tab?.close();
        window.location.assign(purchaseHref);
      } catch {
        tab?.close();
        window.location.assign(purchaseHref);
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [checkoutLinks, loadLinks, period],
  );

  const run = useCallback(
    (card: HomePlanCard) => {
      if (card.kind === "free") onStartFree();
      else void subscribe(card);
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
              بدّل بين الدفع الشهري وكل 3 أشهر — تتحدّث الأسعار والمدد في
              البطاقات فورًا.
            </p>
          </div>
          <a
            href="/purchase"
            className="text-[13px] font-bold text-brand transition hover:text-brand-hover hover:underline"
          >
            عرض جميع الباقات
          </a>
        </div>

        {/* Billing switcher */}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px] font-bold text-ink">فترة الاشتراك</span>
          <div
            role="group"
            aria-label="فترة الاشتراك"
            className="inline-flex rounded-[10px] border border-line bg-surface p-1"
          >
            {HOME_BILLING_PERIODS.map((option) => {
              const active = period === option;
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
          <p className="text-[12px] text-muted">
            {saving > 0
              ? `الدفع كل 3 أشهر يوفّر ${saving} ر.س على خطة Pro`
              : "دفع شهري قابل للإلغاء في أي وقت"}
          </p>
        </div>

        {/* Cards */}
        <div className="mt-6 grid items-stretch gap-4 md:grid-cols-3">
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
              : card.featured
                ? "bg-navy text-on-brand hover:bg-navy-2"
                : "bg-inverse text-on-inverse hover:bg-inverse-hover"
          } disabled:cursor-wait disabled:opacity-70`}
        >
          {busy ? "جارٍ فتح بوابة الدفع…" : card.ctaLabel}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted">
          {card.ctaHint}
        </p>
      </div>
    </article>
  );
}
