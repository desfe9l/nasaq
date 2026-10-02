/**
 * PSD → NASAQ, inside the owner dashboard.
 *
 * The file is authorised on the server, then parsed off the UI thread into
 * real NASAQ elements. The owner reviews the match, chooses which images
 * join the existing library, and either opens the document in the editor or
 * saves it as a draft template.
 */

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  FolderOpen,
  Loader2,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { adminUpsertTemplateFn } from "@/lib/admin/functions";
import { psdAuthorizeImportFn } from "@/lib/psd/functions";
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
import type { AssetDecision, AssetDisposition, PsdImportResult } from "@/lib/editor/psd/pipeline";
import { magicHexOf } from "@/lib/editor/psd/security";
import { rememberUploadedFont } from "@/lib/nsq/fonts";
import { cn, uid } from "@/lib/utils";

const btn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";
const ghost =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12px] font-extrabold transition hover:border-brand/40 disabled:opacity-50";

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
      <figure className="rounded-xl border border-line bg-[#e7e2d8] p-3">
        <figcaption className="mb-2 text-[11px] font-extrabold text-muted">الأصل من PSD</figcaption>
        {composite ? (
          <img alt="معاينة ملف PSD" src={composite} className="w-full bg-white shadow-sm" />
        ) : (
          <p className="grid h-40 place-items-center text-[12px] font-bold text-muted">المعاينة المسطحة غير متاحة لهذا الحجم — العناصر أدناه هي نتيجة التحويل.</p>
        )}
      </figure>
      <figure className="rounded-xl border border-line bg-[#e7e2d8] p-3">
        <figcaption className="mb-2 text-[11px] font-extrabold text-muted">نتيجة نَسَق</figcaption>
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
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [library, setLibrary] = useState<{ id: string; name: string; src: string }[]>([]);
  const [folderId, setFolderId] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [title, setTitle] = useState("");
  const [decisions, setDecisions] = useState<Record<string, AssetDisposition>>({});
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"editor" | "template" | null>(null);

  const take = (next: File | null) => {
    setError(null);
    setResult(null);
    setPhase("idle");
    setFonts({});
    if (!next) {
      setFile(null);
      return;
    }
    const name = next.name.toLowerCase();
    if (!name.endsWith(".psd") && !name.endsWith(".psb")) {
      setError("يُقبل PSD أو PSB فقط.");
      setFile(null);
      return;
    }
    setFile(next);
    setTitle(next.name.replace(/\.ps[db]$/i, ""));
  };

  const convert = async () => {
    if (!file) return;
    setPhase("working");
    setError(null);
    setResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress({ stage: "التحقق من صلاحية المالك", percent: 2, detail: "" });
      const gate = await psdAuthorizeImportFn({
        data: { fileName: file.name, byteLength: bytes.byteLength, magicHex: magicHexOf(bytes) },
      });
      if (!gate.ok) throw new Error(gate.error);
      await syncStorageOwner();
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
      setTitle(imported.project.name);
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

  const commitProject = async (): Promise<Project> => {
    if (!result || !prepared) throw new Error("لا توجد نتيجة تحويل");
    const { applyAssetDecisions } = await import("@/lib/editor/psd/pipeline");
    const src = new Map(library.map((asset) => [asset.id, asset.src]));
    const applied = applyAssetDecisions(result.project, result.report.assets, prepared, src);
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
      name: title.trim() || applied.project.name,
      embeddedFonts: embedded.length ? embedded : applied.project.embeddedFonts,
    };
  };

  const openInEditor = async () => {
    setBusy("editor");
    try {
      const project = await commitProject();
      const saved = await saveProject(project);
      await setSetting("activeProjectId", saved.id || null);
      window.location.assign("/editor");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر فتح المستند");
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
      const thumb = result?.compositeDataUrl;
      const saved = await adminUpsertTemplateFn({
        data: {
          template: {
            title: project.name,
            description: "محوَّل من PSD إلى عناصر نَسَق قابلة للتحرير",
            category: "psd",
            tier: "free",
            status: "draft",
            kind: "json",
            content,
            thumbnail: thumb && thumb.length < 1_800_000 ? thumb : null,
          },
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      toast.success("اعتُمد كقالب مسودة في كتالوج المالك");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ القالب");
    } finally {
      setBusy(null);
    }
  };

  const report = result?.report;
  const layers = result ? flatten(result.project.pages[0]?.elements || []) : [];

  return (
    <section className="grid gap-5">
      <header>
        <h2 className="text-[20px] font-black">PSD → NASAQ</h2>
        <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-6 text-muted">
          يحوّل ملف Photoshop إلى مستند نَسَق بطبقات قابلة للتعديل: نص، صور، أشكال ومجموعات. ما لا يملك مقابلًا أصليًا يُذكر في التقرير ولا يُخفى.
        </p>
      </header>

      <div
        className="grid place-items-center rounded-2xl border border-dashed border-brand/50 bg-surface px-4 py-8 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          take(event.dataTransfer.files?.[0] || null);
        }}
      >
        <FileUp className="mb-2 size-7 text-brand" />
        <p className="text-[14px] font-extrabold">أسقط ملف PSD هنا</p>
        <p className="mt-1 text-[12px] font-semibold text-muted">أو اختره من جهازك. الخدمة للمالك فقط.</p>
        <button type="button" className={cn(ghost, "mt-4")} onClick={() => inputRef.current?.click()}>
          اختيار ملف
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".psd,.psb"
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
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] font-bold text-red-700">{error}</p>
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

      {report && result && (
        <>
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

          <ResultPreview project={result.project} composite={result.compositeDataUrl} />

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
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-extrabold text-amber-700">
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
                  <li key={index} className={cn("text-[11px] font-bold", issue.severity === "error" ? "text-red-700" : "text-muted")}>
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
              onChange={(event) => setTitle(event.target.value)}
              aria-label="اسم المشروع أو القالب"
            />
            <button type="button" className={btn} disabled={!!busy} onClick={() => void openInEditor()}>
              {busy === "editor" ? <Loader2 className="size-4 animate-spin" /> : null}
              فتح في المحرر
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => void adoptTemplate()}>
              {busy === "template" ? <Loader2 className="size-4 animate-spin" /> : null}
              اعتماد كقالب
            </button>
          </div>
        </>
      )}
    </section>
  );
}
