# ختم B4 — 2026-09-29

الزمن: 2026-09-28T22:42:11.844Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
الفرع: `arena/01a0e9f9-sawtalhijaz-newsroom` — الرأس المختوم: `94a5ada` (+ هذا التقرير وبوابة الختم) · الدمج: **PR #4** وفق `MERGE-PR-4-2026-09-29`.

## نصّ اعتماد المجلس (حرفي)

> موافقة الدمج: MERGE-PR-4-2026-09-29

وما سبقه في الجلسة نفسها (مؤرشف حرفياً في `state/decisions.md` — قيد 2026-09-28):

> ختم المجلس: B3 أخضر مشروط. الخطوة صفر من B4 إلزامية قبل أي عمل B4: (1) إعادة تسمية engine/*.mjs الجديدة … إلى .js بتحديث كل مواضع الاستيراد (قرار B1: .js حصراً)، ثم إعادة تشغيل بوابات B1+B2+B3 كاملة على الرأس الجديد — يجب أن تبقى خضراء 10/10+20+14. (2) مسبار شبكة طازج في هذه الجلسة … (3) توثيق في skills.md: انحراف عملية أول … ثم نفّذ B4 كاملاً من مواصفته.

## بوابة الختم على الرأس المختوم (خضراء، `exit 0`)

```
$ git rev-parse --short HEAD
94a5ada
$ node engine/cli.js selftest
== B1 + B2 + B3 + B4 SELFTEST ==
الزمن: 2026-09-28T22:42:11.844Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
…
النتيجة: خضراء — بوابة B2 حتمية بلا شبكة
النتيجة: خضراء — رادار B3 كامل عبر fixtures معزولة
النتيجة: خضراء — مولد الداشبورد B4 كامل عبر fixtures معزولة
النتيجة: خضراء — بوابات B1+B2+B3+B4 مقفلة

— تحقق البنية —
timeStructureOK=✓
protocolEnv=✓
protocolHeader=✓
protocolManual=✓
protocolUnverified=✓
atomicOK=✓
patchOK=✓
runOK=✓
resumeOK=✓
allOK=✓
fetchersB2=✓
radarB3=✓
dashboardB4=✓
totalMs=654
سجل التشغيل: state/runs/2026-09-28T22-42-11-844Z-B4-selftest.json

النتيجة: خضراء — بوابات B1+B2+B3+B4 مقفلة
$ echo $?
0
```

العدّ الخام: **B1 = 10/10 ✓** (+3 فحوص تجميعية `fetchersB2 radarB3 dashboardB4`) · **B2 = 20/20 ✓** · **B3 = 24/24 ✓** · **B4 = 16/16 ✓**.

ملخص بوابة B3 من التشغيل نفسه (بيانات fixtures معزولة):

```
fixture_time=2026-09-27T12:00:00.000Z | source=manual
baseline=التشغيلان الأولان يبنيان خط الأساس — التوقعات متحفظة
radar_summary={"rawItems":16,"normalizedItems":10,"topics":10,"dataFresh":true,"sourceCount":5,"failedSources":0,"inventoryStatus":"ok"}
sample_topic={"id":"topic-60e120482202c8","title":"روشن تعلن موعد الجولة المقبلة","speed":0,"acceleration":0,"saturation":20,"score":72.5,"classification":"مزدحم"}
inventory_summary={"urls":5,"sections":3,"tags":1,"authors":1}
```

## الأثر المؤرشف من اعتماد الدمج

| قرار | الأثر في المستودع |
|---|---|
| `MERGE-PR-4-2026-09-29` | دمج PR #4 في `main` بـ`gh pr merge 4 --merge`؛ B4 مختومة |
| ختم B4 (مولد الداشبورد) | `engine/dashboard.js` + `engine/dashboard-selftest.js` (16 فحصاً) + أمر `cli dashboard` + `checks.dashboardB4` داخل `selftest` + `out/radar-2026-09-27T12-00-00-000Z.html` + `reports/B4.md` |
| الخطوة صفر (1) `.js` حصراً | لا `.mjs` في المحرك؛ البوابات أعيد تشغيلها خضراء على الرأس الجديد قبل أي كود B4 |
| الخطوة صفر (2) المسبار الطازج | ثلاث محاولات فعلية فاشلة بمخرجاتها الخام → الدين الحي (B2 حي + B3 حي + جرد حقيقي) **مؤجل ومبرر** |
| الخطوة صفر (3) انحراف العملية | مقيّد في `state/skills.md`؛ القاعدة باقية: حزمة واحدة لكل جلسة تُفتح بعد دمج سابقتها |
| عمل جلسة الدمج محفوظ | بوابة الختم + هذا التقرير + قيد `state/decisions.md` في commit على الفرع **قبل** `gh pr merge` — يدخل `main` مع الدمج نفسه (نمط ختم B1) |

## التحقق بعد الدمج على `origin/main`

(يُملأ بعد `gh pr merge` — النتيجة الخام أدناه في ملحق هذا التقرير، وفي محادثة الجلسة.)

## ملاحظات للمجلس

1. **الدين الحي هو البند المفتوح الوحيد**: أول تشغيل رادار حي يسدّ ثلاثياً (جلب B2 الحي + `state/topics-latest.json` حقيقية + `state/inventory.json` حقيقي)، وبعده `node engine/cli.js dashboard` ينتج لوحة ببيانات حقيقية بدل مسار `--from-fixtures`. يتطلب شبكة أو حقلة زمن يدوية (`settime`) عند الانقطاع.
2. **أربع ملاحظات مرفوعة بلا تنفيذ أحادي** (نصّها في `reports/B4.md` بند 5 و`state/decisions.md` قيد 2026-09-29 البند 5): تسمية `dashboard.js` مقابل `dashboard.mjs` في نصّ التفويض · خريطة الحزم في `GOVERNANCE.md` (B4 المختبرات / B7 اللوحة) · دلالة تصنيف درجة الفرصة المعكوسة في محرك B3 (تصحيحها يغيّر بوابة مختومة) · عدد فحوص B3 المنفذة 24 لا 14.
3. **الحزمة التالية بحسب خريطة `GOVERNANCE.md`**: B5 الاختبارات (كشف/تنبؤ/تشبع/مصادر) — تنتظر أمر المالك في **جلسة جديدة تُفتح بعد هذا الدمج**، التزاماً بقاعدة الحزمة الواحدة لكل جلسة.
