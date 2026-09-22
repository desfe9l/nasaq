/*
 * Catalog dialogs: quick view, create/edit template, and destructive confirm.
 *
 * They follow the editor's own modal conventions (fixed overlay on the shared
 * `--z-dialog` layer, `role="dialog"`, Escape to close, backdrop click to
 * dismiss) so the site and the editor feel like one product.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, FolderOpen, Maximize2, Minimize2, Pencil, Plus, Trash2, X } from "lucide-react";
import { THEMES, pageSize, type ProjectMeta, type ThemeId } from "@/lib/editor/model";
import { TEMPLATE_CATEGORIES, type TemplateCategoryId } from "@/lib/editor/templates";
import { cn } from "@/lib/utils";
import { CATALOG_PILLS, pagesLabel, type CatalogEntry } from "@/lib/templates/catalog";
import type { CatalogPillId } from "@/lib/templates/custom-templates";
import { TemplatePreview } from "./TemplatePreview";

const PILL_CHOICES = CATALOG_PILLS.filter((p) => p.id !== "all");

/* ── shared chrome ───────────────────────────────────────────────────────── */

function Modal({
  label,
  onClose,
  children,
  className,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/50 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "shadow-card dark:shadow-card-dark max-h-[92vh] w-full overflow-auto rounded-2xl border border-line bg-white p-5 outline-none dark:border-white/10 dark:bg-[#161c26]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4 border-b border-line pb-4 dark:border-white/10">
      <div>
        <h2 className="text-[18px] font-extrabold text-ink dark:text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-[12px] leading-6 text-muted">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="إغلاق"
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-line-2 hover:text-ink dark:border-white/10 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

const PRIMARY_BTN =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-[13px] font-extrabold text-white shadow-sm transition hover:bg-navy-2 disabled:opacity-50";
const GHOST_BTN =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13px] font-bold text-ink transition hover:bg-line-2 dark:border-white/10 dark:text-white dark:hover:bg-white/5";

/* ── quick view ──────────────────────────────────────────────────────────── */

export function QuickViewDialog({
  entry,
  themeId,
  onClose,
  onUse,
  onEdit,
  onDuplicate,
  onEditMeta,
  onDelete,
}: {
  entry: CatalogEntry;
  themeId: ThemeId;
  onClose: () => void;
  onUse: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onEditMeta: () => void;
  onDelete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const page = entry.pages[Math.min(index, entry.pages.length - 1)];
  const size = pageSize(page);

  return (
    <Modal
      label={`معاينة سريعة — ${entry.title}`}
      onClose={onClose}
      className="max-w-5xl"
    >
      <DialogHeader
        title={entry.title}
        subtitle={`${entry.kindLabel} · ${entry.categoryLabel} · ${pagesLabel(entry.pages.length)} · ${Math.round(size.w)} × ${Math.round(size.h)} مم`}
        onClose={onClose}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 pb-3">
            <h3 className="text-[13px] font-extrabold text-muted">
              الصفحة {index + 1} من {entry.pages.length}
            </h3>
            <button
              type="button"
              onClick={() => setFull((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-bold text-muted transition hover:bg-line-2 hover:text-ink dark:border-white/10 dark:hover:bg-white/5 dark:hover:text-white"
            >
              {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              {full ? "ملاءمة الصفحة" : "الحجم الكامل"}
            </button>
          </div>
          <div className="max-h-[58vh] overflow-auto rounded-xl bg-paper p-4 dark:bg-white/5">
            <div
              className="mx-auto"
              style={{ width: full ? `${size.w}mm` : `min(100%, ${Math.max(160, Math.round(580 * (size.w / size.h)))}px)` }}
            >
              <TemplatePreview page={page} className="rounded-md border border-line shadow-lg dark:border-white/10" />
            </div>
          </div>
          {entry.pages.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.pages.map((p, i) => {
                const thumb = pageSize(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-pressed={i === index}
                    title={p.name}
                    className={cn(
                      "w-20 rounded-lg border p-1 transition",
                      i === index
                        ? "border-navy ring-2 ring-navy/30 dark:border-gold-2"
                        : "border-line hover:border-navy-2 dark:border-white/10",
                    )}
                    style={{ aspectRatio: `${thumb.w} / ${thumb.h}` }}
                  >
                    <TemplatePreview page={p} className="rounded-[4px]" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="grid content-start gap-3">
          <div className="flex flex-wrap gap-1.5">
            {entry.badges.map((badge) => (
              <span
                key={badge.label}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10px] font-extrabold",
                  badge.tone === "custom"
                    ? "bg-navy/10 text-navy dark:bg-white/10 dark:text-gold-2"
                    : badge.tone === "new"
                      ? "bg-gold/25 text-green dark:bg-gold/20 dark:text-gold-2"
                      : "bg-line-2 text-muted dark:bg-white/10 dark:text-white/80",
                )}
              >
                {badge.label}
              </span>
            ))}
          </div>
          <p className="text-[13px] leading-7 text-muted">{entry.desc || "قالب جاهز من مكتبة نَسَق."}</p>
          <dl className="grid gap-1.5 text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">النوع</dt>
              <dd className="font-bold text-ink dark:text-white">{entry.kindLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">التصنيف</dt>
              <dd className="font-bold text-ink dark:text-white">{entry.categoryLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">الصفحات</dt>
              <dd className="font-bold text-ink dark:text-white">{pagesLabel(entry.pages.length)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">السمة</dt>
              <dd className="font-bold text-ink dark:text-white">{THEMES[themeId]?.name ?? "رسمي"}</dd>
            </div>
          </dl>
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-muted dark:border-white/10">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-1 grid gap-2 border-t border-line pt-4 dark:border-white/10">
            <button type="button" onClick={onUse} className={PRIMARY_BTN}>
              <Plus className="size-4" /> استخدام القالب
            </button>
            <button type="button" onClick={onEdit} className={GHOST_BTN}>
              <Pencil className="size-4" /> تعديل القالب
            </button>
            <button type="button" onClick={onDuplicate} className={GHOST_BTN}>
              <FileText className="size-4" /> تكرار
            </button>
            {entry.kind === "custom" && (
              <>
                <button type="button" onClick={onEditMeta} className={GHOST_BTN}>
                  <FolderOpen className="size-4" /> تعديل البيانات
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-danger/40 px-4 text-[13px] font-bold text-danger transition hover:bg-danger/10"
                >
                  <Trash2 className="size-4" /> حذف القالب
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

/* ── confirm ─────────────────────────────────────────────────────────────── */

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "حذف",
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal label={title} onClose={onClose} className="max-w-md">
      <h2 className="text-[17px] font-extrabold text-ink dark:text-white">{title}</h2>
      <p className="mt-2 text-[13px] leading-7 text-muted">{body}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          إلغاء
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-[13px] font-extrabold text-white transition hover:opacity-90"
        >
          <Trash2 className="size-4" /> {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ── create / edit metadata ──────────────────────────────────────────────── */

export type TemplateFormSource =
  | { kind: "entry"; entryId: string }
  | { kind: "project"; projectId: string }
  | { kind: "blank" };

export interface TemplateFormValues {
  title: string;
  desc: string;
  category: TemplateCategoryId;
  tags: string[];
  pills: CatalogPillId[];
  source: TemplateFormSource;
}

export function TemplateFormDialog({
  mode,
  initial,
  entries,
  projects,
  activeProjectId,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: Partial<TemplateFormValues>;
  /** Existing catalog entries that can serve as a baseline (create mode). */
  entries: CatalogEntry[];
  /** The author's projects — a template can be published from any of them. */
  projects: ProjectMeta[];
  /** The project open in the editor, preselected as the source document. */
  activeProjectId?: string;
  onClose: () => void;
  onSubmit: (values: TemplateFormValues) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [desc, setDesc] = useState(initial?.desc ?? "");
  const [category, setCategory] = useState<TemplateCategoryId>(initial?.category ?? "reports");
  const [tags, setTags] = useState((initial?.tags ?? []).join("، "));
  const [pills, setPills] = useState<CatalogPillId[]>(
    (initial?.pills ?? []).filter((p) => p !== "all" && p !== "custom"),
  );
  const [sourceKind, setSourceKind] = useState<"project" | "entry" | "blank">(
    initial?.source?.kind ?? (projects.length ? "project" : "blank"),
  );
  const [projectId, setProjectId] = useState(
    initial?.source?.kind === "project"
      ? initial.source.projectId
      : (projects.find((p) => p.id === activeProjectId)?.id ?? projects[0]?.id ?? ""),
  );
  const [entryId, setEntryId] = useState(
    initial?.source?.kind === "entry" ? initial.source.entryId : entries[0]?.id ?? "",
  );

  const tagsList = useMemo(
    () =>
      tags
        .split(/[،,]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
    [tags],
  );

  const canSubmit =
    title.trim().length > 0 &&
    (sourceKind !== "project" || Boolean(projectId)) &&
    (sourceKind !== "entry" || Boolean(entryId));

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      desc: desc.trim(),
      category,
      tags: tagsList,
      pills,
      source:
        sourceKind === "project"
          ? { kind: "project", projectId }
          : sourceKind === "entry"
            ? { kind: "entry", entryId }
            : { kind: "blank" },
    });
  };

  const field =
    "h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px] font-semibold text-ink outline-none transition focus:border-navy dark:border-white/10 dark:bg-white/5 dark:text-white";

  return (
    <Modal
      label={mode === "create" ? "إضافة قالب جديد" : "تعديل بيانات القالب"}
      onClose={onClose}
      className="max-w-2xl"
    >
      <DialogHeader
        title={mode === "create" ? "إضافة قالب جديد" : "تعديل بيانات القالب"}
        subtitle={
          mode === "create"
            ? "احفظ حالة مستندك أو قالبًا موجودًا كقالب مخصص يظهر فورًا في الكتالوج."
            : "الاسم والتصنيف والوسوم تظهر في الكتالوج والبحث."
        }
        onClose={onClose}
      />

      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-[12px] font-extrabold text-muted">اسم القالب</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: تقرير الأداء السنوي 2026"
            className={field}
            autoFocus
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[12px] font-extrabold text-muted">وصف مختصر</span>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            placeholder="ما الذي يميز هذا القالب؟"
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold leading-7 text-ink outline-none transition focus:border-navy dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[12px] font-extrabold text-muted">التصنيف</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as TemplateCategoryId)} className={field}>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-extrabold text-muted">وسوم (افصل بفاصلة)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="سنوي، أداء، ملخص" className={field} />
          </label>
        </div>

        <div className="grid gap-1.5">
          <span className="text-[12px] font-extrabold text-muted">فلاتر الكتالوج</span>
          <div className="flex flex-wrap gap-1.5">
            {PILL_CHOICES.map((pill) => {
              const active = pills.includes(pill.id);
              return (
                <button
                  key={pill.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setPills((current) =>
                      current.includes(pill.id) ? current.filter((p) => p !== pill.id) : [...current, pill.id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-bold transition",
                    active
                      ? "border-navy bg-navy text-white"
                      : "border-line text-muted hover:border-navy-2 dark:border-white/10",
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        {mode === "create" && (
          <div className="grid gap-3 rounded-xl border border-line p-3 dark:border-white/10">
            <span className="text-[12px] font-extrabold text-muted">مصدر القالب</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "project", label: "من مشروع حالي", disabled: !projects.length },
                  { id: "entry", label: "من قالب موجود", disabled: !entries.length },
                  { id: "blank", label: "مستند فارغ A4", disabled: false },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled}
                  aria-pressed={sourceKind === option.id}
                  onClick={() => setSourceKind(option.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40",
                    sourceKind === option.id
                      ? "border-navy bg-navy text-white"
                      : "border-line text-muted hover:border-navy-2 dark:border-white/10",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {sourceKind === "project" && (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} — {project.pages} صفحات
                  </option>
                ))}
              </select>
            )}
            {sourceKind === "entry" && (
              <select value={entryId} onChange={(e) => setEntryId(e.target.value)} className={field}>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} — {entry.kindLabel}
                  </option>
                ))}
              </select>
            )}
            {sourceKind === "blank" && (
              <p className="text-[11px] leading-6 text-muted">يبدأ القالب بصفحة A4 بيضاء مع رأس وتذييل خفيف.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 dark:border-white/10">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <Eye className="size-3.5" /> يُحفظ محليًا في متصفحك ويظهر في الكتالوج مباشرة.
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={GHOST_BTN}>
            إلغاء
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} className={PRIMARY_BTN}>
            {mode === "create" ? "حفظ القالب" : "حفظ التعديلات"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
