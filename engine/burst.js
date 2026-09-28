// B3 burst signals: historical Z score, safe optional pytrends hook, and conservative forecast.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStore } from "./state.js";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value, places = 4) => Number(finite(value).toFixed(places));

export function calculateZScore(currentCount, history = []) {
  const values = (Array.isArray(history) ? history : []).map((value) => finite(value)).filter(Number.isFinite);
  const current = Math.max(0, finite(currentCount));
  if (values.length === 0) return { zScore: 0, mean: 0, standardDeviation: 0, sampleCount: 0, zeroVariance: true };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  const zeroVariance = standardDeviation === 0;
  const zScore = zeroVariance ? (current > mean ? 3 : 0) : (current - mean) / standardDeviation;
  return {
    zScore: rounded(zScore),
    mean: rounded(mean),
    standardDeviation: rounded(standardDeviation),
    sampleCount: values.length,
    zeroVariance,
  };
}

export function isForecastedWithinHours({ previousTopic, topic, saturationPercent } = {}) {
  const previousAcceleration = finite(previousTopic?.metrics?.accelerationPerHour ?? previousTopic?.acceleration);
  const currentAcceleration = finite(topic?.metrics?.accelerationPerHour ?? topic?.acceleration);
  const positiveAcrossTwoRuns = Boolean(previousTopic) && previousAcceleration > 0 && currentAcceleration > 0;
  const lowSaturation = finite(saturationPercent ?? topic?.saturation) < 50;
  return {
    forecast: positiveAcrossTwoRuns && lowSaturation ? "متوقع خلال ساعات" : "غير متوقع",
    positiveAcrossTwoRuns,
    lowSaturation,
    previousAcceleration: rounded(previousAcceleration),
    currentAcceleration: rounded(currentAcceleration),
  };
}

export function readTopicCountHistory(root, topicId, limit = 30) {
  const store = createStore(root);
  if (!store.exists("state/runs")) return [];
  const runFiles = fs.readdirSync(store.abs("state/runs"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const rel = path.join("state/runs", file);
      return { rel, doc: store.readJsonSafe(rel, null) };
    })
    .filter(({ doc }) => doc?.kind === "B3-radar" && doc?.topicCounts && Object.hasOwn(doc.topicCounts, topicId))
    .sort((a, b) => String(a.doc.iso).localeCompare(String(b.doc.iso)))
    .slice(-Math.max(1, limit));
  return runFiles.map(({ doc }) => finite(doc.topicCounts[topicId]));
}

export function queryPytrendsHook(keyword, { root = process.cwd(), timeoutMs = 3000 } = {}) {
  const script = path.join(root, "tools", "pytrends-hook.py");
  if (!fs.existsSync(script)) return { available: false, reason: "pytrends-hook.py غير موجود", values: [] };
  const result = spawnSync("python3", [script, String(keyword ?? "")], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  if (result.error) {
    return {
      available: false,
      reason: result.error.code === "ENOENT" ? "python3 غير متاح" : `${result.error.name}: ${result.error.message}`,
      values: [],
    };
  }
  if (result.status !== 0) {
    return { available: false, reason: (result.stderr || `exit ${result.status}`).trim(), values: [] };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return {
      available: parsed?.available === true,
      reason: String(parsed?.reason ?? ""),
      values: Array.isArray(parsed?.values) ? parsed.values.filter(Number.isFinite) : [],
    };
  } catch {
    return { available: false, reason: "استجابة hook ليست JSON صالحاً", values: [] };
  }
}

export function computeBurst(topic, {
  root = process.cwd(),
  previousTopic = null,
  history = null,
  pytrends = true,
} = {}) {
  const historicalCounts = Array.isArray(history) ? history : readTopicCountHistory(root, topic?.id);
  const z = calculateZScore(topic?.currentCount ?? topic?.count, historicalCounts);
  const forecast = isForecastedWithinHours({ previousTopic, topic, saturationPercent: topic?.saturation });
  const keyword = String(topic?.title ?? "").trim().split(/\s+/u).slice(0, 5).join(" ");
  const interest = pytrends
    ? queryPytrendsHook(keyword, { root })
    : { available: false, reason: "لم يُشغّل hook في هذا الاختبار", values: [] };
  return {
    zScore: z.zScore,
    historicalMean: z.mean,
    historicalStandardDeviation: z.standardDeviation,
    historicalSampleCount: z.sampleCount,
    historicalCounts,
    zeroVariance: z.zeroVariance,
    interest,
    forecast: forecast.forecast,
    forecastCriteria: {
      positiveAcrossTwoRuns: forecast.positiveAcrossTwoRuns,
      lowSaturation: forecast.lowSaturation,
      previousAcceleration: forecast.previousAcceleration,
      currentAcceleration: forecast.currentAcceleration,
      saturationPercent: rounded(topic?.saturation),
    },
    burstSignal: z.sampleCount >= 2 && z.zScore >= 2,
  };
}
