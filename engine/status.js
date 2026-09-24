// engine/status.js — stub B0، يُملأ لاحقاً
import fs from "node:fs";
import path from "node:path";
console.log("[status] stub — يقرأ state/ ويُصدر تقرير حالة في B1+");
const topics = JSON.parse(fs.readFileSync(path.join(process.cwd(), "state/topics.json"), "utf8"));
console.log(`topics: ${topics.length}`);
