// engine/dashboard-selftest.js — بوابة B4 الحتمية (مولد الداشبورد).
//
// النمط المعتمد بقرار المجلس (2026-09-27): بوابة حتمية بحقن الشبكة/البيانات، تُثبت السلوك داخل الاختبار
// ولا تعتمد على اتصال حي. البيانات الحقيقية للرادار تُجلب عبر بوابة fixtures B3 المعزولة (حقن كل ردود HTTP)،
// وتُضاف وثائق مصنّعة مشتقة من دوال المحرك نفسها لإثبات مسارات: نافذة ذهبية، تنبؤ «متوقع خلال ساعات»،
// حالة تحقق سابقة، تبريد مصدر، زمن غير موثق، وجرد فارغ.
// لا كتابة على state الحقيقي — كل المخرجات داخل مسار مؤقت يُحذف في النهاية.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withB3FixtureRadar } from "./radar-selftest.js";
import { calculateTopicMetrics } from "./metrics.js";
import { computeBurst } from "./burst.js";
import { normalizeItem } from "./normalizer.js";
import { timeLine } from "./time.js";
import {
  CLASSIFICATION_LABELS,
  DASHBOARD_SECTIONS,
  FORECAST_LABEL,
  buildDashboardPayload,
  collectDashboardData,
  computeForecastExpectation,
  computePreviousVerification,
  dashboardFileName,
  findExternalReferences,
  generateDashboard,
  inspectDashboard,
  renderDashboardHtml,
  sectionHtml,
} from "./dashboard.js";

const GENERATED_AT = "2026-09-28T09:00:00.000Z"; // زمن توليد ثابت → حتمية البايت
const RUN_ISO = "2026-09-27T12:00:00.000Z"; // زمن تشغيل fixtures B3 الموثق

