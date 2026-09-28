import { parseWikiRecentChangesJson } from "./parsers.js";

function buildUrl(source) {
  const url = new URL(source.url);
  for (const [key, value] of Object.entries(source.params ?? {})) url.searchParams.set(key, String(value));
  return url.href;
}

export function fetchWikiRecentChanges(runtime, { maxItems = 5, forceRefresh = false } = {}) {
  const source = runtime.source("wiki-rc");
  const url = buildUrl(source);
  const cacheKey = JSON.stringify({ source: "wiki-rc", url });
  return runtime.execute("wiki-rc", { cacheKey, maxItems, forceRefresh, requiredRequests: 1 }, async (context) => {
    const response = await context.request(url, { headers: { accept: "application/json" } });
    const items = parseWikiRecentChangesJson(response.body, { limit: Math.max(maxItems, 10) });
    return { items, metadata: { url, extracted: ["title", "link", "source", "date"] } };
  });
}
