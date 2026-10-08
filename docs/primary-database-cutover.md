# NASAQ primary database cutover

## اختيار المورد

المورد المختار هو **Supabase PostgreSQL مستقل** عن مزود PostgreSQL السابق. هذا الاختيار يحافظ على سلوك NASAQ الفعلي: SQL PostgreSQL، معاملات متعددة البيانات، القيود والفهارس، `RETURNING`، الفهارس الجزئية، وعمليات التحديث الذرية المتزامنة. لا يحتاج إلى Vercel Pro/Enterprise؛ المطلوب هو مشروع Supabase مستقل وخطة مناسبة لحجم البيانات.

لا تستخدم اتصالًا من مشروع المزود السابق، ولا تعِد تسمية سر قديم إلى المتغير الجديد.

## إعداد المورد الخارجي

1. أنشئ مشروعًا جديدًا في [Supabase Dashboard](https://supabase.com/dashboard) مستقلًا عن قاعدة NASAQ الحالية.
2. انتظر اكتمال إنشاء قاعدة البيانات.
3. من **Connect** انسخ رابط PostgreSQL الآمن أو Transaction Pooler. يجب أن يتضمن TLS، ويجب ألا يُحفظ في Git أو في `VITE_*`.
4. أضف المتغير التالي إلى Vercel Production وPreview عند الحاجة:

```text
NASAQ_PRIMARY_DATABASE_URL=postgres://...
```

5. أبقِ متغير المصدر مؤقتًا فقط على جهاز/runner خاص بالقطع، وليس في Vercel:

```text
SOURCE_DATABASE_URL=postgres://...
```

## الاستيراد قبل القطع

نفّذ من commit الترحيل، مع وجود الشبكة وصلاحية القراءة للمصدر والكتابة للهدف:

```bash
npm ci
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' npm run db:migrate
SOURCE_DATABASE_URL='postgres://SOURCE' \
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' \
npm run db:import
```

`db:import`:

- يرفض غياب أحد الرابطين أو تطابق المصدر والهدف.
- يطبق كل migrations على الهدف أولًا.
- يرفض أي جدول هدف غير فارغ، فلا يحدث merge صامت أو overwrite.
- ينسخ القيم الأصلية، بما فيها IDs والملكية والطوابع الزمنية والعلاقات.
- ينسخ الجداول بترتيب foreign-key.
- يتحقق لكل جدول من عدد الصفوف وSHA-256 حتمي للصفوف.
- يفشل دون إعلان نجاح عند أي خطأ؛ لا توجد كتابة وهمية أو إسقاط للمصدر.

بعد نجاح الاستيراد، احتفظ بتقرير JSON المطبوع وبنسخة تصدير/backup من المصدر. لا تحذف المصدر بعد القطع مباشرة.

## القطع

1. شغّل اختبارات التحقق على الهدف باستخدام نفس أسرار الهدف:

```bash
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' npm run verify:owner
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' npm run verify:provider
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' npm run typecheck
NASAQ_PRIMARY_DATABASE_URL='postgres://TARGET' npm run build
```

2. في Vercel، اضبط `NASAQ_PRIMARY_DATABASE_URL` على رابط Supabase الهدف لكل بيئة مطلوبة.
3. أعد النشر من commit الترحيل.
4. تحقّق من health/control-plane، تسجيل الدخول، إنشاء مشروع، حفظ مستند، القوالب، وكتابات الإدارة.
5. راقب سجلات Vercel وSupabase، ثم أزل `SOURCE_DATABASE_URL` من runner واحفظه خارج بيئة التطبيق.

بعد القطع، التطبيق لا يقرأ `DATABASE_URL` القديم ولا يستخدمه كـfallback. غياب `NASAQ_PRIMARY_DATABASE_URL` في runtime منشور يمنع البناء/الوصول إلى قاعدة البيانات بدل تشغيل وضع غير دائم.

## الرجوع

الرجوع الآمن قبل قبول كتابات جديدة على الهدف:

1. أوقف/اعزل النشر الجديد أو امنع الكتابة مؤقتًا من خلال control plane.
2. أعد `NASAQ_PRIMARY_DATABASE_URL` إلى نسخة احتياطية متحقق منها أو إلى المصدر القديم **فقط بعد التأكد من أن المصدر يحتوي آخر البيانات المقبولة**.
3. أعد النشر من commit سابق معروف، ثم نفّذ اختبارات health والتحقق.
4. لا تحذف الهدف؛ أبقه متاحًا للتحقيق ومقارنة checksums.

إذا قُبلت كتابات على الهدف بعد القطع، لا يوجد rollback تلقائي غير فقدان تلك الكتابات. يجب إجراء import عكسي مُراجع مع نافذة توقف ونسخ احتياطية؛ لا تنفّذ ذلك تلقائيًا.
