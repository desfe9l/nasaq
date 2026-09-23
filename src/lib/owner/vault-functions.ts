import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  type OwnerRouteInfo,
  type OwnerVaultFinding,
  type OwnerVaultInventory,
  type VaultChangeGuide,
  type VaultEntry,
  type VaultOrigin,
  type VaultSection,
  type VaultSensitivity,
} from "./vault";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_PROVIDER_ID } from "@/lib/auth/providers";

type EnvSpec = {
  key: string;
  section: VaultSection;
  service: string;
  account: string;
  label: string;
  sensitivity: VaultSensitivity;
  purpose: string;
  loginUrl: string | null;
  dashboardUrl: string | null;
  apiUrl: string | null;
  configurationLocation: string;
  ownerReadable?: boolean;
  fallbackValue?: string;
  exampleValue?: string;
  guide: VaultChangeGuide;
};

const githubRepo = "https://github.com/desfe9l/nasaq";
const productionUrl = "https://nasaq-sa.vercel.app";
const vercelDashboard = "https://vercel.com/desfe9l/nasaq";
const lemonDashboard = "https://app.lemonsqueezy.com";
const lemonApi = "https://api.lemonsqueezy.com/v1";
const xaiDashboard = "https://console.x.ai";
const authBroker = "https://auth.grok.me";

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function currentEnvironment(): string {
  return (
    envValue("VERCEL_ENV") ||
    (envValue("VERCEL") === "1"
      ? envValue("NODE_ENV") === "production"
        ? "production"
        : "preview"
      : "development")
  );
}

function guide(
  providerAction: string,
  providerUrl: string | null,
  nasaqLocation: string,
  environments = "Production / Preview / Development حسب مكان النشر",
  redeploy = "نعم، أعد النشر بعد تحديث متغيرات الخادم.",
  webhook = "لا يوجد تحديث Webhook مطلوب لهذا المتغير.",
  revoke = "بعد نجاح التحقق من القيمة الجديدة، ألغِ القديمة من المزود إذا كان ذلك متاحًا.",
): VaultChangeGuide {
  return { providerAction, providerUrl, nasaqLocation, environments, redeploy, webhook, revoke };
}

