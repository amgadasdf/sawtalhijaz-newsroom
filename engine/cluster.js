// Arabic-aware deterministic clustering using normalized token overlap (Dice coefficient).
import { createHash } from "node:crypto";
import { normalizeArabicText } from "./normalizer.js";

export const DEFAULT_CLUSTER_THRESHOLD = 0.42;

export function tokenizeArabic(value = "") {
  return [...new Set(normalizeArabicText(value).match(/[\p{L}\p{N}]+/gu) ?? [])].sort();
}

export function compareTitles(left, right, { threshold = DEFAULT_CLUSTER_THRESHOLD } = {}) {
  const normalizedLeft = normalizeArabicText(left);
  const normalizedRight = normalizeArabicText(right);
  if (!normalizedLeft || !normalizedRight) return { score: 0, sharedKeywords: [], matches: false };
  if (normalizedLeft === normalizedRight) {
    return { score: 1, sharedKeywords: tokenizeArabic(normalizedLeft), matches: true };
  }
  const a = tokenizeArabic(normalizedLeft);
  const b = tokenizeArabic(normalizedRight);
  if (!a.length || !b.length) return { score: 0, sharedKeywords: [], matches: false };
  const setB = new Set(b);
  const sharedKeywords = a.filter((token) => setB.has(token));
  const score = (2 * sharedKeywords.length) / (a.length + b.length);
  const matches = sharedKeywords.length >= 2 && score >= threshold;
  return { score, sharedKeywords, matches };
}

function latestIso(values, fallback = null) {
  const dates = values.map((value) => new Date(value ?? "").getTime()).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : fallback;
}

function earliestIso(values, fallback = null) {
  const dates = values.map((value) => new Date(value ?? "").getTime()).filter(Number.isFinite);
  return dates.length ? new Date(Math.min(...dates)).toISOString() : fallback;
}

function previousTopicCandidates(previousTopics) {
  if (Array.isArray(previousTopics)) return previousTopics;
  if (Array.isArray(previousTopics?.topics)) return previousTopics.topics;
  return [];
}

function topicTitles(topic) {
  return [topic?.title, topic?.name, ...(Array.isArray(topic?.members) ? topic.members.map((item) => item?.title) : [])]
    .filter((value) => typeof value === "string" && value.trim());
}

function findPreviousTopic(cluster, previousTopics, usedPrevious) {
  const candidates = previousTopicCandidates(previousTopics);
  const memberIds = new Set(cluster.items.map((item) => item.id));
  const exact = candidates.find((topic, index) => !usedPrevious.has(index) &&
    (topic?.id === cluster.id || (Array.isArray(topic?.members) && topic.members.some((item) => memberIds.has(item?.id)))));
  if (exact) return { topic: exact, index: candidates.indexOf(exact) };

  let best = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (usedPrevious.has(index)) continue;
    const candidate = candidates[index];
    let similarity = { score: 0, matches: false };
    for (const title of topicTitles(candidate)) {
      const currentCompare = compareTitles(cluster.title, title);
      if (currentCompare.score > similarity.score) similarity = currentCompare;
    }
    if (similarity.matches && (!best || similarity.score > best.similarity.score)) best = { topic: candidate, index, similarity };
  }
  return best;
}

function deterministicTopicId(items, title) {
  const common = tokenizeArabic(title).join("-") || items.map((item) => item.id).sort().join("-");
  return `topic-${createHash("sha256").update(common).digest("hex").slice(0, 14)}`;
}

export function clusterItems(items, {
  threshold = DEFAULT_CLUSTER_THRESHOLD,
  previousTopics = [],
} = {}) {
  const input = Array.isArray(items) ? items.filter((item) => item && typeof item.title === "string" && item.title.trim()) : [];
  const parent = input.map((_, index) => index);
  const rank = input.map(() => 0);
  const find = (index) => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) parent[rootA] = rootB;
    else if (rank[rootA] > rank[rootB]) parent[rootB] = rootA;
    else {
      parent[rootB] = rootA;
      rank[rootA] += 1;
    }
  };

  for (let left = 0; left < input.length; left += 1) {
    for (let right = left + 1; right < input.length; right += 1) {
      if (compareTitles(input[left].title, input[right].title, { threshold }).matches) union(left, right);
    }
  }

  const groups = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(input[index]);
  }

  const usedPrevious = new Set();
  const clusters = [];
  for (const group of groups.values()) {
    const title = [...group].sort((a, b) => b.title.length - a.title.length || a.title.localeCompare(b.title, "ar"))[0].title;
    const provisional = { title, items: group, id: deterministicTopicId(group, title) };
    const previousMatch = findPreviousTopic(provisional, previousTopics, usedPrevious);
    const previous = previousMatch?.topic ?? null;
    if (previousMatch) usedPrevious.add(previousMatch.index);
    const sources = [...new Set(group.map((item) => item.source).filter(Boolean))].sort();
    const fetchedAts = group.map((item) => item.fetchedAt).filter(Boolean);
    const itemIds = [...new Set(group.map((item) => item.id))].sort();
    const keywordCounts = new Map();
    for (const item of group) {
      for (const keyword of tokenizeArabic(item.title)) keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }
    const sharedKeywords = [...keywordCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
      .map(([keyword]) => keyword);
    const previousCount = Number(previous?.totalObservations ?? previous?.count ?? 0);
    const currentCount = group.length;

    clusters.push({
      id: previous?.id ?? provisional.id,
      title,
      firstSeen: previous?.firstSeen ?? earliestIso(fetchedAts, null),
      lastSeen: latestIso([...fetchedAts, previous?.lastSeen], null),
      count: currentCount,
      currentCount,
      totalObservations: (Number.isFinite(previousCount) ? previousCount : 0) + currentCount,
      sources,
      deskGuess: group.find((item) => item.deskGuess)?.deskGuess ?? previous?.deskGuess ?? null,
      sharedKeywords,
      memberIds: itemIds,
      members: group,
    });
  }

  return clusters.sort((a, b) => b.currentCount - a.currentCount || a.title.localeCompare(b.title, "ar"));
}

export function normalizeTopicsState(value) {
  if (Array.isArray(value)) return { _meta: {}, topics: value };
  if (value && typeof value === "object" && Array.isArray(value.topics)) return { _meta: value._meta ?? {}, topics: value.topics };
  return { _meta: {}, topics: [] };
}
