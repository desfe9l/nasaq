import { useEffect } from "react";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
} from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "@/lib/auth/provider";
import { NsqFileLaunch } from "@/components/nsq/NsqFileLaunch";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppUpdateNotice } from "@/components/AppUpdateNotice";
import { OfflineStatus } from "@/components/ui/OfflineStatus";
import { initInstallPrompt } from "@/lib/app-install";
// `__APP_BUILD_ID__` is a build-time literal (src/env.d.ts), never a binding.
// Side-effect import: applies the visitor's stored light/dark choice to
// <html> before any route renders, so every page starts on the same mode.
import "@/lib/theme";
import { BRAND } from "@/lib/brand";
import { legacyRedirectFor } from "@/lib/site-routes";
import {
  SITE_ORIGIN,
  SITE_OG_IMAGE,
  SITE_OG_IMAGE_ALT,
  SITE_OG_IMAGE_HEIGHT,
  SITE_OG_IMAGE_TYPE,
  SITE_OG_IMAGE_WIDTH,
} from "@/lib/og/share";
import appCss from "../styles.css?url";

const PAGE_TITLE = "نَسَق | NASAQ — محرر التقارير والمخرجات المؤسسية";
const DESCRIPTION =
  "منصة نَسَق (NASAQ) - المحرر المؤسسي الذكي لإعداد وتصميم التقارير، الإحصائيات، والمخرجات البصرية بجودة طباعية عالية ومعالجة محلية 100%.";

export const Route = createRootRoute({
  /**
   * Legacy addresses, resolved ONCE for the whole app: the old workspace
   * (`/home`), the retired admin consoles (`/admin-dashboard`,
   * `/admin-licenses`) and the brand-kit page (`/brand-kit`) are permanent
   * redirects to their canonical destinations, so an old bookmark, a link in a
   * received file, or the installed app's saved start URL still lands on the
   * right page — server-side (301 + `Location`) and in the client.
   */
  beforeLoad: ({ location }) => {
    const target = legacyRedirectFor(location.pathname);
    if (!target) return;
    /*
     * `Location` is an HTTP header, so it must be ASCII: the brand-kit
     * destination contains Arabic, and an unencoded header throws inside the
     * server runtime (500 instead of a redirect). Encoding here keeps both the
     * header and the browser's follow-up request correct.
     */
    throw redirect({ href: encodeURI(target), replace: true, statusCode: 301 });
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "نَسَق" },
      { title: PAGE_TITLE },
      { name: "theme-color", content: "#f4f0e8" },
      { name: "description", content: DESCRIPTION },
      { name: "author", content: BRAND.developer },
      /*
       * Link / social preview.
       *
       * Without these the crawler has no image to render and falls back to
       * whatever it cached from an earlier deploy — which is exactly how the
       * retired green document glyph kept appearing in shared links after the
       * mark changed. The card is declared ABSOLUTELY (the Open Graph protocol
       * does not resolve relative `og:image` values) and points at the
       * regenerated `/og.jpg`, which now carries the current mark.
       */
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "نَسَق | NASAQ" },
      { property: "og:locale", content: "ar_SA" },
      { property: "og:title", content: PAGE_TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: SITE_ORIGIN },
      { property: "og:image", content: SITE_OG_IMAGE },
      { property: "og:image:secure_url", content: SITE_OG_IMAGE },
      { property: "og:image:type", content: SITE_OG_IMAGE_TYPE },
      { property: "og:image:width", content: String(SITE_OG_IMAGE_WIDTH) },
      { property: "og:image:height", content: String(SITE_OG_IMAGE_HEIGHT) },
      { property: "og:image:alt", content: SITE_OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: SITE_OG_IMAGE },
      { name: "twitter:image:alt", content: SITE_OG_IMAGE_ALT },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/nasaq-mark.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/nasaq-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@400;600;700&family=Tajawal:wght@400;500;700;800;900&display=swap",
      },
    ],
  }),
  component: function RootComponent() {
    // Capture `beforeinstallprompt` as early as possible so the workspace
    // and editor install buttons always have a live event to trigger.
    useEffect(() => {
      initInstallPrompt();
    }, []);
    // Offline-first: register app-shell service worker and start connectivity monitoring
    useEffect(() => {
      void import("@/lib/offline/register-sw").then((m)=>m.registerOfflineSW());
      void import("@/lib/offline/connectivity").then((m)=>m.initConnectivity());
    }, []);
    return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body data-build={__APP_BUILD_ID__}>
        <ManagedBrandIcon />
        <PreviewHostBridge />
        <NsqFileLaunch />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <AppUpdateNotice />
        <OfflineStatus />
        <Analytics />
        <Scripts />
      </body>
    </html>
    );
  },
});

/** Owner mark wins; otherwise the current NASAQ logo. Never the retired glyph. */
function ManagedBrandIcon() {
  const mark = useSiteSettings().images.mark?.trim() ?? "";
  useEffect(() => {
    const href = mark || "/nasaq-mark.svg";
    const type = mark.startsWith("data:image/png")
      ? "image/png"
      : mark.startsWith("data:image/jpeg") || mark.startsWith("data:image/jpg")
        ? "image/jpeg"
        : mark.startsWith("data:image/webp")
          ? "image/webp"
          : "image/svg+xml";
    const ensure = (rel: string, fallback: string, fallbackType: string) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.type = mark ? type : fallbackType;
      link.href = mark || fallback;
    };
    ensure("icon", href, "image/svg+xml");
    ensure("apple-touch-icon", "/icons/nasaq-180.png", "image/png");
  }, [mark]);
  return null;
}
