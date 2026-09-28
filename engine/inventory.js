// B3 site inventory: budgeted, cache-first WordPress sitemap fetch; no article-page crawl.
import { createStore } from "./state.js";
import { decodeEntities } from "./fetchers/parsers.js";

const SITEMAP_INDEX_URL = "https://sawtalhijaz.com/sitemap.xml";
const SITEMAP_ZERO_URL = "https://sawtalhijaz.com/sitemap-0.xml";
const USER_AGENT = "SawtAlHijazNewsroom/0.3 (public sitemap inventory; no crawling beyond sitemap)";
const HOUR_MS = 60 * 60 * 1000;

function parseTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("inventory clock returned an invalid date");
  return date.toISOString();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlBlocks(xml, localName) {
  const name = escapeRegex(localName);
  const expression = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "gi");
  return [...String(xml ?? "").matchAll(expression)].map((match) => match[1]);
}

function xmlText(block, localName) {
  const name = escapeRegex(localName);
  const expression = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "i");
  const match = expression.exec(String(block ?? ""));
  if (!match) return "";
  const raw = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").replace(/<[^>]*>/g, "");
  return decodeEntities(raw).trim();
}

export function parseSitemapXml(xml) {
  const text = String(xml ?? "");
  const urlBlocks = xmlBlocks(text, "url");
  const sitemapBlocks = xmlBlocks(text, "sitemap");
  const blocks = urlBlocks.length ? urlBlocks : sitemapBlocks;
  const type = urlBlocks.length ? "url" : sitemapBlocks.length ? "sitemap" : "unknown";
  const entries = blocks.map((block) => ({
    url: xmlText(block, "loc"),
    lastModified: parseTime(xmlText(block, "lastmod")),
  })).filter((entry) => entry.url);
  return { type, entries };
}

function cleanSlug(value) {
  try {
    return decodeURIComponent(value).replace(/[-_]+/gu, " ").trim();
  } catch {
    return String(value).replace(/[-_]+/gu, " ").trim();
  }
}

function classifySitemapUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { type: "unknown", section: "غير مصنف", tag: null, author: null };
  }
  const segments = parsed.pathname.split("/").filter(Boolean).map(cleanSlug);
  const lower = segments.map((segment) => segment.toLocaleLowerCase("ar"));
  const taxonomyAt = lower.findIndex((segment) => ["category", "categories", "section", "sections"].includes(segment));
  if (taxonomyAt >= 0 && segments[taxonomyAt + 1]) {
    return { type: "section", section: segments[taxonomyAt + 1], tag: null, author: null };
  }
  const tagAt = lower.findIndex((segment) => ["tag", "tags"].includes(segment));
  if (tagAt >= 0 && segments[tagAt + 1]) {
    return { type: "tag", section: null, tag: segments[tagAt + 1], author: null };
  }
  const authorAt = lower.findIndex((segment) => ["author", "authors"].includes(segment));
  if (authorAt >= 0 && segments[authorAt + 1]) {
    return { type: "author", section: null, tag: null, author: segments[authorAt + 1] };
  }

  const knownSections = new Map([
    ["sports", "روشن-الرياضية"], ["sport", "روشن-الرياضية"], ["football", "روشن-الرياضية"],
    ["decisions", "قرارات-أحداث"], ["news", "قرارات-أحداث"], ["local", "قرارات-أحداث"],
    ["trends", "تريند-الشارع"], ["society", "تريند-الشارع"],
  ]);
  const section = segments.length ? (knownSections.get(lower[0]) ?? "عام") : "الرئيسية";
  return { type: "article", section, tag: null, author: null };
}

function aggregateInventory(urlEntries, sitemapFiles, fetchedAt, settings, requestTimes) {
  const urls = [];
  const sections = new Map();
  const tags = new Map();
  const authors = new Map();
  for (const entry of urlEntries) {
    const classification = classifySitemapUrl(entry.url);
    const row = {
      url: entry.url,
      lastModified: entry.lastModified,
      type: classification.type,
      section: classification.section,
      tag: classification.tag,
      author: classification.author,
    };
    urls.push(row);
    const touch = (map, key, url) => {
      if (!map.has(key)) map.set(key, { id: key, name: key, count: 0, lastModified: null, urls: [] });
      const aggregate = map.get(key);
      aggregate.count += 1;
      aggregate.urls.push(url);
      if (entry.lastModified && (!aggregate.lastModified || entry.lastModified > aggregate.lastModified)) aggregate.lastModified = entry.lastModified;
    };
    if (classification.section) touch(sections, classification.section, entry.url);
    if (classification.tag) touch(tags, classification.tag, entry.url);
    if (classification.author) touch(authors, classification.author, entry.url);
  }
  const sortGroup = (map) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return {
    _meta: {
      format: "json",
      status: "ok",
      source: settings.sitemap_url,
      generatedAt: fetchedAt,
      request_times: requestTimes,
      rate_limit_per_hour: settings.rate_limit_per_hour,
      cache_ttl_seconds: settings.cache_ttl_seconds,
      sitemapFiles,
      notes: "جرد عام مستخرج من sitemap فقط؛ لا يتم جلب صفحات المقالات أو تنفيذ زحف إضافي.",
    },
    sitemap_url: settings.sitemap_url,
    sitemap_content_url: settings.content_sitemap_url,
    fetched_at: fetchedAt,
    url_count: urls.length,
    urls,
    sections: sortGroup(sections),
    tags: sortGroup(tags),
    authors: sortGroup(authors),
  };
}

