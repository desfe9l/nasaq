import { ImagePlus, Layers, Megaphone, MessageCircle, Palette, Phone, Brush } from "lucide-react";
import { BRAND, CONTACT_PHONE_DISPLAY, CUSTOM_DESIGN, telHref } from "@/lib/brand";
import { BrandLogo } from "./SiteChrome";

const SCOPE_ICONS = [Layers, Palette, Megaphone, Brush] as const;

export function CustomDesignLogoSlot() {
  return (
    <section
      aria-label={CUSTOM_DESIGN.logoSlotLabel}
      className="rounded-2xl border border-dashed border-line bg-white p-6 dark:border-white/15 dark:bg-white/5"
    >
      <div className="grid aspect-[16/9] place-items-center rounded-xl bg-line-2/60 dark:bg-white/[0.04]">
        <div className="grid place-items-center gap-2 p-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl border border-line bg-white dark:border-white/10 dark:bg-white/5">
            <ImagePlus className="size-6 text-muted" aria-hidden />
          </span>
          <strong className="text-[14px] font-extrabold">{CUSTOM_DESIGN.logoSlotLabel}</strong>
          <span className="max-w-xs text-[12px] leading-6 text-muted">
            {CUSTOM_DESIGN.logoSlotHint}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <BrandLogo compact />
        <p className="text-[11px] leading-5 text-muted">
          إطار محايد من {BRAND.platform} — يُستبدل بشعار الجهة المعتمد عند بدء التنفيذ.
        </p>
      </div>
    </section>
  );
}

export function CustomDesignScopes() {
  return (
    <ul className="mt-4 grid gap-3">
      {CUSTOM_DESIGN.scopes.map((scope, i) => {
        const Icon = SCOPE_ICONS[i % SCOPE_ICONS.length];
        return (
          <li
            key={scope.id}
            className="flex items-start gap-3 rounded-xl border border-line p-3 dark:border-white/10"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy dark:bg-white/10 dark:text-white">
              <Icon className="size-4" aria-hidden />
            </span>
            <span>
              <strong className="block text-[13px] font-extrabold">{scope.label}</strong>
              <span className="mt-0.5 block text-[12px] leading-6 text-muted">{scope.hint}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function CustomDesignActions() {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <a
        href="/contact"
        className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-white transition hover:bg-navy-2"
      >
        <MessageCircle className="size-4" aria-hidden />
        إرسال الطلب عبر التواصل
      </a>
      <a
        href={telHref()}
        className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-5 text-[13px] font-bold transition hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5"
      >
        <Phone className="size-4" aria-hidden />
        <span className="tabular-nums" dir="ltr">{CONTACT_PHONE_DISPLAY}</span>
      </a>
    </div>
  );
}
