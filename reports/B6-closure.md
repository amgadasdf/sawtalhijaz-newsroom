# ختم B6 — 2026-09-29

الزمن الموثق: مصدر=unverified | مصدر=unverified · الزمن الكامل كما طُبع: الزمن: 2026-09-29T00:12:56.327Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
الفرع: `arena/01a0ea6e-sawtalhijaz-newsroom` — الرأس المختوم: `18d0c77` (+ هذا التقرير وقيد القرار) · الدمج: **PR #6** وفق `MERGE-PR-6-2026-09-29`.

## نصّ اعتماد المجلس (حرفي)

> ختم المجلس: B6 أخضر — الانحرافان المعلنان معتمدان (tests.js + dorks.yaml بقارئ داخلي؛ مصادر remain JSON). ملاحظة فرق العدّ في بوابة B4 (17/16) مسجلة وغير مانعة.
>
> موافقة الدمج: MERGE-PR-6-2026-09-29

## بوابة الختم على الرأس المختوم (خضراء، `exit 0`)

الأمر: `node engine/cli.js selftest` — على الرأس `18d0c77`، **قبل** commit الإقفال (الإقفال يضيف مستندات فقط: هذا التقرير + قيد `state/decisions.md` + سطرَي الحوكمة والقراءة — لا تغيير كود ولا بوابة).

```text
$ git rev-parse --short HEAD
18d0c77
$ node engine/cli.js selftest
== B1 + B2 + B3 + B4 + B5 + B6 SELFTEST ==
الزمن: 2026-09-29T00:12:56.327Z | مصدر=unverified | skew=0ث | زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com (TypeError: fetch failed (ECONNRESET)). يلزم حقلة يدوية عبر settime.
…
النتيجة: خضراء — بوابة B2 حتمية بلا شبكة
النتيجة: خضراء — رادار B3 كامل عبر fixtures معزولة
النتيجة: خضراء — مولد الداشبورد B4 كامل عبر fixtures معزولة
النتيجة: خضراء — حزمة B5 والبوابة التجريبية مكتملتان

— بوابة B6 (الاختبارات والتقارير وسجل الدوركس؛ جذر معزول) —
testsB6=✓ | فحوص البوابة 17/17 | الجذر المعزول: ../../../tmp/sawtalhijaz-b6-gate-HIzZuY

— تحقق البنية —
testsB6=✓ | فحوص البوابة 17/17 | الجذر المعزول: ../../../tmp/sawtalhijaz-b6-gate-HIzZuY
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
promptsB5=✓
testsB6=✓
totalMs=1807
سجل التشغيل: state/runs/2026-09-29T00-12-56-327Z-B6-selftest.json

النتيجة: خضراء — بوابات B1+B2+B3+B4+B5+B6 مقفلة
== B1 + B2 + B3 + B4 + B5 + B6 SELFTEST END ==
$ echo $?
0
```

العدّ الخام (سطور تنتهي بـ`=✓`/`=✗` داخل كل كتلة): **B1 بنيوي = 10/10 ✓** (+5 تجميعية: `fetchersB2` · `radarB3` · `dashboardB4` · `promptsB5` · `testsB6`) · **B2 = 21/21 ✓** · **B3 = 24/24 ✓** · **B4 = 17/17 ✓** · **B5 = 10/10 ✓** · **B6 = 17/17 ✓** · `totalMs=1807`.

تفصيل بوابة B6 السبع عشرة (من التشغيل المباشر `node engine/b6-selftest.js` الموثق في `reports/B6.md` قسم الأدلة، وأهمها):

```text
b6FixturesRegistryAndFormsPresent=✓ | fixtures=7; forms=feature-proposal.md=✓ obstacle-report.md=✓
detectionOnSavedSampleWithinTwoHours=✓ | baseline=10; matched=3; inWindow=4; precision=30%
forecastMatrixAndHitRate=✓ | verified=1; notVerified=1; regressed=1; pending=1; hitRate=33.33%
saturationMeasurementGap=✓ | mean=11; max=18; verdict=فجوة ملحوظة
sourcesHealthRefreshResponseAndCooldowns=✓ | total=13; healthy=3; cooling=1; stale=1; slowest=trends-rss 5200ms
reportSevenFieldStructureOnDisk=✓ | fields=7/7; run=#2; file=reports/tests-2026-09-29T00-01-38-999Z.md
reportWrittenAtomicallyAndMirrored=✓ | mirror=state/tests-latest.json; residue=0
sourcesHealthUpdatedWithoutTouchingLiveFields=✓ | liveFieldsUntouched=true; tests.last_run_iso=2026-09-29T00:01:38.999Z
skillsHitRateBlockUpdatedInPlace=✓ | markers=1/1; idempotent=true; خارج الكتلة بلا تغيير=true
improvementFieldExplicitComparison=✓ | تحسن=8; تراجع=1; أول تقرير=true
toolsCostZeroOrCouncilDecision=✓ | tools=5; zeroCost=3; decisions=2
dorksRegistryValidAndClassified=✓ | dorks=10; categories=10
dorksBlockedWithoutRecordedTestResult=✓ | blocked=10; usableBefore=0; usableAfter=1; realUntouched=true
reportFormsStructure=✓ | feature-proposal.md=✓ obstacle-report.md=✓
zeroNetworkCallsDuringGate=✓ | fetchCalls=0
suiteWiredIntoSelftestCliAndScripts=✓ | scripts=tests,b6-gate
stateRunReportsUnavailableDataExplicitly=✓ | executed=1/4; errors=3; sources=13
```

