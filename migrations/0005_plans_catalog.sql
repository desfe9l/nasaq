-- 0005_plans_catalog.sql
-- NASAQ Central Plans Catalog for Paylink & Keygen fulfillment
-- Standardizes the 4 commercial paid plans with authoritative prices and durations.

insert into plans (id, name, arabic_name, description, price, currency, duration_days, features, enabled, sort_order)
values
  (
    'individual-monthly',
    'Individual Monthly',
    'ترخيص فردي - شهري',
    'وصول كامل للأفراد لمدة شهر واحد (30 يومًا).',
    79.00, 'SAR', 30,
    '["القوالب الكاملة المتميزة","تصدير حتى 300 DPI بلا علامة مائية","عدة تطبيقات هوية كاملة","قفل العناصر وحماية التصميم","تحديثات النسخة المرخصة"]'::jsonb,
    true, 10
  ),
  (
    'individual-quarterly',
    'Individual Quarterly',
    'ترخيص فردي - ربع سنوي (3 أشهر)',
    'وصول كامل للأفراد لمدة 3 أشهر (90 يومًا) بتوفير مميز.',
    199.00, 'SAR', 90,
    '["القوالب الكاملة المتميزة","تصدير حتى 300 DPI بلا علامة مائية","عدة تطبيقات هوية كاملة","قفل العناصر وحماية التصميم","تحديثات النسخة المرخصة طوال المدة","توفير مقارنة بالاشتراك الشهري"]'::jsonb,
    true, 20
  ),
  (
    'team-monthly',
    'Team Monthly',
    'ترخيص فريق - شهري',
    'وصول كامل لفرق العمل والاتصال المؤسسي لمدة شهر واحد (30 يومًا).',
    199.00, 'SAR', 30,
    '["جميع مزايا النسخة المتقدمة","ميزات الفريق ومساحة العمل المشتركة","تفعيل التراخيص عبر أكواد سريعة","استيراد وتصدير حزمة الهوية الموحدة","تصدير PDF عالي الدقة 300 DPI","أولوية الدعم الفني"]'::jsonb,
    true, 30
  ),
  (
    'team-quarterly',
    'Team Quarterly',
    'ترخيص فريق - ربع سنوي (3 أشهر)',
    'وصول كامل لفرق العمل لمدة 3 أشهر (90 يومًا) — الأكثر طلباً.',
    499.00, 'SAR', 90,
    '["جميع مزايا ترخيص الفريق","ميزات الفريق ومساحة العمل المشتركة","تفعيل التراخيص عبر أكواد سريعة","استيراد وتصدير حزمة الهوية الموحدة","تصدير عالي الدقة 300 DPI","أولوية قصوى للدعم الفني","أفضل قيمة وتوفير لفرق العمل"]'::jsonb,
    true, 40
  )
on conflict (id) do update set
  name = excluded.name,
  arabic_name = excluded.arabic_name,
  description = excluded.description,
  price = excluded.price,
  duration_days = excluded.duration_days,
  features = excluded.features,
  enabled = true,
  sort_order = excluded.sort_order,
  updated_at = now();
