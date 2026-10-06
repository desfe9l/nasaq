/*
 * «كيف تريد أن تبدأ؟» — the four ways into a NASAQ document.
 *
 * The creation screen used to answer only one question (which format), which
 * meant every other way of starting a document — a template, a prompt, raw
 * content — was reachable only by knowing the address of another page. The
 * chooser makes the four doors explicit and ADDRESSABLE (`/create?start=…`), so
 * each one can be linked and bookmarked, and the browser's Back moves between
 * them instead of leaving the screen.
 *
 * The chooser collects nothing and duplicates nothing: it routes to surfaces
 * that already exist (`/templates`, its categories, and the generation studio)
 * or renders the existing screens on this page.
 */

import { useState } from "react";
import {
  ArrowLeft,
  FilePlus2,
  LayoutTemplate,
  ScanText,
  Sparkles,
} from "lucide-react";
import { TEMPLATE_CATEGORY_SURFACES } from "@/lib/templates/category-pages";
import {
  STUDIO_ROUTE,
  TEMPLATES_ROUTE,
  categoryPathFor,
  createPathFor,
} from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export type CreateStartPath = "blank" | "template" | "ai" | "raw";

export const CREATE_START_PATHS: Array<{
  id: CreateStartPath;
  label: string;
  desc: string;
}> = [
  { id: "blank", label: "مستند فارغ", desc: "اختر النوع والمقاس والاتجاه، ثم ابدأ الكتابة" },
  { id: "template", label: "قالب جاهز", desc: "غلاف، تقرير، مؤشرات، عرض — جاهز للتحرير" },
  { id: "ai", label: "وصف بالذكاء الاصطناعي", desc: "اكتب فكرتك ويُبنى التصميم كاملًا" },
  { id: "raw", label: "محتوى خام", desc: "الصق نصًا أو جدولًا ليصبح مستندًا منظمًا" },
];

const ICONS: Record<CreateStartPath, typeof FilePlus2> = {
  blank: FilePlus2,
  template: LayoutTemplate,
  ai: Sparkles,
  raw: ScanText,
};

export function CreatePathChooser({
  active,
  onSelect,
}: {
  active: CreateStartPath;
  onSelect: (path: CreateStartPath) => void;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {CREATE_START_PATHS.map((item) => {
        const Icon = ICONS[item.id];
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={selected}
            className={cn(
              "rounded-xl border p-3 text-right transition",
              selected
                ? "border-brand bg-navy/5 shadow-card"
                : "border-line bg-surface hover:border-brand/60",
            )}
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-lg",
                selected ? "bg-navy text-on-brand" : "bg-navy/10 text-brand",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="mt-2.5 block text-[13px] font-extrabold text-ink">{item.label}</span>
            <span className="mt-1 block text-[11.5px] leading-5 text-muted">{item.desc}</span>
            {selected && (
              <span className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold text-brand">
                <ArrowLeft className="size-3" aria-hidden />
                هذه هي الطريقة المختارة
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * «وصف بالذكاء الاصطناعي» — the prompt box on the creation screen.
 *
 * It does NOT generate here: generation belongs to `/studio`, whose result is
 * the four-variation design and the editor hand-off. This panel only carries the
 * author's words to it (`/studio?prompt=…`) — one generator, one address.
 */
export function AiStartPanel() {
  const [prompt, setPrompt] = useState("");
  const href = prompt.trim()
    ? `${STUDIO_ROUTE}?prompt=${encodeURIComponent(prompt.trim().slice(0, 400))}`
    : STUDIO_ROUTE;

  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-navy/10 text-brand">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-[13px] font-extrabold text-ink">صف التصميم الذي تريده</h2>
          <p className="text-[11px] text-muted">
            مثال: «صمم تقريرًا رسميًا عن الأمن السيبراني من ٦ صفحات» — تُبنى النسخ الأربع في
            الاستوديو.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          dir="rtl"
          placeholder="صمم تقريرًا رسميًا عن…"
          className="h-11 flex-1 rounded-xl border border-line bg-page px-3 text-[13px] font-semibold focus:border-brand focus:outline-none"
        />
        <a
          href={href}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"
        >
          فتح استوديو التوليد
          <ArrowLeft className="size-4" aria-hidden />
        </a>
      </div>
    </section>
  );
}

/** «قالب جاهز» — categories first, then the gallery with its filters. */
export function TemplateStartStrip() {
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-extrabold text-ink">ابدأ من قالب جاهز</h2>
          <p className="text-[11px] text-muted">
            كل فئة صفحة قابلة للمشاركة، وداخلها معاينات حقيقية وزر «استخدام القالب».
          </p>
        </div>
        <a
          href={TEMPLATES_ROUTE}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[12px] font-bold text-ink transition hover:border-brand"
        >
          <LayoutTemplate className="size-3.5" aria-hidden />
          كل القوالب
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TEMPLATE_CATEGORY_SURFACES.map((surface) => (
          <a
            key={surface.id}
            href={categoryPathFor(surface.id)}
            title={surface.purpose}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11.5px] font-bold text-muted transition hover:border-brand hover:text-ink"
          >
            {surface.title}
          </a>
        ))}
      </div>
    </section>
  );
}

/** The canonical address of a chosen start path, for addressable switching. */
export function startPathHref(path: CreateStartPath): string {
  return path === "blank" ? createPathFor() : createPathFor({ start: path });
}
