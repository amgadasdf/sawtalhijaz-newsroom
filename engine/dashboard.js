// engine/dashboard.js — حزمة B4: مولد الداشبورد المضمّن (RTL، صفحة واحدة، أصول مضمّنة بالكامل).
//
// يقرأ: state/topics-latest.json + state/sources-health.json (+ state/inventory.json وconfig/sources.json
//       وstate/radar.json وstate/runs/ لأرقام التشغيل والميزانيات والربط الداخلي).
// يكتب: out/radar-<طابع زمني موثق>.html بكتابة ذرية (ملف مؤقت ثم rename).
//
// قرار B1 (المؤكد في الخطوة صفر من B4): الامتداد .js حصراً — لا ملفات .mjs في هذا المستودع.
// الصفحة مضمّنة بالكامل: CSS داخل <style> واحد، صفر JavaScript، صفر موارد خارجية، وصفر وسوم <a>؛
// كل العناوين (URLs) تظهر كنصّ معزول غير قابل للنقر — تُفتح اللوحة في عارض معزول بلا شبكة.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc, timeLine } from "./time.js";
import { classifyOpportunity } from "./metrics.js";
import { tokenizeArabic } from "./cluster.js";

// —— الأقسام الست (بوابة B4 تفحص حضورها كلها) ——
export const DASHBOARD_SECTIONS = Object.freeze([
  { id: "topbar", index: 1, tag: "header", label: "الشريط العلوي — الزمن الموثق بمصدره + رقم التشغيل + مدة الغياب + بادج الزمن" },
  { id: "golden-windows", index: 2, tag: "section", label: "نوافذ ذهبية مميزة (أعلى الصفحة)" },
  { id: "todays-opportunities", index: 3, tag: "section", label: "فرص اليوم — بطاقات مرتبة بدرجة الفرصة" },
  { id: "forecasts", index: 4, tag: "section", label: "تنبؤات «متوقع خلال ساعات» — موعد التحقق وحالته السابقة" },
  { id: "sources-health", index: 5, tag: "section", label: "حالة المصادر — الصحة والميزانية المتبقية والتبريد" },
  { id: "internal-links", index: 6, tag: "section", label: "الذيل — مواضعنا ذات الصلة من inventory.json (ربط داخلي مقترح)" },
]);

// تسميات الواجهة تطابق مفاتيح التصنيف الوصفية من B3؛ OpportunityScore للترتيب فقط.
export const CLASSIFICATION_LABELS = Object.freeze({
  golden: Object.freeze({ council: "نافذة ذهبية", engine: "نافذة ذهبية", className: "cls-golden" }),
  window: Object.freeze({ council: "نافذة", engine: "نافذة", className: "cls-window" }),
  crowded: Object.freeze({ council: "مزدحمة", engine: "مزدحم", className: "cls-crowded" }),
  missed: Object.freeze({ council: "فائت", engine: "فائت", className: "cls-missed" }),
});

export const FORECAST_LABEL = "متوقع خلال ساعات";
export const NO_FORECAST_LABEL = "غير متوقع";
export const CROWDED_THRESHOLD_PERCENT = 50; // حدّ «مزدحمة» في محرك B3
export const MIN_SATURATION_RATE_PER_HOUR = 0.5; // أرضية معدل ارتفاع التشبع (لا قسمة على صفر)
export const FORECAST_HORIZON_HOURS = Object.freeze([1, 6]); // «خلال ساعات»: من ساعة إلى ست
export const FORECAST_RULE_TEXT =
  "موعد التحقق المتوقع = زمن التشغيل الموثق + ساعات التحقق، حيث ساعات التحقق = (50 − التشبع%) ÷ معدل ارتفاع التشبع/ساعة، ومعدل ارتفاع التشبع = السرعة × متوسط وزن المصادر غير المغطاة ÷ مجموع أوزان المصادر اليومية × 100 (حد أدنى 0.5 نقطة/ساعة)، والنتيجة مقصوصة إلى [1، 6] ساعة.";
export const INTERNAL_LINKS_PER_TOPIC = 3;
export const INTERNAL_LINKS_MAX_TOPICS = 6;
export const MEMBERS_PER_CARD = 3;
export const OUTPUT_DIR = "out";

const HOUR_MS = 3_600_000;

// —— أدوات صغيرة ——
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function formatNumber(value, places = 4) {
  const number = finite(value);
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(places)));
}

