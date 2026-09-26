// engine/resume.js — سطر الاستئناف لكل كيان (حزمة B1)
// يُطبع في كل جلسة جديدة: أين توقفنا بالضبط وما التالي المخطط.
// لا ينتظر الشبكة افتراضياً (net=false) — الحساب من ساعة البيئة وسجل التشغيل.
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc } from "./time.js";

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);
const hoursSince = (iso, nowIso) => (iso ? +((new Date(nowIso).getTime() - new Date(iso).getTime()) / 3600000).toFixed(1) : null);
const absence = (iso, nowIso) => {
  const h = hoursSince(iso, nowIso);
  return h === null ? "—" : `${h} س`;
};

export function personLine(id, { store, nowIso }) {
  const p = store.readPersonSafe(id);
  if (!p) return `الاستئناف (${id}): ملف الكيان غير موجود.`;
  const pending = Array.isArray(p.pending) ? p.pending : [];
  return (
    `الاستئناف (${id}) — الدور: ${p.role ?? id} — ${p.title ?? "—"} | ` +
    `آخر تشغيل: ${dash(p.lastRun)} | آخر ملخص: ${dash(p.lastSummary)} | التالي المخطط: ${dash(p.nextPlanned)} | ` +
    `المعلقات (${pending.length}): ${pending.length ? pending.join("، ") : "—"} | العدّاد: ${p.counters ?? 0} | ` +
    `غياب منذ آخر تشغيل: ${absence(p.lastRun, nowIso)}`
  );
}

export function labLine(id, { store, nowIso }) {
  const reg = store.readLab(id);
  let lastRun = null;
  let summary = null;
  let pending = [];
  let counters = 0;
  let empty = true;

  if (Array.isArray(reg)) {
    const entries = reg.filter((e) => e && typeof e === "object");
    const last = [...entries].reverse().find((e) => e.iso || e.lastRun);
    empty = entries.length === 0;
    lastRun = last?.iso ?? last?.lastRun ?? null;
    summary = last?.summary ?? null;
    pending = Array.isArray(last?.pending) ? last.pending : [];
    counters = entries.length;
  } else if (reg && typeof reg === "object") {
    empty = !reg.lastRun && !(reg.runs?.length);
    lastRun = reg.lastRun ?? null;
    summary = reg.lastSummary ?? null;
    pending = Array.isArray(reg.pending) ? reg.pending : [];
    counters = reg.counters ?? 0;
  }

  return (
    `الاستئناف (مختبر ${id}) — ${empty ? "فارغ" : "مسجّل"} | آخر تشغيل: ${dash(lastRun)} | آخر ملخص: ${dash(summary)} | ` +
    `التالي المخطط: ${dash(reg?.nextPlanned)} | المعلقات (${pending.length}): ${pending.length ? pending.join("، ") : "—"} | ` +
    `العدّاد: ${counters} | غياب: ${absence(lastRun, nowIso)}`
  );
}

export function radarLine({ store, nowIso }) {
  const file = store.readJsonSafe("state/radar.json", null);
  const fromRuns = store.lastRunFor("radar");
  const lastRun = file?.lastRun ?? fromRuns?.iso ?? null;
  const summary = file?.lastSummary ?? null;
  const pending = Array.isArray(file?.pending) ? file.pending : [];
  const counters = file?.counters ?? 0;
  if (!lastRun && !summary) return `الاستئناف (radar): لا تشغيل سابق.`;
  return (
    `الاستئناف (radar) — آخر تشغيل: ${dash(lastRun)} | آخر ملخص: ${dash(summary)} | التالي المخطط: ${dash(file?.nextPlanned)} | ` +
    `المعلقات (${pending.length}): ${pending.length ? pending.join("، ") : "—"} | العدّاد: ${counters} | غياب: ${absence(lastRun, nowIso)}`
  );
}

// name: person id | "lab:<id>" | "<id>" (يُفحص كشخص ثم كمختبر) | "radar" | "all"
export async function buildResume(name = "all", { root = process.cwd(), net = false } = {}) {
  const store = createStore(root);
  const t = await nowDoc({ net, root });
  const nowIso = t.iso;
  const target = (name ?? "all").trim();
  const lines = [];

  if (target === "all") {
    lines.push(radarLine({ store, nowIso }));
    for (const id of store.listPeople()) lines.push(personLine(id, { store, nowIso }));
    for (const id of store.listLabs()) lines.push(labLine(id, { store, nowIso }));
    return { lines, time: t };
  }
  if (target === "radar") return { lines: [radarLine({ store, nowIso })], time: t };

  const labId = target.startsWith("lab:") ? target.slice(4) : store.hasPerson(target) ? null : target;
  if (labId && store.hasLab(labId)) return { lines: [labLine(labId, { store, nowIso })], time: t };
  if (store.hasPerson(target)) return { lines: [personLine(target, { store, nowIso })], time: t };

  const known = [...store.listPeople(), ...store.listLabs().map((l) => `lab:${l}`), "radar", "all"];
  return { lines: [`لا كيان بهذا الاسم: ${target}. المتاح: ${known.join("، ")}`], time: t, unknown: true };
}

// تشغيل مباشر: node engine/resume.js [name]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2] ?? "all";
  const { lines } = await buildResume(name);
  for (const l of lines) console.log(l);
}
