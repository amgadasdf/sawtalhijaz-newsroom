// engine/test.js — غلاف أمر الاختبارات (كانت B0 stub «اختبارات كشف/تنبؤ/تشبع/مصادر في B5+»).
// نُفّذت في B6 داخل engine/tests.js، وهذا الملف يوجّه الأمر القديم إليها بلا منطق مكرر.
// قرار B1 المؤكد في B5: الامتداد .js حصراً — مواصفة B6 ذكرت engine/tests.mjs ونُفّذ engine/tests.js.
import { runTestsCli } from "./tests.js";

process.exit(await runTestsCli({ root: process.cwd(), argv: process.argv.slice(2) }));
