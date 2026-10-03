import { useEffect, useRef, useState } from "react";
import type { AdminTemplateSummary } from "@/lib/admin/types";

/**
 * The homepage feature is a published Admin catalog record, not a bundled
 * showcase preset. The editor frame loads that record through the same public
 * template endpoint used by template pages; only free, published records are
 * eligible for an interactive public preview.
 */
export function LiveEditorPreview({
  document,
}: {
  document: AdminTemplateSummary;
}) {
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
  }, [document?.id]);

  return (
    <div className="mx-auto w-full lg:max-w-none">
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2 border-b border-line/60 bg-surface px-3 py-2.5">
          {document.thumbnail && (
            <img
              src={document.thumbnail}
              alt=""
              aria-hidden="true"
              className="size-8 shrink-0 rounded border border-line object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold text-ink">
              {document.title}
            </p>
            <p className="truncate text-[10px] text-muted">
              {document.category} · مستند مميز من كتالوج نَسَق
            </p>
          </div>
          <span className="ms-auto hidden shrink-0 text-[10px] font-bold text-muted sm:block">
            محرر حقيقي — جرّبه بنفسك
          </span>
        </div>
        <div
          ref={frameRef}
          className="relative h-[420px] bg-surface-2 sm:h-[480px]"
        >
          {!armed ? (
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-[12px] font-semibold text-muted">
                جاري تجهيز المحرر…
              </span>
            </div>
          ) : (
            <iframe
              key={document.id}
              src={`/editor?adminTemplate=${encodeURIComponent(document.id)}&showcase=1`}
              title={`معاينة حية: ${document.title}`}
              loading="lazy"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-6 text-muted">
        هذه المعاينة تفتح سجل «{document.title}» نفسه من كتالوج القوالب المنشور؛
        التعديلات تبقى داخل هذه الجلسة ولا تُحفظ.
      </p>
    </div>
  );
}
