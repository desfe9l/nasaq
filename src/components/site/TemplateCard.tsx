/*
 * Catalog card.
 *
 * The card is the catalog's unit of work: a real page preview on top (never a
 * placeholder), the management overlay that appears on hover/focus, and the
 * action row that stays visible for touch devices. Every action is passed in —
 * the card itself holds no state beyond its own menus.
 */

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Eye,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { pageSize } from "@/lib/editor/model";
import { cn } from "@/lib/utils";
import { pagesLabel, type CatalogBadge, type CatalogEntry } from "@/lib/templates/catalog";
import { TemplateStackPreview } from "./TemplatePreview";

/** Preview box height (px). Landscape pages fit by width instead. */
const PREVIEW_BOX = 232;

export interface TemplateCardActions {
  onUse: () => void;
  onQuickView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onEditMeta: () => void;
  onDelete: () => void;
}

const BADGE_TONE: Record<CatalogBadge["tone"], string> = {
  custom: "bg-navy text-white",
  new: "bg-gold text-green",
  official: "bg-white/90 text-green dark:bg-[#111722]/85 dark:text-gold-2",
  pack: "bg-navy-2 text-white",
};

function IconAction({
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg border backdrop-blur-[6px] transition",
        tone === "danger"
          ? "border-danger/40 bg-white/90 text-danger hover:bg-danger hover:text-white dark:bg-[#111722]/85"
          : "border-line/70 bg-white/90 text-ink hover:bg-navy hover:text-white dark:border-white/15 dark:bg-[#111722]/85 dark:text-white",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Overflow menu for the action row (keyboard + touch reachable). */
function ActionMenu({ items }: { items: { label: string; icon: LucideIcon; onClick: () => void; tone?: "danger" }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="خيارات القالب"
        className="grid size-10 place-items-center rounded-xl border border-line text-muted transition hover:bg-line-2 hover:text-ink dark:border-white/10 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="shadow-card dark:shadow-card-dark absolute bottom-12 left-0 z-[var(--z-dropdown)] w-48 overflow-hidden rounded-xl border border-line bg-white py-1 dark:border-white/10 dark:bg-[#161c26]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-right text-[12px] font-bold transition hover:bg-line-2 dark:hover:bg-white/5",
                item.tone === "danger" ? "text-danger" : "text-ink dark:text-white",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateCard({
  entry,
  actions,
  locked = false,
  highlight = false,
}: {
  entry: CatalogEntry;
  actions: TemplateCardActions;
  /** Premium pack outside the demo allowance — «استخدام القالب» opens /license. */
  locked?: boolean;
  /** Marks the card just added/updated by the author. */
  highlight?: boolean;
}) {
  const size = pageSize(entry.pages[0]);
  const isCustom = entry.kind === "custom";

  const menuItems = [
    { label: "معاينة سريعة", icon: Eye, onClick: actions.onQuickView },
    { label: "تعديل القالب", icon: Pencil, onClick: actions.onEdit },
    { label: "تكرار", icon: Copy, onClick: actions.onDuplicate },
    ...(isCustom
      ? [
          { label: "تعديل البيانات", icon: Settings2, onClick: actions.onEditMeta },
          { label: "حذف", icon: Trash2, onClick: actions.onDelete, tone: "danger" as const },
        ]
      : []),
  ];

  return (
    <article
      className={cn(
        "group shadow-card dark:shadow-card-dark flex flex-col overflow-hidden rounded-2xl border bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover dark:bg-white/5 dark:hover:shadow-card-dark-hover",
        highlight
          ? "border-navy ring-2 ring-navy/25 dark:border-gold-2"
          : "border-line dark:border-white/10",
      )}
    >
      {/* ── preview ─────────────────────────────────────────────────────── */}
      <div className="relative shrink-0 overflow-hidden border-b border-line/70 bg-paper/70 dark:border-white/10 dark:bg-white/[0.03]">
        {/*
         * The preview box is its own query container, so the sheet can be sized
         * as "contain" in pure CSS: as wide as the box OR as tall as the box —
         * whichever keeps the page's own ratio. No clipping for A4 landscape,
         * no letterboxing for slides, no JavaScript measurement.
         */}
        <div
          className="relative grid place-items-center p-4 [container-type:size]"
          style={{ height: PREVIEW_BOX }}
        >
          <TemplateStackPreview
            pages={entry.pages}
            style={{
              aspectRatio: `${size.w} / ${size.h}`,
              width: `min(100cqw, ${(size.w / size.h).toFixed(4)} * 100cqh)`,
            }}
            className="rounded-[3px] border border-line shadow-md transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl dark:border-white/15"
          />
        </div>

        <div className="pointer-events-none absolute right-3 top-3 flex max-w-[80%] flex-wrap justify-end gap-1">
          {entry.badges.map((badge) => (
            <span
              key={badge.label}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-extrabold shadow-sm",
                BADGE_TONE[badge.tone],
              )}
            >
              {badge.label}
            </span>
          ))}
        </div>

        {/* Management overlay — revealed on hover or keyboard focus. */}
        <div className="absolute left-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <IconAction icon={Eye} label="معاينة سريعة" onClick={actions.onQuickView} />
          <IconAction icon={Pencil} label="تعديل القالب" onClick={actions.onEdit} />
          <IconAction icon={Copy} label="تكرار القالب" onClick={actions.onDuplicate} />
          {isCustom && <IconAction icon={Trash2} label="حذف القالب" onClick={actions.onDelete} tone="danger" />}
        </div>
      </div>

      {/* ── body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col p-5 text-right">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-extrabold leading-6 text-ink dark:text-white">{entry.title}</h3>
          <span className="shrink-0 rounded-full bg-line-2 px-2 py-0.5 text-[10px] font-bold text-muted dark:bg-white/10 dark:text-white/80">
            {entry.kindLabel}
          </span>
        </div>
        <p className="mt-2 flex-1 text-[12px] leading-6 text-muted">{entry.desc}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-muted">
          <span>{entry.categoryLabel}</span>
          <span aria-hidden>·</span>
          <span>{pagesLabel(entry.pages.length)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {Math.round(size.w)} × {Math.round(size.h)} مم
          </span>
          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-extrabold text-green dark:bg-gold/15 dark:text-gold-2">
              <Lock className="size-3" /> متاح في النسخة الكاملة
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-line/70 pt-4 dark:border-white/10">
          <button
            type="button"
            onClick={actions.onUse}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-navy px-3 text-[12px] font-extrabold text-white shadow-sm transition hover:bg-navy-2"
          >
            <Plus className="size-4" />
            استخدام القالب
          </button>
          <button
            type="button"
            onClick={actions.onQuickView}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-3 text-[12px] font-bold text-ink transition hover:bg-line-2 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
          >
            <Eye className="size-4" />
            معاينة سريعة
          </button>
          <ActionMenu items={menuItems} />
        </div>
      </div>
    </article>
  );
}

export default TemplateCard;