const ENV_SPECS: EnvSpec[] = [
  {
    key: "NASAQ_OWNER_ID",
    section: "authentication",
    service: "NASAQ OWNER",
    account: "MASTER OWNER",
    label: "معرّف المالك",
    sensitivity: "sensitive",
    purpose: "مطابقة هوية Better Auth الموثّقة مع MASTER OWNER.",
    loginUrl: "/login",
    dashboardUrl: "/owner-vault",
    apiUrl: null,
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("غيّر قيمة المعرّف في إعدادات النشر بعد التأكد من معرّف الحساب.", "https://vercel.com/dashboard", "NASAQ_OWNER_ID"),
  },
  {
    key: "NASAQ_OWNER_EMAIL",
    section: "authentication",
    service: "NASAQ OWNER",
    account: "MASTER OWNER",
    label: "بريد المالك",
    sensitivity: "sensitive",
    purpose: "بديل لمطابقة هوية MASTER OWNER عبر البريد الموثّق.",
    loginUrl: "/login",
    dashboardUrl: "/owner-vault",
    apiUrl: null,
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("غيّر بريد المالك في إعدادات النشر فقط بعد التحقق من الحساب الجديد.", "https://vercel.com/dashboard", "NASAQ_OWNER_EMAIL"),
  },
  {
    key: "VITE_AUTH_ENABLED",
    section: "authentication",
    service: "Better Auth / Grok broker",
    account: "NASAQ deployment",
    label: "تفعيل المصادقة",
    sensitivity: "public",
    purpose: "يحدد ما إذا كان تسجيل الدخول الحقيقي مفعلًا؛ الافتراضي في الكود هو التشغيل.",
    loginUrl: "/login",
    dashboardUrl: authBroker,
    apiUrl: `${authBroker}/api/auth`,
    configurationLocation: "Vercel → Settings → Environment Variables أو .grok/app-env.json محليًا",
    fallbackValue: "true",
    guide: guide("غيّر العلم فقط من إعدادات النشر، ولا تعطل المصادقة في بيئة إنتاج.", "https://vercel.com/dashboard", "VITE_AUTH_ENABLED"),
  },
  {
    key: "GROK_PROJECT_ID",
    section: "projects",
    service: "Grok deployment gate",
    account: "NASAQ app",
    label: "معرّف مشروع Grok",
    sensitivity: "sensitive",
    purpose: "تمييز التطبيق المنشور عن مساحة المعاينة وتثبيت جمهور رمز البوابة.",
    loginUrl: null,
    dashboardUrl: "https://grok.com",
    apiUrl: null,
    configurationLocation: "إعدادات مشروع Grok / Vercel deployment environment",
    guide: guide("غيّر معرّف المشروع من منصة النشر التي تحقن هذا المتغير.", "https://grok.com", "GROK_PROJECT_ID"),
  },
  {
    key: "GROK_AUTH_ISSUER",
    section: "authentication",
    service: "Grok auth broker",
    account: "Shared broker",
    label: "مُصدر OAuth",
    sensitivity: "public",
    purpose: "عنوان مُصدر المصادقة الفيدرالية لـ Google.",
    loginUrl: authBroker,
    dashboardUrl: authBroker,
    apiUrl: `${authBroker}/api/auth/oauth2/token`,
    configurationLocation: "Vercel environment؛ fallback في src/lib/auth/preview.ts",
    fallbackValue: authBroker,
    guide: guide("غيّر issuer فقط عند نقل broker وتحديث endpoints المتوافقة.", authBroker, "GROK_AUTH_ISSUER"),
  },
  {
    key: "GROK_AUTH_CLIENT_ID",
    section: "authentication",
    service: "Grok auth broker",
    account: "Per-app OAuth client",
    label: "OAuth client ID",
    sensitivity: "sensitive",
    purpose: "هوية عميل NASAQ لدى broker.",
    loginUrl: authBroker,
    dashboardUrl: authBroker,
    apiUrl: `${authBroker}/api/auth/oauth2/authorize`,
    configurationLocation: "Vercel environment؛ fallback preview في src/lib/auth/preview.ts",
    fallbackValue: "grok_preview",
    guide: guide("أنشئ أو اختر OAuth client في broker ثم حدّث قيمة client ID.", authBroker, "GROK_AUTH_CLIENT_ID"),
  },
  {
    key: "GROK_AUTH_CLIENT_SECRET",
    section: "authentication",
    service: "Grok auth broker",
    account: "Per-app OAuth client",
    label: "OAuth client secret",
    sensitivity: "secret",
    purpose: "سر عميل NASAQ المستخدم في OAuth server-side.",
    loginUrl: authBroker,
    dashboardUrl: authBroker,
    apiUrl: `${authBroker}/api/auth/oauth2/token`,
    configurationLocation: "Vercel → Settings → Environment Variables؛ fallback preview في src/lib/auth/preview.ts",
    guide: guide("أنشئ سرًا جديدًا من broker، حدّث Vercel، ثم أعد النشر واختبر تسجيل الدخول.", authBroker, "GROK_AUTH_CLIENT_SECRET", "Production / Preview حسب بيئة العميل", "نعم، إعادة نشر مطلوبة.", "حدّث callback/client configuration إذا تغيّر OAuth client.", "ألغِ السر القديم بعد نجاح callback جديد."),
  },
  {
    key: "BETTER_AUTH_SECRET",
    section: "authentication",
    service: "Better Auth",
    account: "NASAQ deployment",
    label: "سر جلسات Better Auth",
    sensitivity: "secret",
    purpose: "توقيع وحماية جلسات المصادقة المحلية.",
    loginUrl: "/login",
    dashboardUrl: "https://vercel.com/dashboard",
    apiUrl: "/api/auth",
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("ولّد سرًا عشوائيًا جديدًا في مزود النشر، ثم حدّثه وأعد النشر؛ ستنتهي الجلسات الحالية.", "https://vercel.com/dashboard", "BETTER_AUTH_SECRET", "Production / Preview / Development حسب البيئة", "نعم، إعادة نشر مطلوبة.", "لا يوجد Webhook.", "ألغِ القيمة القديمة بعد التأكد من عمل تسجيل الدخول الجديد."),
  },
  {
    key: "BETTER_AUTH_URL",
    section: "authentication",
    service: "Better Auth",
    account: "NASAQ deployment",
    label: "عنوان Better Auth",
    sensitivity: "public",
    purpose: "العنوان الأساسي لتوليد callback وروابط Google OAuth في النشر.",
    loginUrl: "/login",
    dashboardUrl: "https://vercel.com/dashboard",
    apiUrl: "/api/auth",
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("حدّث العنوان عند تغيير النطاق، ثم حدّث OAuth callback في broker وأعد النشر.", "https://vercel.com/dashboard", "BETTER_AUTH_URL", "Production / Preview حسب النطاق", "نعم، إعادة نشر مطلوبة.", "نعم، راجع callback URLs في broker."),
  },
  {
    key: "DATABASE_URL",
    section: "database",
    service: "Neon / PostgreSQL",
    account: "NASAQ production database",
    label: "رابط اتصال قاعدة البيانات",
    sensitivity: "secret",
    purpose: "قاعدة البيانات الدائمة للتراخيص والمصادقة ومحتوى الإدارة.",
    loginUrl: "https://console.neon.tech",
    dashboardUrl: "https://console.neon.tech",
    apiUrl: null,
    configurationLocation: "Vercel → Settings → Environment Variables؛ Neon connection details",
    guide: guide("أنشئ connection string جديدًا من Neon، حدّث Vercel، ثم أعد النشر وشغّل migrations.", "https://console.neon.tech", "DATABASE_URL", "Production / Preview بحسب قاعدة البيانات", "نعم، إعادة نشر ومراجعة migrations مطلوبة.", "لا يوجد Webhook.", "ألغِ endpoint أو كلمة المرور القديمة من Neon بعد التحقق."),
  },
  {
    key: "XAI_API_KEY",
    section: "ai",
    service: "xAI",
    account: "xAI API account",
    label: "مفتاح xAI API",
    sensitivity: "secret",
    purpose: "توليد مسودات تقارير حقيقية عبر server-side xAI provider.",
    loginUrl: xaiDashboard,
    dashboardUrl: xaiDashboard,
    apiUrl: "https://api.x.ai/v1",
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("أنشئ مفتاحًا جديدًا من xAI Console، حدّث Vercel، ثم أعد النشر واختبر تقريرًا مرخصًا.", xaiDashboard, "XAI_API_KEY", "Production / Preview / Development حسب البيئة", "نعم، إعادة نشر مطلوبة.", "لا يوجد Webhook.", "ألغِ المفتاح القديم من xAI بعد نجاح الطلب الجديد."),
  },
  {
    key: "NASAQ_AI_MODEL",
    section: "ai",
    service: "xAI",
    account: "NASAQ AI configuration",
    label: "النموذج",
    sensitivity: "public",
    purpose: "اسم النموذج الذي يطلبه provider؛ fallback الحالي grok-3-mini.",
    loginUrl: xaiDashboard,
    dashboardUrl: xaiDashboard,
    apiUrl: "https://api.x.ai/v1",
    configurationLocation: "Vercel environment؛ fallback في src/lib/ai/provider.server.ts",
    fallbackValue: "grok-3-mini",
    guide: guide("اختر نموذجًا مدعومًا من xAI ثم حدّث المتغير واختبر schema المسودة.", xaiDashboard, "NASAQ_AI_MODEL"),
  },
  {
    key: "LEMONSQUEEZY_API_KEY",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Lemon Squeezy API account",
    label: "مفتاح API الموثق في المثال",
    sensitivity: "secret",
    purpose: "موثق في .env.example فقط؛ لا يوجد استخدام برمجي حاليًا في NASAQ.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: ".env.example:2؛ لا يظهر استدعاء له في src/",
    guide: guide("إن كان مطلوبًا مستقبلًا، أنشئ API key من Lemon Squeezy ثم أضفه في Vercel؛ لا تفعّله قبل إضافة استخدام مقصود.", lemonDashboard, "LEMONSQUEEZY_API_KEY", "Production / Preview حسب الحاجة", "نعم عند إضافته.", "لا يوجد Webhook مرتبط بهذا المتغير.", "ألغِ المفتاح القديم من Lemon Squeezy بعد التحقق."),
  },
  {
    key: "LEMONSQUEEZY_STORE_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Store",
    label: "Store ID",
    sensitivity: "sensitive",
    purpose: "مطابقة metadata الواردة من Lemon Squeezy مع NASAQ.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel → Settings → Environment Variables؛ placeholder في .env.example:3",
    guide: guide("انسخ Store ID من إعدادات المتجر ثم حدّث القيمة في Vercel.", lemonDashboard, "LEMONSQUEEZY_STORE_ID"),
  },
  {
    key: "LEMONSQUEEZY_PRODUCT_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Product 1372880",
    label: "Product ID",
    sensitivity: "public",
    purpose: "مطابقة المنتج المسموح به في license metadata.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel environment؛ example value في .env.example:4",
    exampleValue: "1372880",
    guide: guide("تأكد من Product ID في Lemon Squeezy ثم حدّثه إذا تغيّر المنتج.", lemonDashboard, "LEMONSQUEEZY_PRODUCT_ID"),
  },
  {
    key: "LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Individual monthly",
    label: "Variant ID — فردي شهري",
    sensitivity: "public",
    purpose: "تحديد variant خطة الفردي الشهري في checkout.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel environment؛ example value في .env.example:5",
    exampleValue: "2145099",
    guide: guide("تأكد من Variant ID في المنتج ثم حدّثه في إعدادات النشر.", lemonDashboard, "LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID"),
  },
  {
    key: "LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Individual quarterly",
    label: "Variant ID — فردي ربع سنوي",
    sensitivity: "public",
    purpose: "تحديد variant خطة الفردي الربع سنوي في checkout.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel environment؛ example value في .env.example:6",
    exampleValue: "2145142",
    guide: guide("تأكد من Variant ID في المنتج ثم حدّثه في إعدادات النشر.", lemonDashboard, "LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID"),
  },
  {
    key: "LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Team monthly",
    label: "Variant ID — فريق شهري",
    sensitivity: "public",
    purpose: "تحديد variant خطة الفريق الشهرية في checkout.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel environment؛ example value في .env.example:7",
    exampleValue: "2147936",
    guide: guide("تأكد من Variant ID في المنتج ثم حدّثه في إعدادات النشر.", lemonDashboard, "LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID"),
  },
  {
    key: "LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID",
    section: "payments",
    service: "Lemon Squeezy",
    account: "Team quarterly",
    label: "Variant ID — فريق ربع سنوي",
    sensitivity: "public",
    purpose: "تحديد variant خطة الفريق الربع سنوية في checkout.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: "Vercel environment؛ example value في .env.example:8",
    exampleValue: "2147937",
    guide: guide("تأكد من Variant ID في المنتج ثم حدّثه في إعدادات النشر.", lemonDashboard, "LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID"),
  },
  ...[
    ["INDIVIDUAL_MONTHLY", "فردي شهري", "9"],
    ["INDIVIDUAL_QUARTERLY", "فردي ربع سنوي", "10"],
    ["TEAM_MONTHLY", "فريق شهري", "11"],
    ["TEAM_QUARTERLY", "فريق ربع سنوي", "12"],
  ].map(([suffix, label, line]) => ({
    key: `LEMONSQUEEZY_${suffix}_CHECKOUT_URL`,
    section: "payments" as const,
    service: "Lemon Squeezy",
    account: label,
    label: `Checkout URL — ${label}`,
    sensitivity: "sensitive" as const,
    purpose: "رابط checkout المخصص لخطة NASAQ.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: lemonApi,
    configurationLocation: `Vercel environment؛ example value في .env.example:${line}`,
    guide: guide("أنشئ أو انسخ checkout URL من Lemon Squeezy ثم حدّث قيمة النشر.", lemonDashboard, `LEMONSQUEEZY_${suffix}_CHECKOUT_URL`),
  })),
  {
    key: "LEMONSQUEEZY_WEBHOOK_SECRET",
    section: "webhooks",
    service: "Lemon Squeezy",
    account: "NASAQ webhook",
    label: "Webhook signing secret",
    sensitivity: "secret",
    purpose: "التحقق من توقيع webhook قبل تسجيل أو تحديث الترخيص.",
    loginUrl: lemonDashboard,
    dashboardUrl: lemonDashboard,
    apiUrl: `${productionUrl}/api/webhooks/lemonsqueezy`,
    configurationLocation: "Vercel → Settings → Environment Variables؛ endpoint في src/routes/api/webhooks/lemonsqueezy.ts",
    guide: guide("ولّد secret جديدًا من إعدادات Webhooks في Lemon Squeezy، حدّث Vercel، ثم اختبر event موقّعًا.", lemonDashboard, "LEMONSQUEEZY_WEBHOOK_SECRET", "Production / Preview حسب endpoint", "نعم، إعادة نشر مطلوبة.", "نعم، حدّث secret في إعدادات Webhook.", "ألغِ secret القديم بعد نجاح event الجديد."),
  },
  {
    key: "GROK_GATE_ORIGIN",
    section: "authentication",
    service: "Grok app gate",
    account: "NASAQ deployment",
    label: "مصدر بوابة Grok",
    sensitivity: "public",
    purpose: "تثبيت مصدر gate عند استخدام Grok preview أو deployment.",
    loginUrl: "https://grok.com",
    dashboardUrl: "https://grok.com",
    apiUrl: null,
    configurationLocation: "Injected platform environment؛ مستخدم في src/lib/auth/gate-identity.ts",
    guide: guide("لا تغيّره يدويًا إلا عند نقل التطبيق بين بوابات Grok موثقة.", "https://grok.com", "GROK_GATE_ORIGIN"),
  },
  {
    key: "GROK_CONNECTORS_URL",
    section: "services",
    service: "Grok connectors",
    account: "Platform-managed",
    label: "عنوان موصلات Grok",
    sensitivity: "sensitive",
    purpose: "عنوان خدمة المنصة لبيانات الموصلات؛ ليس خدمة NASAQ مستقلة.",
    loginUrl: "https://grok.com",
    dashboardUrl: "https://grok.com",
    apiUrl: null,
    configurationLocation: "Injected platform environment؛ لا تغيّره من NASAQ.",
    ownerReadable: false,
    guide: guide("اطلب تغييرًا من مالك منصة Grok؛ لا تُنشئ قيمة بديلة داخل NASAQ.", "https://grok.com", "GROK_CONNECTORS_URL", "Platform-managed", "لا تعيد نشر NASAQ لتغييره.", "لا يوجد Webhook.", "لا تحاول إلغاء قيمة المنصة من NASAQ."),
  },
  {
    key: "GROK_CONNECTOR_ACCESS_TOKEN",
    section: "services",
    service: "Grok connectors",
    account: "Platform-managed",
    label: "رمز وصول الموصلات",
    sensitivity: "secret",
    purpose: "رمز منصة لا يجب عرضه أو تصديره من Owner Vault.",
    loginUrl: "https://grok.com",
    dashboardUrl: "https://grok.com",
    apiUrl: null,
    configurationLocation: "Injected platform environment؛ لا تخزنه في NASAQ.",
    ownerReadable: false,
    guide: guide("اطلب تدوير الرمز من مالك منصة Grok؛ لا تنسخه إلى NASAQ أو أي export.", "https://grok.com", "GROK_CONNECTOR_ACCESS_TOKEN", "Platform-managed", "لا تعيد نشر NASAQ لتغييره.", "لا يوجد Webhook.", "يجب أن تتم الإزالة من منصة Grok فقط."),
  },
  {
    key: "VITE_STUN_URLS",
    section: "services",
    service: "WebRTC / P2P",
    account: "Public STUN providers",
    label: "عناوين STUN",
    sensitivity: "public",
    purpose: "تسهيل اتصال P2P في وضع التعاون؛ fallback يستخدم Google STUN.",
    loginUrl: null,
    dashboardUrl: "https://webrtc.org",
    apiUrl: null,
    configurationLocation: "Vercel environment؛ fallback في src/lib/multiplayer/p2p.ts",
    fallbackValue: "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
    guide: guide("غيّر قائمة STUN فقط إذا كان اتصال P2P يحتاج مزودًا مختلفًا ثم أعد النشر.", "https://webrtc.org", "VITE_STUN_URLS"),
  },
];

