/**
 * Template import inside the owner dashboard.
 *
 * PSD, DOCX, PPTX, PDF and images are authorised on the server, then converted
 * in the browser into real NASAQ elements. The owner can open the document,
 * save it, or keep it as a draft template.
 */

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  FolderOpen,
  Loader2,
  Type,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { adminUpsertTemplateFn } from "@/lib/admin/functions";
import { authorizeTemplateImportFn } from "@/lib/psd/functions";
import { syncStorageOwner } from "@/lib/auth/storage-owner-sync";
import type { CanvasEl, Project } from "@/lib/editor/model";
import {
  getSetting,
  listAssets,
  saveAsset,
  saveProject,
  setSetting,
  type AssetFolder,
} from "@/lib/editor/storage";
import { editorPathFor } from "@/lib/site-routes";
import type { AssetDecision, AssetDisposition, PsdImportResult } from "@/lib/editor/psd/pipeline";
import { classifyImport } from "@/lib/editor/import/detect";
import type { BuiltImport, ImportKind } from "@/lib/editor/import/shared";
import { repairBreakdown, repairProject, type RepairCounts, type RepairFix } from "@/lib/editor/import/repair";
import { magicHexOf } from "@/lib/editor/psd/security";
import { generateTemplateName, resolveTemplateName } from "@/lib/templates/naming";
import { rememberUploadedFont } from "@/lib/nsq/fonts";
import { cn, uid } from "@/lib/utils";

const btn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";
const ghost =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12px] font-extrabold transition hover:border-brand/40 disabled:opacity-50";

const ACCEPT = ".psd,.psb,.docx,.pptx,.pdf,.png,.jpg,.jpeg,.svg";
const FORMAT_CHIPS: { id: "all" | ImportKind; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "psd", label: "PSD" },
  { id: "docx", label: "DOCX" },
  { id: "pptx", label: "PPTX" },
  { id: "pdf", label: "PDF" },
  { id: "png", label: "PNG" },
  { id: "jpg", label: "JPG" },
  { id: "svg", label: "SVG" },
];

type Phase = "idle" | "working" | "ready";

function flatten(els: CanvasEl[], depth = 0, dx = 0, dy = 0): { el: CanvasEl; depth: number; x: number; y: number }[] {
  const out: { el: CanvasEl; depth: number; x: number; y: number }[] = [];
  for (const el of els) {
    const x = el.x + dx;
    const y = el.y + dy;
    out.push({ el, depth, x, y });
    if (el.children?.length) out.push(...flatten(el.children, depth + 1, x, y));
  }
  return out;
}

function ResultPreview({ project, composite }: { project: Project; composite?: string }) {
  const page = project.pages[0];
  if (!page?.w || !page.h) return null;
  const paint = (els: CanvasEl[], ox: number, oy: number) =>
    els.map((el) => {
      const x = ((el.x + ox) / page.w!) * 100;
      const y = ((el.y + oy) / page.h!) * 100;
      const w = (el.w / page.w!) * 100;
      const h = (el.h / page.h!) * 100;
      return (
        <div key={el.id}>
          <div
            className="absolute overflow-hidden"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: `${w}%`,
              height: `${h}%`,
              opacity: el.hidden ? 0.35 : el.opacity,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              background: el.type === "shape" ? el.style.fill : undefined,
              borderRadius: el.style.shape === "circle" ? "999px" : undefined,
              mixBlendMode: el.style.blendMode && el.style.blendMode !== "normal" ? el.style.blendMode : undefined,
              boxShadow: el.style.shadow,
              zIndex: el.z,
            }}
          >
            {el.type === "image" && el.src && (
              <img alt="" src={el.src} className="h-full w-full object-fill" />
            )}
            {el.type === "text" && (
              <div
                className="h-full w-full whitespace-pre-wrap leading-tight"
                style={{
                  color: el.style.color,
                  textAlign: el.style.textAlign,
                  fontWeight: el.style.fontWeight,
                  fontFamily: `"${el.style.fontFamily || "Tajawal"}", sans-serif`,
                  fontSize: `${((el.style.fontSize || 16) * 0.3528 * 100) / page.w!}cqw`,
                  direction: el.style.direction === "ltr" ? "ltr" : "rtl",
                }}
              >
                {el.content}
              </div>
            )}
          </div>
          {el.children?.length ? paint(el.children, el.x + ox, el.y + oy) : null}
        </div>
      );
    });
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <figure className="rounded-xl border border-line bg-surface-2 p-3">
        <figcaption className="mb-2 text-[11px] font-extrabold text-muted">المرجع البصري</figcaption>
        {composite ? (
          <img alt="معاينة ملف PSD" src={composite} className="w-full bg-white shadow-sm" />
        ) : (
          <p className="grid h-40 place-items-center text-[12px] font-bold text-muted">المعاينة المسطحة غير متاحة لهذا الحجم — العناصر أدناه هي نتيجة التحويل.</p>
        )}
      </figure>
      <figure className="rounded-xl border border-line bg-surface-2 p-3">
        <figcaption className="mb-2 text-[11px] font-extrabold text-muted">عناصر نَسَق</figcaption>
        <div className="relative w-full bg-white shadow-sm" style={{ aspectRatio: `${page.w} / ${page.h}`, containerType: "inline-size" }}>
          {paint(page.elements, 0, 0)}
        </div>
      </figure>
    </div>
  );
}

