# Gumroad — بوابة الدفع الأساسية (تشغيل كامل)

هذا المستند يصف بالضبط ما يجب إدخاله في لوحة Gumroad، وبأي قيم، حتى يعمل
مسار **Gumroad → NASAQ → Keygen** من أول مرة. مسار Paylink القديم يبقى في الكود
ولا يُحذف، لكنه خارج مسار الشراء الجديد.

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
| `GUMROAD_ACCESS_TOKEN` | الخادم فقط | Gumroad → Settings → Advanced → Applications → Generate access token |
| `GUMROAD_PRODUCT_ID` | الخادم فقط (يُنصح) | من صفحة المنتج → قسم License key، أو `GET /v2/products` |
| `GUMROAD_PRODUCT_PERMALINK` | اختياري | الافتراضي `auaewk` |
| `GUMROAD_STORE_BASE_URL` | اختياري | الافتراضي `https://nasaqar.gumroad.com` |
| `GUMROAD_TIER_INDIVIDUAL_NAME` / `GUMROAD_TIER_TEAM_NAME` | اختياري | الافتراضي «نَسَق | فردي» / «نَسَق | فريق» |

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

كل زر في `/purchase` يفتح نموذج الدفع مباشرة بالـ Tier والفترة الصحيحين:

```
https://nasaqar.gumroad.com/l/auaewk?tier=<Tier>&monthly=true&wanted=true
https://nasaqar.gumroad.com/l/auaewk?tier=<Tier>&quarterly=true&wanted=true
```
