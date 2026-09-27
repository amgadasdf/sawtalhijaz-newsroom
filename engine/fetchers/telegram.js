import { parseTelegramHtml } from "./parsers.js";

function roundRobin(groups, maximum) {
  const results = [];
  for (let index = 0; results.length < maximum; index += 1) {
    let added = false;
    for (const group of groups) {
      if (group[index]) {
        results.push(group[index]);
        added = true;
        if (results.length >= maximum) break;
      }
    }
    if (!added) break;
  }
  return results;
}

export function fetchTelegram(runtime, { maxItems = 5, forceRefresh = false } = {}) {
  const source = runtime.source("telegram");
  const channels = [...new Set((source.channels ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (!channels.length) throw new Error("telegram: sources.yaml must list public channels");
  const cacheKey = JSON.stringify({ source: "telegram", channels });
  return runtime.execute("telegram", { cacheKey, maxItems, forceRefresh, requiredRequests: channels.length }, async (context) => {
    const groups = [];
    const failures = [];
    for (const channel of channels) {
      const url = source.url_template.replace("{channel}", encodeURIComponent(channel));
      try {
        const response = await context.request(url, { headers: { accept: "text/html,application/xhtml+xml" } });
        groups.push(parseTelegramHtml(response.body, { channel, limit: 20 }));
      } catch (error) {
        failures.push(error);
        if (context.saw429 || context.networkUnavailable || error?.kind === "budget") throw error;
        groups.push([]);
      }
    }
    if (!groups.some((group) => group.length) && failures.length) {
      throw new Error(`telegram: تعذر جلب القنوات (${failures.map((error) => error.message).join(" | ")})`);
    }
    return {
      items: roundRobin(groups, Math.max(maxItems, 10)),
      partialErrors: failures,
      metadata: { channels, successful_channels: groups.filter((group) => group.length > 0).length },
    };
  });
}