export function PsdImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ stage: "", percent: 0, detail: "" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PsdImportResult | null>(null);
  const [office, setOffice] = useState<BuiltImport | null>(null);
  const [formatFilter, setFormatFilter] = useState<(typeof FORMAT_CHIPS)[number]["id"]>("all");
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [library, setLibrary] = useState<{ id: string; name: string; src: string }[]>([]);
  const [folderId, setFolderId] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [title, setTitle] = useState("");
  const [titleIsManual, setTitleIsManual] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AssetDisposition>>({});
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"editor" | "document" | "template" | "repair" | null>(null);
  const [repair, setRepair] = useState<{ counts: RepairCounts; fixes: RepairFix[] } | null>(null);
  const [repairedProject, setRepairedProject] = useState<Project | null>(null);

  const take = (next: File | null) => {
    setError(null);
    setResult(null);
    setOffice(null);
    setPhase("idle");
    setFonts({});
    setRepair(null);
    setRepairedProject(null);
    setTitle("");
    setTitleIsManual(false);
    if (!next) {
      setFile(null);
      return;
    }
    const name = next.name.toLowerCase();
    if (!/\.(psd|psb|docx|pptx|xlsx|pdf|png|jpe?g|svg)$/i.test(name)) {
      setError("صيغة غير مدعومة. المقبول: PSD وDOCX وPPTX وXLSX وPDF وPNG وJPG وSVG.");
      setFile(null);
      return;
    }
    if (formatFilter !== "all") {
      const kind = name.endsWith(".psb") ? "psd" : name.endsWith(".jpeg") ? "jpg" : name.split(".").pop();
      if (kind !== formatFilter) {
        setError(`الملف ليس ${formatFilter.toUpperCase()}.`);
        setFile(null);
        return;
      }
    }
    setFile(next);
  };

  const convert = async () => {
    if (!file) return;
    setPhase("working");
    setError(null);
    setResult(null);
    setOffice(null);
    setRepair(null);
    setRepairedProject(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const classified = classifyImport(file.name, bytes);
      if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
      setProgress({ stage: "التحقق من صلاحية المالك", percent: 2, detail: "" });
      const gate = await authorizeTemplateImportFn({
        data: {
          fileName: file.name,
          byteLength: bytes.byteLength,
          magicHex: magicHexOf(bytes),
          format: classified.format,
        },
      });
      if (!gate.ok) throw new Error(gate.error);
      await syncStorageOwner();
      if (classified.format === "psd" || classified.format === "psb") {
        const [assets, storedFolders] = await Promise.all([
          listAssets(),
          getSetting<AssetFolder[]>("assetFolders"),
        ]);
        const folderList = Array.isArray(storedFolders) ? storedFolders : [];
        setFolders(folderList);
        setLibrary(assets.map((asset) => ({ id: asset.id, name: asset.name, src: asset.src })));
        const { fingerprintAssets } = await import("@/lib/editor/psd/pipeline");
        const { runPsdImport } = await import("@/lib/editor/psd/run");
        const prints = await fingerprintAssets(assets, (stage, percent, detail) => {
          setProgress({ stage, percent, detail: detail || "" });
        });
        const imported = await runPsdImport(bytes, gate.fileName, prints, (stage, percent, detail) => {
          setProgress({ stage, percent, detail: detail || "" });
        });
        const initial: Record<string, AssetDisposition> = {};
        for (const asset of imported.report.assets) initial[asset.hash] = "design";
        setDecisions(initial);
        setResult(imported);
        setTitle(generateTemplateName({
          title: imported.project.name,
          titleIsManual: false,
          sourceName: gate.fileName,
          format: classified.format,
          category: "psd",
          kind: "json",
          content: imported.project,
        }));
        setTitleIsManual(false);
      } else {
        const { importTemplateBytes } = await import("@/lib/editor/import/run");
        setProgress({ stage: "تحويل الملف", percent: 20, detail: classified.format.toUpperCase() });
        const imported = await importTemplateBytes(bytes, gate.fileName);
        setOffice(imported);
        setTitle(generateTemplateName({
          title: imported.project.name,
          titleIsManual: false,
          sourceName: gate.fileName,
          format: classified.format,
          category: classified.format === "pptx" ? "slides" : "import",
          kind: "json",
          content: imported.project,
        }));
        setTitleIsManual(false);
        setProgress({ stage: "اكتمل", percent: 100, detail: "" });
      }
      setPhase("ready");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "تعذر تحويل الملف");
    }
  };

  const prepared = useMemo(() => {
    if (!result) return null;
    return result.report.assets.map((asset) => ({
      hash: asset.hash,
      disposition: decisions[asset.hash] || "design",
      replaceAssetId: replacements[asset.hash],
      folderId: folderId || null,
    })) satisfies AssetDecision[];
  }, [result, decisions, replacements, folderId]);

  /** «إصلاح العناصر» — conservative geometry repair against the PSD's own bounds. */
  const repairNow = async () => {
    if (!result) return;
    setBusy("repair");
    try {
      const outcome = await repairProject(result.project, {
        pageSizes: result.report.pageSizesMm,
      });
      setRepair({ counts: outcome.counts, fixes: outcome.fixes });
      setRepairedProject(outcome.project);
      if (outcome.counts.total === 0) {
        toast.success("فحصنا المستند — لا يحتاج إلى أي إصلاح");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر تنفيذ الإصلاح");
    } finally {
      setBusy(null);
    }
  };

  const undoRepair = () => {
    setRepair(null);
    setRepairedProject(null);
    toast.success("أُلغي الإصلاح وعاد المستند إلى نسخته الأصلية");
  };

  const commitProject = async (): Promise<Project> => {
    if (office) {
      await syncStorageOwner();
      return {
        ...office.project,
        name: resolveTemplateName({
          title,
          titleIsManual,
          sourceName: file?.name,
          format: office.format,
          category: office.format === "pptx" ? "slides" : "import",
          kind: "json",
          content: office.project,
        }),
        thumbnail: office.previewDataUrl || office.project.thumbnail,
      };
    }
    if (!result || !prepared) throw new Error("لا توجد نتيجة تحويل");
    const { applyAssetDecisions } = await import("@/lib/editor/psd/pipeline");
    const src = new Map(library.map((asset) => [asset.id, asset.src]));
    const applied = applyAssetDecisions(repairedProject || result.project, result.report.assets, prepared, src);
    await syncStorageOwner();
    let targetFolder = folderId || null;
    if (!targetFolder && newFolder.trim() && applied.saves.length) {
      const created: AssetFolder = {
        id: uid("folder"),
        name: newFolder.trim().slice(0, 60),
        createdAt: Date.now(),
        parentId: null,
      };
      const next = [...folders, created];
      await setSetting("assetFolders", next);
      setFolders(next);
      targetFolder = created.id;
    }
    for (const save of applied.saves) {
      await saveAsset({
        name: save.name,
        src: save.src,
        w: save.w,
        h: save.h,
        folderId: targetFolder,
        contentHash: save.hash,
      });
    }
    const embedded = Object.entries(fonts).map(([family, dataUrl]) => {
      rememberUploadedFont(family, dataUrl);
      return { family, dataUrl };
    });
    return {
      ...applied.project,
      name: resolveTemplateName({
        title,
        titleIsManual,
        sourceName: file?.name,
        format: file?.name.split(".").pop() || "psd",
        category: "psd",
        kind: "json",
        content: applied.project,
      }),
      embeddedFonts: embedded.length ? embedded : applied.project.embeddedFonts,
    };
  };

  const openInEditor = async () => {
    setBusy("editor");
    try {
      const project = await commitProject();
      const saved = await saveProject(project);
      await setSetting("activeProjectId", saved.id || null);
      if (saved.id) window.location.assign(editorPathFor(saved.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر فتح المستند");
      setBusy(null);
    }
  };

  const saveDocument = async () => {
    setBusy("document");
    try {
      const project = await commitProject();
      await saveProject(project);
      toast.success("حُفظ المستند في المشاريع، ويمكن فتحه من المحرر لاحقًا.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المستند");
    } finally {
      setBusy(null);
    }
  };

  const adoptTemplate = async () => {
    setBusy("template");
    try {
      const project = await commitProject();
      const content = JSON.stringify(project);
      if (content.length > 4 * 1024 * 1024) {
        throw new Error("المستند أكبر من حد القالب (4 ميغابايت). افتحه في المحرر، أو أبقِ الصور داخل التصميم فقط.");
      }
      const thumb = office?.previewDataUrl || (result?.compositeDataUrl && result.compositeDataUrl.length < 1_800_000 ? result.compositeDataUrl : null);
      const partial = (office?.notes || [])
        .filter((note) => note.mode !== "editable")
        .slice(0, 2)
        .map((note) => note.reason)
        .join(" ");
      const description = office
        ? `محوّل من ${office.format.toUpperCase()} إلى عناصر نَسَق قابلة للتحرير. ${office.stats.texts} نص · ${office.stats.tables} جداول · ${office.stats.images} صور. ${partial}`.slice(0, 500)
        : "محوَّل من PSD إلى عناصر نَسَق قابلة للتحرير";
      const saved = await adminUpsertTemplateFn({
        data: {
          template: {
            title: project.name,
            titleIsManual,
            sourceName: file?.name || "",
            format: office?.format || file?.name.split(".").pop() || "psd",
            description,
            category: office?.format === "pptx" ? "slides" : office ? "import" : "psd",
            tier: "free",
            status: "draft",
            kind: "json",
            content,
            thumbnail: thumb && thumb.length < 1_800_000 ? thumb : null,
          },
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      toast.success("حُفظ كقالب مسودة. يمكن تعديله لاحقًا من إدارة القوالب أو فتحه في المحرر.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ القالب");
    } finally {
      setBusy(null);
    }
  };

  const report = result?.report;
  const layers = result ? flatten((repairedProject || result.project).pages[0]?.elements || []) : [];

  return (
    <section className="grid gap-5">
      <header>
        <h2 className="text-[20px] font-black">استيراد وتحويل القوالب</h2>
        <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-6 text-muted">
          الملفات المدعومة تُحوَّل إلى مستند نَسَق قابل للتحرير: نص، جداول، صور وأشكال حيث يسمح الملف. ليس مطابقة كاملة لـ Word أو PowerPoint، وما لا يُستخرج يُذكر في التقرير ولا يُخفى.
        </p>
        <ul className="mt-3 grid gap-1 text-[12px] font-semibold leading-5 text-muted">
          <li>PSD / PSB: طبقات النص والصور والتسلسل والموضع، مع تقرير لما يبقى صورة.</li>
          <li>DOCX: فقرات وعناوين وجداول بسيطة وصور وحجم الصفحة واتجاهها، بما في ذلك العربي المختلط. التنسيق المتقدم يبقى تقريبيًا.</li>
          <li>PPTX: كل شريحة صفحة، مع النص والصور والأشكال والموضع الأساسي.</li>
          <li>PDF: النص والصور المستخرجة عناصر قابلة للتحرير. الصفحة الممسوحة تبقى بحجمها وتُذكر كمحدودة.</li>
          <li>PNG / JPG / SVG: صفحة واحدة وعنصر صورة أو رسم قابل للتحرير، لا إعادة بناء طبقات.</li>
        </ul>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FORMAT_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setFormatFilter(chip.id)}
            className={cn(
              "h-8 rounded-full border px-3 text-[12px] font-extrabold",
              formatFilter === chip.id ? "border-brand bg-navy text-on-brand" : "border-line bg-surface text-muted",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div
        className="grid place-items-center rounded-xl border border-dashed border-brand/50 bg-surface px-4 py-6 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          take(event.dataTransfer.files?.[0] || null);
        }}
      >
        <FileUp className="mb-2 size-6 text-brand" />
        <p className="text-[14px] font-extrabold">أسقط الملف هنا</p>
        <p className="mt-1 text-[12px] font-semibold text-muted">PSD أو DOCX أو PPTX أو PDF أو صورة. الخدمة للمالك فقط.</p>
        <button type="button" className={cn(ghost, "mt-3")} onClick={() => inputRef.current?.click()}>
          اختيار ملف
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => take(event.target.files?.[0] || null)}
        />
        {file && (
          <p className="mt-3 text-[12px] font-bold">
            {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} ميغابايت
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] font-bold text-ink">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={!file || phase === "working"} onClick={() => void convert()}>
          {phase === "working" ? <Loader2 className="size-4 animate-spin" /> : null}
          تحويل إلى NASAQ
        </button>
      </div>

      {phase === "working" && (
        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 flex items-center justify-between text-[12px] font-extrabold">
            <span>{progress.stage || "جارٍ التحضير"}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-paper">
            <div className="h-full bg-navy transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          {progress.detail && <p className="mt-2 text-[11px] font-semibold text-muted">{progress.detail}</p>}
        </div>
      )}

      {office && (
        <section className="grid gap-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ["الصيغة", office.format.toUpperCase()],
              ["الصفحات", String(office.stats.pages)],
              ["المقاس", `${Math.round(office.project.pages[0]?.w || 0)}×${Math.round(office.project.pages[0]?.h || 0)} مم`],
              ["نص", String(office.stats.texts)],
              ["جداول", String(office.stats.tables)],
              ["صور", String(office.stats.images)],
              ["أشكال", String(office.stats.shapes)],
              ["قابل للتحرير", String(office.stats.editable)],
              ["تقريبي", String(office.stats.partial)],
              ["أُهمل", String(office.stats.skipped)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2">
                <dt className="text-[10px] font-bold text-muted">{label}</dt>
                <dd className="text-[14px] font-black">{value}</dd>
              </div>
            ))}
          </dl>
          <ResultPreview project={office.project} composite={office.previewDataUrl || undefined} />
          <ul className="grid max-h-64 gap-2 overflow-auto">
            {office.notes.map((note, index) => (
              <li key={`${note.name}-${index}`} className="rounded-lg bg-paper px-3 py-2 text-[12px] font-semibold">
                <span className="font-black">{note.name}</span>
                <span className="mx-1 text-muted">·</span>
                {note.mode === "editable" ? "قابل للتحرير" : note.mode === "flattened" ? "طبقة بصرية" : note.mode === "skipped" ? "أُهمل" : "جزئي"}
                <span className="mt-1 block text-[11px] text-muted">{note.reason}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-10 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] font-bold"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleIsManual(true);
              }}
              aria-label="اسم المشروع أو القالب"
            />
            <button type="button" className={btn} disabled={!!busy} onClick={() => void openInEditor()}>
              {busy === "editor" ? <Loader2 className="size-4 animate-spin" /> : null}
              فتح في المحرر
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => void saveDocument()}>
              {busy === "document" ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ كمستند
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => void adoptTemplate()}>
              {busy === "template" ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ كقالب
            </button>
          </div>
        </section>
      )}

      {report && result && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gold/50 bg-gold/[0.06] px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-black text-ink">
                <Wrench className="size-4 text-gold" aria-hidden />
                إصلاح العناصر
              </p>
              {repair ? (
                repair.counts.total > 0 ? (
                  <>
                    <p className="mt-1 text-[12px] font-extrabold text-success">
                      تم إصلاح {repair.counts.total} عنصرًا
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {repairBreakdown(repair.counts).map((row) => (
                        <li key={row.kind} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-extrabold text-ink">
                          <span className="tabular-nums">{row.count}</span> {row.label}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] font-extrabold text-success">المستند سليم — لم يحتج أي إصلاح</p>
                )
              ) : (
                <p className="mt-1 max-w-xl text-[12px] font-semibold leading-5 text-muted">
                  يفحص الناتج مقابل هندسة ملف PSD الأصلي وأبعاد الصفحة، ويصلح ما انحرف فقط — دون المساس بما هو سليم.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={busy === "repair"} onClick={() => void repairNow()}>
                {busy === "repair" ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" aria-hidden />}
                {repair ? "إعادة الإصلاح" : "إصلاح العناصر"}
              </button>
              {repair && repairedProject && (
                <button type="button" className={ghost} onClick={undoRepair}>
                  تراجع عن الإصلاح
                </button>
              )}
            </div>
          </section>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ["الأبعاد", `${report.widthPx}×${report.heightPx}px`],
              ["الصفحة", `${report.widthMm}×${report.heightMm} مم`],
              ["الطبقات", String(report.layerCount)],
              ["المجموعات", String(report.groupCount)],
              ["النصوص", String(report.textCount)],
              ["الصور", String(report.imageCount)],
              ["الأشكال", String(report.shapeCount)],
              ["اكتمال التحويل", `${report.completion}%`],
              ["في المكتبة", String(report.assets.filter((asset) => asset.match).length)],
              ["أصول جديدة", String(report.assets.filter((asset) => !asset.match).length)],
              ["يحتاج متابعة", String(report.fallbacks.length)],
              ["الدقة", `${Math.round(report.dpi)} dpi`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface px-3 py-2">
                <dt className="text-[10px] font-bold text-muted">{label}</dt>
                <dd className="text-[14px] font-black">{value}</dd>
              </div>
            ))}
          </dl>

          <ResultPreview project={repairedProject || result.project} composite={result.compositeDataUrl} />

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-line p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-black"><Type className="size-4" /> الخطوط</h3>
              <ul className="grid gap-2">
                {report.fonts.map((font) => (
                  <li key={font.fontName} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2">
                    <div>
                      <p className="text-[12px] font-extrabold">{font.family}</p>
                      <p className="text-[10px] font-semibold text-muted">{font.fontName}</p>
                    </div>
                    {font.status === "library" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-success"><CheckCircle2 className="size-3.5" /> من مكتبة نَسَق</span>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-extrabold text-warning">
                        <AlertTriangle className="size-3.5" />
                        {fonts[font.family] ? "تم إرفاق الخط" : "ارفع الخط"}
                        <input
                          type="file"
                          accept=".ttf,.otf,.woff,.woff2"
                          className="sr-only"
                          onChange={(event) => {
                            const picked = event.target.files?.[0];
                            if (!picked) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              const dataUrl = String(reader.result || "");
                              if (!dataUrl.startsWith("data:")) return;
                              setFonts((prev) => ({ ...prev, [font.family]: dataUrl }));
                            };
                            reader.readAsDataURL(picked);
                          }}
                        />
                      </label>
                    )}
                  </li>
                ))}
                {!report.fonts.length && <li className="text-[12px] text-muted">لا توجد طبقات نص.</li>}
              </ul>
            </section>

            <section className="rounded-xl border border-line p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-black"><AlertTriangle className="size-4" /> ما لم يُحوَّل بالكامل</h3>
              <ul className="grid max-h-64 gap-2 overflow-auto">
                {report.fallbacks.map((item, index) => (
                  <li key={`${item.layerId}-${index}`} className="rounded-lg bg-paper px-3 py-2 text-[12px] font-semibold">
                    <span className="font-black">{item.layerName}</span>
                    <span className="mx-1 text-muted">·</span>
                    {item.mode === "raster" ? "نسخة نقطية" : item.mode === "skipped" ? "أُهملت" : "جزئي"}
                    <span className="mt-1 block text-[11px] text-muted">{item.reason}</span>
                  </li>
                ))}
                {!report.fallbacks.length && <li className="text-[12px] font-semibold text-success">كل الطبقات المقروءة لها مقابل أصلي.</li>}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-line p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h3 className="flex items-center gap-2 text-[13px] font-black"><FolderOpen className="size-4" /> الأصول والمكتبة</h3>
              <div className="flex flex-wrap gap-2">
                <select className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  <option value="">مجلد المكتبة</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
                <input
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                  placeholder="أو مجلد جديد"
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                />
              </div>
            </div>
            <ul className="grid gap-2">
              {report.assets.map((asset) => (
                <li key={asset.hash} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <img alt="" src={asset.dataUrl} className="size-12 rounded bg-paper object-contain" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-extrabold">{asset.name}</p>
                    <p className="text-[10px] font-semibold text-muted">
                      {asset.match ? `موجود في المكتبة: ${asset.match.name}` : "أصل جديد"} · {asset.width}×{asset.height}
                    </p>
                  </div>
                  <select
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                    value={decisions[asset.hash] || "design"}
                    onChange={(event) => setDecisions((prev) => ({ ...prev, [asset.hash]: event.target.value as AssetDisposition }))}
                  >
                    <option value="design">داخل التصميم فقط</option>
                    <option value="library">أضفه إلى المكتبة</option>
                    <option value="replace">استبدله بعنصر من المكتبة</option>
                    <option value="independent">أصل مستقل داخل التصميم</option>
                  </select>
                  {decisions[asset.hash] === "replace" && (
                    <select
                      className="h-9 max-w-40 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                      value={replacements[asset.hash] || ""}
                      onChange={(event) => setReplacements((prev) => ({ ...prev, [asset.hash]: event.target.value }))}
                    >
                      <option value="">اختر عنصرًا</option>
                      {library.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
              {!report.assets.length && <li className="text-[12px] text-muted">لا توجد صور نقطية — الأشكال والنصوص عناصر أصلية.</li>}
            </ul>
          </section>

          <section className="rounded-xl border border-line p-4">
            <h3 className="mb-3 text-[13px] font-black">الطبقات الناتجة</h3>
            <ul className="max-h-72 overflow-auto">
              {layers.map(({ el, depth }) => (
                <li key={el.id} className="flex items-center justify-between gap-2 border-b border-line/70 py-1.5 text-[12px] font-semibold" style={{ paddingInlineStart: depth * 16 }}>
                  <span className={el.hidden ? "text-muted" : ""}>{el.name}</span>
                  <span className="text-[10px] font-bold text-muted">
                    {el.type}
                    {el.source?.fallback ? ` · ${el.source.fallback === "raster" ? "نقطي" : "جزئي"}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {result.validation.issues.length > 0 && (
              <ul className="mt-3 grid gap-1">
                {result.validation.issues.slice(0, 12).map((issue, index) => (
                  <li key={index} className={cn("text-[11px] font-bold", issue.severity === "error" ? "text-danger" : "text-muted")}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-10 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] font-bold"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleIsManual(true);
              }}
              aria-label="اسم المشروع أو القالب"
            />
            <button type="button" className={btn} disabled={!!busy} onClick={() => void openInEditor()}>
              {busy === "editor" ? <Loader2 className="size-4 animate-spin" /> : null}
              فتح في المحرر
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => void saveDocument()}>
              {busy === "document" ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ كمستند
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => void adoptTemplate()}>
              {busy === "template" ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ كقالب
            </button>
          </div>
        </>
      )}
    </section>
  );
}
