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
  Send,
  Bookmark,
  Copy,
  X,
  Link2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminGetTemplateFn,
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
import {
  publishedTemplatePath,
  templateDisplaySlug,
  publishedTemplateAbsoluteUrl,
  shortPublishedTemplateAbsoluteUrl,
} from "@/lib/templates/published";
import { templateShortPathFor } from "@/lib/site-routes";
import { prepareTemplateThumbnail } from "@/lib/templates/thumbnail";
import { generateTemplateName } from "@/lib/templates/naming";
import { buildTemplateShareCopy, ensureTemplateShareUrl } from "@/lib/templates/sharing-copy";
import { invalidateAdminPublicContent } from "@/lib/admin/use-site-settings";

interface Draft {
  id?: string;
  title: string;
  description: string;
  category: string;
  tier: TemplateTier;
  status: TemplateStatus;
  kind: TemplateKind;
  content: string;
  contentChanged: boolean;
  fileName: string;
  titleIsManual: boolean;
  thumbnail: string | null;
  /**
   * The preview image differs from the stored one.
   *
   * Only a CHANGED image is sent: re-uploading the row's own (already stored)
   * data URL on every metadata edit doubled the payload for nothing and, past a
   * platform body limit, turned "rename a template" into a failed save.
   */
  thumbnailChanged: boolean;
  sortOrder: number;
  slug?: string | null;
  /** Short public address (`/t/<code>`), minted by the server on first save. */
  shortCode?: string | null;
}

interface ShareDraft {
  kind: "x" | "pinterest";
  templateTitle: string;
  category: string;
  url: string;
  mediaUrl: string;
  text: string;
  pinterestTitle: string;
  pinterestDescription: string;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  category: "general",
  tier: "free",
  status: "draft",
  kind: "json",
  content: "",
  contentChanged: false,
  fileName: "",
  titleIsManual: false,
  thumbnail: null,
  thumbnailChanged: false,
  sortOrder: 0,
  slug: "",
};

