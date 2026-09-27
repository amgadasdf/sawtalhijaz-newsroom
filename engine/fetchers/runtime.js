// Shared B2 fetch policy: source budgets, cache-first, request spacing, 429 cooldown,
// atomic samples, and a health write after every invocation. No runtime dependencies.
import path from "node:path";
import { createStore } from "../state.js";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_USER_AGENT = "SawtAlHijazNewsroom/0.2 (manual newsroom source monitor)";
const SAMPLE_DIR = "state/samples";
const HEALTH_FILE = "state/sources-health.json";
const SAMPLE_SUFFIX = "-آخر.json";
const RAW_TEXT_LIMIT = 32_000;
const RAW_BINARY_LIMIT = 48_000;

export class FetcherError extends Error {
  constructor(message, { kind = "source", status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "FetcherError";
    this.kind = kind;
    this.status = status;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fetcher clock returned an invalid date");
  return date.toISOString();
}

function parseIsoMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function initialHealth(source) {
  return {
    status: source?.enabled ? "سليم" : "معطل",
    requests: 0,
    errors: 0,
    invocations: 0,
    cache_hits: 0,
    last_status: null,
    last_ok: null,
    last_err: null,
    last_invocation: null,
    last_response_ms: null,
    backoff_stage: 0,
    blocked_until: null,
    request_times: [],
  };
}

function getErrorMessage(error) {
  const base = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
  const code = error?.cause?.code ?? error?.code;
  return code && !base.includes(String(code)) ? `${base} (${code})` : base;
}

function networkFailure(error) {
  let cursor = error;
  for (let depth = 0; cursor && depth < 6; depth += 1, cursor = cursor.cause) {
    const code = String(cursor.code ?? "").toUpperCase();
    if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ECONNABORTED"].includes(code)) return true;
    if (cursor.name === "AbortError" || cursor.name === "TimeoutError") return true;
  }
  return error?.name === "TypeError" && /fetch failed|network|connection/i.test(String(error?.message ?? ""));
}

function sampleRaw(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.from(raw);
    const sample = bytes.subarray(0, RAW_BINARY_LIMIT);
    return {
      encoding: "base64-prefix",
      bytes: bytes.length,
      data: sample.toString("base64"),
      truncated: bytes.length > sample.length,
    };
  }
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  return text.length > RAW_TEXT_LIMIT
    ? { text: text.slice(0, RAW_TEXT_LIMIT), truncated: true, characters: text.length }
    : text;
}

function samplePath(sourceId) {
  return `${SAMPLE_DIR}/${sourceId}${SAMPLE_SUFFIX}`;
}

function statusLabel(status) {
  return {
    ok: "سليم",
    partial: "جزئي",
    cache: "مخزن",
    disabled: "معطل",
    cooldown: "تبريد",
    budget: "الميزانية",
    error: "فشل",
  }[status] ?? "غير معروف";
}

function cleanRequestTimes(values, nowMs) {
  return (Array.isArray(values) ? values : []).filter((value) => {
    const ms = parseIsoMs(value);
    return ms !== null && nowMs - ms < HOUR_MS && nowMs >= ms;
  });
}

function isFreshSample(sample, cacheKey, ttlSeconds, nowMs) {
  if (!sample?.success || !Array.isArray(sample.items) || sample.cache_key !== cacheKey) return false;
  const fetchedMs = parseIsoMs(sample.fetched_at);
  if (fetchedMs === null) return false;
  const ageMs = nowMs - fetchedMs;
  return ageMs >= -5 * 60_000 && ageMs <= Math.max(0, Number(ttlSeconds) || 0) * 1000;
}

export class FetcherRuntime {
  constructor({
    root = process.cwd(),
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    random = Math.random,
    clock = () => new Date(),
    userAgent = DEFAULT_USER_AGENT,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("FetcherRuntime needs a fetch implementation");
    this.root = path.resolve(root);
    this.store = createStore(this.root);
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.random = random;
    this.clock = clock;
    this.userAgent = userAgent;
    this.config = this.loadJson("config/sources.yaml");
    if (!this.config?.sources || typeof this.config.sources !== "object") throw new Error("config/sources.yaml must contain a sources mapping");
    this.queue = Promise.resolve();
    this.runLimits = new Map();
    const health = this.readHealth();
    this.lastRequestAtMs = parseIsoMs(health?._meta?.last_request_at);
  }

  loadJson(rel) {
    try {
      return JSON.parse(this.store.readText(rel));
    } catch (error) {
      throw new Error(`تعذرت قراءة ${rel} (ملف YAML بصيغة JSON-compatible): ${error.message}`, { cause: error });
    }
  }

  source(sourceId) {
    const source = this.config?.sources?.[sourceId];
    if (!source) throw new Error(`مصدر غير معرّف في config/sources.yaml: ${sourceId}`);
    return source;
  }

  readHealth() {
    return this.store.readJsonSafe(HEALTH_FILE, { _meta: { format: "json", notes: "B2 source health" }, sources: {} });
  }

  now() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Fetcher clock returned an invalid date");
    return date;
  }

