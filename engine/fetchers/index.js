// Public B2 fetcher API: one named fetcher per approved/configured source.
import { FetcherRuntime, createFetcherRuntime } from "./runtime.js";
import { fetchTrendsRss } from "./trends-rss.js";
import { fetchGnews } from "./gnews.js";
import { fetchTelegram } from "./telegram.js";
import { fetchWikiTop } from "./wiki-top.js";
import { fetchWikiRecentChanges } from "./wiki-rc.js";
import { fetchWaybackCdx } from "./wayback-cdx.js";
import { fetchGdeltFiles } from "./gdelt-files.js";
import { fetchBingDorks } from "./bing-dorks.js";
import { fetchBridge } from "./bridge.js";

export { FetcherError, FetcherRuntime, createFetcherRuntime } from "./runtime.js";
export * from "./parsers.js";

export function createFetchers(options = {}) {
  const runtime = options instanceof FetcherRuntime ? options : createFetcherRuntime(options);
  const fetchers = {
    trendsRss: (fetchOptions = {}) => fetchTrendsRss(runtime, fetchOptions),
    gnews: (fetchOptions = {}) => fetchGnews(runtime, fetchOptions),
    telegram: (fetchOptions = {}) => fetchTelegram(runtime, fetchOptions),
    wikiTop: (fetchOptions = {}) => fetchWikiTop(runtime, fetchOptions),
    wikiRc: (fetchOptions = {}) => fetchWikiRecentChanges(runtime, fetchOptions),
    waybackCdx: (fetchOptions = {}) => fetchWaybackCdx(runtime, fetchOptions),
    gdeltFiles: (fetchOptions = {}) => fetchGdeltFiles(runtime, fetchOptions),
    bingDorks: (fetchOptions = {}) => fetchBingDorks(runtime, fetchOptions),
    bridge: (fetchOptions = {}) => fetchBridge(runtime, fetchOptions),
  };
  const byId = {
    "trends-rss": fetchers.trendsRss,
    gnews: fetchers.gnews,
    telegram: fetchers.telegram,
    "wiki-top": fetchers.wikiTop,
    "wiki-rc": fetchers.wikiRc,
    "wayback-cdx": fetchers.waybackCdx,
    "gdelt-files": fetchers.gdeltFiles,
    "bing-dorks": fetchers.bingDorks,
    bridge: fetchers.bridge,
  };
  return { ...fetchers, byId, runtime };
}
