import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
// Side-effect import: applies the visitor's stored light/dark choice to
// <html> before any route renders, so every page starts on the same mode.
import "@/lib/theme";
import { BRAND } from "@/lib/brand";
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
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/nasaq-mark.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@400;600;700&family=Tajawal:wght@400;500;700;800;900&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});