function addGlobalRequestStamp(store, requestIso) {
  const health = store.readJsonSafe("state/sources-health.json", { _meta: {}, sources: {} }) ?? { _meta: {}, sources: {} };
  health._meta = {
    ...(health._meta ?? {}),
    format: "json",
    notes: health._meta?.notes ?? "صحة المصادر؛ يتضمن last_request_at آخر طلب خارجي مشترك لتطبيق التباعد العالمي.",
    updated_at: requestIso,
    last_request_at: requestIso,
  };
  store.writeJsonAtomic("state/sources-health.json", health);
}

async function beforeRequest({ store, sleep, random, clock, minimumSeconds, maximumSeconds }) {
  const health = store.readJsonSafe("state/sources-health.json", null);
  const previousMs = new Date(health?._meta?.last_request_at ?? "").getTime();
  if (!Number.isFinite(previousMs)) return nowIso(clock);
  const span = Math.max(0, maximumSeconds - minimumSeconds + 1);
  const randomValue = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
  const requestedDelayMs = (minimumSeconds + (span ? Math.floor(randomValue * span) : 0)) * 1000;
  const elapsedMs = new Date(nowIso(clock)).getTime() - previousMs;
  const waitMs = Math.max(0, requestedDelayMs - elapsedMs);
  if (waitMs > 0) await sleep(waitMs);
  return nowIso(clock);
}

function recentRequestTimes(values, nowMs) {
  return (Array.isArray(values) ? values : []).filter((value) => {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) && nowMs >= millis && nowMs - millis < HOUR_MS;
  });
}

function writeAttemptCheckpoint(store, previous, requestTimes, requestIso, settings) {
  const checkpoint = {
    ...previous,
    _meta: {
      ...(previous?._meta ?? {}),
      format: "json",
      status: "refreshing",
      request_times: requestTimes,
      last_attempt_at: requestIso,
      rate_limit_per_hour: settings.rate_limit_per_hour,
      cache_ttl_seconds: settings.cache_ttl_seconds,
      notes: "طلب جرد الموقع العام — cache-first مع سقف زمني وكتابة ذرية.",
    },
  };
  store.writeJsonAtomic("state/inventory.json", checkpoint);
}

function writeFailure(store, previous, requestTimes, failedAt, error, settings) {
  const message = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
  const inventory = {
    ...previous,
    _meta: {
      ...(previous?._meta ?? {}),
      format: "json",
      status: error?.kind === "budget" ? "budget" : "unavailable",
      source: settings.sitemap_url,
      request_times: requestTimes,
      last_attempt_at: failedAt,
      last_error: message,
      notes: "تعذر تحديث جرد الموقع؛ حُفظت آخر نسخة سليمة دون استبدالها ببيانات فارغة.",
    },
    sitemap_url: previous?.sitemap_url ?? settings.sitemap_url,
    sitemap_content_url: previous?.sitemap_content_url ?? settings.content_sitemap_url,
    last_error: message,
    attempted_at: failedAt,
  };
  const io = store.writeJsonAtomic("state/inventory.json", inventory);
  return { ok: false, inventory, io, error: message };
}

