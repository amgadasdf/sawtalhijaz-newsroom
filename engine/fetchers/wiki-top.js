import { parseWikiTopJson } from "./parsers.js";

function previousUtcDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function fetchWikiTop(runtime, { maxItems = 5, forceRefresh = false, date = null } = {}) {
  const source = runtime.source("wiki-top");
  const reportDate = date ?? previousUtcDay(runtime.now());
  const encodedDate = reportDate.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const url = source.url_template.replace("{date}", encodedDate);
  const cacheKey = JSON.stringify({ source: "wiki-top", date: reportDate, url });
  return runtime.execute("wiki-top", { cacheKey, maxItems, forceRefresh, requiredRequests: 1 }, async (context) => {
    const response = await context.request(url, { headers: { accept: "application/json" } });
    const document = JSON.parse(response.body);
    const items = parseWikiTopJson(document, { limit: Math.max(maxItems, 10) });
    return { items, metadata: { date: reportDate, url, project: "ar.wikipedia.org" } };
  });
}
