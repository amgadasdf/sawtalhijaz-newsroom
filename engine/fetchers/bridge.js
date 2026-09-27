import { parseBridgeResponse } from "./parsers.js";

export function fetchBridge(runtime, { maxItems = 5, forceRefresh = false, councilApproval = null } = {}) {
  const source = runtime.source("bridge");
  const cacheKey = JSON.stringify({ source: "bridge", url: source.url });
  return runtime.execute("bridge", { cacheKey, maxItems, forceRefresh, requiredRequests: 1, councilApproval }, async (context) => {
    const response = await context.request(source.url, { headers: { accept: "application/atom+xml, application/rss+xml, text/html;q=0.9" } });
    return {
      items: parseBridgeResponse(response.body, response.contentType ?? "", { limit: Math.max(maxItems, 10), baseUrl: source.url }),
      metadata: { url: source.url, council_approval_present: Boolean(councilApproval) },
    };
  });
}