## الأثر المؤرشف من اعتماد الدمج

| قرار | الأثر في المستودع |
|---|---|
| `MERGE-PR-6-2026-09-29` | دمج PR #6 في `main` بـ`gh pr merge 6 --merge`؛ B6 مختومة |
| الانحراف ① معتمد | `engine/tests.js` هو التنفيذ المعتمد لـ«الاختبارات الأربعة»؛ لا `tests.mjs` (قرار `.js` حصراً) |
| الانحراف ② معتمد | `config/dorks.yaml` صيغة معتمدة لهذا السجل بقارئ YAML جزئي داخلي (صفر مكتبات)؛ قرار «JSON صيغة الحقيقة الوحيدة» باقٍ على إعدادات المصادر (مصادر remain JSON) |
| ملاحظة فرق العدّ B4 | 17 فحصاً منفذاً مقابل «16» في نصوص B4 — **مسجلة وغير مانعة** (لا تعديل على بوابة B4) |
| ختم B6 | `engine/tests.js` (الأربعة + تقرير 7 حقول) + `engine/dorks.js` + `config/dorks.yaml` + `engine/b6-selftest.js` (17) + `reports/forms/*` + توصيل `cli/selftest/package.json` + `state/tests-latest.json` |
| توحيد `chief-editor` | مقيّد في `state/skills.md` (برومت `chief-editor` + كيان الحالة `exec-editor` بمعرّف تاريخي) — أُنجز في B6 كما أُمر في ختم B5 |
| عمل جلسة الدمج محفوظ | بوابة الختم + هذا التقرير + قيد `state/decisions.md` + سطر الحوكمة والقراءة في commit على الفرع **قبل** `gh pr merge` — يدخل `main` مع الدمج نفسه (نمط ختم B1/B4) |

## التحقق بعد الدمج على `origin/main`

(يُملأ بعد `gh pr merge` — النتيجة الخام أدناه في محادثة الجلسة.)

## ملاحظات للمجلس

1. **الدين الحي هو البند المفتوح الوحيد** (مؤجل إلى بطارية B7 بقرار المجلس): جلب B2 حي + رادار B3 حي + جرد حقيقي + لوحة حية + **اختبار كشف حي** بدل مسار `--from-fixtures`. مسبار هذه الجلسة فشل على أربعة مضيفات (`ECONNRESET` / `SSL_ERROR_SYSCALL` — الخام في `reports/B6.md` قسم 7)، وبوابة B6 اجتازت على عينة محفوظة (fixtures) موسومة «غير حية» كما ينصّ التكليف.
2. **لا مساس ببيانات حية**: مساحة `tests` في `state/sources-health.json` معزولة (`liveFieldsUntouched=true`)، والسجل الحقيقي للدوركس بلا أي نتيجة مُسجَّلة (كلها معطّلة حتى تُختبر)، و`config/sources.json` و`config/dorks-init.json` و`prompts/` كما هي.
3. **تقرير الاختبار الملتزم**: `reports/tests-2026-09-29T00-01-38-418Z.md` (حالة حقيقية: كشف/تنبؤ/تشبع «لم يُنفذ» بأسباب جذرية) و`reports/tests-2026-09-29T00-01-38-999Z.md` (fixtures: 30% كشف · 33.33% إصابة · فجوة 11 نقطة · 13 مصدراً) مع سجلي الرن `state/runs/*-B6-tests.json`.
4. **الحزمة التالية بحسب خريطة `GOVERNANCE.md`**: B7 التسليم والختم — تنتظر أمر المالك في **جلسة جديدة تُفتح بعد هذا الدمج**، التزاماً بقاعدة الحزمة الواحدة لكل جلسة.
