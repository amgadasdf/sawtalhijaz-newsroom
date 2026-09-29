// engine/dorks.js — سجل الدوركس (حزمة B6): قراءة/تحقق/سَلسَلة/فرض قاعدة «لا استخدام بلا نتيجة اختبار».
//
// قرار B1 (المؤكد في الخطوة صفر من B4 ثم في B5): الامتداد .js حصراً في هذا المستودع — لا ملفات .mjs.
// ملاحظة نطاق: قاعدة «JSON هو صيغة الحقيقة الوحيدة» أُقرّت لإعدادات المصادر وميزانياتها (config/sources.json)
// وأُلغيت معها config/sources.yaml؛ أما سجل الدوركس فطلبته مواصفة B6 صراحةً بصيغة YAML (config/dorks.yaml)،
// ولذلك هذا الملف يحمل قارئاً صغيراً صارماً لمجموعة YAML الجزئية التي يستعملها السجل فقط (لا مكتبات خارجية).
//
// القاعدة الصلبة: أي دوركس بلا نتيجة اختبار مسجلة (hit_rate رقم + last_tested زمن) مُعطَّل،
// وselectUsableDorks/assertDorkUsable يمنعان استخدامه، ولا يوجد أي مسار آخر يقرأ السجل للتنفيذ.
import path from "node:path";
import { createStore } from "./state.js";

export const DORKS_REL = "config/dorks.yaml";
export const REGISTRY_SCHEMA_VERSION = "B6.1";
export const REQUIRED_DORK_FIELDS = Object.freeze(["id", "pattern", "engine", "category", "purpose", "hit_rate", "last_tested"]);
export const DORK_CATEGORIES = Object.freeze({
  platform: "منصات اجتماعية (X وغيرها)",
  feed: "تغذيات RSS عبر المشغّل feed:",
  telegram: "قنوات تيليجرام",
  intitle: "عنوان الصفحة (intitle:) بالعربية",
  competitor: "نطاق منافس محدد",
  official: "نطاق جهة رسمية",
  filetype: "ملفات (filetype:)",
  phrase: "مطابقة جملة حرفية",
  video: "منصات الفيديو",
  aggregator: "مجمّعات الأخبار",
});

const SCALAR_NULL = Symbol("null");

