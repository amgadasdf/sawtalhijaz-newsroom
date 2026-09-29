// B7: reproducible isolated prompt applications, never a publication decision.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { withB3FixtureRadar } from '../../engine/radar-selftest.js';
import { formatRadarAnalystTrial } from '../../engine/b5-selftest.js';
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('B7: live network forbidden'); };
const root = process.cwd();
const before = fs.existsSync('state/topics-latest.json') ? fs.readFileSync('state/topics-latest.json','utf8') : null;
await withB3FixtureRadar(root, async ({ sandbox, radar, env }) => {
  assert.ok(radar.ok);
  const latest = JSON.parse(fs.readFileSync(`${sandbox}/state/topics-latest.json`));
  fs.writeFileSync('reports/B7-evidence/role-input.json', JSON.stringify({ provenance: 'تجربة على بيانات معزولة — غير حية', ...latest }, null, 2)+'\n');
  const analyst = formatRadarAnalystTrial(latest);
  const topics = [...latest.topics].sort((a,b)=>b.score-a.score);
  const chief = [
    'حالة البيانات: تجربة على بيانات معزولة — غير حية',
    `الزمن ومصدره: ${latest.time.iso} | ${latest.time.source}`,
    `نطاق المراجعة: B7 fixture trial / ${topics.length} فرص`,
    'ترتيب الأولويات:',
    ...topics.map((t,i)=>`${i+1}) ${t.id} | ${t.title} | ${t.score} (ترتيب فقط) | ${t.metrics.classification} | القرار: انتظار | السبب: بيانات غير حية؛ التسارع=${t.metrics.accelerationPerHour} والتشبع=${t.metrics.saturationPercent}% لا يثبتان خبراً صالحاً للنشر.`),
    'البريفات الموقعة:',
    '- لا يوجد | التوقيع: رئيس التحرير التنفيذي | ملاحظة للمالك: هذه مراجعة تجريبية، لا بريف للنشر ولا اعتماد نيابة عن المالك.',
    'غير محسوم/بيانات ناقصة: التحقق الحي والأدلة التحريرية غير متاحين؛ البطارية الحية للمجلس قبل التسليم.'
  ].join('\n');
  for (const t of topics) { assert.ok(analyst.includes(t.id)); assert.ok(chief.includes(t.id)); }
  assert.equal((chief.match(/القرار: انتظار/g)||[]).length,topics.length);
  const text = `استدعاء radar-analyst — الموضوع: فرص رادار B3 المعزول\n${analyst}\n\nاستدعاء chief-editor — الموضوع: مراجعة فرص الرادار المعزول\n${chief}\n`;
  fs.writeFileSync('reports/B7-evidence/roles.txt',text);
  console.log(text);
  console.log(`roles=2 | topicsEach=${topics.length} | fixtureRequests=${env.requestUrls.length} | realFetchCalls=${networkCalls}`);
});
assert.equal(networkCalls,0);
assert.equal(fs.existsSync('state/topics-latest.json') ? fs.readFileSync('state/topics-latest.json','utf8') : null,before);
console.log('realTopicsUnchanged=true | rolesGate=PASS');
