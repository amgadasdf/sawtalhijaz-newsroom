import { parseBingHtml } from "./parsers.js";

function buildQueries(runtime) {
  const source = runtime.source("bing-dorks");
  const dorks = JSON.parse(runtime.store.readText("config/dorks-init.json"));
  const maxQueries = Math.max(1, Number(dorks.max_queries) || 6);
  const queries = [];
  for (const section of dorks.sections ?? []) {
    for (const pattern of dorks.patterns ?? []) {
      const query = String(pattern.template ?? "").replaceAll("{term}", String(section.term ?? "")).trim();
      if (query) queries.push({ section: section.id, term: section.term, pattern: pattern.id, query });
      if (queries.length >= maxQueries) return queries;
    }
  }
  return queries;
}

function resultUrl(source, query) {
  const url = new URL(source.url);
  url.searchParams.set("q", query);
  return url.href;
}

function roundRobin(groups, maximum) {
  const out = [];
  const seen = new Set();
  for (let index = 0; out.length < maximum; index += 1) {
    let added = false;
    for (const group of groups) {
      const item = group[index];
      if (!item) continue;
      const key = item.link || item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      added = true;
      if (out.length >= maximum) break;
    }
    if (!added && groups.every((group) => index >= group.length)) break;
    if (!added && index > Math.max(10, ...groups.map((group) => group.length))) break;
  }
  return out;
}

export function fetchBingDorks(runtime, { maxItems = 10, forceRefresh = false, queries: overrideQueries = null } = {}) {
  const source = runtime.source("bing-dorks");
  const queries = Array.isArray(overrideQueries)
    ? overrideQueries.map((query) => typeof query === "string" ? { query, section: null, pattern: "manual" } : query)
    : buildQueries(runtime);
  if (!queries.length) throw new Error("bing-dorks: no initial dorks are configured");
  const requestPlan = queries.map((entry) => ({ ...entry, url: resultUrl(source, entry.query) }));
  const cacheKey = JSON.stringify({ source: "bing-dorks", queries: requestPlan.map(({ query }) => query) });
  return runtime.execute("bing-dorks", { cacheKey, maxItems: Math.min(Math.max(0, Number(maxItems) || 0), 10), forceRefresh, requiredRequests: requestPlan.length }, async (context) => {
    const groups = [];
    const failures = [];
    for (const entry of requestPlan) {
      try {
        const response = await context.request(entry.url, { headers: { accept: "text/html,application/xhtml+xml" } });
        groups.push(parseBingHtml(response.body, { limit: 10, query: entry.query }).map((item) => ({
          ...item,
          section: entry.section ?? null,
          pattern: entry.pattern ?? null,
          source_id: "bing-dorks",
        })));
      } catch (error) {
        failures.push(error);
        if (context.saw429 || context.networkUnavailable || error?.kind === "budget") throw error;
        groups.push([]);
      }
    }
    if (!groups.some((group) => group.length) && failures.length) {
      throw new Error(`bing-dorks: فشلت كل الاستعلامات (${failures.map((error) => error.message).join(" | ")})`);
    }
    return {
      items: roundRobin(groups, 10),
      partialErrors: failures,
      metadata: { query_count: requestPlan.length, queries: requestPlan.map(({ section, pattern, query, url }) => ({ section, pattern, query, url })) },
    };
  });
}
