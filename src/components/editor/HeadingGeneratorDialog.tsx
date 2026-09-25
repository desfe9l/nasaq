import { useMemo, useState } from "react";
import { Check, Heading1, Loader2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import { pageSize, THEMES, type ElStyle } from "@/lib/editor/model";
import {
  DEFAULT_HEADING_PALETTE,
  HEADING_PRESETS,
  buildHeading,
  headingHeight,
  type HeadingPalette,
  type HeadingPresetId,
} from "@/lib/editor/heading-generator";
import { cn } from "@/lib/utils";

function paletteForTheme(themeId: keyof typeof THEMES): HeadingPalette {
  const t = THEMES[themeId];
  return {
    primary: t?.primary || DEFAULT_HEADING_PALETTE.primary,
    accent: t?.accent || DEFAULT_HEADING_PALETTE.accent,
    ink: t?.ink || DEFAULT_HEADING_PALETTE.ink,
    muted: t?.muted || DEFAULT_HEADING_PALETTE.muted,
    surface: t?.paper || DEFAULT_HEADING_PALETTE.surface,
  };
}

function boxStyle(part: Record<string, string | number>): ElStyle {
  const style: ElStyle = { fill: String(part.fill ?? "") };
  if (part.radius != null) style.radius = Number(part.radius);
  if (part.stroke) {
    style.borderColor = String(part.stroke);
    style.borderWidth = Number(part.strokeWidth ?? 0.4);
  }
  return style;
}

function textStyle(part: Record<string, string | number>): ElStyle {
  const align = String(part.textAlign ?? "right");
  const style: ElStyle = {
    fontSize: Number(part.fontSize ?? 16),
    fontWeight: Number(part.fontWeight ?? 700),
    color: String(part.color ?? "#172033"),
    textAlign: align === "center" ? "center" : align === "left" ? "left" : "right",
    lineHeight: Number(part.lineHeight ?? 1.4),
  };
  if (part.letterSpacing != null) style.letterSpacing = Number(part.letterSpacing);
  return style;
}

export function HeadingGeneratorDialog({ onClose }: { onClose: () => void }) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const theme = useEditor((s) => s.theme);
  const addElement = useEditor((s) => s.addElement);
  const groupSelection = useEditor((s) => s.group);
  const selectMany = useEditor((s) => s.selectMany);

  const page = pages.find((p) => p.id === activePageId) ?? pages[0];
  const size = page ? pageSize(page) : { w: 210, h: 297 };
  const columnWidth = Math.max(60, Math.round(size.w - 30));

  const [preset, setPreset] = useState<HeadingPresetId>("side-bar");
  const [title, setTitle] = useState("الملخص التنفيذي");
  const [subtitle, setSubtitle] = useState("");
  const [index, setIndex] = useState("01");
  const [eyebrow, setEyebrow] = useState("");
  const [busy, setBusy] = useState(false);

  const palette = useMemo(() => paletteForTheme(theme), [theme]);
  const parts = useMemo(
    () =>
      buildHeading(
        { preset, width: columnWidth, title, subtitle, index, eyebrow },
        palette,
      ),
    [preset, columnWidth, title, subtitle, index, eyebrow, palette],
  );
  const height = headingHeight({ preset, width: columnWidth, title, subtitle, index, eyebrow });

  const insert = () => {
    if (!page) return;
    setBusy(true);
    try {
      const lowest = page.elements.reduce(
        (max, el) => Math.max(max, el.y + el.h),
        15,
      );
      const y = Math.min(lowest + 6, Math.max(15, size.h - height - 15));
      const x = 15;

      const created: string[] = [];
      for (const part of parts) {
        const id =
          part.kind === "text"
            ? addElement("text", {
                name:
                  part.role === "title"
                    ? "عنوان الفقرة"
                    : part.role === "index"
                      ? "رقم القسم"
                      : part.role === "eyebrow"
                        ? "تصنيف القسم"
                        : "عنوان فرعي",
                x: x + part.x,
                y: y + part.y,
                w: part.w,
                h: Math.max(4, part.h),
                content: part.text,
                style: textStyle(part.style),
              })
            : addElement("box", {
                name:
                  part.role === "band"
                    ? "شريط العنوان"
                    : part.role === "rule"
                      ? "خط فاصل"
                      : part.role === "plate"
                        ? "لوحة العنوان"
                        : "علامة لونية",
                x: x + part.x,
                y: y + part.y,
                w: Math.max(0.4, part.w),
                h: Math.max(0.4, part.h),
                ...(part.style.opacity != null
                  ? { opacity: Number(part.style.opacity) }
                  : {}),
                style: boxStyle(part.style),
              });
        if (id) created.push(id);
      }

      if (created.length === 0) {
        toast.error("تعذّر إدراج العنوان.");
        return;
      }

      if (created.length > 1) {
        selectMany(created);
        groupSelection();
      } else {
        selectMany(created);
      }
      toast.success("تم إدراج عنوان الفقرة — منظّم ومتوازن وجاهز للتعديل", { duration: 2200 });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const fields = HEADING_PRESETS.find((p) => p.id === preset)?.fields ?? ["title"];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-2 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="مولد عناوين الفقرات"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] border border-line bg-white shadow-2xl dark:border-white/10 dark:bg-[#161c26]">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Heading1 className="size-4 text-navy dark:text-gold-2" aria-hidden />
            <div>
              <h2 className="text-[13px] font-extrabold">مولد عناوين الفقرات</h2>
              <p className="text-[10px] text-muted">
                تصاميم جاهزة وقابلة للتعديل بالكامل بعد الإدراج
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-[8px] hover:bg-line-2 dark:hover:bg-white/5"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1fr_260px] editor-pane-scroll">
          <div className="grid gap-3 content-start">
            <label className="block">
              <span className="mb-1 block text-[11px] font-extrabold">عنوان الفقرة</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-navy dark:border-white/10"
                placeholder="الملخص التنفيذي"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.includes("subtitle") && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold">
                    عنوان فرعي (اختياري)
                  </span>
                  <input
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    className="h-9 w-full rounded-[8px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-navy dark:border-white/10"
                    placeholder="وصف مختصر للقسم"
                  />
                </label>
              )}
              {fields.includes("index") && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold">رقم القسم</span>
                  <input
                    value={index}
                    onChange={(e) => setIndex(e.target.value)}
                    className="h-9 w-full rounded-[8px] border border-line bg-transparent px-3 text-center text-[12px] font-bold outline-none focus:border-navy dark:border-white/10"
                    placeholder="01"
                    dir="ltr"
                  />
                </label>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-extrabold">
                تصنيف علوي (اختياري)
              </span>
              <input
                value={eyebrow}
                onChange={(e) => setEyebrow(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-navy dark:border-white/10"
                placeholder="محور الأداء"
              />
            </label>

            <div>
              <h3 className="mb-2 text-[11px] font-extrabold">التصميم</h3>
              <div className="grid grid-cols-2 gap-2">
                {HEADING_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreset(item.id)}
                    title={item.hint}
                    className={cn(
                      "relative flex min-h-[46px] items-center justify-center rounded-[8px] border px-2 py-2.5 text-[11px] font-extrabold transition",
                      preset === item.id
                        ? "border-navy bg-navy/5 text-navy dark:text-gold-2"
                        : "border-line bg-white text-muted hover:border-navy/50 dark:border-white/10 dark:bg-white/[0.03]",
                    )}
                  >
                    {preset === item.id && (
                      <Check className="absolute end-1.5 top-1.5 size-3 text-navy dark:text-gold-2" aria-hidden />
                    )}
                    <span className="line-clamp-2 text-center leading-4">{item.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 rounded-[6px] bg-paper px-2 py-1.5 text-[10px] leading-5 text-muted dark:bg-white/5">
                {HEADING_PRESETS.find((p) => p.id === preset)?.hint}
              </p>
            </div>
          </div>

          <div className="grid gap-2 content-start">
            <h3 className="text-[11px] font-extrabold">معاينة</h3>
            <div className="rounded-[8px] border border-line bg-paper p-3 dark:border-white/10 dark:bg-white/5">
              <div
                className="relative mx-auto overflow-hidden rounded-[4px] bg-white shadow-sm dark:bg-[#101722]"
                style={{
                  width: "100%",
                  aspectRatio: `${columnWidth} / ${height}`,
                  maxHeight: 220,
                }}
                aria-hidden
              >
                {parts.map((part, i) => {
                  const style = part.style;
                  if (part.kind === "box") {
                    return (
                      <span
                        key={i}
                        className="absolute block"
                        style={{
                          left: `${(part.x / columnWidth) * 100}%`,
                          top: `${(part.y / height) * 100}%`,
                          width: `${(part.w / columnWidth) * 100}%`,
                          height: `${(part.h / height) * 100}%`,
                          background: String(style.fill ?? "transparent"),
                          border: style.stroke ? `1px solid ${String(style.stroke)}` : undefined,
                          borderRadius: `${Math.min(6, Number(style.radius ?? 0) * 1.6)}px`,
                          opacity: style.opacity != null ? Number(style.opacity) : undefined,
                        }}
                      />
                    );
                  }
                  return (
                    <span
                      key={i}
                      className="absolute block overflow-hidden"
                      style={{
                        left: `${(part.x / columnWidth) * 100}%`,
                        top: `${(part.y / height) * 100}%`,
                        width: `${(part.w / columnWidth) * 100}%`,
                        height: `${(part.h / height) * 100}%`,
                        color: String(style.color ?? "#000"),
                        fontSize: `clamp(6px, ${Number(style.fontSize ?? 12) * 0.42}vh, ${Number(style.fontSize ?? 12)}px)`,
                        fontWeight: Number(style.fontWeight ?? 700),
                        textAlign:
                          style.textAlign === "center"
                            ? "center"
                            : style.textAlign === "left"
                              ? "left"
                              : "right",
                        lineHeight: Number(style.lineHeight ?? 1.4),
                        direction: "rtl",
                      }}
                    >
                      {part.text}
                    </span>
                  );
                })}
              </div>
            </div>
            <p className="rounded-[6px] bg-line-2/40 px-2 py-1.5 text-[10px] leading-5 text-muted dark:bg-white/5">
              بعرض عمود النص ({columnWidth} مم) وارتفاع {Math.round(height)} مم. بعد الإدراج
              تحتفظ كل قطعة بحرية التعديل. يُضاف ككتلة منظمة بمحاذاة صحيحة ومسافات مضبوطة، جاهز للتصميم فوراً.
            </p>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3 dark:border-white/10 bg-white dark:bg-[#161c26]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={insert}
            disabled={busy || !title.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Wand2 className="size-4" aria-hidden />
            )}
            إدراج العنوان
          </button>
        </footer>
      </div>
    </div>
  );
}
