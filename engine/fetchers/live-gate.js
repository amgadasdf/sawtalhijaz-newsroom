// B2 operational network gate. Network traffic is deliberately sequential and
// every request still passes through FetcherRuntime's budget/jitter/backoff policy.
import { pathToFileURL } from "node:url";
import { createStore } from "../state.js";
import { nowDoc, timeLine } from "../time.js";
import { createFetchers } from "./index.js";
import { runFetchersSelftest } from "./selftest.js";

const SOURCE_RUNS = [
  ["trends-rss", (fetchers) => fetchers.trendsRss({ maxItems: 5 })],
  ["gnews", (fetchers) => fetchers.gnews({ maxItems: 5 })],
  ["telegram", (fetchers) => fetchers.telegram({ maxItems: 5 })],
  ["wiki-top", (fetchers) => fetchers.wikiTop({ maxItems: 5 })],
  ["wiki-rc", (fetchers) => fetchers.wikiRc({ maxItems: 5 })],
  ["wayback-cdx (weekly)", (fetchers) => fetchers.waybackCdx({ maxItems: 5, mode: "weekly" })],
  ["gdelt-files", (fetchers) => fetchers.gdeltFiles({ maxItems: 5 })],
  ["bing-dorks", (fetchers) => fetchers.bingDorks({ maxItems: 5 })],
  // Disabled until explicit council approval: invoking the guard verifies policy without a request.
  ["bridge (council-gated)", (fetchers) => fetchers.bridge({ maxItems: 5 })],
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

export async function runLiveGate({ root = process.cwd(), log = console.log } = {}) {
  const results = [];
  let networkCut = false;
  let networkObserved = false;
  let fixtureSelftest = null;
  log(timeLine(await nowDoc({ net: false, root })));
  log("== B2 LIVE GATE ==");
  const fetchers = createFetchers({ root });
  for (const [label, invoke] of SOURCE_RUNS) {
    let result;
    try {
      result = await invoke(fetchers);
    } catch (error) {
      result = { source: label, status: "error", count: 0, items: [], request_count: 0, response_ms: 0, http_status: null, error: `${error?.name ?? "Error"}: ${error?.message ?? error}`, network_unavailable: false };
    }
    results.push({ label, ...result });
    displayResult(log, label, result);
    if (result.request_count > 0 || result.http_status !== null) networkObserved = true;
    if (result.network_unavailable) {
      networkCut = true;
      break;
    }
  }

  if (networkCut || !networkObserved) {
    networkCut = true;
    log("network_available=false");
    log("البوابة الحية معلقة وتُشغَّل أول تشغيل في محادثة المشروع");
  } else {
    log("network_available=true");
  }
  fixtureSelftest = await runFetchersSelftest({ root, log });
  log(`fixtures_gate=${fixtureSelftest.ok ? "GREEN" : "RED"}`);

  const health = createStore(root).readJsonSafe("state/sources-health.json", { sources: {} });
  log("sources-health.json (current raw document):");
  log(JSON.stringify(health, null, 2));

  const expectedLiveStatuses = new Set(["ok", "cache", "disabled"]);
  const liveOk = results.every((result) => expectedLiveStatuses.has(result.status));
  const ok = fixtureSelftest.ok && (networkCut || liveOk);
  log(`B2 live result=${networkCut ? "DEFERRED (offline fixtures gate applies)" : liveOk ? "GREEN" : "RED"}`);
  log("== B2 LIVE GATE END ==");
  return { ok, networkAvailable: !networkCut, networkCut, results, fixtureSelftest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveGate();
  process.exit(result.ok ? 0 : 1);
}
