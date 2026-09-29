# مسبار الشبكة الحيّ — جلسة الاستئناف RESUME-B3-RADAR-LIVE

- **التاريخ (ساعة البيئة، UTC):** 2026-09-29
- **الأمر:** موافقة الاستئناف `RESUME-B3-RADAR-LIVE` — البند 1 (مسبار ثلاثي بالمخرجات الخام)، والبند 3 عند الفشل الكامل.
- **البيئة:** صندوق e2b معزول (`E2B_SANDBOX=true`, `E2B_SANDBOX_ID=imtv4j0vpu2n8d9b454dv`) — المنفّذ الوحيد: هذه الجلسة.
- **النتيجة:** ❌ **فشل المسبار الثلاثي كاملاً (0/3)** → تطبيق البند 3: إعلان بالفشل مع الأدلة، توقف. **لا fixtures، ولا بيانات من بيئة المجلس، ولا تشغيل رادار ولا لوحة، ولا كتابة في `state/`.**

---

## 1) المسبار الثلاثي — المخرجات الخام

المنفّذ: `engine/fetchers/connectivity.js:probeConnectivity()` كما هو في المستودع، بلا أي تعديل، وبلا حقن fetch.

### تشغيل A

### capture start 2026-09-29T01:32:28Z (env clock)
--- run A: engine probeConnectivity (unmodified) ---
[probe google] reachable=false status=— response_ms=58.3 url=https://www.google.com/generate_204 error=TypeError: fetch failed (ECONNRESET)
[probe wikipedia] reachable=false status=— response_ms=6.6 url=https://ar.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json error=TypeError: fetch failed (ECONNRESET)
[probe bing] reachable=false status=— response_ms=7.5 url=https://www.bing.com/search?q=%D8%A7%D9%84%D8%B3%D8%B9%D9%88%D8%AF%D9%8A%D8%A9 error=TypeError: fetch failed (ECONNRESET)
[
  {
    "host": "google",
    "url": "https://www.google.com/generate_204",
    "reachable": false,
    "status": null,
    "response_ms": 58.3,
    "error": "TypeError: fetch failed (ECONNRESET)"
  },
  {
    "host": "wikipedia",
    "url": "https://ar.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json",
    "reachable": false,
    "status": null,
    "response_ms": 6.6,
    "error": "TypeError: fetch failed (ECONNRESET)"
  },
  {
    "host": "bing",
    "url": "https://www.bing.com/search?q=%D8%A7%D9%84%D8%B3%D8%B9%D9%88%D8%AF%D9%8A%D8%A9",
    "reachable": false,
    "status": null,
    "response_ms": 7.5,
    "error": "TypeError: fetch failed (ECONNRESET)"
  }
]
--- run B (repeat, reproducibility) ---
[probe google] reachable=false status=— response_ms=58.4 error=TypeError: fetch failed (ECONNRESET)
[probe wikipedia] reachable=false status=— response_ms=24.7 error=TypeError: fetch failed (ECONNRESET)
[probe bing] reachable=false status=— response_ms=14.9 error=TypeError: fetch failed (ECONNRESET)
### capture end 2026-09-29T01:32:44Z

---

## 2) مصفوفة المضيفات الفعلية للرادار (curl — شهادة مستقلة عن Node)

المتحقق أدناه هو كل مضيف يستدعيه تشغيل `radar --section "تريند-الشارع" --scope "السعودية" --depth "سريع"`، زائد مرجع الزمن والجرد، وزائد شاهد ضبط (control) على مضيف مسموح في هذه البيئة.

### host matrix 2026-09-29T01:32:30Z
google (TRI-1)               curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to www.google.com:443 
wikipedia (TRI-2)            curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ar.wikipedia.org:443 
bing (TRI-3)                 curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to www.bing.com:443 
trends-rss                   curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to trends.google.com:443 
gnews                        curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to news.google.com:443 
telegram                     curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to t.me:443 
wiki-rc                      curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ar.wikipedia.org:443 
wiki-top                     curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to wikimedia.org:443 
bing-dorks                   curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to www.bing.com:443 
wayback-cdx                  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to web.archive.org:443 
gdelt-files                  curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to data.gdeltproject.org:443 
sawtalhijaz.com (TIME/SITEMAP) curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to sawtalhijaz.com:443 
CONTROL github (allowlisted) HTTP=200 remote=20.29.134.17:443 tls=0.029243s

