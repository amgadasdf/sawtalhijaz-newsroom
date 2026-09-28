// B5 gate: validates the 14 role/lab/resume/Jules prompts and exercises the radar analyst
// prompt against the exact isolated B3 fixture coordinator (injected fixture fetch only).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withB3FixtureRadar } from "./radar-selftest.js";

export const B5_PROMPT_FILES = Object.freeze([
  "prompts/people/chief-editor.md",
  "prompts/people/radar-analyst.md",
  "prompts/people/saturation-monitor.md",
  "prompts/people/decisions-editor.md",
  "prompts/people/trend-editor.md",
  "prompts/people/sport-editor.md",
  "prompts/people/headlines-editor.md",
  "prompts/people/verification-unit.md",
  "prompts/labs/discovery.md",
  "prompts/labs/measurement.md",
  "prompts/labs/extraction.md",
  "prompts/labs/advanced-search.md",
  "prompts/resume-generic.txt",
  "prompts/jules-mission-template.md",
]);

const ROLE_AND_LAB_FILES = B5_PROMPT_FILES.slice(0, 12);
const REQUIRED_ROLE_SECTIONS = [
  "## الهوية والرتبة",
  "## المصادر المسموحة حصراً",
  "## شكل المخرج الإلزامي — القالب",
  "## معايير القبول",
  "## ممنوعات",
];

function check(log, checks, name, fn, detail = "") {
  try {
    const result = fn();
    checks[name] = result !== false;
    log(`${name}=${checks[name] ? "✓" : "✗"}${detail ? ` | ${detail}` : ""}`);
  } catch (error) {
    checks[name] = false;
    log(`${name}=✗ | ${error?.message ?? error}`);
  }
}

function numberText(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "غير متاح";
}

export function formatRadarAnalystTrial(latest) {
  const time = latest?.time ?? {};
  const topics = Array.isArray(latest?.topics) ? latest.topics : [];
  const lines = [
    "حالة البيانات: تجربة على بيانات معزولة — غير حية",
    `زمن التشغيل ومصدره: ${time.iso ?? "غير متاح"} | ${time.source ?? "غير متاح"}`,
    "المواضيع (كل ما في الملف، بالترتيب الأصلي):",
  ];
  topics.forEach((topic, index) => {
    const metrics = topic?.metrics ?? {};
    lines.push(
      `${index + 1}) ${topic?.id ?? "غير متاح"} | ${topic?.title ?? "غير متاح"} | OpportunityScore=${numberText(topic?.score)} (ترتيب فقط) | التسارع=${numberText(metrics.accelerationPerHour ?? topic?.acceleration)} | التشبع=${numberText(metrics.saturationPercent ?? topic?.saturation)}% | التصنيف=${metrics.classification ?? topic?.classification ?? "غير متاح"}`,
    );
  });
  const golden = topics.filter((topic) => topic?.metrics?.classificationKey === "golden");
  lines.push("النوافذ الذهبية والمتابعة:");
  if (golden.length) {
    for (const topic of golden) {
      const metrics = topic.metrics;
      lines.push(
        `- ${topic.id} | سبب المطابقة: تسارع موجب ${numberText(metrics.accelerationPerHour)} وتشبع ${numberText(metrics.saturationPercent)}% (<25%) | متابعة مقترحة: رصد تغير التسارع والتشبع في التشغيل التالي؛ لا يعني ذلك قرار نشر.`,
      );
    }
  } else {
    lines.push("- لا توجد نافذة ذهبية مطابقة (لا يوجد موضوع يجمع تسارعاً موجباً وتشبعاً أقل من 25%).");
  }
  lines.push("بيانات غير متاحة/قيود: البيانات ناتجة عن fixtures B3 بحقن fetch داخل مساحة مؤقتة؛ لا تمثل تحققاً حياً، ولا توجد topics-latest حية في مساحة المشروع.");
  return lines.join("\n");
}

