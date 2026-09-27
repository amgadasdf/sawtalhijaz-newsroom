// Deterministic B2 gate. Every parser runs against committed fixtures and all
// transport/policy behavior is exercised through an injected fetch implementation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFetchers, createFetcherRuntime } from "./index.js";
import {
  extractGdeltExportUrl,
  parseBingHtml,
  parseBridgeHtml,
  parseGdeltRows,
  parseRssFeed,
  parseTelegramHtml,
  parseWaybackCdx,
  parseWikiRecentChangesJson,
  parseWikiTopJson,
  unzipFirstCsv,
} from "./parsers.js";

const REQUIRED_FIXTURES = [
  "trends-rss.xml",
  "gnews.xml",
  "telegram.html",
  "wiki-top.json",
  "wiki-rc.json",
  "wayback-cdx.txt",
  "gdelt-lastupdate.txt",
  "gdelt-export.csv",
  "gdelt-export.csv.zip",
  "bing.html",
  "bridge.html",
];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSandbox(sourceRoot, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sawtalhijaz-b2-${label}-`));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "state", "samples"), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, "config", "sources.json"), path.join(root, "config", "sources.json"));
  fs.copyFileSync(path.join(sourceRoot, "config", "desks.json"), path.join(root, "config", "desks.json"));
  fs.copyFileSync(path.join(sourceRoot, "config", "dorks-init.json"), path.join(root, "config", "dorks-init.json"));
  const sourceConfig = JSON.parse(fs.readFileSync(path.join(root, "config", "sources.json"), "utf8"));
  const sources = Object.fromEntries(Object.entries(sourceConfig.sources).map(([id, source]) => [id, {
    status: source.enabled ? "سليم" : "معطل",
    requests: 0, errors: 0, invocations: 0, cache_hits: 0,
    last_status: null, last_ok: null, last_err: null, last_invocation: null,
    last_response_ms: null, backoff_stage: 0, blocked_until: null, request_times: [],
  }]));
  writeJson(path.join(root, "state", "sources-health.json"), {
    _meta: { format: "json", notes: "isolated B2 test health", source_count: Object.keys(sources).length },
    sources,
  });
  return root;
}

function response(status, contentType, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const headers = { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function printCheck(log, checks, key, condition, details = "") {
  checks[key] = Boolean(condition);
  log(`${key}=${checks[key] ? "✓" : "✗"}${details ? ` | ${details}` : ""}`);
}

function isArabicItem(item) {
  return /\p{Script=Arabic}/u.test(String(item?.title ?? ""));
}

export async function runFetchersSelftest({ root = process.cwd(), log = console.log } = {}) {
  const checks = {};
  let sandbox = null;
  let backoffSandbox = null;
  let budgetSandbox = null;
  const fixtureDir = path.join(root, "state", "samples", "fixtures");
  const readFixture = (name) => fs.readFileSync(path.join(fixtureDir, name));
  const readTextFixture = (name) => readFixture(name).toString("utf8");
  log("== B2 FETCHER SELFTEST ==");

  try {
    const missing = REQUIRED_FIXTURES.filter((name) => !fs.existsSync(path.join(fixtureDir, name)));
    printCheck(log, checks, "fixturesPresent", missing.length === 0, missing.length ? `missing=${missing.join(",")}` : `${REQUIRED_FIXTURES.length} miniature fixtures`);

    const trends = parseRssFeed(readTextFixture("trends-rss.xml"), { trends: true, limit: 5 });
    printCheck(log, checks, "trendsRssParsed", trends.length === 2 && trends[0].approx_traffic === "100K+" && trends[0].related_news?.[0]?.title.includes("قائمة"));

    const gnews = parseRssFeed(readTextFixture("gnews.xml"), { limit: 5 });
    printCheck(log, checks, "gnewsParsed", gnews.length === 2 && gnews[0].link.startsWith("https://") && gnews[0].source === "وكالة الأنباء السعودية" && Boolean(gnews[0].date));

    const telegram = parseTelegramHtml(readTextFixture("telegram.html"), { channel: "SabqOrg", limit: 5 });
    printCheck(log, checks, "telegramHtmlParsed", telegram.length === 2 && telegram[0].text.includes("إعلان تحديث") && telegram[0].date?.startsWith("2026-09-26"));

    const wikiTop = parseWikiTopJson(readTextFixture("wiki-top.json"), { limit: 5 });
    const wikiRc = parseWikiRecentChangesJson(readTextFixture("wiki-rc.json"), { limit: 5 });
    printCheck(log, checks, "wikiTopJsonParsed", wikiTop.length === 3 && wikiTop[0].views === 42000 && wikiTop[0].link.includes("wikipedia.org/wiki/"));
    printCheck(log, checks, "wikiRcJsonParsed", wikiRc.length === 2 && wikiRc[0].title === "الرياض" && Boolean(wikiRc[0].date));

    const wayback = parseWaybackCdx(readTextFixture("wayback-cdx.txt"), { limit: 5 });
    printCheck(log, checks, "waybackCdxParsed", wayback.length === 2 && wayback[0].status === "200" && wayback[0].link.includes("spa.gov.sa"));

    const lastupdate = readTextFixture("gdelt-lastupdate.txt");
    const latestExport = extractGdeltExportUrl(lastupdate);
    const zip = unzipFirstCsv(readFixture("gdelt-export.csv.zip"));
    const gdelt = parseGdeltRows(zip.text, { limit: 5 });
    printCheck(log, checks, "gdeltZipAndArabicRowsParsed", latestExport?.includes("20260926160000.export.CSV.zip") && zip.name.endsWith(".CSV") && gdelt.length === 2 && gdelt.every(isArabicItem), `arabic_rows=${gdelt.length}`);

    const bing = parseBingHtml(readTextFixture("bing.html"), { limit: 10 });
    printCheck(log, checks, "bingHtmlAndRedirectParsed", bing.length === 2 && bing[0].link === "https://x.com/SaudiNews/status/123" && bing[1].link.includes("spa.gov.sa"));

    const bridge = parseBridgeHtml(readTextFixture("bridge.html"), { limit: 5 });
    printCheck(log, checks, "bridgeHtmlParsed", bridge.length === 2 && bridge[0].link.includes("bridge=Example"));

    sandbox = makeSandbox(root, "all-sources");
    const fixtures = {
      trends: readTextFixture("trends-rss.xml"),
      gnews: readTextFixture("gnews.xml"),
      telegram: readTextFixture("telegram.html"),
      wikiTop: readTextFixture("wiki-top.json"),
      wikiRc: readTextFixture("wiki-rc.json"),
      wayback: readTextFixture("wayback-cdx.txt"),
      gdeltUpdate: lastupdate,
      gdeltZip: readFixture("gdelt-export.csv.zip"),
      bing: readTextFixture("bing.html"),
      bridge: readTextFixture("bridge.html"),
    };
    const networkCalls = [];
    const sleeps = [];
    const fixedMs = Date.parse("2026-09-27T12:00:00.000Z");
    const fakeFetch = async (input) => {
      const url = new URL(String(input));
      networkCalls.push(url.href);
      if (url.hostname === "trends.google.com") return response(200, "application/rss+xml", fixtures.trends);
      if (url.hostname === "news.google.com") return response(200, "application/rss+xml", fixtures.gnews);
      if (url.hostname === "t.me") return response(200, "text/html; charset=utf-8", fixtures.telegram);
      if (url.hostname === "wikimedia.org") return response(200, "application/json", fixtures.wikiTop);
      if (url.hostname === "ar.wikipedia.org") return response(200, "application/json", fixtures.wikiRc);
      if (url.hostname === "web.archive.org") return response(200, "text/plain", fixtures.wayback);
      if (url.hostname === "data.gdeltproject.org" && url.pathname.endsWith("lastupdate.txt")) return response(200, "text/plain", fixtures.gdeltUpdate);
      if (url.hostname === "data.gdeltproject.org") return response(200, "application/zip", fixtures.gdeltZip);
      if (url.hostname === "www.bing.com") return response(200, "text/html; charset=utf-8", fixtures.bing);
      if (url.hostname === "rss-bridge.org") return response(200, "text/html; charset=utf-8", fixtures.bridge);
      return response(404, "text/plain", `Unexpected fixture URL: ${url.href}`);
    };
    const fetchers = createFetchers({
      root: sandbox,
      fetchImpl: fakeFetch,
      sleep: async (ms) => { sleeps.push(ms); },
      random: () => 0,
      clock: () => new Date(fixedMs),
    });

    const networkResults = {};
    networkResults.trends = await fetchers.trendsRss({ maxItems: 5, forceRefresh: true });
    const callsAfterTrends = networkCalls.length;
    networkResults.trendsCache = await fetchers.trendsRss({ maxItems: 5 });
    const callsAfterTrendsCache = networkCalls.length;
    networkResults.gnews = await fetchers.gnews({ maxItems: 5, forceRefresh: true });
    networkResults.telegram = await fetchers.telegram({ maxItems: 5, forceRefresh: true });
    networkResults.wikiTop = await fetchers.wikiTop({ maxItems: 5, forceRefresh: true });
    networkResults.wikiRc = await fetchers.wikiRc({ maxItems: 5, forceRefresh: true });
    networkResults.waybackDisabled = await fetchers.waybackCdx({ maxItems: 5 });
    networkResults.waybackWeekly = await fetchers.waybackCdx({ maxItems: 5, mode: "weekly", forceRefresh: true });
    networkResults.gdelt = await fetchers.gdeltFiles({ maxItems: 5, forceRefresh: true });
    const callsAfterGdelt = networkCalls.length;
    networkResults.gdeltSecondFile = await fetchers.gdeltFiles({ maxItems: 5, forceRefresh: true });
    const callsAfterGdeltRetry = networkCalls.length;
    networkResults.bing = await fetchers.bingDorks({ maxItems: 5, forceRefresh: true });
    networkResults.bridgeDisabled = await fetchers.bridge({ maxItems: 5 });
    const bridgeCallsBeforeApproval = networkCalls.length;
    fetchers.runtime.config.sources.bridge.enabled = true;
    networkResults.bridgeApproved = await fetchers.bridge({ maxItems: 5, forceRefresh: true, councilApproval: "fixture-only council approval" });

    const expectedGood = ["trends", "gnews", "telegram", "wikiTop", "wikiRc", "waybackWeekly", "gdelt", "bing", "bridgeApproved"];
    const allFetched = expectedGood.every((key) => networkResults[key]?.status === "ok")
      && networkResults.trends.count <= 5
      && networkResults.gnews.count <= 5
      && networkResults.telegram.count <= 5
      && networkResults.wikiTop.count <= 5
      && networkResults.wikiRc.count <= 5
      && networkResults.waybackWeekly.count <= 5
      && networkResults.gdelt.count <= 5
      && networkResults.bing.count <= 10
      && networkResults.bridgeApproved.count <= 5;
    printCheck(log, checks, "allNineFetcherPoliciesExercised", allFetched, `http_requests=${networkCalls.length}`);
    const wikiTopUrl = networkCalls.find((value) => new URL(value).hostname === "wikimedia.org");
    printCheck(log, checks, "wikiTopRequestsPreviousUtcDay", Boolean(wikiTopUrl && new URL(wikiTopUrl).pathname.endsWith("/2026/09/26")));

    printCheck(log, checks, "cacheFirstNoRequest", networkResults.trendsCache.status === "cache" && callsAfterTrendsCache === callsAfterTrends && networkResults.trendsCache.request_count === 0);
    printCheck(log, checks, "weeklyAndCouncilSwitches", networkResults.waybackDisabled.status === "disabled" && networkResults.bridgeDisabled.status === "disabled" && networkCalls.length > bridgeCallsBeforeApproval);
    printCheck(log, checks, "gdeltOneZipPerRun", networkResults.gdeltSecondFile.status === "budget" && callsAfterGdeltRetry === callsAfterGdelt);
    printCheck(log, checks, "jitterTwoToSixSeconds", sleeps.length === networkCalls.length - 1 && sleeps.every((ms) => ms >= 2000 && ms <= 6000), `delays=${sleeps.length}`);

    const health = JSON.parse(fs.readFileSync(path.join(sandbox, "state", "sources-health.json"), "utf8"));
    const sourceConfig = JSON.parse(fs.readFileSync(path.join(sandbox, "config", "sources.json"), "utf8"));
    const expectedHealthIds = Object.keys(sourceConfig.sources);
    const invokedIds = ["trends-rss", "gnews", "telegram", "wiki-top", "wiki-rc", "wayback-cdx", "gdelt-files", "bing-dorks", "bridge"];
    const disabledIds = expectedHealthIds.filter((id) => sourceConfig.sources[id].enabled === false);
    const healthOkay = expectedHealthIds.length === 13
      && expectedHealthIds.every((id) => Object.hasOwn(health.sources ?? {}, id))
      && invokedIds.every((id) => Number(health.sources?.[id]?.invocations) >= 1 && Number.isFinite(health.sources?.[id]?.last_response_ms))
      && disabledIds.every((id) => health.sources[id].status === "معطل" || id === "wayback-cdx" || id === "bridge")
      && health.sources["trends-rss"].cache_hits === 1
      && health.sources["gdelt-files"].invocations === 2;
    const sampleOkay = ["trends-rss", "gnews", "telegram", "wiki-top", "wiki-rc", "wayback-cdx", "gdelt-files", "bing-dorks", "bridge"]
      .every((id) => {
        const file = path.join(sandbox, "state", "samples", `${id}-آخر.json`);
        return fs.existsSync(file) && Array.isArray(JSON.parse(fs.readFileSync(file, "utf8")).items);
      });
    printCheck(log, checks, "healthUpdatedAfterEveryInvocation", healthOkay, `sources=${expectedHealthIds.length}`);
    printCheck(log, checks, "rawSamplesSaved", sampleOkay, "state/samples/<source>-آخر.json");

    backoffSandbox = makeSandbox(root, "429-backoff");
    const backoffConfigFile = path.join(backoffSandbox, "config", "sources.json");
    const backoffConfig = JSON.parse(fs.readFileSync(backoffConfigFile, "utf8"));
    backoffConfig.sources["wiki-rc"].rate_limit_per_hour = 10;
    writeJson(backoffConfigFile, backoffConfig);
    let backoffNow = Date.parse("2026-09-27T12:00:00.000Z");
    let backoffCalls = 0;
    const backoffRuntime = createFetcherRuntime({
      root: backoffSandbox,
      fetchImpl: async () => { backoffCalls += 1; return response(429, "application/json", "{\"error\":\"rate limited\"}"); },
      sleep: async () => {},
      random: () => 0,
      clock: () => new Date(backoffNow),
    });
    const backoffFetchers = createFetchers(backoffRuntime);
    const first429 = await backoffFetchers.wikiRc({ forceRefresh: true });
    const duringFirstCooldown = await backoffFetchers.wikiRc({ forceRefresh: true });
    const firstHealth = backoffRuntime.store.readJson("state/sources-health.json").sources["wiki-rc"];
    const firstDelayMs = Date.parse(firstHealth.blocked_until) - Date.parse("2026-09-27T12:00:00.000Z");
    backoffNow = Date.parse(firstHealth.blocked_until) + 1000;
    const secondAttemptAt = backoffNow;
    const second429 = await backoffFetchers.wikiRc({ forceRefresh: true });
    const secondHealth = backoffRuntime.store.readJson("state/sources-health.json").sources["wiki-rc"];
    const secondDelayMs = Date.parse(secondHealth.blocked_until) - secondAttemptAt;
    backoffNow = Date.parse(secondHealth.blocked_until) + 1000;
    const thirdAttemptAt = backoffNow;
    const third429 = await backoffFetchers.wikiRc({ forceRefresh: true });
    const thirdHealth = backoffRuntime.store.readJson("state/sources-health.json").sources["wiki-rc"];
    const thirdDelayMs = Date.parse(thirdHealth.blocked_until) - thirdAttemptAt;
    printCheck(log, checks, "429BackoffTwoFifteenSixHours", first429.status === "cooldown" && duringFirstCooldown.status === "cooldown" && second429.status === "cooldown" && third429.status === "cooldown" && firstHealth.backoff_stage === 1 && secondHealth.backoff_stage === 2 && thirdHealth.backoff_stage === 3 && firstDelayMs === 120000 && secondDelayMs === 900000 && thirdDelayMs === 21600000 && backoffCalls === 3, `calls=${backoffCalls}; delays_ms=${firstDelayMs}/${secondDelayMs}/${thirdDelayMs}`);

    budgetSandbox = makeSandbox(root, "budget");
    const budgetConfigFile = path.join(budgetSandbox, "config", "sources.json");
    const budgetConfig = JSON.parse(fs.readFileSync(budgetConfigFile, "utf8"));
    budgetConfig.sources["trends-rss"].rate_limit_per_hour = 1;
    writeJson(budgetConfigFile, budgetConfig);
    let budgetCalls = 0;
    const budgetFetchers = createFetchers({
      root: budgetSandbox,
      fetchImpl: async () => { budgetCalls += 1; return response(200, "application/rss+xml", fixtures.trends); },
      sleep: async () => {},
      random: () => 0,
      clock: () => new Date(fixedMs),
    });
    const withinBudget = await budgetFetchers.trendsRss({ forceRefresh: true });
    const overBudget = await budgetFetchers.trendsRss({ forceRefresh: true });
    printCheck(log, checks, "rollingBudgetEnforced", withinBudget.status === "ok" && overBudget.status === "budget" && budgetCalls === 1);

    const sampleFor = (id) => JSON.parse(fs.readFileSync(path.join(sandbox, "state", "samples", `${id}-آخر.json`), "utf8"));
    printCheck(log, checks, "rawResponsePresentInSamples", typeof sampleFor("trends-rss").raw === "string" && Array.isArray(sampleFor("gnews").requests) && sampleFor("gdelt-files").requests.some((entry) => entry.content_type === "application/zip"));
  } catch (error) {
    checks.unexpectedError = false;
    log(`unexpectedError=✗ | ${error?.stack ?? error}`);
  } finally {
    for (const directory of [sandbox, backoffSandbox, budgetSandbox]) {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  const ok = Object.values(checks).every(Boolean);
  log("— B2 fetcher checks —");
  for (const [key, passed] of Object.entries(checks)) log(`${key}=${passed ? "✓" : "✗"}`);
  log(`النتيجة: ${ok ? "خضراء — بوابة B2 حتمية بلا شبكة" : "حمراء — بوابة B2 غير مكتملة"}`);
  log("== B2 FETCHER SELFTEST END ==");
  return { ok, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runFetchersSelftest();
  process.exit(result.ok ? 0 : 1);
}
