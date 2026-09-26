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
    guide: guide("أنشئ Product token محدود الصلاحيات من Keygen Portal بصلاحيات entitlement.read وlicense.create وlicense.update وlicense.suspend وlicense.reinstate، ثم أضفه في Vercel ولا ترسله في الدردشة.", keygenDashboard, "KEYGEN_API_TOKEN", "Production / Preview / Development حسب الحاجة", "نعم، إعادة نشر مطلوبة.", "Gumroad Ping endpoint /api/webhooks/gumroad", "ألغِ token القديم بعد نجاح التحقق."),
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
    key: "GUMROAD_ACCESS_TOKEN",
    section: "payments",
    service: "Gumroad API",
    account: "nasaqar.gumroad.com",
    label: "Gumroad access token (تطبيق خاص بحساب المتجر)",
    sensitivity: "secret",
    purpose: "تحقق خادمي من كل عملية بيع/تجديد قبل إصدار ترخيص Keygen، ومزامنة حالة الاشتراكات.",
    loginUrl: "https://gumroad.com/settings/advanced",
    dashboardUrl: "https://gumroad.com/settings/advanced",
    apiUrl: "https://api.gumroad.com/v2",
    configurationLocation: "Vercel → Settings → Environment Variables؛ server-only في src/lib/gumroad/config.server.ts",
    guide: guide("Gumroad → Settings → Advanced → Applications → Create application: Application name = NASAQ — نَسَق (تكامل الخادم)، Redirect URI = http://127.0.0.1، Application icon اختياري. بعد الإنشاء: Your applications → Edit → Generate access token، وانسخ القيمة إلى Vercel فقط — لا ترسلها في الدردشة. لا تحتاج Application ID أو Application Secret، ولا يوجد OAuth للمستخدمين في NASAQ.", "https://gumroad.com/settings/advanced", "GUMROAD_ACCESS_TOKEN", "Production", "نعم، إعادة نشر مطلوبة.", "Gumroad Ping/Resource subscriptions على endpoint /api/webhooks/gumroad", "ألغِ token القديم بعد نجاح التحقق."),
  },
  {
    key: "GUMROAD_PRODUCT_ID",
    section: "payments",
    service: "Gumroad API",
    account: "nasaqar.gumroad.com",
    label: "Gumroad product ID",
    sensitivity: "public",
    purpose: "التحقق الصارم أن كل عملية بيع تخص منتج نَسَق (مطلوب لمنتجات ما بعد 2023 في license verify).",
    loginUrl: "https://nasaqar.gumroad.com/l/auaewk",
    dashboardUrl: "https://gumroad.com/settings/advanced",
    apiUrl: "https://api.gumroad.com/v2/products",
    configurationLocation: "Vercel environment؛ server-only في src/lib/gumroad/config.server.ts",
    guide: guide("انسخ product_id من صفحة المنتج (قسم License key) أو من GET /v2/products، ثم أضفه في Vercel وأعد النشر.", "https://gumroad.com/settings/advanced", "GUMROAD_PRODUCT_ID"),
  },
  {
    key: "GUMROAD_PRODUCT_PERMALINK",
    section: "payments",
    service: "Gumroad Storefront",
    account: "nasaqar.gumroad.com",
    label: "Gumroad product permalink",
    sensitivity: "public",
    purpose: "الرابط المختصر للمنتج المنشور المستخدم في روابط الشراء والتحقق.",
    loginUrl: "https://nasaqar.gumroad.com/l/auaewk",
    dashboardUrl: "https://nasaqar.gumroad.com/l/auaewk",
    apiUrl: null,
    configurationLocation: "Vercel environment؛ fallback في src/lib/gumroad/mapping.ts",
    fallbackValue: "auaewk",
    guide: guide("غيّره فقط إذا تغير رابط منتج Gumroad، ثم أعد النشر.", "https://nasaqar.gumroad.com/l/auaewk", "GUMROAD_PRODUCT_PERMALINK"),
  },
  {
    key: "GUMROAD_TIER_INDIVIDUAL_NAME",
    section: "payments",
    service: "Gumroad Storefront",
    account: "nasaqar.gumroad.com",
    label: "Gumroad individual tier name",
    sensitivity: "public",
    purpose: "ربط Tier «فردي» في Gumroad بخطط NASAQ الفردية (اختياري؛ له قيمة افتراضية في الكود).",
    loginUrl: "https://nasaqar.gumroad.com/l/auaewk",
    dashboardUrl: "https://nasaqar.gumroad.com/l/auaewk",
    apiUrl: null,
    configurationLocation: "Vercel environment؛ fallback في src/lib/gumroad/mapping.ts",
    fallbackValue: "نَسَق | فردي",
    guide: guide("حدّثه فقط بعد إعادة تسمية Tier الفردي في Gumroad، ثم أعد النشر.", "https://nasaqar.gumroad.com/l/auaewk", "GUMROAD_TIER_INDIVIDUAL_NAME"),
  },
  {
    key: "GUMROAD_TIER_TEAM_NAME",
    section: "payments",
    service: "Gumroad Storefront",
    account: "nasaqar.gumroad.com",
    label: "Gumroad team tier name",
    sensitivity: "public",
    purpose: "ربط Tier «فريق» في Gumroad بخطط NASAQ للفرق (اختياري؛ له قيمة افتراضية في الكود).",
    loginUrl: "https://nasaqar.gumroad.com/l/auaewk",
    dashboardUrl: "https://nasaqar.gumroad.com/l/auaewk",
    apiUrl: null,
    configurationLocation: "Vercel environment؛ fallback في src/lib/gumroad/mapping.ts",
    fallbackValue: "نَسَق | فريق",
    guide: guide("حدّثه فقط بعد إعادة تسمية Tier الفريق في Gumroad، ثم أعد النشر.", "https://nasaqar.gumroad.com/l/auaewk", "GUMROAD_TIER_TEAM_NAME"),
  },
  {
    key: "KEYGEN_POLICY_TRIAL_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Trial policy ID",
    sensitivity: "public",
    purpose: "Policy المستخدمة عند إنشاء تراخيص Keygen التجريبية.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_TRIAL_ID"),
  },
  {
    key: "KEYGEN_POLICY_INDIVIDUAL_MONTHLY_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Individual monthly policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ الفردي الشهري.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_INDIVIDUAL_MONTHLY_ID"),
  },
  {
    key: "KEYGEN_POLICY_INDIVIDUAL_QUARTERLY_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Individual quarterly policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ الفردي الربع سنوي.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_INDIVIDUAL_QUARTERLY_ID"),
  },
  {
    key: "KEYGEN_POLICY_TEAM_MONTHLY_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Team monthly policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ للفرق الشهري.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_TEAM_MONTHLY_ID"),
  },
  {
    key: "KEYGEN_POLICY_TEAM_QUARTERLY_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Team quarterly policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ للفرق الربع سنوي.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_TEAM_QUARTERLY_ID"),
  },
  {
    key: "KEYGEN_POLICY_INDIVIDUAL_ANNUAL_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Individual annual policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ الفردي السنوي (غير مطروح للبيع حاليًا).",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("أنشئ Policy سنويًا في Keygen أو استخدم Policy سنوي معتمدًا ثم أضف المعرف.", keygenDashboard, "KEYGEN_POLICY_INDIVIDUAL_ANNUAL_ID"),
  },
  {
    key: "KEYGEN_POLICY_TEAM_ANNUAL_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Team annual policy ID",
    sensitivity: "public",
    purpose: "Policy اشتراك NASAQ للفرق السنوي (غير مطروح للبيع حاليًا).",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("أنشئ Policy سنويًا في Keygen أو استخدم Policy سنوي معتمدًا ثم أضف المعرف.", keygenDashboard, "KEYGEN_POLICY_TEAM_ANNUAL_ID"),
  },
  {
    key: "KEYGEN_POLICY_LIFETIME_ID",
    section: "payments",
    service: "Keygen Portal",
    account: "NASAQ licensing account",
    label: "Lifetime policy ID",
    sensitivity: "public",
    purpose: "Policy الرخص الدائمة في Keygen.",
    loginUrl: keygenDashboard,
    dashboardUrl: keygenDashboard,
    apiUrl: keygenApi,
    configurationLocation: "Vercel environment؛ server-only في src/lib/license/keygen.ts",
    guide: guide("انسخ Policy ID من Keygen ثم حدّث متغير البيئة.", keygenDashboard, "KEYGEN_POLICY_LIFETIME_ID"),
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
  { label: "الاشتراك", path: "/purchase", status: "active", purpose: "عرض الباقات وفتح Gumroad Checkout للفترة والباقة المختارتين." },
  { label: "Gumroad Ping", path: "/api/webhooks/gumroad", status: "active", purpose: "استقبال إشعارات Gumroad والتحقق منها خادميًا ثم تفعيل التراخيص عبر Keygen." },
  { label: "الترخيص", path: "/license", status: "active", purpose: "تفعيل وإدارة الترخيص." },
  { label: "واجهة الهوية", path: "/الهوية", status: "active", purpose: "هوية وتقارير NASAQ." },
  { label: "API المصادقة", path: "/api/auth/*", status: "active", purpose: "Better Auth callbacks والجلسات." },
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
  /*
   * Optional services, honestly reported. The platform needs none of email /
   * analytics / object storage / monitoring today (local-first projects, no
   * transactional mail, no tracking scripts, no server uploads, no external
   * error pipeline). Each entry therefore:
   *   • says "غير مطلوب حاليًا" instead of the misleading "غير مهيأ" error,
   *   • records the free-tier option to adopt IF the feature is ever requested,
   *   • keeps every credential server-only (Vercel env vars on the day the
   *     integration lands — nothing in code or git, ever).
   * The single info-level finding below mirrors this: no red finding, no fake
   * integration, no paid service without an owner decision.
   */
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
      apiUrl: `${productionUrl}/api/webhooks/gumroad`,
      purpose: "عنوان الإنتاج المستخدم لبناء webhook وlinks التشغيلية.",
      configurationLocation: "Vercel project domain settings؛ مرجع ثابت في Owner Vault.",
      exposedInSource: false,
      changeGuide: guide("عند ربط نطاق مخصص، حدّث Vercel وBETTER_AUTH_URL وWebhook callback references.", vercelDashboard, "Vercel → Domains"),
    }),
    staticEntry({
      id: "service.email.missing",
      section: "services",
      service: "Email delivery",
      account: "غير مطلوب حاليًا",
      label: "إرسال البريد",
      value: "غير مطلوب حاليًا — لا توجد ميزة بريد في المنصة",
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لا تعتمد المنصة على بريد معاملاتي: التفعيل عبر مفاتيح ترخيص، والتواصل عبر قنوات مباشرة. لا يُنشأ أي حساب بريد قبل وجود ميزة بريد فعلية.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("عند طلب ميزة بريد فعلية: اعتمد خيار Free Tier (مثل Resend المجانية) ثم أضف server-only credentials في Vercel فقط، بلا أسرار في الكود أو Git.", null, "سياسة البنية التحتية والمزود المختار"),
    }),
    staticEntry({
      id: "service.analytics.missing",
      section: "services",
      service: "Analytics",
      account: "غير مطلوب حاليًا",
      label: "التحليلات",
      value: "غير مطلوب حاليًا — لا يوجد تتبع في المنصة",
      configured: false,
      origin: "missing",
      sensitivity: "public",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لا تُشغّل المنصة أي سكربت قياس (لا GA ولا PostHog). تُضاف التحليلات فقط بقرار خصوصية واضح.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("عند الحاجة: اعتمد خيار Free Tier يحترم الخصوصية (مثل Cloudflare Web Analytics أو Plausible التجريبية) وحدد مكان تحميل السكربت في سياسة الخصوصية أولًا.", null, "سياسة الخصوصية وsrc/routes/__root.tsx"),
    }),
    staticEntry({
      id: "service.storage.missing",
      section: "services",
      service: "Object storage",
      account: "غير مطلوب حاليًا",
      label: "تخزين الملفات",
      value: "غير مطلوب حاليًا — التخزين محلي وقاعدة البيانات",
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "المشاريع محلية (IndexedDB) والمحتوى الإداري في قاعدة البيانات؛ لا توجد uploads خادمية تحتاج S3/R2/Blob اليوم.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("عند الحاجة لرفع ملفات مستخدمين: اعتمد خيار Free Tier (مثل Cloudflare R2 المجانية) مع signed upload flow خادمي، والأسرار في Vercel فقط.", null, "خطة التخزين ومسارات upload server-side"),
    }),
    staticEntry({
      id: "service.monitoring.missing",
      section: "services",
      service: "Monitoring / error tracking",
      account: "غير مطلوب حاليًا",
      label: "المراقبة",
      value: "غير مطلوب حاليًا — سجلات المنصة الافتراضية",
      configured: false,
      origin: "missing",
      sensitivity: "sensitive",
      loginUrl: null,
      dashboardUrl: null,
      apiUrl: null,
      purpose: "لا توجد pipeline مراقبة خارجية (لا Sentry ولا Datadog)؛ سجلات Vercel الافتراضية تكفي الحجم الحالي.",
      configurationLocation: "لا يوجد تكامل NASAQ حاليًا.",
      exposedInSource: false,
      changeGuide: guide("عند الحاجة: اعتمد خيار Free Tier (مثل Sentry المجانية) مع حجب الأسرار ومحتوى التقارير، ثم أضف source maps وسياسة retention.", null, "خطة المراقبة وVercel project settings"),
    }),
  ];
}