/** The server's storage budget for one template payload (`admin/functions.ts`). */
const MAX_TEMPLATE_PAYLOAD_BYTES = 24 * 1024 * 1024;

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
  const [shareDraft, setShareDraft] = useState<ShareDraft | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [localProjects, setLocalProjects] = useState<ProjectMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListTemplatesFn();
      if (res.ok) setItems(res.templates);
      else toast.error(res.error);
    } catch (error) {
      console.error("[admin] template list failed:", error);
      toast.error(
        (error instanceof Error ? error.message : "تعذّر قراءة قائمة القوالب").slice(0, 400),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const editTemplate = async (item: AdminTemplateSummary) => {
    setBusyId(item.id);
    try {
      const result = await adminGetTemplateFn({ data: { id: item.id } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft({
        ...EMPTY_DRAFT,
        ...result.template,
        content: result.template.content,
        contentChanged: false,
        fileName: "",
        titleIsManual: true,
        thumbnail: result.template.thumbnail,
        thumbnailChanged: false,
        slug: result.template.slug || "",
      });
    } catch (error) {
      console.error("[admin] open template failed:", error);
      toast.error(
        (error instanceof Error ? error.message : "تعذّر فتح القالب").slice(0, 400),
      );
    } finally {
      setBusyId(null);
    }
  };

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
          contentChanged: true,
          fileName: file.name,
          title: d?.titleIsManual ? d.title : "",
          titleIsManual: d?.titleIsManual ?? false,
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
      contentChanged: true,
      fileName: file.name,
      title: d?.titleIsManual ? d.title : "",
      titleIsManual: d?.titleIsManual ?? false,
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
      // Export only template content plus the reusable pack association; never
      // serialize the local project id, owner, or storage metadata.
      content: JSON.stringify({
        name: project.name,
        pages: project.pages,
        ...(project.pack ? { pack: project.pack } : {}),
      }),
      contentChanged: true,
      fileName: "",
      title: d?.titleIsManual ? d.title : "",
      titleIsManual: d?.titleIsManual ?? false,
    }));
    toast.success("تم تحميل المشروع في نموذج القالب");
  };

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.id && !draft.content) {
      toast.error("ارفع ملف JSON أو SVG، أو اختر مشروعًا محليًا");
      return;
    }
    /*
     * Pre-flight the payload against the SAME budget the server enforces, so an
     * oversized document is refused here with a usable message instead of dying
     * in the network layer as an anonymous failure.
     */
    if (draft.contentChanged) {
      const bytes = new TextEncoder().encode(draft.content).length;
      if (bytes > MAX_TEMPLATE_PAYLOAD_BYTES) {
        toast.error(
          `حجم المحتوى ${(bytes / 1048576).toFixed(1)} م.ب ويتجاوز الحد الأقصى ${
            MAX_TEMPLATE_PAYLOAD_BYTES / 1048576
          } م.ب — قلّل الصور المضمّنة داخل المستند ثم أعد الحفظ`,
          { duration: 9000 },
        );
        return;
      }
    }
    setSaving(true);
    try {
      const res = await adminUpsertTemplateFn({
        data: {
          template: {
            id: draft.id,
            slug: draft.slug?.trim() ? draft.slug.trim() : undefined,
            /* An untouched title is derived server-side from the file. */
            title: draft.titleIsManual ? draft.title : "",
            titleIsManual: draft.titleIsManual,
            sourceName: draft.fileName,
            format: draft.fileName.split(".").pop() || draft.kind,
            description: draft.description,
            category: draft.category,
            tier: draft.tier,
            status: draft.status,
            kind: draft.kind,
            content: draft.contentChanged ? draft.content : "",
            /*
             * `null` clears the image, a changed one replaces it, and an
             * untouched image is simply not sent — the server keeps the stored
             * bytes. Every case is now explicit, so "replace the picture" can
             * no longer be silently dropped.
             */
            thumbnail: draft.thumbnailChanged
              ? draft.thumbnail
              : draft.thumbnail && !draft.id
                ? draft.thumbnail
                : undefined,
            sortOrder: draft.sortOrder,
          },
        },
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 9000 });
        return;
      }
      toast.success(draft.id ? `تم تحديث «${res.title}»` : `تم إضافة «${res.title}»`);
      invalidateAdminPublicContent();
      setDraft(null);
      await load();
    } catch (error) {
      /*
       * A rejected server call is a FAILED SAVE and is reported as one — with
       * its reason. The draft stays open so the author's work is still there.
       */
      console.error("[admin] template save failed:", error);
      toast.error(
        (error instanceof Error ? error.message : "تعذّر حفظ القالب — أعد المحاولة").slice(
          0,
          400,
        ),
        { duration: 9000 },
      );
    } finally {
      setSaving(false);
    }
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
    if (failed.length < ids.length) invalidateAdminPublicContent();
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
    invalidateAdminPublicContent();
  };

  const regenSlug = async (id: string) => {
    setBusyId(id);
    const res = await adminRegenerateSlugFn({ data: { id } });
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    invalidateAdminPublicContent();
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
    invalidateAdminPublicContent();
    toast.success(`تم حذف «${t.title}»`);
  };

  const copyShortLink = async (template: AdminTemplateSummary) => {
    const url = shortPublishedTemplateAbsoluteUrl(template);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("تم نسخ رابط القالب المختصر");
    } catch {
      toast.error("تعذر نسخ الرابط المختصر");
    }
  };

  const prepareShare = async (item: AdminTemplateSummary, kind: ShareDraft["kind"]) => {
    setSharingId(item.id);
    try {
      const result = await adminGetTemplateFn({ data: { id: item.id } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const copy = buildTemplateShareCopy(result.template);
      setShareDraft({
        kind,
        templateTitle: result.template.title,
        category: copy.category,
        url: copy.url,
        mediaUrl: copy.mediaUrl,
        text: copy.tweet,
        pinterestTitle: copy.pinterestTitle,
        pinterestDescription: copy.pinterestDescription,
      });
    } catch {
      toast.error("تعذر تجهيز محتوى المشاركة");
    } finally {
      setSharingId(null);
    }
  };

  const openXIntent = () => {
    if (!shareDraft || shareDraft.kind !== "x") return;
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", ensureTemplateShareUrl(shareDraft.text, shareDraft.url));
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
    setShareDraft(null);
  };

  const openPinterestIntent = () => {
    if (!shareDraft || shareDraft.kind !== "pinterest") return;
    const description = shareDraft.pinterestDescription.includes(shareDraft.url)
      ? shareDraft.pinterestDescription
      : `${shareDraft.pinterestDescription.trim()}\n${shareDraft.url}`;
    const intent = new URL("https://www.pinterest.com/pin/create/button/");
    intent.searchParams.set("url", shareDraft.url);
    intent.searchParams.set("media", shareDraft.mediaUrl);
    intent.searchParams.set("title", shareDraft.pinterestTitle);
    intent.searchParams.set("description", description);
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
    setShareDraft(null);
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
  const suggestedTitle = draft
    ? generateTemplateName({
        sourceName: draft.fileName,
        description: draft.description,
        category: draft.category,
        kind: draft.kind,
        format: draft.fileName.split(".").pop() || draft.kind,
        content: draft.content,
      })
    : "";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black">إدارة القوالب</h2>
          <p className="text-[12px] text-muted">
            {counts.all} قالب · {counts.published} منشور · {counts.licensed} مرخّص. المنشور يظهر في صفحة القوالب، و«مرخّص» يُفتح عبر تحقق الترخيص على الخادم فقط. كل قالب منشور له رابط عام ثابت <span className="font-mono" dir="ltr">/templates/:slug</span> ورابط مختصر للمشاركة <span className="font-mono" dir="ltr">/t/:code</span>.
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
                maxLength={120}
                value={draft.title}
                placeholder={suggestedTitle}
                onChange={(e) => setDraft({ ...draft, title: e.target.value, titleIsManual: true })}
              />
              {!draft.titleIsManual && (
                <span className="text-[10px] font-semibold text-muted">الاسم الافتراضي المقترح: {suggestedTitle}</span>
              )}
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
              {draft.shortCode ? (
                <span className="mt-1 block text-[11px] text-muted">
                  الرابط المختصر العام:{" "}
                  <span className="font-mono" dir="ltr">/t/{draft.shortCode}</span>{" "}
                  — ثابت لا يتغيّر
                </span>
              ) : null}
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
                  ? draft.contentChanged
                    ? "تم تعديل محتوى التصميم"
                    : "محتوى التصميم الحالي محمّل"
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
                try {
                  /*
                   * Any reasonable dimension is accepted: the upload is
                   * re-encoded to a bounded longest edge with the aspect ratio
                   * preserved, so a 6000px photo and a 200px preview both
                   * become a storable image instead of a size error.
                   */
                  const dataUrl = await prepareTemplateThumbnail(f);
                  setDraft((d) =>
                    d ? { ...d, thumbnail: dataUrl, thumbnailChanged: true } : d,
                  );
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "تعذّرت معالجة الصورة");
                }
              }}
            />
            <button type="button" className={ghostBtn} onClick={() => thumbRef.current?.click()}>
              صورة مصغرة
            </button>
            {draft.thumbnail && (
              <>
                <span className="grid h-14 w-16 place-items-center overflow-hidden rounded border border-line bg-surface p-0.5">
                  <img
                    src={draft.thumbnail}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                </span>
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() =>
                    setDraft((d) =>
                      d ? { ...d, thumbnail: null, thumbnailChanged: true } : d,
                    )
                  }
                >
                  إزالة الصورة
                </button>
              </>
            )}
          </div>

          <details className="rounded-lg border border-line bg-surface">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-extrabold">
              تحرير محتوى التصميم الأصلي (JSON / SVG)
            </summary>
            <div className="grid gap-2 border-t border-line p-3">
              <p className="text-[11px] leading-5 text-muted">
                هذا هو المستند الذي يفتحه المحرر. اتركه كما هو لتعديل البيانات فقط، أو استبدله بمشروع من مكتبة المشاريع بعد تحريره بصريًا في NASAQ.
              </p>
              <textarea
                aria-label="محتوى التصميم JSON أو SVG"
                dir="ltr"
                spellCheck={false}
                rows={12}
                value={draft.content}
                onChange={(event) =>
                  setDraft((current) => current
                    ? { ...current, content: event.target.value, contentChanged: true }
                    : current)
                }
                className="min-h-48 w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-5 text-ink outline-none focus:border-brand"
              />
            </div>
          </details>

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
            /*
             * The address worth handing out is the short one (`/t/<code>`)
             * minted for the row; the descriptive slug page stays the fallback
             * and the canonical page for «فتح» when there is no code yet.
             */
            const shortPath = t.shortCode ? templateShortPathFor(t.shortCode) : null;
            const publicUrl = shortPublishedTemplateAbsoluteUrl(t);
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
                          onClick={() => void copyShortLink(t)}
                          title="نسخ رابط القالب المختصر"
                        >
                          <Copy className="size-3.5" /> نسخ الرابط المختصر
                        </button>
                        <button
                          type="button"
                          disabled={sharingId === t.id}
                          className={ghostBtn}
                          onClick={() => void prepareShare(t, "x")}
                          title="مراجعة نص المنشور قبل فتح X"
                        >
                          {sharingId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                          مشاركة على X
                        </button>
                        <button
                          type="button"
                          disabled={sharingId === t.id}
                          className={ghostBtn}
                          onClick={() => void prepareShare(t, "pinterest")}
                          title="تجهيز عنوان ووصف وصورة القالب على Pinterest"
                        >
                          {sharingId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />}
                          مشاركة على Pinterest
                        </button>
                        <a
                          href={shortPath || publishedTemplatePath(displaySlug)}
                          target="_blank"
                          rel="noopener noreferrer"
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
                      disabled={busyId === t.id}
                      className={ghostBtn}
                      title="تعديل البيانات"
                      onClick={() => void editTemplate(t)}
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

      {shareDraft && (
        <div
          className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={shareDraft.kind === "x" ? "مراجعة منشور X" : "مراجعة محتوى Pinterest"}
          onClick={() => setShareDraft(null)}
        >
          <section
            className="grid max-h-[92vh] w-full max-w-xl gap-4 overflow-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-black">
                  {shareDraft.kind === "x" ? "مراجعة المنشور على X" : "محتوى القالب على Pinterest"}
                </h3>
                <p className="mt-1 text-[12px] text-muted">
                  {shareDraft.templateTitle} · {shareDraft.category}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareDraft(null)}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-line"
                aria-label="إغلاق المشاركة"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px]">
              <span className="font-bold text-muted">رابط القالب المختصر</span>
              <a href={shareDraft.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all font-mono text-brand underline" dir="ltr">
                {shareDraft.url}
              </a>
            </div>

            {shareDraft.kind === "x" ? (
              <label className={label}>
                نص جاهز للنشر — يمكنك مراجعته وتعديله
                <textarea
                  className="min-h-40 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold leading-6 text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand/40"
                  value={shareDraft.text}
                  onChange={(event) => setShareDraft({ ...shareDraft, text: event.target.value })}
                  dir="auto"
                />
                <span className="text-[10px] font-semibold text-muted">{shareDraft.text.length} حرفًا · يتضمن الرابط المختصر تلقائيًا</span>
              </label>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-[96px_1fr]">
                  <img src={shareDraft.mediaUrl} alt="معاينة القالب" className="h-28 w-24 rounded-lg border border-line bg-surface-2 object-contain" />
                  <label className={label}>
                    عنوان Pin
                    <input
                      className={input}
                      maxLength={100}
                      value={shareDraft.pinterestTitle}
                      onChange={(event) => setShareDraft({ ...shareDraft, pinterestTitle: event.target.value })}
                      dir="auto"
                    />
                  </label>
                </div>
                <label className={label}>
                  الوصف والمحتوى
                  <textarea
                    className="min-h-32 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold leading-6 text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand/40"
                    value={shareDraft.pinterestDescription}
                    onChange={(event) => setShareDraft({ ...shareDraft, pinterestDescription: event.target.value })}
                    dir="auto"
                  />
                  <span className="text-[10px] font-semibold text-muted">يتضمن الرابط المختصر للقالب في الوصف.</span>
                </label>
              </>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <button type="button" className={ghostBtn} onClick={() => setShareDraft(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className={ghostBtn}
                onClick={() => {
                  const value = shareDraft.kind === "x"
                    ? shareDraft.text
                    : `${shareDraft.pinterestTitle}\n${shareDraft.pinterestDescription}`;
                  void navigator.clipboard.writeText(value)
                    .then(() => toast.success("تم نسخ محتوى المشاركة"))
                    .catch(() => toast.error("تعذر نسخ محتوى المشاركة"));
                }}
              >
                <Copy className="size-3.5" /> نسخ المحتوى
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={shareDraft.kind === "x" ? !shareDraft.text.trim() : !shareDraft.pinterestTitle.trim()}
                onClick={shareDraft.kind === "x" ? openXIntent : openPinterestIntent}
              >
                {shareDraft.kind === "x" ? <Send className="size-3.5" /> : <Bookmark className="size-3.5" />}
                {shareDraft.kind === "x" ? "فتح X" : "فتح Pinterest"}
              </button>
            </div>
          </section>
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

            {/*
             * No aspect ratio asserted here: the card is a fixed-height stage
             * and the artwork keeps whatever proportions the owner uploaded.
             */}
            <div className="mt-4 grid h-64 place-items-center overflow-hidden rounded-xl border border-line bg-line-2/30 p-4">
              {preview.item.thumbnail ? (
                <img
                  src={preview.item.thumbnail}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="grid h-40 w-32 place-items-center rounded border border-dashed border-line text-muted">
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
