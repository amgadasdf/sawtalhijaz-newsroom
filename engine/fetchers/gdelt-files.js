import { extractGdeltExportUrl, parseGdeltRows, unzipFirstCsv } from "./parsers.js";

function ensureOfficialGdeltUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "data.gdeltproject.org" || !/\.export\.CSV\.zip$/i.test(url.pathname)) {
    throw new Error(`gdelt-files: URL غير متوقع من lastupdate.txt: ${url.href}`);
  }
  return url.href;
}

export function fetchGdeltFiles(runtime, { maxItems = 5, forceRefresh = false } = {}) {
  const source = runtime.source("gdelt-files");
  const cacheKey = JSON.stringify({ source: "gdelt-files", latest: "lastupdate-export-only" });
  return runtime.execute("gdelt-files", { cacheKey, maxItems, forceRefresh, requiredRequests: 2 }, async (context) => {
    const updateResponse = await context.request(source.lastupdate_url, { headers: { accept: "text/plain" } });
    const exportUrlValue = extractGdeltExportUrl(updateResponse.body);
    if (!exportUrlValue) throw new Error("gdelt-files: لم يعرض lastupdate.txt ملف export.CSV.zip");
    const exportUrl = ensureOfficialGdeltUrl(exportUrlValue);
    context.claimRunLimit("gdelt-files", 1, Number(source.max_export_files_per_run) || 1);
    const zipResponse = await context.request(exportUrl, {
      responseType: "arrayBuffer",
      headers: { accept: "application/zip, application/octet-stream" },
    });
    const zipBytes = Buffer.from(zipResponse.body);
    const csv = unzipFirstCsv(zipBytes, { maxUncompressedBytes: Number(source.max_uncompressed_bytes) || 50_000_000 });
    const parsed = parseGdeltRows(csv.text, { limit: Math.max(maxItems, 10) });
    return {
      items: parsed,
      metadata: {
        lastupdate_url: source.lastupdate_url,
        latest_export_url: exportUrl,
        downloaded_zip_bytes: zipBytes.length,
        csv_file: csv.name,
        csv_bytes: csv.bytes,
        arabic_rows_returned: parsed.length,
        files_downloaded_this_invocation: 1,
      },
    };
  });
}
