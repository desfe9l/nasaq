import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Save, Sparkles, XCircle } from "lucide-react";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminStudioKnowledgeBase } from "@/components/admin/AdminStudioKnowledgeBase";
import { nasaqAiSaveProviderSettingsFn, nasaqAiStatusFn } from "@/lib/ai/functions";
import { DEFAULT_AI_PROVIDER_SETTINGS, type AiProviderId, type AiProviderSettings, type AiTask } from "@/lib/ai/provider-config";
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
  const [settings, setSettings] = useState<AiProviderSettings>(() => structuredClone(DEFAULT_AI_PROVIDER_SETTINGS));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let alive = true;
    void nasaqAiStatusFn()
      .then((result) => {
        if (!alive) return;
        setStatus(result);
        if (result.providers?.length) {
          const next = structuredClone(DEFAULT_AI_PROVIDER_SETTINGS);
          for (const provider of result.providers) if (provider.id in next.providers) next.providers[provider.id as AiProviderId] = { enabled: provider.enabled, priority: provider.priority, models: provider.models as Record<AiTask, string> };
          setSettings(next);
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const updateProvider = (id: AiProviderId, update: Partial<AiProviderSettings["providers"][AiProviderId]>) => setSettings((current) => ({
    providers: { ...current.providers, [id]: { ...current.providers[id], ...update, models: { ...current.providers[id].models, ...(update.models ?? {}) } } },
  }));
  const save = async () => {
    setSaving(true); setSaved("");
    try {
      const result = await nasaqAiSaveProviderSettingsFn({ data: settings });
      setSaved(result.ok ? "حُفظت الإعدادات" : result.error);
    } catch { setSaved("تعذر حفظ الإعدادات"); }
    finally { setSaving(false); }
  };

  const providerLabels: Record<AiProviderId, string> = { google: "Google AI (Gemini)", grok: "Grok (xAI) / Groq", mistral: "Mistral", openrouter: "OpenRouter" };
  const taskLabels: Record<AiTask, string> = { default: "عام", report: "التقارير", design: "التصميم", selection: "النص المحدد", image: "الصور وOCR" };

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
                <h3 className="text-[13px] font-black">مزوّدو نَسَق AI — تحويل تلقائي عند التعطّل</h3>
                <p className="text-[10.5px] text-muted">
                  ترتيب أولوية موحّد لكل القدرات؛ المفاتيح تبقى على الخادم.
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
                النموذج: <strong className="text-ink" dir="ltr">{status.model}</strong>
                {status.fallbacks?.length ? (
                  <>
                    {" "}· بديل عند 404: <span dir="ltr">{status.fallbacks.join(" ، ")}</span>
                  </>
                ) : null}
                {status.constitutionVersion ? (
                  <> · الدستور: <span dir="ltr">{status.constitutionVersion}</span></>
                ) : null}
                {" "}· القدرات: {status.capabilities.join(" · ")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                to={ADMIN_ROUTES.vault}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-bold transition hover:border-brand"
              >
                <KeyRound className="size-3.5" aria-hidden />
                مفاتيح المزوّدين في إعدادات Vercel
              </Link>
              <Link
                to={ADMIN_ROUTES.plans}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-bold transition hover:border-brand"
              >
                <Sparkles className="size-3.5" aria-hidden />
                ميزة ai_report في الباقات
              </Link>
            </div>
            {status?.canManage && <div className="mt-4 grid gap-3">
              {(["google", "grok", "mistral", "openrouter"] as const).map((id) => {
                const providerStatus = status?.providers?.find((provider) => provider.id === id);
                const configured = providerStatus?.configured;
                return <fieldset key={id} className="rounded-[10px] border border-line p-3">
                  <legend className="px-1 text-xs font-black">{providerLabels[id]}</legend>
                  <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={settings.providers[id].enabled} onChange={(event) => updateProvider(id, { enabled: event.target.checked })} /> متاح للاستخدام</label>
                    <label className="flex items-center gap-2">الأولوية / الترتيب
                      <input className="w-16 rounded border border-line bg-canvas px-2 py-1" type="number" min="1" max="99" value={settings.providers[id].priority} onChange={(event) => updateProvider(id, { priority: Number(event.target.value) })} />
                    </label>
                    <span className={providerStatus?.connection === "connected" ? "text-brand" : "text-warning"}>{providerStatus?.connection === "connected" ? "الاتصال متاح" : configured ? "المفتاح موجود · تعذّر الاتصال" : "المفتاح غير موجود"}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(["default", "report", "design", "selection", "image"] as const).map((task) => <label key={task} className="grid gap-1 text-[10px] font-bold text-muted">نموذج {taskLabels[task]}<input dir="ltr" className="rounded border border-line bg-canvas px-2 py-1.5 text-xs text-ink" value={settings.providers[id].models[task]} onChange={(event) => updateProvider(id, { models: { ...settings.providers[id].models, [task]: event.target.value } })} /></label>)}
                  </div>
                </fieldset>;
              })}
            </div>}
            {status?.canManage && <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand px-3 text-[11px] font-bold text-white disabled:opacity-50"><Save className="size-3.5" aria-hidden />{saving ? "جارٍ الحفظ…" : "حفظ إعدادات المزوّدين"}</button>
              <span role="status" className="text-xs text-muted">{saved}</span>
            </div>}
          </section>

          <AdminStudioKnowledgeBase />
        </div>
      </AdminGate>
    </AdminSection>
  );
}
