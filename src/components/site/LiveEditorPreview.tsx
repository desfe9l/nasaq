import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DOCS = [
  { id: "official", label: "تقرير رسمي" },
  { id: "slides", label: "عرض تقديمي" },
  { id: "briefing", label: "عرض قيادي" },
] as const;

/**
 * The real editor, live in the page — not a screenshot, not a mockup.
 *
 * The frame boots `/editor?template=…&showcase=1`: a fully interactive
 * document that never persists (the store's showcase boot no-ops every
 * save and keeps the project in memory). It is the same bundle the product
 * ships, so what the visitor sees and drags IS the product.
 *
 * The frame mounts lazily when the section nears the viewport, so the
 * homepage's first paint is not paying for the editor's boot.
 */
export function LiveEditorPreview() {
  const [active, setActive] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { rootMargin: "480px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const doc = DOCS[active];

  return (
    <div className="mx-auto w-full lg:max-w-none">
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
        <div
          className="flex items-center gap-1.5 border-b border-line/60 bg-surface px-3 py-2.5"
          role="tablist"
          aria-label="نماذج المخرجات"
        >
          {DOCS.map((d, idx) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={active === idx}
              onClick={() => setActive(idx)}
              className={cn(
                "shrink-0 rounded-[8px] border px-3 py-1.5 text-[11px] font-bold transition",
                active === idx
                  ? "border-inverse/10 bg-inverse text-on-inverse"
                  : "border-transparent bg-surface-2 text-muted hover:border-line",
              )}
            >
              {d.label}
            </button>
          ))}
          <span className="ms-auto hidden text-[10px] font-bold text-muted sm:block">
            محرر حقيقي — جرّبه بنفسك
          </span>
        </div>
        <div ref={frameRef} className="relative h-[420px] bg-surface-2 sm:h-[480px]">
          {!armed ? (
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-[12px] font-semibold text-muted">
                جاري تجهيز المحرر…
              </span>
            </div>
          ) : (
            <iframe
              key={doc.id}
              src={`/editor?template=${doc.id}&showcase=1`}
              title={`معاينة حية: ${doc.label}`}
              loading="lazy"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-6 text-muted">
        هذه المعاينة هي محرر نَسَق الفعلي — انقر وحرك العناصر بنفسك. ما
        تفعله يبقى في هذه الجلسة فقط ولا يُحفظ على جهازك.
      </p>
    </div>
  );
}