const ROUTES: OwnerRouteInfo[] = [
  { label: "لوحة الإدارة", path: "/admin", status: "active", purpose: "إدارة القوالب والإعدادات والتراخيص." },
  { label: "NASAQ Owner Vault", path: "/owner-vault", status: "active", purpose: "جرد المالك والبيانات الحساسة وإرشادات التغيير." },
  { label: "تسجيل الدخول", path: "/login", status: "active", purpose: "مصادقة Better Auth / Grok." },
  { label: "المحرر", path: "/editor", status: "active", purpose: "إنشاء التقارير والتصاميم." },
  { label: "المشاريع", path: "/projects", status: "active", purpose: "مكتبة مشاريع المستخدم." },
  { label: "القوالب", path: "/templates", status: "active", purpose: "كتالوج القوالب." },
  { label: "الشراء", path: "/purchase", status: "active", purpose: "تدفق شراء Lemon Squeezy." },
  { label: "الترخيص", path: "/license", status: "active", purpose: "تفعيل وإدارة الترخيص." },
  { label: "واجهة الهوية", path: "/الهوية", status: "active", purpose: "هوية وتقارير NASAQ." },
  { label: "API المصادقة", path: "/api/auth/*", status: "active", purpose: "Better Auth callbacks والجلسات." },
  { label: "API إعدادات checkout", path: "/api/checkout/config", status: "active", purpose: "إعدادات checkout العامة غير السرية." },
  { label: "Lemon Squeezy webhook", path: "/api/webhooks/lemonsqueezy", status: "active", purpose: "استقبال أحداث الدفع الموقّعة." },
  { label: "License APIs", path: "/api/license/*", status: "active", purpose: "تفعيل والتحقق وإلغاء التراخيص." },
];

