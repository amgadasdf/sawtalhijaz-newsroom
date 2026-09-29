// engine/b6-selftest.js — بوابة B6 الحتمية: اختبار كشف تجريبي كامل على عينة fixtures محفوظة ينتج
// تقرير 7 حقول حقيقي البنية في reports/ + يحدّث state/sources-health.json وstate/skills.md وstate/tests-latest.json،
// مع التحقق من سجل الدوركس (config/dorks.yaml) وقاعدة منع الاستخدام بلا نتيجة اختبار، ونموذجي التقارير في reports/forms/.
//
// لا شبكة إطلاقاً: كل ردود HTTP محقونة من fixtures B3 المعزولة (fetch محقون بعدّاد يفشل عند أي محاولة اتصال).
// الكتابات الحقيقية محدودة ومعلنة: تقرير tests-*.md/.json، state/tests-latest.json، مساحة tests في sources-health
// (لا تلمس حقول الصحة الحية)، كتلة معدل الإصابة في skills.md، وسجل تشغيل B6-tests واحد.
//
// node engine/b6-selftest.js [--kill] — البوابة تُغلق عند 17 فحصاً أخضر.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./state.js";
import {
  REPORT_DIR,
  REPORT_FIELDS,
  SAMPLE_SOURCE_FIXTURES,
  SKILLS_BLOCK_END,
  SKILLS_BLOCK_START,
  TESTS_LATEST_REL,
  buildImprovement,
  loadPreviousReport,
  readManualSaturationSample,
  renderTestReportMarkdown,
  runDetectionTest,
  runFixtureSuiteInputs,
  runForecastTest,
  runSaturationTest,
  runSourcesTest,
  runTestSuite,
  updateSkillsForecastHitRate,
  validateTestReport,
} from "./tests.js";
import { DORK_CATEGORIES, assertDorkUsable, dorkIsUsable, loadDorksRegistry, parseDorksYaml, recordDorkTestResult, selectUsableDorks, serializeDorksYaml, validateDorksRegistry } from "./dorks.js";

export const REQUIRED_FORMS = Object.freeze({
  "reports/forms/feature-proposal.md": ["المشكلة", "البدائل", "التكلفة", "المخاطر", "التراجع"],
  "reports/forms/obstacle-report.md": ["المطلوب", "ما حدث بالضبط", "الدليل الخام", "بديلان مقترحان"],
});
export const MANDATED_DORK_PATTERNS = Object.freeze([
  { id: "x", needle: 'site:x.com "<مصطلح>"' },
  { id: "feed", needle: "feed: <مصطلح>" },
  { id: "telegram", needle: "site:t.me <مصطلح>" },
  { id: "intitle", needle: 'intitle:"<كلمة دالة>"' },
  { id: "competitor", needle: "site:<نطاق منافس> <موضوع>" },
]);

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

const sortedJson = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

function liveHealthKeys(health) {
  const clone = structuredClone(health ?? {});
  delete clone._meta?.tests;
  for (const [id, entry] of Object.entries(clone.sources ?? {})) {
    delete entry.tests;
    clone.sources[id] = entry;
  }
  return clone;
}