  async execute(sourceId, options, task) {
    const job = this.queue.then(() => this._execute(sourceId, options, task));
    this.queue = job.then(() => undefined, () => undefined);
    return job;
  }

  async _execute(sourceId, options = {}, task) {
    const source = this.source(sourceId);
    const startedAt = this.now();
    const startedIso = startedAt.toISOString();
    const healthDoc = this.readHealth();
    if (!healthDoc.sources || typeof healthDoc.sources !== "object") healthDoc.sources = {};
    const previous = { ...initialHealth(source), ...(healthDoc.sources[sourceId] ?? {}) };
    const oldRequests = cleanRequestTimes(previous.request_times, startedAt.getTime());
    const configuredJitter = this.config?._meta?.jitter_seconds ?? [2, 6];
    const jitterMin = Math.max(0, Number(configuredJitter[0]) || 0);
    const jitterMax = Math.max(jitterMin, Number(configuredJitter[1]) || jitterMin);
    const backoffMinutes = this.config?._meta?.backoff_minutes ?? [2, 15, 360];
    const maxItems = Math.max(0, Number(options.maxItems ?? source.max_items ?? 5) || 0);
    const cacheKey = String(options.cacheKey ?? sourceId);
    const sampleRel = samplePath(sourceId);
    const sample = this.store.readJsonSafe(sampleRel, null);
    const nowMs = startedAt.getTime();
    const requestEvents = [...oldRequests];
    let responseMs = 0;
    let data = { items: [] };
    let error = null;
    let partialErrors = [];
    let finalStatus = "error";
    let lastStatus = previous.last_status ?? null;
    let requestCount = 0;
    let networkUnavailable = false;
    let saw429 = false;
    let lastRequestIso = null;
    let taskStarted = false;
    const responseRecords = [];

    const writeHealth = () => {
      const endedIso = isoNow(this.clock);
      const current = { ...previous };
      current.status = statusLabel(finalStatus);
      current.requests = (Number(previous.requests) || 0) + requestCount;
      current.errors = (Number(previous.errors) || 0) + (["error", "partial"].includes(finalStatus) ? 1 : 0);
      current.invocations = (Number(previous.invocations) || 0) + 1;
      current.cache_hits = (Number(previous.cache_hits) || 0) + (finalStatus === "cache" ? 1 : 0);
      current.last_status = lastStatus;
      current.last_invocation = endedIso;
      current.last_response_ms = requestCount ? Number(responseMs.toFixed(1)) : 0;
      current.last_err = error ? getErrorMessage(error) : (partialErrors.length ? partialErrors.map(getErrorMessage).join("; ") : (finalStatus === "cooldown" ? current.last_err : null));
      if (["ok", "partial", "cache"].includes(finalStatus)) current.last_ok = finalStatus === "cache" ? (previous.last_ok ?? sample?.fetched_at ?? endedIso) : endedIso;
      if (saw429) {
        const stage = Math.min((Number(previous.backoff_stage) || 0) + 1, Math.max(1, backoffMinutes.length));
        current.backoff_stage = stage;
        const minutes = Number(backoffMinutes[stage - 1]) || 360;
        current.blocked_until = new Date(this.now().getTime() + minutes * 60_000).toISOString();
      } else if (finalStatus === "ok" || finalStatus === "partial") {
        current.backoff_stage = 0;
        current.blocked_until = null;
      }
      current.request_times = requestEvents.slice(-500);
      healthDoc.sources[sourceId] = current;
      healthDoc._meta = {
        ...(healthDoc._meta ?? {}),
        format: "json",
        notes: "صحة المصادر — تحديث ذري بعد كل استدعاء جالب، مع عدد الطلبات وزمن الاستجابة والتهدئة.",
        updated_at: endedIso,
        ...(lastRequestIso ? { last_request_at: lastRequestIso } : {}),
      };
      this.store.writeJsonAtomic(HEALTH_FILE, healthDoc);
      return { health: current, updatedAt: endedIso };
    };

    const finishWithoutRequest = (status, message = null, items = []) => {
      finalStatus = status;
      error = message ? new Error(message) : null;
      if (!sample) {
        this.store.writeJsonAtomic(sampleRel, {
          _meta: { format: "json", notes: "لا توجد استجابة خام في هذا الاستدعاء؛ لم يصدر طلب شبكة (معطل/ميزانية/تبريد)." },
          source: sourceId,
          fetched_at: startedIso,
          cache_key: cacheKey,
          success: false,
          status,
          http_status: lastStatus,
          response_ms: 0,
          request_count: 0,
          raw: null,
          requests: [],
          items,
          ...(message ? { error: message } : {}),
        });
      }
      const written = writeHealth();
      return {
        source: sourceId,
        status,
        count: items.length,
        items,
        cached: status === "cache",
        response_ms: 0,
        request_count: 0,
        http_status: lastStatus,
        error: error ? getErrorMessage(error) : null,
        network_unavailable: false,
        sample_path: this.store.abs(sampleRel),
        health_updated_at: written.updatedAt,
      };
    };

    const approved = source.approval_required
      ? source.enabled === true && Boolean(options.councilApproval && String(options.councilApproval).trim())
      : source.enabled === true || (sourceId === "wayback-cdx" && source.run_mode === "weekly" && options.mode === "weekly");
    if (!approved) return finishWithoutRequest("disabled");

    if (!options.forceRefresh && isFreshSample(sample, cacheKey, source.cache_ttl_seconds, nowMs)) {
      const items = sample.items.slice(0, maxItems);
      finalStatus = "cache";
      const written = writeHealth();
      return {
        source: sourceId,
        status: "cache",
        count: items.length,
        items,
        cached: true,
        response_ms: 0,
        request_count: 0,
        http_status: sample.http_status ?? lastStatus,
        error: null,
        network_unavailable: false,
        sample_path: this.store.abs(sampleRel),
        health_updated_at: written.updatedAt,
      };
    }

    const cooldownMs = parseIsoMs(previous.blocked_until);
    if (cooldownMs !== null && cooldownMs > nowMs && !(Number(previous.backoff_stage) === 0)) {
      return finishWithoutRequest("cooldown", `429 cooldown active until ${previous.blocked_until}`);
    }

    if (sourceId === "gdelt-files" && options.onePerRun !== false && (this.runLimits.get(sourceId) ?? 0) >= (Number(source.max_export_files_per_run) || 1)) {
      return finishWithoutRequest("budget", "GDELT one export.CSV.zip file per process run limit reached");
    }

    const budget = Math.max(0, Number(source.rate_limit_per_hour) || 0);
    const requiredRequests = Math.max(0, Number(options.requiredRequests ?? 1) || 0);
    if (budget < 1 || requiredRequests > budget - requestEvents.length) {
      return finishWithoutRequest("budget", `source budget exhausted: ${requestEvents.length}/${budget} requests in the rolling hour`);
    }

    const context = {
      sourceId,
      source,
      responses: responseRecords,
      requestCount: 0,
      responseMs: 0,
      requestEvents,
      get saw429() { return saw429; },
      get networkUnavailable() { return networkUnavailable; },
      claimRunLimit: (key = sourceId, amount = 1, maximum = 1) => {
        const used = this.runLimits.get(key) ?? 0;
        if (used + amount > maximum) throw new FetcherError(`${key}: one-file-per-run cap reached`, { kind: "budget" });
        this.runLimits.set(key, used + amount);
      },
      request: async (url, init = {}) => {
        if (saw429) throw new FetcherError(`429 cooldown: refusing another ${sourceId} request`, { kind: "cooldown", status: 429 });
        const currentNow = this.now();
        const countRecent = requestEvents.filter((value) => {
          const ms = parseIsoMs(value);
          return ms !== null && currentNow.getTime() - ms < HOUR_MS && currentNow.getTime() >= ms;
        }).length;
        if (countRecent >= budget) throw new FetcherError(`source budget exhausted at request ${countRecent}/${budget}`, { kind: "budget" });

        if (this.lastRequestAtMs !== null) {
          const span = Math.max(0, jitterMax - jitterMin + 1);
          const randomValue = Math.min(0.999999999, Math.max(0, Number(this.random()) || 0));
          const delaySeconds = jitterMin + (span ? Math.floor(randomValue * span) : 0);
          const elapsedMs = currentNow.getTime() - this.lastRequestAtMs;
          const waitMs = Math.max(0, delaySeconds * 1000 - elapsedMs);
          if (waitMs > 0) await this.sleep(waitMs);
        }

        const requestAt = this.now();
        const requestIso = requestAt.toISOString();
        const requestMs = requestAt.getTime();
        this.lastRequestAtMs = requestMs;
        lastRequestIso = requestIso;
        requestEvents.push(requestIso);
        requestCount += 1;
        context.requestCount += 1;
        const responseType = init.responseType ?? "text";
        const requestTimeoutMs = Math.max(1, Number(init.timeoutMs ?? source.timeout_ms ?? 20000) || 20000);
        const { responseType: _responseType, timeoutMs: _timeoutMs, headers: callerHeaders, ...fetchOptions } = init;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        const t0 = performance.now();
        let status = null;
        let contentType = null;
        let raw = null;
        try {
          const response = await this.fetchImpl(String(url), {
            method: "GET",
            redirect: "follow",
            ...fetchOptions,
            headers: {
              "user-agent": this.userAgent,
              "accept-language": "ar-SA,ar;q=0.9,en;q=0.7",
              accept: "application/rss+xml, application/atom+xml, application/json, text/html, text/plain, */*;q=0.7",
              ...(callerHeaders ?? {}),
            },
            signal: controller.signal,
          });
          status = Number(response?.status ?? 0) || null;
          lastStatus = status;
          contentType = response?.headers?.get?.("content-type") ?? null;
          if (responseType === "arrayBuffer") {
            const body = await response.arrayBuffer();
            raw = Buffer.from(body);
          } else {
            raw = await response.text();
          }
          const elapsed = +((performance.now() - t0)).toFixed(1);
          responseMs += elapsed;
          context.responseMs += elapsed;
          const ok = status !== null && status >= 200 && status < 300;
          responseRecords.push({ url: String(url), status, content_type: contentType, response_ms: elapsed, raw, ok });
          if (status === 429) {
            saw429 = true;
            throw new FetcherError(`HTTP 429 from ${url}`, { kind: "429", status });
          }
          if (!ok) throw new FetcherError(`HTTP ${status ?? "?"} from ${url}`, { kind: "http", status });
          return { status, ok, contentType, body: raw, url: String(url), responseMs: elapsed };
        } catch (caught) {
          const elapsed = +((performance.now() - t0)).toFixed(1);
          const alreadyRecorded = responseRecords.some((entry) => entry.url === String(url) && entry.status === status && entry.raw === raw);
          if (!alreadyRecorded) {
            responseRecords.push({ url: String(url), status, content_type: contentType, response_ms: elapsed, raw, ok: false, error: getErrorMessage(caught) });
            // Includes connection failures where no HTTP status could be read.
            responseMs += elapsed;
            context.responseMs += elapsed;
          }
          if (status === 429) saw429 = true;
          if (networkFailure(caught)) networkUnavailable = true;
          throw caught;
        } finally {
          clearTimeout(timer);
        }
      },
    };

    try {
      taskStarted = true;
      data = await task(context) ?? { items: [] };
      if (!Array.isArray(data.items)) data.items = [];
      partialErrors = Array.isArray(data.partialErrors) ? data.partialErrors : [];
      finalStatus = partialErrors.length ? "partial" : "ok";
    } catch (caught) {
      error = caught;
      networkUnavailable = networkUnavailable || networkFailure(caught);
      if (saw429 || caught?.status === 429 || caught?.kind === "429") finalStatus = "cooldown";
      else if (caught?.kind === "budget") finalStatus = "budget";
      else finalStatus = "error";
    }

    const items = Array.isArray(data?.items) ? data.items.slice(0, maxItems) : [];
    const endedIso = isoNow(this.clock);
    if (requestCount > 0) {
      const rawRequests = responseRecords.map((entry) => ({
        url: entry.url,
        status: entry.status,
        content_type: entry.content_type,
        response_ms: entry.response_ms,
        ok: entry.ok,
        ...(entry.error ? { error: entry.error } : {}),
        raw: sampleRaw(entry.raw),
      }));
      const sampleDoc = {
        _meta: {
          format: "json",
          notes: "عينة استجابة خام (مقتطف عند كبر الجسم) مع إسقاط العناصر المحللة لإعادة الاستخدام عبر cache-first.",
        },
        source: sourceId,
        fetched_at: endedIso,
        cache_key: cacheKey,
        success: ["ok", "partial"].includes(finalStatus),
        status: finalStatus,
        http_status: lastStatus,
        response_ms: Number(responseMs.toFixed(1)),
        request_count: requestCount,
        raw: rawRequests.length === 1 ? rawRequests[0].raw : rawRequests.map((entry) => entry.raw),
        requests: rawRequests,
        items,
        ...(data?.metadata ? { metadata: data.metadata } : {}),
        ...(error ? { error: getErrorMessage(error) } : {}),
        ...(partialErrors.length ? { partial_errors: partialErrors.map(getErrorMessage) } : {}),
      };
      this.store.writeJsonAtomic(sampleRel, sampleDoc);
    }

    const healthWritten = writeHealth();
    const statusError = error ? getErrorMessage(error) : partialErrors.length ? partialErrors.map(getErrorMessage).join("; ") : null;
    return {
      source: sourceId,
      status: finalStatus,
      count: items.length,
      items,
      cached: false,
      response_ms: Number(responseMs.toFixed(1)),
      request_count: requestCount,
      http_status: lastStatus,
      error: statusError,
      network_unavailable: networkUnavailable,
      sample_path: this.store.abs(sampleRel),
      health_updated_at: healthWritten.updatedAt,
      ...(data?.metadata ? { metadata: data.metadata } : {}),
    };
  }
}

export function createFetcherRuntime(options = {}) {
  return new FetcherRuntime(options);
}

export const FETCHER_SAMPLE_PATH = samplePath;
