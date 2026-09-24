# sawtalhijaz-newsroom

غرفة أخبار صوت الحجاز — نظام إعلامي يدوي (رادار + مختبرات + هندسة + 8 مكاتب).
الحوكمة في GOVERNANCE.md (بصمة المشروع) — اقرأها قبل أي تشغيل.
شجرة الإعدادات في config/ (JSON في B0، YAML مخطط مستقبلي) ومصادر البيانات في state/.
سكربتات التشغيل عبر `npm run <status|resume|radar|test|dashboard>` (stubs تُملأ في B1+).
البوابات الخضر: قراءة GOVERNANCE + طباعة الإعدادات + ls للشجرة + commit/push لكل حزمة.
التقارير تُكتب في reports/، المخرجات المؤقتة في out/، السجلات في state/runs/.
الذاكرة: state/topics.json، state/runs/، state/people/، state/labs/ تُدفع بعد كل تشغيل.
اللغة: العربية افتراضياً، والمنطقة الافتراضية SA مع gl/hl/ceid في config/geos.json.
مرحلة البناء الحالية: B0 من B0→B7 — التشغيل التحريري يبدأ بعد ختم B7.
