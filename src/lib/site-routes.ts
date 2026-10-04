/**
 * Canonical URL of the existing template library (`src/routes/templates/index.tsx`).
 *
 * The router's file-route id is `/templates/`, but the public path is
 * `/templates`: the server answers `/templates/` with a 307 to `/templates`,
 * so links must use the canonical form to open the library in one request.
 */
export const TEMPLATES_ROUTE = "/templates";
/**
 * Canonical URL of the template-import service (`src/routes/import.tsx`).
 *
 * A file route (not a directory route), so the public path is exactly
 * `/import` with no trailing-slash redirect — links use the constant so the
 * service has one spelling everywhere (header account menu, workspace Home,
 * admin surfaces).
 */
export const IMPORT_ROUTE = "/import";
