// B2 debt-repayment gate: probe three hosts, then attempt every B2 fetcher
// independently so a failure on one endpoint never hides another's status.
import { pathToFileURL } from "node:url";
import { createStore } from "../state.js";
import { nowDoc, timeLine } from "../time.js";
import { createFetchers } from "./index.js";
import { probeConnectivity } from "./connectivity.js";
import { runFetchersSelftest } from "./selftest.js";

const SOURCE_RUNS = [
  ["trends-rss", (fetchers) => fetchers.trendsRss({ maxItems: 5 }), "trendsRssParsed"],
  ["gnews", (fetchers) => fetchers.gnews({ maxItems: 5 }), "gnewsParsed"],
  ["telegram", (fetchers) => fetchers.telegram({ maxItems: 5 }), "telegramHtmlParsed"],
  ["wiki-top", (fetchers) => fetchers.wikiTop({ maxItems: 5 }), "wikiTopJsonParsed"],
  ["wiki-rc", (fetchers) => fetchers.wikiRc({ maxItems: 5 }), "wikiRcJsonParsed"],
  ["wayback-cdx (weekly)", (fetchers) => fetchers.waybackCdx({ maxItems: 5, mode: "weekly" }), "waybackCdxParsed"],
  ["gdelt-files", (fetchers) => fetchers.gdeltFiles({ maxItems: 5 }), "gdeltZipAndArabicRowsParsed"],
  ["bing-dorks", (fetchers) => fetchers.bingDorks({ maxItems: 5 }), "bingHtmlAndRedirectParsed"],
  ["bridge (council-gated)", (fetchers) => fetchers.bridge({ maxItems: 5 }), "bridgeHtmlParsed"],
];

function displayResult(log, label, result) {
  log(`[${label}] status=${result.status} count=${result.count} requests=${result.request_count} response_ms=${result.response_ms} http=${result.http_status ?? "—"}`);
  for (const [index, item] of result.items.slice(0, 2).entries()) {
    log(`  title[${index + 1}]=${String(item.title ?? item.text ?? item.link ?? "(بلا عنوان)").replace(/\s+/g, " ").slice(0, 240)}`);
  }
  if (!result.items.length) log("  title[1]=— (لا عناصر مستخرجة)");
  if (result.error) log(`  error=${result.error}`);
  if (result.sample_path) log(`  sample=${result.sample_path}`);
}

async function spaceAfterProbe({ sleep, random }) {
  const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
  const seconds = 2 + Math.floor(value * 5);
  await sleep(seconds * 1000);
}

export async function runLiveGate({ root = process.cwd(), log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const results = [];
  let fixtureSelftest = null;
  log(timeLine(await nowDoc({ net: false, root })));
  log("== B2 CONNECTIVITY PROBE ==");
  const probes = await probeConnectivity({ fetchImpl });
  for (const probe of probes) {
    log(`[probe ${probe.host}] reachable=${probe.reachable} status=${probe.status ?? "—"} response_ms=${probe.response_ms} url=${probe.url}${probe.error ? ` error=${probe.error}` : ""}`);
  }

  // The final probe is also an HTTP request; maintain the configured inter-request spacing.
  await spaceAfterProbe({ sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random: Math.random });
  log("== B2 LIVE FETCHERS ==");
  const fetchers = createFetchers({ root, fetchImpl });
  for (const [label, invoke, fixtureCheck] of SOURCE_RUNS) {
    let result;
    try {
      result = await invoke(fetchers);
    } catch (error) {
      result = { source: label, status: "error", count: 0, items: [], request_count: 0, response_ms: 0, http_status: null, error: `${error?.name ?? "Error"}: ${error?.message ?? error}`, network_unavailable: false };
    }
    results.push({ label, fixtureCheck, ...result });
    displayResult(log, label, result);
  }

  const anyProbeReachable = probes.some((probe) => probe.reachable);
  const anySourceReachable = results.some((result) => result.http_status !== null);
  const networkAvailable = anyProbeReachable || anySourceReachable;
  log(`network_available=${networkAvailable}`);
  if (!networkAvailable) log("البوابة الحية معلقة وتُشغَّل أول تشغيل في محادثة المشروع");

  fixtureSelftest = await runFetchersSelftest({ root, log });
  for (const result of results) {
    const fixtureOkay = fixtureSelftest.checks?.[result.fixtureCheck] === true;
    const route = ["ok", "cache"].includes(result.status) ? "live" : result.status === "disabled" ? "disabled" : fixtureOkay ? "fixtures" : "red";
    log(`[mixed ${result.label}] live=${result.status} fixture=${fixtureOkay ? "✓" : "✗"} route=${route}`);
  }
  log(`fixtures_gate=${fixtureSelftest.ok ? "GREEN" : "RED"}`);

  const health = createStore(root).readJsonSafe("state/sources-health.json", { sources: {} });
  log("sources-health.json (current raw document):");
  log(JSON.stringify(health, null, 2));

  const mixedOkay = results.every((result) => ["ok", "cache", "disabled"].includes(result.status) || fixtureSelftest.checks?.[result.fixtureCheck] === true);
  const ok = fixtureSelftest.ok && mixedOkay;
  const allLive = results.every((result) => ["ok", "cache", "disabled"].includes(result.status));
  log(`B2 live result=${allLive ? "GREEN" : networkAvailable ? "MIXED (fixture fallback for unreachable sources)" : "DEFERRED (fixtures gate applies)"}`);
  log("== B2 LIVE GATE END ==");
  return { ok, networkAvailable, probes, results, fixtureSelftest, mixedOkay };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveGate();
  process.exit(result.ok ? 0 : 1);
}