function envEntry(spec: EnvSpec): VaultEntry {
  const runtimeValue = envValue(spec.key);
  const sourceValue = spec.exampleValue ?? spec.fallbackValue;
  const ownerReadable = spec.ownerReadable !== false;
  const origin: VaultOrigin = runtimeValue
    ? "runtime"
    : spec.exampleValue
      ? "source"
      : spec.fallbackValue
        ? "default"
        : "missing";
  return {
    id: `env.${spec.key}`,
    section: spec.section,
    service: spec.service,
    account: spec.account,
    label: spec.label,
    variable: spec.key,
    value: ownerReadable ? (runtimeValue ?? sourceValue ?? null) : null,
    ownerReadable,
    configured: Boolean(runtimeValue),
    origin,
    sensitivity: spec.sensitivity,
    loginUrl: spec.loginUrl,
    dashboardUrl: spec.dashboardUrl,
    apiUrl: spec.apiUrl,
    purpose: spec.purpose,
    configurationLocation: spec.configurationLocation,
    exposedInSource: Boolean(spec.exampleValue),
    changeGuide: spec.guide,
  };
}

function staticEntry(
  entry: Omit<VaultEntry, "variable" | "configured" | "origin" | "ownerReadable"> & {
    variable?: string;
    configured?: boolean;
    origin?: VaultOrigin;
    ownerReadable?: boolean;
  },
): VaultEntry {
  return {
    ...entry,
    variable: entry.variable ?? null,
    configured: entry.configured ?? Boolean(entry.value),
    origin: entry.origin ?? "source",
    ownerReadable: entry.ownerReadable ?? true,
  };
}

