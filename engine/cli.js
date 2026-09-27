#!/usr/bin/env node
// engine/cli.js — واجهة أوامر المغرفة الوحيدة (B1+B2)
// أوامر: status · time · resume · settime · runs · fetch · fetch-live · selftest — صفر تبعيات، ESM.
//
//   node engine/cli.js status [--offline]
//   node engine/cli.js time [--offline]
//   node engine/cli.js resume <person|lab:<id>|radar|all> [--offline]
//   node engine/cli.js settime "<ISO>" | --clear
//   node engine/cli.js runs [n]
//   node engine/cli.js selftest [--offline] [--keep] [--no-record]
import { createStore } from "./state.js";
import { nowDoc, timeLine, setManualTime, clearManualTime, readManualTime, SKEW_THRESHOLD_SECONDS, TIME_REFERENCE_URL } from "./time.js";
import { buildResume } from "./resume.js";
import { buildStatus } from "./status.js";
import { runSelftest } from "./selftest.js";
import { createFetchers } from "./fetchers/index.js";
import { runLiveGate } from "./fetchers/live-gate.js";

const USAGE = `الاستخدام:
  node engine/cli.js status [--offline]                    تقرير الحالة من state/
  node engine/cli.js time [--offline]                      وثيقة الزمن الموثق (البروتوكول الثلاثي)
  node engine/cli.js resume <كيان|radar|all> [--offline]   سطر الاستئناف
  node engine/cli.js settime "<ISO>" [--note "…"]          تثبيت الزمن اليدوي المعتمد (عند انقطاع الشبكة)
  node engine/cli.js settime --clear                       مسح الزمن اليدوي
  node engine/cli.js runs [n]                              آخر n تشغيل (افتراضي 12)
  node engine/cli.js fetch <source-id> [--weekly]           تشغيل جالب واحد من config/sources.yaml
  node engine/cli.js fetch-live                            بوابة B2 الحية (مع fallback fixtures عند انقطاع الشبكة)
  node engine/cli.js selftest [--offline] [--keep]         بوابة B1+B2 الحتمية الإلزامية`;

const args = process.argv.slice(2);
const noteIdx = args.indexOf("--note");
// الموضعيات = كل وسيط ليس علماً، مع استبعاد قيمة --note
const positional = args.filter((a, i) => !a.startsWith("--") && (noteIdx < 0 || i !== noteIdx + 1));
const cmd = positional[0];
const net = !args.includes("--offline");
const noteVal = noteIdx >= 0 ? args[noteIdx + 1] ?? "" : "";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

switch (cmd) {
  case "status": {
    const { lines } = await buildStatus({ net });
    for (const l of lines) console.log(l);
    break;
  }

  case "time": {
    const t = await nowDoc({ net });
    console.log(timeLine(t));
    console.log(JSON.stringify(t, null, 2));
    console.log(`المرجع الحاكم: ${TIME_REFERENCE_URL} (حدّ الفارق ${SKEW_THRESHOLD_SECONDS}ث) | اليدوي: ${readManualTime()?.iso ?? "—"}`);
    break;
  }

  case "resume": {
    const name = positional[1] ?? "all";
    const { lines, unknown } = await buildResume(name, { net: false }); // الاستئناف لا ينتظر الشبكة
    for (const l of lines) console.log(l);
    if (unknown) process.exit(2);
    break;
  }

  case "settime": {
    if (args.includes("--clear")) {
      const { doc } = clearManualTime();
      console.log(`الزمن اليدوي مُسح — iso=${doc.iso ?? "—"}`);
      break;
    }
    const iso = positional[1];
    if (!iso) die(`settime يحتاج ISO. مثال: node engine/cli.js settime "2026-09-24T08:00:00Z"\n\n${USAGE}`);
    const { doc, io } = setManualTime(iso, { note: noteVal });
    console.log(
      timeLine({
        iso: doc.iso,
        source: "manual",
        skewSeconds: Math.round((new Date(doc.iso).getTime() - Date.now()) / 1000),
        note: `زمن يدوي معتمد من المالك${noteVal ? ` — ${noteVal}` : ""} — المرجع الحاكم عند انقطاع الشبكة.`,
      })
    );
    console.log(`الملف: state/time-manual.json (${io.bytes} بايت، ${io.ms}ms)`);
    break;
  }

  case "runs": {
    const n = Number(positional[1] ?? 12);
    const store = createStore(process.cwd());
    const runs = store.listRuns(Number.isFinite(n) && n > 0 ? n : 12);
    if (!runs.length) console.log("لا تشغيلات مسجلة بعد.");
    for (const r of runs) console.log(`${r.iso} | ${r.kind} | actor=${r.actor ?? "—"} | source=${r.source ?? "—"} | ${r.rel}`);
    break;
  }

  case "fetch": {
    const sourceId = positional[1];
    if (!sourceId) die(`fetch يحتاج source-id من config/sources.yaml.\n\n${USAGE}`);
    const fetchers = createFetchers();
    const fetcher = fetchers.byId[sourceId];
    if (!fetcher) die(`جالب غير معروف: ${sourceId}\nالمصادر: ${Object.keys(fetchers.byId).join(", ")}\n\n${USAGE}`);
    const maxIndex = args.indexOf("--max-items");
    const maxItems = maxIndex >= 0 ? Number(args[maxIndex + 1]) : undefined;
    const options = {
      ...(Number.isFinite(maxItems) ? { maxItems } : {}),
      ...(args.includes("--weekly") ? { mode: "weekly" } : {}),
    };
    const result = await fetcher(options);
    console.log(JSON.stringify(result, null, 2));
    process.exit(["ok", "partial", "cache", "disabled"].includes(result.status) ? 0 : 1);
    break;
  }

  case "fetch-live": {
    const result = await runLiveGate();
    process.exit(result.ok ? 0 : 1);
    break;
  }

  case "selftest": {
    const res = await runSelftest({ net, keep: args.includes("--keep"), record: !args.includes("--no-record") });
    process.exit(res.ok ? 0 : 1);
    break;
  }

  default:
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
}
