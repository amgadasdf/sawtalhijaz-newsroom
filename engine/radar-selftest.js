// Deterministic B3 gate. Runs the complete coordinator in an isolated temp root and injects every response.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { runRadar, BASELINE_LINE, selectRadarSources } from "./radar.js";
import { normalizeItem, normalizedItemIsComplete, normalizeArabicText } from "./normalizer.js";
import { clusterItems, compareTitles } from "./cluster.js";
import { calculateTopicMetrics, classifyOpportunityScore } from "./metrics.js";
import { calculateZScore, isForecastedWithinHours } from "./burst.js";
import { parseSitemapXml, INVENTORY_URLS, refreshInventory } from "./inventory.js";

const REQUIRED_FIXTURES = ["trends-rss.xml", "gnews.xml", "telegram.html", "wiki-rc.json", "bing.html", "wordpress-sitemap.xml", "sitemap-0.xml"];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function makeB3Sandbox(sourceRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sawtalhijaz-b3-radar-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "state", "runs"), { recursive: true });
  fs.mkdirSync(path.join(root, "state", "samples"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  for (const name of ["sources.json", "desks.json", "dorks-init.json"]) {
    fs.copyFileSync(path.join(sourceRoot, "config", name), path.join(root, "config", name));
  }
  fs.cpSync(path.join(sourceRoot, "state", "samples", "fixtures"), path.join(root, "state", "samples", "fixtures"), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, "state", "topics.json"), path.join(root, "state", "topics.json"));
  fs.copyFileSync(path.join(sourceRoot, "state", "inventory.json"), path.join(root, "state", "inventory.json"));
  fs.copyFileSync(path.join(sourceRoot, "tools", "pytrends-hook.py"), path.join(root, "tools", "pytrends-hook.py"));

  const config = JSON.parse(fs.readFileSync(path.join(root, "config", "sources.json"), "utf8"));
  const sources = Object.fromEntries(Object.entries(config.sources).map(([id, source]) => [id, {
    status: source.enabled ? "سليم" : "معطل",
    requests: 0,
    errors: 0,
    invocations: 0,
    cache_hits: 0,
    last_status: null,
    last_ok: null,
    last_err: null,
    last_invocation: null,
    last_response_ms: null,
    backoff_stage: 0,
    blocked_until: null,
    request_times: [],
  }]));
  writeJson(path.join(root, "state", "sources-health.json"), {
    _meta: { format: "json", notes: "isolated B3 fixture gate", source_count: Object.keys(sources).length, last_request_at: null },
    sources,
  });
  return root;
}

