import { parseRssFeed } from "./parsers.js";

export function fetchTrendsRss(runtime, { maxItems = 5, forceRefresh = false } = {}) {
  const source = runtime.source("trends-rss");
  const cacheKey = JSON.stringify({ source: "trends-rss", url: source.url });
  return runtime.execute("trends-rss", { cacheKey, maxItems, forceRefresh, requiredRequests: 1 }, async (context) => {
    const response = await context.request(source.url, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
    });
    const items = parseRssFeed(response.body, { limit: Math.max(maxItems, 10), trends: true }).map((item) => ({
      ...item,
      source: "Google Trends Saudi Arabia",
      related_news: item.related_news ?? [],
    }));
    return { items, metadata: { url: source.url, extracted: ["title", "approx_traffic", "related_news"] } };
  });
}
