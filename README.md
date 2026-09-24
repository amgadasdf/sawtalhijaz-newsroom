# sawtalhijaz-newsroom

غرفة أخبار صوت الحجاز — نظام إعلامي يدوي (رادار + مختبرات + هندسة + 8 مكاتب).
الحوكمة في GOVERNANCE.md (بصمة المشروع) — اقرأها قبل أي تشغيل.
شجرة الإعدادات في config/ (JSON في B0، YAML مخطط مستقبلي) ومصادر البيانات في state/.
اللغة: العربية افتراضياً، والمنطقة الافتراضية SA مع gl/hl/ceid في config/geos.json.

## التشغيل (B1)

ملف واحد لكل الأوامر — صفر تبعيات (Node ≥ 20، ESM):

```bash
node engine/cli.js status                     # تقرير الحالة من state/ (قراءة فقط)
node engine/cli.js time                       # وثيقة الزمن الموثق (البروتوكول الثلاثي)
node engine/cli.js resume all                 # سطر الاستئناف: radar + 11 شخص + 4 مختبرات
node engine/cli.js resume exec-editor         # كيان واحد (أو lab:discovery / radar)
node engine/cli.js settime "2026-09-24T09:00:00Z" --note "حقلة يدوية"
node engine/cli.js settime --clear            # مسح الزمن اليدوي
node engine/cli.js runs 20                    # آخر التشغيلات المسجلة
node engine/cli.js selftest                   # بوابة B1 الإلزامية (exit 0 = خضراء)
```

مكافئ npm: `npm run status | time | resume | runs | selftest`.
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

- **بوابة B1 الإلزامية**: `node engine/cli.js selftest` — كتابة→تعديل→قراءة→سجل تشغيل→سطر استئناف+التحقق من بنية الزمن، مع محاكاة الأوضاع الأربعة بحقن fetch.
- بوابات مساعدة: `status` · `resume <كيان>` · `runs`.

## أين نحن

مرحلة البناء: B0 (مقفلة، PR #1) ← **B1 (هذه الحزمة: الزمن + الحالة + الاستئناف + CLI)** ← B2 رادار ← … ← B7 ختم، ثم يبدأ التشغيل التحريري.