function formsStructure(root, file, sections) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) return { ok: false, missing: ["الملف"], headingCount: 0 };
  const text = fs.readFileSync(abs, "utf8");
  const missing = [];
  let cursor = -1;
  for (const section of sections) {
    const index = text.indexOf(`## ${section}`);
    if (index < 0) missing.push(section);
    else if (index < cursor) missing.push(`${section} (خارج الترتيب)`);
    else cursor = index;
  }
  return { ok: missing.length === 0, missing, headingCount: (text.match(/^## /gmu) ?? []).length, bytes: Buffer.byteLength(text, "utf8") };
}

export async function runB6Selftest({ root = process.cwd(), log = console.log } = {}) {
  const checks = {};
  const details = {};
  const startedAt = performance.now();
  log("== B6 TESTS + REPORTS + DORKS SELFTEST (fixtures معزولة؛ صفر شبكة) ==");
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (...args) => {
    fetchCalls += 1;
    throw new Error(`بوابة B6 لا تلمس الشبكة: ${String(args[0])}`);
  };

  try {
    const store = createStore(root);
    const healthBefore = store.readJsonSafe("state/sources-health.json", { _meta: {}, sources: {} });
    const skillsBefore = store.readText("state/skills.md");
    const dorksBefore = store.readText("config/dorks.yaml");

    // — 1) العتاد المطلوب: fixtures + السجل + النماذج —
    const requiredFixtures = ["trends-rss.xml", "gnews.xml", "telegram.html", "wiki-rc.json", "bing.html", "wordpress-sitemap.xml", "sitemap-0.xml"];
    const missingFixtures = requiredFixtures.filter((name) => !fs.existsSync(path.join(root, "state", "samples", "fixtures", name)));
    const forms = Object.fromEntries(Object.entries(REQUIRED_FORMS).map(([file, sections]) => [file, formsStructure(root, file, sections)]));
    check(log, checks, "b6FixturesRegistryAndFormsPresent", () =>
      missingFixtures.length === 0 && fs.existsSync(path.join(root, "config", "dorks.yaml")) &&
      Object.values(forms).every((entry) => entry.ok),
      `fixtures=${requiredFixtures.length}; forms=${Object.entries(forms).map(([file, entry]) => `${path.basename(file)}=${entry.ok ? "✓" : "✗"}`).join(" ")}`);
    details.forms = forms;

    // — 2) عينة fixtures كاملة (لا شبكة، لا كتابة في state الحقيقي قبل تشغيل الحزمة) —
    const fixture = await runFixtureSuiteInputs({ root });
    const sourceDocument = fixture.sourceDocument;
    const healthDocument = fixture.healthDocument;

    const detection = runDetectionTest({ baseline: fixture.baseline, evidence: fixture.evidence, referenceIso: fixture.runIso });
    check(log, checks, "detectionOnSavedSampleWithinTwoHours", () =>
      detection.available && detection.ok &&
      detection.baseline.topics === 10 && detection.evidence.items === 5 && detection.inWindowItems === 4 && detection.outOfWindowItems === 1 &&
      detection.matchedTopics === 3 && detection.unmatchedTopics === 7 && detection.unmatchedEvidenceItems === 1 &&
      detection.precisionPercent === 30 && detection.meanConfirmationMinutes === 60 && detection.maxConfirmationMinutes === 90 &&
      detection.window.hours === 2 && detection.window.endIso === new Date(Date.parse(fixture.runIso) + 2 * 3600000).toISOString(),
      `baseline=${detection.baseline.topics}; matched=${detection.matchedTopics}; inWindow=${detection.inWindowItems}; precision=${detection.precisionPercent}%`);

    // — 3) مصفوفة التنبؤ: تحقق/لم يتحقق/تراجع/بانتظار + معدل الإصابة —
    const forecast = runForecastTest({ snapshot: fixture.forecastSnapshot, referenceIso: fixture.runIso });
    const byId = new Map(forecast.matrix.map((row) => [row.topicId, row]));
    check(log, checks, "forecastMatrixAndHitRate", () =>
      forecast.available && forecast.aggregates.total === 4 &&
      forecast.aggregates.verified === 1 && forecast.aggregates.notVerified === 1 && forecast.aggregates.regressed === 1 && forecast.aggregates.pending === 1 &&
      forecast.aggregates.denominator === 3 && forecast.aggregates.hitRatePercent === 33.33 &&
      byId.get("fixture-verified")?.statusKey === "verified" && byId.get("fixture-verified")?.change === 4 &&
      byId.get("fixture-not-verified")?.statusKey === "not-verified" && byId.get("fixture-not-verified")?.change === 0 &&
      byId.get("fixture-regressed")?.statusKey === "regressed" && byId.get("fixture-regressed")?.change === -4 &&
      byId.get("fixture-pending")?.statusKey === "pending" && byId.get("fixture-pending")?.lastLaterRunIso === null &&
      forecast.runsObserved >= 3,
      `verified=${forecast.aggregates.verified}; notVerified=${forecast.aggregates.notVerified}; regressed=${forecast.aggregates.regressed}; pending=${forecast.aggregates.pending}; hitRate=${forecast.aggregates.hitRatePercent}%`);

    // — 4) فجوة القياس (تشبع): عينة يدوية مقابل المحرك —
    const saturation = runSaturationTest({ topics: fixture.topics, manualSample: fixture.manualSample, referenceIso: fixture.runIso });
    check(log, checks, "saturationMeasurementGap", () =>
      saturation.available && saturation.aggregates.samples === 3 && saturation.aggregates.matched === 2 && saturation.aggregates.unmatched === 1 &&
      saturation.rows[0].gapPoints === 4 && saturation.rows[0].verdict === "داخل هامش القياس" &&
      saturation.rows[1].gapPoints === 18 && saturation.rows[1].verdict === "فجوة ملحوظة" &&
      saturation.rows[2].matchKind === "unmatched" && saturation.rows[2].gapPoints === null &&
      saturation.aggregates.meanAbsGapPoints === 11 && saturation.aggregates.maxAbsGapPoints === 18 && saturation.aggregates.verdict === "فجوة ملحوظة" &&
      saturation.limits.withinPoints === 10 && saturation.limits.notablePoints === 25,
      `mean=${saturation.aggregates.meanAbsGapPoints}; max=${saturation.aggregates.maxAbsGapPoints}; verdict=${saturation.aggregates.verdict}`);

    // — 5) صحة المصادر: تجدد فعلي + زمن استجابة + تبريدات —
    const sources = runSourcesTest({ root: fixture.sandbox, sourceDocument, healthDocument, referenceIso: fixture.runIso, samples: fixture.samples });
    const sourceById = new Map(sources.rows.map((row) => [row.sourceId, row]));
    const gnews = sourceById.get("gnews");
    const trends = sourceById.get("trends-rss");
    check(log, checks, "sourcesHealthRefreshResponseAndCooldowns", () =>
      sources.available && sources.aggregates.total === 13 && sources.aggregates.enabled === 8 && sources.aggregates.disabled === 5 &&
      gnews.cooling.active && gnews.cooling.minutesLeft === 15 && gnews.cooling.stage === 1 && gnews.verdict === "تبريد" &&
      gnews.budget.remaining === 6 && gnews.refresh.fresh === true &&
      trends.response.verdict === "بطيء جداً" && trends.response.lastResponseMs === 5200 && trends.verdict === "سليم" &&
      sourceById.get("wiki-rc").verdict.startsWith("متأخر") && sourceById.get("wiki-rc").refresh.ageHours === 48 &&
      sourceById.get("wiki-top").verdict === "بلا سجل" && sourceById.get("bridge").verdict === "معطل في الإعدادات" &&
      sources.aggregates.cooling === 1 && sources.aggregates.coolingList[0].minutesLeft === 15 &&
      sources.aggregates.slowest.sourceId === "trends-rss" && sources.aggregates.slowest.verdict === "بطيء جداً" &&
      Number.isFinite(sources.aggregates.meanResponseMs),
      `total=${sources.aggregates.total}; healthy=${sources.aggregates.healthy}; cooling=${sources.aggregates.cooling}; stale=${sources.aggregates.stale}; slowest=${sources.aggregates.slowest?.sourceId} ${sources.aggregates.slowest?.responseMs}ms`);
    details.sources = sources.aggregates;

    // — 6) التشغيل الكامل + التقرير الحقيقي في reports/ —
    const suite = await runTestSuite({ root, mode: "fixtures", net: false, write: true, record: true, reportDir: REPORT_DIR });
    const report = suite.report;
    const markdownAbs = path.join(root, report.paths.markdown);
    const jsonAbs = path.join(root, report.paths.json);
    const markdownOnDisk = fs.existsSync(markdownAbs) ? fs.readFileSync(markdownAbs, "utf8") : "";
    const reportOnDisk = fs.existsSync(jsonAbs) ? JSON.parse(fs.readFileSync(jsonAbs, "utf8")) : null;
    const validation = validateTestReport(reportOnDisk, markdownOnDisk);
    const headings = REPORT_FIELDS.map((field) => `## ${field.index}) ${field.heading}`);
    check(log, checks, "reportSevenFieldStructureOnDisk", () =>
      Boolean(reportOnDisk) && validation.ok && validation.fieldsPresent === 7 && validation.fieldsTotal === 7 &&
      headings.every((heading) => markdownOnDisk.includes(heading)) &&
      markdownOnDisk.startsWith("# تقرير الاختبارات — تشغيل #") &&
      reportOnDisk.fields["time-and-run"].line.startsWith("الزمن: ") && reportOnDisk.runNumber >= 1 &&
      reportOnDisk.fields.executed.count === 4 && reportOnDisk.fields.executed.total === 4 &&
      reportOnDisk.fields.tools.length >= 3 && reportOnDisk.fields.weights.length >= 3 &&
      reportOnDisk.structure.fieldsPresent === 7 && reportOnDisk.structure.ok === true &&
      reportOnDisk._meta.sampleSource === SAMPLE_SOURCE_FIXTURES,
      `fields=${validation.fieldsPresent}/7; run=#${reportOnDisk?.runNumber}; file=${report.paths.markdown}`);

    // — 7) الكتابة الذرية + حتمية إعادة العرض + المرآة للوحة —
    const residue = fs.readdirSync(path.join(root, report.paths.markdown, "..")).filter((name) => name.includes(".tmp-"));
    const mirror = store.readJsonSafe(TESTS_LATEST_REL, null);
    const numbersMatchReport =
      mirror && mirror.numbers.detection.matchedTopics === reportOnDisk.fields.results.detection.matchedTopics &&
      mirror.numbers.forecast.hitRatePercent === reportOnDisk.fields.results.forecast.hitRatePercent &&
      mirror.numbers.saturation.meanAbsGapPoints === reportOnDisk.fields.results.saturation.meanAbsGapPoints &&
      mirror.numbers.sources.total === reportOnDisk.fields.results.sources.total &&
      mirror.run.report === report.paths.markdown && mirror.run.report_json === report.paths.json;
    check(log, checks, "reportWrittenAtomicallyAndMirrored", () =>
      renderTestReportMarkdown(reportOnDisk) !== "" && residue.length === 0 &&
      fs.existsSync(markdownAbs) && fs.existsSync(jsonAbs) && reportOnDisk.structure.ok === true &&
      Boolean(mirror) && mirror.structure.fieldsPresent === 7 && mirror.structure.ok === true &&
      mirror.sampleSource === SAMPLE_SOURCE_FIXTURES && mirror.mode === "fixtures" && numbersMatchReport &&
      mirror.verdicts.detection.passed === true && mirror.verdicts.sources.available === true &&
      store.exists(`${REPORT_DIR}/${path.basename(report.paths.json)}`) &&
      suite.written.run?.rel?.startsWith("state/runs/") === true,
      `mirror=state/tests-latest.json; run=${suite.written.run?.rel}; residue=${residue.length}`);
    details.mirror = { run: mirror?.run, structure: mirror?.structure, sampleSource: mirror?.sampleSource };

    // — 8) تحديث state/sources-health.json: مساحة اختبار فقط، وحقول الصحة الحية سليمة —
    const healthAfter = store.readJsonSafe("state/sources-health.json", { _meta: {}, sources: {} });
    const liveBefore = JSON.stringify(liveHealthKeys(healthBefore));
    const liveAfter = JSON.stringify(liveHealthKeys(healthAfter));
    check(log, checks, "sourcesHealthUpdatedWithoutTouchingLiveFields", () =>
      liveBefore === liveAfter &&
      healthAfter._meta.tests?.last_run_iso === reportOnDisk.time.iso &&
      healthAfter._meta.tests?.sample_source === SAMPLE_SOURCE_FIXTURES &&
      healthAfter._meta.tests?.healthy === sources.aggregates.healthy &&
      healthAfter.sources.gnews?.tests?.verdict === "تبريد" && healthAfter.sources.gnews?.tests?.cooling === true &&
      healthAfter.sources.gnews?.tests?.cooling_minutes_left === 15 &&
      Object.keys(healthAfter.sources).length === 13 &&
      Object.values(healthAfter.sources).every((entry) => entry.tests?.sample_source === SAMPLE_SOURCE_FIXTURES),
      `liveFieldsUntouched=${liveBefore === liveAfter}; tests.last_run_iso=${healthAfter._meta.tests?.last_run_iso}`);

    // — 9) كتلة معدل الإصابة في skills.md (تحديث آلي + استبدال في المكان) —
    const skillsAfter = store.readText("state/skills.md");
    const blockCount = (skillsAfter.match(new RegExp(SKILLS_BLOCK_START, "gu")) ?? []).length;
    const endCount = (skillsAfter.match(new RegExp(SKILLS_BLOCK_END, "gu")) ?? []).length;
    const secondWrite = updateSkillsForecastHitRate({ store, report: reportOnDisk });
    const skillsThird = store.readText("state/skills.md");
    // «استبدال في المكان»: كل ما هو خارج الكتلة المُدارة يبقى بايتاً ببايت (لا اعتماد على الأطوال)
    const outsideBlock = (text) => {
      const from = text.indexOf(SKILLS_BLOCK_START);
      const to = text.indexOf(SKILLS_BLOCK_END);
      return from >= 0 && to > from ? `${text.slice(0, from)}${text.slice(to + SKILLS_BLOCK_END.length)}` : text;
    };
    check(log, checks, "skillsHitRateBlockUpdatedInPlace", () =>
      blockCount === 1 && endCount === 1 && skillsAfter.includes("معدل إصابة التنبؤات") &&
      skillsAfter.includes(`${reportOnDisk.fields.results.forecast.hitRatePercent}%`) &&
      skillsAfter.includes(`#${reportOnDisk.runNumber}`) && skillsAfter.includes(report.paths.markdown) &&
      secondWrite.changed === false && skillsThird === skillsAfter &&
      skillsAfter.includes(reportOnDisk.time.iso) &&
      outsideBlock(skillsAfter) === outsideBlock(skillsBefore),
      `markers=${blockCount}/${endCount}; idempotent=${secondWrite.changed === false}; خارج الكتلة بلا تغيير=${outsideBlock(skillsAfter) === outsideBlock(skillsBefore)}`);

    // — 10) الحقل 4: مقارنة صريحة (أول تقرير + حساب فروق بسند مصنّع) —
    const firstReport = buildImprovement({ previous: { available: false, comparable: false, reason: "لا تقرير اختبار سابق في reports/." }, sampleSource: SAMPLE_SOURCE_FIXTURES, results: { detection, forecast, saturation, sources } });
    const craftedPrevious = JSON.parse(JSON.stringify({
      sampleSource: SAMPLE_SOURCE_FIXTURES,
      runNumber: 1,
      time: { iso: "2026-09-27T10:00:00.000Z" },
      tests: {
        detection: { matchedTopics: 1, precisionPercent: 10, meanConfirmationMinutes: 30 },
        forecast: { aggregates: { hitRatePercent: 10, verified: 0 } },
        saturation: { aggregates: { meanAbsGapPoints: 30 } },
        sources: { aggregates: { healthy: 1, stale: 4, meanResponseMs: 2400 } },
      },
    }));
    const withPrevious = buildImprovement({ previous: { available: true, comparable: true, report: craftedPrevious, rel: "reports/tests-crafted.json" }, sampleSource: SAMPLE_SOURCE_FIXTURES, results: { detection, forecast, saturation, sources } });
    const delta = (metric) => withPrevious.deltas.find((entry) => entry.metric === metric);
    const noReportDir = fs.mkdtempSync(path.join(os.tmpdir(), "b6-noreports-"));
    const noPrevious = loadPreviousReport({ root: noReportDir, reportDir: "reports", sampleSource: SAMPLE_SOURCE_FIXTURES });
    fs.rmSync(noReportDir, { recursive: true, force: true });
    check(log, checks, "improvementFieldExplicitComparison", () =>
      firstReport.compared === false && /لا تقرير اختبار سابق/u.test(firstReport.reason) && firstReport.currentSummary.matchedTopics === 3 &&
      withPrevious.compared === true && withPrevious.previous.rel === "reports/tests-crafted.json" &&
      delta("موضوعات مطابقة في اختبار الكشف").previous === 1 && delta("موضوعات مطابقة في اختبار الكشف").current === 3 && delta("موضوعات مطابقة في اختبار الكشف").delta === 2 && delta("موضوعات مطابقة في اختبار الكشف").verdict === "تحسن" &&
      delta("متوسط زمن التحقق (دقيقة)").verdict === "تراجع" &&
      delta("معدل إصابة التنبؤات %").delta === 23.33 && delta("معدل إصابة التنبؤات %").verdict === "تحسن" &&
      delta("متوسط فجوة التشبع (نقطة)").verdict === "تحسن" && delta("مصادر سليمة").verdict === "تحسن" &&
      delta("مصادر متأخرة").verdict === "تحسن" && delta("متوسط زمن الاستجابة (ms)").verdict === "تحسن" &&
      withPrevious.improved === 8 && withPrevious.regressed === 1 &&
      noPrevious.available === false && /لا مجلد تقارير/u.test(noPrevious.reason),
      `تحسن=${withPrevious.improved}; تراجع=${withPrevious.regressed}; أول تقرير=${firstReport.compared === false}`);

    // — 11) الحقل 6: كل تكلفة صفر أو عرض لقرار المجلس —
    const tools = reportOnDisk.fields.tools;
    check(log, checks, "toolsCostZeroOrCouncilDecision", () =>
      tools.length >= 4 && tools.filter((tool) => tool.cost === 0).length >= 3 && tools.filter((tool) => tool.decisionRequired).length >= 1 &&
      tools.every((tool) => tool.cost === 0 || (tool.decisionRequired === true && tool.cost > 0)) &&
      tools.filter((tool) => tool.decisionRequired).every((tool) => tool.costLabel.includes("عرض لقرار المجلس")) &&
      markdownOnDisk.includes("عرض لقرار المجلس — لا شراء"),
      `tools=${tools.length}; zeroCost=${tools.filter((tool) => tool.cost === 0).length}; decisions=${tools.filter((tool) => tool.decisionRequired).length}`);

    // — 12) سجل الدوركس: البنية + التصنيف + الأنماط الخمسة المنصوصة —
    const registry = loadDorksRegistry({ root });
    const patterns = registry.dorks.map((dork) => String(dork.pattern));
    check(log, checks, "dorksRegistryValidAndClassified", () =>
      registry.ok && registry.dorks.length === 10 &&
      MANDATED_DORK_PATTERNS.every((pattern) => patterns.some((value) => value.includes(pattern.needle))) &&
      registry.dorks.every((dork) => DORK_CATEGORIES[dork.category] && String(dork.engine).trim() !== "" && String(dork.purpose).trim().length >= 10) &&
      registry.dorks.every((dork) => dork.hit_rate === null && dork.last_tested === null) &&
      new Set(registry.dorks.map((dork) => dork.id)).size === 10 &&
      Object.keys(DORK_CATEGORIES).length >= 8,
      `dorks=${registry.dorks.length}; categories=${Object.keys(registry.dorks.reduce((acc, dork) => ({ ...acc, [dork.category]: 1 }), {})).length}`);

    // — 13) القاعدة الصلبة: ممنوع الاستخدام بلا نتيجة اختبار مسجّلة —
    const blockedAll = [];
    for (const dork of registry.dorks) {
      try {
        assertDorkUsable(dork);
      } catch (error) {
        blockedAll.push(error.message);
      }
    }
    const dorksSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "b6-dorks-"));
    fs.mkdirSync(path.join(dorksSandbox, "config"), { recursive: true });
    fs.copyFileSync(path.join(root, "config", "dorks.yaml"), path.join(dorksSandbox, "config", "dorks.yaml"));
    const sandboxRegistry = loadDorksRegistry({ root: dorksSandbox });
    const recorded = recordDorkTestResult(sandboxRegistry.doc, "x-term", { hitRatePercent: 12.5, testedAtIso: "2026-09-28T23:00:00.000Z", evidence: "عينة بوابة B6" });
    const roundTrip = parseDorksYaml(serializeDorksYaml(recorded.doc));
    const usableAfter = selectUsableDorks(roundTrip);
    const realRegistryUntouched = store.readText("config/dorks.yaml") === dorksBefore && loadDorksRegistry({ root }).usable.length === 0;
    let malformedRejected = false;
    try {
      parseDorksYaml("dorks:\n\t- id: tab-indent\n");
    } catch {
      malformedRejected = true;
    }
    let malformedRejectedDeep = false;
    try {
      parseDorksYaml("dorks:\n  - id: x\n      nested: 1\n");
    } catch {
      malformedRejectedDeep = true;
    }
    fs.rmSync(dorksSandbox, { recursive: true, force: true });
    check(log, checks, "dorksBlockedWithoutRecordedTestResult", () =>
      selectUsableDorks(registry.doc).length === 0 && dorkIsUsable(registry.dorks[0]) === false &&
      blockedAll.length === 10 && blockedAll.every((message) => message.includes("لا نتيجة اختبار مسجلة")) &&
      validateDorksRegistry(roundTrip).ok === true && usableAfter.length === 1 && usableAfter[0].id === "x-term" &&
      usableAfter[0].hit_rate === 12.5 && usableAfter[0].last_tested === "2026-09-28T23:00:00.000Z" &&
      JSON.stringify(roundTrip) === JSON.stringify(recorded.doc) && realRegistryUntouched &&
      malformedRejected && malformedRejectedDeep,
      `blocked=${blockedAll.length}; usableBefore=0; usableAfter=${usableAfter.length}; realUntouched=${realRegistryUntouched}`);

    // — 14) نماذج التقارير في reports/forms —
    check(log, checks, "reportFormsStructure", () =>
      Object.values(forms).every((entry) => entry.ok) &&
      forms["reports/forms/feature-proposal.md"].headingCount >= 5 &&
      forms["reports/forms/obstacle-report.md"].headingCount >= 4 &&
      forms["reports/forms/obstacle-report.md"].bytes > 300,
      Object.entries(forms).map(([file, entry]) => `${path.basename(file)}=${entry.ok ? "✓" : "✗"}`).join(" "));

    // — 15) صفر شبكة داخل البوابة كاملة —
    check(log, checks, "zeroNetworkCallsDuringGate", () => fetchCalls === 0, `fetchCalls=${fetchCalls}`);

    // — 16) التوصيل: selftest + CLI + package.json —
    const packageJson = JSON.parse(store.readText("package.json"));
    const cliText = store.readText("engine/cli.js");
    const selftestText = store.readText("engine/selftest.js");
    check(log, checks, "suiteWiredIntoSelftestCliAndScripts", () =>
      Boolean(packageJson.scripts?.tests) && Boolean(packageJson.scripts?.["b6-gate"]) &&
      packageJson.scripts.tests.includes("engine/tests.js") && packageJson.scripts["b6-gate"].includes("engine/b6-selftest.js") &&
      cliText.includes('case "tests"') && cliText.includes('case "b6-gate"') && cliText.includes('case "dorks"') &&
      selftestText.includes("runB6Selftest") && selftestText.includes("checks.testsB6"),
      `scripts=${Object.keys(packageJson.scripts ?? {}).filter((key) => ["tests", "b6-gate"].includes(key)).join(",")}`);

    // — 17) التقرير الحي: يعمل بلا بيانات موسوماً بصراحة (بلا تصنيع) —
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "b6-bare-"));
    try {
      fs.cpSync(path.join(root, "config"), path.join(bare, "config"), { recursive: true });
      fs.mkdirSync(path.join(bare, "state"), { recursive: true });
      fs.writeFileSync(path.join(bare, "state", "topics.json"), "[]\n", "utf8");
      const bareSuite = await runTestSuite({ root: bare, mode: "state", net: false, write: false, record: false });
      const bareReport = bareSuite.report;
      const bareValidation = validateTestReport(bareReport, renderTestReportMarkdown(bareReport));
      const evidenceUnavailable = bareReport.fields.errors.some((error) => error.what === "اختبار الكشف لم يُنفَّذ");
      check(log, checks, "stateRunReportsUnavailableDataExplicitly", () =>
        bareValidation.ok && bareValidation.fieldsPresent === 7 &&
        bareReport.fields.executed.count === 1 && bareReport.fields.results.sources.available === true &&
        bareReport.fields.results.detection.available === false && bareReport.fields.results.forecast.available === false && bareReport.fields.results.saturation.available === false &&
        evidenceUnavailable && bareReport.fields.errors.length >= 3 && bareReport.fields.results.forecast.hitRatePercent === null &&
        bareReport.mode === "state" && !fs.existsSync(path.join(bare, "reports")),
        `executed=${bareReport.fields.executed.count}/4; errors=${bareReport.fields.errors.length}; sources=${bareReport.fields.results.sources.total}`);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }

    details.totalMs = Math.round(performance.now() - startedAt);
  } catch (error) {
    checks.unexpectedError = false;
    log(`unexpectedError=✗ | ${error?.stack ?? error}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  const passed = Object.values(checks).every(Boolean);
  log("— B6 checks —");
  for (const [name, value] of Object.entries(checks)) log(`${name}=${value ? "✓" : "✗"}`);
  log(`totalMs=${Math.round(performance.now() - startedAt)}`);
  log(`النتيجة: ${passed ? "خضراء — B6 (الاختبارات + التقارير + سجل الدوركس + النماذج) مقفلة" : "حمراء — بوابة B6 غير مكتملة"}`);
  log("== B6 SELFTEST END ==");
  return { ok: passed, checks, details };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runB6Selftest({ root: process.cwd() });
  process.exit(result.ok ? 0 : 1);
}
