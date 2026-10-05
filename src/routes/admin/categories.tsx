import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, PencilLine } from "lucide-react";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { adminListTemplatesFn } from "@/lib/admin/functions";
import type { AdminTemplateSummary } from "@/lib/admin/types";
import { TEMPLATE_CATEGORIES } from "@/lib/editor/templates";
import { ADMIN_ROUTES, ADMIN_SECTIONS, categoryPathFor } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "categories")!;

/**
 * `/admin/categories` — الفئات as a managed surface, not a hidden filter.
 *
 * The categories ARE the platform's taxonomy (`TEMPLATE_CATEGORIES`, the one
 * the templates, the library and `/templates/category/<id>` all share). This
 * section shows each one with its REAL published/draft counts read through the
 * admin template reader, and links both ways: edit in the templates section,
 * browse the public destination the category is indexed under.
 */
export const Route = createFileRoute("/admin/categories")({
  component: CategoriesSection,
});

function CategoriesSection() {
  const [templates, setTemplates] = useState<AdminTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void adminListTemplatesFn()
      .then((result) => {
        if (!alive) return;
        if (!result.ok) setError(result.error ?? "تعذّر تحميل القوالب.");
        else setTemplates(result.templates);
      })
      .catch(() => alive && setError("تعذّر قراءة قاعدة البيانات."));
    return () => {
      alive = false;
    };
  }, []);

  const count = (id: string, status?: string) =>
    (templates ?? []).filter(
      (t) => (t.category || "general") === id && (!status || t.status === status),
    ).length;

  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        {error && (
          <p className="rounded-[10px] border border-danger/40 bg-danger/5 p-3 text-[12px] font-bold text-error">
            {error}
          </p>
        )}
        {!templates && !error && (
          <p className="p-3 text-[12px] text-muted">جارٍ العدّ…</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATE_CATEGORIES.map((category) => (
            <div
              key={category.id}
              className="grid gap-2 rounded-[12px] border border-line bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-black">{category.title}</p>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-muted">{category.desc}</p>
                </div>
                <span className="shrink-0 rounded-full bg-navy-2/10 px-2 py-0.5 text-[10px] font-black text-brand tabular-nums">
                  {templates ? count(category.id, "published") : "—"}
                </span>
              </div>
              <p className="text-[10px] font-bold text-muted">
                {templates ? `مسودات: ${count(category.id, "draft")}` : "بانتظار العدّ"}
              </p>
              <div className="flex items-center gap-1.5">
                <Link
                  to={ADMIN_ROUTES.templates}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[11px] font-extrabold text-on-brand"
                >
                  <PencilLine className="size-3.5" aria-hidden />
                  إدارة
                </Link>
                <a
                  href={categoryPathFor(category.id)}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-bold"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  تصفّح
                </a>
              </div>
            </div>
          ))}
        </div>
      </AdminGate>
    </AdminSection>
  );
}
