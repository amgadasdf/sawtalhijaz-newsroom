// B3 opportunity scoring and transparent weighted source saturation metrics.

const clamp = (value, low = 0, high = 100) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value, places = 4) => Number(finite(value).toFixed(places));

export const CLASSIFICATION_RULES = Object.freeze({
  golden: "accelerationPerHour > 0 && saturationPercent < 25",
  window: "25 <= saturationPercent < 50; below 25 without positive acceleration",
  crowded: "saturationPercent >= 50 && saturationPercent <= 75",
  missed: "saturationPercent > 75",
});

// التصنيف وصفي مستقل عن OpportunityScore؛ الدرجة أداة ترتيب فقط.
// التشبع الأقل من 25% بلا تسارع موجب يبقى «نافذة» لا «نافذة ذهبية».
export function classifyOpportunity({ accelerationPerHour = 0, saturationPercent = 0 } = {}) {
  const acceleration = finite(accelerationPerHour);
  const saturation = clamp(finite(saturationPercent));
  if (acceleration > 0 && saturation < 25) return { key: "golden", label: "نافذة ذهبية" };
  if (saturation < 50) return { key: "window", label: "نافذة" };
  if (saturation <= 75) return { key: "crowded", label: "مزدحم" };
  return { key: "missed", label: "فائت" };
}

export function applyTopicClassification(topic) {
  const metrics = topic?.metrics ?? {};
  const classification = classifyOpportunity({
    accelerationPerHour: metrics.accelerationPerHour ?? topic?.acceleration,
    saturationPercent: metrics.saturationPercent ?? topic?.saturation,
  });
  return {
    ...topic,
    classification: classification.label,
    metrics: {
      ...metrics,
      classification: classification.label,
      classificationKey: classification.key,
    },
  };
}

function activeDailySources(sourceConfig) {
  return Object.entries(sourceConfig ?? {})
    .filter(([, source]) => source?.enabled === true && source?.daily_enabled !== false && finite(source?.weight) > 0)
    .map(([id, source]) => ({ id, weight: finite(source.weight) }));
}

export function calculateSaturation(topic, sourceConfig = {}) {
  const tracked = activeDailySources(sourceConfig);
  const trackedById = new Map(tracked.map((source) => [source.id, source.weight]));
  const denominator = tracked.reduce((sum, source) => sum + source.weight, 0);
  const topicSources = new Set([
    ...(Array.isArray(topic?.sources) ? topic.sources : []),
    ...(Array.isArray(topic?.members) ? topic.members.map((item) => item?.source) : []),
  ].filter(Boolean));
  const coveredSources = [...topicSources].filter((id) => trackedById.has(id));
  const numerator = coveredSources.reduce((sum, id) => sum + trackedById.get(id), 0);
  return {
    percent: denominator > 0 ? rounded(clamp((numerator / denominator) * 100)) : 0,
    numerator: rounded(numerator),
    denominator: rounded(denominator),
    coveredSources: coveredSources.sort(),
    trackedSourceCount: tracked.length,
    coveredSourceCount: coveredSources.length,
  };
}

function sourceReliability(topic, sourceConfig) {
  const tracked = activeDailySources(sourceConfig);
  const weightById = new Map(tracked.map((source) => [source.id, source.weight]));
  const maxWeight = Math.max(0, ...tracked.map((source) => source.weight));
  const unique = [...new Set([
    ...(Array.isArray(topic?.sources) ? topic.sources : []),
    ...(Array.isArray(topic?.members) ? topic.members.map((item) => item?.source) : []),
  ].filter((id) => weightById.has(id)))];
  const averageWeight = unique.length
    ? unique.reduce((sum, id) => sum + weightById.get(id), 0) / unique.length
    : 0;
  return {
    percent: maxWeight > 0 ? rounded(clamp((averageWeight / maxWeight) * 100)) : 0,
    averageWeight: rounded(averageWeight),
    maxWeight: rounded(maxWeight),
    sources: unique.sort(),
  };
}

function deskRelevance(topic, requestedSection) {
  if (!requestedSection || requestedSection === "all" || requestedSection === "الكل") return 50;
  if (!topic?.deskGuess) return 50;
  return topic.deskGuess === requestedSection ? 100 : 25;
}

