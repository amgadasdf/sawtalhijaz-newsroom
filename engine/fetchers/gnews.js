import { parseRssFeed } from "./parsers.js";

function buildQueryPlan(runtime, source, { section: selectedSection = null, includeGeneral = true } = {}) {
  const deskConfig = JSON.parse(runtime.store.readText("config/desks.json"));
  const desks = Array.isArray(deskConfig.desks) ? deskConfig.desks : [];
  const sections = [...new Set(desks.map((desk) => desk.section).filter(Boolean))];
  const plan = includeGeneral ? [{ key: "general", label: "عام / آخر ساعة", query: source.general_query ?? "when:1h", variant: "when:1h", section: null }] : [];
  for (const section of sections) {
    if (selectedSection && selectedSection !== section) continue;
    const query = source.desk_queries?.[section];
    if (!query?.query) throw new Error(`gnews: لا يوجد استعلام في config/sources.json للقسم ${section}`);
    plan.push({ key: `desk:${section}`, label: query.label ?? section, query: query.query, variant: "desk", section });
  }
  return plan;
}

function buildUrl(source, query) {
  const url = new URL(source.url);
  url.searchParams.set("q", query);
  for (const [key, value] of Object.entries(source.params ?? {})) url.searchParams.set(key, String(value));
  return url.href;
}

function roundRobin(groups, maximum) {
  const results = [];
  let index = 0;
  while (results.length < maximum) {
    let added = false;
    for (const group of groups) {
      if (group[index]) {
        results.push(group[index]);
        added = true;
        if (results.length >= maximum) break;
      }
    }
    if (!added) break;
    index += 1;
  }
  return results;
}

export function fetchGnews(runtime, { maxItems = 5, forceRefresh = false, section = null, includeGeneral = true } = {}) {
  const source = runtime.source("gnews");
  const plan = buildQueryPlan(runtime, source, { section, includeGeneral });
  if (plan.length === 0) throw new Error(`gnews: لا توجد استعلامات للقسم ${section ?? "غير محدد"}`);
  const urls = plan.map((entry) => ({ ...entry, url: buildUrl(source, entry.query) }));
  const cacheKey = JSON.stringify({ source: "gnews", urls: urls.map(({ key, url }) => ({ key, url })) });
  return runtime.execute("gnews", { cacheKey, maxItems, forceRefresh, requiredRequests: urls.length }, async (context) => {
    const groups = [];
    const failures = [];
    for (const entry of urls) {
      try {
        const response = await context.request(entry.url, {
          headers: { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
        });
        const parsed = parseRssFeed(response.body, { limit: 20 }).map((item) => ({
          ...item,
          variant: entry.variant,
          query: entry.query,
          query_label: entry.label,
          section: entry.section,
          source_id: "gnews",
        }));
        groups.push(parsed);
      } catch (error) {
        failures.push(error);
        if (context.saw429 || context.networkUnavailable || error?.kind === "budget") throw error;
        groups.push([]);
      }
    }
    const items = roundRobin(groups, Math.max(maxItems, 10));
    if (!groups.some((group) => group.length) && failures.length) {
      throw new Error(`gnews: فشلت كل الاستعلامات (${failures.map((error) => error.message).join(" | ")})`);
    }
    return {
      items,
      partialErrors: failures,
      metadata: { queries: urls.map(({ label, query, url }) => ({ label, query, url })), successful_feeds: groups.filter((group) => group.length > 0).length },
    };
  });
}
