// Public B3 radar entry point; implementation lives in radar.mjs and is also used by the unified CLI.
import { pathToFileURL } from "node:url";
import { runRadar } from "./radar.mjs";
import { runB3FixtureGate } from "./radar-selftest.mjs";

export * from "./radar.mjs";

function option(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--fixtures") || args.includes("--offline")) {
    const gate = await runB3FixtureGate();
    process.exit(gate.ok ? 0 : 1);
  }
  const sourceIds = option(args, "--sources", null)?.split(/[;,،]/u).map((entry) => entry.trim()).filter(Boolean) ?? null;
  const result = await runRadar({
    section: option(args, "--section", "تريند-الشارع"),
    scope: option(args, "--scope", "daily"),
    depth: option(args, "--depth", "quick"),
    sourceIds,
    net: !args.includes("--offline"),
  });
  for (const line of result.lines) console.log(line);
  for (const source of result.sourceStatuses) console.log(`[${source.sourceId}] ${source.status} | count=${source.count} | requests=${source.requestCount}${source.error ? ` | ${source.error}` : ""}`);
  console.log(`topics=${result.topics.length} | state/topics-latest.json | run=${result.run.rel}`);
  process.exit(result.ok ? 0 : 1);
}
