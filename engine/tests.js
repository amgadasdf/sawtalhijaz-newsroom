// engine/tests.js — حزمة B6: الاختبارات الأربعة بأمر موحد + مولد تقرير الاختبار بالبنية الثابتة (7 حقول) + السجلات.
//
//   node engine/tests.js                 تشغيل الاختبارات الأربعة على حالة المشروع الحقيقية (بلا شبكة)
//   node engine/tests.js --from-fixtures  نفس الاختبارات على عينة fixtures معزولة (بوابة حتمية) — غير حية
//   node engine/tests.js --type كشف        اختبار واحد فقط
//
// الاختبارات (أمر موحد):
//   1) كشف    — مقارنة مواضيع تشغيل رادار محفوظ بما تحقق لاحقاً في gnews خلال ساعتين (نافذة الكشف).
//   2) تنبؤ   — مصفوفة كل ما وُسم «متوقع خلال ساعات»: تحقق/لم يتحقق/تراجع/بانتظار + معدل الإصابة في state/skills.md.
//   3) تشبع   — عينة يدوية مقابل مخرج المحرك (فجوة القياس) — لا عينة مصنوعة في الحالة الحقيقية.
//   4) مصادر  — صحة كل مصدر: تجدد فعلي، زمن استجابة، تبريدات، ميزانية، أخطاء.
//
// المخرجات: reports/tests-<طابع زمني موثق>.md + .json (البنية الثابتة 7 حقول) + state/tests-latest.json (ملخص للوحة)
//           + تحديث state/sources-health.json (مساحة اختبار معزولة عن حقول الصحة الحية) + كتلة معدل الإصابة في state/skills.md
//           + سجل تشغيل state/runs/<iso>-B6-tests.json. كل الكتابات ذرية. صفر تبعيات.
//
// قرار B1 المؤكد في الخطوة صفر من B4 ومن B5: الامتداد .js حصراً في المحرك — لا ملفات .mjs.
// انحراف تسمية معلن: مواصفة B6 طلبت engine/tests.mjs، ونُفّذ engine/tests.js التزاماً بقرار الامتداد.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc, timeLine } from "./time.js";
import { compareTitles, normalizeTopicsState } from "./cluster.js";
import { computeForecastExpectation } from "./dashboard.js";
import { createFetchers } from "./fetchers/index.js";
import { FETCHER_SAMPLE_PATH } from "./fetchers/runtime.js";
import { makeB3FixtureEnvironment, makeB3Sandbox, runB3FixtureRadar, B3_FIXTURE_TIME } from "./radar-selftest.js";

// —— ثوابت معلنة (كل عتبة هنا تُطبع في التقرير ولا تعمل في الخفاء) ——
export const DETECTION_WINDOW_HOURS = 2;
export const FORECAST_LABEL = "متوقع خلال ساعات";
export const SATURATION_GAP_WITHIN_POINTS = 10;
export const SATURATION_GAP_NOTABLE_POINTS = 25;
export const SOURCE_FRESHNESS_HOURS = 24;
export const FRESHNESS_FUTURE_TOLERANCE_MINUTES = 5; // تسامح مع فرق ساعة البيئة/العينة داخل الحد نفسه
export const RESPONSE_MS_NORMAL = 1500;
export const RESPONSE_MS_SLOW = 4000;
export const REPORT_DIR = "reports";
export const REPORT_PREFIX = "tests-";
export const TESTS_LATEST_REL = "state/tests-latest.json";
export const MANUAL_SATURATION_REL = "state/samples/saturation-manual.json";
export const SKILLS_REL = "state/skills.md";
export const SKILLS_BLOCK_START = "<!-- B6:FORECAST-HIT-RATE:START -->";
export const SKILLS_BLOCK_END = "<!-- B6:FORECAST-HIT-RATE:END -->";
export const SAMPLE_SOURCE_FIXTURES = "fixtures معزولة — غير حية";
export const SAMPLE_SOURCE_STATE = "حالة المشروع الحقيقية (state/) — بلا شبكة";
export const FORECAST_HIT_RATE_DEFINITION =
  "معدل الإصابة = تحقق ÷ (تحقق + لم يتحقق + تراجع). حالات «بانتظار التحقق» (لا تشغيل لاحق بعد) لا تدخل المقام وتُطبع منفصلة.";

// البنية الثابتة: سبعة حقول بترتيبها — لا يُقبل تقرير ناقص حقل
export const REPORT_FIELDS = Object.freeze([
  { index: 1, id: "time-and-run", heading: "سطر الزمن الموثق + رقم التشغيل" },
  { index: 2, id: "executed", heading: "ما نُفذ والمدد" },
  { index: 3, id: "results", heading: "النتائج بالأرقام" },
  { index: 4, id: "improvement", heading: "مستوى التحسن عن السابق بمقارنة صريحة" },
  { index: 5, id: "errors", heading: "الأخطاء بسببه الجذري" },
  { index: 6, id: "tools", heading: "أدوات ومصادر نحتاج إضافتها بتكلفتها (صفراً أو عرض لقرار)" },
  { index: 7, id: "weights", heading: "توصيات أوزان معلقة على اعتماد المجلس" },
]);

export const TEST_KINDS = Object.freeze(["detection", "forecast", "saturation", "sources"]);
export const TEST_LABELS = Object.freeze({ detection: "كشف", forecast: "تنبؤ", saturation: "تشبع", sources: "مصادر" });
export const TEST_ALIASES = Object.freeze({
  all: "all", كل: "all",
  detection: "detection", كشف: "detection",
  forecast: "forecast", تنبؤ: "forecast",
  saturation: "saturation", تشبع: "saturation",
  sources: "sources", مصادر: "sources",
});

// الحقل 6: كل ما نحتاجه — التكلفة صفر أو عرض صريح لقرار المجلس (baseRule يفرض ذلك آلياً)
export const TOOLS_NEEDED = Object.freeze([
  {
    id: "pytrends-hook",
    name: "hook pytrends المحلي (tools/pytrends-hook.py)",
    cost: 0,
    currency: "ريال",
    decisionRequired: false,
    note: "مجاني. يتطلب python3 ومكتبة pytrends؛ حالياً يعمل كـsafe-stub لأنهما غير متاحين في البيئة — القياس قائم على Z-score من العدّات المحفوظة.",
  },
  {
    id: "arabic-stemmer",
    name: "تطبيع/تجذير عربي خفيف داخل المحرك",
    cost: 0,
    currency: "ريال",
    decisionRequired: false,
    note: "مجاني (كود محلي): يرفع دقة التجميع ويرفع معدل الكشف؛ لا تبعيات خارجية.",
  },
  {
    id: "fanout-rss",
    name: "قائمة RSS موسّعة للمواقع السعودية (بيانات sitemap/RSS المعلنة)",
    cost: 0,
    currency: "ريال",
    decisionRequired: false,
    note: "مجاني: كل المصادر المدرجة حالياً بلا مفاتيح؛ التوسّع بإضافة مصادر مجانية في config/sources.json بعد اعتماد المجلس.",
  },
  {
    id: "search-api-key",
    name: "مفتاح بحث مدفوع (Bing/Google) لسجل الدوركس",
    cost: 1200,
    currency: "ريال/شهر",
    decisionRequired: true,
    note: "عرض لقرار المجلس فقط — لا يُشترى في B6. بدونه تعمل الدوركس عبر HTML العام (config/dorks.yaml) بلا مفاتيح.",
  },
  {
    id: "social-api",
    name: "واجهة منصات اجتماعية رسمية (X/غيرها)",
    cost: 4000,
    currency: "ريال/شهر",
    decisionRequired: true,
    note: "عرض لقرار المجلس فقط — غير مدرج ولا مفعّل. البديل الحالي: رصد عام عبر site:x.com في السجل (بلا مفاتيح).",
  },
]);

const HOUR_MS = 3_600_000;
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round = (value, places = 2) => Number(finite(value).toFixed(places));
const pct = (numerator, denominator) => (denominator > 0 ? round((numerator / denominator) * 100, 2) : null);
const parseMs = (value) => {
  const ms = new Date(value ?? "").getTime();
  return Number.isFinite(ms) ? ms : null;
};
const num = (value, places = 2) => (value === null || value === undefined ? "—" : String(round(value, places)));
const hoursBetween = (fromIso, toIso) => {
  const from = parseMs(fromIso);
  const to = parseMs(toIso);
  return from === null || to === null ? null : round((to - from) / HOUR_MS, 2);
};

function assertNoUndefinedOrNonFinite(value, where = "root", errors = []) {
  if (typeof value === "number" && !Number.isFinite(value)) errors.push(`${where} ليس رقماً منتهياً`);
  else if (value === undefined) errors.push(`${where} غير معرّف (undefined)`);
  else if (Array.isArray(value)) value.forEach((child, index) => assertNoUndefinedOrNonFinite(child, `${where}[${index}]`, errors));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertNoUndefinedOrNonFinite(child, `${where}.${key}`, errors);
  }
  return errors;
}

// ————————————————————————————————————————————————————————————
// (1) اختبار الكشف: مواضيع تشغيل محفوظ مقابل ما تحقق لاحقاً في gnews خلال ساعتين
// ————————————————————————————————————————————————————————————

export function collectBaseline({ root = process.cwd() } = {}) {
  const store = createStore(root);
  const latest = store.readJsonSafe("state/topics-latest.json", null);
  if (latest && Array.isArray(latest.topics) && latest.topics.length) {
    return {
      available: true,
      source: "state/topics-latest.json",
      runIso: latest.time?.iso ?? latest._meta?.generatedAt ?? null,
      timeSource: latest.time?.source ?? latest._meta?.timeSource ?? null,
      dataFresh: latest._meta?.dataFresh ?? null,
      topics: latest.topics,
      topicCount: latest.topics.length,
      reason: null,
    };
  }
  const stateDoc = normalizeTopicsState(store.readJsonSafe("state/topics.json", []));
  if (stateDoc.topics.length) {
    return {
      available: true,
      source: "state/topics.json",
      runIso: stateDoc._meta?.lastRunIso ?? null,
      timeSource: stateDoc._meta?.timeSource ?? null,
      dataFresh: null,
      topics: stateDoc.topics,
      topicCount: stateDoc.topics.length,
      reason: null,
    };
  }
  const radarRuns = store
    .listRuns(500)
    .map((entry) => ({ ...entry, doc: store.readJsonSafe(entry.rel, null) }))
    .filter((entry) => entry.doc?.kind === "B3-radar");
  const withCounts = radarRuns.filter((entry) => entry.doc?.topicCounts && Object.keys(entry.doc.topicCounts).length > 0);
  return {
    available: false,
    source: null,
    runIso: null,
    timeSource: null,
    dataFresh: null,
    topics: [],
    topicCount: 0,
    radarRuns: radarRuns.length,
    radarRunsWithCounts: withCounts.length,
    reason: radarRuns.length
      ? `لا لقطة مواضيع محفوظة بعناوين: ${radarRuns.length} تشغيل B3-radar في السجل (${withCounts.length} منها بعدّات فقط بلا عناوين) — اللقطة تُكتب في state/topics.json وstate/topics-latest.json عند أي تشغيل رادار.`
      : "لا تشغيل رادار محفوظ إطلاقاً (state/topics.json فارغ ولا state/topics-latest.json ولا سجل B3-radar).",
  };
}

function evidenceItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? raw.name ?? raw.text ?? "").replace(/\s+/gu, " ").trim();
  if (!title) return null;
  return {
    title,
    link: String(raw.link ?? raw.url ?? "").trim(),
    publishedAt: raw.publishedAt ?? raw.published_at ?? raw.pubDate ?? raw.date ?? null,
    source: raw.source_id ?? raw.sourceId ?? "gnews",
  };
}

export function collectGnewsEvidence({ root = process.cwd(), mode = "saved", fetchImpl = null } = {}) {
  const store = createStore(root);
  if (mode === "live") {
    const fetchers = createFetchers({ root, ...(fetchImpl ? { fetchImpl } : {}) });
    return fetchers
      .gnews({ maxItems: 20, forceRefresh: false })
      .then((result) => {
        const items = (result.items ?? []).map(evidenceItem).filter(Boolean);
        return {
          available: items.length > 0,
          mode: "live",
          source: "gnews (جلب حي cache-first)",
          fetchedAt: result.fetched_at ?? new Date().toISOString(),
          status: result.status ?? null,
          items,
          reason: items.length ? null : `الجلب الحي أعاد ${result.status ?? "—"} بلا عناصر.`,
        };
      })
      .catch((error) => ({
        available: false,
        mode: "live",
        source: "gnews (جلب حي)",
        fetchedAt: null,
        status: "error",
        items: [],
        reason: `فشل الجلب الحي: ${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
      }));
  }
  const rel = FETCHER_SAMPLE_PATH("gnews");
  const sample = store.readJsonSafe(rel, null);
  if (!sample) {
    return { available: false, mode: "saved", source: rel, fetchedAt: null, status: null, items: [], reason: `لا عينة gnews محفوظة (${rel}).` };
  }
  const items = (Array.isArray(sample.items) ? sample.items : []).map(evidenceItem).filter(Boolean);
  return {
    available: items.length > 0,
    mode: "saved",
    source: rel,
    fetchedAt: sample.fetched_at ?? null,
    status: sample.status ?? null,
    items,
    reason: items.length
      ? null
      : `العينة المحفوظة (${rel}) بلا عناصر: status=${sample.status ?? "—"}${sample.error ? ` — ${String(sample.error).slice(0, 160)}` : ""} (الجالب يُسقط العناصر عند الفشل — لا تُصنَّع عناصر بديلة).`,
  };
}

export function runDetectionTest({ baseline, evidence, referenceIso = null, windowHours = DETECTION_WINDOW_HOURS } = {}) {
  const windowStartMs = parseMs(baseline?.runIso);
  const windowEndMs = windowStartMs === null ? null : windowStartMs + windowHours * HOUR_MS;
  const base = {
    kind: "detection",
    label: TEST_LABELS.detection,
    available: false,
    ok: false,
    windowHours,
    baseline: {
      source: baseline?.source ?? null,
      runIso: baseline?.runIso ?? null,
      timeSource: baseline?.timeSource ?? null,
      topics: baseline?.topicCount ?? 0,
    },
    evidence: {
      source: evidence?.source ?? null,
      mode: evidence?.mode ?? "saved",
      status: evidence?.status ?? null,
      fetchedAt: evidence?.fetchedAt ?? null,
      items: evidence?.items?.length ?? 0,
    },
    window: { startIso: baseline?.runIso ?? null, endIso: windowEndMs === null ? null : new Date(windowEndMs).toISOString(), hours: windowHours },
    matchedTopics: 0,
    unmatchedTopics: baseline?.topicCount ?? 0,
    matchedItems: 0,
    inWindowItems: 0,
    outOfWindowItems: 0,
    unmatchedEvidenceItems: 0,
    precisionPercent: null,
    meanConfirmationMinutes: null,
    minConfirmationMinutes: null,
    maxConfirmationMinutes: null,
    meanDetectionLatencyMinutes: null,
    rows: [],
    reasons: [],
  };
  if (!baseline?.available || windowStartMs === null) base.reasons.push(`لا خط أساس صالح: ${baseline?.reason ?? "لا تشغيل محفوظ"}`);
  if (!evidence?.available) base.reasons.push(`لا دليل gnews صالح: ${evidence?.reason ?? "—"}`);
  if (base.reasons.length) return { ...base, reason: base.reasons.join(" | ") };

  const itemsWithTime = evidence.items.map((item) => ({ ...item, publishedMs: parseMs(item.publishedAt) }));
  const inWindow = itemsWithTime.filter(
    (item) => item.publishedMs !== null && item.publishedMs >= windowStartMs && item.publishedMs <= windowEndMs,
  );
  const outOfWindow = itemsWithTime.filter((item) => item.publishedMs === null || item.publishedMs < windowStartMs || item.publishedMs > windowEndMs);

  const usedItems = new Set();
  const rows = baseline.topics.map((topic) => {
    const comparisons = inWindow.map((item) => ({ item, compare: compareTitles(topic.title, item.title) }));
    const matches = comparisons.filter((entry) => entry.compare.matches);
    const best = matches.sort((a, b) => b.compare.score - a.compare.score)[0] ?? null;
    if (best) usedItems.add(best.item);
    const firstSeenMs = parseMs(topic.firstSeen);
    const detectionLatencyMinutes = firstSeenMs === null ? null : round((windowStartMs - firstSeenMs) / 60000, 2);
    return {
      topicId: topic.id,
      title: topic.title,
      classification: topic.classification ?? topic.metrics?.classification ?? null,
      currentCount: finite(topic.currentCount ?? topic.count ?? topic.members?.length),
      detected: Boolean(best),
      confirmedTitle: best?.item.title ?? null,
      confirmedLink: best?.item.link ?? null,
      similarityScore: best ? round(best.compare.score, 4) : null,
      sharedKeywords: best?.compare.sharedKeywords ?? [],
      confirmationLagMinutes: best ? round((best.item.publishedMs - windowStartMs) / 60000, 2) : null,
      detectionLatencyMinutes,
      firstSeen: topic.firstSeen ?? null,
    };
  });

  const matchedRows = rows.filter((row) => row.detected);
  const lags = matchedRows.map((row) => row.confirmationLagMinutes).filter(Number.isFinite);
  const latencies = matchedRows.map((row) => row.detectionLatencyMinutes).filter(Number.isFinite);
  return {
    ...base,
    available: true,
    ok: true,
    matchedTopics: matchedRows.length,
    unmatchedTopics: rows.length - matchedRows.length,
    matchedItems: usedItems.size,
    inWindowItems: inWindow.length,
    outOfWindowItems: outOfWindow.length,
    unmatchedEvidenceItems: inWindow.length - usedItems.size,
    precisionPercent: pct(matchedRows.length, rows.length),
    meanConfirmationMinutes: lags.length ? round(lags.reduce((sum, value) => sum + value, 0) / lags.length, 2) : null,
    minConfirmationMinutes: lags.length ? Math.min(...lags) : null,
    maxConfirmationMinutes: lags.length ? Math.max(...lags) : null,
    meanDetectionLatencyMinutes: latencies.length ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length, 2) : null,
    referenceIso: referenceIso ?? null,
    rows,
    reason: null,
  };
}

// ————————————————————————————————————————————————————————————
// (2) اختبار التنبؤ: مصفوفة كل ما وُسم «متوقع خلال ساعات» + معدل الإصابة
// ————————————————————————————————————————————————————————————

export function collectForecastSnapshot({ root = process.cwd() } = {}) {
  const store = createStore(root);
  const latest = store.readJsonSafe("state/topics-latest.json", null);
  const stateDoc = normalizeTopicsState(store.readJsonSafe("state/topics.json", []));
  const useLatest = Boolean(latest && Array.isArray(latest.topics) && latest.topics.length);
  const useState = !useLatest && stateDoc.topics.length > 0;
  const source = useLatest ? "state/topics-latest.json" : useState ? "state/topics.json" : null;
  const doc = useLatest ? latest : useState ? stateDoc : null;
  const topics = Array.isArray(doc?.topics) ? doc.topics : [];
  const forecastAtIso = useLatest
    ? latest.time?.iso ?? latest._meta?.generatedAt ?? null
    : useState
      ? stateDoc._meta?.lastRunIso ?? null
      : null;
  const forecasts = topics
    .filter((topic) => topic?.burst?.forecast === FORECAST_LABEL)
    .map((topic) => {
      const topicForecastIso = String(topic?.burst?.forecastAtIso ?? forecastAtIso ?? "");
      const expectation = parseMs(topicForecastIso) === null ? null : computeForecastExpectation(topic, topicForecastIso);
      return {
        topicId: topic.id,
        title: topic.title,
        classification: topic.classification ?? topic.metrics?.classification ?? null,
        countAtForecast: finite(topic.currentCount ?? topic.count ?? topic.members?.length),
        accelerationPerHour: finite(topic.metrics?.accelerationPerHour ?? topic.acceleration),
        saturationPercent: finite(topic.metrics?.saturationPercent ?? topic.saturation),
        forecastAtIso: topicForecastIso || null,
        expectedIso: expectation?.expectedIso ?? null,
        expectedHours: expectation?.hoursToRealize ?? null,
        forecastRule: expectation?.rule ?? null,
      };
    });
  const runs = store
    .listRuns(400)
    .map((entry) => ({ ...entry, doc: store.readJsonSafe(entry.rel, null) }))
    .filter((entry) => entry.doc?.kind === "B3-radar" && entry.doc?.topicCounts && entry.doc.success !== false)
    .map((entry) => ({ iso: entry.doc.iso ?? entry.iso, source: entry.doc.source ?? null, topicCounts: entry.doc.topicCounts, rel: entry.rel }))
    .sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  return {
    available: Boolean(source),
    source,
    forecastAtIso,
    topicsCount: topics.length,
    forecasts,
    runs,
    reason: source
      ? null
      : "لا لقطة مواضيع محفوظة تحمل وسم التنبؤ (state/topics-latest.json أو state/topics.json) — وسم التنبؤ لا يُحفظ في سجلات التشغيل (topicCounts فقط).",
  };
}

export function runForecastTest({ snapshot, referenceIso = null } = {}) {
  const aggregateTemplate = {
    total: 0,
    verified: 0,
    notVerified: 0,
    regressed: 0,
    pending: 0,
    denominator: 0,
    hitRatePercent: null,
    definition: FORECAST_HIT_RATE_DEFINITION,
  };
  if (!snapshot?.available) {
    return {
      kind: "forecast",
      label: TEST_LABELS.forecast,
      available: false,
      ok: false,
      matrix: [],
      aggregates: { ...aggregateTemplate },
      runsObserved: snapshot?.runs?.length ?? 0,
      reason: snapshot?.reason ?? "لا لقطة تنبؤات محفوظة.",
    };
  }
  const rows = snapshot.forecasts.map((forecast) => {
    const later = snapshot.runs.filter((run) => parseMs(forecast.forecastAtIso) !== null && String(run.iso) > String(forecast.forecastAtIso));
    const last = later[later.length - 1] ?? null;
    const hasCount = last && last.topicCounts && Object.hasOwn(last.topicCounts, forecast.topicId);
    const countAtLastRun = hasCount ? finite(last.topicCounts[forecast.topicId]) : null;
    const change = countAtLastRun === null ? null : round(countAtLastRun - forecast.countAtForecast, 2);
    let statusKey = "pending";
    let status = "بانتظار التحقق";
    let note = "لا تشغيل رادار لاحق لوسم التنبؤ بعد.";
    if (last) {
      if (!hasCount) {
        statusKey = "not-verified";
        status = "لم يتحقق";
        note = `الموضوع غير موجود في عدّات التشغيل اللاحق (${last.iso}) — لا ارتفاع مثبت.`;
      } else if (countAtLastRun > forecast.countAtForecast) {
        statusKey = "verified";
        status = "تحقق";
        note = `ارتفع العدّ ${num(forecast.countAtForecast)} ← ${num(countAtLastRun)} خلال ${num(hoursBetween(forecast.forecastAtIso, last.iso))} ساعة.`;
      } else if (countAtLastRun < forecast.countAtForecast) {
        statusKey = "regressed";
        status = "تراجع";
        note = `انخفض العدّ ${num(forecast.countAtForecast)} ← ${num(countAtLastRun)} (عكس التنبؤ).`;
      } else {
        statusKey = "not-verified";
        status = "لم يتحقق";
        note = `العدّ ثابت ${num(countAtLastRun)} في آخر تشغيل لاحق (${last.iso}).`;
      }
    }
    return {
      ...forecast,
      statusKey,
      status,
      note,
      laterRunsObserved: later.length,
      lastLaterRunIso: last?.iso ?? null,
      countAtLastRun,
      change,
      expectedIso: forecast.expectedIso,
      referenceIso: referenceIso ?? null,
    };
  });
  const verified = rows.filter((row) => row.statusKey === "verified").length;
  const notVerified = rows.filter((row) => row.statusKey === "not-verified").length;
  const regressed = rows.filter((row) => row.statusKey === "regressed").length;
  const pending = rows.filter((row) => row.statusKey === "pending").length;
  const denominator = verified + notVerified + regressed;
  return {
    kind: "forecast",
    label: TEST_LABELS.forecast,
    available: true,
    ok: true,
    matrix: rows,
    aggregates: {
      total: rows.length,
      verified,
      notVerified,
      regressed,
      pending,
      denominator,
      hitRatePercent: pct(verified, denominator),
      definition: FORECAST_HIT_RATE_DEFINITION,
    },
    runsObserved: snapshot.runs.length,
    snapshot: { source: snapshot.source, forecastAtIso: snapshot.forecastAtIso, topicsCount: snapshot.topicsCount },
    reason: null,
  };
}

// ————————————————————————————————————————————————————————————
// (3) اختبار التشبع: عينة يدوية مقابل مخرج المحرك (فجوة القياس)
// ————————————————————————————————————————————————————————————

export function readManualSaturationSample({ root = process.cwd() } = {}) {
  const store = createStore(root);
  const doc = store.readJsonSafe(MANUAL_SATURATION_REL, null);
  const template = {
    _meta: { notes: "عينة قياس يدوية للتشبع: topic_id + النسبة المقيسة يدوياً + زمن القياس + المصادر المحسوبة." },
    samples: [],
  };
  if (!doc) {
    return { available: false, source: MANUAL_SATURATION_REL, samples: [], reason: `لا ملف عينة يدوية (${MANUAL_SATURATION_REL}) — القالب المتوقع: ${JSON.stringify(template)}`, template };
  }
  const samples = (Array.isArray(doc.samples) ? doc.samples : [])
    .map((sample) => ({
      topicId: String(sample?.topic_id ?? sample?.topicId ?? "").trim() || null,
      title: String(sample?.title ?? "").trim() || null,
      manualSaturationPercent: Number(sample?.manual_saturation_percent ?? sample?.manualSaturationPercent),
      countedAtIso: sample?.counted_at ?? sample?.countedAtIso ?? null,
      countedSources: Array.isArray(sample?.counted_sources ?? sample?.countedSources) ? (sample.counted_sources ?? sample.countedSources) : [],
      note: sample?.note ?? null,
    }))
    .filter((sample) => Number.isFinite(sample.manualSaturationPercent));
  return {
    available: samples.length > 0,
    source: MANUAL_SATURATION_REL,
    samples,
    declared: Array.isArray(doc.samples) ? doc.samples.length : 0,
    reason: samples.length ? null : `الملف موجود (${MANUAL_SATURATION_REL}) بلا عينات صالحة: عدد العناصر المعلنة ${Array.isArray(doc.samples) ? doc.samples.length : 0} — القياس اليدوي لم يُجرَ بعد.`,
  };
}

export function runSaturationTest({ topics = [], manualSample, referenceIso = null } = {}) {
  const limits = {
    withinPoints: SATURATION_GAP_WITHIN_POINTS,
    notablePoints: SATURATION_GAP_NOTABLE_POINTS,
  };
  if (!manualSample?.available) {
    return {
      kind: "saturation",
      label: TEST_LABELS.saturation,
      available: false,
      ok: false,
      limits,
      rows: [],
      aggregates: { samples: 0, matched: 0, unmatched: 0, withinMargin: 0, notable: 0, meanAbsGapPoints: null, maxAbsGapPoints: null, meanSignedGapPoints: null, verdict: null },
      reason: manualSample?.reason ?? "لا عينة يدوية.",
      referenceIso: referenceIso ?? null,
    };
  }
  const rows = manualSample.samples.map((sample) => {
    let topic = sample.topicId ? topics.find((candidate) => candidate.id === sample.topicId) ?? null : null;
    let matchKind = topic ? "id" : "unmatched";
    if (!topic && sample.title) {
      topic = topics.find((candidate) => compareTitles(candidate.title, sample.title).matches) ?? null;
      matchKind = topic ? "title" : "unmatched";
    }
    const engineSaturationPercent = topic ? finite(topic.metrics?.saturationPercent ?? topic.saturation) : null;
    const gapPoints = engineSaturationPercent === null ? null : round(sample.manualSaturationPercent - engineSaturationPercent, 2);
    const absGap = gapPoints === null ? null : Math.abs(gapPoints);
    const verdict = absGap === null
      ? "غير قابل للقياس (لا موضوع مطابق)"
      : absGap <= limits.withinPoints
        ? "داخل هامش القياس"
        : absGap <= limits.notablePoints
          ? "فجوة ملحوظة"
          : "فجوة كبيرة";
    return {
      topicId: sample.topicId,
      title: topic?.title ?? sample.title ?? null,
      matchKind,
      manualSaturationPercent: round(sample.manualSaturationPercent, 2),
      engineSaturationPercent,
      gapPoints,
      absGapPoints: absGap,
      verdict,
      countedAtIso: sample.countedAtIso,
      countedSources: sample.countedSources,
      note: sample.note,
    };
  });
  const measured = rows.filter((row) => Number.isFinite(row.absGapPoints));
  const absGaps = measured.map((row) => row.absGapPoints);
  const signed = measured.map((row) => row.gapPoints);
  const meanAbsGapPoints = absGaps.length ? round(absGaps.reduce((sum, value) => sum + value, 0) / absGaps.length, 2) : null;
  const verdict = meanAbsGapPoints === null
    ? null
    : meanAbsGapPoints <= limits.withinPoints
      ? "داخل هامش القياس"
      : meanAbsGapPoints <= limits.notablePoints
        ? "فجوة ملحوظة"
        : "فجوة كبيرة";
  return {
    kind: "saturation",
    label: TEST_LABELS.saturation,
    available: true,
    ok: true,
    limits,
    rows,
    aggregates: {
      samples: rows.length,
      matched: measured.length,
      unmatched: rows.length - measured.length,
      withinMargin: measured.filter((row) => row.verdict === "داخل هامش القياس").length,
      notable: measured.filter((row) => row.verdict === "فجوة ملحوظة").length,
      large: measured.filter((row) => row.verdict === "فجوة كبيرة").length,
      meanAbsGapPoints,
      maxAbsGapPoints: absGaps.length ? Math.max(...absGaps) : null,
      meanSignedGapPoints: signed.length ? round(signed.reduce((sum, value) => sum + value, 0) / signed.length, 2) : null,
      verdict,
    },
    manualSource: manualSample.source,
    referenceIso: referenceIso ?? null,
    reason: null,
  };
}

// ————————————————————————————————————————————————————————————
// (4) اختبار المصادر: تجدد فعلي + زمن استجابة + تبريدات
// ————————————————————————————————————————————————————————————

export function runSourcesTest({ root = process.cwd(), sourceDocument = null, healthDocument = null, referenceIso = null, samples = null } = {}) {
  const store = createStore(root);
  const configs = sourceDocument?.sources ?? store.readJsonSafe("config/sources.json", { sources: {} })?.sources ?? {};
  const health = healthDocument?.sources ?? store.readJsonSafe("state/sources-health.json", { sources: {} })?.sources ?? {};
  const referenceMs = parseMs(referenceIso) ?? Date.now();
  const ids = [...new Set([...Object.keys(configs), ...Object.keys(health)])].sort((a, b) => a.localeCompare(b));
  const sampleFor = (id) => {
    if (samples && Object.hasOwn(samples, id)) return samples[id];
    return store.readJsonSafe(FETCHER_SAMPLE_PATH(id), null);
  };
  const rows = ids.map((sourceId) => {
    const config = configs[sourceId] ?? {};
    const entry = health[sourceId] ?? {};
    const sample = sampleFor(sourceId) ?? null;
    const requestTimes = Array.isArray(entry.request_times) ? entry.request_times : [];
    const usedInWindow = requestTimes.filter((iso) => {
      const ms = parseMs(iso);
      return ms !== null && ms <= referenceMs && referenceMs - ms < HOUR_MS;
    }).length;
    const budgetPerHour = finite(config.rate_limit_per_hour);
    const lastOkIso = entry.last_ok ?? (sample?.success ? sample?.fetched_at : null) ?? null;
    const lastOkMs = parseMs(lastOkIso);
    const refreshAgeHours = lastOkMs === null ? null : round((referenceMs - lastOkMs) / HOUR_MS, 2);
    const fresh = refreshAgeHours !== null
      && refreshAgeHours <= SOURCE_FRESHNESS_HOURS
      && refreshAgeHours >= -FRESHNESS_FUTURE_TOLERANCE_MINUTES / 60;
    const lastResponseMs = entry.last_response_ms ?? sample?.response_ms ?? null;
    const responseVerdict = lastResponseMs === null || lastResponseMs === undefined
      ? "بلا قياس"
      : finite(lastResponseMs) <= RESPONSE_MS_NORMAL
        ? "طبيعي"
        : finite(lastResponseMs) <= RESPONSE_MS_SLOW
          ? "بطيء"
          : "بطيء جداً";
    const blockedUntilIso = entry.blocked_until ?? null;
    const blockedMs = parseMs(blockedUntilIso);
    const coolingActive = blockedMs !== null && blockedMs > referenceMs;
    const enabled = config.enabled === true;
    const requests = finite(entry.requests);
    const errors = finite(entry.errors);
    const invocations = finite(entry.invocations);
    const healthStatus = String(entry.status ?? (enabled ? "بلا سجل" : "معطل"));
    let verdict = "سليم";
    if (!enabled) verdict = "معطل في الإعدادات";
    else if (coolingActive) verdict = "تبريد";
    else if (healthStatus === "فشل" || healthStatus === "خطأ") verdict = "فشل";
    else if (invocations === 0 && requests === 0) verdict = "بلا سجل";
    else if (!fresh) verdict = "متأخر (لم يتجدد خلال " + SOURCE_FRESHNESS_HOURS + " ساعة)";
    return {
      sourceId,
      enabled,
      dailyEnabled: config.daily_enabled !== false,
      weight: finite(config.weight),
      notes: config.notes ?? null,
      healthStatus,
      verdict,
      invocations,
      requests,
      errors,
      errorRatePercent: requests > 0 ? pct(errors, requests) : null,
      lastError: entry.last_err ?? sample?.error ?? null,
      refresh: {
        lastSuccessIso: lastOkIso,
        ageHours: refreshAgeHours,
        fresh,
        thresholdHours: SOURCE_FRESHNESS_HOURS,
        futureToleranceMinutes: FRESHNESS_FUTURE_TOLERANCE_MINUTES,
        sampleSource: samples && Object.hasOwn(samples, sourceId) ? "مصنّعة في الاختبار" : FETCHER_SAMPLE_PATH(sourceId),
      },
      response: { lastResponseMs: lastResponseMs === null || lastResponseMs === undefined ? null : round(lastResponseMs, 1), verdict: responseVerdict, normalMs: RESPONSE_MS_NORMAL, slowMs: RESPONSE_MS_SLOW },
      cooling: { active: coolingActive, untilIso: blockedUntilIso, minutesLeft: coolingActive ? Math.max(0, round((blockedMs - referenceMs) / 60000, 2)) : 0, stage: finite(entry.backoff_stage) },
      budget: { perHour: budgetPerHour, usedInWindow, remaining: budgetPerHour > 0 ? Math.max(0, budgetPerHour - usedInWindow) : 0 },
      cacheHits: finite(entry.cache_hits),
      lastInvocationIso: entry.last_invocation ?? sample?.fetched_at ?? null,
    };
  });
  const responses = rows.map((row) => row.response.lastResponseMs).filter((value) => Number.isFinite(value));
  const coolingRows = rows.filter((row) => row.cooling.active);
  const slowest = rows
    .filter((row) => Number.isFinite(row.response.lastResponseMs))
    .sort((a, b) => b.response.lastResponseMs - a.response.lastResponseMs)[0] ?? null;
  return {
    kind: "sources",
    label: TEST_LABELS.sources,
    available: rows.length > 0,
    ok: rows.length > 0,
    rows,
    aggregates: {
      total: rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      disabled: rows.filter((row) => !row.enabled).length,
      healthy: rows.filter((row) => row.verdict === "سليم").length,
      failing: rows.filter((row) => row.verdict === "فشل").length,
      cooling: coolingRows.length,
      stale: rows.filter((row) => String(row.verdict).startsWith("متأخر")).length,
      neverInvoked: rows.filter((row) => row.verdict === "بلا سجل").length,
      budgetExhausted: rows.filter((row) => row.budget.perHour > 0 && row.budget.remaining === 0).length,
      meanResponseMs: responses.length ? round(responses.reduce((sum, value) => sum + value, 0) / responses.length, 1) : null,
      slowest: slowest ? { sourceId: slowest.sourceId, responseMs: slowest.response.lastResponseMs, verdict: slowest.response.verdict } : null,
      coolingList: coolingRows.map((row) => ({ sourceId: row.sourceId, untilIso: row.cooling.untilIso, minutesLeft: row.cooling.minutesLeft, stage: row.cooling.stage })),
      thresholds: { freshnessHours: SOURCE_FRESHNESS_HOURS, responseNormalMs: RESPONSE_MS_NORMAL, responseSlowMs: RESPONSE_MS_SLOW },
    },
    referenceIso: referenceIso ?? new Date(referenceMs).toISOString(),
    reason: rows.length ? null : "لا مصادر في config/sources.json ولا سجلات في state/sources-health.json.",
  };
}

// ————————————————————————————————————————————————————————————
// مولد التقرير: البنية الثابتة (7 حقول)
// ————————————————————————————————————————————————————————————

// مسار التقرير يُعامل نسبةً إلى جذر المشروع دائماً (لا مسارات مطلقة في الكتابة)
export function normalizeReportDir({ root = process.cwd(), reportDir = REPORT_DIR } = {}) {
  if (!reportDir) return REPORT_DIR;
  return path.isAbsolute(reportDir) ? path.relative(root, reportDir) || REPORT_DIR : reportDir;
}

export function loadPreviousReport({ root = process.cwd(), reportDir = REPORT_DIR, sampleSource = null } = {}) {
  const dir = path.join(root, normalizeReportDir({ root, reportDir }));
  if (!fs.existsSync(dir)) return { available: false, reason: `لا مجلد تقارير (${dir}).`, report: null, rel: null };
  const files = fs.readdirSync(dir).filter((name) => name.startsWith(REPORT_PREFIX) && name.endsWith(".json")).sort();
  const candidates = [];
  for (const file of files.reverse()) {
    const rel = path.join(dir, file);
    try {
      candidates.push({ rel, report: JSON.parse(fs.readFileSync(rel, "utf8")) });
    } catch {
      /* تقرير تالف لا يُسقط البحث — يُتخطى */
    }
  }
  if (!candidates.length) return { available: false, reason: "لا تقرير اختبار سابق في reports/.", report: null, rel: null };
  const sameSample = candidates.find((entry) => entry.report?.sampleSource === sampleSource) ?? null;
  const newest = candidates[0];
  return {
    available: true,
    comparable: Boolean(sameSample),
    report: sameSample?.report ?? newest.report,
    rel: sameSample?.rel ?? newest.rel,
    otherSample: !sameSample ? { rel: newest.rel, sampleSource: newest.report?.sampleSource ?? null } : null,
    reason: sameSample ? null : `لا تقرير سابق بنفس العينة (${sampleSource ?? "—"}): أحدث تقرير هو ${newest.rel} بعينة «${newest.report?.sampleSource ?? "—"}» — المقارنة غير ذات دلالة.`,
  };
}

function improvementMetric(label, previous, current, unit = "", { higherIsBetter = true, absolute = false } = {}) {
  const previousValue = Number.isFinite(previous) ? previous : null;
  const currentValue = Number.isFinite(current) ? current : null;
  const delta = previousValue === null || currentValue === null ? null : round(absolute ? Math.abs(currentValue) - Math.abs(previousValue) : currentValue - previousValue, 2);
  let verdict = "غير قابل للمقارنة";
  if (delta !== null) {
    if (delta === 0) verdict = "بلا تغيير";
    else verdict = (delta > 0) === higherIsBetter ? "تحسن" : "تراجع";
  }
  return { metric: label, previous: previousValue, current: currentValue, delta, unit, verdict, higherIsBetter };
}

export function buildImprovement({ previous, sampleSource = null, results }) {
  const detection = results.detection ?? {};
  const forecast = results.forecast ?? {};
  const saturation = results.saturation ?? {};
  const sources = results.sources ?? {};
  if (!previous?.comparable) {
    return {
      compared: false,
      previous: previous?.available ? { rel: previous.rel, sampleSource: previous.report?.sampleSource ?? null, runNumber: previous.report?.runNumber ?? null, comparable: false } : null,
      reason: previous?.reason ?? "لا تقرير اختبار سابق.",
      deltas: [],
      currentSummary: {
        matchedTopics: detection.matchedTopics ?? null,
        hitRatePercent: forecast.aggregates?.hitRatePercent ?? null,
        meanAbsGapPoints: saturation.aggregates?.meanAbsGapPoints ?? null,
        healthySources: sources.aggregates?.healthy ?? null,
      },
    };
  }
  const prior = previous.report;
  const priorTests = prior?.tests ?? {};
  const deltas = [
    improvementMetric("موضوعات مطابقة في اختبار الكشف", priorTests.detection?.matchedTopics, detection.matchedTopics),
    improvementMetric("دقة الكشف %", priorTests.detection?.precisionPercent, detection.precisionPercent, "%"),
    improvementMetric("متوسط زمن التحقق (دقيقة)", priorTests.detection?.meanConfirmationMinutes, detection.meanConfirmationMinutes, "د", { higherIsBetter: false }),
    improvementMetric("معدل إصابة التنبؤات %", priorTests.forecast?.aggregates?.hitRatePercent, forecast.aggregates?.hitRatePercent, "%"),
    improvementMetric("تنبؤات تحققت", priorTests.forecast?.aggregates?.verified, forecast.aggregates?.verified, "تنبؤ"),
    improvementMetric("متوسط فجوة التشبع (نقطة)", priorTests.saturation?.aggregates?.meanAbsGapPoints, saturation.aggregates?.meanAbsGapPoints, "نقطة", { higherIsBetter: false, absolute: true }),
    improvementMetric("مصادر سليمة", priorTests.sources?.aggregates?.healthy, sources.aggregates?.healthy, "مصدر"),
    improvementMetric("مصادر متأخرة", priorTests.sources?.aggregates?.stale, sources.aggregates?.stale, "مصدر", { higherIsBetter: false }),
    improvementMetric("متوسط زمن الاستجابة (ms)", priorTests.sources?.aggregates?.meanResponseMs, sources.aggregates?.meanResponseMs, "ms", { higherIsBetter: false }),
  ];
  return {
    compared: true,
    previous: { rel: previous.rel, sampleSource: prior?.sampleSource ?? null, runNumber: prior?.runNumber ?? null, iso: prior?.time?.iso ?? null },
    deltas,
    improved: deltas.filter((delta) => delta.verdict === "تحسن").length,
    regressed: deltas.filter((delta) => delta.verdict === "تراجع").length,
    unchanged: deltas.filter((delta) => delta.verdict === "بلا تغيير").length,
    incomparable: deltas.filter((delta) => delta.verdict === "غير قابل للمقارنة").length,
    reason: null,
  };
}

export function buildErrors({ results }) {
  const errors = [];
  if (!results.detection.available) {
    errors.push({
      what: "اختبار الكشف لم يُنفَّذ",
      rootCause: "لا لقطة مواضيع محفوظة بعناوين (خط أساس) و/أو لا دليل gnews محفوظ بعناصر — لأن كل جلسات المشروع السابقة جرت بلا شبكة (الدين الحي مؤجل إلى بطارية B7)",
      evidence: [results.detection.reason, results.detection.baseline?.source ? null : "state/topics-latest.json وstate/topics.json بلا موضوعات"].filter(Boolean).join(" | "),
    });
  }
  if (!results.forecast.available) {
    errors.push({
      what: "اختبار التنبؤ لم يُنفَّذ",
      rootCause: "لا لقطة مواضيع محفوظة تحمل وسم «متوقع خلال ساعات»؛ وسجل التشغيل يحفظ topicCounts فقط بلا وسم التنبؤ (قيود B3 المختومة)",
      evidence: results.forecast.reason ?? "—",
    });
  }
  if (!results.saturation.available) {
    errors.push({
      what: "اختبار التشبع لم يُنفَّذ",
      rootCause: "لا عينة قياس يدوي مُعبَّأة — القياس اليدوي عمل بشري لم يُجرَ بعد، ولم تُصنَّع عينة في الحالة الحقيقية",
      evidence: results.saturation.reason ?? "—",
    });
  }
  for (const row of results.sources.rows ?? []) {
    if (row.verdict === "فشل" && row.lastError) {
      errors.push({ what: `المصدر ${row.sourceId} في حالة فشل`, rootCause: "فشل جلب سابق مسجّل في state/sources-health.json", evidence: String(row.lastError).slice(0, 200) });
    }
  }
  if (results.evidenceError) errors.push(results.evidenceError);
  return errors;
}

export function buildWeightRecommendations({ results }) {
  const recommendations = [];
  const sourcesRows = [...(results.sources.rows ?? [])].filter((row) => row.enabled);
  const failing = sourcesRows.filter((row) => row.verdict === "فشل").sort((a, b) => (b.errorRatePercent ?? 0) - (a.errorRatePercent ?? 0));
  if (failing.length) {
    recommendations.push({
      id: "source-weights-failing",
      recommendation: `مراجعة أوزان المصادر المتعثرة (${failing.slice(0, 3).map((row) => row.sourceId).join(", ")}) — تخفيض مؤقت لوزن المصدر المتعثرة حتى نجاح جلب حي`,
      rationale: `معدلات الخطأ المرصودة: ${failing.slice(0, 3).map((row) => `${row.sourceId}=${num(row.errorRatePercent)}%`).join(" · ")}`,
      status: "معلق على اعتماد المجلس",
    });
  }
  const stale = sourcesRows.filter((row) => String(row.verdict).startsWith("متأخر"));
  if (stale.length) {
    recommendations.push({
      id: "source-weights-stale",
      recommendation: `تثبيت عتبة «تجدد فعلي» أو تخفيض وزن المصادر غير المتجددة (${stale.slice(0, 3).map((row) => row.sourceId).join(", ")})`,
      rationale: `عتبة التجدد الحالية ${SOURCE_FRESHNESS_HOURS} ساعة؛ مصادر متأخرة: ${stale.length}`,
      status: "معلق على اعتماد المجلس",
    });
  }
  recommendations.push({
    id: "forecast-threshold",
    recommendation: "تثبيت أو تعديل حد التنبؤ المتحفظ (تسارع موجب في تشغيلين متتاليين + تشبع أقل من 50%) على ضوء معدل الإصابة المقيس",
    rationale: `معدل الإصابة الحالي: ${num(results.forecast.aggregates?.hitRatePercent)}% (تحقق ${results.forecast.aggregates?.verified ?? 0} من ${results.forecast.aggregates?.denominator ?? 0} قابلة للتحقق)`,
    status: "معلق على اعتماد المجلس",
  });
  recommendations.push({
    id: "forecast-run-records",
    recommendation: "إضافة وسم التنبؤ (forecast + forecastAtIso) إلى سجل تشغيل B3-radar ليصبح اختبار التنبؤ تاريخياً كاملاً لا لقطة واحدة",
    rationale: "سجل التشغيل يحفظ topicCounts فقط؛ المصفوفة الحالية تُبنى من اللقطة الأخيرة + عدّات التشغيلات اللاحقة",
    status: "معلق على اعتماد المجلس",
  });
  recommendations.push({
    id: "detection-window",
    recommendation: `تثبيت نافذة الكشف ${DETECTION_WINDOW_HOURS} ساعتين وفجوة القياس المسموحة ${SATURATION_GAP_WITHIN_POINTS} نقطة للتشبع`,
    rationale: `قيم الاختبار الحالية: زمن تحقق ${num(results.detection.meanConfirmationMinutes)} د · فجوة تشبع ${num(results.saturation.aggregates?.meanAbsGapPoints)} نقطة (عينات: ${results.saturation.aggregates?.samples ?? 0})`,
    status: "معلق على اعتماد المجلس",
  });
  return recommendations;
}

export function buildTestReport({
  time,
  sampleTimeIso = null,
  mode = "state",
  sampleSource = SAMPLE_SOURCE_STATE,
  runNumber = 1,
  totalReports = 1,
  results,
  timings = {},
  previous = null,
  reportDir = REPORT_DIR,
  paths = {},
}) {
  const order = TEST_KINDS.map((kind) => results[kind]).filter(Boolean);
  const executed = order.map((result) => ({
    kind: result.kind,
    label: result.label,
    executed: Boolean(result.available),
    durationMs: finite(timings[`${result.kind}Ms`], 0),
    sample: sampleSource,
    note: result.available ? "نُفذ" : `لم يُنفذ — ${result.reason ?? "—"}`,
  }));
  const executedCount = executed.filter((entry) => entry.executed).length;
  return {
    _meta: {
      format: "json",
      kind: "B6-test-report",
      schemaVersion: "B6.1",
      mode,
      sampleSource,
      generatedAt: new Date().toISOString(),
      notes: "تقرير اختبارات B6 بالبنية الثابتة (7 حقول)؛ الأرقام من مخرجات المحرك نفسها ولا تُصنَّع بيانات.",
      thresholds: {
        detectionWindowHours: DETECTION_WINDOW_HOURS,
        saturationWithinPoints: SATURATION_GAP_WITHIN_POINTS,
        saturationNotablePoints: SATURATION_GAP_NOTABLE_POINTS,
        sourceFreshnessHours: SOURCE_FRESHNESS_HOURS,
        responseNormalMs: RESPONSE_MS_NORMAL,
        responseSlowMs: RESPONSE_MS_SLOW,
      },
    },
    time: { iso: time?.iso ?? null, source: time?.source ?? null, skewSeconds: finite(time?.skewSeconds), line: time ? timeLine(time) : "" },
    sampleTimeIso: sampleTimeIso ?? time?.iso ?? null,
    runNumber,
    totalReports,
    mode,
    sampleSource,
    paths,
    fields: {
      "time-and-run": {
        line: time ? timeLine(time) : "",
        iso: time?.iso ?? null,
        source: time?.source ?? null,
        skewSeconds: finite(time?.skewSeconds),
        runNumber,
        totalReports,
        sampleSource,
        sampleTimeIso: sampleTimeIso ?? time?.iso ?? null,
        mode,
      },
      executed: { count: executedCount, total: executed.length, rows: executed, totalMs: finite(timings.totalMs, 0) },
      results: {
        detection: {
          available: Boolean(results.detection.available),
          baselineTopics: results.detection.baseline?.topics ?? 0,
          evidenceItems: results.detection.evidence?.items ?? 0,
          inWindowItems: results.detection.inWindowItems,
          matchedTopics: results.detection.matchedTopics,
          unmatchedTopics: results.detection.unmatchedTopics,
          precisionPercent: results.detection.precisionPercent,
          meanConfirmationMinutes: results.detection.meanConfirmationMinutes,
          maxConfirmationMinutes: results.detection.maxConfirmationMinutes,
          meanDetectionLatencyMinutes: results.detection.meanDetectionLatencyMinutes,
          windowHours: results.detection.windowHours,
        },
        forecast: {
          available: Boolean(results.forecast.available),
          total: results.forecast.aggregates.total,
          verified: results.forecast.aggregates.verified,
          notVerified: results.forecast.aggregates.notVerified,
          regressed: results.forecast.aggregates.regressed,
          pending: results.forecast.aggregates.pending,
          hitRatePercent: results.forecast.aggregates.hitRatePercent,
          definition: FORECAST_HIT_RATE_DEFINITION,
        },
        saturation: {
          available: Boolean(results.saturation.available),
          samples: results.saturation.aggregates.samples,
          matched: results.saturation.aggregates.matched,
          unmatched: results.saturation.aggregates.unmatched,
          meanAbsGapPoints: results.saturation.aggregates.meanAbsGapPoints,
          maxAbsGapPoints: results.saturation.aggregates.maxAbsGapPoints,
          biasPoints: results.saturation.aggregates.meanSignedGapPoints,
          verdict: results.saturation.aggregates.verdict,
        },
        sources: {
          available: Boolean(results.sources.available),
          total: results.sources.aggregates.total,
          enabled: results.sources.aggregates.enabled,
          healthy: results.sources.aggregates.healthy,
          failing: results.sources.aggregates.failing,
          cooling: results.sources.aggregates.cooling,
          stale: results.sources.aggregates.stale,
          meanResponseMs: results.sources.aggregates.meanResponseMs,
          slowest: results.sources.aggregates.slowest,
        },
      },
      improvement: buildImprovement({ previous, sampleSource, results }),
      errors: buildErrors({ results }),
      tools: TOOLS_NEEDED.map((tool) => ({ ...tool, costLabel: tool.cost === 0 ? "صفر" : `${tool.cost} ${tool.currency} — عرض لقرار المجلس` })),
      weights: buildWeightRecommendations({ results }),
    },
    tests: {
      detection: results.detection,
      forecast: results.forecast,
      saturation: results.saturation,
      sources: results.sources,
    },
  };
}

// —— عرض التقرير: بنية ثابتة سبعة حقول ——
export function renderTestReportMarkdown(report) {
  const lines = [];
  const field = report.fields;
  lines.push(`# تقرير الاختبارات — تشغيل #${report.runNumber}`);
  lines.push("");
  lines.push(`**البنية الثابتة:** 7 حقول ✅ · **رقم التشغيل:** #${report.runNumber} من ${report.totalReports} · **عينة القياس:** ${report.sampleSource}`);
  lines.push(`**نمط التشغيل:** ${report.mode === "fixtures" ? "عينة fixtures معزولة (بوابة حتمية — غير حية)" : "حالة المشروع الحقيقية (state/) — بلا شبكة"}`);
  lines.push("");
  lines.push(`## 1) ${REPORT_FIELDS[0].heading}`);
  lines.push(`- الزمن الموثق: ${field["time-and-run"].line}`);
  lines.push(`- رقم التشغيل: #${field["time-and-run"].runNumber} من ${field["time-and-run"].totalReports} (kind=B6-tests)`);
  lines.push(`- مصدر الزمن: ${field["time-and-run"].source ?? "—"} | skew=${num(field["time-and-run"].skewSeconds)}ث | ISO=${field["time-and-run"].iso ?? "—"}`);
  lines.push(`- زمن عينة القياس: ${field["time-and-run"].sampleTimeIso ?? "—"}${report.mode === "fixtures" ? " (ساعة fixtures الحتمية)" : ""}`);
  lines.push("");
  lines.push(`## 2) ${REPORT_FIELDS[1].heading}`);
  lines.push(`- الاختبارات المنفذة: ${field.executed.count}/${field.executed.total} | المدة الكلية: ${num(field.executed.totalMs, 0)}ms`);
  lines.push("");
  lines.push("| الاختبار | الحالة | المدة | العينة | ملاحظة |");
  lines.push("|---|---|---|---|---|");
  for (const row of field.executed.rows) lines.push(`| ${row.label} (${row.kind}) | ${row.executed ? "نُفذ" : "لم يُنفذ"} | ${num(row.durationMs, 0)}ms | ${row.sample} | ${row.note} |`);
  lines.push("");
  lines.push(`## 3) ${REPORT_FIELDS[2].heading}`);
  const detection = field.results.detection;
  lines.push("### كشف (نافذة ساعتان)");
  lines.push(`- خط الأساس: ${detection.baselineTopics} موضوعاً | عناصر دليل gnews: ${detection.evidenceItems} | داخل النافذة: ${detection.inWindowItems}`);
  lines.push(`- مطابقة: ${detection.matchedTopics} | غير مطابق: ${detection.unmatchedTopics} | دقة الكشف: ${num(detection.precisionPercent)}%`);
  lines.push(`- زمن التحقق: متوسط ${num(detection.meanConfirmationMinutes)} دقيقة · أقصى ${num(detection.maxConfirmationMinutes)} دقيقة | متوسط زمن الكشف ${num(detection.meanDetectionLatencyMinutes)} دقيقة`);
  const forecast = field.results.forecast;
  lines.push("### تنبؤ");
  lines.push(`- المصوفة: ${forecast.total} تنبؤاً — تحقق ${forecast.verified} · لم يتحقق ${forecast.notVerified} · تراجع ${forecast.regressed} · بانتظار ${forecast.pending}`);
  lines.push(`- معدل الإصابة: ${num(forecast.hitRatePercent)}% (${forecast.verified}/${forecast.verified + forecast.notVerified + forecast.regressed})`);
  lines.push(`- التعريف: ${forecast.definition}`);
  const saturation = field.results.saturation;
  lines.push("### تشبع");
  lines.push(`- العينات اليدوية: ${saturation.samples} | مطابقة للمحرك: ${saturation.matched} | غير مطابقة: ${saturation.unmatched}`);
  lines.push(`- متوسط الفجوة المطلقة: ${num(saturation.meanAbsGapPoints)} نقطة | أقصى فجوة: ${num(saturation.maxAbsGapPoints)} | انحياز: ${num(saturation.biasPoints)} | الحكم: ${saturation.verdict ?? "—"}`);
  const sources = field.results.sources;
  lines.push("### مصادر");
  lines.push(`- الإجمالي: ${sources.total} | مفعّل: ${sources.enabled} | سليم: ${sources.healthy} | فشل: ${sources.failing} | تبريد: ${sources.cooling} | متأخر: ${sources.stale}`);
  lines.push(`- متوسط زمن الاستجابة: ${num(sources.meanResponseMs, 1)}ms | الأبطأ: ${sources.slowest ? `${sources.slowest.sourceId} (${num(sources.slowest.responseMs, 1)}ms — ${sources.slowest.verdict})` : "—"}`);
  lines.push("");
  lines.push(`## 4) ${REPORT_FIELDS[3].heading}`);
  const improvement = field.improvement;
  if (!improvement.compared) {
    lines.push(`- **لا مقارنة:** ${improvement.reason ?? "لا تقرير سابق."}`);
    if (improvement.previous) lines.push(`- أحدث تقرير موجود: ${improvement.previous.rel} (عينة «${improvement.previous.sampleSource}») — مقارنة عينتين مختلفتين غير ذات دلالة.`);
    lines.push(`- أرقام هذا التشغيل: كشف=${num(improvement.currentSummary.matchedTopics)} مطابقة · إصابة التنبؤ=${num(improvement.currentSummary.hitRatePercent)}% · فجوة التشبع=${num(improvement.currentSummary.meanAbsGapPoints)} نقطة · مصادر سليمة=${num(improvement.currentSummary.healthySources)}`);
  } else {
    lines.push(`- التقرير السابق: ${improvement.previous.rel} (تشغيل #${improvement.previous.runNumber} · ${improvement.previous.iso ?? "—"} · عينة «${improvement.previous.sampleSource}») — مقارنة صريحة بالعينة نفسها.`);
    lines.push(`- المحصلة: تحسن ${improvement.improved} · تراجع ${improvement.regressed} · بلا تغيير ${improvement.unchanged} · غير قابل للمقارنة ${improvement.incomparable}`);
    lines.push("");
    lines.push("| المقياس | السابق | الحالي | الفرق | الحكم |");
    lines.push("|---|---|---|---|---|");
    for (const delta of improvement.deltas) {
      lines.push(`| ${delta.metric} | ${num(delta.previous)} | ${num(delta.current)} | ${delta.delta === null ? "—" : (delta.delta > 0 ? `+${num(delta.delta)}` : num(delta.delta))} ${delta.unit} | ${delta.verdict} |`);
    }
  }
  lines.push("");
  lines.push(`## 5) ${REPORT_FIELDS[4].heading}`);
  if (!field.errors.length) {
    lines.push("- لا أخطاء: كل الاختبارات الأربعة نُفذت بنجاح.");
  } else {
    for (const error of field.errors) {
      lines.push(`- **${error.what}**`);
      lines.push(`  - السبب الجذري: ${error.rootCause}`);
      lines.push(`  - الدليل: ${error.evidence || "—"}`);
    }
  }
  lines.push("");
  lines.push(`## 6) ${REPORT_FIELDS[5].heading}`);
  lines.push("| الأداة/المصدر | التكلفة | حالة الاعتماد | ملاحظة |");
  lines.push("|---|---|---|---|");
  for (const tool of field.tools) lines.push(`| ${tool.name} | ${tool.costLabel} | ${tool.decisionRequired ? "عرض لقرار المجلس — لا شراء" : "بلا قرار (صفر)"} | ${tool.note} |`);
  lines.push("");
  lines.push(`## 7) ${REPORT_FIELDS[6].heading}`);
  for (const weight of field.weights) {
    lines.push(`- **${weight.recommendation}**`);
    lines.push(`  - السند الرقمي: ${weight.rationale}`);
    lines.push(`  - الحالة: ${weight.status}`);
  }
  lines.push("");
  lines.push("---");
  lines.push(`مُولَّد بواسطة engine/tests.js (B6) — البنية الثابتة 7/7 حقول. الأرقام من مخرجات المحرك في هذا التشغيل؛ لا بيانات مصنّعة.`);
  return `${lines.join("\n")}\n`;
}

export function validateTestReport(report, markdown = null) {
  const missingJson = [];
  const missingMarkdown = [];
  for (const field of REPORT_FIELDS) {
    if (report?.fields?.[field.id] === undefined) missingJson.push(`${field.index}:${field.id}`);
    if (markdown !== null && markdown !== undefined && !String(markdown).includes(`## ${field.index}) ${field.heading}`)) {
      missingMarkdown.push(`${field.index}:${field.id}`);
    }
  }
  const errors = assertNoUndefinedOrNonFinite(report, "report");
  const headerOk = report?.time?.line && report?.runNumber >= 1;
  if (!headerOk) errors.push("سطر الزمن الموثق أو رقم التشغيل مفقود");
  const fieldsPresent = REPORT_FIELDS.length - missingJson.length;
  return {
    ok: missingJson.length === 0 && missingMarkdown.length === 0 && errors.length === 0,
    fieldsPresent,
    fieldsTotal: REPORT_FIELDS.length,
    missingJson,
    missingMarkdown,
    errors,
  };
}

// ————————————————————————————————————————————————————————————
// الكتابة: تقرير + مرآة للوحة + مساحة اختبار في sources-health + كتلة معدل الإصابة في skills.md + سجل تشغيل
// ————————————————————————————————————————————————————————————

export function latestReports({ root = process.cwd(), reportDir = REPORT_DIR } = {}) {
  const dir = path.join(root, normalizeReportDir({ root, reportDir }));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(REPORT_PREFIX) && name.endsWith(".json"))
    .sort()
    .reverse();
}

export function reportFileName(iso) {
  const stamp = String(iso ?? "").replace(/[:.]/gu, "-");
  if (!stamp) throw new Error("reportFileName: طابع زمني موثق مطلوب");
  return `${REPORT_PREFIX}${stamp}`;
}

export function applySourcesHealthTestUpdate({ store, report }) {
  const health = store.readJsonSafe("state/sources-health.json", { _meta: { format: "json" }, sources: {} });
  if (!health.sources || typeof health.sources !== "object") health.sources = {};
  const sourcesTest = report.tests.sources;
  health._meta = {
    ...(health._meta ?? {}),
    tests: {
      last_run_iso: report.time.iso,
      time_source: report.time.source,
      sample_source: report.sampleSource,
      report: report.paths?.markdown ?? null,
      report_json: report.paths?.json ?? null,
      rows: sourcesTest.rows.length,
      healthy: sourcesTest.aggregates.healthy,
      failing: sourcesTest.aggregates.failing,
      cooling: sourcesTest.aggregates.cooling,
      updated_at: report._meta.generatedAt,
      note: "قياسات اختبار B6 — لا تلمس حقول الصحة الحية (status/requests/errors/request_times/blocked_until) التي يكتبها runtime B2.",
    },
  };
  for (const row of sourcesTest.rows) {
    const current = { ...(health.sources[row.sourceId] ?? {}) };
    current.tests = {
      last_tested_at: report.time.iso,
      sample_source: report.sampleSource,
      verdict: row.verdict,
      fresh: row.refresh.fresh,
      refresh_age_hours: row.refresh.ageHours,
      last_success_iso: row.refresh.lastSuccessIso,
      last_response_ms: row.response.lastResponseMs,
      response_verdict: row.response.verdict,
      cooling: row.cooling.active,
      cooling_minutes_left: row.cooling.minutesLeft,
      backoff_stage: row.cooling.stage,
      budget_remaining: row.budget.remaining,
      error_rate_percent: row.errorRatePercent,
    };
    health.sources[row.sourceId] = current;
  }
  const io = store.writeJsonAtomic("state/sources-health.json", health);
  return { io, rel: "state/sources-health.json" };
}

export function renderForecastSkillsBlock({ report }) {
  const forecast = report.fields.results.forecast;
  const lines = [
    SKILLS_BLOCK_START,
    "## معدل إصابة التنبؤات — يُحدَّث آلياً (B6)",
    `- **المعدل:** ${num(forecast.hitRatePercent)}% (تحقق ${forecast.verified} من ${forecast.verified + forecast.notVerified + forecast.regressed} تنبؤاً قابلاً للتحقق) — بانتظار التحقق: ${forecast.pending}.`,
    `- **التعريف:** ${forecast.definition}`,
    `- **الزمن الموثق:** ${report.fields["time-and-run"].line}`,
    `- **رقم التشغيل:** #${report.runNumber} | **عينة القياس:** ${report.sampleSource}`,
    `- **الدليل:** ${report.paths?.markdown ?? "—"} (المصفوفة الكاملة) + state/tests-latest.json`,
    `- **آخر تحديث:** ${report.time.iso} (مصدر=${report.time.source}) · بيانات ${forecast.available ? "متاحة" : "غير متاحة: " + (report.tests.forecast.reason ?? "—")}`,
    SKILLS_BLOCK_END,
  ];
  return lines.join("\n");
}

export function updateSkillsForecastHitRate({ store, report }) {
  const before = store.readText(SKILLS_REL);
  const block = renderForecastSkillsBlock({ report });
  const start = before.indexOf(SKILLS_BLOCK_START);
  const end = before.indexOf(SKILLS_BLOCK_END);
  let after;
  if (start >= 0 && end > start) {
    after = `${before.slice(0, start)}${block}${before.slice(end + SKILLS_BLOCK_END.length)}`;
  } else {
    const separator = before.endsWith("\n") ? "" : "\n";
    after = `${before}${separator}\n${block}\n`;
  }
  if (after === before) return { changed: false, io: null, rel: SKILLS_REL };
  const io = store.writeTextAtomic(SKILLS_REL, after);
  return { changed: true, io, rel: SKILLS_REL };
}

export function buildTestsLatest({ report, reportRel, reportJsonRel }) {
  const label = (kind) => {
    const result = report.tests[kind];
    return { available: Boolean(result.available), passed: Boolean(result.ok), label: !result.available ? "لم يُنفذ" : result.ok ? "نُفذ" : "فشل" };
  };
  return {
    _meta: {
      format: "json",
      kind: "B6-tests-latest",
      schemaVersion: "B6.1",
      schema_version: "B6.1",
      updated_at: report._meta.generatedAt,
      notes: "ملخص آخر تقرير اختبار للوحة (المصدر الكامل: reports/tests-*.json). لا أرقام مصنّعة.",
    },
    time: { iso: report.time.iso, source: report.time.source, line: report.time.line },
    run: { number: report.runNumber, total: report.totalReports, kind: "B6-tests", report: reportRel, report_json: reportJsonRel },
    sampleSource: report.sampleSource,
    mode: report.mode,
    structure: report.structure,
    verdicts: { detection: label("detection"), forecast: label("forecast"), saturation: label("saturation"), sources: label("sources") },
    numbers: {
      detection: report.fields.results.detection,
      forecast: report.fields.results.forecast,
      saturation: report.fields.results.saturation,
      sources: report.fields.results.sources,
    },
    errors: report.fields.errors.map((error) => ({ what: error.what, rootCause: error.rootCause })),
    tools: report.fields.tools.map((tool) => ({ id: tool.id, name: tool.name, cost: tool.cost, costLabel: tool.costLabel, decisionRequired: tool.decisionRequired })),
    weights: report.fields.weights.map((weight) => ({ id: weight.id, recommendation: weight.recommendation, status: weight.status })),
    improvement: { compared: report.fields.improvement.compared, reason: report.fields.improvement.reason ?? null },
  };
}

export function writeTestReport({ stateRoot = process.cwd(), reportDir = REPORT_DIR, report, record = true } = {}) {
  const store = createStore(stateRoot);
  const base = reportFileName(report.time.iso ?? report._meta.generatedAt);
  const markdownRel = path.join(reportDir, `${base}.md`);
  const jsonRel = path.join(reportDir, `${base}.json`);
  const markdown = renderTestReportMarkdown(report);
  const validation = validateTestReport(report, markdown);
  if (!validation.ok) {
    throw new Error(`تقرير الاختبار غير صالح — حقول ناقصة: ${[...validation.missingJson, ...validation.missingMarkdown].join(", ")} | أخطاء: ${validation.errors.join(" | ")}`);
  }
  const withPaths = { ...report, structure: { fieldsPresent: validation.fieldsPresent, fieldsTotal: validation.fieldsTotal, ok: validation.ok }, paths: { ...report.paths, markdown: markdownRel, json: jsonRel } };
  const markdownFinal = renderTestReportMarkdown(withPaths);
  const markdownIo = store.writeTextAtomic(markdownRel, markdownFinal);
  const jsonIo = store.writeJsonAtomic(jsonRel, withPaths);
  const latest = buildTestsLatest({ report: withPaths, reportRel: markdownRel, reportJsonRel: jsonRel });
  const latestIo = store.writeJsonAtomic(TESTS_LATEST_REL, latest);
  const health = applySourcesHealthTestUpdate({ store, report: withPaths });
  const skills = updateSkillsForecastHitRate({ store, report: withPaths });
  let run = null;
  if (record) {
    run = store.recordRun({
      kind: "B6-tests",
      actor: null, // سجل اختبار فقط: لا يعدّل عدّادات أي كيان حقيقي
      iso: withPaths.time.iso ?? withPaths._meta.generatedAt,
      source: withPaths.time.source ?? "unverified",
      summary: `B6 tests: ${Object.entries(withPaths.fields.results).map(([kind, value]) => `${kind}=${value.available ? "نُفذ" : "لم يُنفذ"}`).join(" ")} | كشف ${withPaths.fields.results.detection.matchedTopics}/${withPaths.fields.results.detection.baselineTopics} · إصابة التنبؤ ${num(withPaths.fields.results.forecast.hitRatePercent)}% · فجوة التشبع ${num(withPaths.fields.results.saturation.meanAbsGapPoints)} · مصادر سليمة ${withPaths.fields.results.sources.healthy}/${withPaths.fields.results.sources.total}`,
      next: "مراجعة الحقل 7 (توصيات الأوزان المعلقة) ورفعها للمجلس.",
      pending: withPaths.fields.weights.map((weight) => `${weight.id}: ${weight.status}`),
      startedAt: withPaths._meta.generatedAt,
      endedAt: new Date().toISOString(),
      extra: {
        report: markdownRel,
        report_json: jsonRel,
        tests_latest: TESTS_LATEST_REL,
        sample_source: withPaths.sampleSource,
        mode: withPaths.mode,
        fields_present: validation.fieldsPresent,
        structure_ok: validation.ok,
      },
    });
  }
  return {
    ok: true,
    markdownRel,
    jsonRel,
    markdown: markdownFinal,
    report: withPaths,
    validation,
    io: { markdown: markdownIo, json: jsonIo, latest: latestIo, health: health.io, skills: skills.io },
    run,
    skillsChanged: skills.changed,
  };
}

// ————————————————————————————————————————————————————————————
// تشغيل الحزمتين: حالة حقيقية / عينة fixtures معزولة
// ————————————————————————————————————————————————————————————

function emptyResults() {
  return {
    detection: runDetectionTest({ baseline: { available: false, topicCount: 0, reason: "لم يُشغّل" }, evidence: { available: false, reason: "لم يُشغّل" } }),
    forecast: runForecastTest({ snapshot: { available: false, reason: "لم يُشغّل" } }),
    saturation: runSaturationTest({ topics: [], manualSample: { available: false, reason: "لم يُشغّل" } }),
    sources: runSourcesTest({ root: process.cwd() }),
  };
}

export async function runTestSuite({
  root = process.cwd(),
  mode = "state",
  timeDoc = null,
  kinds = TEST_KINDS,
  liveGnews = false,
  net = true,
  fetchImpl = null,
  write = true,
  reportDir = REPORT_DIR,
  record = true,
} = {}) {
  const results = emptyResults();
  const timings = {};
  const startedAll = performance.now();
  const selected = new Set(kinds);
  const time = timeDoc ?? (await nowDoc({ net, root }));
  const referenceIso = mode === "fixtures" ? B3_FIXTURE_TIME.iso : time.iso;

  if (mode === "fixtures") {
    const fixture = await runFixtureSuiteInputs({ root, time: B3_FIXTURE_TIME });
    timings.fixtureMs = fixture.setupMs;
    for (const kind of TEST_KINDS) {
      if (!selected.has(kind)) continue;
      const t0 = performance.now();
      if (kind === "detection") results.detection = runDetectionTest({ baseline: fixture.baseline, evidence: fixture.evidence, referenceIso });
      if (kind === "forecast") results.forecast = runForecastTest({ snapshot: fixture.forecastSnapshot, referenceIso });
      if (kind === "saturation") results.saturation = runSaturationTest({ topics: fixture.topics, manualSample: fixture.manualSample, referenceIso });
      if (kind === "sources") results.sources = runSourcesTest({ root: fixture.sandbox, sourceDocument: fixture.sourceDocument, healthDocument: fixture.healthDocument, referenceIso, samples: fixture.samples });
      timings[`${kind}Ms`] = round(performance.now() - t0, 1);
    }
  } else {
    const baseline = collectBaseline({ root });
    const evidence = await collectGnewsEvidence({ root, mode: liveGnews ? "live" : "saved", fetchImpl });
    const forecastSnapshot = collectForecastSnapshot({ root });
    const manualSample = readManualSaturationSample({ root });
    const sourceDocument = createStore(root).readJsonSafe("config/sources.json", { sources: {} });
    const healthDocument = createStore(root).readJsonSafe("state/sources-health.json", { sources: {} });
    for (const kind of TEST_KINDS) {
      if (!selected.has(kind)) continue;
      const t0 = performance.now();
      if (kind === "detection") results.detection = runDetectionTest({ baseline, evidence, referenceIso });
      if (kind === "forecast") results.forecast = runForecastTest({ snapshot: forecastSnapshot, referenceIso });
      if (kind === "saturation") results.saturation = runSaturationTest({ topics: baseline.topics ?? [], manualSample, referenceIso });
      if (kind === "sources") results.sources = runSourcesTest({ root, sourceDocument, healthDocument, referenceIso });
      timings[`${kind}Ms`] = round(performance.now() - t0, 1);
    }
    if (selected.has("detection") && evidence.available && !baseline.available) {
      results.detection = runDetectionTest({ baseline, evidence, referenceIso });
    }
  }

  timings.totalMs = round(performance.now() - startedAll, 1);
  const sampleSource = mode === "fixtures" ? SAMPLE_SOURCE_FIXTURES : SAMPLE_SOURCE_STATE;
  const reportDirRel = normalizeReportDir({ root, reportDir });
  const previous = loadPreviousReport({ root, reportDir: reportDirRel, sampleSource });
  const totalReports = latestReports({ root, reportDir: reportDirRel }).length + 1;
  const report = buildTestReport({
    time,
    sampleTimeIso: referenceIso,
    mode,
    sampleSource,
    runNumber: totalReports,
    totalReports,
    results,
    timings,
    previous,
  });
  report.structure = (() => {
    const markdown = renderTestReportMarkdown(report);
    const validation = validateTestReport(report, markdown);
    return { fieldsPresent: validation.fieldsPresent, fieldsTotal: validation.fieldsTotal, ok: validation.ok };
  })();

  if (!write) return { report, results, timings, written: null, validation: validateTestReport(report, renderTestReportMarkdown(report)) };
  const written = writeTestReport({ stateRoot: root, reportDir: reportDirRel, report, record });
  return { report: written.report, results, timings, written, validation: written.validation };
}

// عينة fixtures معزولة: رادار B3 كامل + دليل gnews «لاحق خلال ساعتين» + لقطة تنبؤ مصنّعة + عينة تشبع يدوية مصنّعة + صحة مصادر مصنّعة.
export async function runFixtureSuiteInputs({ root = process.cwd(), time = B3_FIXTURE_TIME } = {}) {
  const setupStart = performance.now();
  const storeSandbox = makeB3Sandbox(root);
  const env = makeB3FixtureEnvironment(storeSandbox, { startIso: time.iso });
  await runB3FixtureRadar({ root, sandbox: storeSandbox, env });
  const store = createStore(storeSandbox);
  const latest = store.readJsonSafe("state/topics-latest.json", null);
  const topics = Array.isArray(latest?.topics) ? latest.topics : [];
  const runIso = latest?.time?.iso ?? time.iso;
  const runMs = parseMs(runIso);

  // (1) دليل gnews لاحق: مطابقة لثلاثة مواضيع + عنصر داخل النافذة بلا مطابقة + عنصر خارج النافذة
  const matchedTopics = topics.slice(0, 3);
  const evidenceItems = matchedTopics.map((topic, index) => ({
    title: `${topic.title} — تحديث لاحق`,
    link: `https://news.google.com/rss/articles/fixture-later-${index + 1}`,
    publishedAt: new Date(runMs + (index + 1) * 30 * 60000).toISOString(),
    source_id: "gnews",
  }));
  evidenceItems.push({
    title: "افتتاح مهرجان التمور في بريدة",
    link: "https://news.google.com/rss/articles/fixture-later-unmatched",
    publishedAt: new Date(runMs + 45 * 60000).toISOString(),
    source_id: "gnews",
  });
  evidenceItems.push({
    title: "مزاد الإبل في سوق عكاظ",
    link: "https://news.google.com/rss/articles/fixture-later-outside",
    publishedAt: new Date(runMs + 3 * HOUR_MS).toISOString(),
    source_id: "gnews",
  });
  const evidenceDir = path.join(storeSandbox, "state", "samples");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const gnewsRel = FETCHER_SAMPLE_PATH("gnews");
  store.writeJsonAtomic(gnewsRel, {
    _meta: { format: "json", notes: "عينة اختبار مصنّعة في B6 من fixtures معزولة — غير حية." },
    source: "gnews",
    fetched_at: new Date(runMs + 2 * HOUR_MS).toISOString(),
    status: "ok",
    success: true,
    response_ms: 42.5,
    request_count: 1,
    items: evidenceItems,
  });

  // (2) لقطة تنبؤ مصنّعة + تشغيلان لاحقان بعدّات مختلفة (تحقق/لم يتحقق/تراجع/بانتظار)
  const forecastTopics = [
    { id: "fixture-verified", title: "موضوع تحقق: ارتفاع العدّ بعد التنبؤ", count: 5, forecastAtIso: runIso },
    { id: "fixture-not-verified", title: "موضوع ثابت: لم يتحقق", count: 5, forecastAtIso: runIso },
    { id: "fixture-regressed", title: "موضوع تراجع: انخفاض العدّ", count: 7, forecastAtIso: runIso },
    { id: "fixture-pending", title: "موضوع بانتظار: لا تشغيل لاحق بعد", count: 2, forecastAtIso: new Date(runMs + 5 * HOUR_MS).toISOString() },
  ].map((spec) => ({
    id: spec.id,
    title: spec.title,
    firstSeen: runIso,
    lastSeen: runIso,
    sources: ["gnews"],
    members: [],
    currentCount: spec.count,
    count: spec.count,
    classification: "نافذة",
    metrics: { accelerationPerHour: 1.5, saturationPercent: 30, classification: "نافذة", classificationKey: "window" },
    burst: {
      forecast: FORECAST_LABEL,
      forecastAtIso: spec.forecastAtIso,
      forecastCriteria: { positiveAcrossTwoRuns: true, lowSaturation: true, previousAcceleration: 0.8, currentAcceleration: 1.5, saturationPercent: 30 },
      zScore: 2.5,
      historicalSampleCount: 3,
      historicalCounts: [2, 3, spec.count],
    },
  }));
  store.writeJsonAtomic("state/topics.json", { _meta: { format: "json", schemaVersion: "B3.1", lastRunIso: runIso, timeSource: time.source }, topics: forecastTopics });
  // اللقطة المحفوظة في العينة = اللقطة المصنّعة (لقطة التنبؤ هي المقصودة بالاختبار — غير حية وموسومة)
  store.writeJsonAtomic("state/topics-latest.json", {
    ...(latest ?? {}),
    _meta: { ...(latest?._meta ?? {}), notes: `عينة اختبار B6 مصنّعة — غير حية. ${latest?._meta?.notes ?? ""}`.trim() },
    topics: forecastTopics,
  });
  store.writeRun({
    kind: "B3-radar",
    iso: new Date(runMs + 1 * HOUR_MS).toISOString(),
    source: time.source,
    summary: "عينة اختبار B6: تشغيل لاحق 1",
    extra: { success: true, topicCounts: { "fixture-verified": 7, "fixture-not-verified": 5, "fixture-regressed": 6 } },
  });
  store.writeRun({
    kind: "B3-radar",
    iso: new Date(runMs + 2 * HOUR_MS).toISOString(),
    source: time.source,
    summary: "عينة اختبار B6: تشغيل لاحق 2",
    extra: { success: true, topicCounts: { "fixture-verified": 9, "fixture-not-verified": 5, "fixture-regressed": 3 } },
  });

  // (3) عينة تشبع يدوية مصنّعة: داخل الهامش + فجوة ملحوظة + معرّف غير مطابق
  const referenceTopic = topics[0];
  const engineSaturation = finite(referenceTopic?.metrics?.saturationPercent ?? referenceTopic?.saturation);
  const manualSaturation = {
    _meta: { notes: "عينة اختبار مصنّعة في B6 — غير حية." },
    samples: [
      { topic_id: referenceTopic?.id ?? null, manual_saturation_percent: round(engineSaturation + 4, 2), counted_at: runIso, counted_sources: ["gnews", "telegram"], note: "داخل الهامش" },
      { topic_id: referenceTopic?.id ?? null, manual_saturation_percent: round(engineSaturation + 18, 2), counted_at: runIso, counted_sources: ["gnews"], note: "فجوة ملحوظة" },
      { topic_id: "topic-not-in-engine", manual_saturation_percent: 33, counted_at: runIso, counted_sources: [], note: "معرّف غير مطابق" },
    ],
  };
  store.writeJsonAtomic(MANUAL_SATURATION_REL, manualSaturation);

  // (4) صحة مصادر مصنّعة: تبريد + تأخر تجدد + استجابة بطيئة (لا تلمس الحقول الحية خارج العينة)
  const health = store.readJsonSafe("state/sources-health.json", { _meta: {}, sources: {} });
  const cooldownUntil = new Date(runMs + 15 * 60000).toISOString();
  health.sources.gnews = { ...(health.sources.gnews ?? {}), status: "تبريد", blocked_until: cooldownUntil, backoff_stage: 1, last_response_ms: 421.7 };
  health.sources["trends-rss"] = { ...(health.sources["trends-rss"] ?? {}), last_response_ms: 5200, status: "سليم", last_ok: new Date(runMs - 2 * HOUR_MS).toISOString() };
  health.sources["wiki-rc"] = { ...(health.sources["wiki-rc"] ?? {}), status: "سليم", last_ok: new Date(runMs - 48 * HOUR_MS).toISOString(), last_response_ms: 320 };
  health._meta = { ...(health._meta ?? {}), updated_at: runIso, last_request_at: new Date(runMs - 60000).toISOString() };
  store.writeJsonAtomic("state/sources-health.json", health);

  const samples = {
    gnews: {
      _meta: { format: "json", notes: "عينة اختبار B6 — غير حية." },
      source: "gnews",
      fetched_at: new Date(runMs - 30 * 60000).toISOString(),
      success: true,
      status: "ok",
      response_ms: 640,
      items: evidenceItems.slice(0, 2),
    },
  };

  return {
    sandbox: storeSandbox,
    setupMs: round(performance.now() - setupStart, 1),
    topics,
    runIso,
    cooldownUntil,
    engineSaturation,
    baseline: {
      available: topics.length > 0,
      source: "sandbox state/topics-latest.json (fixtures معزولة)",
      runIso,
      timeSource: time.source,
      topics,
      topicCount: topics.length,
      reason: null,
    },
    evidence: { available: true, mode: "saved", source: `sandbox ${gnewsRel} (عينة اختبار مصنّعة)`, fetchedAt: new Date(runMs + 2 * HOUR_MS).toISOString(), status: "ok", items: evidenceItems, reason: null },
    forecastSnapshot: collectForecastSnapshot({ root: storeSandbox }),
    manualSample: readManualSaturationSample({ root: storeSandbox }),
    sourceDocument: store.readJsonSafe("config/sources.json", { sources: {} }),
    healthDocument: store.readJsonSafe("state/sources-health.json", { sources: {} }),
    samples,
  };
}

// ————————————————————————————————————————————————————————————
// واجهة سطر الأوامر
// ————————————————————————————————————————————————————————————
const USAGE = `الاستخدام:
  node engine/tests.js [--type all|كشف|تنبؤ|تشبع|مصادر] [--from-fixtures] [--live-gnews] [--offline]
                       [--report-dir reports] [--no-write] [--no-record] [--print]
  node engine/tests.js                    الاختبارات الأربعة على حالة المشروع الحقيقية (بلا شبكة افتراضياً)
  node engine/tests.js --from-fixtures     الاختبارات الأربعة على عينة fixtures معزولة (حتمية — غير حية)
  node engine/tests.js --live-gnews        يجرّب جلب gnews حياً لدليل الكشف (يفشل موسوماً عند انقطاع الشبكة)
  المخرجات: reports/tests-<iso>.md + .json · state/tests-latest.json · تحديث state/sources-health.json وstate/skills.md`;

function flagValue(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
}

export async function runTestsCli({ root = process.cwd(), argv = process.argv.slice(2), log = console.log } = {}) {
  const typeArg = flagValue(argv, "--type", "all");
  const kind = TEST_ALIASES[String(typeArg).trim()] ?? null;
  if (!kind) {
    log(`--type غير معروف: ${typeArg}\n\n${USAGE}`);
    return 1;
  }
  const kinds = kind === "all" ? TEST_KINDS : [kind];
  const mode = argv.includes("--from-fixtures") ? "fixtures" : "state";
  const result = await runTestSuite({
    root,
    mode,
    kinds,
    liveGnews: argv.includes("--live-gnews"),
    net: !argv.includes("--offline"),
    write: !argv.includes("--no-write"),
    reportDir: flagValue(argv, "--report-dir", REPORT_DIR),
    record: !argv.includes("--no-record"),
  });
  const report = result.report;
  log(report.fields["time-and-run"].line);
  log(`== B6 TESTS (${mode === "fixtures" ? "fixtures معزولة — غير حية" : "حالة حقيقية — بلا شبكة"}) ==`);
  for (const row of report.fields.executed.rows) log(`[${row.label}] ${row.executed ? "نُفذ" : "لم يُنفذ"} | ${row.durationMs}ms | ${row.note}`);
  const d = report.fields.results.detection;
  log(`كشف: خط الأساس ${d.baselineTopics} · دليل ${d.evidenceItems} · داخل النافذة ${d.inWindowItems} · مطابق ${d.matchedTopics} (${num(d.precisionPercent)}%) · متوسط زمن التحقق ${num(d.meanConfirmationMinutes)} دقيقة`);
  const f = report.fields.results.forecast;
  log(`تنبؤ: ${f.total} — تحقق ${f.verified} · لم يتحقق ${f.notVerified} · تراجع ${f.regressed} · بانتظار ${f.pending} | معدل الإصابة ${num(f.hitRatePercent)}%`);
  const s = report.fields.results.saturation;
  log(`تشبع: عينات ${s.samples} · مطابقة ${s.matched} · متوسط الفجوة ${num(s.meanAbsGapPoints)} نقطة · الحكم ${s.verdict ?? "—"}`);
  const src = report.fields.results.sources;
  log(`مصادر: ${src.total} مصدراً — سليم ${src.healthy} · فشل ${src.failing} · تبريد ${src.cooling} · متأخر ${src.stale} · متوسط الاستجابة ${num(src.meanResponseMs, 1)}ms`);
  if (result.written) {
    log(`التقرير: ${result.written.markdownRel} + ${result.written.jsonRel}`);
    log(`البنية: ${result.written.validation.fieldsPresent}/${result.written.validation.fieldsTotal} حقول ${result.written.validation.ok ? "✓" : "✗"} | المرآة: ${TESTS_LATEST_REL} | sources-health محدّث | skills.md ${result.written.skillsChanged ? "محدّث" : "بلا تغيير"} | run: ${result.written.run?.rel ?? "—"}`);
  } else {
    log("--no-write: لم يُكتب أي ملف.");
  }
  if (argv.includes("--print")) log(result.written?.markdown ?? "");
  return result.written?.validation?.ok === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runTestsCli({ root: process.cwd() }));
}
