// B3 coordinator: attested time -> configured fetchers -> normalized items -> topics -> metrics/burst -> atomic state.
// Also the direct B3 entry point (node engine/radar.js [--fixtures] [--section …]); the unified CLI reuses runRadar().
// قرار B1 (المؤكد في الخطوة صفر من B4): الامتداد .js حصراً في هذا المستودع — لا ملفات .mjs.
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc, timeLine } from "./time.js";
import { createFetchers } from "./fetchers/index.js";
import { normalizeItems } from "./normalizer.js";
import { clusterItems, normalizeTopicsState } from "./cluster.js";
import { applyTopicClassification, scoreTopics } from "./metrics.js";
import { computeBurst } from "./burst.js";
import { refreshInventory } from "./inventory.js";
import { runB3FixtureGate } from "./radar-selftest.js";

export const BASELINE_LINE = "التشغيلان الأولان يبنيان خط الأساس — التوقعات متحفظة";
export const QUICK_SOURCES = Object.freeze(["trends-rss", "gnews", "telegram", "wiki-rc", "bing-dorks"]);
export const DEEP_SOURCES = Object.freeze([...QUICK_SOURCES, "wiki-top", "gdelt-files"]);

function canonicalDepth(depth) {
  const value = String(depth ?? "quick").trim().toLocaleLowerCase("ar");
  if (["deep", "عميق", "متعمق", "weekly", "أسبوعي"].includes(value)) return value === "weekly" || value === "أسبوعي" ? "weekly" : "deep";
  return "quick";
}

function normalizeScopeSources(scope, sourceIds) {
  if (Array.isArray(sourceIds) && sourceIds.length) return sourceIds.map(String);
  if (Array.isArray(scope)) return scope.map(String);
  if (typeof scope !== "string") return null;
  const parts = scope.split(/[;,،]/u).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^[a-z0-9-]+$/iu.test(part)) ? parts : null;
}

export function selectRadarSources(config, { depth = "quick", scope = "daily", sourceIds = null } = {}) {
  const normalizedDepth = canonicalDepth(depth);
  const configured = config?.sources ?? {};
  const candidate = normalizeScopeSources(scope, sourceIds);
  const explicit = candidate?.every((id) => Object.hasOwn(configured, id)) ? candidate : null;
  let requested;
  if (explicit) requested = explicit;
  else if (String(scope).toLocaleLowerCase("ar") === "all" || String(scope).toLocaleLowerCase("ar") === "الكل") {
    requested = Object.entries(configured)
      .filter(([, source]) => source?.enabled === true && source?.daily_enabled !== false)
      .map(([id]) => id);
  } else {
    requested = normalizedDepth === "deep" || normalizedDepth === "weekly" ? [...DEEP_SOURCES] : [...QUICK_SOURCES];
    if (normalizedDepth === "weekly") requested.push("wayback-cdx");
  }
  if (normalizedDepth === "weekly" && !requested.includes("wayback-cdx")) requested.push("wayback-cdx");
  const unique = [...new Set(requested)];
  return unique.filter((id) => {
    const source = configured[id];
    if (!source || source.enabled !== true) return false;
    if (id === "wayback-cdx") return normalizedDepth === "weekly";
    return source.daily_enabled !== false || normalizedDepth === "weekly";
  });
}

function findPreviousRunIso(store) {
  return store.listRuns(500)
    .map((run) => ({ ...run, doc: store.readJsonSafe(run.rel, null) }))
    .find((run) => run.doc?.kind === "B3-radar")?.iso ?? null;
}

function resolveFetcherOptions(sourceId, { maxItems, section, depth }) {
  const options = { maxItems };
  if (["gnews", "bing-dorks"].includes(sourceId) && section) options.section = section;
  if (sourceId === "wayback-cdx" && depth === "weekly") options.mode = "weekly";
  if (sourceId === "gdelt-files") options.onePerRun = true;
  return options;
}

function resultSummary(sourceId, result, error = null) {
  const statuses = { ok: "أخضر", partial: "جزئي", cache: "مخزن", disabled: "معطل", cooldown: "تبريد", budget: "ميزانية", error: "فشل" };
  return {
    sourceId,
    status: result?.status ?? (error ? "error" : "unknown"),
    label: statuses[result?.status] ?? (error ? "فشل" : "غير معروف"),
    count: Array.isArray(result?.items) ? result.items.length : Number(result?.count ?? 0),
    requestCount: Number(result?.request_count ?? 0),
    responseMs: Number(result?.response_ms ?? 0),
    error: error ? `${error?.name ?? "Error"}: ${error?.message ?? String(error)}` : (result?.error ?? null),
  };
}