function findings(
  entries: VaultEntry[],
  ownerConfigured: boolean,
  missingPolicies: string[],
): OwnerVaultFinding[] {
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
  /*
   * XAI_API_KEY is handled strictly server-side: the key itself never appears
   * in code or git — only Vercel environment variables (see ENV_SPECS entry,
   * whose guide walks the owner through creating/rotating it in xAI Console).
   * The AI draft features already degrade honestly to a server-config error
   * when it is absent, so a missing key is an optional capability notice —
   * never an error, and never a reason to touch client code.
   */
  if (!runtime("XAI_API_KEY")) {
    result.push({
      severity: "info",
      title: "تكامل xAI اختياري — غير مفعّل",
      detail: "XAI_API_KEY (خادمي فقط، يُدار من Vercel) غير موجود؛ ميزات المسودات الذكية متوقفة برسالة إعداد واضحة، وبقية المنصة تعمل طبيعيًا.",
      action: "فعّله فقط بعد اعتماد حدود الإنفاق: أنشئ المفتاح من xAI Console وأضفه في Vercel → Environment Variables ثم أعد النشر. لا تضع أي مفتاح في الكود أو Git أبدًا.",
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
  /*
   * Two unrelated secrets must never carry the same value: Better Auth signs
   * every session cookie with BETTER_AUTH_SECRET, while GOOGLE_CLIENT_SECRET is
   * handed to Google's token endpoint. Pasting one into both fields makes a
   * Google-client rotation silently invalidate all sessions, and widens the
   * blast radius of either leak to both systems. Compare values only; the
   * finding never reveals them.
   */
  const betterAuthSecret = envValue("BETTER_AUTH_SECRET");
  const googleClientSecret = envValue("GOOGLE_CLIENT_SECRET");
  if (betterAuthSecret && googleClientSecret && betterAuthSecret === googleClientSecret) {
    result.push({
      severity: "high",
      title: "BETTER_AUTH_SECRET وGOOGLE_CLIENT_SECRET يحملان القيمة نفسها",
      detail:
        "سر جلسات Better Auth وسر عميل Google OAuth مضبوطان بالقيمة نفسها في runtime الحالي؛ وهما سرّان مستقلان لنظامين مختلفين.",
      action:
        "ولّد سرًا عشوائيًا جديدًا لـ BETTER_AUTH_SECRET في Vercel (سينهي الجلسات الحالية)، وأبقِ GOOGLE_CLIENT_SECRET كما هو من Google Cloud، ثم أعد النشر.",
    });
  }
  /*
   * The annual plans ship in the central catalog but stay unpurchasable until
   * their Keygen policies exist — checkout availability already gates them,
   * so this is a configuration gap to surface, not a runtime failure.
   */
  if (missingPolicies.length) {
    result.push({
      severity: "medium",
      title: "سياسات Keygen ناقصة لبعض الباقات",
      detail: `الباقات التالية معروضة في الكتالوج بلا Policy ID: ${missingPolicies.join("، ")} — وتبقى غير قابلة للشراء حتى تُضبط.`,
      action:
        "أنشئ Policy مطابقًا لكل باقة في Keygen Portal ثم أضف المعرف في Vercel باسم KEYGEN_POLICY_<PLAN>_ID وأعد النشر.",
    });
  }
  result.push({
    severity: "info",
    title: "خدمات اختيارية غير مطلوبة حاليًا: البريد والتحليلات والتخزين والمراقبة",
    detail: "المنصة تعمل محليًا أولًا بلا حاجة لها؛ أُدرجت بحالة «غير مطلوب حاليًا» مع بديل Free Tier موثّق لكل منها عند الطلب.",
    action: "لا تضف تكاملًا إلا عند وجود حاجة واضحة وقرار من المالك — والأسرار خادمية فقط في Vercel، never في الكود أو Git.",
  });
  return result;
}

export async function buildOwnerVaultInventory(): Promise<OwnerVaultInventory> {
  const entries = [...ENV_SPECS.map(envEntry), ...(await sourceEntries()), ...serviceEntries()];
  /*
   * Keygen lives behind `node:crypto`, and this module is imported by the owner
   * vault page. Resolve policy ids through a dynamic import so the server-only
   * graph never reaches the browser bundle — the same rule the authorization
   * import below follows.
   */
  const { listCatalogPlans } = await import("@/lib/commercial/catalog");
  const { keygenPolicyId } = await import("@/lib/license/keygen");
  const missingPolicies = listCatalogPlans()
    .filter((plan) => !keygenPolicyId(plan.keygenPolicyKey))
    .map((plan) => plan.key);
  const ownerConfigured = Boolean(envValue("NASAQ_OWNER_ID") || envValue("NASAQ_OWNER_EMAIL"));
  return {
    generatedAt: new Date().toISOString(),
    environment: currentEnvironment(),
    ownerConfigured,
    entries,
    routes: ROUTES,
    findings: findings(entries, ownerConfigured, missingPolicies),
  };
}

export const getOwnerVaultFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
    const authorization = await getAuthorizationContext({ id: context.userId, email: context.userEmail });
    if (!authorization.isAdmin) throw new Error("Forbidden");
    return buildOwnerVaultInventory();
  });