async function sourceEntries(): Promise<VaultEntry[]> {
  const { GROK_ISSUER_DEFAULT, PREVIEW_ALLOWED_HOSTS, PREVIEW_CLIENT_ID, PREVIEW_CLIENT_SECRET } = await import("@/lib/auth/preview");
  return [
    staticEntry({
      id: "auth.google.callback.production",
      section: "authentication",
      service: "Google Sign-In via Grok broker",
      account: GOOGLE_PROVIDER_ID,
      label: "Google OAuth redirect URI — Production",
      value: `${productionUrl}${GOOGLE_OAUTH_CALLBACK_PATH}`,
      sensitivity: "public",
      loginUrl: "https://accounts.google.com/",
      dashboardUrl: "https://console.cloud.google.com/apis/credentials",
      apiUrl: `${authBroker}/api/auth/oauth2/authorize`,
      purpose: "القيمة الفعلية التي يبنيها Better Auth لهذا التطبيق عند إعادة Google إلى NASAQ.",
      configurationLocation: "Better Auth genericOAuth في src/lib/auth/server.ts؛ route handler في src/routes/api/auth/$.ts.",
      exposedInSource: true,
      changeGuide: guide("أضف URI نفسه حرفيًا في OAuth Web Client الذي يستخدمه broker، ولا تضف wildcard.", "https://console.cloud.google.com/apis/credentials", "BETTER_AUTH_URL + ${GOOGLE_OAUTH_CALLBACK_PATH}", "Production", "نعم إذا تغيّر النطاق أو BETTER_AUTH_URL.", "راجع callback في broker إذا تغيّر Google client.", "أزل URI القديم بعد نجاح النطاق الجديد."),
    }),
    staticEntry({
      id: "auth.google.scopes",
      section: "authentication",
      service: "Google Sign-In via Grok broker",
      account: GOOGLE_PROVIDER_ID,
      label: "Google OAuth scopes",
      value: "openid profile email",
      sensitivity: "public",
      loginUrl: "https://accounts.google.com/",
      dashboardUrl: "https://console.cloud.google.com/apis/credentials",
      apiUrl: `${authBroker}/api/auth/oauth2/authorize`,
      purpose: "الحد الأدنى المطلوب لإنشاء جلسة وهوية NASAQ؛ لا يطلب Drive أو Gmail أو Calendar أو Contacts.",
      configurationLocation: "src/lib/auth/server.ts: genericOAuth scopes.",
      exposedInSource: true,
      changeGuide: guide("لا توسّع scopes إلا مع ميزة واضحة وموافقة جديدة من المستخدم.", "https://console.cloud.google.com/apis/credentials", "src/lib/auth/server.ts"),
    }),
    staticEntry({
      id: "source.preview.client-id",
      section: "authentication",
      service: "Grok auth broker",
      account: "Shared live preview OAuth client",
      label: "Preview OAuth client ID",
      value: PREVIEW_CLIENT_ID,
      sensitivity: "sensitive",
      loginUrl: GROK_ISSUER_DEFAULT,
      dashboardUrl: GROK_ISSUER_DEFAULT,
      apiUrl: `${GROK_ISSUER_DEFAULT}/api/auth/oauth2/authorize`,
      purpose: "عميل OAuth منخفض الصلاحية لقبول callback للمعاينة الحية.",
      configurationLocation: "src/lib/auth/preview.ts:19؛ يطابق broker preview client.",
      exposedInSource: true,
      changeGuide: guide("غيّر client ID مع إعداد broker preview ثم اختبر callback للمعاينة.", GROK_ISSUER_DEFAULT, "src/lib/auth/preview.ts:19", "Live preview فقط", "لا، إلا عند تغيير broker.", "راجع callback wildcard في broker.", "ألغِ العميل القديم من broker بعد التحقق."),
    }),
    staticEntry({
      id: "source.preview.client-secret",
      section: "authentication",
      service: "Grok auth broker",
      account: "Shared live preview OAuth client",
      label: "Preview OAuth client secret",
      value: PREVIEW_CLIENT_SECRET,
      sensitivity: "secret",
      loginUrl: GROK_ISSUER_DEFAULT,
      dashboardUrl: GROK_ISSUER_DEFAULT,
      apiUrl: `${GROK_ISSUER_DEFAULT}/api/auth/oauth2/token`,
      purpose: "سر OAuth للمعاينة الحية؛ committed source finding يحتاج تدويرًا يدويًا.",
      configurationLocation: "src/lib/auth/preview.ts:20-21؛ broker preview environment.",
      exposedInSource: true,
      changeGuide: guide("ولّد سرًا جديدًا في broker ثم حدّث constant المصدر معًا، وأعد اختبار تسجيل الدخول.", GROK_ISSUER_DEFAULT, "src/lib/auth/preview.ts:20-21", "Live preview فقط", "لا، إلا عند تغيير المصدر أو broker.", "لا يوجد Webhook.", "ألغِ السر القديم من broker بعد نجاح المعاينة."),
    }),
    staticEntry({
      id: "source.preview.issuer",
      section: "authentication",
      service: "Grok auth broker",
      account: "Shared broker",
      label: "Preview issuer",
      value: GROK_ISSUER_DEFAULT,
      sensitivity: "public",
      loginUrl: GROK_ISSUER_DEFAULT,
      dashboardUrl: GROK_ISSUER_DEFAULT,
      apiUrl: `${GROK_ISSUER_DEFAULT}/.well-known/openid-configuration`,
      purpose: "مُصدر OIDC المشترك للمعاينة.",
      configurationLocation: "src/lib/auth/preview.ts:24؛ overridden by GROK_AUTH_ISSUER عند النشر.",
      exposedInSource: true,
      changeGuide: guide("لا تغيّره إلا عند نقل broker وتحديث discovery وcallbacks.", GROK_ISSUER_DEFAULT, "src/lib/auth/preview.ts:24"),
    }),
    staticEntry({
      id: "source.preview.allowed-hosts",
      section: "authentication",
      service: "Grok auth broker",
      account: "Shared live preview OAuth client",
      label: "Preview callback host policy",
      value: PREVIEW_ALLOWED_HOSTS.join(", "),
      sensitivity: "public",
      loginUrl: GROK_ISSUER_DEFAULT,
      dashboardUrl: GROK_ISSUER_DEFAULT,
      apiUrl: null,
      purpose: "النطاقات التي يسمح بها عميل المعاينة للـ callback.",
      configurationLocation: "src/lib/auth/preview.ts:31؛ broker preview OAuth policy.",
      exposedInSource: true,
      changeGuide: guide("حدّث القائمة في broker والمصدر معًا عند تغيير نطاق المعاينة.", GROK_ISSUER_DEFAULT, "src/lib/auth/preview.ts:31"),
    }),
  ];
}

