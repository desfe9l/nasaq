import { useEffect, useState } from "react";
import { Copy, Pencil, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { useAccountTier } from "@/components/site/AccountBadge";
import { useLicense } from "@/lib/license/client";
import { useBrandIdentity } from "@/lib/product/use-brand-identity";
import { applyBrandToSeed } from "@/lib/editor/brand-design";
import { useEditor } from "@/lib/editor/store";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import { editorPathFor } from "@/lib/site-routes";
import { templateToProjectSeed } from "@/lib/templates/document-template";
import { personalShareAbsoluteUrl, personalShareKey } from "@/lib/templates/personal";
import {
  deletePersonalTemplateFn,
  duplicatePersonalTemplateFn,
  getPersonalTemplateFn,
  listPersonalTemplatesFn,
  renamePersonalTemplateFn,
  setPersonalSharingFn,
} from "@/lib/templates/personal-functions";
import { SmartImage } from "@/components/ui/SmartImage";

interface Row {
  id: string;
  title: string;
  description: string;
  category: string;
  visibility: "private" | "shared";
  shareToken: string | null;
  /** Short public code (`/s/<code>`); preferred over the long legacy token. */
  shortCode?: string | null;
  thumbnail: string | null;
  pageCount: number;
  pageW: number;
  pageH: number;
}

export function MyTemplatesPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <Shell><p className="text-muted">جارٍ التحقق من الحساب…</p></Shell>;
  if (!user) {
    return (
      <Shell>
        <h1 className="text-[26px] font-extrabold">قوالبي</h1>
        <p className="mt-2 text-muted">سجّل الدخول بحساب مرخّص لفتح قوالبك الخاصة.</p>
        <a href="/login" className="mt-4 inline-flex h-10 items-center rounded-xl bg-navy px-4 text-[13px] font-extrabold text-on-brand">تسجيل الدخول</a>
      </Shell>
    );
  }
  return <LicensedTemplates user={user} />;
}

