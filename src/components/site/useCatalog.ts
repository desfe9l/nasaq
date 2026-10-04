/*
 * React bindings for the template catalog store.
 *
 * IndexedDB is the source of truth. The async store hydrates stable external
 * snapshots, owner changes clear them, and BroadcastChannel refreshes other
 * open catalog tabs without copying template data into Web Storage.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ThemeId } from "@/lib/editor/model";
import { buildCatalog, type CatalogEntry } from "@/lib/templates/catalog";
import { useBuiltinTemplateStates, usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { subscribeStorageOwner } from "@/lib/editor/storage-owner";
import { syncStorageOwner } from "@/lib/auth/storage-owner-sync";
import {
  customTemplatesSnapshot,
  draftSnapshot,
  hydrateCustomTemplateStore,
  subscribeCustomTemplates,
  TemplateStorageError,
  type CustomTemplate,
  type TemplateDraft,
} from "@/lib/templates/custom-templates";

/** Stable empty snapshot for the server render / pre-hydration pass. */
const NO_TEMPLATES: CustomTemplate[] = [];

function useTemplateStoreHydration(): void {
  useEffect(() => {
    let mounted = true;
    const load = () => {
      void syncStorageOwner()
        .then(() => {
          if (!mounted) return;
          return hydrateCustomTemplateStore();
        })
        .catch((error) => {
          if (!mounted) return;
          toast.error(
            error instanceof TemplateStorageError
              ? error.message
              : "تعذّر تحميل القوالب المحفوظة من هذا المتصفح.",
          );
        });
    };
    load();
    const unsubscribeOwner = subscribeStorageOwner(load);
    return () => {
      mounted = false;
      unsubscribeOwner();
    };
  }, []);
}

export function useCustomTemplates(): CustomTemplate[] {
  useTemplateStoreHydration();
  return useSyncExternalStore(
    subscribeCustomTemplates,
    customTemplatesSnapshot,
    () => NO_TEMPLATES,
  );
}

export function useTemplateDraft(): TemplateDraft | null {
  useTemplateStoreHydration();
  return useSyncExternalStore(subscribeCustomTemplates, draftSnapshot, () => null);
}

/** Every catalog entry — custom templates first — for a theme and organisation. */
export function useCatalogEntries(themeId: ThemeId, orgName: string): CatalogEntry[] {
  const custom = useCustomTemplates();
  const managedTemplates = usePublishedTemplates();
  const managedStates = useBuiltinTemplateStates();
  return useMemo(
    () => buildCatalog({ themeId, orgName, custom, managedTemplates, managedStates }),
    [themeId, orgName, custom, managedTemplates, managedStates],
  );
}