export function formatHours(value) {
  const hours = finite(value);
  if (hours <= 0) return "0 س";
  if (hours < 1) return `${Math.round(hours * 60)} د`;
  if (hours < 48) return `${formatNumber(hours, 1)} س`;
  return `${formatNumber(hours / 24, 1)} يوم`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const esc = escapeHtml;

// الطابع الزمني الموثق في اسم الملف بنفس اصطدام state/runs (<iso> مع : و . ← -)
export function dashboardFileName(iso) {
  const stamp = String(iso ?? "").replace(/[:.]/gu, "-");
  if (!stamp) throw new Error("dashboardFileName: طابع زمني موثق مطلوب");
  return `radar-${stamp}.html`;
}

export function dashboardOutputPath(iso) {
  return path.join(OUTPUT_DIR, dashboardFileName(iso));
}

function parseMs(value) {
  const ms = new Date(value ?? "").getTime();
  return Number.isFinite(ms) ? ms : null;
}

function hoursBetween(fromIso, toIso) {
  const from = parseMs(fromIso);
  const to = parseMs(toIso);
  if (from === null || to === null) return null;
  return (to - from) / HOUR_MS;
}

export function classificationOf(topic) {
  const key = classifyOpportunity({
    accelerationPerHour: finite(topic?.metrics?.accelerationPerHour ?? topic?.acceleration),
    saturationPercent: finite(topic?.metrics?.saturationPercent ?? topic?.saturation),
  }).key;
  return { key, ...(CLASSIFICATION_LABELS[key] ?? CLASSIFICATION_LABELS.missed) };
}

// —— (1) الشريط العلوي: رقم التشغيل + الغياب عن آخر تشغيل ——
export function collectRunInfo({ store, latest }) {
  const runPath = latest?._meta?.runPath ?? null;
  const runIso = latest?.time?.iso ?? latest?._meta?.generatedAt ?? null;
  const radarRuns = store
    .listRuns(1000)
    .map((entry) => ({ ...entry, doc: store.readJsonSafe(entry.rel, null) }))
    .filter((entry) => entry.doc?.kind === "B3-radar")
    .sort((a, b) => String(a.doc?.iso ?? "").localeCompare(String(b.doc?.iso ?? "")) || a.file.localeCompare(b.file));
  let index = runPath ? radarRuns.findIndex((entry) => entry.rel === runPath) : -1;
  if (index < 0 && runIso) index = radarRuns.findIndex((entry) => entry.doc?.iso === runIso);
  const current = index >= 0 ? radarRuns[index] : null;
  const previous = index > 0 ? radarRuns[index - 1] : null;
  const radarState = store.readJsonSafe("state/radar.json", null);
  return {
    number: index >= 0 ? index + 1 : radarRuns.length,
    totalRecorded: radarRuns.length,
    path: current?.rel ?? runPath,
    previousRunIso: previous?.doc?.iso ?? null,
    counters: finite(radarState?.counters),
    lastSummary: radarState?.lastSummary ?? null,
  };
}

// —— (4) التنبؤات: موعد التحقق المتوقع (قاعدة معلنة حتمية من بيانات topics-latest وحدها) ——
export function computeForecastExpectation(topic, referenceIso) {
  const metrics = topic?.metrics ?? {};
  const saturationPercent = finite(metrics.saturationPercent ?? topic?.saturation);
  const speedPerHour = finite(metrics.speedPerHour ?? topic?.speed);
  const numerator = finite(metrics.saturationNumerator);
  const denominator = finite(metrics.saturationDenominator);
  const coveredCount = Array.isArray(metrics.coverageSources) ? metrics.coverageSources.length : 0;
  const trackedCount = finite(metrics.trackedSourceCount);
  const uncoveredCount = Math.max(1, trackedCount - coveredCount);
  const uncoveredAverageWeight = denominator > 0 ? Math.max(0, (denominator - numerator) / uncoveredCount) : 0;
  const rawRate = denominator > 0 ? (speedPerHour * uncoveredAverageWeight * 100) / denominator : 0;
  const saturationPerHour = Math.max(MIN_SATURATION_RATE_PER_HOUR, rawRate);
  const gap = Math.max(0, CROWDED_THRESHOLD_PERCENT - saturationPercent);
  const hoursToRealize = Number(clamp(gap / saturationPerHour, FORECAST_HORIZON_HOURS[0], FORECAST_HORIZON_HOURS[1]).toFixed(1));
  const referenceMs = parseMs(referenceIso);
  return {
    saturationPercent,
    speedPerHour,
    uncoveredAverageWeight: Number(uncoveredAverageWeight.toFixed(4)),
    saturationPerHour: Number(saturationPerHour.toFixed(4)),
    gapToCrowded: Number(gap.toFixed(4)),
    hoursToRealize,
    expectedIso: referenceMs === null ? null : new Date(referenceMs + hoursToRealize * HOUR_MS).toISOString(),
    rule: `(${formatNumber(CROWDED_THRESHOLD_PERCENT)} − ${formatNumber(saturationPercent, 2)}) ÷ ${formatNumber(saturationPerHour, 2)} = ${formatNumber(hoursToRealize, 1)} س`,
  };
}

// —— (4) حالة تحقق التنبؤ السابق: من سجل العدّات السابق والتسارع السابق ——
export function computePreviousVerification(topic) {
  const burst = topic?.burst ?? {};
  const history = (Array.isArray(burst.historicalCounts) ? burst.historicalCounts : []).map((value) => finite(value));
  const criteria = burst.forecastCriteria ?? {};
  const previousAcceleration = finite(criteria.previousAcceleration);
  const currentCount = finite(topic?.currentCount ?? topic?.count);
  const samples = finite(burst.historicalSampleCount, history.length);
  const previousCount = history.length ? history[history.length - 1] : null;
  if (previousCount === null && previousAcceleration === 0) {
    return {
      key: "no-history",
      label: "بلا سجل سابق",
      detail: `أول رصد لهذا الموضوع (عيّنات التاريخ = ${formatNumber(samples)}) — لم يُختبر تنبؤ سابق له.`,
      previousCount: null,
      currentCount,
    };
  }
  if (previousAcceleration > 0 && previousCount !== null && currentCount > previousCount) {
    return {
      key: "verified",
      label: "تحقق سابقاً",
      detail: `تنبؤ سابق بتسارع ${formatNumber(previousAcceleration, 2)} صحبه ارتفاع: ${formatNumber(previousCount)} ← ${formatNumber(currentCount)} تغطية.`,
      previousCount,
      currentCount,
    };
  }
  if (previousAcceleration > 0) {
    return {
      key: "not-verified",
      label: "لم يتحقق سابقاً",
      detail: `تسارع سابق موجب (${formatNumber(previousAcceleration, 2)}) بلا ارتفاع في العدّ (${formatNumber(previousCount)} ← ${formatNumber(currentCount)}).`,
      previousCount,
      currentCount,
    };
  }
  return {
    key: "no-forecast",
    label: "لم يصدر تنبؤ سابق",
    detail: `التسارع السابق ${formatNumber(previousAcceleration, 2)} (غير موجب) — لا تنبؤ سابق للتحقق منه.`,
    previousCount,
    currentCount,
  };
}

// —— (5) حالة المصادر: الميزانية المتبقية والتبريد ——
export function computeSourceRow({ sourceId, config, health, runStatus, referenceIso }) {
  const referenceMs = parseMs(referenceIso) ?? Date.now();
  const budgetPerHour = finite(config?.rate_limit_per_hour);
  const requestTimes = Array.isArray(health?.request_times) ? health.request_times : [];
  const inWindow = requestTimes.filter((iso) => {
    const ms = parseMs(iso);
    return ms !== null && ms <= referenceMs && referenceMs - ms < HOUR_MS;
  }).length;
  const blockedUntil = health?.blocked_until ?? null;
  const blockedMs = parseMs(blockedUntil);
  const cooling = blockedMs !== null && blockedMs > referenceMs;
  return {
    sourceId,
    enabled: config?.enabled === true,
    dailyEnabled: config?.daily_enabled !== false,
    weight: finite(config?.weight),
    healthStatus: String(health?.status ?? (config?.enabled === false ? "معطل" : "بلا سجل")),
    budgetPerHour,
    requestsInWindow: inWindow,
    remainingRequests: budgetPerHour > 0 ? Math.max(0, budgetPerHour - inWindow) : 0,
    requestsTotal: finite(health?.requests),
    errorsTotal: finite(health?.errors),
    invocations: finite(health?.invocations),
    cacheHits: finite(health?.cache_hits),
    lastInvocation: health?.last_invocation ?? null,
    lastResponseMs: health?.last_response_ms ?? null,
    lastError: health?.last_err ?? null,
    backoffStage: finite(health?.backoff_stage),
    blockedUntil,
    cooling,
    coolingMinutesLeft: cooling ? Math.max(0, Math.round((blockedMs - referenceMs) / 60000)) : 0,
    runStatus: runStatus?.status ?? null,
    runLabel: runStatus?.label ?? null,
    runCount: runStatus ? finite(runStatus.count) : null,
    runRequests: runStatus ? finite(runStatus.requestCount) : null,
    runError: runStatus?.error ?? null,
    notes: config?.notes ?? null,
  };
}

// —— (6) الذيل: ربط داخلي مقترح من جرد الموقع ——
function slugTokens(rawUrl) {
  let text = String(rawUrl ?? "");
  try {
    const parsed = new URL(String(rawUrl));
    text = `${parsed.pathname} ${parsed.search}`;
  } catch {
    /* ليس URL — يُجزّأ كما هو */
  }
  try {
    text = decodeURIComponent(text);
  } catch {
    /* نسبة مئوية غير صالحة — تُترك كما هي */
  }
  return tokenizeArabic(text.replace(/[-_/?&=%.]+/gu, " "));
}

export function matchInventoryLinks({ topics, inventory, perTopic = INTERNAL_LINKS_PER_TOPIC, maxTopics = INTERNAL_LINKS_MAX_TOPICS }) {
  const urls = Array.isArray(inventory?.urls) ? inventory.urls : [];
  if (!urls.length || !Array.isArray(topics) || !topics.length) return [];
  const suggestions = [];
  for (const topic of topics.slice(0, maxTopics)) {
    const titleTokens = tokenizeArabic(String(topic?.title ?? ""));
    const desk = topic?.deskGuess ?? null;
    const scored = [];
    urls.forEach((row, position) => {
      const tokens = slugTokens(row?.url);
      const shared = titleTokens.filter((token) => tokens.includes(token));
      const sectionMatch = Boolean(desk && row?.section && String(row.section) === String(desk));
      if (!shared.length && !sectionMatch) return;
      scored.push({
        topicId: topic.id,
        topicTitle: topic.title,
        desk,
        inventoryIndex: position,
        url: String(row?.url ?? ""),
        type: row?.type ?? "unknown",
        section: row?.section ?? null,
        tag: row?.tag ?? null,
        author: row?.author ?? null,
        lastModified: row?.lastModified ?? null,
        sharedKeywords: shared,
        sectionMatch,
        score: shared.length * 2 + (sectionMatch ? 1 : 0),
      });
    });
    scored.sort((a, b) => b.score - a.score || b.sharedKeywords.length - a.sharedKeywords.length || a.url.localeCompare(b.url));
    suggestions.push(...scored.slice(0, perTopic));
  }
  return suggestions;
}

// —— بناء حمولة اللوحة من وثائق B3 (دالة نقية: تستعملها القراءة من state/ والبوابة الحتمية بالوثائق المصنّعة) ——
export function buildDashboardPayload({
  latest,
  health = { _meta: {}, sources: {} },
  inventory = null,
  sourceDocument = { sources: {} },
  run = { number: 0, totalRecorded: 0, path: null, previousRunIso: null, counters: 0, lastSummary: null },
  generatedAt = new Date().toISOString(),
  provenance = null,
}) {
  if (!latest) throw new Error("buildDashboardPayload: وثيقة topics-latest مطلوبة");
  const topics = Array.isArray(latest?.topics) ? latest.topics : [];
  const referenceIso = latest?.time?.iso ?? latest?._meta?.generatedAt ?? generatedAt;
  const statuses = Array.isArray(latest?.sourceStatuses) ? latest.sourceStatuses : [];
  const statusById = new Map(statuses.map((entry) => [entry.sourceId, entry]));
  const healthSources = health?.sources ?? {};
  const sourceIds = [
    ...new Set([...Object.keys(sourceDocument?.sources ?? {}), ...Object.keys(healthSources), ...statuses.map((entry) => entry.sourceId)]),
  ].sort((a, b) => a.localeCompare(b));
  return {
    generatedAt,
    provenance,
    referenceIso,
    latest,
    health: health ?? { _meta: {}, sources: {} },
    inventory,
    sourceDocument,
    run,
    topics,
    goldenTopics: topics.filter((topic) => classificationOf(topic).key === "golden"),
    forecastTopics: topics.filter((topic) => topic?.burst?.forecast === FORECAST_LABEL),
    sourceRows: sourceIds.map((sourceId) =>
      computeSourceRow({
        sourceId,
        config: sourceDocument?.sources?.[sourceId] ?? null,
        health: healthSources[sourceId] ?? null,
        runStatus: statusById.get(sourceId) ?? null,
        referenceIso: generatedAt,
      })
    ),
    inventoryLinks: matchInventoryLinks({ topics, inventory }),
    time: {
      iso: latest?.time?.iso ?? null,
      source: latest?.time?.source ?? latest?._meta?.timeSource ?? null,
      skewSeconds: finite(latest?.time?.skewSeconds),
      note: latest?.time?.note ?? "",
      line: latest?.time?.line ?? (latest?.time ? timeLine(latest.time) : ""),
    },
    absenceHours: hoursBetween(referenceIso, generatedAt),
    gapFromPreviousRunHours: run?.previousRunIso ? hoursBetween(run.previousRunIso, referenceIso) : null,
  };
}

// —— جمع بيانات اللوحة من state/ (فشل صريح إن لم توجد بيانات B3) ——
export function collectDashboardData({ root = process.cwd(), generatedAt = new Date().toISOString(), provenance = null } = {}) {
  const store = createStore(root);
  const latest = store.readJsonSafe("state/topics-latest.json", null);
  if (!latest) {
    throw new Error(
      "لا توجد state/topics-latest.json — شغّل رادار B3 أولاً (node engine/cli.js radar …) أو ولّد اللوحة من بيانات fixtures المعزولة (node engine/cli.js dashboard --from-fixtures)."
    );
  }
  return buildDashboardPayload({
    latest,
    health: store.readJsonSafe("state/sources-health.json", { _meta: {}, sources: {} }) ?? { _meta: {}, sources: {} },
    inventory: store.readJsonSafe("state/inventory.json", null),
    sourceDocument: store.readJsonSafe("config/sources.json", { sources: {} }) ?? { sources: {} },
    run: collectRunInfo({ store, latest }),
    generatedAt,
    provenance,
  });
}

// —— فحص الاكتفاء الذاتي: لا مورد خارجي ولا رابط خارجي في الملف ——
const FORBIDDEN_TAG = /^<\/?(?:a|link|script|img|image|iframe|frame|frameset|video|audio|source|embed|object|track|use|base|form|input|button|picture|portal)\b/iu;
const FORBIDDEN_ATTRIBUTE = /\s(?:src|href|action|formaction|data-src|srcset|poster|cite|background|longdesc|profile|manifest)\s*=/iu;
const TAG_PATTERN = /<[^>]*>/gu;
const URL_IN_TEXT_PATTERN = /\b(?:https?:)?\/\/[^\s"'<>]+/giu;

export function findExternalReferences(html) {
  const violations = [];
  const text = String(html ?? "");
  for (const tag of text.match(TAG_PATTERN) ?? []) {
    if (FORBIDDEN_TAG.test(tag)) {
      violations.push(`وسم مورد/رابط ممنوع: ${tag.slice(0, 140)}`);
      continue;
    }
    if (FORBIDDEN_ATTRIBUTE.test(tag)) violations.push(`خاصية خارجية في وسم: ${tag.slice(0, 140)}`);
    if (/url\s*\(/iu.test(tag) || /@import/iu.test(tag)) violations.push(`مرجع CSS خارجي داخل وسم: ${tag.slice(0, 140)}`);
    if (/\bhttps?:\/\//iu.test(tag) || /\b\/\/(?:cdn|fonts|ajax|unpkg|jsdelivr)\b/iu.test(tag)) {
      violations.push(`عنوان خارجي داخل وسم: ${tag.slice(0, 140)}`);
    }
  }
  for (const block of text.match(/<style\b[^>]*>[\s\S]*?<\/style>/giu) ?? []) {
    if (/url\s*\(/iu.test(block)) violations.push("CSS يستعمل url() — ممنوع في لوحة مضمّنة");
    if (/@import/iu.test(block)) violations.push("CSS يستعمل @import — ممنوع في لوحة مضمّنة");
    if (/@font-face/iu.test(block)) violations.push("CSS يستعمل @font-face — الخطوط محلية فقط");
    if (/\bhttps?:\/\//iu.test(block)) violations.push("CSS يحتوي عنواناً خارجياً");
  }
  return violations;
}

// —— CSS المضمّن (بلا أي مورد خارجي، وبلا @font-face ولا url()) ——
const EMBEDDED_CSS = `
:root{
  --bg:#101318; --panel:#171b22; --panel-2:#1e232c; --ink:#eceff4; --muted:#98a2b3;
  --line:#2b323d; --gold:#f2c14e; --window:#4ea1ff; --crowded:#ff9f43; --missed:#8b93a3;
  --ok:#3ddc97; --bad:#ff6b6b; --warn:#ffd166;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.75;font-size:15px;
  font-family:"Segoe UI","Noto Naskh Arabic",Tahoma,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:20px 18px 40px}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:19px;margin:0 0 4px}
h3{font-size:16px;margin:0 0 8px;line-height:1.5}
h4{font-size:13.5px;margin:12px 0 4px;color:var(--muted)}
p{margin:6px 0}
.muted{color:var(--muted)}
.small{font-size:12.5px}
.mono{font-family:Consolas,"Liberation Mono","DejaVu Sans Mono",monospace;font-size:12.5px;direction:ltr;unicode-bidi:isolate;text-align:left}
section{margin-top:24px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid var(--line);
  background:var(--panel-2);font-size:12.5px;white-space:nowrap}
.badge-strong{border-color:var(--bad);color:#ffd9d9;background:#2a1a1c}
.badge-manual{border-color:var(--warn);color:#ffe9b8;background:#2a2415}
.badge-ok{border-color:var(--ok);color:#c9ffe6;background:#12291f}
.badge-info{border-color:var(--window);color:#d6e8ff;background:#12202f}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}
.kpi{background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.kpi b{display:block;font-size:20px;line-height:1.4}
.kpi span{color:var(--muted);font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;margin-top:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;border-inline-start:6px solid var(--line)}
.card.cls-golden{border-inline-start-color:var(--gold);background:linear-gradient(180deg,#232010,var(--panel))}
.card.cls-window{border-inline-start-color:var(--window)}
.card.cls-crowded{border-inline-start-color:var(--crowded)}
.card.cls-missed{border-inline-start-color:var(--missed)}
.card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.score{font-size:26px;font-weight:700;line-height:1.1;text-align:center}
.score small{display:block;font-size:11.5px;color:var(--muted);font-weight:400}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;vertical-align:top}
th{color:var(--muted);font-weight:600;background:var(--panel-2)}
td.num,th.num{text-align:center;white-space:nowrap}
.bar{position:relative;display:block;height:8px;border-radius:6px;background:var(--panel-2);border:1px solid var(--line);overflow:hidden;margin-top:6px}
.bar>i{position:absolute;inset-block:0;inset-inline-start:0;display:block}
.bar>i.golden{background:var(--gold)}
.bar>i.window{background:var(--window)}
.bar>i.crowded{background:var(--crowded)}
.bar>i.missed{background:var(--missed)}
.tag{display:inline-block;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);padding:1px 7px;margin:2px 0 2px 4px;font-size:12px}
.note{border:1px dashed var(--line);border-radius:12px;padding:10px 12px;background:var(--panel-2);margin-top:10px}
.empty{border:1px dashed var(--line);border-radius:12px;padding:14px;background:var(--panel-2);color:var(--muted);margin-top:12px}
.status-ok{color:var(--ok)}
.status-bad{color:var(--bad)}
.status-warn{color:var(--warn)}
.status-off{color:var(--missed)}
footer{margin-top:28px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:12.5px}
ul.tight{margin:6px 0;padding-inline-start:20px}
ul.tight li{margin:4px 0}
@media (max-width:640px){.grid{grid-template-columns:1fr}.score{font-size:22px}}
@media print{body{background:#fff;color:#000}.panel,.card,.kpi,.empty,.note{border-color:#bbb;background:#fff}}
`;

// —— أجزاء العرض ——
function badge(text, className = "") {
  return `<span class="badge${className ? ` ${className}` : ""}">${esc(text)}</span>`;
}

function timeBadges(data) {
  const source = data.time.source;
  const attested = source === "env" || source === "header";
  const badges = [];
  if (attested) {
    badges.push(badge(`زمن موثق — مصدر=${source}`, "badge-ok"));
  } else {
    // بادج «زمن غير موثق» عند الطبقة اليدوية/غير الموثقة (مواصفة B4، البند 1)
    badges.push(badge("زمن غير موثق", "badge-strong"));
    badges.push(badge(source === "manual" ? "الطبقة اليدوية: إدخال المالك عبر settime" : `الطبقة: ${source ?? "غير معروف"}`, "badge-manual"));
  }
  badges.push(badge(`skew=${formatNumber(data.time.skewSeconds)}ث`));
  badges.push(badge(`رقم التشغيل #${data.run.number} من ${data.run.totalRecorded}`, "badge-info"));
  badges.push(badge(`مدة الغياب عن آخر تشغيل: ${data.absenceHours === null ? "—" : formatHours(data.absenceHours)}`));
  badges.push(badge(data.gapFromPreviousRunHours === null ? "لا تشغيل سابق مسجّل" : `الفارق عن التشغيل السابق: ${formatHours(data.gapFromPreviousRunHours)}`));
  badges.push(badge(data.latest?._meta?.dataFresh ? "البيانات طازجة" : "البيانات غير طازجة", data.latest?._meta?.dataFresh ? "badge-ok" : "badge-manual"));
  if (data.provenance) badges.push(badge(`مصدر البيانات: ${data.provenance}`, "badge-info"));
  return badges;
}

function inventoryStatusOf(data) {
  const fromRun = data.latest?.inventory ?? null;
  const doc = data.inventory ?? null;
  if (fromRun?.ok === true || doc?._meta?.status === "ok") return "ok";
  if (fromRun?.error || doc?._meta?.status === "budget") return doc?._meta?.status === "budget" ? "budget" : "unavailable";
  return String(doc?._meta?.status ?? data.latest?.summary?.inventoryStatus ?? "missing");
}

function renderTopbar(data) {
  const summary = data.latest?.summary ?? {};
  const meta = data.latest?._meta ?? {};
  const inventoryUrls = finite(data.inventory?.url_count ?? (Array.isArray(data.inventory?.urls) ? data.inventory.urls.length : 0));
  const kpi = (label, value, extra = "") =>
    `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}${extra ? ` — ${esc(extra)}` : ""}</span></div>`;
  const kpis = [
    kpi("موضوعات", formatNumber(finite(summary.topics, data.topics.length)), "في topics-latest"),
    kpi("عناصر مطبّعة", formatNumber(finite(summary.normalizedItems)), `من ${formatNumber(finite(summary.rawItems))} خام`),
    kpi("مصادر مستدعاة", formatNumber(finite(summary.sourceCount)), `متعثرة: ${formatNumber(finite(summary.failedSources))}`),
    kpi("نوافذ ذهبية", formatNumber(data.goldenTopics.length), "تسارع موجب + تشبع أقل من 25%"),
    kpi("تنبؤات", formatNumber(data.forecastTopics.length), FORECAST_LABEL),
    kpi("جرد الموقع", formatNumber(inventoryUrls), `الحالة: ${inventoryStatusOf(data)}`),
  ].join("");
  const attested = data.time.source === "env" || data.time.source === "header";
  return `
  <header id="topbar" class="panel" data-run-number="${esc(formatNumber(data.run.number))}" data-run-total="${esc(formatNumber(data.run.totalRecorded))}" data-time-source="${esc(data.time.source ?? "")}" data-attested="${attested ? "true" : "false"}" data-absence-hours="${data.absenceHours === null ? "" : esc(formatNumber(data.absenceHours, 2))}" data-topics-count="${esc(formatNumber(data.topics.length))}" data-normalized-items="${esc(formatNumber(finite(summary.normalizedItems)))}" data-golden-count="${esc(formatNumber(data.goldenTopics.length))}" data-forecast-count="${esc(formatNumber(data.forecastTopics.length))}" data-source-count="${esc(formatNumber(data.sourceRows.length))}" data-inventory-urls="${esc(formatNumber(inventoryUrls))}">
    <h1>رادار صوت الحجاز — لوحة التشغيل (B4)</h1>
    <p class="muted small">صفحة واحدة مضمّنة بالكامل: CSS داخلي، صفر JavaScript، صفر موارد خارجية، وصفر وسوم ربط — كل العناوين نصّ معزول. تُفتح في عارض معزول بلا شبكة.</p>
    <p class="mono">${esc(data.time.line || `الزمن: ${data.time.iso ?? "—"} | مصدر=${data.time.source ?? "—"}`)}</p>
    <ul class="badges">${timeBadges(data).map((item) => `<li>${item}</li>`).join("")}</ul>
    <div class="kpis">${kpis}</div>
    <h4>تفاصيل التشغيل الموثق</h4>
    <table>
      <tbody>
        <tr><th>زمن التشغيل الموثق</th><td class="mono">${esc(data.time.iso ?? "—")}</td><th>مصدر الزمن</th><td>${esc(data.time.source ?? "—")}</td></tr>
        <tr><th>سجل التشغيل</th><td class="mono">${esc(data.run.path ?? "—")}</td><th>عدّاد الرادار</th><td class="num">${esc(formatNumber(data.run.counters))}</td></tr>
        <tr><th>التشغيل السابق</th><td class="mono">${esc(data.run.previousRunIso ?? "—")}</td><th>الفارق عنه</th><td class="num">${data.gapFromPreviousRunHours === null ? "أول تشغيل مسجّل" : esc(formatHours(data.gapFromPreviousRunHours))}</td></tr>
        <tr><th>زمن توليد اللوحة</th><td class="mono">${esc(data.generatedAt)}</td><th>مدة الغياب عن آخر تشغيل</th><td class="num">${data.absenceHours === null ? "—" : esc(formatHours(data.absenceHours))}</td></tr>
        <tr><th>القسم · النطاق · العمق</th><td>${esc(data.latest?.section ?? "—")} · ${esc(data.latest?.scope ?? "—")} · ${esc(data.latest?.depth ?? "—")}</td><th>حداثة البيانات</th><td>${meta?.dataFresh ? '<span class="status-ok">طازجة (عناصر جديدة)</span>' : '<span class="status-warn">غير طازجة — لم تُضف عناصر جديدة</span>'}</td></tr>
        <tr><th>خط الأساس</th><td colspan="3">${esc(meta?.baselineLine ?? "—")}</td></tr>
        <tr><th>تنويه المحرك</th><td colspan="3">${esc(meta?.notes ?? "—")}</td></tr>
      </tbody>
    </table>
    ${attested ? "" : `<div class="note"><b>تنويه الزمن:</b> ${esc(data.time.note || "زمن غير موثق — يلزم حقلة يدوية عبر settime أو عودة الشبكة لتوثيق هيدر sawtalhijaz.com.")}</div>`}
  </header>`;
}

function scoreBlock(topic) {
  const metrics = topic?.metrics ?? {};
  const components = metrics?.components ?? {};
  const classification = classificationOf(topic);
  const row = (label, value) => `<tr><td>${esc(label)}</td><td class="num">${esc(formatNumber(value, 2))}</td></tr>`;
  return `
      <table class="small">
        <tbody>
          ${row("تسارع (وزن 0.40)", components.acceleration)}
          ${row("عكس التشبع (وزن 0.30)", components.inverseSaturation)}
          ${row("صلة القسم (وزن 0.15)", components.deskRelevance)}
          ${row("موثوقية المصادر (وزن 0.15)", components.sourceReliability)}
          ${row("المجموع = درجة الفرصة", metrics.score ?? topic?.score)}
        </tbody>
      </table>
      <p class="muted small mono">${esc(metrics.formula ?? "0.40*accelerationScore + 0.30*(100-saturationPercent) + 0.15*deskRelevance + 0.15*sourceReliability")}</p>
      <p class="small">التصنيف: ${badge(classification.council, classification.className)} <span class="muted">(تسمية المحرك: ${esc(classification.engine)} · المفتاح: ${esc(classification.key)})</span></p>`;
}

function renderTopicCard(topic, { highlighted = false } = {}) {
  const metrics = topic?.metrics ?? {};
  const burst = topic?.burst ?? {};
  const classification = classificationOf(topic);
  const saturation = finite(metrics.saturationPercent ?? topic?.saturation);
  const members = Array.isArray(topic?.members) ? topic.members : [];
  const shownMembers = members.slice(0, MEMBERS_PER_CARD);
  const covered = Array.isArray(metrics.coverageSources) ? metrics.coverageSources : [];
  const sources = Array.isArray(topic?.sources) ? topic.sources : [];
  return `
    <article class="card ${classification.className}" data-topic-id="${esc(topic?.id ?? "")}" data-desk="${esc(topic?.deskGuess ?? "")}" data-score="${esc(formatNumber(topic?.score))}" data-saturation="${esc(formatNumber(saturation, 2))}" data-classification="${esc(classification.key)}" data-count="${esc(formatNumber(topic?.currentCount ?? topic?.count))}" data-total-observations="${esc(formatNumber(topic?.totalObservations))}" data-first-seen="${esc(topic?.firstSeen ?? "")}" data-last-seen="${esc(topic?.lastSeen ?? "")}" data-forecast="${esc(burst?.forecast ?? "")}" data-zscore="${esc(formatNumber(burst?.zScore))}" data-speed="${esc(formatNumber(metrics.speedPerHour ?? topic?.speed))}" data-acceleration="${esc(formatNumber(metrics.accelerationPerHour ?? topic?.acceleration))}">
      <div class="card-top">
        <h3>${esc(topic?.title ?? "(بلا عنوان)")}</h3>
        <div class="score">${esc(formatNumber(topic?.score, 2))}<small>درجة الفرصة / 100</small></div>
      </div>
      <p class="small">${badge(`القسم: ${topic?.deskGuess ?? "غير مصنف"}`)}${badge(`التصنيف: ${classification.council}`, classification.className)}${highlighted ? badge("نافذة ذهبية مميزة", "badge-info") : ""}</p>
      <h4>مكونات الدرجة</h4>
      ${scoreBlock(topic)}
      <h4>التشبع</h4>
      <p class="small">${esc(formatNumber(saturation, 2))}% — ${esc(formatNumber(metrics.saturationNumerator, 2))} ÷ ${esc(formatNumber(metrics.saturationDenominator, 2))} من أوزان المصادر اليومية
        <span class="bar"><i class="${classification.key}" style="width:${esc(formatNumber(clamp(saturation, 0, 100), 2))}%"></i></span>
      </p>
      <p class="small muted">المصادر المغطية (${formatNumber(covered.length)}/${formatNumber(metrics.trackedSourceCount)}): ${(covered.length ? covered : ["—"]).map((id) => `<span class="tag">${esc(id)}</span>`).join("")}</p>
      <h4>عدد التغطيات والزمن</h4>
      <table class="small">
        <tbody>
          <tr><th>عدد التغطيات الحالية</th><td class="num">${esc(formatNumber(topic?.currentCount ?? topic?.count))}</td><th>إجمالي المشاهدات</th><td class="num">${esc(formatNumber(topic?.totalObservations))}</td></tr>
          <tr><th>أول ظهور</th><td class="mono">${esc(topic?.firstSeen ?? "—")}</td><th>آخر ظهور</th><td class="mono">${esc(topic?.lastSeen ?? "—")}</td></tr>
          <tr><th>السرعة</th><td class="num">${esc(formatNumber(metrics.speedPerHour ?? topic?.speed))}/س</td><th>التسارع</th><td class="num">${esc(formatNumber(metrics.accelerationPerHour ?? topic?.acceleration))}/س²</td></tr>
          <tr><th>Z-score</th><td class="num">${esc(formatNumber(burst?.zScore))}</td><th>عيّنات التاريخ</th><td class="num">${esc(formatNumber(burst?.historicalSampleCount))}</td></tr>
          <tr><th>إشارة burst</th><td class="num">${burst?.burstSignal ? '<span class="status-ok">نعم</span>' : '<span class="muted">لا</span>'}</td><th>التنبؤ</th><td class="num">${esc(burst?.forecast ?? "—")}</td></tr>
          <tr><th>المصادر</th><td colspan="3">${(sources.length ? sources : ["—"]).map((id) => `<span class="tag">${esc(id)}</span>`).join("")}</td></tr>
        </tbody>
      </table>
      ${
        shownMembers.length
          ? `<h4>عناصر التغطية (${formatNumber(members.length)}${members.length > shownMembers.length ? ` — المعروض ${formatNumber(shownMembers.length)}` : ""})</h4>
      <ul class="tight small">${shownMembers
        .map(
          (item) =>
            `<li><span class="tag">${esc(item?.source ?? "—")}</span> ${esc(item?.title ?? "(بلا عنوان)")}<br><span class="muted mono">${esc(item?.url || "—")}</span>${item?.publishedAt ? ` <span class="muted">· نشر: ${esc(item.publishedAt)}</span>` : ""}</li>`
        )
        .join("")}</ul>`
          : ""
      }
    </article>`;
}

function renderGoldenWindows(data) {
  const body = data.goldenTopics.length
    ? `<div class="grid">${data.goldenTopics.map((topic) => renderTopicCard(topic, { highlighted: true })).join("")}</div>`
    : `<div class="empty">لا توجد نافذة ذهبية في هذا التشغيل: يلزم تسارع موجب وتشبع أقل من 25%. عدد الموضوعات المفحوصة: ${data.topics.length}. التصنيف مستقل عن OpportunityScore الذي يُستخدم للترتيب فقط؛ لا تُصنَّع بطاقات غير موجودة في البيانات.</div>`;
  return `
  <section id="golden-windows" data-count="${esc(formatNumber(data.goldenTopics.length))}">
    <div class="panel">
      <h2>2) نوافذ ذهبية مميزة</h2>
      <p class="muted small">تُعرض أعلى الصفحة بحسب مواصفة B4. العدد: <b data-golden-count="${esc(formatNumber(data.goldenTopics.length))}">${data.goldenTopics.length}</b> من ${data.topics.length} موضوعاً (المفتاح: <span class="mono">golden</span> · تسمية المجلس: «نافذة ذهبية»).</p>
      ${body}
    </div>
  </section>`;
}

function renderOpportunities(data) {
  return `
  <section id="todays-opportunities" data-count="${esc(formatNumber(data.topics.length))}">
    <div class="panel">
      <h2>3) فرص اليوم</h2>
      <p class="muted small">بطاقات مرتبة بدرجة الفرصة بالترتيب المحفوظ في <span class="mono">state/topics-latest.json</span> (ترتيب محرك B3: الدرجة تنازلياً، ثم عدد التغطيات، ثم العنوان). العدد: <b data-topics-count="${esc(formatNumber(data.topics.length))}">${data.topics.length}</b>. كل بطاقة: الاسم، القسم، الدرجة بمكوناتها، التشبع %، التصنيف بلونه، عدد التغطيات، أول/آخر ظهور.</p>
      ${data.topics.length ? `<div class="grid">${data.topics.map((topic) => renderTopicCard(topic)).join("")}</div>` : '<div class="empty">لا موضوعات في آخر تشغيل B3 — لا تُعرض بطاقات (لا بيانات مصنّعة).</div>'}
    </div>
  </section>`;
}

function renderForecasts(data) {
  const rows = data.forecastTopics
    .map((topic) => {
      const expectation = computeForecastExpectation(topic, data.referenceIso);
      const verification = computePreviousVerification(topic);
      const criteria = topic?.burst?.forecastCriteria ?? {};
      const badgeClass = verification.key === "verified" ? "badge-ok" : verification.key === "not-verified" ? "badge-strong" : "";
      return `
      <tr data-topic-id="${esc(topic.id)}" data-forecast="${esc(topic?.burst?.forecast ?? "")}" data-expected-iso="${esc(expectation.expectedIso ?? "")}" data-hours="${esc(formatNumber(expectation.hoursToRealize, 1))}" data-verification="${esc(verification.key)}">
        <td>${esc(topic.title)}<br><span class="muted small">القسم: ${esc(topic.deskGuess ?? "غير مصنف")} · التشبع ${esc(formatNumber(expectation.saturationPercent, 2))}%</span></td>
        <td class="num mono">${esc(expectation.expectedIso ?? "—")}</td>
        <td class="num">${esc(formatNumber(expectation.hoursToRealize, 1))} س<br><span class="muted small mono">${esc(expectation.rule)}</span></td>
        <td class="num">${esc(formatNumber(criteria.previousAcceleration, 2))} ← ${esc(formatNumber(criteria.currentAcceleration, 2))}</td>
        <td>${badge(verification.label, badgeClass)}<br><span class="muted small">${esc(verification.detail)}</span></td>
      </tr>`;
    })
    .join("");
  const notForecast = data.topics.filter((topic) => topic?.burst?.forecast !== FORECAST_LABEL);
  const blockedByRuns = notForecast.filter((topic) => topic?.burst?.forecastCriteria?.positiveAcrossTwoRuns !== true).length;
  const blockedBySaturation = notForecast.filter((topic) => topic?.burst?.forecastCriteria?.lowSaturation !== true).length;
  return `
  <section id="forecasts" data-count="${esc(formatNumber(data.forecastTopics.length))}">
    <div class="panel">
      <h2>4) تنبؤات «متوقع خلال ساعات»</h2>
      <p class="muted small">لا يصدر التنبؤ إلا بتسارع موجب في تشغيلين متتاليين وتشبع أقل من 50% (قاعدة B3 المتحفظة). ${esc(FORECAST_RULE_TEXT)}</p>
      ${
        data.forecastTopics.length
          ? `<table>
        <thead><tr><th>الموضوع</th><th class="num">موعد التحقق المتوقع</th><th class="num">بعد / القاعدة</th><th class="num">التسارع (سابق ← حالي)</th><th>حالة التحقق السابقة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
          : `<div class="empty">لا تنبؤات «${esc(FORECAST_LABEL)}» في هذا التشغيل: ${notForecast.length} موضوعاً بحالة «${esc(NO_FORECAST_LABEL)}» — منها ${blockedByRuns} بلا تسارع موجب في تشغيلين متتاليين، و${blockedBySaturation} بتشبع ≥ 50%. لا تُصنَّع تنبؤات غير موجودة في البيانات.</div>`
      }
    </div>
  </section>`;
}

function renderSourcesHealth(data) {
  const healthMeta = data.health?._meta ?? {};
  const healthy = data.sourceRows.filter((row) => row.healthStatus === "سليم").length;
  const cooling = data.sourceRows.filter((row) => row.cooling).length;
  const rows = data.sourceRows
    .map((row) => {
      const healthClass = row.healthStatus === "سليم" ? "status-ok" : ["فشل", "خطأ"].includes(row.healthStatus) ? "status-bad" : row.healthStatus === "تبريد" ? "status-warn" : "status-off";
      const cooldownCell = row.cooling
        ? `<span class="status-warn">تبريد حتى ${esc(row.blockedUntil ?? "—")}</span><br><span class="muted small">متبقٍ ${esc(formatNumber(row.coolingMinutesLeft))} د · مرحلة التراجع ${esc(formatNumber(row.backoffStage))}</span>`
        : row.backoffStage > 0
          ? `<span class="muted">بلا تبريد نشط · مرحلة التراجع ${esc(formatNumber(row.backoffStage))}</span>`
          : '<span class="muted">لا تبريد</span>';
      return `
      <tr data-source-id="${esc(row.sourceId)}" data-health="${esc(row.healthStatus)}" data-budget="${esc(formatNumber(row.budgetPerHour))}" data-used="${esc(formatNumber(row.requestsInWindow))}" data-remaining="${esc(formatNumber(row.remainingRequests))}" data-cooling="${row.cooling ? "true" : "false"}" data-enabled="${row.enabled ? "true" : "false"}" data-backoff-stage="${esc(formatNumber(row.backoffStage))}">
        <td><b>${esc(row.sourceId)}</b><br><span class="muted small">${esc(row.notes ?? "")}</span></td>
        <td class="${healthClass}">${esc(row.healthStatus)}${row.enabled ? "" : '<br><span class="muted small">معطل في الإعدادات</span>'}</td>
        <td class="num"><b>${esc(formatNumber(row.remainingRequests))}</b> / ${esc(formatNumber(row.budgetPerHour))}<br><span class="muted small">مستعملة في الساعة: ${esc(formatNumber(row.requestsInWindow))}</span></td>
        <td class="num">${cooldownCell}</td>
        <td class="num">${esc(row.runLabel ?? "—")}${row.runCount === null ? "" : `<br><span class="muted small">${esc(formatNumber(row.runCount))} عنصر · ${esc(formatNumber(row.runRequests))} طلب</span>`}${row.runError ? `<br><span class="muted small">${esc(row.runError)}</span>` : ""}</td>
        <td class="num small">${esc(formatNumber(row.requestsTotal))} طلب · ${esc(formatNumber(row.errorsTotal))} خطأ · ${esc(formatNumber(row.cacheHits))} كاش<br><span class="muted">آخر استدعاء: ${esc(row.lastInvocation ?? "—")}${row.lastResponseMs === null ? "" : ` · ${esc(formatNumber(row.lastResponseMs, 1))}ms`}</span>${row.lastError ? `<br><span class="status-bad small">${esc(row.lastError)}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return `
  <section id="sources-health" data-count="${esc(formatNumber(data.sourceRows.length))}" data-healthy="${esc(formatNumber(healthy))}" data-cooling="${esc(formatNumber(cooling))}">
    <div class="panel">
      <h2>5) حالة المصادر</h2>
      <p class="muted small">من <span class="mono">state/sources-health.json</span> (آخر تحديث: <span class="mono">${esc(healthMeta?.updated_at ?? healthMeta?.last_request_at ?? "—")}</span>) وميزانيات <span class="mono">config/sources.json</span>. المتبقي = ميزانية الساعة − الطلبات داخل الساعة المنتهية في زمن توليد اللوحة (<span class="mono">${esc(data.generatedAt)}</span>). المصادر: <b data-source-count="${esc(formatNumber(data.sourceRows.length))}">${data.sourceRows.length}</b> · سليمة: ${healthy} · تحت التبريد: ${cooling}.</p>
      ${data.sourceRows.length ? `<table>
        <thead><tr><th>المصدر</th><th>الصحة</th><th class="num">الطلبات المتبقية من الميزانية</th><th>التبريد/التراجع</th><th class="num">في آخر تشغيل B3</th><th class="num">الإجماليات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div class="empty">لا سجلات مصادر في state/sources-health.json ولا مصادر في config/sources.json.</div>'}
    </div>
  </section>`;
}

function renderInternalLinks(data) {
  const inventory = data.inventory;
  const meta = inventory?._meta ?? {};
  const status = String(meta?.status ?? (inventory ? "unknown" : "missing"));
  const urlCount = finite(inventory?.url_count ?? (Array.isArray(inventory?.urls) ? inventory.urls.length : 0));
  const links = data.inventoryLinks;
  const rows = links
    .map(
      (link) => `
      <tr data-topic-id="${esc(link.topicId)}" data-inventory-index="${esc(formatNumber(link.inventoryIndex))}" data-link-score="${esc(formatNumber(link.score))}">
        <td>${esc(link.topicTitle)}<br><span class="muted small">القسم: ${esc(link.desk ?? "غير مصنف")}</span></td>
        <td class="mono small">${esc(link.url)}</td>
        <td class="num">${esc(link.type)}${link.section ? `<br><span class="muted small">${esc(link.section)}</span>` : ""}${link.tag ? `<br><span class="muted small">وسم: ${esc(link.tag)}</span>` : ""}${link.author ? `<br><span class="muted small">كاتب: ${esc(link.author)}</span>` : ""}</td>
        <td class="num mono small">${esc(link.lastModified ?? "—")}</td>
        <td class="small">${link.sharedKeywords.length ? link.sharedKeywords.map((token) => `<span class="tag">${esc(token)}</span>`).join("") : '<span class="muted">—</span>'}${link.sectionMatch ? '<br><span class="muted small">تطابق قسم</span>' : ""}</td>
      </tr>`
    )
    .join("");
  const emptyReason =
    urlCount === 0
      ? `الجرد فارغ (الحالة: ${esc(status)}) — ${esc(String(meta?.notes ?? "يتطلب جلب sitemap حياً من sawtalhijaz.com ضمن ميزانية طلبين في الساعة."))}${meta?.last_error ? ` آخر خطأ: ${esc(String(meta.last_error))}` : ""}`
      : `لا تقاطع كلمات بين عناوين الموضوعات ومسارات الجرد في هذا التشغيل (عناوين الجرد: ${esc(formatNumber(urlCount))}).`;
  return `
  <section id="internal-links" data-count="${esc(formatNumber(links.length))}" data-inventory-status="${esc(status)}" data-inventory-urls="${esc(formatNumber(urlCount))}">
    <div class="panel">
      <h2>6) الذيل — مواضعنا ذات الصلة (ربط داخلي مقترح)</h2>
      <p class="muted small">من <span class="mono">state/inventory.json</span>: حالة الجرد <b>${esc(status)}</b> · عناوين: ${esc(formatNumber(urlCount))} · أقسام: ${esc(formatNumber(Array.isArray(inventory?.sections) ? inventory.sections.length : 0))} · وسوم: ${esc(formatNumber(Array.isArray(inventory?.tags) ? inventory.tags.length : 0))} · كتّاب: ${esc(formatNumber(Array.isArray(inventory?.authors) ? inventory.authors.length : 0))} · آخر جلب: <span class="mono">${esc(inventory?.fetched_at ?? "—")}</span>. الاقتراحات نصّية (لا وسم ربط) وتُراجع تحريرياً قبل أي نشر.</p>
      ${
        links.length
          ? `<table>
        <thead><tr><th>موضوع الرادار</th><th>الموضع المقترح من موقعنا</th><th class="num">النوع/القسم</th><th class="num">آخر تعديل</th><th>سبب الاقتراح</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
          : `<div class="empty">لا ربط داخلي مقترح: ${emptyReason}</div>`
      }
      ${meta?.notes ? `<p class="muted small">ملاحظة الجرد: ${esc(String(meta.notes))}</p>` : ""}
    </div>
  </section>`;
}

function renderFooter(data) {
  const files = ["state/topics-latest.json", "state/sources-health.json", "state/inventory.json", "config/sources.json", "state/radar.json", "state/runs/"];
  return `
  <footer id="dashboard-footer">
    <p>مُولّدة بواسطة <b>engine/dashboard.js</b> (حزمة B4) في <span class="mono">${esc(data.generatedAt)}</span> من: ${files.map((file) => `<span class="tag mono">${esc(file)}</span>`).join("")}${data.provenance ? ` · مصدر البيانات: <b>${esc(data.provenance)}</b>` : ""}.</p>
    <p>الأقسام الست: ${DASHBOARD_SECTIONS.map((section) => `${section.index}) ${esc(section.label)}`).join(" · ")}.</p>
    <p>اكتفاء ذاتي: CSS مضمّن في وسم واحد، صفر JavaScript، صفر وسوم ربط أو موارد خارجية (لا وسم ربط ولا link ولا script ولا img ولا iframe، ولا خواص تحميل خارجية، ولا استيراد خطوط أو أنماط من الخارج) — كل العناوين نصّ معزول للاتجاه. المقاييس والتصنيفات والتنبؤات اقتراحات تحليلية من محرك B3 ولا تنشر تلقائياً.</p>
  </footer>`;
}

// —— العارض النقي: بيانات ← HTML (بلا أي دخول على الشبكة أو على الملفات) ——
export function renderDashboardHtml(data) {
  if (!data?.latest) throw new Error("renderDashboardHtml: بيانات topics-latest مطلوبة");
  const title = `رادار صوت الحجاز — ${data.time.iso ?? data.generatedAt}`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="sawtalhijaz-newsroom engine/dashboard.js (B4)">
<meta name="document-time" content="${esc(data.time.iso ?? "")}">
<meta name="time-source" content="${esc(data.time.source ?? "")}">
<meta name="run-number" content="${esc(formatNumber(data.run?.number ?? 0))}">
<meta name="data-provenance" content="${esc(data.provenance ?? "state/topics-latest.json")}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'">
<title>${esc(title)}</title>
<style>${EMBEDDED_CSS}</style>
</head>
<body>
<div class="wrap">
${renderTopbar(data)}
${renderGoldenWindows(data)}
${renderOpportunities(data)}
${renderForecasts(data)}
${renderSourcesHealth(data)}
${renderInternalLinks(data)}
${renderFooter(data)}
</div>
</body>
</html>
`;
}

// —— التوليد والكتابة الذرية ——
export async function generateDashboard({
  root = process.cwd(),
  out = null,
  generatedAt = new Date().toISOString(),
  provenance = null,
  data = null,
  record = false,
  net = false,
} = {}) {
  const store = createStore(root);
  const collected = data ?? collectDashboardData({ root, generatedAt, provenance });
  const html = renderDashboardHtml(collected);
  const violations = findExternalReferences(html);
  if (violations.length) {
    throw new Error(`اللوحة ليست مكتفية ذاتياً — ${violations.length} مخالفة: ${violations.slice(0, 5).join(" | ")}`);
  }
  const rel = out ?? dashboardOutputPath(collected.time.iso ?? generatedAt);
  const io = store.writeTextAtomic(rel, html);
  let run = null;
  if (record) {
    const time = await nowDoc({ net, root });
    run = store.recordRun({
      kind: "B4-dashboard",
      actor: null,
      iso: time.iso,
      source: time.source,
      summary: `B4 dashboard: ${rel} (${io.bytes} بايت) من بيانات ${collected.time.iso ?? "—"} (مصدر الزمن ${collected.time.source ?? "—"}) — مواضيع ${collected.topics.length} · ذهب ${collected.goldenTopics.length} · تنبؤات ${collected.forecastTopics.length} · مصادر ${collected.sourceRows.length} · ربط ${collected.inventoryLinks.length}`,
      next: "مراجعة النوافذ الذهبية والربط الداخلي المقترح تحريرياً.",
      pending: [],
      startedAt: generatedAt,
      endedAt: new Date().toISOString(),
      extra: {
        file: rel,
        bytes: io.bytes,
        provenance: provenance ?? null,
        dataTimeIso: collected.time.iso ?? null,
        dataTimeSource: collected.time.source ?? null,
        sections: DASHBOARD_SECTIONS.map((section) => section.id),
        externalReferences: violations,
      },
    });
  }
  return { ok: true, rel, path: store.abs(rel), bytes: io.bytes, ms: io.ms, html, violations, data: collected, run };
}

// توليد لوحة من بيانات B3 معزولة (fixtures) — عند انقطاع الشبكة، مع وسم مصدر البيانات صراحة في الشريط العلوي.
export async function generateFixtureDashboard({
  root = process.cwd(),
  out = null,
  generatedAt = new Date().toISOString(),
  provenance = "fixtures B3 معزولة (بوابة حتمية — بلا شبكة)",
  record = false,
} = {}) {
  const { withB3FixtureRadar } = await import("./radar-selftest.js");
  return withB3FixtureRadar(root, async ({ sandbox, radar }) => {
    const data = collectDashboardData({ root: sandbox, generatedAt, provenance });
    const result = await generateDashboard({ root, out: out ?? dashboardOutputPath(data.time.iso), generatedAt, provenance, data, record });
    return { ...result, radarSummary: radar.summary, sandboxTopics: radar.topics.length };
  });
}

// —— فحص اللوحة (تستعمله بوابة B4 وأمر CLI) ——
export function sectionHtml(html, id) {
  const text = String(html ?? "");
  const marker = `id="${id}"`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const openTagStart = text.lastIndexOf("<", start);
  const closing = id === "topbar" ? "</header>" : "</section>";
  const end = text.indexOf(closing, start);
  if (end < 0) return null;
  return text.slice(openTagStart < 0 ? start : openTagStart, end + closing.length);
}

export function inspectDashboard(html, data = null) {
  const text = String(html ?? "");
  const sections = DASHBOARD_SECTIONS.map((section) => {
    const fragment = sectionHtml(text, section.id);
    return {
      id: section.id,
      index: section.index,
      label: section.label,
      present: fragment !== null,
      cards: fragment ? (fragment.match(/<article class="card /giu) ?? []).length : 0,
      rows: fragment ? (fragment.match(/<tr data-/giu) ?? []).length : 0,
      bytes: fragment ? Buffer.byteLength(fragment, "utf8") : 0,
    };
  });
  const tags = text.match(TAG_PATTERN) ?? [];
  const byId = (id) => sections.find((section) => section.id === id) ?? null;
  const inspection = {
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.split("\n").length,
    rtl: /<html[^>]*\bdir="rtl"/iu.test(text),
    langAr: /<html[^>]*\blang="ar"/iu.test(text),
    inlineStyleBlocks: (text.match(/<style\b/giu) ?? []).length,
    scriptTags: (text.match(/<script\b/giu) ?? []).length,
    linkTags: (text.match(/<link\b/giu) ?? []).length,
    imgTags: (text.match(/<img\b/giu) ?? []).length,
    iframeTags: (text.match(/<iframe\b/giu) ?? []).length,
    anchors: (text.match(/<a\b/giu) ?? []).length,
    externalAttributesInTags: tags.filter((tag) => FORBIDDEN_ATTRIBUTE.test(tag)).length,
    externalUrlsInTags: tags.filter((tag) => /\bhttps?:\/\//iu.test(tag)).length,
    urlsAsInertText: (text.match(URL_IN_TEXT_PATTERN) ?? []).length,
    externalReferences: findExternalReferences(text),
    sections,
    sectionsPresent: sections.every((section) => section.present),
    opportunityCards: byId("todays-opportunities")?.cards ?? 0,
    goldenCards: byId("golden-windows")?.cards ?? 0,
    forecastRows: byId("forecasts")?.rows ?? 0,
    sourceRows: byId("sources-health")?.rows ?? 0,
    internalLinkRows: byId("internal-links")?.rows ?? 0,
  };
  inspection.selfContained =
    inspection.externalReferences.length === 0 &&
    inspection.anchors === 0 &&
    inspection.scriptTags === 0 &&
    inspection.linkTags === 0 &&
    inspection.imgTags === 0 &&
    inspection.iframeTags === 0 &&
    inspection.externalAttributesInTags === 0 &&
    inspection.externalUrlsInTags === 0 &&
    inspection.inlineStyleBlocks === 1;
  if (data) {
    inspection.topicsInData = data.topics.length;
    inspection.cardsMatchTopics = inspection.opportunityCards === data.topics.length;
    inspection.goldenMatchData = inspection.goldenCards === data.goldenTopics.length;
    inspection.forecastsMatchData = inspection.forecastRows === data.forecastTopics.length;
    inspection.sourcesMatchData = inspection.sourceRows === data.sourceRows.length;
    inspection.linksMatchData = inspection.internalLinkRows === data.inventoryLinks.length;
    inspection.numbersMatch = data.topics.every((topic) => {
      const classification = classificationOf(topic);
      const saturation = finite(topic?.metrics?.saturationPercent ?? topic?.saturation);
      return (
        text.includes(`data-topic-id="${escapeHtml(topic.id)}"`) &&
        text.includes(`data-score="${escapeHtml(formatNumber(topic.score))}"`) &&
        text.includes(`data-saturation="${escapeHtml(formatNumber(saturation, 2))}"`) &&
        text.includes(`data-classification="${classification.key}"`) &&
        text.includes(`data-count="${escapeHtml(formatNumber(topic.currentCount ?? topic.count))}"`) &&
        text.includes(escapeHtml(topic.title)) &&
        text.includes(classification.council)
      );
    });
    inspection.everyNumberTraceable = inspection.cardsMatchTopics && inspection.numbersMatch && inspection.goldenMatchData && inspection.forecastsMatchData && inspection.sourcesMatchData && inspection.linksMatchData;
  }
  return inspection;
}

// —— واجهة سطر الأوامر (بوابة B4 الحتمية: node engine/dashboard-selftest.js أو cli dashboard --fixtures) ——
const USAGE = `الاستخدام:
  node engine/dashboard.js                        توليد out/radar-<طابع زمني موثق>.html من state/topics-latest.json
  node engine/dashboard.js --root <dir>           قراءة state/ من مسار آخر
  node engine/dashboard.js --out <file.html>      تحديد مسار الخرج
  node engine/dashboard.js --provenance "…"       وسم مصدر البيانات في الشريط العلوي
  node engine/dashboard.js --print [N]            طباعة أول N سطر من HTML (افتراضي 30)
  node engine/dashboard.js --inspect              طباعة فحص الأقسام الست والاكتفاء الذاتي
  node engine/dashboard.js --record               تسجيل تشغيل B4-dashboard في state/runs/
  بوابة B4 الحتمية (fixtures معزولة): node engine/dashboard-selftest.js أو node engine/cli.js dashboard --fixtures`;

function option(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = option(args, "--root", process.cwd());
  const generatedAt = new Date().toISOString();
  let result;
  try {
    result = await generateDashboard({
      root,
      out: option(args, "--out", null),
      generatedAt,
      provenance: option(args, "--provenance", null),
      record: args.includes("--record"),
      net: !args.includes("--offline"),
    });
  } catch (error) {
    console.error(`فشل توليد اللوحة: ${error?.message ?? error}`);
    if (!args.length) console.error(`\n${USAGE}`);
    process.exit(1);
  }
  const inspection = inspectDashboard(result.html, result.data);
  console.log(`اللوحة: ${result.rel} (${result.bytes} بايت، ${result.ms}ms، كتابة ذرية)`);
  console.log(`${result.data.time.line || result.data.time.iso} | رقم التشغيل #${result.data.run.number}/${result.data.run.totalRecorded} | الغياب ${result.data.absenceHours === null ? "—" : formatHours(result.data.absenceHours)}`);
  console.log(`الأقسام الست حاضرة: ${inspection.sectionsPresent ? "نعم" : "لا"} | مكتفية ذاتياً: ${inspection.selfContained ? "نعم" : "لا"} | مراجع خارجية: ${inspection.externalReferences.length} | وسوم <a>: ${inspection.anchors} | src/href في الوسوم: ${inspection.externalAttributesInTags} | <style>: ${inspection.inlineStyleBlocks} | <script>: ${inspection.scriptTags}`);
  console.log(`بطاقات فرص اليوم: ${inspection.opportunityCards}/${result.data.topics.length} | نوافذ ذهبية: ${inspection.goldenCards}/${result.data.goldenTopics.length} | تنبؤات: ${inspection.forecastRows}/${result.data.forecastTopics.length} | صفوف المصادر: ${inspection.sourceRows}/${result.data.sourceRows.length} | ربط داخلي: ${inspection.internalLinkRows}/${result.data.inventoryLinks.length}`);
  console.log(`الأرقام مطابقة لـtopics-latest: ${inspection.everyNumberTraceable ? "نعم" : "لا"}`);
  if (args.includes("--inspect")) console.log(JSON.stringify(inspection, null, 2));
  const printIndex = args.indexOf("--print");
  if (printIndex >= 0) {
    const requested = Number(args[printIndex + 1]);
    const count = args[printIndex + 1] && !String(args[printIndex + 1]).startsWith("--") && Number.isFinite(requested) && requested > 0 ? requested : 30;
    console.log(`— أول ${count} سطراً من ${result.rel} —`);
    for (const line of result.html.split("\n").slice(0, count)) console.log(line);
  }
  if (result.run) console.log(`سجل التشغيل: ${result.run.rel}`);
  process.exit(0);
}