// —— قارئ YAML جزئي صارم (المجموعة الفرعية المستعملة في config/dorks.yaml فقط) ——
// المدعوم: خرائط بمستوى واحد أو مستويين، قوائم من خرائط مسطّحة، سلاسل مزدوجة/مفردة، أرقام، true/false، null، تعليقات كاملة السطر.
// غير المدوَّم يُرفض برسالة صريحة مع رقم السطر — لا تصمت أبداً على صيغة غير مفهومة.
export function parseDorksYaml(text) {
  const lines = String(text ?? "").split(/\r?\n/u);
  const root = {};
  let currentKey = null;
  let currentItem = null;
  let currentItemIndent = null;

  const fail = (lineNumber, message) => {
    throw new Error(`config/dorks.yaml: سطر ${lineNumber}: ${message}`);
  };

  const stripInlineComment = (value, lineNumber) => {
    const trimmed = value.trim();
    if (trimmed.startsWith("\"") || trimmed.startsWith("'")) return trimmed;
    const match = /\s#/u.exec(trimmed);
    if (match) return trimmed.slice(0, match.index).trim();
    if (trimmed.startsWith("#")) fail(lineNumber, "تعليق في موضع قيمة");
    return trimmed;
  };

  const parseScalar = (raw, lineNumber) => {
    const value = stripInlineComment(raw, lineNumber);
    if (value === "" ) return "";
    if (value === "null" || value === "~") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+$/u.test(value)) return Number(value);
    if (/^-?\d+\.\d+$/u.test(value)) return Number(value);
    if (value.startsWith("\"")) {
      if (!value.endsWith("\"") || value.length < 2) fail(lineNumber, "سلسلة مزدوجة غير مغلقة");
      return value.slice(1, -1).replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\");
    }
    if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) fail(lineNumber, "سلسلة مفردة غير مغلقة");
      return value.slice(1, -1).replace(/''/gu, "'");
    }
    if (/[{}\[\]|>&*!%@`]/u.test(value)) fail(lineNumber, `صيغة YAML غير مدعومة في هذه المجموعة الفرعية: ${value}`);
    return value;
  };

  const assignKeyValue = (target, content, lineNumber, indent) => {
    const match = /^([A-Za-z0-9_\-]+):(?:\s+(.*))?$/u.exec(content);
    if (!match) fail(lineNumber, `ليس مفتاحاً ولا عنصر قائمة: ${content}`);
    const key = match[1];
    const rawValue = match[2];
    if (rawValue === undefined || rawValue.trim() === "") {
      target[key] = {}; // كتلة متداخلة تُملأ بالأسطر التالية
      return { key, nested: true, indent };
    }
    target[key] = parseScalar(rawValue, lineNumber);
    return { key, nested: false, indent };
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    if (rawLine.includes("\t")) fail(lineNumber, "المسافات البادئة يجب أن تكون مسافات لا TAB");
    const withoutTrailing = rawLine.replace(/\s+$/u, "");
    if (withoutTrailing.trim() === "" || withoutTrailing.trim().startsWith("#")) continue;
    const indent = withoutTrailing.length - withoutTrailing.trimStart().length;
    if (indent % 2 !== 0) fail(lineNumber, `إزاحة غير مضاعفة لـ2: ${indent}`);
    const content = withoutTrailing.trim();

    if (indent === 0) {
      if (content.startsWith("- ")) fail(lineNumber, "عنصر قائمة في المستوى الأعلى غير مدعوم");
      const assigned = assignKeyValue(root, content, lineNumber, indent);
      currentKey = assigned.key;
      currentItem = null;
      currentItemIndent = null;
      continue;
    }
    if (currentKey === null) fail(lineNumber, "سطر متداخل بلا مفتاح أعلى");

    if (content.startsWith("- ")) {
      if (currentItemIndent !== null && indent !== currentItemIndent) {
        fail(lineNumber, `قائمة فرعية أو إزاحة مختلطة غير مدعومة (المتوقع ${currentItemIndent})`);
      }
      const list = (root[currentKey] = Array.isArray(root[currentKey]) ? root[currentKey] : []);
      currentItem = {};
      currentItemIndent = indent;
      list.push(currentItem);
      const assigned = assignKeyValue(currentItem, content.slice(2).trim(), lineNumber, indent);
      if (assigned.nested) fail(lineNumber, "كتلة متداخلة داخل عنصر قائمة غير مدعومة في هذه المجموعة الفرعية");
      continue;
    }
    if (currentItem) {
      if (indent !== currentItemIndent + 2) {
        fail(lineNumber, `حقول عنصر القائمة يجب أن تكون بإزاحة ${currentItemIndent + 2} (وجد ${indent})`);
      }
      const assigned = assignKeyValue(currentItem, content, lineNumber, indent);
      if (assigned.nested) fail(lineNumber, "كتلة متداخلة داخل عنصر قائمة غير مدعومة في هذه المجموعة الفرعية");
      continue;
    }
    const container = root[currentKey];
    if (container === null || typeof container !== "object" || Array.isArray(container)) {
      root[currentKey] = {};
    }
    assignKeyValue(root[currentKey], content, lineNumber, indent);
  }
  return root;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (text === "") return "\"\"";
  if (/^[A-Za-z0-9\u0600-\u06FF _.\-/]+$/u.test(text) && !/^[\d.-]+$/u.test(text) && !["null", "true", "false"].includes(text)) return text;
  return `'${text.replace(/'/gu, "''")}'`;
}

// سَلسَلة المجموعة الفرعية نفسها (تُستعمل عند تسجيل نتيجة اختبار دوركس) — مدوّرة: parse(serialize(doc)) === doc
export function serializeDorksYaml(doc) {
  if (!doc || typeof doc !== "object") throw new Error("serializeDorksYaml: وثيقة مطلوبة");
  const out = ["# سجل الدوركس — حزمة B6 (يُحدَّث آلياً عبر engine/dorks.js عند تسجيل نتيجة اختبار)"];
  const write = (value, indent) => {
    const pad = " ".repeat(indent);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item);
          entries.forEach(([key, child], position) => {
            const prefix = position === 0 ? `${pad}- ` : `${pad}  `;
            out.push(`${prefix}${key}: ${formatScalar(child)}`);
          });
        } else {
          out.push(`${pad}- ${formatScalar(item)}`);
        }
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === "object") {
          out.push(`${pad}${key}:`);
          write(child, indent + 2);
        } else {
          out.push(`${pad}${key}: ${formatScalar(child)}`);
        }
      }
      return;
    }
    out.push(`${pad}${formatScalar(value)}`);
  };
  write(doc, 0);
  return `${out.join("\n")}\n`;
}

