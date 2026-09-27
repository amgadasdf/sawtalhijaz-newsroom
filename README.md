# sawtalhijaz-newsroom

غرفة أخبار صوت الحجاز — نظام إعلامي يدوي (رادار + مختبرات + هندسة + 8 مكاتب).
الحوكمة في GOVERNANCE.md (بصمة المشروع) — اقرأها قبل أي تشغيل.
شجرة الإعدادات ومصدر الحقيقة الوحيد في `config/` بصيغة JSON؛ ميزانيات جميع المصادر في `config/sources.json` ومصادر البيانات وعينات الجلب في `state/`.
اللغة: العربية افتراضياً، والمنطقة الافتراضية SA مع gl/hl/ceid في config/geos.json.

## التشغيل (B1 + B2 + B3)

ملف واحد لكل الأوامر — صفر تبعيات (Node ≥ 20، ESM):

```bash
node engine/cli.js status                     # تقرير الحالة من state/ (قراءة فقط)
node engine/cli.js time                       # وثيقة الزمن الموثق (البروتوكول الثلاثي)
node engine/cli.js resume all                 # سطر الاستئناف: radar + 11 شخص + 4 مختبرات
node engine/cli.js resume exec-editor         # كيان واحد (أو lab:discovery / radar)
node engine/cli.js settime "2026-09-24T09:00:00Z" --note "حقلة يدوية"
node engine/cli.js settime --clear            # مسح الزمن اليدوي
node engine/cli.js runs 20                    # آخر التشغيلات المسجلة
node engine/cli.js fetch trends-rss --max-items 5  # جالب واحد من config/sources.json
node engine/cli.js fetch-live                 # البوابة الحية؛ يختبر fixtures عند انقطاع الشبكة
node engine/cli.js radar --section تريند-الشارع --scope daily --depth quick
node engine/cli.js radar --fixtures            # بوابة رادار B3 معزولة، بلا شبكة أو تعديل state الحقيقي
node engine/cli.js selftest --offline          # بوابات B1+B2+B3 الحتمية (exit 0 = خضراء)
```

مكافئ npm: `npm run status | time | resume | runs | selftest | radar`.
`--offline` يمنع أي طلب شبكة (الاستئناف لا ينتظر الشبكة أصلاً).

## الزمن (بروتوكول ثلاثي — B1)

`engine/time.js` يحسم مصدر الزمن بهذا الترتيب ويسجله في كل تشغيل:

1. `env` — ساعة البيئة، إذا كان فارقها عن هيدر `https://sawtalhijaz.com/` ≤ 60 ثانية.
2. `header` — هيدر Date من sawtalhijaz.com هو المرجع الحاكم عند فارق > 60 ثانية.
3. `manual` — إدخال المالك «الوقت الفعلي: …» عبر `settime` عند انقطاع الشبكة (يُوسم «مسنّ» بعد 6 ساعات).
4. `unverified` — لا هيدر ولا يدوي: زمن غير موثق، يُطبع تنويه صريح مع السبب.

كل تقرير وسجل تشغيل يبدأ بسطر واحد: `الزمن: <ISO> | مصدر=<env|header|manual|unverified> | skew=<ث> | <التنويه>`.

## الذاكرة والكتابة

- `engine/state.js` يقرأ/يكتب `state/` بكتابة **ذرية** (ملف مؤقت + rename) — لا ملف نصف مكتوب أبداً.
- `recordRun()` يكتب `state/runs/<iso>-<kind>.json` ويزيد عدّاد الكيان ويحدّث آخر ملخص/تالي/معلقات.
- التعديل عبر `patchJson`/`patchPerson` على نسخة ثم كتابة ذرية.
- `reports/` للتقارير، `state/runs/_selftest/` مخلفات اختبار (مستبعدة من git).

## البوابات

البوابات تعمل بلا شبكة (حتمية) وتفشل بصوت عالٍ عند أي كسر:

- **بوابات B1+B2+B3 الحتمية**: `node engine/cli.js selftest --offline` — الزمن والحالة والاستئناف، سياسات B2 وparsers، ثم بوابة الرادار B3 في مساحة مؤقتة بحقن جميع ردود HTTP. تشمل التطبيع العربي، التجميع بالكلمات المشتركة، المعايير والتصنيف، Z-score/التنبؤ، والـWordPress sitemap.
- **البوابة الحية B2**: `node engine/cli.js fetch-live` — يحاول المصادر بالتتابع ضمن الميزانيات والفواصل والتهدئة؛ عند انقطاع الشبكة يطبع «البوابة الحية معلقة وتُشغَّل أول تشغيل في محادثة المشروع» ويُثبت بوابة fixtures.
- **الرادار B3**: `node engine/cli.js radar --section <id> --scope daily|all --depth quick|deep|weekly` — يحدّث `state/topics.json`, `state/topics-latest.json`, `state/inventory.json`, و`state/runs/`. `--fixtures` أو `--offline` يشغّلان بوابة B3 معزولة من دون كتابة بيانات fixtures في حالة التشغيل الحقيقية.
- فرصة النشر = `0.40 × accelerationScore + 0.30 × (100 − saturation) + 0.15 × deskRelevance + 0.15 × sourceReliability`; التصنيف: ذهب (<25)، نافذة (25–<50)، مزدحم (50–75)، فائت (>75). التوقع متحفظ ولا يصدر إلا بتسارع موجب في تشغيلين وتشبع أقل من 50%.
- بوابات مساعدة: `status` · `resume <كيان>` · `runs` · `fetch <source-id>`. لا توجد تبعيات خارجية أو مصادر مدفوعة.

## أين نحن

مرحلة البناء: B0 (مختومة، PR #1) ← **B1 (مختومة 2026-09-27، PR #2: الزمن + الحالة + الاستئناف + CLI)** ← **B2 الجالبات** ← **B3 التطبيع + التجميع + المقاييس + burst + الرادار + جرد WordPress** ← B4→B7، ثم يبدأ التشغيل التحريري.
قرارات المجلس المؤرشفة وأثرها في `state/decisions.md` — منها: إلزامية البوابة الحتمية بحقن الشبكة في كل حزمة، وإلغاء مسار B2′ أرشيفياً (المرجع الوحيد للرادار هو B2).