async function fetchXml(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
    });
    if (!response?.ok || Number(response.status) < 200 || Number(response.status) >= 300) {
      throw new Error(`HTTP ${response?.status ?? "?"} from ${url}`);
    }
    const body = typeof response.text === "function" ? await response.text() : String(response.body ?? "");
    return { body, status: Number(response.status), contentType: response.headers?.get?.("content-type") ?? null };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshInventory({
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  clock = () => new Date(),
  timeoutMs = null,
  forceRefresh = false,
} = {}) {
  const store = createStore(root);
  const previous = store.readJsonSafe("state/inventory.json", { urls: [], sections: [], tags: [], authors: [] }) ?? {};
  const sourceDocument = store.readJsonSafe("config/sources.json", {});
  const config = sourceDocument.site_inventory ?? {};
  const settings = {
    enabled: config.enabled !== false,
    sitemap_url: config.sitemap_url ?? SITEMAP_INDEX_URL,
    content_sitemap_url: config.content_sitemap_url ?? SITEMAP_ZERO_URL,
    rate_limit_per_hour: Math.max(1, Number(config.rate_limit_per_hour) || 2),
    requests_per_run: Math.max(1, Number(config.requests_per_run) || 2),
    cache_ttl_seconds: Math.max(0, Number(config.cache_ttl_seconds) || 21600),
    timeout_ms: Math.max(1, Number(timeoutMs ?? config.timeout_ms) || 15000),
    jitter_seconds: config.jitter_seconds ?? sourceDocument?._meta?.jitter_seconds ?? [2, 6],
  };
  const minimumSeconds = Math.max(0, Number(settings.jitter_seconds[0]) || 0);
  const maximumSeconds = Math.max(minimumSeconds, Number(settings.jitter_seconds[1]) || minimumSeconds);
  const urls = [settings.sitemap_url, settings.content_sitemap_url];
  const attempted = [];
  const responses = [];
  let requestTimes = recentRequestTimes(previous?._meta?.request_times, new Date(nowIso(clock)).getTime());

  if (!settings.enabled) {
    return { ok: false, disabled: true, inventory: previous, io: null, attempted, responses, requestCount: 0, error: "site inventory disabled in config/sources.json" };
  }
  if (!forceRefresh && previous?._meta?.status === "ok") {
    const fetchedMs = new Date(previous.fetched_at ?? previous?._meta?.generatedAt ?? "").getTime();
    const ageMs = new Date(nowIso(clock)).getTime() - fetchedMs;
    if (Number.isFinite(fetchedMs) && ageMs >= 0 && ageMs <= settings.cache_ttl_seconds * 1000) {
      return { ok: true, cached: true, inventory: previous, io: null, attempted, responses, requestCount: 0, error: null };
    }
  }
  if (typeof fetchImpl !== "function") {
    const result = writeFailure(store, previous, requestTimes, nowIso(clock), new Error("fetch implementation unavailable"), settings);
    return { ...result, attempted, responses, requestCount: 0 };
  }

  const required = Math.min(urls.length, settings.requests_per_run);
  if (requestTimes.length + required > settings.rate_limit_per_hour) {
    const error = Object.assign(new Error(`inventory budget exhausted: ${requestTimes.length}/${settings.rate_limit_per_hour} requests in the rolling hour`), { kind: "budget" });
    const result = writeFailure(store, previous, requestTimes, nowIso(clock), error, settings);
    return { ...result, attempted, responses, requestCount: 0, budget: true };
  }

  try {
    if (settings.requests_per_run < urls.length) throw Object.assign(new Error("site_inventory.requests_per_run must allow both sitemap requests"), { kind: "budget" });
    for (const url of urls) {
      const requestIso = await beforeRequest({ store, sleep, random, clock, minimumSeconds, maximumSeconds });
      requestTimes = recentRequestTimes(requestTimes, new Date(requestIso).getTime());
      if (requestTimes.length >= settings.rate_limit_per_hour) {
        throw Object.assign(new Error(`inventory budget exhausted before ${url}`), { kind: "budget" });
      }
      requestTimes.push(requestIso);
      writeAttemptCheckpoint(store, previous, requestTimes, requestIso, settings);
      addGlobalRequestStamp(store, requestIso);
      attempted.push({ url, requestedAt: requestIso });
      const response = await fetchXml(url, { fetchImpl, timeoutMs: settings.timeout_ms });
      responses.push({ url, status: response.status, contentType: response.contentType });
      const parsed = parseSitemapXml(response.body);
      if (url === settings.sitemap_url && parsed.type !== "sitemap") {
        throw new Error("WordPress sitemap index response did not contain <sitemap> entries");
      }
      if (url === settings.content_sitemap_url && parsed.type !== "url") {
        throw new Error("sitemap-0.xml response did not contain <url> entries");
      }
      attempted[attempted.length - 1].parsedEntries = parsed.entries.length;
      attempted[attempted.length - 1].body = response.body;
    }

    const index = parseSitemapXml(attempted[0]?.body ?? "");
    const content = parseSitemapXml(attempted[1]?.body ?? "");
    const fetchedAt = nowIso(clock);
    const inventory = aggregateInventory(content.entries, index.entries, fetchedAt, settings, requestTimes);
    const io = store.writeJsonAtomic("state/inventory.json", inventory);
    return {
      ok: true,
      cached: false,
      inventory,
      io,
      attempted: attempted.map(({ body, ...entry }) => entry),
      responses,
      requestCount: responses.length,
      error: null,
    };
  } catch (error) {
    const failedAt = nowIso(clock);
    const result = writeFailure(store, previous, requestTimes, failedAt, error, settings);
    return {
      ...result,
      attempted: attempted.map(({ body, ...entry }) => entry),
      responses,
      requestCount: responses.length,
    };
  }
}

export const INVENTORY_URLS = Object.freeze({ sitemap: SITEMAP_INDEX_URL, content: SITEMAP_ZERO_URL });
