// engine/state.js — قراءة/كتابة ذرية لملفات state/ (حزمة B1)
// صفر تبعيات. الكتابة ذرية: ملف مؤقت في نفس المجلد ثم rename (نفس نظام الملفات) — لا كتابة جزئية أبداً.
import fs from "node:fs";
import path from "node:path";

export const REL = {
  topics: "state/topics.json",
  sourcesHealth: "state/sources-health.json",
  inventory: "state/inventory.json",
  skills: "state/skills.md",
  manualTime: "state/time-manual.json",
  radar: "state/radar.json",
  runsDir: "state/runs",
  peopleDir: "state/people",
  labsDir: "state/labs",
};

const ns = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createStore(root = process.cwd()) {
  const abs = (rel) => path.join(root, rel);
  const exists = (rel) => fs.existsSync(abs(rel));

  function ensureDirFor(rel) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  }

  // —— قراءة ——
  function readText(rel) {
    return fs.readFileSync(abs(rel), "utf8");
  }

  function readJson(rel) {
    return JSON.parse(readText(rel));
  }

  function readJsonSafe(rel, fallback = null) {
    try {
      return readJson(rel);
    } catch {
      return fallback;
    }
  }

  // —— كتابة ذرية ——
  function writeTextAtomic(rel, text) {
    ensureDirFor(rel);
    const tmp = `${abs(rel)}.tmp-${ns()}`;
    const t0 = performance.now();
    try {
      fs.writeFileSync(tmp, text, "utf8");
      fs.renameSync(tmp, abs(rel)); // ذرّي على نفس نظام الملفات
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {}
      throw err;
    }
    return { rel, bytes: Buffer.byteLength(text, "utf8"), ms: +((performance.now() - t0)).toFixed(3) };
  }

  function writeJsonAtomic(rel, obj) {
    return writeTextAtomic(rel, JSON.stringify(obj, null, 2) + "\n");
  }

  // تعديل دالة على نسخة من الوثيقة ثم كتابة ذرية: patchJson(rel, (doc) => {...; return doc})
  function patchJson(rel, fn) {
    const before = readJson(rel);
    const after = fn(structuredClone(before));
    if (after === undefined) throw new Error(`patchJson: الدالة لم تُعد قيمة — ${rel}`);
    return { before, doc: after, io: writeJsonAtomic(rel, after) };
  }

  // —— كيانات: أشخاص ومختبرات ——
  const personRel = (id) => `${REL.peopleDir}/${id}.json`;
  const labRel = (id) => `${REL.labsDir}/${id}/registry.json`;

  const listPeople = () =>
    fs.existsSync(abs(REL.peopleDir))
      ? fs.readdirSync(abs(REL.peopleDir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
      : [];

  const listLabs = () =>
    fs.existsSync(abs(REL.labsDir))
      ? fs.readdirSync(abs(REL.labsDir)).filter((d) => fs.existsSync(abs(labRel(d)))).sort()
      : [];

  const readPerson = (id) => readJson(personRel(id));
  const readPersonSafe = (id) => readJsonSafe(personRel(id));
  const readLab = (id) => readJsonSafe(labRel(id), null);
  const hasPerson = (id) => exists(personRel(id));
  const hasLab = (id) => exists(labRel(id));

  function patchPerson(id, fn) {
    return patchJson(personRel(id), fn);
  }

  // —— التشغيلات: state/runs/<iso>-<kind>.json ——
  function writeRun({ kind, actor = null, iso = new Date().toISOString(), source = "env", summary = "", next = "", pending = null, startedAt = null, endedAt = null, extra = {} }) {
    if (!kind) throw new Error("writeRun: kind مطلوب");
    const stamp = iso.replace(/[:.]/g, "-");
    const rel = `${REL.runsDir}/${stamp}-${kind}.json`;
    const start = startedAt ?? iso;
    const end = endedAt ?? iso;
    const doc = {
      _meta: { format: "json", notes: "سجل تشغيل — الزمن الموثق بمصدره إلزامي (بروتوكول B1 الزمني)." },
      kind,
      actor,
      iso,
      source,
      startedAt: start,
      endedAt: end,
      durationMs: Math.max(0, new Date(end).getTime() - new Date(start).getTime()),
      summary,
      next,
      pending,
      ...extra,
    };
    const io = writeJsonAtomic(rel, doc);
    return { rel, doc, io };
  }

  // تحديث كيان بعد التشغيل: person (state/people/<id>.json) أو lab بوثيقة كائنية.
  // المختبرات لاحقاً (B5+) — الآنregistry مصفوفة، فلا نكتب عليه إلا إن كان كائناً فيه lastRun.
  function patchActorAfterRun(actor, { iso, source, summary, next, pending }) {
    if (hasPerson(actor)) {
      return patchPerson(actor, (p) => {
        p.lastRun = iso;
        p.lastRunSource = source;
        p.lastSummary = summary ?? p.lastSummary ?? "";
        p.nextPlanned = next ?? p.nextPlanned ?? "";
        if (pending !== null) p.pending = pending;
        p.counters = (p.counters ?? 0) + 1;
        return p;
      });
    }
    if (hasLab(actor)) {
      const lab = readLab(actor);
      if (lab && !Array.isArray(lab)) {
        return patchJson(labRel(actor), (l) => {
          l.lastRun = iso;
          l.lastRunSource = source;
          l.lastSummary = summary ?? l.lastSummary ?? "";
          l.nextPlanned = next ?? l.nextPlanned ?? "";
          if (pending !== null) l.pending = pending;
          l.counters = (l.counters ?? 0) + 1;
          return l;
        });
      }
    }
    return null; // لا يوجد كيان مطابق — سجل التشغيل وحده كافٍ
  }

  function recordRun(opts) {
    const run = writeRun(opts);
    const actorPatch = opts.actor ? patchActorAfterRun(opts.actor, opts) : null;
    return { ...run, actorPatch };
  }

  function listRuns(limit = 20) {
    if (!fs.existsSync(abs(REL.runsDir))) return [];
    return fs
      .readdirSync(abs(REL.runsDir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        const rel = `${REL.runsDir}/${f}`;
        const doc = readJsonSafe(rel, {});
        return { file: f, rel, iso: doc.iso ?? null, kind: doc.kind ?? null, actor: doc.actor ?? null, source: doc.source ?? null };
      });
  }

  // آخر تشغيل لكيان معيّن من سجل runs (يستخدم للرادار أو أي كيان بلا ملف حالة)
  function lastRunFor(actor, limit = 50) {
    return listRuns(limit).find((r) => r.actor === actor || r.kind === actor) ?? null;
  }

  return {
    root,
    abs,
    exists,
    readText,
    readJson,
    readJsonSafe,
    writeTextAtomic,
    writeJsonAtomic,
    patchJson,
    personRel,
    labRel,
    listPeople,
    listLabs,
    readPerson,
    readPersonSafe,
    readLab,
    hasPerson,
    hasLab,
    patchPerson,
    writeRun,
    patchActorAfterRun,
    recordRun,
    listRuns,
    lastRunFor,
  };
}

// تخزين افتراضي على جذر المستودع
export const store = createStore(process.cwd());