---

## 3) تشخيص السبب الجذري (مع شاهد الضبط)

البيئة مخرَجها مقيّد بقائمة سماح (allowlist) عبر وسيط اعتراض (e2b egress proxy) بشهادة `e2b-ca.crt` في `/usr/local/share/ca-certificates/`. الأدلة:

| الفحص | الأمر | النتيجة |
|---|---|---|
| DNS سليم | `getent hosts www.google.com ar.wikipedia.org www.bing.com sawtalhijaz.com` | ✅ كل المضيفات تُحلّ (IPv4 + IPv6) |
| TCP يُقبل ثم يُقطع | `node net.connect` لكل المضيفات ومنافذها | TCP=connect ثم قطع في طبقة TLS (`ECONNRESET`) |
| TLS يفشل سريعاً | `curl -4/-6` | `SSL_ERROR_SYSCALL` خلال 10–90ms |
| HTTP العاري يفشل | `curl http://example.com/` | `curl: (52) Empty reply from server` |
| شاهد ضبط: مضيف مسموح | `curl https://api.github.com/rate_limit` | ✅ `HTTP=200 tls=0.029s` |
| شاهد ضبط: Node سليم | `NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/e2b-ca.crt node -e 'fetch(github)'` | ✅ `HTTP 200` (برأس Date حقيقي) |
| Node + شهادة البيئة على مضيفات المسبار | نفس الأمر مع google/wikipedia/bing/sawtalhijaz | ❌ `ECONNRESET` لكلها |

**الخلاصة التشخيصية:** عميل الشبكة في البيئة (Node/curl/DNS) **سليم ومثبَت بالشاهد**؛ الفشل هو **سياسة الخروج** لا عيب أدوات: المضيفات المسموحة (GitHub ومنصّة الجلسة) تعمل، وكل مضيفات الرادار الحيّ ومصادره ومرجع الزمن `sawtalhijaz.com` تُقطع في طبقة TLS بلا استثناء.

ملاحظة Node إضافية غير مانعة: Node لا يثق بشهادة وسيط البيئة افتراضياً (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` على المضيف المسموح)، ويلزمه `NODE_EXTRA_CA_CERTS` — وهذا **شرط لازم لكن غير كافٍ**، لأن مضيفات المسبار تُقطع حتى مع تحميل الشهادة (الجدول أعلاه).

---

## 4) القرار المطبَّق (البند 3 من موافقة الاستئناف)

> «إن فشل المسبار كله: أعلن ذلك بالأدلة وتوقف — بلا fixtures ولا بيانات من بيئة المجلس.»

- المسبار الثلاثي = **0/3** (google، wikipedia، bing) في تشغيلين متتاليين + شهادة curl مستقلة، مع نجاح شاهد الضبط.
- **لم يُشغَّل** `radar` ولا `dashboard` في هذه الجلسة.
- **لم تُكتب** أي fixture ولا ملف حالة ولا سجل تشغيل. `state/` كما هو (الفرق الوحيد في شجرة العمل هو هذا الملف في `reports/`)، و`state/time-manual.json` بقي `iso=null` (لم يُثبّت زمن يدوي).
- البيانات الوحيدة المسجلة هنا هي **أدلة الشبكة الخام** لهذه الجلسة — لا أرقام مصادر ولا مواضيع ولا لوحة.

### ما يلزم لفتح الرادار الحيّ من بيئة جلسة كهذه

إمّا إدراج مضيفات المصادر في قائمة سماح بيئة الجلسة:

`www.google.com` · `trends.google.com` · `news.google.com` · `ar.wikipedia.org` · `wikimedia.org` · `www.bing.com` · `t.me` · `data.gdeltproject.org` · `web.archive.org` · `sawtalhijaz.com`

أو تزويد البيئة بوسيط HTTP صريح يمرّره `fetch` مع `NODE_EXTRA_CA_CERTS` لشهادة الوسيط. عند أيٍّ منهما يُعاد تنفيذ البندين 1 و2 كاملين كما أمر المالك.

---

*(سجل أدلة خام — من جلسة الاستئناف RESUME-B3-RADAR-LIVE، لا يُعدّ تشغيلاً حياً ولا يُحتسب في سجل الرادار.)*
