import { useState } from "react";
import {
  Copy,
  FileDown,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { THEMES, type ProjectMeta } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(ts).toLocaleDateString("ar-SA");
}

/**
 * One document row in the grid / list / home rails.
 *
 * The preview is the real page-1 JPEG captured on auto-save, framed like an
 * A4 sheet; the footer action buttons are gone — opening happens through the
 * glassmorphism hover overlay («فتح المستند») or the title, and every other
 * command lives in the single «…» menu (rename, favourite, duplicate,
 * export JSON, delete). Titles wrap to two lines instead of truncating.
 */
export function ProjectCard({
  project,
  onOpen,
  compact,
  variant = "grid",
}: {
  project: ProjectMeta;
  onOpen: (id: string) => void | Promise<void>;
  compact?: boolean;
  variant?: "grid" | "list";
}) {
  const renameProject = useEditor((s) => s.renameProject);
  const duplicateProject = useEditor((s) => s.duplicateProject);
  const deleteProject = useEditor((s) => s.deleteProject);
  const toggleProjectFavorite = useEditor((s) => s.toggleProjectFavorite);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const theme = THEMES[project.theme] || THEMES.official;
  const isList = variant === "list";

  const commitRename = async () => {
    const next = draftName.trim();
    if (next && next !== project.name) {
      await renameProject(project.id, next);
      toast.success("تم تحديث اسم المشروع");
    }
    setRenaming(false);
  };

  const exportJson = async () => {
    setBusy(true);
    try {
      const full = await openProjectLookup(project.id);
      if (!full) {
        toast.error("تعذر فتح المشروع");
        return;
      }
      const { exportJson: writeJson, safeFileName } = await import("@/lib/editor/export");
      writeJson({ ...full, updatedAt: Date.now() });
      toast.success(`تم تنزيل ${safeFileName(full.name)}.json`);
    } catch {
      toast.error("تعذر تصدير المشروع");
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      await duplicateProject(project.id);
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };

  const star = async () => {
    setMenu(false);
    await toggleProjectFavorite(project.id);
    toast.success(
      project.favorite ? "أُزيل من المفضلة" : "أُضيف إلى المفضلة ⭐",
    );
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteProject(project.id);
      toast.success("تم حذف المشروع");
    } finally {
      setBusy(false);
      setConfirming(false);
      setMenu(false);
    }
  };

  /**
   * A4 paper frame: the captured page-1 JPEG (or a CSS fallback sheet when
   * the thumbnail has not been captured yet). The overlay turns the whole
   * sheet into the «open» affordance on hover / focus.
   */
  const preview = (
    <div
      className={cn(
        "relative overflow-hidden rounded-[7px] border border-line bg-white shadow-sm dark:border-white/10 dark:bg-white/5",
        // Real A4 proportions (210 × 297): the page-1 snapshot sits inside a
        // paper frame instead of being cropped into a banner strip.
        isList ? "aspect-[210/297] w-[56px] shrink-0" : compact ? "mx-auto aspect-[210/297] h-[150px]" : "mx-auto aspect-[210/297] h-[200px]",
      )}
    >
      {project.thumbnail ? (
        <img
          src={project.thumbnail}
          alt=""
          aria-hidden
          loading="lazy"
          className="h-full w-full bg-white object-contain object-top"
        />
      ) : (
        <span className="flex h-full w-full flex-col">
          <span className="block h-5 shrink-0" style={{ background: theme.primary }} />
          <span className="block h-[3px] shrink-0" style={{ background: theme.accent }} />
          <span className="mx-2.5 mt-3 block h-1.5 rounded bg-navy/15" />
          <span className="mx-2.5 mt-2 block h-1 w-2/3 rounded bg-navy/10" />
          <span className="mx-2.5 mt-2 block h-1 w-1/2 rounded bg-navy/10" />
        </span>
      )}
      {/* Glassmorphism open-overlay: replaces the old footer action buttons. */}
      <button
        type="button"
        onClick={() => void onOpen(project.id)}
        aria-label={`فتح ${project.name}`}
        className="group/overlay absolute inset-0 grid place-items-center bg-navy/0 backdrop-blur-0 transition-all duration-200 hover:bg-navy/45 hover:backdrop-blur-[2px] focus-visible:bg-navy/45 focus-visible:backdrop-blur-[2px] focus:outline-none"
      >
        <span className="inline-flex translate-y-1 items-center gap-1.5 rounded-full border border-white/40 bg-white/85 px-3 py-1.5 text-[11px] font-extrabold text-navy opacity-0 shadow-sm transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-hover/overlay:translate-y-0 group-hover/overlay:opacity-100 group-focus-visible/overlay:translate-y-0 group-focus-visible/overlay:opacity-100 dark:border-white/20 dark:bg-[#161c26]/90 dark:text-gold-2">
          <FolderOpen className="size-3.5" />
          فتح المستند
        </span>
      </button>
      {project.favorite && (
        <span
          title="في المفضلة"
          className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-amber-400 text-[11px] shadow-sm"
        >
          ⭐
        </span>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "shadow-card dark:shadow-card-dark group relative rounded-xl border border-line bg-white p-4 transition-all duration-200 hover:-translate-y-1 hover:border-navy-2 hover:shadow-card-hover dark:border-white/10 dark:bg-white/5 dark:hover:shadow-card-dark-hover",
        isList && "flex items-center gap-4 p-3",
        busy && "opacity-60",
      )}
    >
      <div className={cn(isList ? "flex min-w-0 flex-1 items-center gap-4" : "flex flex-col")}>
        {!isList && preview}
        {isList && <div className="hidden shrink-0 sm:block">{preview}</div>}

        <div className={cn("min-w-0 flex-1", !isList && "mt-3")}>
          {renaming ? (
            <div className="flex w-full gap-1.5">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="h-8 min-w-0 flex-1 rounded-[6px] border border-line px-2 text-[13px] font-bold dark:border-white/10 dark:bg-white/5"
              />
              <button
                type="button"
                onClick={() => void commitRename()}
                className="h-8 rounded-[6px] bg-navy px-2.5 text-[11px] font-extrabold text-white"
              >
                حفظ
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                aria-label="إلغاء"
                className="grid size-8 place-items-center rounded-[6px] border border-line dark:border-white/10"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onOpen(project.id)}
              className="block w-full text-right"
            >
              {/* Wrap instead of truncate: long official titles stay readable. */}
              <strong className="line-clamp-2 break-words text-[14px] font-extrabold leading-6">
                {project.name}
                {project.favorite && (
                  <span className="mr-1 text-amber-500" title="في المفضلة">
                    ★
                  </span>
                )}
              </strong>
              <span className="mt-0.5 block text-[11px] text-muted">
                {project.pages} صفحة · {theme.name}
              </span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-muted">
                آخر تعديل {relativeTime(project.updatedAt)}
                {project.orgName ? ` · ${project.orgName}` : ""}
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label={`خيارات ${project.name}`}
          aria-expanded={menu}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[6px] border border-line dark:border-white/10",
            isList && "absolute top-3 left-3",
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {menu && (
        <div className="absolute top-12 left-3 z-20 w-48 rounded-[10px] border border-line bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b2433]">
          <MenuItem
            onClick={() => {
              setRenaming(true);
              setDraftName(project.name);
              setMenu(false);
            }}
            icon={Pencil}
          >
            إعادة تسمية
          </MenuItem>
          <MenuItem onClick={() => void star()} icon={Star}>
            {project.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
          </MenuItem>
          <MenuItem onClick={() => void duplicate()} icon={Copy}>
            نسخ المشروع
          </MenuItem>
          <MenuItem onClick={() => void exportJson()} icon={FileDown}>
            تصدير JSON
          </MenuItem>
          <MenuItem onClick={() => setConfirming(true)} icon={Trash2} danger>
            حذف
          </MenuItem>
        </div>
      )}

      {confirming && (
        <div className="absolute inset-0 z-30 grid place-items-center rounded-xl bg-white/95 p-4 text-center dark:bg-[#1b2433]/95">
          <div>
            <p className="text-[13px] font-extrabold">حذف «{project.name}»؟</p>
            <p className="mt-1 text-[11px] text-muted">لا يمكن التراجع عن هذه العملية.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void remove()}
                className="h-9 rounded-[8px] bg-danger px-3 text-[12px] font-extrabold text-white"
              >
                حذف نهائي
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-9 rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon: Icon,
  danger,
  children,
}: {
  onClick: () => void;
  icon: typeof Copy;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-right text-[12px] font-bold hover:bg-line-2 dark:hover:bg-white/5",
        danger && "text-danger",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

async function openProjectLookup(id: string) {
  const { getProject } = await import("@/lib/editor/storage");
  return getProject(id);
}