function serviceEntries(): VaultEntry[] {
  return [
    staticEntry({
      id: "service.github.repository",
      section: "accounts",
      service: "GitHub",
      account: "desfe9l",
      label: "المستودع المصدر",
      value: githubRepo,
      sensitivity: "public",
      loginUrl: "https://github.com/login",
      dashboardUrl: githubRepo,
      apiUrl: "https://api.github.com",
      purpose: "المستودع المرتبط بمصدر NASAQ وPRs.",
      configurationLocation: ".git/config remote origin؛ GitHub repository settings.",
      exposedInSource: false,
      changeGuide: guide("غيّر remote أو صلاحيات المستودع من GitHub فقط بعد التأكد من deploy integration.", githubRepo, ".git/config وGitHub repository settings"),
    }),
    staticEntry({
      id: "service.vercel.project",
      section: "deployment",
      service: "Vercel",
      account: "desfe9l / NASAQ",
      label: "مشروع النشر",
      value: productionUrl,
      sensitivity: "public",
      loginUrl: "https://vercel.com/login",
      dashboardUrl: vercelDashboard,
      apiUrl: null,
      purpose: "نشر تطبيق NASAQ عبر Vercel preset.",
      configurationLocation: "vite.config.ts؛ Vercel project settings.",
      exposedInSource: false,
      changeGuide: guide("غيّر متغيرات النشر أو النطاق من Vercel ثم أعد deployment.", vercelDashboard, "Vercel → Project Settings → Environment Variables"),
    }),
    staticEntry({
      id: "service.production.url",
      section: "domain",
      service: "Vercel domain",
      account: "Default production domain",
      label: "عنوان الإنتاج",
      value: productionUrl,
      sensitivity: "public",
      loginUrl: productionUrl,
      dashboardUrl: vercelDashboard,
      apiUrl: `${productionUrl}/api/checkout/config`,
      purpose: "عنوان الإنتاج المستخدم لبناء webhook وlinks التشغيلية.",
      configurationLocation: "Vercel project domain settings؛ مرجع ثابت في Owner Vault.",
      exposedInSource: false,
      changeGuide: guide("عند ربط نطاق مخصص، حدّث Vercel وBETTER_AUTH_URL وWebhook callback references.", vercelDashboard, "Vercel → Domains"),
    }),
    staticEntry({
      id: "service.email.missing",
      section: "services",
      service: "Email delivery",
      account: "غير مهيأ",
      label: "إرسال البريد",
      value: null,
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لم يظهر مزود بريد أو متغير SMTP/transactional email في المصدر.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("اختر مزودًا وأضف server-only credentials فقط عند طلب ميزة بريد فعلية.", null, "سياسة البنية التحتية والمزود المختار"),
    }),
    staticEntry({
      id: "service.analytics.missing",
      section: "services",
      service: "Analytics",
      account: "غير مهيأ",
      label: "التحليلات",
      value: null,
      configured: false,
      origin: "missing",
      sensitivity: "public",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لم يظهر Google Analytics أو PostHog أو مزود قياس آخر في المصدر.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("أضف تحليلات فقط بعد تحديد سياسة الخصوصية ومكان تحميل السكربت.", null, "سياسة الخصوصية وsrc/routes/__root.tsx"),
    }),
    staticEntry({
      id: "service.storage.missing",
      section: "services",
      service: "Object storage",
      account: "غير مهيأ",
      label: "تخزين الملفات",
      value: null,
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لم يظهر S3 أو R2 أو Blob storage؛ الملفات الحالية تعتمد على قاعدة البيانات أو المتصفح.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("اختر تخزينًا مناسبًا وأضف signed upload flow قبل تخزين ملفات مستخدمين.", null, "خطة التخزين ومسارات upload server-side"),
    }),
    staticEntry({
      id: "service.monitoring.missing",
      section: "services",
      service: "Monitoring / error tracking",
      account: "غير مهيأ",
      label: "المراقبة",
      value: null,
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لم يظهر Sentry أو Datadog أو مزود مراقبة خارجي في المصدر.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("اختر مزودًا لا يرسل الأسرار أو محتوى التقارير، ثم أضف source maps وسياسة retention.", null, "خطة المراقبة وVercel project settings"),
    }),
  ];
}

