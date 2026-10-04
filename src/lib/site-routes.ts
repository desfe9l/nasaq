/**
 * Canonical URL of the existing template library (`src/routes/templates/index.tsx`).
 *
 * The router's file-route id is `/templates/`, but the public path is
 * `/templates`: the server answers `/templates/` with a 307 to `/templates`,
 * so links must use the canonical form to open the library in one request.
 */
export const TEMPLATES_ROUTE = "/templates";
