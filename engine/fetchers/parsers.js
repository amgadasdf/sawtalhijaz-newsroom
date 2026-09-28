// Pure, dependency-free parsers for the B2 source formats. They consume strings/objects
// and never perform network or filesystem I/O, so fixtures exercise the exact live parser.
import { inflateRawSync } from "node:zlib";

const ARABIC_RE = /\p{Script=Arabic}/u;

export function decodeEntities(value = "") {
  return String(value)
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (whole, entity) => {
      const key = entity.toLowerCase();
      if (key === "amp") return "&";
      if (key === "lt") return "<";
      if (key === "gt") return ">";
      if (key === "quot") return '"';
      if (key === "apos" || key === "#39") return "'";
      if (key === "nbsp") return "\u00a0";
      const numeric = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
      try {
        return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : whole;
      } catch {
        return whole;
      }
    });
}

export function stripMarkup(value = "") {
  return decodeEntities(String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[\t\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function elementBlocks(xml, localName) {
  const name = String(localName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "gi");
  return [...String(xml).matchAll(expression)].map((match) => match[1]);
}

function elementText(xml, localName) {
  const block = elementBlocks(xml, localName)[0];
  return block === undefined ? "" : stripMarkup(block.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1"));
}

function tagAttribute(xml, localName, attribute) {
  const name = String(localName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attr = String(attribute).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*)>`, "i").exec(String(xml));
  if (!open) return "";
  const value = new RegExp(`\\b${attr}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(open[1]);
  return value ? decodeEntities(value[2]) : "";
}

function rssLink(block) {
  const text = elementText(block, "link");
  if (text) return text;
  const href = tagAttribute(block, "link", "href");
  if (href) return href;
  const guid = elementText(block, "guid");
  return /^https?:\/\//i.test(guid) ? guid : "";
}

export function parseRssFeed(xml, { limit = 5, trends = false } = {}) {
  const blocks = elementBlocks(xml, "item");
  const entries = blocks.length ? blocks : elementBlocks(xml, "entry");
  const items = [];
  for (const block of entries) {
    const title = elementText(block, "title");
    if (!title) continue;
    const sourceTag = elementBlocks(block, "source")[0] ?? "";
    const source = stripMarkup(sourceTag);
    const sourceUrl = tagAttribute(block, "source", "url");
    const approxTraffic = elementText(block, "approx_traffic") || elementText(block, "approxTraffic");
    const relatedNews = elementBlocks(block, "news_item").map((news) => ({
      title: elementText(news, "news_item_title") || elementText(news, "title"),
      link: elementText(news, "news_item_url") || elementText(news, "link"),
      source: elementText(news, "news_item_source") || elementText(news, "source"),
    })).filter((news) => news.title || news.link);
    const item = {
      title,
      link: rssLink(block),
      source: source || sourceUrl || null,
      source_url: sourceUrl || null,
      date: elementText(block, "pubDate") || elementText(block, "published") || elementText(block, "updated") || elementText(block, "date") || null,
    };
    if (trends || approxTraffic) item.approx_traffic = approxTraffic || null;
    if (relatedNews.length) item.related_news = relatedNews;
    items.push(item);
    if (items.length >= Math.max(0, Number(limit) || 0)) break;
  }
  return items;
}

function attributeFromOpenTag(markup, tagLocalName, attribute) {
  return tagAttribute(markup, tagLocalName, attribute);
}

export function parseTelegramHtml(html, { channel = "", limit = 5 } = {}) {
  const source = String(html);
  const markers = [...source.matchAll(/<div\b[^>]*class\s*=\s*(["'])[^"']*\btgme_widget_message_wrap\b[^"']*\1[^>]*>/gi)];
  const messages = [];
  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index].index;
    const end = markers[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const textOpen = /<div\b[^>]*class\s*=\s*(["'])[^"']*\btgme_widget_message_text\b[^"']*\1[^>]*>/i.exec(block);
    if (!textOpen) continue;
    const contentStart = textOpen.index + textOpen[0].length;
    const contentEnd = block.indexOf("</div>", contentStart);
    const body = contentEnd >= 0 ? block.slice(contentStart, contentEnd) : block.slice(contentStart);
    const text = stripMarkup(body);
    if (!text) continue;

    const datetime = /<time\b[^>]*\bdatetime\s*=\s*(["'])(.*?)\1[^>]*>/i.exec(block)?.[2] ?? null;
    const dateLink = /<a\b[^>]*class\s*=\s*(["'])[^"']*\btgme_widget_message_date\b[^"']*\1[^>]*>/i.exec(block);
    const messageUrl = dateLink ? attributeFromOpenTag(dateLink[0], "a", "href") : "";
    const postId = /\bdata-post\s*=\s*(["'])([^"']+)\1/i.exec(block)?.[2] ?? null;
    messages.push({
      title: text.replace(/\s+/g, " ").slice(0, 180),
      text,
      date: datetime ? decodeEntities(datetime) : null,
      link: messageUrl || (postId ? `https://t.me/${postId}` : null),
      source: channel ? `telegram:${channel}` : "telegram",
      channel: channel || null,
      message_id: postId,
    });
    if (messages.length >= Math.max(0, Number(limit) || 0)) break;
  }
  return messages;
}

function wikipediaUrl(title) {
  const normalized = String(title ?? "").replace(/ /g, "_");
  return `https://ar.wikipedia.org/wiki/${encodeURI(normalized)}`;
}

export function parseWikiTopJson(document, { limit = 5 } = {}) {
  const root = typeof document === "string" ? JSON.parse(document) : document;
  const projects = Array.isArray(root?.items) ? root.items : [];
  const articles = projects.flatMap((project) => Array.isArray(project?.articles) ? project.articles : []);
  return articles.slice(0, Math.max(0, Number(limit) || 0)).map((article, index) => ({
    title: String(article?.article ?? article?.title ?? "").replace(/_/g, " "),
    link: wikipediaUrl(article?.article ?? article?.title ?? ""),
    source: "ar.wikipedia.org",
    date: [projects[0]?.year, projects[0]?.month, projects[0]?.day].filter(Boolean).join("-") || null,
    views: Number(article?.views ?? 0),
    rank: Number(article?.rank ?? index + 1),
  })).filter((item) => item.title);
}

export function parseWikiRecentChangesJson(document, { limit = 5 } = {}) {
  const root = typeof document === "string" ? JSON.parse(document) : document;
  const changes = root?.query?.recentchanges ?? root?.recentchanges ?? [];
  return (Array.isArray(changes) ? changes : []).slice(0, Math.max(0, Number(limit) || 0)).map((change) => ({
    title: String(change?.title ?? ""),
    link: wikipediaUrl(change?.title ?? ""),
    source: "ar.wikipedia.org",
    date: change?.timestamp ?? null,
    user: change?.user ?? null,
    comment: change?.comment ?? null,
    change_type: change?.type ?? null,
  })).filter((item) => item.title);
}

export function parseWaybackCdx(text, { limit = 5 } = {}) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split("\t");
  const hasHeader = header.some((cell) => /^(urlkey|timestamp|original|mimetype|statuscode|digest|length)$/i.test(cell));
  const names = hasHeader ? header.map((cell) => cell.toLowerCase()) : ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"];
  const rows = lines.slice(hasHeader ? 1 : 0);
  return rows.slice(0, Math.max(0, Number(limit) || 0)).map((line) => {
    const cells = line.split("\t");
    const entry = Object.fromEntries(names.map((name, index) => [name, cells[index] ?? ""]));
    return {
      title: entry.original || entry.urlkey || "Wayback capture",
      link: entry.original || null,
      source: "web.archive.org",
      date: entry.timestamp || null,
      status: entry.statuscode || null,
      mimetype: entry.mimetype || null,
      digest: entry.digest || null,
    };
  }).filter((item) => item.title);
}

export function parseDelimitedLine(line, delimiter = "\t") {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function isArabicGdeltRow(row, names, delimiter) {
  const fields = parseDelimitedLine(row, delimiter);
  const named = names ? Object.fromEntries(names.map((name, index) => [name, fields[index] ?? ""])) : null;
  const language = named?.language ?? named?.lang ?? named?.source_language ?? "";
  const domainValue = named?.domain ?? named?.sourcedomain ?? "";
  const url = named?.sourceurl ?? named?.url ?? fields.at(-1) ?? "";
  const languageIsArabic = /^(?:ar|ara|arabic|عربي|العربية)$/i.test(language.trim());
  const domain = String(domainValue || (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })()).toLowerCase().replace(/^www\./, "");
  const arabicCcTld = /\.(?:sa|ae|qa|kw|bh|om|jo|lb|ps|iq|eg|ma|dz|tn|ly|ye|sd|so|mr)$/i.test(domain);
  const explicitArabicDomain = /^(?:ar|arabic|عربي|العربية|السعودية)$/i.test(domain.trim());
  const arabicUrl = ARABIC_RE.test(String(url));
  return languageIsArabic || arabicCcTld || explicitArabicDomain || arabicUrl;
}

export function parseGdeltRows(text, { limit = 5 } = {}) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const firstFields = parseDelimitedLine(lines[0], delimiter);
  const headerLikely = firstFields.some((field) => /^(?:language|lang|domain|sourceurl|url|title|sqldate|globaleventid)$/i.test(field.trim()));
  const headers = headerLikely ? firstFields.map((field) => field.trim().toLowerCase()) : null;
  const records = lines.slice(headerLikely ? 1 : 0);
  const out = [];
  for (const raw of records) {
    if (!isArabicGdeltRow(raw, headers, delimiter)) continue;
    const fields = parseDelimitedLine(raw, delimiter);
    const named = headers ? Object.fromEntries(headers.map((name, index) => [name, fields[index] ?? ""])) : {};
    const url = named.sourceurl || named.url || fields.at(-1) || "";
    const domain = named.domain || (() => {
      try { return new URL(url).hostname; } catch { return ""; }
    })();
    const arabicLabel = fields.find((field) => ARABIC_RE.test(field) && field !== url);
    const title = named.title || arabicLabel || url || "GDELT Arabic row";
    const date = named.timestamp || named.date || named.sqldate || fields[1] || null;
    out.push({
      title: String(title).slice(0, 240),
      link: url || null,
      source: domain || "GDELT",
      domain: domain || null,
      date: date || null,
      language: named.language || named.lang || (domainLooksSaudi(domain) ? "ar (domain inferred)" : null),
      raw_row: raw,
    });
    if (out.length >= Math.max(0, Number(limit) || 0)) break;
  }
  return out;
}

function domainLooksSaudi(domain = "") {
  return /\.sa$/i.test(String(domain));
}

export function extractGdeltExportUrl(text) {
  const matches = [...String(text).matchAll(/https?:\/\/[^\s<>"']*?export\.CSV\.zip(?:\?[^\s<>"']*)?/gi)]
    .map((match) => match[0].replace(/[),.;]+$/, ""));
  if (!matches.length) return null;
  const stamp = (url) => /\/(\d{14})\.export\.CSV\.zip/i.exec(url)?.[1] ?? "";
  matches.sort((left, right) => stamp(left).localeCompare(stamp(right)) || left.localeCompare(right));
  return matches.at(-1);
}

export function unzipFirstCsv(buffer, { maxUncompressedBytes = 50_000_000 } = {}) {
  const zip = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65_557); index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("GDELT: ZIP end-of-central-directory غير موجود");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  let selected = null;
  for (let index = 0; index < entryCount && cursor + 46 <= zip.length; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error("GDELT: سجل ZIP المركزي غير صالح");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (!selected && /\.csv$/i.test(name)) selected = { method, compressedSize, uncompressedSize, localOffset, name };
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!selected) throw new Error("GDELT: ملف CSV غير موجود داخل ZIP");
  if (selected.uncompressedSize > maxUncompressedBytes) throw new Error(`GDELT: حجم CSV يتجاوز الحد ${maxUncompressedBytes}`);
  const offset = selected.localOffset;
  if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50) throw new Error("GDELT: ترويسة الملف المضغوط غير صالحة");
  const nameLength = zip.readUInt16LE(offset + 26);
  const extraLength = zip.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = zip.subarray(dataStart, dataStart + selected.compressedSize);
  let content;
  if (selected.method === 0) content = compressed;
  else if (selected.method === 8) content = inflateRawSync(compressed, { maxOutputLength: maxUncompressedBytes });
  else throw new Error(`GDELT: طريقة ضغط ZIP غير مدعومة (${selected.method})`);
  if (content.length > maxUncompressedBytes) throw new Error(`GDELT: الحجم بعد فك الضغط يتجاوز الحد ${maxUncompressedBytes}`);
  return { name: selected.name, text: content.toString("utf8"), bytes: content.length };
}

function decodeBingPayload(value) {
  let decoded = String(value ?? "");
  try { decoded = decodeURIComponent(decoded); } catch {}
  if (/^a1/i.test(decoded)) {
    const payload = decoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    try {
      const unpadded = payload + "=".repeat((4 - payload.length % 4) % 4);
      const unpacked = Buffer.from(unpadded, "base64").toString("utf8");
      if (/^https?:\/\//i.test(unpacked)) return unpacked;
    } catch {}
  }
  return /^https?:\/\//i.test(decoded) ? decoded : null;
}

export function unwrapBingUrl(href) {
  const raw = decodeEntities(String(href ?? "").trim());
  try {
    const parsed = new URL(raw, "https://www.bing.com");
    if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || !/\/ck\/a(?:\/|$)/i.test(parsed.pathname)) return parsed.href;
    for (const key of ["u", "url", "r"]) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      const decoded = decodeBingPayload(value);
      if (decoded) return decoded;
    }
    return parsed.href;
  } catch {
    return raw;
  }
}

function bingResultBlocks(html) {
  const source = String(html);
  const markers = [...source.matchAll(/<(?:li|div)\b[^>]*class\s*=\s*(["'])[^"']*\bb_algo\b[^"']*\1[^>]*>/gi)];
  if (markers.length) return markers.map((marker, index) => source.slice(marker.index, markers[index + 1]?.index ?? source.length));
  return [source];
}

export function parseBingHtml(html, { limit = 10, query = null } = {}) {
  const items = [];
  for (const block of bingResultBlocks(html)) {
    const headings = [...block.matchAll(/<h2\b[^>]*>[\s\S]*?<a\b([^>]*)\bhref\s*=\s*(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi)];
    const anchors = headings.length ? headings : [...block.matchAll(/<a\b([^>]*)\bhref\s*=\s*(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const anchor of anchors) {
      const href = headings.length ? anchor[3] : anchor[3];
      const title = stripMarkup(anchor[4]);
      if (!title || !href) continue;
      const link = unwrapBingUrl(href);
      let host = null;
      try { host = new URL(link).hostname; } catch {}
      if (host && /(^|\.)bing\.com$/i.test(host)) continue;
      items.push({ title, link, source: host, query });
      if (items.length >= Math.max(0, Number(limit) || 0)) return items;
    }
  }
  return items;
}

export function parseBridgeHtml(html, { limit = 5, baseUrl = "https://rss-bridge.org/bridge01/" } = {}) {
  const anchors = [...String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)];
  const items = [];
  for (const anchor of anchors) {
    const title = stripMarkup(anchor[3]);
    if (!title) continue;
    let link;
    try { link = new URL(decodeEntities(anchor[2]), baseUrl).href; } catch { continue; }
    items.push({ title, link, source: "rss-bridge.org" });
    if (items.length >= Math.max(0, Number(limit) || 0)) break;
  }
  return items;
}

export function parseBridgeResponse(body, contentType = "", options = {}) {
  const text = String(body ?? "");
  if (/xml|rss|atom/i.test(contentType) || /<rss\b|<feed\b/i.test(text)) {
    return parseRssFeed(text, options);
  }
  return parseBridgeHtml(text, options);
}