export function formatDiscoveryPlanTrial(root) {
  const configPath = path.join(root, "config", "sources.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const rssIds = Object.entries(config.sources ?? {})
    .filter(([, source]) => source?.enabled === true && source?.type === "rss")
    .map(([id]) => id);
  const registryPath = path.join(root, "state", "labs", "discovery", "registry.json");
  let registryStatus = "غير موجود في المستودع؛ لا أدعي خلو السجل من حملات سابقة";
  if (fs.existsSync(registryPath)) {
    const registryDoc = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const entries = Array.isArray(registryDoc) ? registryDoc : Array.isArray(registryDoc?.campaigns) ? registryDoc.campaigns : [];
    const exactTitleMatches = entries.filter((entry) => String(entry?.title ?? entry?.name ?? "").trim() === "أدلة الخلاصات العربية").length;
    registryStatus = `موجود: ${path.relative(root, registryPath)}؛ عدد القيود=${entries.length}؛ تطابق اسم حرفي=${exactTitleMatches} (لا يثبت غياب قيود غير مسجلة)`;
  }
  return [
    "الحملة/المالك/الزمن ومصدره: أدلة الخلاصات العربية / غرفة الأخبار / 2026-09-29 (وقت الجلسة؛ المصدر=ساعة البيئة)",
    "1. التسجيل أولاً: مسودة قيد مقترح بعنوان «أدلة الخلاصات العربية»؛ لم يُكتب قيد جديد في تجربة البرومت؛ يلزم تسجيل/اعتماد القيد قبل أي بحث حي.",
    `2. منع التكرار المطلق: ${registryStatus}؛ حالة منع التكرار: لا تطابق اسم حرفي في السجل الحالي؛ يلزم مقارنة الزاوية والمصادر قبل التنفيذ، ولا يمكن إثبات غياب حملات غير مسجلة.`,
    "3. الزاوية: هل تنتج مصادر RSS المجانية المدرجة إعدادياً عناصر عربية قابلة للاستخراج تحمل عنواناً وناشراً وطابعاً زمنياً؟ معيار الحملة هو توثيق الدليل لا افتراض توفره.",
    `4. الاستكشاف الحي: مخطط فقط — لم ينفذ في تجربة B5؛ الطلبات الحية الفعلية=0. مصادر RSS المرشحة من config/sources.json فقط: ${rssIds.length ? rssIds.join(", ") : "لا يوجد"}. لا تُعد fixtures دليلاً على نجاح حي.`,
    "5. بوابات التقييم الخمس:",
    "   أ) الصلة بالسؤال: غير مختبر — يلزم تطابق عنوان/ناشر/تاريخ مع سؤال الخلاصة.",
    "   ب) موثوقية المصدر: غير مختبر — يلزم توثيق النطاق والمصدر من إعداداته وردّه الفعلي.",
    "   ج) حداثة الدليل: غير مختبر — يلزم فحص الطابع الزمني في استجابة حيّة.",
    "   د) الأصالة وعدم التكرار: غير مختبر — يلزم مقارنة URL والعنوان المطبّع بعد اجتياز فحص السجل.",
    "   هـ) السلامة والجدوى المجانية: إعدادياً مرشح فقط — المصادر مضبوطة في JSON؛ لا طلب حي أو كلفة اختُبرت هنا.",
    "6. التقرير النهائي (حتى لو سلبي): نتيجة هذه التجربة سلبية من ناحية الأدلة الحية: لا تشغيل حملة ولا نتائج إصابة، لذلك لا أستنتج أن المصادر فشلت أو نجحت. الخطوة التالية المقترحة: اعتماد قيد الحملة والتحقق من عدم التكرار، ثم تشغيل استكشاف محدود مصرح به وتسجيل الطلبات ونسب الإصابة الخام.",
  ].join("\n");
}

export async function runB5Selftest({ root = process.cwd(), log = console.log } = {}) {
  const checks = {};
  log("== B5 PROMPTS SELFTEST (isolated B3 fixtures; no live network) ==");

  check(log, checks, "allFourteenPromptFilesPresent", () =>
    B5_PROMPT_FILES.every((rel) => fs.existsSync(path.join(root, rel))),
  `${B5_PROMPT_FILES.filter((rel) => fs.existsSync(path.join(root, rel))).length}/14 files`);

  const promptText = Object.fromEntries(B5_PROMPT_FILES.map((rel) => [rel, fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : ""]));
  check(log, checks, "peopleAndLabsHaveMandatoryStructure", () => ROLE_AND_LAB_FILES.every((rel) => {
    const text = promptText[rel];
    return REQUIRED_ROLE_SECTIONS.every((heading) => text.includes(heading)) &&
      text.includes("لا كود") && text.includes("لا دمج") && text.includes("لا اختلاق") &&
      text.includes("الخروج عن القالب = رفض");
  }), "12/12 role/lab prompts include identity, exclusive sources, template, acceptance, prohibitions");

  const roleRequirements = {
    "prompts/people/chief-editor.md": ["15 سنة", "نشر", "انتظار", "يوقّع"],
    "prompts/people/radar-analyst.md": ["10 سنوات", "OpportunityScore", "25%", "نافذة ذهبية"],
    "prompts/people/saturation-monitor.md": ["8 سنوات", "اتحاد المحاور", "300–600", "700–1000", "1200–2000", "ديسكفر"],
    "prompts/people/decisions-editor.md": ["12 سنة", "المصدر الثاني", "السياق"],
    "prompts/people/trend-editor.md": ["9 سنوات", "من أين بدأ", "أول من صنعه", "نافذة التصدر"],
    "prompts/people/sport-editor.md": ["10 سنوات", "الفجوات", "القرارات"],
    "prompts/people/headlines-editor.md": ["7 سنوات", "≤70", "1200×675", "أفضل وقت نشر"],
    "prompts/people/verification-unit.md": ["مصدران مستقلان", "فحص التاريخ", "فحص الرقم", "فحص الاسم"],
    "prompts/labs/discovery.md": ["ست خطوات", "التسجيل أولاً", "منع التكرار", "الاستكشاف الحي", "بوابات التقييم الخمس", "حتى لو كانت النتيجة سلبية"],
    "prompts/labs/measurement.md": ["الاختبارات الأربعة", "كشف", "تنبؤ", "تشبع", "مصادر", "سبعة حقول", "اعتماد المجلس"],
    "prompts/labs/extraction.md": ["10 سنوات", "مصفوفة المخاطر", "الدليل الخام"],
    "prompts/labs/advanced-search.md": ["14 سنة", "dorks.yaml", "اختبار حي", "نسبة الإصابة", "JSON"],
  };
  check(log, checks, "roleAndLabRequirementsPresent", () => Object.entries(roleRequirements).every(([rel, needles]) => needles.every((needle) => promptText[rel].includes(needle))), "12 role/lab requirement sets");

  check(log, checks, "resumeAndJulesTemplatesComplete", () => {
    const resume = promptText["prompts/resume-generic.txt"];
    const jules = promptText["prompts/jules-mission-template.md"];
    return ["GOVERNANCE.md", "state/skills.md", "الاستئناف: آخر نقطة محفوظة هي", "عند العائق", "أطلب موافقة الاستئناف"].every((needle) => resume.includes(needle)) &&
      ["الهدف", "الملفات المسموحة", "ميزانية الطلبات", "معيار الإنجاز", "لا تدمج", "Pull Request فقط"].every((needle) => jules.includes(needle));
  }, "resume + Jules target/files/budget/acceptance/PR-only");

  const wrongEngineExtension = B5_PROMPT_FILES.some((rel) => /engine\/[^\s`]*\.mjs/u.test(promptText[rel]));
  check(log, checks, "promptsDoNotContradictJsDecision", () => !wrongEngineExtension, "no engine .mjs references in the 14 prompt files");
  const engineFiles = [];
  const walkEngine = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walkEngine(absolute);
      else engineFiles.push(path.relative(root, absolute));
    }
  };
  walkEngine(path.join(root, "engine"));
  check(log, checks, "allEngineFilesUseJsExtension", () => engineFiles.length > 0 && engineFiles.every((rel) => path.extname(rel) === ".js"), `${engineFiles.length} files; extensions=${[...new Set(engineFiles.map((rel) => path.extname(rel)))].join(",")}`);

  const realLatestPath = path.join(root, "state", "topics-latest.json");
  const liveLatestBefore = fs.existsSync(realLatestPath) ? fs.readFileSync(realLatestPath, "utf8") : null;
  let radarTrial = "";
  let discoveryTrial = "";
  let fixtureData = null;
  let fixtureRadarOk = false;
  let fixtureUrls = [];
  await withB3FixtureRadar(root, async ({ sandbox, env, radar }) => {
    fixtureRadarOk = radar.ok;
    fixtureUrls = [...env.requestUrls];
    const latestPath = path.join(sandbox, "state", "topics-latest.json");
    fixtureData = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    radarTrial = formatRadarAnalystTrial(fixtureData);
    discoveryTrial = formatDiscoveryPlanTrial(root);
    check(log, checks, "b3FixtureRadarGeneratedTopics", () =>
      radar.ok && fixtureData.topics.length > 0 && fs.existsSync(latestPath),
    `topics=${fixtureData.topics.length}; normalized=${radar.summary.normalizedItems}; isolated=${sandbox !== root}`);
    const allowedHosts = new Set(["trends.google.com", "news.google.com", "t.me", "ar.wikipedia.org", "www.bing.com", "sawtalhijaz.com"]);
    check(log, checks, "fixtureRequestsInjectedAndIsolated", () =>
      fixtureUrls.length > 0 && fixtureUrls.every((href) => allowedHosts.has(new URL(href).hostname)) &&
      (fs.existsSync(realLatestPath) ? fs.readFileSync(realLatestPath, "utf8") : null) === liveLatestBefore,
    `requests=${fixtureUrls.length}; project topics-latest unchanged`);
  });

  check(log, checks, "radarAnalystPromptAppliedWithRequiredLabel", () => {
    const topics = fixtureData?.topics ?? [];
    const goldenCount = topics.filter((topic) => topic.metrics?.classificationKey === "golden").length;
    return fixtureRadarOk && radarTrial.startsWith("حالة البيانات: تجربة على بيانات معزولة — غير حية") &&
      radarTrial.includes("OpportunityScore=") && radarTrial.includes("(ترتيب فقط)") &&
      radarTrial.includes("النوافذ الذهبية والمتابعة:") && radarTrial.includes("بيانات غير متاحة/قيود:") &&
      (goldenCount === 0 ? radarTrial.includes("لا توجد نافذة ذهبية مطابقة") : radarTrial.includes("متابعة مقترحة:")) &&
      topics.every((topic) => radarTrial.includes(topic.id) && radarTrial.includes(topic.title));
  }, `all=${fixtureData?.topics?.length ?? 0} topics; golden=${fixtureData?.topics?.filter((topic) => topic.metrics?.classificationKey === "golden").length ?? 0}`);

  check(log, checks, "discoveryPromptAppliedAsNonLiveSixStepPlan", () =>
    discoveryTrial.startsWith("الحملة/المالك/الزمن ومصدره: أدلة الخلاصات العربية") &&
    ["1. التسجيل أولاً", "2. منع التكرار المطلق", "3. الزاوية", "4. الاستكشاف الحي", "5. بوابات التقييم الخمس", "6. التقرير النهائي"].every((step) => discoveryTrial.includes(step)) &&
    discoveryTrial.includes("الطلبات الحية الفعلية=0") && discoveryTrial.includes("غير مختبر") &&
    !/نسبة إصابة:\s*\d/u.test(discoveryTrial),
  "campaign plan only; no invented live hits or rates");

  if (radarTrial) {
    log("== تطبيق radar-analyst: المخرج الكامل ==");
    for (const line of radarTrial.split("\n")) log(line);
  }
  if (discoveryTrial) {
    log("== تطبيق discovery على خطة الحملة: المخرج الكامل ==");
    for (const line of discoveryTrial.split("\n")) log(line);
  }

  const passed = Object.values(checks).every(Boolean);
  log("— B5 prompt checks —");
  for (const [name, value] of Object.entries(checks)) log(`${name}=${value ? "✓" : "✗"}`);
  log(`النتيجة: ${passed ? "خضراء — حزمة B5 والبوابة التجريبية مكتملتان" : "حمراء — بوابة B5 غير مكتملة"}`);
  log("== B5 PROMPTS SELFTEST END ==");
  return { ok: passed, checks, radarTrial, discoveryTrial, topics: fixtureData?.topics?.length ?? 0, fixtureRequests: fixtureUrls.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runB5Selftest();
  process.exit(result.ok ? 0 : 1);
}
