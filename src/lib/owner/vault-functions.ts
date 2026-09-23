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
const keygenDashboard = "https://beta.portal.keygen.sh";
const keygenApi = "https://api.keygen.sh/v1";
const xaiDashboard = "https://console.x.ai";
const googleConsole = "https://console.cloud.google.com/apis/credentials";

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
    service: "Better Auth / Google",
    account: "NASAQ deployment",
    label: "تفعيل المصادقة",
    sensitivity: "public",
    purpose: "يحدد ما إذا كان تسجيل الدخول الحقيقي مفعلًا؛ الافتراضي في الكود هو التشغيل.",
    loginUrl: "/login",
    dashboardUrl: googleConsole,
    apiUrl: "/api/auth",
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
    key: "GOOGLE_CLIENT_ID",
    section: "authentication",
    service: "Google OAuth",
    account: "NASAQ Web OAuth client",
    label: "Google OAuth client ID",
    sensitivity: "sensitive",
    purpose: "معرّف عميل NASAQ المستخدم في تسجيل الدخول المباشر عبر Google.",
    loginUrl: "https://accounts.google.com/",
    dashboardUrl: googleConsole,
    apiUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("استخدم Web OAuth client نفسه الذي يحتوي على callback الخاص بـ NASAQ.", googleConsole, "GOOGLE_CLIENT_ID"),
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    section: "authentication",
    service: "Google OAuth",
    account: "NASAQ Web OAuth client",
    label: "Google OAuth client secret",
    sensitivity: "secret",
    purpose: "السر server-side الذي يبادل رمز Google بجلسة NASAQ.",
    loginUrl: "https://accounts.google.com/",
    dashboardUrl: googleConsole,
    apiUrl: "https://oauth2.googleapis.com/token",
    configurationLocation: "Vercel → Settings → Environment Variables",
    guide: guide("حدّث السر في Vercel فقط، أعد النشر، ثم اختبر Google callback.", googleConsole, "GOOGLE_CLIENT_SECRET", "Production / Preview / Development حسب البيئة", "نعم، إعادة نشر مطلوبة.", "لا يوجد Webhook.", "ألغِ السر القديم بعد التحقق من تسجيل الدخول الجديد."),
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
    guide: guide("حدّث العنوان عند تغيير النطاق، ثم حدّث Google OAuth callback وأعد النشر.", "https://vercel.com/dashboard", "BETTER_AUTH_URL", "Production / Preview حسب النطاق", "نعم، إعادة نشر مطلوبة.", "نعم، راجع callback URL في Google Cloud."),
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
    key: "KEYGEN_API_TOKEN",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Keygen server API token",
    sensitivity: "secret",
    purpose: "قراءة entitlements وتنفيذ إجراءات الإدارة من الخادم فقط.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel → Settings → Environment Variables؛ server-only في src/lib/license/keygen.ts",
    guide: guide("أنشئ Product token محدود الصلاحيات من Keygen Portal بصلاحيات entitlement.read وlicense.create وlicense.update وlicense.suspend وlicense.reinstate، ثم أضفه في Vercel ولا ترسله في الدردشة.", keygenDashboard, "KEYGEN_API_TOKEN", "Production / Preview / Development حسب الحاجة", "نعم، إعادة نشر مطلوبة.", "لا يوجد Lemon webhook؛ Keygen webhook يستخدم KEYGEN_PUBLIC_KEY.", "ألغِ token القديم بعد نجاح التحقق."),
  },
  {
    key: "KEYGEN_PUBLIC_KEY",
    section: "webhooks",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Keygen webhook public key",
    sensitivity: "sensitive",
    purpose: "التحقق من توقيع أحداث Keygen قبل مزامنة حالة الترخيص محليًا.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel → Settings → Environment Variables؛ endpoint في src/routes/api/webhooks/keygen.ts",
    guide: guide("انسخ public key من إعدادات Keygen وأضفه في Vercel؛ هذه ليست قيمة سرية لكنها يجب أن تطابق الحساب.", keygenDashboard, "KEYGEN_PUBLIC_KEY", "Production / Preview حسب endpoint", "نعم، إعادة نشر مطلوبة.", "اربط endpoint /api/webhooks/keygen في Keygen.", "استبدل المفتاح فقط بعد تحديث Keygen والتحقق من التوقيع الجديد."),
  },
  {
    key: "KEYGEN_ACCOUNT_SLUG",
    section: "payments",
    service: "Keygen Portal",
    account: "ararcomksa-twilight-fire-2288",
    label: "Keygen account slug",
    sensitivity: "public",
    purpose: "تحديد حساب NASAQ في Keygen API.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: ".env.example وsrc/lib/license/keygen.ts",
    exampleValue: "ararcomksa-twilight-fire-2288",
    guide: guide("حدّث slug فقط إذا نُقل المنتج إلى حساب Keygen آخر.", keygenDashboard, "KEYGEN_ACCOUNT_SLUG", "Production / Preview / Development", "نعم، أعد النشر بعد التغيير."),
  },
  {
    key: "KEYGEN_PRODUCT_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ",
    label: "Keygen product ID",
    sensitivity: "public",
    purpose: "تقييد validation على منتج NASAQ فقط.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: ".env.example وsrc/lib/license/keygen.ts",
    exampleValue: "c109271b-9c97-4827-bc9d-48e7982744fe",
    guide: guide("انسخ Product ID من Keygen عند تغيير المنتج، ثم حدّث القيمة في بيئات النشر.", keygenDashboard, "KEYGEN_PRODUCT_ID", "Production / Preview / Development", "نعم، أعد النشر بعد التغيير."),
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
  { label: "Keygen webhook", path: "/api/webhooks/keygen", status: "active", purpose: "مزامنة حالة التراخيص الموقّعة من Keygen." },
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
  return [
    staticEntry({
      id: "auth.google.callback.production",
      section: "authentication",
      service: "Direct Google Sign-In",
      account: GOOGLE_PROVIDER_ID,
      label: "Google OAuth redirect URI — Production",
      value: `${productionUrl}${GOOGLE_OAUTH_CALLBACK_PATH}`,
      sensitivity: "public",
      loginUrl: "https://accounts.google.com/",
      dashboardUrl: "https://console.cloud.google.com/apis/credentials",
      apiUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      purpose: "القيمة الفعلية التي يبنيها Better Auth لإعادة Google مباشرة إلى NASAQ.",
      configurationLocation: "Better Auth socialProviders.google في src/lib/auth/server.ts؛ route handler في src/routes/api/auth/$.ts.",
      exposedInSource: true,
      changeGuide: guide("أضف URI نفسه حرفيًا في Google Web OAuth Client، ولا تضف wildcard.", "https://console.cloud.google.com/apis/credentials", "BETTER_AUTH_URL + ${GOOGLE_OAUTH_CALLBACK_PATH}", "Production", "نعم إذا تغيّر النطاق أو BETTER_AUTH_URL.", "راجع callback في Google Cloud إذا تغيّر النطاق.", "أزل URI القديم بعد نجاح النطاق الجديد."),
    }),
    staticEntry({
      id: "auth.google.scopes",
      section: "authentication",
      service: "Direct Google Sign-In",
      account: GOOGLE_PROVIDER_ID,
      label: "Google OAuth scopes",
      value: "openid profile email",
      sensitivity: "public",
      loginUrl: "https://accounts.google.com/",
      dashboardUrl: "https://console.cloud.google.com/apis/credentials",
      apiUrl: "https://oauth2.googleapis.com/token",
      purpose: "الحد الأدنى المطلوب لإنشاء جلسة وهوية NASAQ؛ لا يطلب Drive أو Gmail أو Calendar أو Contacts.",
      configurationLocation: "src/lib/auth/server.ts: socialProviders.google scopes.",
      exposedInSource: true,
      changeGuide: guide("لا توسّع scopes إلا مع ميزة واضحة وموافقة جديدة من المستخدم.", "https://console.cloud.google.com/apis/credentials", "src/lib/auth/server.ts"),
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
  if (!runtime("KEYGEN_API_TOKEN")) {
    result.push({
      severity: "medium",
      title: "Keygen API token غير مهيأ",
      detail: "KEYGEN_API_TOKEN غير موجود؛ لا يمكن قراءة entitlements أو تنفيذ إجراءات الإدارة.",
      action: "أنشئ token خادم محدود الصلاحيات من Keygen Portal وأضفه يدويًا في Vercel.",
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
