# ختم B1 — 2026-09-27

الزمن: 2026-09-26T23:22:36.068Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
الفرع: `arena/01a0d22a-sawtalhijaz-newsroom` — الرأس: `b328db1` (+ هذا التقرير) · الدمج: PR #2 وفق `MERGE-PR-2-2026-09-27`.

## نصّ اعتماد المجلس (حرفي)

> ختم المجلس: B1 أخضر — أُعيد بناؤه من المواصفة بعد فقد الرقعة، وبوابة حتمية بحقن fetch (نمط معتمد إلزامياً). وأُلغي مسار B2′ أرشيفياً.
>
> موافقة الدمج:  MERGE-PR-2-2026-09-27

## بوابة الختم على الرأس المدموج (خضراء، `exit 0`)

```
== B1 SELFTEST ==
الزمن: 2026-09-26T23:22:36.068Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
— بنية الزمن —
iso=2026-09-26T23:22:36.068Z  source=unverified  skewSeconds=0
envIso=2026-09-26T23:22:36.068Z  headerIso=null
note=زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.

البيئة المعزولة: state/runs/_selftest/2026-09-26T23-22-36-068Z
person.path: state/people/exec-editor.json

— حالات البروتوكول (محقونة) —
env         iso=2026-09-26T23:22:36.2xxZ skew=0ث   headerIso=2026-09-26T23:22:36.000Z
header      iso=2026-09-26T23:24:06.xxxZ skew=90ث  headerIso=<نفس الهيدر>   ← الهيدر المرجع الحاكم
manual      iso=2026-09-26T23:22:36+7908ث skew=7908ث headerIso=—
unverified  iso=2026-09-26T23:22:36.360Z skew=0ث   headerIso=—
recorded-run: state/runs/2026-09-26T23-22-36-068Z-B1-selftest.json

— سطر الاستئناف —
الاستئناف (exec-editor) — الدور: exec-editor — رئيس التحرير التنفيذي | آخر تشغيل: 2026-09-26T23:22:36.068Z | آخر ملخص: [selftest] B1 patch نجح | التالي المخطط: [selftest] تحقق القراءة | المعلقات (1): B1-selftest | العدّاد: 1 | غياب منذ آخر تشغيل: 0 س

— تحقق البنية —
timeStructureOK=✓ protocolEnv=✓ protocolHeader=✓ protocolManual=✓ protocolUnverified=✓
atomicOK=✓ patchOK=✓ runOK=✓ resumeOK=✓ allOK=✓
totalMs=304
سجل التشغيل: state/runs/2026-09-26T23-22-36-068Z-B1-selftest.json

النتيجة: خضراء — بوابة B1 مقفلة
== B1 SELFTEST END ==
```

## الأثر المؤرشف من قرارات الختم

| قرار | الأثر في المستودع |
|---|---|
| ختم B1 أخضر | B1 مقفلة؛ الأدلة في `reports/B1.md` + هذا التقرير |
| البوابة الحتمية بحقن fetch **إلزامية** | ثُبّتت في `GOVERNANCE.md` كشرط لكل حزم B2→B7 (البوابة تُثبت السلوك محقوناً داخل الاختبار، وفشل الشبكة يُوسم صراحةً ولا يُسقط بوابة السلوك) |
| إلغاء مسار B2′ أرشيفياً | قُيّد في `GOVERNANCE.md` و`state/decisions.md`: لا يُبنى B2′ ولا يُستأنف، والمرجع الوحيد للرادار هو B2 |
| اعتماد الدمج | `MERGE-PR-2-2026-09-27` → دمج PR #2 في `main` |

## ملاحظات للمجلس

1. **درس فقد الرقعة أصبح قاعدة**: كل حزمة تُدفع فور إقفال بوابتها وقبل أي طلب دمج؛ لا عمل معتمد على رقعة خارج git.
2. **العمل داخل جلسة الدمج محفوظ**: أُثبّتت قراراتكم وبوابة الختم في commit قبل `gh pr merge` — كل هذا يدخل `main` مع الدمج نفسه.
3. **الخطوة التالية**: B2 (محرك الرادار: المصادر + كشف أقل من 10 دقائق + التشبع + backoff/cache-first) — تنتظر أمر المالك في جلسة جديدة، وبوابتها ستلتزم بنمط الحقن الحتمي.