function check(log, checks, name, fn, details = "") {
  try {
    const result = fn();
    checks[name] = result !== false;
    log(`${name}=${checks[name] ? "✓" : "✗"}${details ? ` | ${details}` : ""}`);
  } catch (error) {
    checks[name] = false;
    log(`${name}=✗ | ${error?.message ?? error}`);
  }
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function tagAttributes(fragment) {
  const attributes = new Map();
  for (const match of String(fragment).matchAll(/<[^>]*\bdata-[a-z-]+="[^"]*"[^>]*>/giu)) {
    const tag = match[0];
    const id = /data-topic-id="([^"]*)"/u.exec(tag)?.[1] ?? /data-source-id="([^"]*)"/u.exec(tag)?.[1] ?? null;
    if (!id) continue;
    const entry = {};
    for (const pair of tag.matchAll(/data-([a-z-]+)="([^"]*)"/giu)) entry[pair[1]] = pair[2];
    attributes.set(id, entry);
  }
  return attributes;
}

// موضوع كامل (مقاييس + burst) مبني من دوال المحرك نفسها — لا أرقام مصنّعة يدوياً.
function withBurst(cluster, metrics, { previousTopic = null, history = [] }) {
  const topic = {
    ...cluster,
    speed: metrics.speedPerHour,
    acceleration: metrics.accelerationPerHour,
    saturation: metrics.saturationPercent,
    score: metrics.score,
    classification: metrics.classification,
    metrics,
  };
  return { ...topic, burst: computeBurst(topic, { root: process.cwd(), previousTopic, history, pytrends: false }) };
}

// وثيقة topics-latest مصنّعة مشتقة من دوال المحرك (لا أرقام مكتوبة يدوياً).
function buildCraftedLatest({ base, sourceConfig, timeSource }) {
  const tracked = Object.entries(sourceConfig)
    .filter(([, source]) => source?.enabled === true && source?.daily_enabled !== false && Number(source?.weight) > 0)
    .map(([id]) => id);
  const previousRunIso = "2026-09-27T10:00:00.000Z";
  const member = normalizeItem(
    { title: "موضوع البوابة: تغطية موسعة", link: "https://news.example/gate-item", pubDate: "2026-09-27T11:30:00.000Z" },
    { sourceId: "gnews", sourceWeight: 0.9, fetchedAt: RUN_ISO, desks: { desks: [{ section: "قرارات-أحداث" }] } }
  );

  // (أ) نافذة ذهبية: تشبع كامل + صلة قسم ضعيفة + تسارع شديد الانخفاض ← درجة < 25 بحسب معادلة B3.
  const goldenCluster = {
    id: "topic-golden-gate",
    title: "بوابة B4: موضوع ذهبي مصنّع بتشبع كامل وتراجع حاد",
    firstSeen: previousRunIso,
    lastSeen: RUN_ISO,
    count: 1,
    currentCount: 1,
    totalObservations: 22,
    sources: [...tracked],
    deskGuess: "روشن-الرياضية",
    sharedKeywords: ["بوابة"],
    memberIds: [member.id],
    members: [member],
  };
  const goldenMetrics = calculateTopicMetrics(goldenCluster, {
    previousTopic: { currentCount: 21, metrics: { speedPerHour: 0 } },
    previousRunIso,
    nowIso: RUN_ISO,
    sourceConfig,
    requestedSection: "قرارات-أحداث",
  });
  const goldenTopic = withBurst(goldenCluster, goldenMetrics, { previousTopic: null, history: [3, 5, 21] });

  // (ب) تنبؤ «متوقع خلال ساعات» + تحقق سابق ناجح.
  const forecastCluster = {
    id: "topic-forecast-gate",
    title: "بوابة B4: موضوع متوقع خلال ساعات (تحقق سابقاً)",
    firstSeen: previousRunIso,
    lastSeen: RUN_ISO,
    count: 6,
    currentCount: 6,
    totalObservations: 8,
    sources: ["gnews"],
    deskGuess: "قرارات-أحداث",
    sharedKeywords: ["بوابة"],
    memberIds: [member.id],
    members: [member],
  };
  const forecastMetrics = calculateTopicMetrics(forecastCluster, {
    previousTopic: { currentCount: 2, metrics: { speedPerHour: 1, accelerationPerHour: 0.5 } },
    previousRunIso,
    nowIso: RUN_ISO,
    sourceConfig,
    requestedSection: "قرارات-أحداث",
  });
  const forecastTopic = withBurst(forecastCluster, forecastMetrics, { previousTopic: { metrics: { accelerationPerHour: 0.5 } }, history: [1, 2] });

  // (ج) تنبؤ «متوقع خلال ساعات» + تحقق سابق فاشل (العدّ لم يرتفع).
  const unverifiedCluster = { ...forecastCluster, id: "topic-forecast-unverified-gate", title: "بوابة B4: موضوع متوقع خلال ساعات (لم يتحقق سابقاً)", currentCount: 6, count: 6 };
  const unverifiedMetrics = calculateTopicMetrics(unverifiedCluster, {
    previousTopic: { currentCount: 2, metrics: { speedPerHour: 1, accelerationPerHour: 0.5 } },
    previousRunIso,
    nowIso: RUN_ISO,
    sourceConfig,
    requestedSection: "قرارات-أحداث",
  });
  const unverifiedTopic = withBurst(unverifiedCluster, unverifiedMetrics, { previousTopic: { metrics: { accelerationPerHour: 0.5 } }, history: [5, 6] });

  const time = { iso: RUN_ISO, source: timeSource, skewSeconds: 0, note: `بوابة B4 — زمن مصنّع (${timeSource})` };
  return {
    latest: {
      ...base,
      _meta: { ...base._meta, timeSource, dataFresh: true, success: true },
      time: { ...time, line: timeLine(time) },
      topics: [goldenTopic, forecastTopic, unverifiedTopic, ...base.topics],
      summary: { ...base.summary, topics: 3 + base.topics.length },
    },
    goldenTopic,
    forecastTopic,
    unverifiedTopic,
    goldenMetrics,
    forecastMetrics,
  };
}

function craftedHealth(base, { generatedAt }) {
  const health = structuredClone(base);
  const cooldownUntil = new Date(Date.parse(generatedAt) + 15 * 60000).toISOString();
  health.sources.gnews = {
    ...health.sources.gnews,
    status: "تبريد",
    blocked_until: cooldownUntil,
    backoff_stage: 1,
    requests: 4,
    errors: 1,
    invocations: 4,
    cache_hits: 1,
    last_invocation: new Date(Date.parse(generatedAt) - 5 * 60000).toISOString(),
    last_response_ms: 421.7,
    last_err: "HTTP 429 (too many requests)",
    request_times: [new Date(Date.parse(generatedAt) - 10 * 60000).toISOString(), new Date(Date.parse(generatedAt) - 5 * 60000).toISOString()],
  };
  health._meta.updated_at = generatedAt;
  health._meta.last_request_at = new Date(Date.parse(generatedAt) - 5 * 60000).toISOString();
  return { health, cooldownUntil };
}

export async function runDashboardGate({ root = process.cwd(), log = console.log } = {}) {
  const checks = {};
  log("== B4 DASHBOARD SELFTEST (isolated fixtures; no live network) ==");
  const details = {};
  try {
    await withB3FixtureRadar(root, async ({ sandbox, radar }) => {
      const latest = readJson(sandbox, "state/topics-latest.json");
      const health = readJson(sandbox, "state/sources-health.json");
      const inventory = readJson(sandbox, "state/inventory.json");
      const sourceDocument = readJson(sandbox, "config/sources.json");
      const sourceConfig = sourceDocument.sources;

      check(log, checks, "b4InputFromB3FixtureRadar", () => radar.ok === true && latest.topics.length === radar.topics.length && latest.topics.length > 0, `topics=${latest.topics.length}`);

      // (1) توليد من بيانات B3 المعزولة + كتابة ذرية في out/
      const payload = collectDashboardData({ root: sandbox, generatedAt: GENERATED_AT, provenance: "fixtures B3 معزولة (بوابة B4)" });
      const html = renderDashboardHtml(payload);
      const generated = await generateDashboard({ root: sandbox, generatedAt: GENERATED_AT, data: payload });
      const expectedRel = path.join("out", dashboardFileName(payload.time.iso));
      const written = fs.readFileSync(path.join(sandbox, generated.rel), "utf8");
      const leftovers = fs.readdirSync(path.join(sandbox, "out")).filter((name) => name.includes(".tmp-"));
      check(log, checks, "dashboardWrittenAtomicallyToOut", () =>
        generated.ok === true && generated.rel === expectedRel && generated.bytes === Buffer.byteLength(html, "utf8") &&
        written === html && leftovers.length === 0 && /radar-\d{4}-\d{2}-\d{2}T[\d-]+Z\.html$/u.test(generated.rel),
        `file=${generated.rel}; bytes=${generated.bytes}; ms=${generated.ms}`);

      // (2) صفحة واحدة RTL بأصول مضمّنة
      const inspection = inspectDashboard(html, payload);
      check(log, checks, "singleRtlPageWithInlineCss", () =>
        inspection.rtl && inspection.langAr && inspection.inlineStyleBlocks === 1 && inspection.scriptTags === 0 &&
        html.startsWith("<!doctype html>") && (html.match(/<\/html>/giu) ?? []).length === 1 && (html.match(/<body>/giu) ?? []).length === 1,
        `bytes=${inspection.bytes}; lines=${inspection.lines}`);

      // (3) لا روابط خارجية ولا موارد خارجية إطلاقاً
      const rawViolations = [
        ...findExternalReferences(html),
        ...(/<a\b/iu.test(html) ? ["anchor tag present"] : []),
        ...(/\s(?:href|src)\s*=/iu.test(html) ? ["href/src attribute present"] : []),
        ...((html.match(/<style\b[^>]*>[\s\S]*?<\/style>/giu) ?? []).some((block) => /@import|url\s*\(|@font-face/iu.test(block)) ? ["css external reference inside style block"] : []),
        ...((html.match(/<[^>]*>/gu) ?? []).filter((tag) => /https?:\/\//iu.test(tag)).map((tag) => `url inside tag: ${tag.slice(0, 80)}`)),
      ];
      check(log, checks, "noExternalLinksOrResources", () =>
        rawViolations.length === 0 && inspection.selfContained === true && inspection.anchors === 0 &&
        inspection.linkTags === 0 && inspection.imgTags === 0 && inspection.iframeTags === 0 &&
        inspection.externalAttributesInTags === 0 && inspection.externalUrlsInTags === 0 && inspection.urlsAsInertText > 0,
        `violations=${rawViolations.length}; urlsAsInertText=${inspection.urlsAsInertText}`);
      details.externalScan = { violations: rawViolations, urlsAsInertText: inspection.urlsAsInertText };

      // (4) الأقسام الست حاضرة
      const missing = DASHBOARD_SECTIONS.filter((section) => !inspection.sections.find((entry) => entry.id === section.id)?.present);
      check(log, checks, "sixSectionsPresent", () => missing.length === 0 && inspection.sectionsPresent === true,
        inspection.sections.map((section) => `${section.index}:${section.id}=${section.present ? "✓" : "✗"}`).join(" "));

      // (5) الأرقام مطابقة لـtopics-latest (بطاقة لكل موضوع، وقيم data-* مساوية للـJSON)
      const opportunityFragment = sectionHtml(html, "todays-opportunities") ?? "";
      const cardAttributes = tagAttributes(opportunityFragment);
      const perTopic = payload.topics.map((topic) => {
        const attributes = cardAttributes.get(topic.id);
        return {
          id: topic.id,
          present: Boolean(attributes),
          score: attributes?.score === String(topic.score),
          saturation: attributes?.saturation === String(Number(Number(topic.metrics.saturationPercent).toFixed(2))),
          classification: attributes?.classification === topic.metrics.classificationKey,
          count: attributes?.count === String(topic.currentCount),
          firstSeen: attributes?.["first-seen"] === topic.firstSeen,
          lastSeen: attributes?.["last-seen"] === topic.lastSeen,
          desk: attributes?.desk === (topic.deskGuess ?? ""),
          titleRendered: opportunityFragment.includes(topic.title),
          componentsRendered: Object.values(topic.metrics.components).every((value) => opportunityFragment.includes(String(Number(Number(value).toFixed(2))))),
        };
      });
      const broken = perTopic.filter((entry) => !Object.values(entry).every(Boolean));
      check(log, checks, "numbersMatchTopicsLatest", () =>
        broken.length === 0 && cardAttributes.size === payload.topics.length && inspection.opportunityCards === payload.topics.length &&
        inspection.numbersMatch === true && inspection.everyNumberTraceable === true,
        `cards=${inspection.opportunityCards}/${payload.topics.length}; broken=${broken.length}`);
      details.brokenTopics = broken;

      // (6) الترتيب بدرجة الفرصة كما في topics-latest
      const orderInHtml = [...opportunityFragment.matchAll(/data-topic-id="([^"]+)"/giu)].map((match) => match[1]);
      const scoresInHtml = [...opportunityFragment.matchAll(/data-score="([^"]+)"/giu)].map((match) => Number(match[1]));
      check(log, checks, "orderedByOpportunityScore", () =>
        orderInHtml.join("|") === payload.topics.map((topic) => topic.id).join("|") &&
        scoresInHtml.every((value, index) => index === 0 || scoresInHtml[index - 1] >= value) &&
        scoresInHtml.join("|") === payload.topics.map((topic) => topic.score).join("|"),
        `scores=${scoresInHtml.slice(0, 5).join(",")}…`);

      // (7) الشريط العلوي: الزمن الموثق بمصدره + رقم التشغيل + الغياب + بادج الزمن غير الموثق
      const topbar = sectionHtml(html, "topbar") ?? "";
      const runInfo = payload.run;
      const absenceHours = Number(((Date.parse(GENERATED_AT) - Date.parse(RUN_ISO)) / 3600000).toFixed(2));
      check(log, checks, "topbarTimeRunNumberAndAbsence", () =>
        topbar.includes(latest.time.line) && topbar.includes(`مصدر=${latest.time.source}`) &&
        topbar.includes(`data-run-number="${runInfo.number}"`) && topbar.includes(`data-run-total="${runInfo.totalRecorded}"`) &&
        runInfo.number === 1 && runInfo.totalRecorded === 1 && runInfo.path === latest._meta.runPath &&
        topbar.includes(`data-absence-hours="${absenceHours}"`) && topbar.includes("21 س") &&
        topbar.includes("زمن غير موثق") && topbar.includes('data-attested="false"') && topbar.includes("الطبقة اليدوية"),
        `run=#${runInfo.number}/${runInfo.totalRecorded}; absence=${absenceHours}h; source=${latest.time.source}`);

      // (8) النوافذ الذهبية: لا تُصنَّع إن لم توجد، وتُعرض أعلى الصفحة إن وُجدت
      const goldenFragment = sectionHtml(html, "golden-windows") ?? "";
      const goldenIndex = html.indexOf('id="golden-windows"');
      const opportunitiesIndex = html.indexOf('id="todays-opportunities"');
      const crafted = buildCraftedLatest({ base: latest, sourceConfig, timeSource: "unverified" });
      const craftedPayload = buildDashboardPayload({
        latest: crafted.latest,
        health,
        inventory,
        sourceDocument,
        run: { number: 2, totalRecorded: 2, path: latest._meta.runPath, previousRunIso: RUN_ISO, counters: 1, lastSummary: null },
        generatedAt: GENERATED_AT,
        provenance: "وثائق مصنّعة لبوابة B4",
      });
      const craftedHtml = renderDashboardHtml(craftedPayload);
      const craftedGolden = sectionHtml(craftedHtml, "golden-windows") ?? "";
      check(log, checks, "goldenWindowsHighlightedOnTop", () =>
        payload.goldenTopics.length === 0 && goldenFragment.includes("لا نوافذ ذهبية في هذا التشغيل") && !goldenFragment.includes("<article") &&
        goldenIndex > 0 && opportunitiesIndex > goldenIndex &&
        craftedPayload.goldenTopics.length === 1 && craftedGolden.includes(crafted.goldenTopic.title) &&
        craftedGolden.includes(CLASSIFICATION_LABELS.golden.council) && craftedGolden.includes('data-count="1"') &&
        crafted.goldenTopic.metrics.classificationKey === "golden" && craftedGolden.includes(`data-score="${crafted.goldenTopic.score}"`),
        `fixtureGolden=${payload.goldenTopics.length}; craftedGolden=${craftedPayload.goldenTopics.length}`);

      // (9) التنبؤات: موعد التحقق المتوقع + حالة التحقق السابقة
      const forecastFragment = sectionHtml(craftedHtml, "forecasts") ?? "";
      const expectedA = computeForecastExpectation(crafted.forecastTopic, craftedPayload.referenceIso);
      const expectedB = computeForecastExpectation(crafted.unverifiedTopic, craftedPayload.referenceIso);
      const verificationA = computePreviousVerification(crafted.forecastTopic);
      const verificationB = computePreviousVerification(crafted.unverifiedTopic);
      const fixtureForecastFragment = sectionHtml(html, "forecasts") ?? "";
      check(log, checks, "forecastExpectedTimeAndPreviousStatus", () =>
        crafted.forecastTopic.burst.forecast === FORECAST_LABEL && crafted.unverifiedTopic.burst.forecast === FORECAST_LABEL &&
        craftedPayload.forecastTopics.length === 2 && forecastFragment.includes(expectedA.expectedIso) && forecastFragment.includes(expectedB.expectedIso) &&
        forecastFragment.includes(`${expectedA.hoursToRealize} س`) && forecastFragment.includes(verificationA.label) && forecastFragment.includes(verificationB.label) &&
        verificationA.key === "verified" && verificationB.key === "not-verified" &&
        forecastFragment.includes(`data-verification="${verificationA.key}"`) && forecastFragment.includes(`data-verification="${verificationB.key}"`) &&
        !forecastFragment.includes(crafted.goldenTopic.id) &&
        payload.forecastTopics.length === 0 && fixtureForecastFragment.includes(`لا تنبؤات «${FORECAST_LABEL}»`),
        `expectedA=${expectedA.expectedIso} (+${expectedA.hoursToRealize}h, ${verificationA.label}); expectedB=${expectedB.expectedIso} (${verificationB.label})`);
      details.forecast = { expectedA, verificationA, expectedB, verificationB };

      // (10) حالة المصادر: الصحة + المتبقي من الميزانية + التبريد
      const { health: cooledHealth, cooldownUntil } = craftedHealth(health, { generatedAt: GENERATED_AT });
      const cooledPayload = buildDashboardPayload({ latest, health: cooledHealth, inventory, sourceDocument, run: payload.run, generatedAt: GENERATED_AT, provenance: "بوابة B4 — صحة مصنّعة" });
      const cooledHtml = renderDashboardHtml(cooledPayload);
      const sourcesFragment = sectionHtml(cooledHtml, "sources-health") ?? "";
      const gnewsRow = cooledPayload.sourceRows.find((row) => row.sourceId === "gnews");
      const trendsRow = cooledPayload.sourceRows.find((row) => row.sourceId === "trends-rss");
      const sourceAttributes = tagAttributes(sourcesFragment);
      check(log, checks, "sourcesHealthBudgetAndCooldown", () =>
        cooledPayload.sourceRows.length === Object.keys(sourceConfig).length &&
        sourceAttributes.size === cooledPayload.sourceRows.length &&
        gnewsRow.remainingRequests === sourceConfig.gnews.rate_limit_per_hour - 2 && gnewsRow.cooling === true &&
        gnewsRow.coolingMinutesLeft === 15 && sourcesFragment.includes(`تبريد حتى ${cooldownUntil}`) &&
        sourceAttributes.get("gnews")?.remaining === String(gnewsRow.remainingRequests) &&
        sourceAttributes.get("gnews")?.cooling === "true" && sourceAttributes.get("gnews")?.health === "تبريد" &&
        trendsRow.cooling === false && sourcesFragment.includes("HTTP 429 (too many requests)") &&
        cooledPayload.sourceRows.every((row) => sourceAttributes.get(row.sourceId)?.budget === String(row.budgetPerHour)),
        `sources=${cooledPayload.sourceRows.length}; gnews remaining=${gnewsRow.remainingRequests}/${gnewsRow.budgetPerHour}; coolingUntil=${cooldownUntil}`);

      // (11) الذيل: ربط داخلي من الجرد + حالة الجرد الفارغ بلا انهيار
      const linksFragment = sectionHtml(html, "internal-links") ?? "";
      const emptyInventory = readJson(root, "state/inventory.json");
      const emptyPayload = buildDashboardPayload({ latest, health, inventory: emptyInventory, sourceDocument, run: payload.run, generatedAt: GENERATED_AT, provenance: "بوابة B4 — جرد فارغ" });
      const emptyHtml = renderDashboardHtml(emptyPayload);
      const emptyFragment = sectionHtml(emptyHtml, "internal-links") ?? "";
      check(log, checks, "inventoryInternalLinksAndEmptyState", () =>
        inventory.url_count >= 5 && payload.inventoryLinks.length > 0 && inspection.internalLinkRows === payload.inventoryLinks.length &&
        payload.inventoryLinks.every((link) => linksFragment.includes(link.url) && (link.sharedKeywords.length > 0 || link.sectionMatch)) &&
        linksFragment.includes("ربط داخلي مقترح") &&
        emptyInventory.url_count === 0 && emptyPayload.inventoryLinks.length === 0 &&
        emptyFragment.includes("لا ربط داخلي مقترح") && emptyFragment.includes(String(emptyInventory._meta.status)) && !emptyFragment.includes("<table"),
        `fixtureLinks=${payload.inventoryLinks.length}; emptyLinks=${emptyPayload.inventoryLinks.length}`);
      details.internalLinks = payload.inventoryLinks.slice(0, 3);

      // (12) بادج الزمن: غير موثق في الطبقة اليدوية/غير الموثقة، وموثق عند env/header
      const envLatest = structuredClone(crafted.latest);
      envLatest.time = { iso: RUN_ISO, source: "env", skewSeconds: 3, note: "ساعة البيئة متوافقة مع هيدر المرجع (فارق 3ث ≤ 60ث).", line: timeLine({ iso: RUN_ISO, source: "env", skewSeconds: 3, note: "ساعة البيئة متوافقة مع هيدر المرجع (فارق 3ث ≤ 60ث)." }) };
      envLatest._meta.timeSource = "env";
      const envHtml = renderDashboardHtml(buildDashboardPayload({ latest: envLatest, health, inventory, sourceDocument, run: payload.run, generatedAt: GENERATED_AT }));
      const manualLatest = structuredClone(envLatest);
      manualLatest.time = { ...envLatest.time, source: "manual", note: "زمن يدوي معتمد من المالك — المرجع الحاكم عند انقطاع الشبكة.", line: timeLine({ ...envLatest.time, source: "manual" }) };
      const manualHtml = renderDashboardHtml(buildDashboardPayload({ latest: manualLatest, health, inventory, sourceDocument, run: payload.run, generatedAt: GENERATED_AT }));
      check(log, checks, "unverifiedTimeBadgeOnlyOnManualLayer", () =>
        !envHtml.includes("زمن غير موثق") && envHtml.includes('data-attested="true"') && envHtml.includes("زمن موثق — مصدر=env") &&
        manualHtml.includes("زمن غير موثق") && manualHtml.includes('data-attested="false"') && manualHtml.includes("الطبقة اليدوية") &&
        craftedHtml.includes("زمن غير موثق") && latest.time.source === "manual",
        "env=موثق بلا بادج · manual/unverified=بادج «زمن غير موثق»");

      // (13) حتمية: نفس المدخلات ← نفس البايت، والملف يُكتب ذرياً بلا مخلفات
      const again = renderDashboardHtml(payload);
      const second = await generateDashboard({ root: sandbox, generatedAt: GENERATED_AT, data: payload });
      check(log, checks, "deterministicByteIdenticalOutput", () =>
        again === html && second.bytes === generated.bytes && fs.readFileSync(path.join(sandbox, second.rel), "utf8") === html &&
        fs.readdirSync(path.join(sandbox, "out")).filter((name) => name.includes(".tmp-")).length === 0 &&
        findExternalReferences(again).length === 0);

      // (14) صفر شبكة: المولد لا يستدعي fetch إطلاقاً
      const realFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = async (...args) => {
        fetchCalls += 1;
        throw new Error(`dashboard must not touch the network: ${String(args[0])}`);
      };
      try {
        await generateDashboard({ root: sandbox, generatedAt: GENERATED_AT, data: payload, out: path.join("out", "probe-network.html") });
        collectDashboardData({ root: sandbox, generatedAt: GENERATED_AT });
      } finally {
        globalThis.fetch = realFetch;
      }
      check(log, checks, "zeroNetworkCallsDuringGeneration", () => fetchCalls === 0, `fetchCalls=${fetchCalls}`);

      // (15) فشل صريح عند غياب بيانات B3 — لا لوحة مصنّعة
      const bareRoot = fs.mkdtempSync(path.join(sandbox, "bare-"));
      fs.mkdirSync(path.join(bareRoot, "state"), { recursive: true });
      let failure = null;
      try {
        collectDashboardData({ root: bareRoot, generatedAt: GENERATED_AT });
      } catch (error) {
        failure = error;
      }
      check(log, checks, "failsLoudlyWithoutRadarData", () =>
        failure instanceof Error && /topics-latest\.json/u.test(failure.message) && !fs.existsSync(path.join(bareRoot, "out")),
        failure ? `error=${failure.message.slice(0, 90)}…` : "no error thrown");
      fs.rmSync(bareRoot, { recursive: true, force: true });

      details.inspection = inspection;
      details.firstLines = html.split("\n").slice(0, 30);
      details.payloadSummary = {
        topics: payload.topics.length,
        golden: payload.goldenTopics.length,
        forecasts: payload.forecastTopics.length,
        sources: payload.sourceRows.length,
        inventoryLinks: payload.inventoryLinks.length,
        run: payload.run,
        bytes: generated.bytes,
      };
      return details;
    });
  } catch (error) {
    checks.unexpectedError = false;
    log(`unexpectedError=✗ | ${error?.stack ?? error}`);
  }

  const passed = Object.values(checks).every(Boolean);
  log("— B4 dashboard checks —");
  for (const [name, value] of Object.entries(checks)) log(`${name}=${value ? "✓" : "✗"}`);
  log(`النتيجة: ${passed ? "خضراء — مولد الداشبورد B4 كامل عبر fixtures معزولة" : "حمراء — بوابة B4 غير مكتملة"}`);
  log("== B4 DASHBOARD SELFTEST END ==");
  return { ok: passed, checks, details };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDashboardGate();
  if (process.argv.includes("--print")) {
    const count = Number(process.argv[process.argv.indexOf("--print") + 1]) || 30;
    console.log(`— أول ${count} سطراً من HTML المولّد (بيانات B3 المعزولة) —`);
    for (const line of (result.details.firstLines ?? []).slice(0, count)) console.log(line);
  }
  process.exit(result.ok ? 0 : 1);
}
