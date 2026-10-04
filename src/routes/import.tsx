import { createFileRoute } from "@tanstack/react-router";
import { ImportServicePage } from "@/components/import/ImportServicePage";

/**
 * /import — the dedicated template-import service.
 *
 * A first-class product surface (not a tab inside the editor): upload a
 * template file, inspect what the conversion produced, repair conversion
 * damage with «إصلاح العناصر», compare before/after, then open the result in
 * the NASAQ editor.
 *
 * Access follows the existing entitlement architecture: the page itself is
 * reachable, but every conversion is authorised server-side by the same
 * template-manager gate the admin console uses (`authorizeTemplateImportFn`
 * → `verifyTemplateManager`). A visitor without the entitlement sees the
 * service and what it does — never its internals, never a conversion.
 */
export const Route = createFileRoute("/import")({
  ssr: false,
  head: () => ({
    meta: [{ title: "استيراد القوالب | نَسَق NASAQ" }],
  }),
  component: ImportServicePage,
});
