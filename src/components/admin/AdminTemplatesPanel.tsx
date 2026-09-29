/**
 * «إدارة القوالب» — the admin CRUD surface for the platform template catalog.
 * Extended for marketing share links: slug, public URL copy, publish/unpublish, disable URL via draft.
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
  BadgeCheck,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Unlock,
  Upload,
  Share2,
  X,
  Link2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminDeleteTemplateFn,
  adminListTemplatesFn,
  adminSetTemplateStatusFn,
  adminUpsertTemplateFn,
  adminRegenerateSlugFn,
} from "@/lib/admin/functions";
import type {
  AdminTemplateSummary,
  TemplateKind,
  TemplateStatus,
  TemplateTier,
} from "@/lib/admin/types";
import { getProject, listProjects } from "@/lib/editor/storage";
import { syncStorageOwner } from "@/lib/auth/storage-owner-sync";
import type { ProjectMeta } from "@/lib/editor/model";
import { cn } from "@/lib/utils";
import { publishedTemplatePath, templateDisplaySlug, publishedTemplateAbsoluteUrl } from "@/lib/templates/published";

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
  slug?: string | null;
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
  slug: "",
};

const input =
 "h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand focus:ring-1 focus:ring-brand/40";
const label = "grid gap-1.5 text-[12px] font-extrabold text-muted";
const primaryBtn =
 "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";
const ghostBtn =
 "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand disabled:opacity-50";

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
  /** Bulk selection — publishing or retiring many templates one by one is not a workflow. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
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

  useEffect(() => {
    void syncStorageOwner()
      .catch(() => undefined)
      .then(() => listProjects())
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
          slug: draft.slug?.trim() ? draft.slug.trim() : undefined,
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

  const toggleSelected = (id: string) =>
    setSelectedIds((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );

  /**
   * Apply the same change to every selected template.
   *
   * Failures are reported per template and never abort the run: a single
   * rejected item must not leave the batch half-applied with no explanation.
   */
  const runBulk = async (
    action: "publish" | "unpublish" | "delete",
    ids: string[],
  ) => {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const failed: string[] = [];
    for (const id of ids) {
      if (action === "delete") {
        const res = await adminDeleteTemplateFn({ data: { id } });
        if (res.ok) setItems((list) => list.filter((x) => x.id !== id));
        else failed.push(id);
      } else {
        const res = await adminSetTemplateStatusFn({
          data: { id, status: action === "publish" ? "published" : "draft" },
        });
        if (res.ok)
          setItems((list) =>
            list.map((t) =>
              t.id === id
                ? { ...t, status: action === "publish" ? "published" : "draft" }
                : t,
            ),
          );
        else failed.push(id);
      }
    }
    setBulkBusy(false);
    setSelectedIds(failed);
    if (failed.length) toast.error(`تعذر تنفيذ الإجراء على ${failed.length} قالب`);
    else
      toast.success(
        action === "delete"
          ? `تم حذف ${ids.length} قالب`
          : action === "publish"
            ? `تم نشر ${ids.length} قالب`
            : `تم إلغاء نشر ${ids.length} قالب`,
      );
  };

  const setStatus = async (id: string, patch: { status?: TemplateStatus; tier?: TemplateTier }) => {
    setBusyId(id);
    const res = await adminSetTemplateStatusFn({ data: { id, ...patch } });
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    setItems((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const regenSlug = async (id: string) => {
    setBusyId(id);
    const res = await adminRegenerateSlugFn({ data: { id } });
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`تم تحديث الرابط: ${res.slug}`);
    setItems((list) => list.map((t) => (t.id === id ? { ...t, slug: res.slug } : t)));
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
      return [t.title, t.description, t.category, t.id, t.slug || ""].join(" ").toLowerCase().includes(q);
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
            {counts.all} قالب · {counts.published} منشور · {counts.licensed} مرخّص. المنشور يظهر في صفحة القوالب، و«مرخّص» يُفتح عبر تحقق الترخيص على الخادم فقط. كل قالب منشور له رابط عام ثابت <span className="font-mono" dir="ltr">/templates/:slug</span>.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <Plus className="size-4" /> قالب جديد
        </button>
      </div>

      {draft && (
        <section className="grid gap-4 rounded-xl border border-brand bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-[13px] font-black">
              {draft.id ? `تعديل: ${draft.title || "قالب"}` : "قالب جديد"}
            </strong>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="grid size-8 place-items-center rounded-lg border border-line"
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
              رابط المشاركة (slug)
              <input
                className={input}
                dir="ltr"
                placeholder="مثال: annual-report-2025"
                value={draft.slug || ""}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
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
                  className="h-14 w-10 rounded border border-line bg-surface object-contain"
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
            placeholder="ابحث بعنوان القالب أو تصنيفه أو slug"
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
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
          {items.length === 0 ? "لا توجد قوالب مُدارة بعد." : "لا نتائج مطابقة للتصفية."}
        </p>
      ) : (
        <>
          {/*
           * Administrative bulk controls: select-all scoped to what the filters
           * currently show, then one action for the whole selection.
           */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 text-[11px]">
            <button
              type="button"
              className={ghostBtn}
              onClick={() =>
                setSelectedIds((list) =>
                  list.length === filtered.length ? [] : filtered.map((t) => t.id),
                )
              }
            >
              {selectedIds.length === filtered.length && filtered.length > 0
                ? "إلغاء تحديد الكل"
                : "تحديد كل النتائج"}
            </button>
            <span className="font-bold text-muted">
              المحدد: {selectedIds.length} من {filtered.length}
            </span>
            <div className="ms-auto flex flex-wrap gap-2">
              <button
                type="button"
                className={ghostBtn}
                disabled={!selectedIds.length || bulkBusy}
                onClick={() => void runBulk("publish", selectedIds)}
              >
                نشر المحدد
              </button>
              <button
                type="button"
                className={ghostBtn}
                disabled={!selectedIds.length || bulkBusy}
                onClick={() => void runBulk("unpublish", selectedIds)}
              >
                إلغاء نشر المحدد
              </button>
              <button
                type="button"
                className={cn(ghostBtn, "text-error")}
                disabled={!selectedIds.length || bulkBusy}
                onClick={() => {
                  if (
                    window.confirm(
                      `حذف ${selectedIds.length} قالب نهائيًا؟ لا يمكن التراجع.`,
                    )
                  )
                    void runBulk("delete", selectedIds);
                }}
              >
                حذف المحدد
              </button>
            </div>
          </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const displaySlug = templateDisplaySlug(t);
            const publicUrl = publishedTemplateAbsoluteUrl(displaySlug);
            return (
              <article
                key={t.id}
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={selectedIds.includes(t.id)}
                    onChange={() => toggleSelected(t.id)}
                    aria-label={`تحديد القالب ${t.title}`}
                  />
                  <div className="grid aspect-[210/297] w-16 shrink-0 place-items-center overflow-hidden rounded border border-line bg-surface">
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <LayoutTemplate className="size-5 text-muted" />
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
                      <span className="rounded bg-line-2 px-1.5 py-0.5">
                        {t.kind.toUpperCase()}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                          t.tier === "licensed"
                            ? "border border-gold/30 border-dashed bg-gold/15 text-ink"
                            : "border border-brand/25 bg-navy/10 text-brand",
                        )}
                      >
                        {t.tier === "licensed" ? <Lock className="size-2.5" /> : <BadgeCheck className="size-2.5" />}
                        {t.tier === "licensed" ? "مرخّص" : "مجاني"}
                      </span>
                      <span className="rounded bg-line-2 px-1.5 py-0.5">
                        {STATUS_LABEL[t.status]}
                      </span>
                      {t.slug && (
                        <span className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[9px]" dir="ltr">
                          /{t.slug}
                        </span>
                      )}
                    </div>
                    {t.status === "published" && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                        <Link2 className="size-3" />
                        <span className="truncate font-mono" dir="ltr">{publicUrl.replace("https://", "")}</span>
                      </div>
                    )}
                  </div>
                </div>
                {confirmId === t.id ? (
                  <div className="rounded-lg border border-danger/30 bg-danger/5 p-2.5 text-[11px]">
                    <p className="font-bold text-error">حذف «{t.title}» نهائيًا؟</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => void remove(t)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-3 font-extrabold text-on-brand disabled:opacity-60"
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
                        className="h-8 rounded-lg border border-line px-3 font-bold"
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
                    {t.status === "published" && (
                      <>
                        <button
                          type="button"
                          className={ghostBtn}
                          onClick={() => {
                            const url = new URL(publishedTemplatePath(displaySlug), window.location.origin).href;
                            void navigator.clipboard.writeText(url)
                              .then(() => toast.success("تم نسخ رابط القالب"))
                              .catch(() => toast.error("تعذر نسخ الرابط"));
                          }}
                          title="نسخ الرابط العام"
                        >
                          <Share2 className="size-3.5" /> نسخ الرابط
                        </button>
                        <a
                          href={publishedTemplatePath(displaySlug)}
                          target="_blank"
                          rel="noopener"
                          className={cn(ghostBtn, "inline-flex")}
                          title="فتح صفحة القالب العامة"
                        >
                          <Link2 className="size-3.5" /> فتح
                        </a>
                      </>
                    )}
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
                      title="إعادة توليد الرابط"
                      onClick={() => void regenSlug(t.id)}
                    >
                      <RefreshCw className="size-3.5" /> slug
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
                        setDraft({ ...EMPTY_DRAFT, ...t, content: "", fileName: "", thumbnail: t.thumbnail, slug: t.slug || "" })
                      }
                    >
                      <Pencil className="size-3.5" /> تعديل
                    </button>
                    <button
                      type="button"
                      className={cn(ghostBtn, "text-error")}
                      title="حذف"
                      onClick={() => setConfirmId(t.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        </>
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
            className="w-full max-w-lg rounded-[14px] border border-line bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-extrabold">{preview.item.title}</h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  {preview.item.category} · {preview.item.kind.toUpperCase()} · {STATUS_LABEL[preview.item.status]} ·{" "}
                  {preview.item.tier === "licensed" ? "مرخّص" : "مجاني"} · <span dir="ltr" className="font-mono">/{templateDisplaySlug(preview.item)}</span>
                </p>
                {preview.item.status === "published" && (
                  <p className="mt-1 text-[11px]">
                    <a href={publishedTemplatePath(templateDisplaySlug(preview.item))} target="_blank" rel="noopener" className="text-brand underline">
                      {publishedTemplateAbsoluteUrl(templateDisplaySlug(preview.item))}
                    </a>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="grid size-8 place-items-center rounded-lg border border-line"
                aria-label="إغلاق المعاينة"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid place-items-center rounded-xl border border-line bg-line-2/30 p-4">
              {preview.item.thumbnail ? (
                <img src={preview.item.thumbnail} alt="" className="max-h-[46vh] w-auto object-contain" />
              ) : (
                <div className="grid aspect-[210/297] w-40 place-items-center rounded border border-dashed border-line text-muted">
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
              المعاينة تعتمد على الصورة المصغرة المحفوظة مع القالب. رابط المشاركة ثابت ومقاوم للتصادم ويمكن تعطيله بإلغاء النشر.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminTemplatesPanel;
