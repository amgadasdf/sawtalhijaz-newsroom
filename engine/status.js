// engine/status.js — تقرير الحالة من state/ (حزمة B1)
// يُشغّل: node engine/status.js [--offline] أو عبر cli. قراءة فقط — لا يكتب شيئاً.
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import { nowDoc, timeLine } from "./time.js";

export async function buildStatus({ root = process.cwd(), net = false } = {}) {
  const store = createStore(root);
  const lines = [];
  const t = await nowDoc({ net, root });
  lines.push("== الحالة ==");
  lines.push(timeLine(t));

  const topics = store.readJsonSafe("state/topics.json", []);
  const topicCount = Array.isArray(topics) ? topics.length : Array.isArray(topics?.topics) ? topics.topics.length : null;
  lines.push(`topics: ${topicCount ?? "غير صالح"}`);

  const sh = store.readJsonSafe("state/sources-health.json", { sources: {} });
  const entries = Object.entries(sh?.sources ?? {});
  const enabled = entries.filter(([, v]) => v.status === "سليم");
  const disabled = entries.filter(([, v]) => v.status !== "سليم");
  const requests = entries.reduce((s, [, v]) => s + (v.requests ?? 0), 0);
  const errors = entries.reduce((s, [, v]) => s + (v.errors ?? 0), 0);
  lines.push(`sources مفعّلة: ${enabled.length}/${entries.length} (إجمالي طلبات: ${requests} | أخطاء: ${errors})`);
  if (disabled.length) lines.push(`sources معطلة: ${disabled.map(([k]) => k).join("، ")}`);

  const inv = store.readJsonSafe("state/inventory.json", {});
  lines.push(
    `inventory.urls: ${inv?.urls?.length ?? 0} | sections: ${inv?.sections?.length ?? 0} | tags: ${inv?.tags?.length ?? 0} | authors: ${inv?.authors?.length ?? 0}`
  );

  const skills = store.exists("state/skills.md") ? store.readText("state/skills.md").split("\n").length : 0;
  lines.push(`skills.md: ${skills} سطر`);

  const people = store.listPeople();
  const labs = store.listLabs();
  lines.push(`people: ${people.length} | labs: ${labs.length}`);

  const runs = store.listRuns(200);
  const last = runs[0];
  lines.push(`runs: ${runs.length} | آخر تشغيل: ${last ? `${last.file} (${last.iso} | ${last.kind} | source=${last.source})` : "—"}`);

  const openPending = [];
  for (const id of people) {
    const p = store.readPersonSafe(id);
    const pend = Array.isArray(p?.pending) ? p.pending : [];
    if (pend.length) openPending.push(`${id}(${pend.length})`);
  }
  lines.push(`معلقات مفتوحة: ${openPending.length ? openPending.join("، ") : "لا شيء"}`);

  return { lines, time: t };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const net = !process.argv.includes("--offline");
  const { lines } = await buildStatus({ net });
  for (const l of lines) console.log(l);
}
