// Small sequential connectivity probe used before paying B2's live-fetch debt.
const PROBES = [
  ["google", "https://www.google.com/generate_204"],
  ["wikipedia", "https://ar.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json"],
  ["bing", "https://www.bing.com/search?q=%D8%A7%D9%84%D8%B3%D8%B9%D9%88%D8%AF%D9%8A%D8%A9"],
];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function message(error) {
  const base = `${error?.name ?? "Error"}: ${error?.message ?? error}`;
  const code = error?.cause?.code ?? error?.code;
  return code && !base.includes(String(code)) ? `${base} (${code})` : base;
}

export async function probeConnectivity({
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  timeoutMs = 8000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is unavailable");
  const results = [];
  for (const [host, url] of PROBES) {
    if (results.length) {
      const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
      const seconds = 2 + Math.floor(value * 5);
      await sleep(seconds * 1000);
    }
    const started = performance.now();
    let status = null;
    let error = null;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "SawtAlHijazNewsroom/0.3 (connectivity probe)",
          accept: "application/json, text/html, */*;q=0.5",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = Number(response?.status ?? 0) || null;
      try { await response?.body?.cancel?.(); } catch {}
    } catch (caught) {
      error = message(caught);
    }
    results.push({
      host,
      url,
      reachable: status !== null,
      status,
      response_ms: +((performance.now() - started)).toFixed(1),
      error,
    });
  }
  return results;
}

export const CONNECTIVITY_PROBES = PROBES;