// —— التحقق من بنية السجل ——
export function normalizeHitRate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function validateDorksRegistry(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["السجل ليس وثيقة كائنية"], dorks: [] };
  const meta = doc._meta ?? {};
  if (meta.format !== "yaml") errors.push("_meta.format يجب أن يكون yaml");
  if (String(meta.rule ?? "").trim() === "") errors.push("_meta.rule مفقود: قاعدة منع الاستخدام بلا نتيجة اختبار");
  const dorks = Array.isArray(doc.dorks) ? doc.dorks : null;
  if (!dorks) return { ok: false, errors: [...errors, "لا قائمة dorks في السجل"], dorks: [] };
  const seen = new Set();
  dorks.forEach((dork, index) => {
    const where = `dorks[${index}]`;
    for (const field of REQUIRED_DORK_FIELDS) {
      if (!Object.hasOwn(dork ?? {}, field)) errors.push(`${where}: الحقل الإلزامي ${field} مفقود`);
    }
    const id = String(dork?.id ?? "").trim();
    if (!id) errors.push(`${where}: id فارغ`);
    else if (seen.has(id)) errors.push(`${where}: id مكرر (${id})`);
    seen.add(id);
    const pattern = String(dork?.pattern ?? "").trim();
    if (!pattern) errors.push(`${where}: pattern فارغ`);
    if (!DORK_CATEGORIES[String(dork?.category ?? "")]) errors.push(`${where}: category غير معروفة (${dork?.category ?? "—"})`);
    if (String(dork?.engine ?? "").trim() === "") errors.push(`${where}: engine مفقود`);
    if (String(dork?.purpose ?? "").trim().length < 10) errors.push(`${where}: purpose قصير/فارغ`);
    const hitRate = normalizeHitRate(dork?.hit_rate);
    if (dork?.hit_rate !== null && dork?.hit_rate !== undefined && String(dork.hit_rate).trim() !== "" && hitRate === null) {
      errors.push(`${where}: hit_rate ليس رقماً ولا فارغاً (${dork?.hit_rate})`);
    }
    if (hitRate !== null && (hitRate < 0 || hitRate > 100)) errors.push(`${where}: hit_rate خارج [0,100]`);
    if (dork?.last_tested !== null && dork?.last_tested !== undefined && String(dork.last_tested).trim() !== "" && Number.isNaN(Date.parse(String(dork.last_tested)))) {
      errors.push(`${where}: last_tested ليس زمناً صالحاً ولا null (${dork?.last_tested})`);
    }
  });
  return { ok: errors.length === 0, errors, dorks };
}

// —— قاعدة المنع: دوركس بلا نتيجة اختبار مسجلة = معطّل ——
export function dorkIsUsable(dork) {
  const hitRate = normalizeHitRate(dork?.hit_rate);
  const lastTested = dork?.last_tested === null || dork?.last_tested === undefined || String(dork.last_tested).trim() === "" ? null : String(dork.last_tested);
  return hitRate !== null && lastTested !== null && !Number.isNaN(Date.parse(lastTested));
}

export function dorkStatusLabel(dork) {
  return dorkIsUsable(dork) ? "مسموح" : "غير مسموح — بلا نتيجة اختبار مسجلة";
}

export function selectUsableDorks(doc, { engine = null, category = null } = {}) {
  const { dorks } = validateDorksRegistry(doc);
  return dorks.filter((dork) => dorkIsUsable(dork)
    && (!engine || String(dork.engine) === String(engine))
    && (!category || String(dork.category) === String(category)));
}

export function assertDorkUsable(dork) {
  const id = String(dork?.id ?? "(بلا معرّف)");
  if (!dorkIsUsable(dork)) {
    throw new Error(
      `ممنوع استخدام الدوركس ${id}: لا نتيجة اختبار مسجلة (hit_rate=${dork?.hit_rate ?? "فارغ"} · last_tested=${dork?.last_tested ?? "null"}). ` +
        "سجّل النتيجة أولاً: node engine/cli.js dorks --record " + id + " --hit-rate <0-100> --evidence \"…\"",
    );
  }
  return true;
}

export function recordDorkTestResult(doc, dorkId, { hitRatePercent, testedAtIso, evidence = "" } = {}) {
  const id = String(dorkId ?? "").trim();
  if (!id) throw new Error("recordDorkTestResult: dork-id مطلوب");
  const dorks = Array.isArray(doc?.dorks) ? doc.dorks.map((dork) => ({ ...dork })) : [];
  const target = dorks.find((dork) => String(dork.id) === id);
  if (!target) throw new Error(`recordDorkTestResult: دوركس غير موجود في السجل (${id})`);
  const hitRate = normalizeHitRate(hitRatePercent);
  if (hitRate === null || hitRate < 0 || hitRate > 100) throw new Error(`recordDorkTestResult: نسبة إصابة غير صالحة (${hitRatePercent}) — المطلوب رقم بين 0 و100`);
  const testedAt = String(testedAtIso ?? "").trim();
  if (!testedAt || Number.isNaN(Date.parse(testedAt))) throw new Error(`recordDorkTestResult: زمن اختبار غير صالح (${testedAtIso ?? "—"})`);
  target.hit_rate = hitRate;
  target.last_tested = new Date(testedAt).toISOString();
  if (evidence) target.last_test_evidence = String(evidence);
  const next = { ...doc, dorks };
  next._meta = { ...(doc?._meta ?? {}), updated_at: new Date(testedAt).toISOString() };
  return { doc: next, dork: target, io: null };
}

