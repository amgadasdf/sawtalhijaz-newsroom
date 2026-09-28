// engine/selftest.js — بوابة B1 + B2 + B3 الحتمية (شبكة محقونة لبوابتي الجالبات والرادار)
// يثبت في بيئة معزولة: كتابة→تعديل→قراءة→سجل تشغيل→سطر استئناف كامل→بنية الزمن، ثم B2/B3 بلا شبكة.
// لا يمسّ state الحقيقي إلا بسطر سجل تشغيل واحد يمثل تشغيل البوابة — ويُمنع بـ --no-record.
// مخلفات اختبار B1: state/runs/_selftest/<stamp>/ (مستبعدة من git).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc, timeLine, TIME_SOURCES, setManualTime, clearManualTime } from "./time.js";
import { buildResume } from "./resume.js";
import { runFetchersSelftest } from "./fetchers/selftest.js";
import { runB3FixtureGate } from "./radar-selftest.mjs";

const ok = (b) => (b ? "✓" : "✗");

export async function runSelftest({ root = process.cwd(), net = true, keep = false, record = true } = {}) {
  const startedAt = new Date();
  const t0 = performance.now();
  const checks = {};
  const out = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  say("== B1 + B2 + B3 SELFTEST ==");

  // — 1) البروتوكول الزمني —
  const t = await nowDoc({ net, root });
  say(timeLine(t));
  say("— بنية الزمن —");
  for (const k of ["iso", "source", "skewSeconds", "envIso", "headerIso", "note"]) say(`${k}=${t[k]}`);
  const isoParses = !Number.isNaN(new Date(t.iso).getTime());
  const timeStructureOK =
    isoParses &&
    TIME_SOURCES.includes(t.source) &&
    typeof t.skewSeconds === "number" &&
    typeof t.envIso === "string" &&
    typeof t.note === "string" &&
    (t.source !== "header" || typeof t.headerIso === "string") &&
    (t.source !== "manual" || typeof t.manualIso === "string");
  checks.timeStructureOK = timeStructureOK;

  // — 2) بيئة معزولة —
  const stamp = t.iso.replace(/[:.]/g, "-");
  const sandbox = path.join(root, "state", "runs", "_selftest", stamp);
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(path.join(sandbox, "state", "people"), { recursive: true });
  fs.mkdirSync(path.join(sandbox, "state", "runs"), { recursive: true });
  fs.mkdirSync(path.join(sandbox, "state", "labs", "discovery"), { recursive: true });
  fs.copyFileSync(path.join(root, "state", "people", "exec-editor.json"), path.join(sandbox, "state", "people", "exec-editor.json"));
  fs.copyFileSync(path.join(root, "state", "topics.json"), path.join(sandbox, "state", "topics.json"));
  fs.writeFileSync(path.join(sandbox, "state", "labs", "discovery", "registry.json"), "[]\n", "utf8");
  say(`\nالبيئة المعزولة: ${path.relative(root, sandbox)}`);

  const st = createStore(sandbox);
  const personRel = st.personRel("exec-editor");
  say(`person.path: ${personRel}`);

  // — 2.5) حالات البروتوكول الأربع (حتمية، بحقن fetch — لا تعتمد على الشبكة) —
  say("\n— حالات البروتوكول (محقونة) —");
  const envNow = () => new Date().toISOString();
  const stub = (offsetSeconds, { fail = false } = {}) => async () => {
    if (fail) throw Object.assign(new Error("connection reset"), { name: "TypeError", cause: { code: "ECONNRESET" } });
    const d = new Date(Date.now() + offsetSeconds * 1000);
    return { status: 200, headers: { get: (h) => (h.toLowerCase() === "date" ? d.toUTCString() : null) } };
  };

  clearManualTime(sandbox);
  const pEnv = await nowDoc({ net: true, root: sandbox, fetchImpl: stub(0) });
  const pHeader = await nowDoc({ net: true, root: sandbox, fetchImpl: stub(90) });
  const pUnverified = await nowDoc({ net: true, root: sandbox, fetchImpl: stub(0, { fail: true }) });
  setManualTime(new Date(Date.now() + 7908 * 1000).toISOString(), { root: sandbox, note: "محاكاة إدخال المالك" });
  const pManual = await nowDoc({ net: true, root: sandbox, fetchImpl: stub(0, { fail: true }) });
  clearManualTime(sandbox);

  for (const p of [pEnv, pHeader, pManual, pUnverified]) {
    say(`${p.source.padEnd(11)} iso=${p.iso} skew=${p.skewSeconds}ث headerIso=${p.headerIso ?? "—"}`);
  }
  checks.protocolEnv = pEnv.source === "env" && pEnv.headerIso !== null;
  checks.protocolHeader = pHeader.source === "header" && pHeader.iso === pHeader.headerIso && Math.abs(pHeader.skewSeconds) >= 89;
  checks.protocolManual = pManual.source === "manual" && Math.abs(pManual.skewSeconds - 7908) <= 5;
  checks.protocolUnverified = pUnverified.source === "unverified" && pUnverified.headerIso === null && pUnverified.note.includes("غير موثق");

  // — 3) كتابة ذرية —
  const w1 = st.writeJsonAtomic(personRel, st.readJson(personRel));
  const w2 = st.writeTextAtomic("state/topics.json", JSON.stringify([{ id: "t-selftest", title: "[selftest] موضوع تجريبي", createdIso: t.iso }], null, 2) + "\n");
  const readBack = st.readJson("state/topics.json");
  const atomicOK = w1.bytes > 0 && w2.bytes > 0 && Array.isArray(readBack) && readBack.length === 1 && !fs.readdirSync(path.join(sandbox, "state")).some((f) => f.includes(".tmp-"));
  checks.atomicOK = atomicOK;

  // — 4) تعديل —
  const p1 = st.patchPerson("exec-editor", (p) => {
    p.lastSummary = "[selftest] B1 patch نجح";
    p.nextPlanned = "[selftest] تحقق القراءة";
    return p;
  });
  const patchOK = p1.doc.lastSummary === "[selftest] B1 patch نجح" && p1.io.bytes > 0;
  checks.patchOK = patchOK;

  // — 5) سجل تشغيل —
  const rec = st.recordRun({
    kind: "B1-selftest",
    actor: "exec-editor",
    iso: t.iso,
    source: t.source,
    summary: "[selftest] B1 patch نجح",
    next: "[selftest] تحقق القراءة",
    pending: ["B1-selftest"],
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    extra: { sandbox: path.relative(root, sandbox), checks: {} },
  });
  const runFileExists = st.exists(rec.rel);
  const counterOK = st.readPerson("exec-editor").counters === (p1.doc.counters ?? 0) + 1;
  checks.runOK = runFileExists && counterOK;
  say(`recorded-run: ${rec.rel}`);

  // — 6) سطر الاستئناف —
  const r = await buildResume("exec-editor", { root: sandbox, net: false });
  const line = r.lines[0] ?? "";
  say("\n— سطر الاستئناف —");
  say(line);
  const resumeOK = line.includes("الاستئناف (exec-editor)") && line.includes("آخر تشغيل:") && line.includes("التالي المخطط:") && line.includes("غياب");
  checks.resumeOK = resumeOK;
  const allLine = (await buildResume("all", { root: sandbox, net: false })).lines;
  const allOK = allLine.length === 3; // radar + شخص + مختبر
  checks.allOK = allOK;

  // — 6.5) بوابة B2 الحتمية — عينات ثابتة + fetch محقون بلا شبكة —
  say("\n— بوابة جالبات B2 (fixtures + fetch injection) —");
  const fetchersGate = await runFetchersSelftest({ root });
  checks.fetchersB2 = fetchersGate.ok;

  // — 6.75) بوابة B3 المتكاملة (كل المصادر وخريطة الموقع محقونة في مسار معزول) —
  say("\n— بوابة الرادار B3 (fixtures معزولة + fetch injection) —");
  const radarGate = await runB3FixtureGate({ root });
  checks.radarB3 = radarGate.ok;

  // — 7) تنظيف —
  if (keep) {
    say(`\n(--keep: البيئة المعزولة محفوظة في ${path.relative(root, sandbox)})`);
  } else {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // — 8) سجل تشغيل البوابة في state الحقيقي —
  const totalMs = +((performance.now() - t0)).toFixed(0);
  const passed = Object.values(checks).every(Boolean);
  const realStore = createStore(root);
  let registryRun = null;
  if (record) {
    registryRun = realStore.recordRun({
      kind: "B3-selftest",
      actor: null, // سجل بوابة فقط: لا يعدّل عدّادات أي كيان حقيقي
      iso: t.iso,
      source: t.source,
      summary: `[selftest] بوابة B1+B2+B3 — ${passed ? "خضراء" : "حمراء"} — ${Object.entries(checks).map(([k, v]) => `${k}=${ok(v)}`).join(" ")}`,
      next: "",
      pending: passed ? [] : ["إصلاح فاشل البوابة ثم إعادة selftest"],
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      extra: { gate: "B1+B2+B3", checks, net, totalMs },
    });
  }

  // — 9) الحكم —
  say("\n— تحقق البنية —");
  for (const [k, v] of Object.entries(checks)) say(`${k}=${ok(v)}`);
  say(`totalMs=${totalMs}`);
  if (registryRun) say(`سجل التشغيل: ${registryRun.rel}`);
  say(`\nالنتيجة: ${passed ? "خضراء — بوابات B1+B2+B3 مقفلة" : "حمراء — لا تُقفل B1+B2+B3"}`);
  say("== B1 + B2 + B3 SELFTEST END ==");

  return { ok: passed, checks, time: t, lines: out, totalMs, run: registryRun };
}

// تشغيل مباشر: node engine/selftest.js [--offline] [--keep] [--no-record]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = await runSelftest({
    net: !process.argv.includes("--offline"),
    keep: process.argv.includes("--keep"),
    record: !process.argv.includes("--no-record"),
  });
  process.exit(res.ok ? 0 : 1);
}
