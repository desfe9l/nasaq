import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, FilePlus2, FolderOpen, Save, SaveAll } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { canUseDemoExport } from "@/lib/product/product";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  downloadCurrentNsq,
  linkedFileName,
  saveCurrentNsq,
  saveCurrentNsqAs,
  supportsSavePicker,
} from "@/lib/nsq/editor-io";
import { FullVersionModal } from "@/components/site/FullVersionModal";
import { cn } from "@/lib/utils";

const SignInRequiredModalLazy = lazy(() =>
  import("@/components/site/SignInRequiredModal").then((m) => ({
    default: m.SignInRequiredModal,
  })),
);

const MENU_W = 256;

/** Keyboard shortcuts the editor keymap forwards to this menu's actions. */
export const NSQ_SAVE_AS_EVENT = "nasaq:nsq-save-as";

/**
 * «ملف» — native project-file actions for `.nsq`.
 *
 * New / Open are available to everyone (opening a received file is how new
 * people discover NASAQ). Saving and downloading a project file follow the
 * exact policy the export dialog already applies to project files: a guest is
 * asked to sign in first, and the file requires the `advanced_export`
 * entitlement.
 */
export function ProjectFileMenu({ onOpenFile }: { onOpenFile: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [signInOpen, setSignInOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const projectId = useEditor((s) => s.id);
  const entitlements = useEditor((s) => s.entitlements);
  const createProject = useEditor((s) => s.createProject);
  const { user, isPending } = useCurrentUserState();
  const guest = authEnabled && !isPending && !user;
  const linked = open ? linkedFileName(projectId) : null;

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 6,
      // Anchored to the trigger's right edge, but clamped on BOTH sides so a
      // trigger near the physical-left end of the header never pushes the
      // menu off-screen (the left edge used to go negative).
      right: Math.max(
        8,
        Math.min(window.innerWidth - r.right, window.innerWidth - MENU_W - 8),
      ),
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node | null;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t))
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  /** Same gate as the export dialog's project file. */
  const allowed = (): boolean => {
    if (guest) {
      setSignInOpen(true);
      return false;
    }
    if (!canUseDemoExport("nsq", entitlements.advanced_export === true)) {
      setUpgradeOpen(true);
      return false;
    }
    return true;
  };

  const runSave = (action: () => Promise<boolean>) => {
    setOpen(false);
    if (busy || !allowed()) return;
    setBusy(true);
    // Called synchronously from the click so the save picker keeps the
    // user activation it requires.
    void action().finally(() => setBusy(false));
  };

  // ⇧⌘S from the editor keymap.
  useEffect(() => {
    const onSaveAs = () => runSave(saveCurrentNsqAs);
    window.addEventListener(NSQ_SAVE_AS_EVENT, onSaveAs);
    return () => window.removeEventListener(NSQ_SAVE_AS_EVENT, onSaveAs);
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen(!open);
        }}
        title="ملف المشروع — فتح وحفظ ملفات نَسَق (.nsq)"
        aria-label="ملف المشروع"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[8px] transition hover:bg-line-2 dark:hover:bg-white/10",
          open &&
            "bg-navy text-white hover:bg-navy dark:bg-navy dark:text-white",
        )}
      >
        <FolderOpen className="size-4" />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="ملف المشروع"
            className="editor-dropdown-panel fixed z-[var(--z-dropdown)] rounded-[10px] border p-1.5 shadow-2xl"
            style={{ top: pos.top, right: pos.right, width: MENU_W, maxWidth: "calc(100vw - 16px)" }}
          >
            <Item
              icon={<FilePlus2 className="size-4" />}
              label="مشروع جديد"
              onClick={() => {
                setOpen(false);
                void createProject("blank");
              }}
            />
            <Item
              icon={<FolderOpen className="size-4" />}
              label="فتح ملف نَسَق…"
              hint="⌘O"
              onClick={() => {
                setOpen(false);
                onOpenFile();
              }}
            />
            <div className="my-1 border-t border-[var(--editor-border)]" />
            {linked && (
              <Item
                icon={<Save className="size-4" />}
                label={`حفظ في «${linked}»`}
                onClick={() => runSave(saveCurrentNsq)}
              />
            )}
            <Item
              icon={<SaveAll className="size-4" />}
              label={
                supportsSavePicker() ? "حفظ باسم… (.nsq)" : "حفظ كملف .nsq"
              }
              hint="⇧⌘S"
              disabled={busy}
              onClick={() => runSave(saveCurrentNsqAs)}
            />
            <Item
              icon={<Download className="size-4" />}
              label="تنزيل ملف المشروع (.nsq)"
              disabled={busy}
              onClick={() => runSave(downloadCurrentNsq)}
            />
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] leading-4 text-muted">
              ملف واحد يحفظ الصفحات والصور والخطوط والطبقات، ويُفتح قابلًا
              للتعديل على أي جهاز.
            </p>
          </div>,
          // Portalled to the editor root (keeping its chrome tokens): the
          // toolbar is its own stacking context, so a panel rendered inside it
          // would sit beneath the side panels it overlaps.
          triggerRef.current?.closest<HTMLElement>(".editor-ui") ??
            document.body,
        )}

      {upgradeOpen && (
        <FullVersionModal open onClose={() => setUpgradeOpen(false)} />
      )}
      {signInOpen && (
        <Suspense fallback={null}>
          <SignInRequiredModalLazy
            open={signInOpen}
            onClose={() => setSignInOpen(false)}
            intent="حفظ ملف المشروع"
          />
        </Suspense>
      )}
    </>
  );
}

function Item({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold hover:bg-[var(--editor-hover,rgba(127,127,127,0.14))] disabled:opacity-35"
    >
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span
          className="shrink-0 text-[10px] font-semibold text-muted"
          dir="ltr"
        >
          {hint}
        </span>
      )}
    </button>
  );
}
