import { useEffect, useState } from "react";
import {
  Check,
  Contrast,
  KeyRound,
  Loader2,
  Moon,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/site/SiteChrome";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { useLicense } from "@/lib/license/client";
import { licenseSummary } from "@/lib/license/summary";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "@/components/site/AccountAvatar";
import { documentBuildId } from "@/lib/app-update";

/**
 * «الإعدادات» — the account and the workspace, without leaving the editor.
 *
 * Nothing here owns a second source of truth:
 *   • the account half renders the verified session (`useCurrentUserState`) and
 *     the licence the server resolved (`useLicense` → `getLicenseStatusFn`), and
 *     its only actions are the existing ones (`activate`, `/license`,
 *     `/account`);
 *   • the editor half flips the same store flags the toolbar switches flip,
 *     through the same persistence (`lib/theme`, the UI slot), so a preference
 *     set here is the one that loads on the next session.
 *
 * It cannot grant access. An unlicensed, expired or revoked account sees its
 * real name and the real restriction note — the entitlements applied to the
 * canvas are the server's, untouched by anything in this panel.
 */

type Tab = "account" | "editor";

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "الحساب" },
  { id: "editor", label: "المحرر" },
];

export function EditorSettingsDialog({
  onClose,
  initialTab = "account",
}: {
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-scrim p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="الإعدادات"
      dir="rtl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="editor-settings-surface flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="editor-brand-mark"><BrandLogo compact markOnly /></span>
            <div>
              <h2 className="text-[13px] font-extrabold">الإعدادات</h2>
              <p className="text-[10px] text-muted">
                الحساب ومزايا الترخيص · تفضيلات المحرر
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الإعدادات"
            className="grid size-8 place-items-center rounded-[8px] hover:bg-line-2"
          >
            <X className="size-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="أقسام الإعدادات"
          className="flex gap-1 border-b border-line px-3 py-2"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-[8px] px-3 py-1.5 text-[12px] font-extrabold transition",
                tab === item.id
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="editor-pane-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "account" ? <AccountSection /> : <EditorSection />}
        </div>
      </div>
    </div>
  );
}

/** One label/value row in the settings sheets. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 pt-0.5 text-[11px] font-bold text-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-end text-[12px] font-extrabold">
        {children}
      </dd>
    </div>
  );
}

function AccountSection() {
  const { user } = useCurrentUserState();
  const identity = accountIdentity(user);
  const { isLoading, hasLicense, isAdmin, isSuspended, license, trial, activate } =
    useLicense(user?.id, user?.primaryEmail);
  const summary = licenseSummary({
    isLoading,
    isAdmin,
    isSuspended,
    hasLicense,
    license,
    trial,
  });

  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);

  const submitKey = async () => {
    const value = key.trim();
    if (!value || activating) return;
    setActivating(true);
    const result = await activate(value);
    setActivating(false);
    if (result.success) {
      setKey("");
      toast.success(result.message || "تم تفعيل الترخيص");
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-[12px] border border-line p-4">
        <div className="flex items-center gap-3">
          <AccountAvatar user={user} size={40} />
          <div className="min-w-0">
            <p
              className="truncate text-[13px] font-extrabold"
              title={identity.label}
            >
              {identity.label}
            </p>
            <p
              className="truncate text-[11px] font-medium text-muted"
              dir="ltr"
              title={identity.email ?? undefined}
            >
              {identity.email ?? "—"}
            </p>
          </div>
        </div>
        {!identity.hasProfileName && identity.email && (
          <p className="mt-2 text-[10px] leading-5 text-muted">
            لا يوجد اسم في ملف الحساب، فيُعرض البريد الإلكتروني بدلًا منه.
          </p>
        )}
      </section>

      <section className="rounded-[12px] border border-line p-4">
        <h3 className="text-[11px] font-extrabold text-muted">
          الترخيص والاشتراك
        </h3>
        <dl className="mt-1 divide-y divide-line">
          <Row label="الحالة">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold",
                summary.tone === "licensed" && "bg-ok/12 text-success",
                summary.tone === "suspended" && "bg-danger/12 text-error",
                (summary.tone === "free" || summary.tone === "loading") &&
                  "bg-line-2 text-muted",
              )}
            >
              {summary.tone === "loading" && (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              )}
              {summary.label}
            </span>
          </Row>
          {license?.keyPrefix && (
            <Row label="المفتاح">
              <span dir="ltr">•••• {license.keyPrefix}</span>
            </Row>
          )}
          {summary.detail && (
            <Row label="التفاصيل">
              <span className="text-[11px] font-bold">{summary.detail}</span>
            </Row>
          )}
        </dl>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitKey();
            }}
            placeholder="مفتاح الترخيص"
            aria-label="مفتاح الترخيص"
            dir="ltr"
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-transparent px-2 text-[12px] font-bold outline-none focus:border-navy"
          />
          <button
            type="button"
            onClick={() => void submitKey()}
            disabled={activating || !key.trim()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {activating ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            تفعيل
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/license"
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12px] font-bold"
          >
            <KeyRound className="size-3.5 opacity-70" aria-hidden />
            إدارة الترخيص
          </a>
          <a
            href="/account"
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12px] font-bold"
          >
            <UserRound className="size-3.5 opacity-70" aria-hidden />
            الحساب والاشتراك
          </a>
        </div>
      </section>
    </div>
  );
}

/** A labelled switch — the same control the panels use, kept local and small. */
function PrefSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-extrabold">{label}</p>
        {hint && (
          <p className="mt-0.5 text-[10px] leading-4 text-muted">{hint}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition",
          checked ? "border-brand bg-ok/80" : "border-line bg-line-2",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 size-3.5 rounded-full bg-surface shadow transition-all",
            // RTL: "on" slides toward the start of the track.
            checked ? "start-0.5" : "start-[18px]",
          )}
        />
      </button>
    </div>
  );
}

