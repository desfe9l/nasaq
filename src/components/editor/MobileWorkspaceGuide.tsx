/*
 * The first-run guide for the phone workspace.
 *
 * On a phone the editor is a different instrument: the tool dock sits under the
 * thumb, panels open as bottom sheets, and the canvas answers to fingers instead
 * of a cursor. None of that is discoverable from icons alone, and an unexplained
 * icon on a small screen is a dead end — so the first time the mobile workspace
 * opens, it says what the workspace does, in plain Arabic, once. The author can
 * dismiss it and never see it again on that device; a «جولة» entry in the
 * workspace menu (see `EditorApp`) reopens it deliberately.
 *
 * It is deliberately small, high-contrast and thumb-reachable: one card, four
 * lines, one button. Nothing animates, nothing blocks the document behind a
 * translucent veil forever, and it never appears on a pointer device.
 */

import { useEffect, useRef, useState } from "react";

/** Where the "already seen" mark lives. Bump the version to re-educate. */
const SEEN_KEY = "nasaq.editor.mobile-guide.v1";

/** True when this device has not been shown the guide yet. */
export function shouldShowMobileGuide(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    // Private mode / storage disabled: showing it again is harmless.
    return true;
  }
}

/** Marks the guide as seen for this device. */
export function markMobileGuideSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* Storage is a nicety here, never a requirement. */
  }
}

const POINTS: { id: string; body: string }[] = [
  { id: "move", body: "اسحب بإصبع واحد للتنقل داخل الصفحة، وبإصبعين للتكبير والتصغير." },
  { id: "select", body: "انقر عنصرًا لتحديده. عند التحديد تظهر أدواته أسفل الشاشة، ويمكنك سحبه أو تغيير مقاسه من مقابضه." },
  { id: "dock", body: "الشريط السفلي يجمع أدوات المحرر بأسمائها. مرّر التبويبات أفقيًا لرؤية الأشكال والقوالب والخطوط وبقية الأدوات، وانقر التبويب مرة أخرى لإغلاق لوحته." },
  { id: "save", body: "يُحفظ عملك تلقائيًا. زر التصدير أعلى الشاشة لإخراج الملف." },
];

export function MobileWorkspaceGuide({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(() => shouldShowMobileGuide());
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dismiss = () => {
    markMobileGuideSeen();
    setOpen(false);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      className="mobile-guide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-guide-title"
    >
      <div className="mobile-guide-card">
        <p className="mobile-guide-kicker">مساحة عمل الجوال</p>
        <h2 id="mobile-guide-title" className="mobile-guide-title">
          المحرر بين إبهاميك
        </h2>
        <ul className="mobile-guide-list">
          {POINTS.map((point) => (
            <li key={point.id}>{point.body}</li>
          ))}
        </ul>
        <button ref={closeRef} type="button" className="mobile-guide-cta" onClick={dismiss}>
          ابدأ العمل
        </button>
        <p className="mobile-guide-note">
          يمكنك استعراض هذه الجولة لاحقًا من قائمة العرض في الشريط العلوي.
        </p>
      </div>
    </div>
  );
}
