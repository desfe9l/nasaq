import { useMemo, useState } from "react";
import { toast } from "sonner";
import { saveProject, setSetting } from "@/lib/editor/storage";
import { uid } from "@/lib/utils";
import { saveCustomTemplate } from "@/lib/templates/custom-templates";
import {
  designDna,
  generateTemplate,
  improveReference,
  referenceAnalyses,
} from "@/lib/intelligence/pipeline";
import type { DesignStyle, PipelineResult } from "@/lib/intelligence/schema";
import { DESIGN_STYLES } from "@/lib/intelligence/schema";
import type { Project } from "@/lib/editor/model";
import { intelligenceNoteFn } from "@/lib/intelligence/functions";
import { rememberRun } from "@/lib/intelligence/store";

const LICENSED = {
  premium_templates: true,
  unlimited_projects: true,
  unlimited_pages: true,
};

const STYLE_LABEL: Record<DesignStyle, string> = {
  institutional: "مؤسسي",
  government: "حكومي",
  corporate: "شركات",
  executive: "تنفيذي",
  editorial: "تحريري",
  presentation: "عرض",
  report: "تقرير",
  infographic: "إنفوجرافيك",
  auction: "مزاد",
};

type Outcome = { result: PipelineResult; project: Project };

export function TemplateStudio() {
  const analyses = useMemo(() => referenceAnalyses(), []);
  const dna = useMemo(() => designDna(), []);
  const [selected, setSelected] = useState(analyses[0]?.id ?? "");
  const [style, setStyle] = useState<DesignStyle>("institutional");
  const [title, setTitle] = useState("تقرير الأداء الربعي");
  const [subtitle, setSubtitle] = useState("ملخص للجنة. لا تُخترع أرقام.");
  const [org, setOrg] = useState("");
  const [pages, setPages] = useState(6);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const analysis = analyses.find((item) => item.id === selected) ?? analyses[0];

  const openInEditor = async (
    project: Project,
    label: string,
    path: Outcome["result"]["path"],
    score: number,
  ) => {
    try {
      const saved = await saveProject({ ...project, id: project.id || uid("proj") });
      await setSetting("activeProjectId", saved.id);
      saveCustomTemplate(
        {
          title: label.slice(0, 80),
          desc: path === "improve" ? "نسخة مطورة من مرجع مقيس" : "قالب أصلي من لغة التصميم",
          category: "institutional",
          tags: ["intelligence"],
          pages: saved.pages,
        },
        LICENSED,
      );
      rememberRun({
        id: uid("run"),
        at: Date.now(),
        path,
        label,
        score,
        projectId: saved.id,
        referenceId: path === "improve" ? selected : undefined,
      });
      window.location.assign("/editor");
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر حفظ القالب";
      toast.error(message);
    }
  };

  const onGenerate = () => {
    setBusy(true);
    setNote("");
    try {
      const result = generateTemplate({
        title: title.trim() || "قالب جديد",
        subtitle,
        org,
        style,
        pages,
        kind: style === "presentation" ? "presentation" : style === "infographic" ? "infographic" : "report",
      });
      setOutcome({ result, project: result.project });
    } finally {
      setBusy(false);
    }
  };

  const onImprove = () => {
    if (!analysis) return;
    setBusy(true);
    setNote("");
    try {
      const result = improveReference(analysis.id);
      if (!result) {
        toast.error("تعذر العثور على المرجع");
        return;
      }
      setOutcome({ result, project: result.project });
    } finally {
      setBusy(false);
    }
  };

  const onNote = async () => {
    if (!outcome) return;
    try {
      const response = await intelligenceNoteFn({
        data: {
          score: outcome.result.critique.score,
          issues: outcome.result.critique.issues.map((item) => item.instruction),
        },
      });
      setNote(response.note || (response.ok ? "" : "لا توجد ملاحظة إضافية."));
    } catch {
      setNote("تعذرت ملاحظة النموذج. التقييم القياسي لم يتغير.");
    }
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-[15px] font-black">استوديو القوالب</h2>
        <p className="mt-1 text-[12px] leading-6 text-muted">
          مساران: تطوير مرجع مقيس، أو توليد قالب أصلي من لغة التصميم. المخرج مشروع قابل
          للتحرير في المحرر، لا صورة.
        </p>
        <p className="mt-2 text-[11px] text-muted">
          {dna.sourceCount} مرجعًا مقيسًا. الهامش {dna.grid.marginMm}مم. الاتجاه {dna.direction}.
          العرض {dna.typography.display}، المتن {dna.typography.body}.
        </p>
        <ul className="mt-3 grid gap-1 text-[11px] leading-5 text-ink">
          {dna.rules.slice(0, 4).map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="max-h-[480px] overflow-auto rounded-xl border border-line">
          {analyses.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`block w-full border-b border-line px-3 py-2 text-right text-[12px] ${
                item.id === analysis?.id ? "bg-navy/5 font-extrabold" : ""
              }`}
            >
              <span className="block truncate">{item.title}</span>
              <span className="text-[10px] text-muted">
                {item.document.pages} ص · {item.document.primary.w}×{item.document.primary.h}
              </span>
            </button>
          ))}
        </aside>

        {analysis && (
          <section className="grid gap-3">
            <div className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="size-4 rounded-sm" style={{ background: analysis.palette.field }} />
                <span className="size-4 rounded-sm" style={{ background: analysis.palette.accent }} />
                <span className="size-4 rounded-sm border border-line" style={{ background: analysis.palette.paper }} />
                <strong className="text-[13px]">{analysis.document.format}</strong>
                <span className="text-[11px] text-muted">{analysis.fidelity}</span>
              </div>
              <p className="mt-2 text-[12px] leading-6">{analysis.title}</p>
              <ul className="mt-2 grid gap-1 text-[11px] text-muted">
                {analysis.limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {analysis.extractedLines.length > 0 && (
                <p className="mt-2 text-[11px] leading-5 text-ink">
                  {analysis.extractedLines.slice(0, 3).join(" · ")}
                </p>
              )}
            </div>

            <div className="grid gap-2 rounded-xl border border-line p-4 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] font-bold">
                العنوان
                <input className="h-9 rounded-lg border border-line px-2 text-[12px]" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="grid gap-1 text-[11px] font-bold">
                الجهة
                <input className="h-9 rounded-lg border border-line px-2 text-[12px]" value={org} onChange={(event) => setOrg(event.target.value)} />
              </label>
              <label className="grid gap-1 text-[11px] font-bold sm:col-span-2">
                المقدمة
                <input className="h-9 rounded-lg border border-line px-2 text-[12px]" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
              </label>
              <label className="grid gap-1 text-[11px] font-bold">
                الأسلوب
                <select
                  className="h-9 rounded-lg border border-line px-2 text-[12px]"
                  value={style}
                  onChange={(event) => setStyle(event.target.value as DesignStyle)}
                >
                  {DESIGN_STYLES.map((item) => (
                    <option key={item} value={item}>
                      {STYLE_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold">
                الصفحات
                <input
                  className="h-9 rounded-lg border border-line px-2 text-[12px]"
                  type="number"
                  min={1}
                  max={12}
                  value={pages}
                  onChange={(event) => setPages(Number(event.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="button" className="h-9 rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand" disabled={busy} onClick={onGenerate}>
                  توليد أصلي
                </button>
                <button type="button" className="h-9 rounded-lg border border-line px-3 text-[12px] font-extrabold" disabled={busy} onClick={onImprove}>
                  تطوير هذا المرجع
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {outcome && (
        <section className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-black">
              {outcome.result.path === "improve" ? "نسخة مطورة" : "قالب أصلي"} · {outcome.result.critique.score}/100
            </h3>
            <div className="flex gap-2">
              <button type="button" className="h-8 rounded-lg border border-line px-2 text-[11px] font-bold" onClick={() => void onNote()}>
                ملاحظة إضافية
              </button>
              <button
                type="button"
                className="h-8 rounded-lg bg-navy px-2 text-[11px] font-extrabold text-on-brand"
                onClick={() => void openInEditor(outcome.project, outcome.result.label, outcome.result.path, outcome.result.critique.score)}
              >
                فتح في المحرر
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {outcome.result.stoppedBecause === "stable"
              ? "توقف التحسين لأن المشاكل العالية والمتوسطة زالت."
              : outcome.result.stoppedBecause === "no-safe-fix"
                ? "لا توجد تصحيحات آمنة إضافية دون تغيير المحتوى."
                : "بلغ حد جولتي التحسين."}
          </p>
          {outcome.result.verdict && (
            <ul className="mt-2 grid gap-1 text-[12px] leading-6">
              {outcome.result.verdict.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <ul className="mt-3 grid gap-2">
            {outcome.result.critique.issues.slice(0, 8).map((item) => (
              <li key={item.id} className="rounded-lg border border-line px-3 py-2 text-[12px]">
                <strong className="font-extrabold">{item.metric}</strong>
                <span className="mt-1 block text-muted">{item.instruction}</span>
              </li>
            ))}
            {outcome.result.critique.issues.length === 0 && (
              <li className="text-[12px] text-muted">لا مشاكل قياسية مفتوحة.</li>
            )}
          </ul>
          {note && <p className="mt-3 text-[12px] leading-6">{note}</p>}
        </section>
      )}
    </div>
  );
}
