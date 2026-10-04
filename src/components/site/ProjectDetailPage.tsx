/*
 * Project detail — `/projects/<projectId>`.
 *
 * A project used to be a card with one action; now it is a page of its own:
 * its preview, its facts (pages, organisation, size, last edit), and the
 * commands that belong to it — open in the editor, rename, duplicate,
 * favourite, export the project file, delete.
 *
 * Both actions and URL are honest: nothing here opens the editor silently, and
 * the editor opens AT this project (`/editor/<id>`), so a refresh returns the
 * author to the same document.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Copy,
  FileDown,
  FolderOpen,
  LayoutGrid,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { getProject } from "@/lib/editor/storage";
import { THEMES, pageSize, type Page } from "@/lib/editor/model";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { PROJECTS_ROUTE, editorPathFor } from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const projects = useEditor((s) => s.projects);
  const renameProject = useEditor((s) => s.renameProject);
  const duplicateProject = useEditor((s) => s.duplicateProject);
  const deleteProject = useEditor((s) => s.deleteProject);
  const toggleProjectFavorite = useEditor((s) => s.toggleProjectFavorite);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const meta = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getProject(projectId)
      .then((full) => {
        if (!alive) return;
        setPage(full && full.pages?.length ? full.pages[0] : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const openInEditor = useCallback(() => {
    window.location.assign(editorPathFor(projectId));
  }, [projectId]);

  const exportJson = async () => {
    setBusy(true);
    try {
      const full = await getProject(projectId);
      if (!full) {
        toast.error("تعذر فتح المشروع");
        return;
      }
      const { exportJson: writeJson, safeFileName } = await import("@/lib/editor/export");
      if (!writeJson({ ...full, updatedAt: Date.now() })) return;
      toast.success(`تم تنزيل ${safeFileName(full.name)}.json`);
    } catch {
      toast.error("تعذر تصدير المشروع");
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      await duplicateProject(projectId);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteProject(projectId);
      toast.success("تم حذف المشروع");
      window.location.assign(PROJECTS_ROUTE);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  if (!meta && !loading) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/projects" />
        <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <div className="rounded-full bg-line-2 p-6">
            <LayoutGrid className="size-10 text-muted" aria-hidden />
          </div>
          <h1 className="mt-6 text-2xl font-black text-ink">المشروع غير موجود</h1>
          <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
            قد يكون المشروع محذوفًا، أو ينتمي إلى حساب آخر على هذا المتصفح.
          </p>
          <Link
            to={PROJECTS_ROUTE}
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-bold text-on-brand"
          >
            <ArrowRight className="size-4" aria-hidden />
            العودة إلى المشاريع
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const theme = meta ? THEMES[meta.theme] ?? THEMES.official : THEMES.official;
  const size = page ? pageSize(page) : null;

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/projects" />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        {/* Breadcrumb — the page says where it sits in the product. */}
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Link to={PROJECTS_ROUTE} className="font-bold hover:text-brand-hover">
            المشاريع
          </Link>
          <span aria-hidden>/</span>
          <span className="font-bold text-ink">{meta?.name ?? "…"}</span>
        </nav>

        <div className="mt-4 grid gap-7 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* Real page preview, painted from the stored document. */}
          <aside className="grid content-start gap-3">
            <div className="grid place-items-center rounded-2xl border border-line bg-surface-2 p-4 shadow-card">
              {loading ? (
                <div className="aspect-[210/297] w-full animate-pulse rounded-lg bg-line-2" />
              ) : page ? (
                <div
                  className="w-full"
                  style={{
                    maxWidth: size && size.w > size.h ? "100%" : "78%",
                  }}
                >
                  <TemplatePreview
                    page={page}
                    className="rounded-[3px] border border-line shadow-lg"
                  />
                </div>
              ) : (
                <p className="py-16 text-[12px] text-muted">لا تتوفر معاينة لهذا المستند.</p>
              )}
            </div>
            {meta?.favorite && (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gold">
                <Star className="size-3.5 fill-current" aria-hidden /> في المفضلة
              </p>
            )}
          </aside>

          <section className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · PROJECT
            </p>
            {renaming ? (
              <RenameForm
                initial={meta?.name ?? ""}
                onSubmit={async (name) => {
                  await renameProject(projectId, name);
                  setRenaming(false);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <h1 className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[27px] font-extrabold text-ink">
                {meta?.name ?? "جارٍ التحميل…"}
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  aria-label="تغيير اسم المشروع"
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:border-brand hover:text-brand"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              </h1>
            )}
            {meta?.orgName && (
              <p className="mt-1.5 text-[13px] font-bold text-muted">{meta.orgName}</p>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="الصفحات" value={meta ? String(meta.pages) : "—"} />
              <Fact
                label="المقاس"
                value={size ? `${Math.round(size.w)} × ${Math.round(size.h)} مم` : "—"}
                ltr
              />
              <Fact label="السمة" value={theme.name} />
              <Fact
                label="آخر تعديل"
                value={meta ? new Date(meta.updatedAt).toLocaleDateString("ar-SA") : "—"}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openInEditor}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"
              >
                <FolderOpen className="size-4" aria-hidden />
                فتح في المحرر
              </button>
              <button
                type="button"
                onClick={() => void duplicate()}
                disabled={busy}
                className={GHOST}
              >
                <Copy className="size-4" aria-hidden /> تكرار
              </button>
              <button
                type="button"
                onClick={() => void exportJson()}
                disabled={busy}
                className={GHOST}
              >
                <FileDown className="size-4" aria-hidden /> تصدير ملف المشروع
              </button>
              <button
                type="button"
                onClick={() => void toggleProjectFavorite(projectId)}
                className={GHOST}
                aria-pressed={Boolean(meta?.favorite)}
              >
                <Star
                  className={cn("size-4", meta?.favorite && "fill-current text-gold")}
                  aria-hidden
                />
                {meta?.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={cn(GHOST, "border-danger/40 text-error hover:border-danger")}
              >
                <Trash2 className="size-4" aria-hidden /> حذف
              </button>
            </div>

            <p className="mt-5 text-[12px] leading-6 text-muted">
              رابط هذه الصفحة ثابت:{" "}
              <code dir="ltr" className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] font-bold">
                {PROJECTS_ROUTE}/{projectId}
              </code>{" "}
              — ويفتح المحرر المستند نفسه عبر{" "}
              <code dir="ltr" className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] font-bold">
                {editorPathFor(projectId)}
              </code>
              .
            </p>

            {confirmDelete && (
              <div
                role="alertdialog"
                aria-label="تأكيد حذف المشروع"
                className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-4"
              >
                <p className="text-[13px] font-extrabold text-error">
                  حذف «{meta?.name ?? "المشروع"}» نهائيًا؟
                </p>
                <p className="mt-1.5 text-[12px] leading-6 text-muted">
                  يُزال المشروع من مكتبتك ولا يمكن التراجع. القوالب لا تتأثر.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={busy}
                    className="inline-flex h-9 items-center rounded-lg bg-danger px-3 text-[12px] font-extrabold text-white disabled:opacity-50"
                  >
                    حذف نهائي
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className={GHOST}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            <p className="mt-6 text-[11px] text-muted">
              الصلاحيات الحالية:{" "}
              {entitlements.unlimited_pages ? "صفحات غير محدودة" : "حتى 3 صفحات لكل مشروع"} ·{" "}
              {entitlements.unlimited_projects ? "مشاريع غير محدودة" : "مشروع واحد في العرض"}
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

const GHOST =
  "inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-bold text-ink transition hover:border-brand disabled:opacity-50";

function Fact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-[10px] font-bold text-muted">{label}</p>
      <p
        className="mt-1 text-[14px] font-extrabold tabular-nums text-ink"
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function RenameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = name.trim();
        if (!value) return;
        void onSubmit(value);
      }}
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="اسم المشروع"
        maxLength={120}
        autoFocus
        className="h-11 min-w-[240px] flex-1 rounded-[10px] border border-line bg-surface px-3 text-[15px] font-extrabold text-ink outline-none focus:border-brand"
      />
      <button
        type="submit"
        className="inline-flex h-11 items-center rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand"
      >
        حفظ
      </button>
      <button type="button" onClick={onCancel} className={GHOST}>
        إلغاء
      </button>
    </form>
  );
}
