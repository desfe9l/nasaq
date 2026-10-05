# تفعيل التخزين السحابي (Cloudflare R2) — R2 storage activation

المحرر يحفظ مكتبته **محليًا أولًا** (IndexedDB). ووجود R2 يضيف نسخة سحابية لكل
أصل (صورة/SVG/ملف مشروع) مع متطلبات قاعدة البيانات نفسها (جدول
`storage_assets` + `library_catalog`). غياب متغيرات R2 لا يُظهر أي خطأ للمستخدم:
كل نداء يرد `not_configured` ويستمر العمل محليًا — لذلك يجب **التحقق** صراحةً.

The editor is local-first by design. R2 adds the cloud copy; a missing
configuration is silent, so activation is only complete once the verification
below passes.

## 1) المتغيرات المطلوبة (Vercel → Settings → Environment Variables → Production)

| Variable | Required | Notes |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | ✅ | يُشتق منه الـ endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | ✅ | من R2 API Token |
| `R2_SECRET_ACCESS_KEY` | ✅ | يُعرض مرة واحدة عند إنشاء التوكن — خادمي فقط، لا `VITE_` أبدًا |
| `R2_BUCKET_NAME` | اختياري | الافتراضي في الكود `nasaq-sa` |
| `R2_ENDPOINT` | اختياري فقط | لا يُلزم إلا لنطاق مخصص أو endpoint خاص بمنطقة قضائية؛ يُقبل `https` فقط |

- أنشئ التوكن من **R2 → Manage R2 API Tokens** بصلاحية **Object Read & Write**
  على الحاوية المطلوبة. هذه هي الصلاحيات التي تستخدمها المنصة فعليًا:
  `PUT` (رفع)، `GET` + presigned `GET` (قراءة/رابط موقّع)، `DELETE` (حذف).
- يجب أن تكون القيم في نطاق **Production** (ونفسها في Preview إن أردت اختبار
  النسخ المعاينة)، ثم **أعد النشر** (Redeploy) — لا يكفي حفظ المتغيرات فقط عند
  تغيير إعدادات البناء.

## 2) التحقق (رفع → تثبيت metadata → قراءة/رابط موقّع → حذف)

```bash
npm run storage:verify            # محليًا أو في أي بيئة تحتوي المتغيرات
```

يقوم الأمر بـ:

1. عرض أسماء المتغيرات الناقصة (أسماء فقط — لا قيم إطلاقًا)؛
2. رفع كائن تجريبي واحد تحت مسار جديد `users/…/assets/…`؛
3. قراءته عبر **رابط موقّع** ثم عبر الـ provider مباشرة؛
4. إدخال صف `storage_assets` وقراءته عبر نفس فلترة الملكية ثم حذفه؛
5. حذف الكائن والتأكد من اختفائه، ثم `exit 0` عند النجاح و`exit 1` عند الفشل.

من داخل الإنتاج: افتح **خزنة المالك** (`/owner-vault`) — تعرض حالة متغيرات R2،
وفي قسم الخدمات بطاقة **Cloudflare R2 · التخزين السحابي** بزر «تشغيل الفحص»
الذي يستدعي المسار الإداري `verifyObjectStorage` فيُنفّذ نفس الاختبار داخل دالة
النشر نفسها (كتابة واحدة تحت مسار المستخدم نفسه ثم حذفها). لا تعيد هذه المسارات
أي مفتاح أو endpoint أو معرّف حساب — حالات وأسماء المتغيرات الناقصة فقط.

من CI: شغّل ورك‑فلو **Storage verification (Cloudflare R2)** بعد ضبط أسرار
المستودع/البيئة (`R2_*` و`DATABASE_URL`) — يعمل على runner يستطيع الوصول إلى
Cloudflare وقاعدة البيانات.

## 3) ما الذي يبقى محليًا (لا يتغير)

- `mirrorAssetToStorage` يعمل **بعد** نجاح الحفظ المحلي ويسكت عند أي فشل، فلا
  يُفقد عمل المستخدم أبدًا بسبب التخزين.
- الزوار غير المسجلين لا يلمسون التخزين إطلاقًا (`hasSignedInOwner`).
- كل قراءة/حذف تُحل عبر `storage_assets` بـ `user_id` من الجلسة، مع تأكيد أن
  المفتاح يقع تحت بادئة المستخدم (`isKeyOwnedBy`) — لا يمنح الرابط الموقّع سوى
  قراءة كائن واحد لمدة قصيرة.
- CSP يسمح بـ `connect-src https://*.r2.cloudflarestorage.com` (وعند ضبط
  `R2_ENDPOINT` بنطاق مخصص يُضاف أصله تلقائيًا).
