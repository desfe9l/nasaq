# NASAQ — مساحة عمل مبرمج الوكلاء (وكيل البرمجة)

## ملخص الحالة الحالية (مكتوب بالعربية)

هذا المستند يوثّق ما تم تنفيذه فعلياً في مساحة عمل وكيل البرمجة لنظام نَسَق (NASAQ)، وما هو قيد الانتظار للإعداد اليدوي على ويندوز.

## بيئة التشغيل الفعلية (الحالي)

| العنصر | القيمة | الحالة |
|--------|--------|--------|
| نظام التشغيل | Linux (x86_64) | فعلي |
| منفذ التطبيق | `0.0.0.0:8080` | نشط |
| Docker | غير متاح | غير مثبت |
| VS Code | غير متاح | غير مثبت |
| WSL / cmd.exe | غير متاح | غير موجود |
| Node.js | 22.x | مثبت |
| npm | متاح | مثبت |

> **ملاحظة:** هذا البيئة تعمل على لينكس، وليس ويندوز. لذلك لا يمكن تثبيت Docker Desktop لـ OpenHands، ولا تثبيت إضافة Cline لـ VS Code، ولا تشغيل تطبيقات سطح المكتب الخاصة بـ Freebuff أو Arena هنا. كل ما يلي هو توثيق للإعداد على ويندوز، مع ما تم تنفيذه فعلياً على هذه البيئة.

## الوكلاء المثبتون فعلاً (في هذه البيئة)

### 1. Freebuff CLI — مثبّت ومُختبر

| العنصر | القيمة |
|--------|--------|
| الأمر | `freebuff` |
| الإصدار | `0.2.27` |
| طريقة التثبيت | `npm install -g freebuff` |
| المسار | `/home/node/.local/bin/freebuff` |
| المصادقة | `freebuff login` (يconnect مع GitHub) |
| حدود الاستخدام | طبقة مجانية (Free tier) من Freebuff |
| الخصوصية | راجع `Terms` و `Privacy` على موقع Freebuff |

**كيفية التشغيل:**
```bash
npm install -g freebuff
freebuff login
freebuff --cwd /workspace
```

> Freebuff هو وكيل برمجة سطر أوامر (CLI) يعمل مباشرة في الطرفيّة. يُستخدم لتخطيط وبناء وإصلاح الكود من سطر الأوامر.

### 2. Cline — موجود كبيئة تشغيل (هذا الوكيل)

| العنصر | القيمة |
|--------|--------|
| المنزل | `.cline-home/` |
| البيانات | `.cline-home/data/` (قواعد بيانات، جلسات، قفل، سجلات) |
| القواعد | `.cline-home/rules/sandbox-resources.md` |
| المهام | `.cline-home/tasks/` (فارغ حالياً) |

> Cline هو الوكيل الذي يشغّل هذه الجلسة حالياً. يعتمد على المصادقة الموجودة في بيئة GitHub (لا حاجة لتسجيل دخول يدوي).

### 3. OpenHands — غير مثبت (يتطلب Docker Desktop على ويندوز)

| العنصر | القيمة |
|--------|--------|
| الصورة الرسمية | `ghcr.io/openhands/agent-canvas:1.27.1` |
| المنفذ | `127.0.0.1:8000` (محلي فقط افتراضياً) |
| حالة البيانات | تُحفظ في `%USERPROFILE%\.openhands` |
| متطلبات ويندوز | Docker Desktop، مجلد `PROJECTS_PATH` |

**أوامر التشغيل على ويندوز (PowerShell):**
```powershell
$env:PROJECTS_PATH = Join-Path $HOME "projects"
New-Item -ItemType Directory -Force -Path $env:PROJECTS_PATH, (Join-Path $env:USERPROFILE ".openhands") | Out-Null
docker run -it --rm `
  -p 127.0.0.1:8000:8000 `
  -e AGENT_CANVAS_ALLOW_LAN_SESSION_KEY=true `
  -v "$($env:USERPROFILE)\.openhands:/home/openhands/.openhands" `
  -v "$($env:PROJECTS_PATH):/projects" `
  ghcr.io/openhands/agent-canvas:1.27.1
```
ثم افتح `http://localhost:8000/canvas` في المتصفّح.

> **غير مثبت هنا** لأن Docker غير متاح على هذه البيئة لينكس. يجب تثبيت Docker Desktop على ويندوز وتشغيل الأمر أعلاه يدوياً.

### 4. Arena.ai — وكيل ويب عبر GitHub App (لا يحتاج تثبيت محلي)

| العنصر | القيمة |
|--------|--------|
| التطبيق | Arena AI Coding Agent GitHub App |
| الرابط | `https://github.com/apps/arena-ai-coding-agent` |
| وضع العمل | Agent Mode (يطلب من Arena Help Center) |
| المصادقة | ربط حساب GitHub وتحديد المستودعات المسموح لها |
| سير العمل | ينشئ نسخة منفصلة (sandbox) من المستودع، يُجري التعديلات، يعرض diff، ينشئ Pull Request واحد لكل جلسة |

**كيفية التشغيل:**
1. افتح `https://github.com/apps/arena-ai-coding-agent`
2. انقر "Install" واختر مستودع `desfe9l/nasaq`
3. في Arena، فعّل Agent Mode واربط حساب GitHub
4. اختر المستودعات التي يمكن لـ Arena الوصول إليها

