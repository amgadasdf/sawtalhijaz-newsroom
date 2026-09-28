// B3 item normalization: all fetcher output enters the radar through one stable JSON shape.
import { createHash } from "node:crypto";

export const NORMALIZED_ITEM_FIELDS = Object.freeze([
  "id",
  "title",
  "url",
  "source",
  "sourceWeight",
  "publishedAt",
  "fetchedAt",
  "deskGuess",
]);

const DESK_KEYWORDS = Object.freeze({
  "قرارات-أحداث": ["قرار", "مجلس الوزراء", "الوزراء", "أمر ملكي", "وزارة", "الملك", "ولي العهد"],
  "تريند-الشارع": ["تريند", "متداول", "تداول", "منصة", "إكس", "هاشتاق", "الجمهور", "الشارع"],
  "روشن-الرياضية": ["روشن", "دوري", "الهلال", "النصر", "الاتحاد", "الأهلي", "الشباب", "المنتخب", "مباراة", "كرة القدم"],
});

function parseIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableHash(value, length = 20) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function configuredSections(desks) {
  if (Array.isArray(desks)) return new Set(desks.map((desk) => desk?.section).filter(Boolean));
  if (Array.isArray(desks?.desks)) return new Set(desks.desks.map((desk) => desk?.section).filter(Boolean));
  if (Array.isArray(desks?.sections)) return new Set(desks.sections.filter(Boolean));
  return new Set(Object.keys(DESK_KEYWORDS));
}

export function normalizeArabicText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[ـ]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function guessDesk(item, { section = null, desks = null } = {}) {
  const validSections = configuredSections(desks);
  const explicit = item?.section ?? item?.desk ?? section;
  if (explicit && validSections.has(String(explicit))) return String(explicit);

  const normalized = normalizeArabicText(`${item?.title ?? ""} ${item?.description ?? ""} ${item?.query ?? ""}`);
  const found = [];
  for (const [desk, keywords] of Object.entries(DESK_KEYWORDS)) {
    if (!validSections.has(desk)) continue;
    const matches = keywords.reduce((total, keyword) => total + Number(normalized.includes(normalizeArabicText(keyword))), 0);
    if (matches) found.push({ desk, matches });
  }
  found.sort((a, b) => b.matches - a.matches || a.desk.localeCompare(b.desk, "ar"));
  return found[0]?.desk ?? null;
}

export function normalizeItem(item, {
  sourceId = item?.source_id ?? item?.sourceId ?? item?.source ?? "unknown",
  sourceWeight = 0,
  fetchedAt = new Date().toISOString(),
  section = null,
  desks = null,
} = {}) {
  const title = String(item?.title ?? item?.name ?? item?.text ?? "").replace(/\s+/gu, " ").trim();
  if (!title) return null;

  const url = String(item?.url ?? item?.link ?? item?.guid ?? "").trim();
  const source = String(sourceId ?? "unknown");
  const canonicalFetchedAt = parseIso(fetchedAt) ?? new Date().toISOString();
  const publishedAt = parseIso(item?.publishedAt ?? item?.published_at ?? item?.pubDate ?? item?.date ?? item?.timestamp);
  const identity = url || normalizeArabicText(title);
  const weight = Number(sourceWeight);

  return {
    id: `${source}:${stableHash(identity)}`,
    title,
    url,
    source,
    sourceWeight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
    publishedAt,
    fetchedAt: canonicalFetchedAt,
    deskGuess: guessDesk(item, { section, desks }),
  };
}

export function normalizeItems(items, options = {}) {
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(items) ? items : []) {
    const next = normalizeItem(item, options);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

export function normalizeFetcherResults(results, {
  sourceConfig = {},
  fetchedAt = new Date().toISOString(),
  section = null,
  desks = null,
} = {}) {
  const output = [];
  const seen = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const sourceId = String(result?.sourceId ?? result?.source ?? "unknown");
    const entry = sourceConfig[sourceId] ?? {};
    for (const item of normalizeItems(result?.items, {
      sourceId,
      sourceWeight: entry.weight ?? 0,
      fetchedAt,
      section,
      desks,
    })) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      output.push(item);
    }
  }
  return output;
}

export function normalizedItemIsComplete(item) {
  return Boolean(item && NORMALIZED_ITEM_FIELDS.every((field) => Object.hasOwn(item, field)) &&
    typeof item.id === "string" && typeof item.title === "string" && typeof item.url === "string" &&
    typeof item.source === "string" && Number.isFinite(item.sourceWeight) &&
    (item.publishedAt === null || (typeof item.publishedAt === "string" && parseIso(item.publishedAt) !== null)) &&
    typeof item.fetchedAt === "string" && parseIso(item.fetchedAt) !== null &&
    (item.deskGuess === null || typeof item.deskGuess === "string"));
}
