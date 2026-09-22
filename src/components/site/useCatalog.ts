/*
 * React bindings for the template catalog store.
 *
 * `useSyncExternalStore` is the whole state layer: localStorage is the single
 * source of truth, writes notify every mounted catalog view, and the `storage`
 * event keeps a second tab in step. No effect, no polling, no cache to bust.
 */

import { useMemo, useSyncExternalStore } from "react";
import type { ThemeId } from "@/lib/editor/model";
import { buildCatalog, type CatalogEntry } from "@/lib/templates/catalog";
import {
  customTemplatesSnapshot,
  draftSnapshot,
  subscribeCustomTemplates,
  type CustomTemplate,
  type TemplateDraft,
} from "@/lib/templates/custom-templates";

/** Stable empty snapshot for the server render / pre-hydration pass. */
const NO_TEMPLATES: CustomTemplate[] = [];

export function useCustomTemplates(): CustomTemplate[] {
  return useSyncExternalStore(
    subscribeCustomTemplates,
    customTemplatesSnapshot,
    () => NO_TEMPLATES,
  );
}

export function useTemplateDraft(): TemplateDraft | null {
  return useSyncExternalStore(subscribeCustomTemplates, draftSnapshot, () => null);
}

/** Every catalog entry — custom templates first — for a theme and organisation. */
export function useCatalogEntries(themeId: ThemeId, orgName: string): CatalogEntry[] {
  const custom = useCustomTemplates();
  return useMemo(
    () => buildCatalog({ themeId, orgName, custom }),
    [themeId, orgName, custom],
  );
}
