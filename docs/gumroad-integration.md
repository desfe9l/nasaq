# Gumroad — بوابة الدفع الأساسية (تشغيل كامل)

هذا المستند يصف بالضبط ما يجب إدخاله في لوحة Gumroad، وبأي قيم، حتى يعمل
مسار **Gumroad → NASAQ → Keygen** من أول مرة. Gumroad هو مزوّد الدفع الوحيد في
المنصة؛ أُزيل مزوّد الدفع القديم (Paylink) من الكود بالكامل — بما في ذلك جداوله
(`migrations/0011_drop_paylink.sql`) ومتغيّراته `PAYLINK_API_ID` /
`PAYLINK_SECRET_KEY`.

## المنتج (لا يُنشأ منتج جديد)

- المنتج المنشور: `https://nasaqar.gumroad.com/l/auaewk`
  (نَسَق | الاشتراك الاحترافي — عضوية بـ Tier اثنين)
- التسعير كما هو دون تغيير:
  - نَسَق | فردي: Monthly ‏79 SAR · Quarterly ‏199 SAR
  - نَسَق | فريق: Monthly ‏199 SAR · Quarterly ‏499 SAR
- محتوى المنتج يبقى صفحة/رسالة توجيه: «سجّل الدخول إلى نَسَق بنفس بريد الشراء».
  لا تُرفع ملفات نَسَق إلى Gumroad؛ الوصول الحقيقي عبر حساب NASAQ + ترخيص Keygen.

## متغيرات البيئة (Vercel فقط — لا قيم في Git أو الدردشة)

| المتغير | أين | القيمة |
| --- | --- | --- |
| `GUMROAD_ACCESS_TOKEN` | الخادم فقط — **إلزامي** | Gumroad → Settings → Advanced → Applications → Generate access token |
| `GUMROAD_PRODUCT_ID` | الخادم فقط — **اختياري** | من صفحة المنتج → قسم License key، أو `GET /v2/products` |
| `GUMROAD_PRODUCT_PERMALINK` | اختياري | الافتراضي `auaewk` |
| `GUMROAD_STORE_BASE_URL` | اختياري | الافتراضي `https://nasaqar.gumroad.com` |
| `GUMROAD_TIER_INDIVIDUAL_NAME` / `GUMROAD_TIER_TEAM_NAME` | اختياري | الافتراضي «نَسَق | فردي» / «نَسَق | فريق» |

### استخراج معرّف المنتج تلقائيًا

لا يُفترض أن الـ permalink (`auaewk`) هو معرّف المنتج. `resolveGumroadProductId()`
في `src/lib/gumroad/config.server.ts` يحسم المعرّف بهذا الترتيب:

1. `GUMROAD_PRODUCT_ID` إن ضُبط — قيمة صريحة تفوز دائمًا.
2. خلاف ذلك، وبوجود `GUMROAD_ACCESS_TOKEN`، يُستخرج المعرّف الحقيقي من
   `GET /v2/products` بمطابقة الـ permalink (مع التسامح مع `custom_permalink`
   ومسار `url`).
3. خلاف ذلك يبقى غير مُستخرج، ويعود التحقق إلى `product_permalink` (تقبله
   المنتجات المنشأة قبل 2023).

نتيجة البحث تُحفظ في ذاكرة العملية؛ الفشل **لا** يُحفظ، حتى لا يُعطّل خطأ عابر
من Gumroad البيع التالي. هذا يجعل `GUMROAD_PRODUCT_ID` اختياريًا بالكامل في
متجر يحتوي منتجًا واحدًا، ومطلوبًا فقط عندما يستضيف المتجر أكثر من منتج.

كل عملية بيع تُتحقق أيضًا من أنها تخص **هذا** المنتج: بيع يتبع منتج Gumroad
آخر يُرفض بسبب `product_mismatch` ولا يُفعّل شيئًا.

## ربط Ping / Resource subscriptions

سجّل الـ endpoint التالي في Gumroad (Settings → Advanced → Pings، أو عبر
`PUT /v2/resource_subscriptions` لكل مورد):

```
POST https://nasaq-sa.vercel.app/api/webhooks/gumroad
```

الموارد المطلوب تفعيلها إن استخدمت Resource subscriptions:
`sale`, `refund`, `dispute`, `dispute_won`, `cancellation`,
`subscription_ended`, `subscription_restarted` (و`subscription_updated` عند الحاجة).

- أي `POST` يُرد عليه بـ 2xx (لا 404 أبدًا)؛ `GET` يعيد فحص صحة عام.
- Ping يُعامل كإشعار Post-sale فقط: كل عملية بيع/تجديد تُتحقق منها خادميًا
  (Gumroad API أو license verify) قبل أي تفعيل.
- `test=true` (زر Send test ping) يُجاب 200 بدون أي تفعيل.
- الإعادات (replays) تُخصم عبر `gumroad_pings.dedupe_key`.

## حالات الاشتراك ← أثرها في NASAQ

| حدث Gumroad | أثر النظام |
| --- | --- |
| أول دفعة (sale) | ربط العميل بالبريد + إصدار ترخيص Keygen + تفعيل الاشتراك |
| Renewal (is_recurring_charge) | تمديد نفس ترخيص Keygen (لا ترخيص ثانٍ) |
| Failed renewal / failed_payment | تبقى الفترة المدفوعة حتى نهايتها ثم تنتهي |
| Cancellation | تُوقف التجديد فقط؛ الفترة الحالية تكمل حتى نهايتها |
| subscription_ended | انتهاء الوصول فورًا (نهاية الفترة رسميًا) |
| Refund | إلغاء الوصول وتعليق ترخيص Keygen فورًا |
| Dispute (خسارة) / Chargeback | تعليق فوري (SUSPENDED) |
| Dispute won | إعادة فتح الترخيص والوصول |

## عمليات المالك (Owner Vault → Gumroad · بوابة الدفع)

- Product/API/Ping/Tier/Keygen mapping status + حالة Subscriptions.
- **فحص Ping**: يرسل Ping اصطناعي `test=true` للـ endpoint الحي ويتحقق من 2xx.
- **اختبار تحقق الشراء**: يتأكد أن المُحقق يرفض معرفات بيع غير معروفة.
- **مزامنة اشتراك**: يعيد قراءة حالة المشترك من Gumroad API بالبريد.

## روابط الشراء (Monthly افتراضي)

كل زر في `/purchase` (و`/pricing`) يفتح نموذج الدفع مباشرة بالـ Tier والفترة الصحيحين:

```
https://nasaqar.gumroad.com/l/auaewk?tier=<Tier>&monthly=true&wanted=true
https://nasaqar.gumroad.com/l/auaewk?tier=<Tier>&quarterly=true&wanted=true
```

## العودة بعد الدفع

اضبط في Gumroad (Product → Content / Purchase receipt) رابط العودة إلى:

```
https://nasaq-sa.vercel.app/payment/success
```

صفحة العودة لا تعتبر الرابط دليل سداد؛ تعرض فقط حالة الحساب الحقيقية كما
يقرؤها الخادم (وتُجري ربط الاشتراك ببريد الجلسة تلقائيًا عند كل تحديث).

> ملاحظة: رابط المتجر الحالي للمنتج هو `https://nasaqar.gumroad.com/l/auaewk`.
> إذا تغيّر اسم المتجر (مثل `desfe9l.gumroad.com`) حدّث `GUMROAD_STORE_BASE_URL`
> في Vercel فقط — لا يلزم أي تغيير في الكود.
