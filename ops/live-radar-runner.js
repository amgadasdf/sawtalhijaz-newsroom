#!/usr/bin/env node
// ops/live-radar-runner.js — منفّذ الرادار الحيّ على مشغّل GitHub (سحابة الشبكة المفتوحة)
// يُستدعى من .github/workflows/live-radar.yml (ملف قصير ثابت). كل المنطق هنا ليُدار بلا تعديل YAML.
// المبدأ: المحرك الحقيقي بلا تعديل، الشبكة الحقيقية من المشغّل، والنتائج تُطبع كاملة في السجل
// + artifact + محاولة دفع للفرع (best-effort). لا fixtures ولا بيانات مُصنّعة.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ROOT = process.cwd();
const mark = (id) => `<<<${id}>>>`;
const line = (t) => console.log(`\n=== ${t} ===`);

function run(args, { allowFail = true } = {}) {
  const result = spawnSync("node", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.stdout) console.log(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
  if (!allowFail && result.status !== 0) throw new Error(`فشل: node ${args.join(" ")} (exit=${result.status})`);
  return result;
}

line("ENVIRONMENT");
console.log(`runner_node=${process.version} | cwd=${ROOT} | utc=${new Date().toISOString()}`);
console.log(`github_run=${process.env.GITHUB_RUN_ID ?? "—"} | ref=${process.env.GITHUB_REF_NAME ?? "—"}`);

line("ATTESTED TIME (engine protocol)");
run(["engine/cli.js", "time"]);

line("TRI-PROBE (google / wikipedia / bing)");
const { probeConnectivity } = await import("../engine/fetchers/connectivity.js");
const probes = await probeConnectivity({ timeoutMs: 15000 });
let probeOk = 0;
for (const p of probes) {
  if (p.reachable) probeOk += 1;
  console.log(`[probe ${p.host}] reachable=${p.reachable} status=${p.status ?? "—"} ms=${p.response_ms}${p.error ? ` error=${p.error}` : ""}`);
}
console.log(`PROBE_RESULT=${probeOk}/3`);

line("RADAR (owner command, engine unmodified)");
const radar = run(["engine/cli.js", "radar", "--section", "تريند-الشارع", "--scope", "السعودية", "--depth", "سريع", "--record"]);

line("DASHBOARD");
run(["engine/cli.js", "dashboard"]);

line("RESUME LINES");
run(["engine/cli.js", "resume", "all"]);

line("LIVE RESULTS (machine-readable)");
if (existsSync(`${ROOT}/state/topics-latest.json`)) {
  const latest = JSON.parse(readFileSync(`${ROOT}/state/topics-latest.json`, "utf8"));
  const topics = Array.isArray(latest.topics) ? latest.topics : [];
  const summary = {
    ok: Boolean(latest._meta?.success),
    dataFresh: Boolean(latest._meta?.dataFresh),
    section: latest.section,
    scope: latest.scope,
    depth: latest.depth,
    time: { iso: latest.time?.iso ?? null, source: latest.time?.source ?? null, skewSeconds: latest.time?.skewSeconds ?? null, line: latest.time?.line ?? null },
    sources: { selected: latest.summary?.sourceCount ?? null, failed: latest.summary?.failedSources ?? null, statuses: latest.sourceStatuses ?? [] },
    counts: { normalizedItems: latest.summary?.normalizedItems ?? null, rawItems: latest.summary?.rawItems ?? null, topics: topics.length, inventory: latest.summary?.inventoryStatus ?? null },
    top8: [...topics]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.currentCount ?? 0) - (a.currentCount ?? 0))
      .slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title, score: t.score, classification: t.classification, saturation: t.saturationPercent ?? t.saturation ?? null, acceleration: t.acceleration ?? null, currentCount: t.currentCount ?? null, sources: t.sourceIds ?? t.sources ?? null })),
    inventory: latest.inventory ?? null,
  };
  console.log(mark("SUMMARY_JSON"));
  console.log(JSON.stringify(summary, null, 2));
  console.log(mark("FULL_LATEST_JSON"));
  console.log(JSON.stringify(latest));
  console.log(mark("END"));
} else {
  console.log("topics-latest.json غير موجود — الرادار لم يُنتج مخرجات (تحقق من السجل أعلاه).");
}

line("PUSH BACK (best-effort)");
const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
try {
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["add", "-A", "state", "out", "reports"]);
  const commit = git(["commit", "-m", "تشغيل رادار حيّ من مشغّل GitHub — نتائج حقيقية مسجلة في الذاكرة"]);
  console.log(commit.stdout || commit.stderr);
  const push = git(["push", "origin", `HEAD:${process.env.GITHUB_REF_NAME ?? "HEAD"}`]);
  console.log(`push_status=${push.status}`);
  if (push.stdout) console.log(push.stdout);
  if (push.stderr) console.log(push.stderr);
} catch (error) {
  console.log(`push-back skipped: ${error?.message ?? error}`);
}
console.log(`\nradar_exit=${radar.status} | probe=${probeOk}/3 | done`);