function EditorSection() {
  /** Build this open document was served by — support's first question. */
  const buildId = documentBuildId();
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const showOutsidePage = useEditor((s) => s.showOutsidePage);
  const setShowOutsidePage = useEditor((s) => s.setShowOutsidePage);
  const bubbleEnabled = useEditor((s) => s.bubbleEnabled);
  const artboardGridCols = useEditor((s) => s.artboardGridCols);
  const setArtboardGridCols = useEditor((s) => s.setArtboardGridCols);
  const printGuides = useEditor((s) => s.printGuides);
  const toggle = useEditor((s) => s.toggle);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);

  return (
    <div className="grid gap-4">
      <section className="rounded-[12px] border border-line p-4">
        <h3 className="text-[11px] font-extrabold text-muted">المظهر</h3>
        <div
          role="radiogroup"
          aria-label="سمة المحرر"
          className="mt-2 flex gap-1 rounded-[10px] border border-line p-1"
        >
          {(
            [
              { value: "light" as const, label: "فاتح", Icon: Sun },
              { value: "dim" as const, label: "خافت", Icon: Contrast },
              { value: "dark" as const, label: "داكن", Icon: Moon },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={appearance === value}
              onClick={() => setAppearance(value)}
              className={cn(
                "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[12px] font-extrabold transition",
                appearance === value
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-5 text-muted">
          مظهر الواجهة فقط؛ لا يغيّر خلفية الصفحة أو ألوان التصميم.
        </p>
      </section>

      <section className="rounded-[12px] border border-line p-4">
        <h3 className="text-[11px] font-extrabold text-muted">مساحة العمل</h3>
        <div className="mt-1 divide-y divide-line">
          <PrefSwitch
            label="الشبكة"
            hint="إظهار شبكة المحاذاة على الصفحة"
            checked={showGrid}
            onChange={() => toggle("showGrid")}
          />
          <PrefSwitch
            label="المطابقة للشبكة"
            hint="جذب العناصر إلى خطوط الشبكة أثناء التحريك"
            checked={snapGrid}
            onChange={() => toggle("snapGrid")}
          />
          <PrefSwitch
            label="المطابقة للعناصر"
            hint="محاذاة العنصر إلى حواف العناصر المجاورة"
            checked={snapElements}
            onChange={() => toggle("snapElements")}
          />
          <PrefSwitch
            label="إظهار العناصر خارج الصفحة"
            hint="العناصر التي تتجاوز حدّ الصفحة تبقى مرئية أثناء التحرير. الإخفاء يقصّ العرض فقط — لا يحذف عنصرًا ولا يغيّر موضعه أو قياسه."
            checked={showOutsidePage !== false}
            onChange={() => setShowOutsidePage(showOutsidePage === false)}
          />
          <div className="flex items-center justify-between gap-2 py-2.5">
            <span className="text-[11px] font-bold text-ink">إصدار المحرر</span>
            <span
              className="selectable-value truncate text-[11px] font-bold text-muted"
              title={buildId}
            >
              {buildId}
            </span>
          </div>
          <PrefSwitch
            label="الشريط العائم"
            hint="شريط الأدوات الذي يتبع العنصر المحدد"
            checked={bubbleEnabled}
            onChange={() => toggleBubble()}
          />
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="block text-[12px] font-bold">
                تخطيط شبكة اللوحات (أعمدة)
              </span>
              <span className="block text-[10px] text-muted">
                تنظيم لوحات التصميم في أعمدة وصفوف متقاربة
              </span>
            </div>
            <div className="flex gap-1" dir="ltr">
              {[1, 2, 3, 4, 6].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setArtboardGridCols(c)}
                  className={cn(
                    "grid size-7 place-items-center rounded-[6px] text-[11px] font-extrabold transition",
                    artboardGridCols === c
                      ? "bg-navy text-white shadow-xs"
                      : "border border-line/60 hover:bg-line-2",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-line p-4">
        <h3 className="text-[11px] font-extrabold text-muted">أدلة الطباعة</h3>
        <div className="mt-1 divide-y divide-line">
          <PrefSwitch
            label="منطقة النص الآمنة"
            checked={printGuides.safe}
            onChange={() => togglePrintGuide("safe")}
          />
          <PrefSwitch
            label="هامش التجليد"
            checked={printGuides.gutter}
            onChange={() => togglePrintGuide("gutter")}
          />
          <PrefSwitch
            label="منطقة القص"
            checked={printGuides.bleed}
            onChange={() => togglePrintGuide("bleed")}
          />
        </div>
      </section>

      <p className="px-1 text-[10px] leading-5 text-muted">
        تُحفظ تفضيلات المحرر على هذا الجهاز وتُطبَّق في كل جلسة؛ حالة الترخيص
        تُقرأ من الخادم في كل مرة.
      </p>
    </div>
  );
}
