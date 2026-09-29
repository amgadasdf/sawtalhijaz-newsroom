# عناوين المصادر — مراجعة B7 المحلية

المرجع الوحيد: `config/sources.json`. الوصول العام بلا مفاتيح أو اشتراك كما هو مضبوط في الكود، وليس إثبات إتاحة حية أو ضماناً مستقبلياً لشروط الخدمة. لا اشتراك جديد ولا اعتماد مصدر جديد.

| المعرّف | العنوان | الحالة | التوثيق المحلي |
|---|---|---|---|
| trends-rss | https://trends.google.com/trending/rss?geo=SA | مفعّل | RSS العام من Google Trends للسعودية |
| gnews | https://news.google.com/rss/search | مفعّل | GNews: when:1h عام + استعلام لكل قسم من desks |
| telegram | https://t.me/s/{channel} | مفعّل | ثلاث قنوات سعودية عامة عبر HTML preview |
| wiki-top | https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ar.wikipedia.org/all-access/{date} | مفعّل | مشاهدات ويكيبيديا العربية لليوم السابق |
| wiki-rc | https://ar.wikipedia.org/w/api.php | مفعّل | recentchanges من واجهة ويكيبيديا العربية |
| wayback-cdx | https://web.archive.org/cdx/search/cdx | مفعّل | تقارير أسبوعية فقط؛ معطل في الرادار اليومي |
| gdelt-files | https://data.gdeltproject.org/gdeltv2/lastupdate.txt | مفعّل | lastupdate.txt ثم ملف export.CSV.zip الأحدث وحده، مع فلترة الصفوف العربية |
| bing-dorks | https://www.bing.com/search | مفعّل | دوركس البحث الأولية من config/dorks-init.json؛ سقف عشرة نتائج |
| bridge | https://rss-bridge.org/bridge01/ | معطّل؛ لا يُستخدم | معطل؛ لا يفعّل إلا باعتماد مجلس موثق |
| gdelt-doc | https://api.gdeltproject.org/api/v2/doc/doc | معطّل؛ لا يُستخدم | مشروط — يعطي 429 عند الاستخدام المكثف؛ يفعّل بقرار المجلس |
| rsshub | https://rsshub.app/... | معطّل؛ لا يُستخدم | مستبعد حالياً — 403 في البيئة |
| searxng | https://searxng.site/... | معطّل؛ لا يُستخدم | مستبعد حالياً — بلا JSON في الاستجابة |
| reddit | https://www.reddit.com/r/{sub}/.rss | معطّل؛ لا يُستخدم | مستبعد حالياً — 403 |

الجرد العام: https://sawtalhijaz.com/sitemap.xml و https://sawtalhijaz.com/sitemap-0.xml
مرجع الزمن: https://sawtalhijaz.com/ عبر HEAD/GET. مسبارات الاتصال: Google/Wikipedia/Bing (تعريفاتها في engine/fetchers/connectivity.js).

طلبات التشغيل الحي تكشف بطبيعتها عنوان IP والاستعلام للمصدر؛ لا يصح وصف النظام الحي بأنه عديم الاتصال. لا مسار رفع للحالة أو تحليلات تتبع في الكود المراجع. الداشبورد ملف محلي بلا موارد نشطة. Git push وPR إرسال صريح للمستودع إلى GitHub بطلب المالك، لا تسريب خفي.
