/**
 * «إدارة القوالب» — the admin CRUD surface for the platform template catalog.
 *
 * It is a real, end-to-end CRUD panel over the EXISTING persistence layer: the
 * `admin_templates` table (migrations/0002_admin_content.sql) through the
 * `@/lib/admin/functions` server functions. Nothing here keeps its own copy of
 * the data, invents a second catalog, or decides authorization: every call is
 * re-verified server-side against the owner/admin identity.
 *
 *   • عرض     — list with search + status/tier filters, payload summary, preview
 *   • إضافة   — upload a نَسَق project JSON or a sanitised SVG, or take a project
 *                straight from the browser's local project library
 *   • تعديل   — metadata, payload replacement, thumbnail, sort order, publish
 *   • حذف     — delete behind an inline confirmation
 *
 * The licensing tie-in is the `tier` column: `licensed` templates are unlocked
 * only through the existing server-side licence check when they are opened from
 * the public catalog (`getPublishedTemplateFn`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  LayoutTemplate,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminDeleteTemplateFn,
  adminListTemplatesFn,
  adminSetTemplateStatusFn,
  adminUpsertTemplateFn,
} from "@/lib/admin/functions";
import type {
  AdminTemplateSummary,
  TemplateKind,
  TemplateStatus,
  TemplateTier,
} from "@/lib/admin/types";
import { getProject, listProjects } from "@/lib/editor/storage";
import type { ProjectMeta } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

interface Draft {
  id?: string;
  title: string;
  description: string;
  category: string;
  tier: TemplateTier;
  status: TemplateStatus;
  kind: TemplateKind;
  content: string;
  fileName: string;
  thumbnail: string | null;
  sortOrder: number;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  category: "general",
  tier: "free",
  status: "draft",
  kind: "json",
  content: "",
  fileName: "",
  thumbnail: null,
  sortOrder: 0,
};

const input =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] font-semibold outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-white/10 dark:bg-white/5 dark:text-white";
const label = "grid gap-1.5 text-[12px] font-extrabold text-muted";
const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[13px] font-extrabold text-white transition hover:bg-emerald-500 disabled:opacity-50";
const ghostBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-emerald-500/50 disabled:opacity-50 dark:border-white/10";

const STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
};

function readFile(file: File, as: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    if (as === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/** Payload summary shown in the preview without loading the whole catalog. */
function payloadSummary(template: AdminTemplateSummary, content?: string) {
  const bytes = content ? content.length : null;
  const size =
    bytes === null
      ? null
      : bytes > 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} م.ب`
        : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  if (template.kind === "svg") return { lines: ["ملف SVG متجهي"], size };
  if (!content) return { lines: [], size: null };
  try {
    const parsed = JSON.parse(content) as { pages?: { elements?: unknown[]; name?: string }[] };
    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    const elements = pages.reduce(
      (sum, p) => sum + (Array.isArray(p.elements) ? p.elements.length : 0),
      0,
    );
    return {
      lines: [
        `${pages.length} صفحة · ${elements} عنصر`,
        pages.map((p) => p.name).filter(Boolean).slice(0, 4).join(" · "),
      ].filter(Boolean),
      size,
    };
  } catch {
    return { lines: ["تعذّر قراءة محتوى JSON"], size };
  }
}

export function AdminTemplatesPanel() {
  const [items, setItems] = useState<AdminTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "all">("all");
  const [tierFilter, setTierFilter] = useState<TemplateTier | "all">("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ item: AdminTemplateSummary; content: string } | null>(null);
  const [localProjects, setLocalProjects] = useState<ProjectMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminListTemplatesFn();
    if (res.ok) setItems(res.templates);
    else toast.error(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Local projects are only offered when the editor library actually has some. */
  useEffect(() => {
    void listProjects()
      .then(setLocalProjects)
      .catch(() => setLocalProjects([]));
  }, []);

  const onFile = async (file: File) => {
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    const isJson = /\.json$/i.test(file.name) || file.type === "application/json";
    if (!isSvg && !isJson) {
      toast.error("يُقبل ملف JSON (مشروع نَسَق) أو SVG فقط");
      return;
    }
    const content = await readFile(file, "text");
    if (isJson) {
      try {
        const parsed = JSON.parse(content) as { pages?: unknown[]; name?: string; thumbnail?: string };
        if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error();
        setDraft((d) => ({
          ...(d ?? EMPTY_DRAFT),
          kind: "json",
          content,
          fileName: file.name,
          title: d?.title || parsed.name || file.name.replace(/\.json$/i, ""),
          thumbnail:
            d?.thumbnail ||
            (typeof parsed.thumbnail === "string" && parsed.thumbnail.startsWith("data:image/")
              ? parsed.thumbnail
              : null),
        }));
      } catch {
        toast.error("ملف JSON لا يحتوي على صفحات مشروع صالحة");
      }
      return;
    }
    const thumb = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(content)))}`;
    setDraft((d) => ({
      ...(d ?? EMPTY_DRAFT),
      kind: "svg",
      content,
      fileName: file.name,
      title: d?.title || file.name.replace(/\.svg$/i, ""),
      thumbnail: d?.thumbnail || (thumb.length < 600_000 ? thumb : null),
    }));
  };

  /** إضافة من مكتبة المشاريع المحلية: build the payload from a stored project. */
  const fromLocalProject = async (projectId: string) => {
    if (!projectId) return;
    const project = await getProject(projectId);
    if (!project) {
      toast.error("تعذّر قراءة المشروع المحدد");
      return;
    }
    setDraft((d) => ({
      ...(d ?? EMPTY_DRAFT),
      kind: "json",
      content: JSON.stringify({ name: project.name, pages: project.pages }),
      fileName: `${project.name}.json`,
      title: d?.title || project.name,
    }));
    toast.success("تم تحميل المشروع في نموذج القالب");
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("العنوان مطلوب");
    if (!draft.id && !draft.content) return toast.error("ارفع ملف JSON أو SVG، أو اختر مشروعًا محليًا");
    setSaving(true);
    const res = await adminUpsertTemplateFn({
      data: {
        template: {
          id: draft.id,
          title: draft.title,
          description: draft.description,
          category: draft.category,
          tier: draft.tier,
          status: draft.status,
          kind: draft.kind,
          content: draft.content,
          thumbnail: draft.thumbnail,
          sortOrder: draft.sortOrder,
        },
      },
    });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(draft.id ? "تم تحديث القالب" : "تم إضافة القالب");
    setDraft(null);
    void load();
  };

  const setStatus = async (id: string, patch: { status?: TemplateStatus; tier?: TemplateTier }) => {
    setBusyId(id);
    const res = await adminSetTemplateStatusFn({ data: { id, ...patch } });
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    setItems((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const remove = async (t: AdminTemplateSummary) => {
    setBusyId(t.id);
    const res = await adminDeleteTemplateFn({ data: { id: t.id } });
    setBusyId(null);
    setConfirmId(null);
    if (!res.ok) return toast.error(res.error);
    setItems((list) => list.filter((x) => x.id !== t.id));
    toast.success(`تم حذف «${t.title}»`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (tierFilter !== "all" && t.tier !== tierFilter) return false;
      if (!q) return true;
      return [t.title, t.description, t.category, t.id].join(" ").toLowerCase().includes(q);
    });
  }, [items, query, statusFilter, tierFilter]);

  const counts = useMemo(
    () => ({
      all: items.length,
      published: items.filter((t) => t.status === "published").length,
      licensed: items.filter((t) => t.tier === "licensed").length,
    }),
    [items],
  );


  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black">إدارة القوالب</h2>
          <p className="text-[12px] text-muted">
            {counts.all} قالب · {counts.published} منشور · {counts.licensed} مرخّص. المنشور يظهر في
            صفحة القوالب، و«مرخّص» يُفتح عبر تحقق الترخيص على الخادم فقط.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <Plus className="size-4" /> قالب جديد
        </button>
      </div>

      {draft && (
        <section className="grid gap-4 rounded-xl border border-emerald-500/30 bg-white p-4 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-[13px] font-black">
              {draft.id ? `تعديل: ${draft.title || "قالب"}` : "قالب جديد"}
            </strong>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="grid size-8 place-items-center rounded-lg border border-line dark:border-white/10"
              aria-label="إغلاق النموذج"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className={label}>
              العنوان
              <input
                className={input}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className={label}>
              التصنيف
              <input
                className={input}
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </label>
            <label className={cn(label, "md:col-span-2")}>
              الوصف
              <input
                className={input}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className={label}>
              الإتاحة
              <select
                className={input}
                value={draft.tier}
                onChange={(e) => setDraft({ ...draft, tier: e.target.value as TemplateTier })}
              >
                <option value="free">مجاني</option>
                <option value="licensed">مرخّص (النسخة الكاملة)</option>
              </select>
            </label>
            <label className={label}>
              الحالة
              <select
                className={input}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as TemplateStatus })}
              >
                <option value="draft">مسودة</option>
                <option value="published">منشور</option>
                <option value="archived">مؤرشف</option>
              </select>
            </label>
            <label className={label}>
              ترتيب العرض
              <input
                type="number"
                className={input}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
              />
            </label>
            <label className={label}>
              من مكتبة المشاريع المحلية
              <select className={input} value="" onChange={(e) => void fromLocalProject(e.target.value)}>
                <option value="">{localProjects.length ? "اختر مشروعًا…" : "لا توجد مشاريع محلية"}</option>
                {localProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,.svg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <button type="button" className={ghostBtn} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> رفع JSON / SVG
            </button>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              {draft.kind === "svg" ? <FileCode2 className="size-3.5" /> : <FileJson className="size-3.5" />}
              {draft.fileName
                ? `${draft.fileName} · ${draft.kind.toUpperCase()}`
                : draft.id
                  ? "المحتوى الحالي محفوظ — ارفع ملفًا لاستبداله"
                  : "لم يُحدَّد محتوى بعد"}
            </span>
            <input
              ref={thumbRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 450_000) {
                  toast.error("الصورة المصغرة يجب ألا تتجاوز 450KB");
                  return;
                }
                const dataUrl = await readFile(f, "dataUrl");
                setDraft((d) => (d ? { ...d, thumbnail: dataUrl } : d));
              }}
            />
            <button type="button" className={ghostBtn} onClick={() => thumbRef.current?.click()}>
              صورة مصغرة
            </button>
            {draft.thumbnail && (
              <>
                <img
                  src={draft.thumbnail}
                  alt=""
                  className="h-14 w-10 rounded border border-line bg-white object-contain"
                />
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() => setDraft((d) => (d ? { ...d, thumbnail: null } : d))}
                >
                  إزالة الصورة
                </button>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ
            </button>
            <button type="button" className={ghostBtn} onClick={() => setDraft(null)}>
              إلغاء
            </button>
          </div>
        </section>
      )}


      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بعنوان القالب أو تصنيفه"
            className={cn(input, "pe-9")}
          />
        </label>
        <select
          className={cn(input, "w-auto")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TemplateStatus | "all")}
        >
          <option value="all">كل الحالات</option>
          <option value="published">منشور</option>
          <option value="draft">مسودة</option>
          <option value="archived">مؤرشف</option>
        </select>
        <select
          className={cn(input, "w-auto")}
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as TemplateTier | "all")}
        >
          <option value="all">كل الإتاحات</option>
          <option value="free">مجاني</option>
          <option value="licensed">مرخّص</option>
        </select>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="size-4 animate-spin" /> جارٍ تحميل القوالب…
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-[13px] text-muted dark:border-white/15">
          {items.length === 0 ? "لا توجد قوالب مُدارة بعد." : "لا نتائج مطابقة للتصفية."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <article
              key={t.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex gap-3">
                <div className="grid aspect-[210/297] w-16 shrink-0 place-items-center overflow-hidden rounded border border-line bg-white">
                  {t.thumbnail ? (
                    <img src={t.thumbnail} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <LayoutTemplate className="size-5 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[13px]">{t.title}</strong>
                  {t.description && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted">
                      {t.description}
                    </span>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-extrabold">
                    <span className="rounded bg-line-2 px-1.5 py-0.5 dark:bg-white/10">
                      {t.kind.toUpperCase()}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        t.tier === "licensed"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
                      )}
                    >
                      {t.tier === "licensed" ? "مرخّص" : "مجاني"}
                    </span>
                    <span className="rounded bg-line-2 px-1.5 py-0.5 dark:bg-white/10">
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                </div>
              </div>
              {confirmId === t.id ? (
                <div className="rounded-lg border border-danger/30 bg-danger/5 p-2.5 text-[11px]">
                  <p className="font-bold text-danger">حذف «{t.title}» نهائيًا؟</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => void remove(t)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-3 font-extrabold text-white disabled:opacity-60"
                    >
                      {busyId === t.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      تأكيد الحذف
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="h-8 rounded-lg border border-line px-3 font-bold dark:border-white/10"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={ghostBtn}
                    title="معاينة القالب"
                    onClick={() => setPreview({ item: t, content: "" })}
                  >
                    <Eye className="size-3.5" /> معاينة
                  </button>
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    className={ghostBtn}
                    title={t.status === "published" ? "إلغاء النشر" : "نشر"}
                    onClick={() =>
                      void setStatus(t.id, { status: t.status === "published" ? "draft" : "published" })
                    }
                  >
                    {t.status === "published" ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {t.status === "published" ? "إلغاء النشر" : "نشر"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    className={ghostBtn}
                    title={t.tier === "licensed" ? "جعله مجانيًا" : "جعله مرخّصًا"}
                    onClick={() => void setStatus(t.id, { tier: t.tier === "licensed" ? "free" : "licensed" })}
                  >
                    {t.tier === "licensed" ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                    {t.tier === "licensed" ? "إتاحة للجميع" : "جعله مرخّصًا"}
                  </button>
                  <button
                    type="button"
                    className={ghostBtn}
                    title="تعديل البيانات"
                    onClick={() =>
                      setDraft({ ...EMPTY_DRAFT, ...t, content: "", fileName: "", thumbnail: t.thumbnail })
                    }
                  >
                    <Pencil className="size-3.5" /> تعديل
                  </button>
                  <button
                    type="button"
                    className={cn(ghostBtn, "text-danger")}
                    title="حذف"
                    onClick={() => setConfirmId(t.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}


      {preview && (
        <div
          className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`معاينة ${preview.item.title}`}
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-lg rounded-[14px] border border-line bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#161c26]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-extrabold">{preview.item.title}</h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  {preview.item.category} · {preview.item.kind.toUpperCase()} ·{" "}
                  {STATUS_LABEL[preview.item.status]} ·{" "}
                  {preview.item.tier === "licensed" ? "مرخّص" : "مجاني"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="grid size-8 place-items-center rounded-lg border border-line dark:border-white/10"
                aria-label="إغلاق المعاينة"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid place-items-center rounded-xl border border-line bg-line-2/30 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              {preview.item.thumbnail ? (
                <img src={preview.item.thumbnail} alt="" className="max-h-[46vh] w-auto object-contain" />
              ) : (
                <div className="grid aspect-[210/297] w-40 place-items-center rounded border border-dashed border-line text-muted dark:border-white/15">
                  <LayoutTemplate className="size-6" />
                </div>
              )}
            </div>

            {preview.content && (
              <ul className="mt-3 grid gap-1 text-[12px] text-muted">
                {payloadSummary(preview.item, preview.content).lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-[11px] leading-5 text-muted">
              المعاينة تعتمد على الصورة المصغرة المحفوظة مع القالب. لفتح القالب فعليًا استخدمه من
              صفحة «القوالب» بعد نشره.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminTemplatesPanel;

