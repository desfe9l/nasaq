import { useEffect, useState } from "react";
import {
  getSiteSettingsFn,
  listBuiltinTemplateStatesFn,
  listPublishedTemplatesFn,
} from "./functions";
import {
  DEFAULT_SITE_SETTINGS,
  type AdminTemplateSummary,
  type PublicSiteSettings,
  type TemplateStatus,
} from "./types";

const SETTINGS_CHANGED_EVENT = "nasaq:site-settings-changed";
export const ADMIN_TEMPLATES_CHANGED_EVENT =
  "nasaq:published-templates-changed";

/**
 * Admin-managed site settings for public pages. One fetch per page load,
 * shared by every consumer; falls back to the defaults (never blocks render).
 */
let settingsPromise: Promise<PublicSiteSettings> | null = null;
let settingsRevision = 0;

function loadSettings(): Promise<PublicSiteSettings> {
  if (!settingsPromise) {
    const revision = settingsRevision;
    settingsPromise = getSiteSettingsFn().catch(() => {
      if (revision === settingsRevision) settingsPromise = null;
      return DEFAULT_SITE_SETTINGS;
    });
  }
  return settingsPromise;
}

/** Refresh public consumers after an Admin settings write. */
export function invalidateSiteSettings(): void {
  settingsRevision++;
  settingsPromise = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

export function useSiteSettings(): PublicSiteSettings {
  const [settings, setSettings] = useState<PublicSiteSettings>(
    DEFAULT_SITE_SETTINGS,
  );
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const revision = settingsRevision;
      void loadSettings().then((next) => {
        if (alive && revision === settingsRevision) setSettings(next);
      });
    };
    refresh();
    window.addEventListener(SETTINGS_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(SETTINGS_CHANGED_EVENT, refresh);
    };
  }, []);
  return settings;
}

let publishedTemplatesPromise: Promise<AdminTemplateSummary[]> | null = null;
let publishedTemplatesRevision = 0;

function loadPublishedTemplates(): Promise<AdminTemplateSummary[]> {
  if (!publishedTemplatesPromise) {
    const revision = publishedTemplatesRevision;
    publishedTemplatesPromise = listPublishedTemplatesFn().catch(() => {
      if (revision === publishedTemplatesRevision)
        publishedTemplatesPromise = null;
      return [];
    });
  }
  return publishedTemplatesPromise;
}

/** Refresh public template/catalog consumers after a template record changes. */
export function invalidatePublishedTemplates(): void {
  publishedTemplatesRevision++;
  publishedTemplatesPromise = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(ADMIN_TEMPLATES_CHANGED_EVENT));
}

/** Catalog status writes can also clear a selected homepage feature. */
export function invalidateAdminPublicContent(): void {
  invalidateSiteSettings();
  invalidatePublishedTemplates();
}

/**
 * The published catalog plus whether the answer has arrived.
 *
 * An empty list means two very different things before and after the fetch
 * resolves ("nothing published" vs "not asked yet"). A consumer that boots
 * something from the catalog — the homepage hero editor — must wait for the
 * real answer instead of booting twice, so the loading flag is exposed.
 */
export function usePublishedTemplatesState(): {
  items: AdminTemplateSummary[];
  loading: boolean;
} {
  const [state, setState] = useState<{
    items: AdminTemplateSummary[];
    loading: boolean;
  }>({ items: [], loading: true });
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const revision = publishedTemplatesRevision;
      setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
      void loadPublishedTemplates().then((list) => {
        if (alive && revision === publishedTemplatesRevision)
          setState({ items: list, loading: false });
      });
    };
    refresh();
    window.addEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, refresh);
    };
  }, []);
  return state;
}

export function usePublishedTemplates(): AdminTemplateSummary[] {
  return usePublishedTemplatesState().items;
}

/** Stable built-in IDs plus visibility only; template content stays server-side. */
export function useBuiltinTemplateStates(): {
  id: string;
  status: TemplateStatus;
}[] {
  const [states, setStates] = useState<
    { id: string; status: TemplateStatus }[]
  >([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void listBuiltinTemplateStatesFn()
        .then((result) => {
          if (alive) setStates(result);
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, refresh);
    };
  }, []);
  return states;
}

export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
