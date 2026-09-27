import { parseWaybackCdx } from "./parsers.js";

export function fetchWaybackCdx(runtime, { maxItems = 5, forceRefresh = false, mode = "daily", domain = null } = {}) {
  const source = runtime.source("wayback-cdx");
  const selectedDomain = String(domain ?? source.domains?.[0] ?? "").trim();
  const allowedDomains = new Set((source.domains ?? []).map((value) => String(value).toLowerCase()));
  if (!selectedDomain || !allowedDomains.has(selectedDomain.toLowerCase())) {
    return runtime.execute("wayback-cdx", { cacheKey: JSON.stringify({ source: "wayback-cdx", domain: selectedDomain, mode }), maxItems, forceRefresh, requiredRequests: 0 }, async () => {
      throw new Error(`wayback-cdx: domain must be one of ${[...allowedDomains].join(", ")}`);
    });
  }
  const limit = Math.max(1, Math.min(Number(source.weekly_limit) || 5, 10));
  const url = new URL(source.url);
  url.searchParams.set("url", selectedDomain);
  url.searchParams.set("matchType", source.match_type ?? "domain");
  url.searchParams.set("limit", String(limit));
  const cacheKey = JSON.stringify({ source: "wayback-cdx", domain: selectedDomain, mode, url: url.href });
  return runtime.execute("wayback-cdx", { cacheKey, maxItems, forceRefresh, requiredRequests: 1, mode }, async (context) => {
    const response = await context.request(url.href, { headers: { accept: "text/plain" } });
    return {
      items: parseWaybackCdx(response.body, { limit: Math.max(maxItems, 10) }),
      metadata: { url: url.href, domain: selectedDomain, mode, limit },
    };
  });
}