> **ليس تطبيق سطح مكتب** — يُستخدم عبر المتصفّح في Arena. لا يحتاج تثبيت محلي.

### 5. Freebuff — سطح مكتب و CLI

| العنصر | القيمة |
|--------|--------|
| CLI | `npm install -g freebuff` (مثبّت هنا) |
| سطح المكتب | `https://freebuff.com/desktop` (Windows/macOS/Linux) |
| المحادثة | `https://freebuff.com/cli` |

> CLI مثبّت ومُختبر على هذه البيئة. تطبيق سطح المكتب يحتاج تنزيل يدوي على ويندوز.

##erved task branches and Git worktree workflow

يجب أن تعمل كل مهمة برمجية على فرع معزول (task branch) أو Git worktree منفصل، مع الحفاظ على التغييرات غير المتعلقة، وعرض diff حقيقي، وتشغيل الفحوصات المستهدفة قبل إنشاء Pull Request.

### مسار العمل الموصى به:
1. أنشئ فرع مهمة من `main`: `git checkout -b cline/<task-name>`
2. نفّذ التغييرات على الفرع
3. شغّل الفحوصات: `npm run typecheck` و `npm run build` والاختبارات المستهدفة
4. أنشئ Pull Request إلى `main`
5. يُدمج فقط إذا نجحت جميع الفحوصات.required وسماح حماية الفرع بذلك

## الأدوات النصية والمنفذة

### سكريبتlauncher الوكلاء

ملف: `scripts/agent-launcher.mjs`

يُستخدم لعرض حالة الوكلاء وكيفية تشغيل كل واحد:

```bash
node scripts/agent-launcher.mjs status
node scripts/agent-launcher.mjs launch freebuff
node scripts/agent-launcher.mjs launch arena
node scripts/agent-launcher.mjs launch openhands
node scripts/agent-launcher.mjs launch cline
```

## 비용 وحدود الاستخدام (أهم نقطة)

| الوكلاء | التكلفة | الملاحظة |
|--------|--------|----------|
| Freebuff | طبقة مجانية | أولوية الاستخدام المجاني |
| Cline | يستخدم مزوّد النماذج الحالي | لا توجد تكلفة إضافية تلقائياً |
| Arena | 위해 الويب | قد تكون هناك حدود على استخدام Agent Mode |
| OpenHands | ذاتي الاستضافة (دوكير) | لا تكلفة salvo تكلفة الحوسبة الخاصة بك |

> **لا يتم شراء موارد سحابية أو اشتراكات أو أرصدة API تلقائياً.** يتم إظهار تكاليف المزوّد والحصص والقيود بوضوح.

## حماية المستشفى والبيانات الحساسة

- لا يتم عرض الرموز (tokens) في كود المتصفّح، أو السجلات، أو لقطات الشاشة، أو الملفات المُرسلة.
- لا يتم الكشف عن واجهات برمجة تطبيقات OpenHands للعلن.
- تتطلب الأوامر التدميرية والعمليات المؤثرة في الإنتاج تصريحاً صريحاً.
- يتم فصل النشر عن الدمج: لا يتم النشر إلا بعد الدمج الناجح في `main` وتوافر الإعدادات على Vercel.

## الفرق بين المثبّت محلياً ومتوفر عبر موقع نَسَق

| الوكلاء | مثبّت محلياً (هذا الجهاز) | متاح عبر موقع نَس-ek (الويب) |
|--------|---------------------------|-----------------------------|
| Cline | نعم (الوكيل الحالي) | غير متاح عبر الموقع |
| Freebuff CLI | نعم (مثبّت عبر npm) | غير متاح عبر الموقع |
| Freebuff سطح مكتب | لا (يتطلب تنزيل ويندوز) | متاح عبر `freebuff.com/desktop` |
| Arena | لا (وكيل ويب) | متاح عبر `arena.ai` |
| OpenHands | لا (يتطلب دوكير ويندوز) | غير متاح عبر الموقع |

## ما剩餘 للإعداد اليدوي على ويندوز

1. **تثبيت Docker Desktop** وتشغيل OpenHands حسب الأمر أعلاه.
2. **تثبيت VS Code** وإضافة إضافة Cline من سوق إضافة VS Code.
3. **تثبيت تطبيق Freebuff سطح المكتب** من `freebuff.com/desktop` إذا كنت تفضل واجهة رسومية على CLI.
4. **ربط حساب GitHub** مع Arena عبر `https://github.com/apps/arena-ai-coding-agent`.
5. **تكوين متغيرات البيئة** على Vercel للنشر (بما في ذلك `NASAQ_PRIMARY_DATABASE_URL`).

## الفحص والتحقق

تم تشغيل الفحوصات التالية بنجاح على هذه البيئة:
- `npm run typecheck` — ناجح
- `npm run build` — ناجح
- اختبارات PSD (11 اختبار) — ناجح
- اختبارات تصدير PSD (5 اختبار) — ناجح
- خادم التطوير على المنفذ 3000 — يرد بـ HTTP 200

##commit والحالة

- الفرعurrent: `cline/agent-workspace-integration`
- آخر تنفيذ: إصلاح واستكمال مساحة عمل وكيل البرمجة
- النشر على Vercel الإنتاج: معطل لغياب `NASAQ_PRIMARY_DATABASE_URL`