function LicensedTemplates({ user }: { user: AppUser }) {
  const { tier } = useAccountTier(user);
  const { entitlements } = useLicense();
  const brand = useBrandIdentity();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importProject = useEditor((s) => s.importProject);
  const hydrate = useEditor((s) => s.hydrate);

  const load = async () => {
    const result = await listPersonalTemplatesFn();
    if (!result.ok) {
      setError(result.error);
      setRows([]);
      return;
    }
    setError(null);
    setRows(result.templates as Row[]);
  };

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (tier === "LOADING") return;
    if (tier !== "LICENSED" && tier !== "ADMIN") {
      setRows([]);
      setError("قوالبي متاحة للحسابات المرخّصة فقط.");
      return;
    }
    void load().catch(() => setError("تعذر تحميل قوالبي"));
  }, [tier]);

  const openTemplate = async (id: string) => {
    const result = await getPersonalTemplateFn({ data: { id } });
    if (!result.ok || !("template" in result) || !result.template) {
      toast.error(!result.ok ? result.error : "تعذر فتح القالب");
      return;
    }
    const seed = applyBrandToSeed(
      templateToProjectSeed(result.template.content, result.template.title),
      brand.kit,
    );
    const block = projectAccessBlock(seed, {
      premium_templates: entitlements.premium_templates === true,
      unlimited_projects: entitlements.unlimited_projects === true,
      unlimited_pages: entitlements.unlimited_pages === true,
    });
    if (block) {
      toast.error(block === "premium-template" ? "يتطلب هذا القالب ترخيصًا مناسبًا" : "يتجاوز هذا القالب حد الصفحات في خطتك");
      return;
    }
    const imported = await importProject(seed, { successMessage: null });
    if (!imported) {
      toast.error("تعذر إنشاء مستند من القالب");
      return;
    }
    const projectId = useEditor.getState().id;
    window.location.assign(projectId ? editorPathFor(projectId) : "/create");
  };

  if (tier === "LOADING" || rows === null) {
    return <Shell><p className="text-muted">جارٍ تحميل قوالبي…</p></Shell>;
  }
  if (tier !== "LICENSED" && tier !== "ADMIN") {
    return (
      <Shell>
        <h1 className="text-[26px] font-extrabold">قوالبي</h1>
        <p className="mt-2 max-w-xl text-muted">هذه المجموعة خاصة بالمشتركين. الحساب الحالي لا يملك ترخيصًا فعالًا.</p>
        <a href="/license" className="mt-4 inline-flex h-10 items-center rounded-xl bg-navy px-4 text-[13px] font-extrabold text-on-brand">عرض الترخيص</a>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-[26px] font-extrabold">قوالبي</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-7 text-muted">
        قوالبك الخاصة. تبقى مخفية عن الآخرين إلا إذا فعّلت المشاركة بنفسك.
      </p>
      {error && <p className="mt-4 text-[13px] font-bold text-danger">{error}</p>}
      {rows.length === 0 ? (
        <p className="mt-8 text-muted">لا توجد قوالب بعد. احفظ مستندًا من المحرر عبر «حفظ في قوالبي».</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {rows.map((row) => (
            <TemplateRow
              key={row.id}
              row={row}
              onOpen={() => void openTemplate(row.id)}
              onChanged={() => void load()}
            />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function TemplateRow({
  row,
  onOpen,
  onChanged,
}: {
  row: Row;
  onOpen: () => void;
  onChanged: () => void;
}) {
  /* The short link when the row has one; the legacy token still resolves. */
  const shareKey = row.visibility === "shared" ? personalShareKey(row) : null;
  const url = shareKey ? personalShareAbsoluteUrl(shareKey) : null;
  const rename = async () => {
    const title = window.prompt("اسم القالب", row.title);
    if (!title || title.trim() === row.title) return;
    const result = await renamePersonalTemplateFn({ data: { id: row.id, title: title.trim() } });
    if (!result.ok) toast.error(result.error);
    else onChanged();
  };
  const duplicate = async () => {
    const result = await duplicatePersonalTemplateFn({ data: { id: row.id } });
    if (!result.ok) toast.error(result.error);
    else {
      toast.success("تم تكرار القالب");
      onChanged();
    }
  };
  const remove = async () => {
    if (!window.confirm(`حذف «${row.title}»؟`)) return;
    const result = await deletePersonalTemplateFn({ data: { id: row.id } });
    if (!result.ok) toast.error(result.error);
    else onChanged();
  };
  const share = async () => {
    const result = await setPersonalSharingFn({ data: { id: row.id, shared: !url } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const key = result.shortCode || result.shareToken;
    if (key) {
      const link = personalShareAbsoluteUrl(key);
      if (link) {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          /* copy is optional */
        }
        toast.success("تم تفعيل مشاركة القالب");
      }
    } else toast.success("أصبح القالب خاصًا");
    onChanged();
  };
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      {row.thumbnail ? (
        <SmartImage
          src={row.thumbnail}
          decorative
          fit="cover"
          aspectRatio="70 / 99"
          className="h-20 w-14 shrink-0 rounded-lg border border-line"
        />
      ) : (
        <div className="grid h-20 w-14 place-items-center rounded-lg bg-line-2 text-[10px] text-muted">بدون معاينة</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-extrabold">{row.title}</p>
        <p className="mt-1 text-[12px] text-muted">
          {row.pageCount} صفحات · {Math.round(row.pageW)}×{Math.round(row.pageH)} مم · {row.visibility === "shared" ? "مشارك" : "خاص"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onOpen} className="h-9 rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand">فتح القالب</button>
        <button type="button" onClick={() => void rename()} aria-label="إعادة تسمية" className="grid size-9 place-items-center rounded-lg border border-line"><Pencil className="size-4" /></button>
        <button type="button" onClick={() => void duplicate()} aria-label="تكرار" className="grid size-9 place-items-center rounded-lg border border-line"><Copy className="size-4" /></button>
        <button type="button" onClick={() => void share()} aria-label="مشاركة القالب" className="grid size-9 place-items-center rounded-lg border border-line"><Share2 className="size-4" /></button>
        <button type="button" onClick={() => void remove()} aria-label="حذف" className="grid size-9 place-items-center rounded-lg border border-line"><Trash2 className="size-4" /></button>
      </div>
    </li>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-paper" dir="rtl">
      <SiteHeader current="/templates" />
      <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
