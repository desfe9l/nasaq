import { useEffect, useState } from "react";
import { getSiteSettingsFn, listPublishedTemplatesFn } from "./functions";
import { DEFAULT_SITE_SETTINGS, type AdminTemplateSummary, type PublicSiteSettings } from "./types";

/**
 * Admin-managed site settings for public pages. One fetch per page load,
 * shared by every consumer; falls back to the defaults (never blocks render).
 */
let settingsPromise: Promise<PublicSiteSettings> | null = null;

function loadSettings(): Promise<PublicSiteSettings> {
  settingsPromise ??= getSiteSettingsFn().catch(() => {
    settingsPromise = null;
    return DEFAULT_SITE_SETTINGS;
  });
  return settingsPromise;
}

export function useSiteSettings(): PublicSiteSettings {
  const [settings, setSettings] = useState<PublicSiteSettings>(DEFAULT_SITE_SETTINGS);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (alive) setSettings(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

export function usePublishedTemplates(): AdminTemplateSummary[] {
  const [items, setItems] = useState<AdminTemplateSummary[]>([]);
  useEffect(() => {
    let alive = true;
    listPublishedTemplatesFn()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return items;
}

export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
