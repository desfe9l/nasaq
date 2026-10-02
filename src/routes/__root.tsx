import { useEffect } from "react";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { NsqFileLaunch } from "@/components/nsq/NsqFileLaunch";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppUpdateNotice } from "@/components/AppUpdateNotice";
import { initInstallPrompt } from "@/lib/app-install";
// `__APP_BUILD_ID__` is a build-time literal (src/env.d.ts), never a binding.
// Side-effect import: applies the visitor's stored light/dark choice to
// <html> before any route renders, so every page starts on the same mode.
import "@/lib/theme";
import { BRAND } from "@/lib/brand";
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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PAGE_TITLE },
      { name: "theme-color", content: "#006C35" },
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
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
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
    return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      {/* data-build: which build this document was served by — the QA/ops
          hook, and the value the stale-build guard (AppUpdateNotice) reads. */}
      <body data-build={__APP_BUILD_ID__}>
        <PreviewHostBridge />
        <NsqFileLaunch />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <AppUpdateNotice />
        <Scripts />
      </body>
    </html>
    );
  },
});
