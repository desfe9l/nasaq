# نَسَق | NASAQ

محرر تصميم وتقارير مؤسسي. الواجهة عربية، والتصدير إلى PDF وPowerPoint وWord، والمستندات تُحفظ محلياً ثم تُزامَن حسب الحساب.

الإنتاج: [nasaq-sa.vercel.app](https://nasaq-sa.vercel.app)

## التشغيل

```bash
npm ci
npm run dev
```

التطبيق يفتح على المنفذ `8080`.

| الأمر | الغرض |
|---|---|
| `npm run build` | بناء الإنتاج ثم ترحيل قاعدة البيانات إن وُجد `DATABASE_URL` |
| `npm run typecheck` | فحص الأنواع |
| `npm test` | اختبارات المحرر والحساب |
| `npm run check:deploy` | يتأكد أن بناء Vercel يثبت أدوات Vite ولا يُعامَل المستودع كـ workspace ناقص |

## النشر

المستودع حزمة واحدة تُدار بـ **npm** و`package-lock.json`. لا يوجد `pnpm-lock.yaml` ولا `pnpm-workspace.yaml`: وجودهما يجعل Vercel يظن أن المستودع monorepo متروك ويشغّل `pnpm run build` فيفشل.

`vercel.json` يثبّت الاعتماديات بـ `npm ci --include=dev` حتى تبقى Vite وNitro وTypeScript متاحة أثناء البناء، ثم يشغّل `npm run build`. معاينات Vercel تتخطى ترحيل قاعدة البيانات لأنها تشارك مخطط الإنتاج.