function parseMillis(value) {
  const millis = new Date(value ?? "").getTime();
  return Number.isFinite(millis) ? millis : null;
}

export function calculateTopicMetrics(topic, {
  previousTopic = null,
  previousRunIso = null,
  nowIso = new Date().toISOString(),
  sourceConfig = {},
  requestedSection = null,
} = {}) {
  const currentCount = Math.max(0, finite(topic?.currentCount ?? topic?.count));
  const previousCount = Math.max(0, finite(previousTopic?.currentCount ?? previousTopic?.count));
  const previousRunMs = parseMillis(previousRunIso);
  const nowMs = parseMillis(nowIso);
  const elapsedHours = previousRunMs !== null && nowMs !== null && nowMs > previousRunMs
    ? (nowMs - previousRunMs) / 3_600_000
    : 0;
  const speedPerHour = elapsedHours > 0 ? (currentCount - previousCount) / elapsedHours : 0;
  const previousSpeedPerHour = finite(previousTopic?.metrics?.speedPerHour ?? previousTopic?.speed);
  const accelerationPerHour = previousTopic && elapsedHours > 0 ? (speedPerHour - previousSpeedPerHour) / elapsedHours : 0;

  const saturation = calculateSaturation(topic, sourceConfig);
  const reliability = sourceReliability(topic, sourceConfig);
  const relevance = deskRelevance(topic, requestedSection);
  const accelerationScore = clamp(50 + accelerationPerHour * 10);
  const inverseSaturationScore = clamp(100 - saturation.percent);
  const contributions = {
    acceleration: rounded(accelerationScore * 0.4),
    inverseSaturation: rounded(inverseSaturationScore * 0.3),
    deskRelevance: rounded(relevance * 0.15),
    sourceReliability: rounded(reliability.percent * 0.15),
  };
  const score = clamp(Object.values(contributions).reduce((sum, value) => sum + finite(value), 0));
  const classification = classifyOpportunity({
    accelerationPerHour,
    saturationPercent: saturation.percent,
  });

  return {
    elapsedHours: rounded(elapsedHours),
    previousCount: rounded(previousCount),
    currentCount: rounded(currentCount),
    speedPerHour: rounded(speedPerHour),
    previousSpeedPerHour: rounded(previousSpeedPerHour),
    accelerationPerHour: rounded(accelerationPerHour),
    saturationPercent: rounded(saturation.percent),
    saturationNumerator: rounded(saturation.numerator),
    saturationDenominator: rounded(saturation.denominator),
    coverageSources: saturation.coveredSources,
    trackedSourceCount: saturation.trackedSourceCount,
    sourceReliabilityPercent: rounded(reliability.percent),
    sourceReliabilitySources: reliability.sources,
    deskRelevancePercent: rounded(relevance),
    accelerationScore: rounded(accelerationScore),
    inverseSaturationScore: rounded(inverseSaturationScore),
    components: contributions,
    score: rounded(score),
    classification: classification.label,
    classificationKey: classification.key,
    formula: "0.40*accelerationScore + 0.30*(100-saturationPercent) + 0.15*deskRelevance + 0.15*sourceReliability",
    baseline: elapsedHours === 0,
  };
}

export function scoreTopics(topics, {
  previousTopics = [],
  previousRunIso = null,
  nowIso = new Date().toISOString(),
  sourceConfig = {},
  requestedSection = null,
} = {}) {
  const previousById = new Map((Array.isArray(previousTopics) ? previousTopics : []).map((topic) => [topic.id, topic]));
  return (Array.isArray(topics) ? topics : []).map((topic) => {
    const previousTopic = previousById.get(topic.id) ?? null;
    const metrics = calculateTopicMetrics(topic, {
      previousTopic,
      previousRunIso,
      nowIso,
      sourceConfig,
      requestedSection,
    });
    return {
      ...topic,
      speed: metrics.speedPerHour,
      acceleration: metrics.accelerationPerHour,
      saturation: metrics.saturationPercent,
      score: metrics.score,
      classification: metrics.classification,
      metrics,
    };
  });
}
