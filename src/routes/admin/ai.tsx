import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Sparkles, XCircle } from "lucide-react";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminStudioKnowledgeBase } from "@/components/admin/AdminStudioKnowledgeBase";
import { nasaqAiStatusFn } from "@/lib/ai/functions";
import { ADMIN_ROUTES, ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "ai")!;

/**
 * `/admin/ai` — the ONE control surface for نَسَق AI.
 *
 * Every AI capability of the platform (report drafting, selection transforms,
 * image analysis/OCR, raw-content generation) runs through the same Gemini
 * adapter under `src/lib/ai`, with the same licence gates and rate limits.
 * The operator sees that single system here: its live status, the studio
 * knowledge base that grounds the generators, and where its keys live — no
 * second provider config, no duplicate panels.
 */
export const Route = createFileRoute("/admin/ai")({
  component: AiSection,
});

function AiSection() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof nasaqAiStatusFn>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void nasaqAiStatusFn()
      .then((result) => alive && setStatus(result))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        <div className="grid gap-4">
          <section className="rounded-[12px] border border-line bg-surface p-4">
            <header className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-[10px] bg-navy/10 text-brand">
                <Bot className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-black">مزوّد نَسَق AI — Gemini</h3>
                <p className="text-[10.5px] text-muted">
                  مزوّد واحد لكل القدرات؛ المفاتيح في الخزنة، الحدود في الباقات.
                </p>
              </div>
              <span className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10.5px] font-black">
                {failed ? (
                  <span className="inline-flex items-center gap-1 text-error">
                    <XCircle className="size-3.5" aria-hidden /> تعذّر الفحص
                  </span>
                ) : !status ? (
                  "جارٍ الفحص…"
                ) : status.configured ? (
                  <span className="inline-flex items-center gap-1 text-brand">
                    <CheckCircle2 className="size-3.5" aria-hidden /> مفعّل
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <XCircle className="size-3.5" aria-hidden /> غير مفعّل
                  </span>
                )}
              </span>
            </header>
            {status && (
              <p className="mt-3 text-[11.5px] leading-6 text-muted">
                النموذج: <strong className="text-ink" dir="ltr">{status.model}</strong> · القدرات:{" "}
                {status.capabilities.join(" · ")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                to={ADMIN_ROUTES.vault}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-bold transition hover:border-brand"
              >
                <KeyRound className="size-3.5" aria-hidden />
                مفتاح GEMINI_API_KEY في الخزنة
              </Link>
              <Link
                to={ADMIN_ROUTES.plans}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-bold transition hover:border-brand"
              >
                <Sparkles className="size-3.5" aria-hidden />
                ميزة ai_report في الباقات
              </Link>
            </div>
          </section>

          <AdminStudioKnowledgeBase />
        </div>
      </AdminGate>
    </AdminSection>
  );
}