export function loadDorksRegistry({ root = process.cwd() } = {}) {
  const store = createStore(root);
  const text = store.readText(DORKS_REL);
  const doc = parseDorksYaml(text);
  const validation = validateDorksRegistry(doc);
  return { doc, text, ...validation, usable: validation.dorks.filter(dorkIsUsable) };
}

export function dorksSummary(doc) {
  const { dorks, errors, ok } = validateDorksRegistry(doc);
  return {
    ok,
    total: dorks.length,
    usable: dorks.filter(dorkIsUsable).length,
    blocked: dorks.filter((dork) => !dorkIsUsable(dork)).length,
    byCategory: dorks.reduce((acc, dork) => ({ ...acc, [dork.category]: (acc[dork.category] ?? 0) + 1 }), {}),
    errors,
  };
}

export function writeDorksRegistry({ root = process.cwd(), doc } = {}) {
  const store = createStore(root);
  const validation = validateDorksRegistry(doc);
  if (!validation.ok) throw new Error(`writeDorksRegistry: السجل غير صالح — ${validation.errors.join(" | ")}`);
  const io = store.writeTextAtomic(DORKS_REL, serializeDorksYaml(doc));
  return { io, rel: DORKS_REL, bytes: io.bytes };
}

// —— واجهة سطر الأوامر (يشترك فيها engine/dorks.js وengine/cli.js dorks) ——
export const DORKS_USAGE = `الاستخدام:
  node engine/cli.js dorks --validate                  التحقق من بنية config/dorks.yaml
  node engine/cli.js dorks --usable [--engine bing]    الدوركس المسموح باستخدامه (له نتيجة اختبار مسجلة)
  node engine/cli.js dorks --record <id> --hit-rate <0-100> [--evidence "…"] [--at <ISO>]
                                                       تسجيل نتيجة اختبار دوركس (يفتحه للاستخدام)`;

export function runDorksCli({ root = process.cwd(), argv = [], log = console.log } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const flag = (name, fallback = null) => {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : null;
    return value && !value.startsWith("--") ? value : fallback;
  };
  const { doc, text, ok, errors, dorks, usable } = loadDorksRegistry({ root });
  if (args.includes("--record")) {
    const id = flag("--record");
    if (!id) throw new Error(`--record يحتاج معرّف دوركس\n\n${DORKS_USAGE}`);
    const recorded = recordDorkTestResult(doc, id, {
      hitRatePercent: flag("--hit-rate"),
      testedAtIso: flag("--at", new Date().toISOString()),
      evidence: flag("--evidence", ""),
    });
    const written = writeDorksRegistry({ root, doc: recorded.doc });
    log(`سُجّلت نتيجة اختبار ${id}: hit_rate=${recorded.dork.hit_rate} | last_tested=${recorded.dork.last_tested}`);
    log(`كُتب ${written.rel} (${written.bytes} بايت، كتابة ذرية) — الدوركس صار مسموحاً باستخدامه.`);
  } else if (args.includes("--usable")) {
    const engine = flag("--engine");
    const list = selectUsableDorks(doc, { engine });
    log(`الدوركس المسموح باستخدامه${engine ? ` (محرك ${engine})` : ""}: ${list.length} من ${dorks.length}`);
    for (const dork of list) log(`- ${dork.id} | ${dork.pattern} | hit_rate=${dork.hit_rate} | آخر اختبار=${dork.last_tested}`);
    if (!list.length) log("لا يوجد دوركس مسموح: كل الأنماط بلا نتيجة اختبار مسجلة — القاعدة تمنع استخدامها.");
  } else {
    const summary = dorksSummary(doc);
    log(`config/dorks.yaml: ${text.split("\n").length - 1} سطراً | بنية ${ok ? "سليمة" : "مكسورة"} | دوركس ${summary.total} | مسموح ${summary.usable} | معطّل ${summary.blocked}`);
    log(`التصنيفات: ${Object.entries(summary.byCategory).map(([key, count]) => `${key}=${count}`).join(" · ")}`);
    for (const error of errors) log(`✗ ${error}`);
    for (const dork of dorks) log(`- ${dork.id} | ${dork.engine} | ${dorkStatusLabel(dork)} | ${dork.pattern}`);
  }
  return ok ? 0 : 1;
}

function pathToFileURLSafe(file) {
  return { href: new URL(`file://${path.resolve(String(file))}`).href };
}
