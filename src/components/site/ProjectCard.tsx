import { useState } from "react";
import { Copy, FileDown, FolderOpen, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { THEMES, type ProjectMeta } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(ts).toLocaleDateString("ar-SA");
}

export function ProjectCard({
  project,
  onOpen,
  compact,
}: {
  project: ProjectMeta;
  onOpen: (id: string) => void | Promise<void>;
  compact?: boolean;
}) {
  const renameProject = useEditor((s) => s.renameProject);
  const duplicateProject = useEditor((s) => s.duplicateProject);
  const deleteProject = useEditor((s) => s.deleteProject);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const theme = THEMES[project.theme] || THEMES.official;

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

  return (
    <div
      className={cn(
        "shadow-card dark:shadow-card-dark relative rounded-xl border border-line bg-white p-4 transition-all duration-200 hover:-translate-y-1 hover:border-navy-2 hover:shadow-card-hover dark:border-white/10 dark:bg-white/5 dark:hover:shadow-card-dark-hover",
        busy && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-[74px] w-[54px] shrink-0 overflow-hidden rounded-[6px] border border-line bg-white">
          <span className="block h-4" style={{ background: theme.primary }} />
          <span className="block h-[3px]" style={{ background: theme.accent }} />
          <span className="mx-2 mt-3 block h-1.5 rounded bg-navy/15" />
          <span className="mx-2 mt-1.5 block h-1 w-2/3 rounded bg-navy/10" />
          <span className="mx-2 mt-1.5 block h-1 w-1/2 rounded bg-navy/10" />
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex gap-1.5">
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
              <strong className="block truncate text-[14px] font-extrabold">{project.name}</strong>
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
          className="grid size-8 shrink-0 place-items-center rounded-[6px] border border-line dark:border-white/10"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {menu && (
        <div className="absolute top-12 left-3 z-20 w-44 rounded-[10px] border border-line bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b2433]">
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

      {!compact && (
        <div className="mt-3 flex gap-2 border-t border-line pt-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => void onOpen(project.id)}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[12px] font-extrabold text-white"
          >
            <FolderOpen className="size-3.5" />
            فتح المشروع
          </button>
          <button
            type="button"
            onClick={() => void duplicate()}
            title="نسخ المشروع"
            className="grid size-9 place-items-center rounded-[8px] border border-line dark:border-white/10"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="حذف المشروع"
            className="grid size-9 place-items-center rounded-[8px] border border-red-200 text-danger dark:border-red-500/30"
          >
            <Trash2 className="size-3.5" />
          </button>
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