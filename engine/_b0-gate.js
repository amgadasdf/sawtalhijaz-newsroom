// engine/_b0-gate.js — بوابة B0: صلاحية JSON (بديل YAML) + ls للشجرة + تأكيد ملفات الحوكمة
// يُشغّل مرة واحدة في B0 ثم يُحذف، صفر تبعيات، ESM.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const must = ["GOVERNANCE.md", "prompts/opening.txt", "config/desks.json", "config/sources.json", "config/geos.json"];
const ok = (b) => (b ? "✓" : "✗");

console.log("=== B0 GATE ===");

// 1) صلاحية الإعدادات (JSON) — تفكيك desks.yaml/sources.yaml البديل
for (const f of ["config/desks.json", "config/sources.json", "config/geos.json"]) {
  const p = path.join(root, f);
  const raw = fs.readFileSync(p, "utf8");
  const obj = JSON.parse(raw);
  if (f === "config/desks.json") {
    console.log(`-- ${f} (desks) --`);
    console.log(`sections: ${JSON.stringify(obj._meta.sections)}`);
    for (const d of obj.desks) console.log(`  • ${d.role.padEnd(20)} | ${d.title} | ${d.section}`);
  } else if (f === "config/sources.json") {
    console.log(`-- ${f} (sources) --`);
    console.log(`policy: ${obj._meta.policy}`);
    console.log(`default_geo: ${obj._meta.default_geo}, lang_params: ${JSON.stringify(obj._meta.lang_params)}`);
    for (const [k, v] of Object.entries(obj.sources)) {
      const flag = v.enabled ? "ON " : "off";
      const lim = v.rate_limit_per_hour;
      console.log(`  ${flag} ${k.padEnd(18)} | type=${v.type.padEnd(7)} | limit=${String(lim).padStart(2)}/h | ${v.notes}`);
    }
  } else {
    console.log(`-- ${f} (geos) --`);
    for (const g of obj.geos) console.log(`  ${g.code}${g.default ? " (default)" : ""}: ${g.label_ar} | ${JSON.stringify(g.lang_params)}`);
  }
}

// 2) ls للشجرة الكاملة (مستبعدين .git)
console.log("\n-- tree --");
function walk(dir, prefix = "") {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((it) => it.name !== ".git")
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const it of items) {
    console.log(`${prefix}${it.isDirectory() ? "📁" : "📄"} ${it.name}`);
    if (it.isDirectory()) walk(path.join(dir, it.name), prefix + "  ");
  }
}
walk(root);

// 3) تأكيد وجود الملفات الإلزامية
console.log("\n-- must-have --");
for (const f of must) {
  const exists = fs.existsSync(path.join(root, f));
  console.log(`${ok(exists)} ${f}`);
}

console.log("\n=== B0 GATE END ===");