function makeResponse(status, contentType, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// —— بيئة fixtures مشتركة (B3 gate + بوابة لوحة B4) ——
// تُصدر نفس المسارات المحقونة والساعة الحتمية التي تعتمد عليها بوابة B3؛ لا سلوك جديد.
export const B3_FIXTURE_TIME = Object.freeze({
  iso: "2026-09-27T12:00:00.000Z",
  source: "manual",
  skewSeconds: 0,
  envIso: "2026-09-27T12:00:00.000Z",
  headerIso: null,
  note: "B3 deterministic fixture time",
  net: false,
});

export function makeB3FixtureEnvironment(sandbox, { requestUrls = [], sleeps = [], startIso = B3_FIXTURE_TIME.iso } = {}) {
  const fixtureDir = path.join(sandbox, "state", "samples", "fixtures");
  const fixture = (name) => fs.readFileSync(path.join(fixtureDir, name));
  const routes = new Map([
    ["trends.google.com", fixture("trends-rss.xml")],
    ["news.google.com", fixture("gnews.xml")],
    ["t.me", fixture("telegram.html")],
    ["ar.wikipedia.org", fixture("wiki-rc.json")],
    ["www.bing.com", fixture("bing.html")],
    ["sawtalhijaz.com/sitemap.xml", fixture("wordpress-sitemap.xml")],
    ["sawtalhijaz.com/sitemap-0.xml", fixture("sitemap-0.xml")],
  ]);
  let clockMs = Date.parse(startIso);
  const fakeFetch = async (input) => {
    const url = new URL(String(input));
    requestUrls.push(url.href);
    const key = `${url.hostname}${url.pathname}`;
    if (url.hostname === "t.me") return makeResponse(200, "text/html; charset=utf-8", routes.get("t.me"));
    if (url.hostname === "news.google.com") return makeResponse(200, "application/rss+xml", routes.get("news.google.com"));
    if (url.hostname === "trends.google.com") return makeResponse(200, "application/rss+xml", routes.get("trends.google.com"));
    if (url.hostname === "ar.wikipedia.org") return makeResponse(200, "application/json", routes.get("ar.wikipedia.org"));
    if (url.hostname === "www.bing.com") return makeResponse(200, "text/html; charset=utf-8", routes.get("www.bing.com"));
    if (url.hostname === "sawtalhijaz.com" && routes.has(key)) return makeResponse(200, "application/xml; charset=utf-8", routes.get(key));
    throw new Error(`Unexpected non-fixture URL: ${url.href}`);
  };
  const sleep = async (ms) => { sleeps.push(ms); clockMs += ms; };
  return {
    sandbox,
    requestUrls,
    sleeps,
    routes,
    fakeFetch,
    sleep,
    clock: () => new Date(clockMs),
    clockMs: () => clockMs,
    fixedTime: { ...B3_FIXTURE_TIME },
  };
}

// تشغيل منسّق B3 كاملاً داخل مسار معزول ببيانات fixtures (يستخدمه بوابة B3 ومولد لوحة B4).
export async function runB3FixtureRadar({ root = process.cwd(), sandbox = null, env = null, section = "تريند-الشارع", scope = "daily", depth = "quick", inventory = true, pytrends = true } = {}) {
  const box = sandbox ?? makeB3Sandbox(root);
  const environment = env ?? makeB3FixtureEnvironment(box);
  return runRadar({
    root: box,
    section,
    scope,
    depth,
    timeDoc: environment.fixedTime,
    fetchImpl: environment.fakeFetch,
    sleep: environment.sleep,
    random: () => 0,
    clock: environment.clock,
    inventory,
    pytrends,
  });
}

// مساحة fixtures جاهزة + تشغيل رادار، مع تنظيف مضمون — لبوابة B4 (لوحة من بيانات B3 المعزولة).
export async function withB3FixtureRadar(root = process.cwd(), handler) {
  const sandbox = makeB3Sandbox(root);
  try {
    const env = makeB3FixtureEnvironment(sandbox);
    const radar = await runB3FixtureRadar({ root, sandbox, env });
    return await handler({ root, sandbox, env, radar });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertNoUndefinedOrNonFinite(value, where = "root") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${where} must be finite`);
  else if (value === undefined) assert.fail(`${where} is undefined`);
  else if (Array.isArray(value)) value.forEach((child, index) => assertNoUndefinedOrNonFinite(child, `${where}[${index}]`));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertNoUndefinedOrNonFinite(child, `${where}.${key}`);
  }
}

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

export async function runB3FixtureGate({ root = process.cwd(), log = console.log } = {}) {
  const checks = {};
  let sandbox = null;
  let requestUrls = [];
  let sleeps = [];
  let radar = null;
  log("== B3 RADAR SELFTEST (isolated fixtures; no live network) ==");
  try {
    const fixtureDir = path.join(root, "state", "samples", "fixtures");
    const missing = REQUIRED_FIXTURES.filter((name) => !fs.existsSync(path.join(fixtureDir, name)));
    check(log, checks, "b3FixturesPresent", () => missing.length === 0, missing.length ? `missing=${missing.join(",")}` : `${REQUIRED_FIXTURES.length} required fixtures`);
    assert.equal(missing.length, 0, `missing fixtures: ${missing.join(", ")}`);

    const title = "إِعْلانُ مُباراة الهلال في دوري روشن";
    check(log, checks, "arabicNormalization", () => normalizeArabicText(title).includes("اعلان مباراه الهلال"));
    check(log, checks, "arabicKeywordClustering", () => {
      const a = normalizeItem({ title: "الهلال يواجه النصر في دوري روشن", link: "https://news.test/1" }, { sourceId: "gnews", sourceWeight: 0.9, fetchedAt: "2026-09-27T12:00:00Z" });
      const b = normalizeItem({ title: "دوري روشن: النصر يلتقي الهلال", link: "https://news.test/2" }, { sourceId: "telegram", sourceWeight: 0.6, fetchedAt: "2026-09-27T12:00:00Z" });
      const groups = clusterItems([a, b]);
      return groups.length === 1 && groups[0].members.length === 2 && compareTitles(a.title, b.title).matches;
    });

    check(log, checks, "normalizedShapeComplete", () => {
      const item = normalizeItem({ title: "خبر تجريبي", link: "https://example.test/a", pubDate: "2026-09-27T10:00:00Z" }, {
        sourceId: "gnews", sourceWeight: 0.9, fetchedAt: "2026-09-27T12:00:00Z", desks: { desks: [{ section: "قرارات-أحداث" }] },
      });
      return normalizedItemIsComplete(item) && Object.keys(item).length === 8;
    });

    check(log, checks, "scoreClassificationThresholds", () =>
      classifyOpportunityScore(24.99).key === "golden" &&
      classifyOpportunityScore(25).key === "window" &&
      classifyOpportunityScore(49.99).key === "window" &&
      classifyOpportunityScore(50).key === "crowded" &&
      classifyOpportunityScore(75).key === "crowded" &&
      classifyOpportunityScore(75.01).key === "missed");

    check(log, checks, "knownSpeedAndAcceleration", () => {
      const topic = { currentCount: 6, count: 6, sources: ["gnews"], deskGuess: "تريند-الشارع" };
      const previousTopic = { currentCount: 2, metrics: { speedPerHour: 1 } };
      const metrics = calculateTopicMetrics(topic, {
        previousTopic,
        previousRunIso: "2026-09-27T10:00:00.000Z",
        nowIso: "2026-09-27T12:00:00.000Z",
        requestedSection: "تريند-الشارع",
        sourceConfig: { gnews: { enabled: true, weight: 0.9 } },
      });
      return metrics.speedPerHour === 2 && metrics.accelerationPerHour === 0.5 && metrics.saturationPercent === 100 && metrics.score >= 0 && metrics.score <= 100;
    });

    check(log, checks, "zScoreAndConservativeForecast", () => {
      const z = calculateZScore(4, [1, 1, 1]);
      const forecast = isForecastedWithinHours({
        previousTopic: { acceleration: 0.5 },
        topic: { acceleration: 1.25 },
        saturationPercent: 49,
      });
      const blocked = isForecastedWithinHours({
        previousTopic: { acceleration: 0.5 },
        topic: { acceleration: 1.25 },
        saturationPercent: 50,
      });
      return z.zScore === 3 && Number.isFinite(z.zScore) && forecast.forecast === "متوقع خلال ساعات" && blocked.forecast === "غير متوقع";
    });

    check(log, checks, "sitemapParsers", () => {
      const indexXml = fs.readFileSync(path.join(fixtureDir, "wordpress-sitemap.xml"), "utf8");
      const postsXml = fs.readFileSync(path.join(fixtureDir, "sitemap-0.xml"), "utf8");
      const index = parseSitemapXml(indexXml);
      const posts = parseSitemapXml(postsXml);
      return index.type === "sitemap" && index.entries.some((entry) => entry.url === INVENTORY_URLS.content) && posts.type === "url" && posts.entries.length >= 5 && posts.entries.every((entry) => entry.lastModified);
    });

    const sourceConfig = JSON.parse(fs.readFileSync(path.join(root, "config", "sources.json"), "utf8"));
    check(log, checks, "depthAndScopeSelection", () => {
      const quick = selectRadarSources(sourceConfig, { depth: "quick", scope: "daily" });
      const deep = selectRadarSources(sourceConfig, { depth: "deep", scope: "daily" });
      const weekly = selectRadarSources(sourceConfig, { depth: "weekly", scope: "daily" });
      return quick.includes("gnews") && !quick.includes("wiki-top") && deep.includes("wiki-top") && !deep.includes("wayback-cdx") && weekly.includes("wayback-cdx") && !weekly.includes("bridge");
    });

    sandbox = makeB3Sandbox(root);
    // بيئة fixtures المشتركة (B3 + لوحة B4): نفس المسارات المحقونة والساعة الحتمية.
    const env = makeB3FixtureEnvironment(sandbox, { requestUrls, sleeps });
    const { fakeFetch, sleep, fixedTime } = env;

    radar = await runB3FixtureRadar({ root, sandbox, env });

    check(log, checks, "radarGeneratedTopics", () => radar.ok && radar.summary.normalizedItems > 0 && radar.topics.length > 0, `items=${radar.summary.normalizedItems}; topics=${radar.topics.length}`);
    check(log, checks, "sectionScopedQueries", () =>
      radar.sourceStatuses.find((entry) => entry.sourceId === "gnews")?.requestCount === 2 &&
      radar.sourceStatuses.find((entry) => entry.sourceId === "bing-dorks")?.requestCount === 2);
    check(log, checks, "firstTwoRunBaselineLine", () => radar.baselineLine === BASELINE_LINE && radar.latest._meta.baselineLine === BASELINE_LINE);
    check(log, checks, "everyTopicHasFiniteMetrics", () => radar.topics.every((topic) =>
      ["speed", "acceleration", "saturation", "score", "classification"].every((key) => Object.hasOwn(topic, key)) &&
      typeof topic.id === "string" && typeof topic.title === "string" && topic.title.length > 0 &&
      typeof topic.firstSeen === "string" && typeof topic.lastSeen === "string" &&
      Array.isArray(topic.sources) && Array.isArray(topic.members) && topic.members.length === topic.currentCount &&
      topic.members.every((item) => normalizedItemIsComplete(item)) &&
      [topic.speed, topic.acceleration, topic.saturation, topic.score].every(Number.isFinite) &&
      ["speedPerHour", "accelerationPerHour", "saturationPercent", "score"].every((key) => Number.isFinite(topic.metrics?.[key])) &&
      Object.values(topic.metrics.components ?? {}).every(Number.isFinite) &&
      typeof topic.classification === "string" && topic.classification.length > 0 && topic.burst && Number.isFinite(topic.burst.zScore)));
    check(log, checks, "noNaNNoMissingJsonValues", () => {
      assertNoUndefinedOrNonFinite(radar.latest);
      return true;
    });
    check(log, checks, "sitemapInventoryUpdated", () =>
      radar.inventory?.ok === true && radar.inventory.inventory.url_count >= 5 &&
      radar.inventory.inventory.sections.length >= 2 && radar.inventory.inventory.tags.length >= 1 &&
      radar.inventory.inventory.authors.length >= 1);

    const inventoryCallUrls = requestUrls.filter((url) => new URL(url).hostname === "sawtalhijaz.com");
    check(log, checks, "sitemapTwoExactRequests", () =>
      inventoryCallUrls.length === 2 && inventoryCallUrls[0] === INVENTORY_URLS.sitemap && inventoryCallUrls[1] === INVENTORY_URLS.content,
      `requests=${inventoryCallUrls.length}`);
    const beforeCachedInventory = requestUrls.length;
    const cachedInventory = await refreshInventory({ root: sandbox, fetchImpl: fakeFetch, sleep, random: () => 0, clock: env.clock });
    check(log, checks, "inventoryCacheFirst", () =>
      cachedInventory.ok && cachedInventory.cached === true && cachedInventory.requestCount === 0 &&
      requestUrls.length === beforeCachedInventory && cachedInventory.inventory._meta.rate_limit_per_hour === 2);
    const beforeBudgetedInventory = requestUrls.length;
    const budgetedInventory = await refreshInventory({ root: sandbox, fetchImpl: fakeFetch, sleep, random: () => 0, clock: env.clock, forceRefresh: true });
    check(log, checks, "inventoryRollingBudgetEnforced", () =>
      budgetedInventory.ok === false && budgetedInventory.budget === true && budgetedInventory.requestCount === 0 &&
      requestUrls.length === beforeBudgetedInventory && budgetedInventory.inventory._meta.status === "budget");
    check(log, checks, "globalRequestSpacingTwoToSixSeconds", () =>
      sleeps.length === requestUrls.length - 1 && sleeps.every((ms) => ms >= 2000 && ms <= 6000),
      `requests=${requestUrls.length}; delays=${sleeps.length}`);
    check(log, checks, "safePytrendsStub", () => radar.topics.every((topic) => topic.burst.interest.available === false && /safe-stub-disabled|python3 غير متاح/u.test(topic.burst.interest.reason)));

    const state = JSON.parse(fs.readFileSync(path.join(sandbox, "state", "topics.json"), "utf8"));
    const latest = JSON.parse(fs.readFileSync(path.join(sandbox, "state", "topics-latest.json"), "utf8"));
    const inventoryDoc = JSON.parse(fs.readFileSync(path.join(sandbox, "state", "inventory.json"), "utf8"));
    const runFiles = fs.readdirSync(path.join(sandbox, "state", "runs")).filter((name) => name.endsWith(".json"));
    const runDocs = runFiles.map((name) => JSON.parse(fs.readFileSync(path.join(sandbox, "state", "runs", name), "utf8")));
    const health = JSON.parse(fs.readFileSync(path.join(sandbox, "state", "sources-health.json"), "utf8"));
    check(log, checks, "atomicRadarStateAndRun", () =>
      Array.isArray(state.topics) && state.topics.length === radar.topics.length &&
      latest.topics.length === radar.topics.length && inventoryDoc.url_count >= 5 &&
      runDocs.some((doc) => doc.kind === "B3-radar" && doc.topicCounts && Object.keys(doc.topicCounts).length === radar.topics.length));
    const runStore = createStore(sandbox);
    const sameTimeRunA = runStore.writeRun({ kind: "B3-collision-probe", iso: fixedTime.iso, source: "manual" });
    const sameTimeRunB = runStore.writeRun({ kind: "B3-collision-probe", iso: fixedTime.iso, source: "manual" });
    check(log, checks, "uniqueRunFilenameOnRepeatedManualTime", () => sameTimeRunA.rel !== sameTimeRunB.rel && runStore.exists(sameTimeRunA.rel) && runStore.exists(sameTimeRunB.rel));
    check(log, checks, "B2HealthMaintained", () =>
      Object.keys(sourceConfig.sources).length === 13 &&
      ["trends-rss", "gnews", "telegram", "wiki-rc", "bing-dorks"].every((id) => Number(health.sources[id]?.invocations) === 1) &&
      health._meta.last_request_at === radar.inventory?.attempted?.at(-1)?.requestedAt);

    const topicsBeforeFailure = fs.readFileSync(path.join(sandbox, "state", "topics.json"), "utf8");
    fs.rmSync(path.join(sandbox, "state", "samples", "trends-rss-آخر.json"), { force: true });
    const failedRadar = await runRadar({
      root: sandbox,
      section: "تريند-الشارع",
      scope: "daily",
      depth: "quick",
      sourceIds: ["trends-rss"],
      timeDoc: { ...fixedTime, iso: "2026-09-27T13:00:00.000Z" },
      fetchImpl: async () => { throw new TypeError("fixture network unavailable"); },
      sleep,
      random: () => 0,
      clock: env.clock,
      inventory: false,
      pytrends: false,
    });
    const topicsAfterFailure = fs.readFileSync(path.join(sandbox, "state", "topics.json"), "utf8");
    check(log, checks, "failedLiveRunPreservesLastGoodTopics", () =>
      failedRadar.ok === false && failedRadar.summary.dataFresh === false &&
      topicsAfterFailure === topicsBeforeFailure && failedRadar.latest.topics.length === radar.topics.length);

    log(`fixture_time=${fixedTime.iso} | source=${fixedTime.source}`);
    log(`baseline=${radar.baselineLine}`);
    log(`radar_summary=${JSON.stringify(radar.summary)}`);
    log(`topics_file=${path.join(sandbox, "state", "topics-latest.json")}`);
    log(`sample_topic=${radar.topics[0] ? JSON.stringify({ id: radar.topics[0].id, title: radar.topics[0].title, speed: radar.topics[0].speed, acceleration: radar.topics[0].acceleration, saturation: radar.topics[0].saturation, score: radar.topics[0].score, classification: radar.topics[0].classification }) : "none"}`);
    log(`inventory_summary=${JSON.stringify({ urls: radar.inventory?.inventory?.url_count, sections: radar.inventory?.inventory?.sections?.length, tags: radar.inventory?.inventory?.tags?.length, authors: radar.inventory?.inventory?.authors?.length })}`);
  } catch (error) {
    checks.unexpectedError = false;
    log(`unexpectedError=✗ | ${error?.stack ?? error}`);
  } finally {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const passed = Object.values(checks).every(Boolean);
  log("— B3 radar checks —");
  for (const [name, value] of Object.entries(checks)) log(`${name}=${value ? "✓" : "✗"}`);
  log(`النتيجة: ${passed ? "خضراء — رادار B3 كامل عبر fixtures معزولة" : "حمراء — بوابة B3 غير مكتملة"}`);
  log("== B3 RADAR SELFTEST END ==");
  return { ok: passed, checks, summary: radar?.summary ?? null, baselineLine: radar?.baselineLine ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runB3FixtureGate();
  process.exit(result.ok ? 0 : 1);
}