export async function runRadar({
  root = process.cwd(),
  section = "تريند-الشارع",
  scope = "daily",
  depth = "quick",
  sourceIds = null,
  net = true,
  timeDoc = null,
  fetchImpl = globalThis.fetch,
  sleep,
  random,
  clock = () => new Date(),
  inventory = true,
  pytrends = true,
} = {}) {
  const wallStartedAt = new Date().toISOString();
  const store = createStore(root);
  const sourceDocument = store.readJson("config/sources.json");
  const sourceConfig = sourceDocument.sources ?? {};
  const deskConfig = store.readJsonSafe("config/desks.json", { desks: [] });
  const depthMode = canonicalDepth(depth);
  const time = timeDoc ?? await nowDoc({ net, root, fetchImpl });
  const previousDoc = normalizeTopicsState(store.readJsonSafe("state/topics.json", []));
  const previousTopics = previousDoc.topics;
  const previousRunIso = previousDoc._meta?.lastRunIso ?? findPreviousRunIso(store);
  const beforeRuns = store.listRuns(500).filter((run) => {
    const doc = store.readJsonSafe(run.rel, null);
    return doc?.kind === "B3-radar" && doc?.success === true;
  }).length;
  const selectedSources = selectRadarSources(sourceDocument, { depth: depthMode, scope, sourceIds });
  const fetchers = createFetchers({ root, fetchImpl, ...(sleep ? { sleep } : {}), ...(random ? { random } : {}), clock });
  const maxItems = depthMode === "quick" ? 10 : 25;
  const fetched = [];
  const sourceStatuses = [];

  for (const sourceId of selectedSources) {
    const fetcher = fetchers.byId[sourceId];
    if (typeof fetcher !== "function") {
      const summary = resultSummary(sourceId, { status: "disabled", items: [] }, new Error("لا يوجد جالب runtime لهذا المصدر"));
      sourceStatuses.push(summary);
      fetched.push({ sourceId, result: { status: "error", items: [] }, error: new Error(summary.error) });
      continue;
    }
    try {
      const result = await fetcher(resolveFetcherOptions(sourceId, { maxItems, section, depth: depthMode }));
      sourceStatuses.push(resultSummary(sourceId, result));
      fetched.push({ sourceId, result, error: null });
    } catch (error) {
      sourceStatuses.push(resultSummary(sourceId, null, error));
      fetched.push({ sourceId, result: { status: "error", items: [] }, error });
    }
  }

  const normalizedItems = [];
  const seenItems = new Set();
  for (const entry of fetched) {
    const source = sourceConfig[entry.sourceId] ?? {};
    const fallbackSection = ["gnews", "bing-dorks"].includes(entry.sourceId) ? section : null;
    for (const item of normalizeItems(entry.result?.items, {
      sourceId: entry.sourceId,
      sourceWeight: source.weight ?? 0,
      fetchedAt: time.iso,
      section: fallbackSection,
      desks: deskConfig,
    })) {
      if (seenItems.has(item.id)) continue;
      seenItems.add(item.id);
      normalizedItems.push(item);
    }
  }

  const hasNewItems = normalizedItems.length > 0;
  let topics = previousTopics.map((topic) => applyTopicClassification(topic));
  if (hasNewItems) {
    const clusters = clusterItems(normalizedItems, { previousTopics });
    const scoredTopics = scoreTopics(clusters, {
      previousTopics,
      previousRunIso,
      nowIso: time.iso,
      sourceConfig,
      requestedSection: section,
    }).sort((a, b) => b.score - a.score || b.currentCount - a.currentCount || a.title.localeCompare(b.title, "ar"));
    const previousById = new Map(previousTopics.map((topic) => [topic.id, topic]));
    topics = scoredTopics.map((topic) => ({
      ...topic,
      burst: computeBurst(topic, {
        root,
        previousTopic: previousById.get(topic.id) ?? null,
        pytrends,
      }),
    }));
  }

  let inventoryResult = null;
  if (inventory) {
    inventoryResult = await refreshInventory({
      root,
      fetchImpl,
      ...(sleep ? { sleep } : {}),
      ...(random ? { random } : {}),
      clock,
    });
  }

  const sourceSucceeded = sourceStatuses.some((entry) => ["ok", "partial", "cache"].includes(entry.status));
  const runSucceeded = selectedSources.length > 0 && sourceSucceeded && hasNewItems;
  const baselineLine = beforeRuns < 2 ? BASELINE_LINE : "اكتمل خط الأساس الأولي؛ تُبنى المقارنات على التشغيلات السابقة.";
  const summary = {
    rawItems: fetched.reduce((sum, entry) => sum + (Array.isArray(entry.result?.items) ? entry.result.items.length : 0), 0),
    normalizedItems: normalizedItems.length,
    topics: topics.length,
    dataFresh: hasNewItems,
    sourceCount: selectedSources.length,
    failedSources: sourceStatuses.filter((entry) => ["error", "budget", "cooldown"].includes(entry.status)).length,
    inventoryStatus: inventoryResult ? (inventoryResult.ok ? "ok" : "unavailable") : "not-requested",
  };
  const topicCounts = Object.fromEntries(topics.map((topic) => [topic.id, topic.currentCount]));
  const wallEndedAt = new Date().toISOString();
  const run = store.recordRun({
    kind: "B3-radar",
    actor: "radar",
    iso: time.iso,
    source: time.source,
    summary: `B3 radar: ${summary.topics} topics, ${summary.normalizedItems} normalized items; inventory=${summary.inventoryStatus}`,
    next: "مراجعة الإشارات الأعلى وترقية الموضوعات المعتمدة إلى قرارات التحرير.",
    pending: summary.failedSources ? [`مصادر متعثرة: ${sourceStatuses.filter((entry) => entry.error).map((entry) => entry.sourceId).join(", ")}`] : [],
    startedAt: wallStartedAt,
    endedAt: wallEndedAt,
    extra: {
      section,
      scope,
      depth: depthMode,
      summary,
      sourceStatuses,
      topicCounts: hasNewItems ? topicCounts : {},
      success: runSucceeded,
      dataFresh: hasNewItems,
      inventoryError: inventoryResult?.error ?? null,
      baselineLine,
    },
  });

  const latest = {
    _meta: {
      format: "json",
      schemaVersion: "B3.1",
      kind: "B3-radar-latest",
      generatedAt: time.iso,
      timeSource: time.source,
      runPath: run.rel,
      baselineLine,
      dataFresh: hasNewItems,
      success: runSucceeded,
      notes: "نتيجة رادار الأخبار؛ المصنفات تبقى اقتراحات تحليلية ولا تنشر تلقائياً.",
    },
    time: {
      iso: time.iso,
      source: time.source,
      skewSeconds: Number(time.skewSeconds ?? 0),
      note: String(time.note ?? ""),
      line: timeLine(time),
    },
    section,
    scope,
    depth: depthMode,
    summary,
    sourceStatuses,
    inventory: inventoryResult ? {
      ok: inventoryResult.ok,
      urlCount: inventoryResult.inventory?.url_count ?? inventoryResult.inventory?.urls?.length ?? 0,
      sectionCount: inventoryResult.inventory?.sections?.length ?? 0,
      error: inventoryResult.error,
    } : null,
    topics,
  };

  const topicsState = {
    _meta: {
      format: "json",
      schemaVersion: "B3.1",
      lastRunIso: time.iso,
      timeSource: time.source,
      section,
      scope,
      depth: depthMode,
      baselineLine,
    },
    topics,
  };
  if (hasNewItems || JSON.stringify(topics) !== JSON.stringify(previousTopics)) store.writeJsonAtomic("state/topics.json", topicsState);
  store.writeJsonAtomic("state/radar.json", {
    _meta: { format: "json", updatedAt: time.iso, timeSource: time.source, kind: "B3-radar", success: runSucceeded, dataFresh: hasNewItems },
    lastRun: time.iso,
    lastSummary: `B3: ${summary.topics} topics, ${summary.normalizedItems} normalized items; inventory=${summary.inventoryStatus}; success=${runSucceeded}`,
    nextPlanned: "مراجعة الإشارات الأعلى وترقية الموضوعات المعتمدة إلى قرارات التحرير.",
    pending: run.doc.pending ?? [],
    counters: beforeRuns + Number(runSucceeded),
    latestRunPath: run.rel,
  });
  store.writeJsonAtomic("state/topics-latest.json", latest);

  return {
    ok: runSucceeded,
    time,
    sourceStatuses,
    selectedSources,
    normalizedItems,
    topics,
    summary,
    baselineLine,
    inventory: inventoryResult,
    latest,
    run,
    lines: [timeLine(time), baselineLine, `sources=${selectedSources.length} | items=${normalizedItems.length} | topics=${topics.length} | inventory=${summary.inventoryStatus}`],
  };
}

// —— نقطة التشغيل المباشرة (B3) ——
// node engine/radar.js [--fixtures|--offline] [--section ID] [--scope daily|all] [--depth quick|deep|weekly] [--sources a,b]
function radarOption(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--fixtures") || args.includes("--offline")) {
    const gate = await runB3FixtureGate();
    process.exit(gate.ok ? 0 : 1);
  }
  const sourceIds = radarOption(args, "--sources", null)?.split(/[;,،]/u).map((entry) => entry.trim()).filter(Boolean) ?? null;
  const result = await runRadar({
    section: radarOption(args, "--section", "تريند-الشارع"),
    scope: radarOption(args, "--scope", "daily"),
    depth: radarOption(args, "--depth", "quick"),
    sourceIds,
    net: !args.includes("--offline"),
  });
  for (const line of result.lines) console.log(line);
  for (const source of result.sourceStatuses) {
    console.log(`[${source.sourceId}] ${source.status} | count=${source.count} | requests=${source.requestCount}${source.error ? ` | ${source.error}` : ""}`);
  }
  console.log(`topics=${result.topics.length} | state/topics-latest.json | run=${result.run.rel}`);
  process.exit(result.ok ? 0 : 1);
}
