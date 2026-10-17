# توثيق ودليل الانتقال إلى Cloudflare Pages (NASAQ Migration Guide)

تمت ترقية منصة **نَسَق (NASAQ)** للعمل والتشغيل الكامل على شبكة **Cloudflare** عبر **Cloudflare Pages** بدلاً من Vercel، مع دعم المعالجة المتقدمة (`_worker.js`) وتكامل حاوية التخزين السحابي **R2** (`nasaq-sa`).

---

## 1. المعمارية المعتمدة (Production Architecture)

- **نوع المشروع:** Cloudflare Pages (Advanced `_worker.js` Mode).
- **محرك الخادم والـ SSR:** Nitro v3 مخصص ببيئة `cloudflare-pages`.
- **توافق الرانتيم:** `nodejs_compat` مفعل بالكامل لدعم حزم التشفير (Jose, Noble Hashes, Node Net).
- **قاعدة البيانات:** PostgreSQL عبر Supabase Transaction Pooler (المنفذ 6543).
- **التخزين السحابي:** Cloudflare R2 Bucket المسمى `nasaq-sa` مدمج مباشرة عبر Binding `BUCKET` مع دعم S3 SigV4.
- **النطاقات الرسمية الموجهة:**
  - `www.nasaq.team` (الموقع المؤسسي والتسويقي - Primary Public Host)
  - `nasaq.team` (إعادة توجيه 308 إلى www)
  - `nasaq.work` (مساحة العمل والمحرر - Workspace & Editor Host)
  - `www.nasaq.work` (إعادة توجيه إلى مساحة العمل)

---

## 2. أوامر البناء والنشر المحلية (Local & CI Commands)

```bash
# بناء حزمة الإنتاج لـ Cloudflare Pages
npm run build:cf

# معاينة وتشغيل الخادم المحلي عبر محاكي Cloudflare Pages (Wrangler)
npm run preview:cf

# نشر مباشر من الطرفية إلى Cloudflare Pages (يتطلب تسجيل الدخول أو توكن)
npm run deploy:cf
```

---

## 3. المتغيرات والأسرار في Cloudflare Dashboard

في لوحة تحكم Cloudflare:
**Workers & Pages** ← **Pages** ← مشروع **`nasaq`** ← **Settings** ← **Environment Variables**:

| Variable | Production Value / Description | Type |
|---|---|---|
| `VITE_AUTH_ENABLED` | `true` | Variable |
| `R2_BUCKET_NAME` | `nasaq-sa` | Variable |
| `BETTER_AUTH_URL` | `https://www.nasaq.team` | Variable |
| `NASAQ_PRIMARY_DATABASE_URL` | `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=verify-full` | **Secret** |
| `R2_ACCOUNT_ID` | معرّف حساب Cloudflare الخاص بك | Variable |
| `R2_ACCESS_KEY_ID` | مفتاح R2 API Token | Variable |
| `R2_SECRET_ACCESS_KEY` | السر الخاص بـ R2 API Token | **Secret** |
| `KEYGEN_API_TOKEN` | توكن التراخيص (اختياري / بحسب التفعيل) | **Secret** |

---

## 4. ربط حاوية التخزين R2 في لوحة Cloudflare Pages

1. اذهب إلى **Settings** ← **Functions** ← **R2 Bucket Bindings**.
2. اختر **Add binding**.
3. اسم المتغير (Variable name): `BUCKET`
4. اسم الحاوية (R2 bucket): `nasaq-sa`

---

## 5. ربط النطاقات وتفعيل الـ DNS في Cloudflare

تحت تبويب **Custom domains** في مشروع Pages:
1. أضف النطاقات الأربعة:
   - `nasaq.team`
   - `www.nasaq.team`
   - `nasaq.work`
   - `www.nasaq.work`
2. يقوم Cloudflare تلقائياً بإعداد سجلات الـ DNS (CNAME) وشهادات SSL/TLS مجانية ومحدثة تلقائياً.

---

## 6. سير العمل للنشر التلقائي عبر GitHub Actions

تم إنشاء الملف `.github/workflows/deploy-cloudflare.yml`، ويحتاج لإكمال النشر السحابي التلقائي إلى إضافة السريين التاليين في **GitHub Repository Secrets**:
- `CLOUDFLARE_API_TOKEN`: توكن Cloudflare بصلاحية **Cloudflare Pages: Edit**.
- `CLOUDFLARE_ACCOUNT_ID`: معرّف الحساب المتاح في الشريط الجانبي للوحة تحكم Cloudflare.