function findings(entries: VaultEntry[], ownerConfigured: boolean): OwnerVaultFinding[] {
  const result: OwnerVaultFinding[] = [];
  const runtime = (key: string) => entries.find((entry) => entry.variable === key)?.configured;
  if (!ownerConfigured) {
    result.push({
      severity: "high",
      title: "هوية MASTER OWNER غير مهيأة",
      detail: "NASAQ_OWNER_ID وNASAQ_OWNER_EMAIL غير موجودين في runtime الحالي.",
      action: "عيّن أحدهما في Vercel ثم أعد النشر قبل استخدام لوحة المالك.",
    });
  }
  if (!runtime("DATABASE_URL")) {
    result.push({
      severity: "high",
      title: "قاعدة الإنتاج غير مثبتة في runtime الحالي",
      detail: "DATABASE_URL غير مهيأ؛ النشر قد يستخدم fallback غير دائم أو يفشل مع العمليات الموثقة.",
      action: "اربط قاعدة Neon production واختبر migrations قبل فتح الاستخدام العام.",
    });
  }
  if (!runtime("XAI_API_KEY")) {
    result.push({
      severity: "medium",
      title: "xAI غير مهيأ",
      detail: "XAI_API_KEY غير موجود؛ ميزات المسودات الحقيقية ستعيد خطأ إعداد الخادم.",
      action: "أضف مفتاح xAI server-only بعد اعتماد حدود الإنفاق.",
    });
  }
  if (!runtime("LEMONSQUEEZY_WEBHOOK_SECRET")) {
    result.push({
      severity: "medium",
      title: "Lemon Squeezy webhook غير موثق",
      detail: "LEMONSQUEEZY_WEBHOOK_SECRET غير موجود؛ endpoint سيرفض الأحداث الموقعة.",
      action: "أضف secret مطابقًا لإعداد Webhook في Lemon Squeezy.",
    });
  }
  const exposed = entries.find((entry) => entry.id === "source.preview.client-secret");
  if (exposed?.exposedInSource) {
    result.push({
      severity: "high",
      title: "سر OAuth للمعاينة موجود في المصدر",
      detail: "سر preview OAuth committed في src/lib/auth/preview.ts؛ Owner Vault لا يدوّر الأسرار تلقائيًا.",
      action: "دوّره يدويًا في broker والمصدر معًا، ثم أعد اختبار تسجيل الدخول.",
    });
  }
  result.push({
    severity: "info",
    title: "لا توجد خدمة بريد أو تحليلات أو تخزين ملفات أو مراقبة ظاهرة",
    detail: "تم إدراجها كغير مهيأة بدل اختراع حسابات أو أسرار غير موجودة.",
    action: "لا تضف تكاملًا إلا عند وجود حاجة واضحة وقرار من المالك.",
  });
  return result;
}

export async function buildOwnerVaultInventory(): Promise<OwnerVaultInventory> {
  const entries = [...ENV_SPECS.map(envEntry), ...(await sourceEntries()), ...serviceEntries()];
  const ownerConfigured = Boolean(envValue("NASAQ_OWNER_ID") || envValue("NASAQ_OWNER_EMAIL"));
  return {
    generatedAt: new Date().toISOString(),
    environment: currentEnvironment(),
    ownerConfigured,
    entries,
    routes: ROUTES,
    findings: findings(entries, ownerConfigured),
  };
}

export const getOwnerVaultFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
    const authorization = await getAuthorizationContext({ id: context.userId, email: context.userEmail });
    if (!authorization.isOwner) throw new Error("Forbidden");
    return buildOwnerVaultInventory();
  });
