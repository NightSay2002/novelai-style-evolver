import { artistCountRange, voteDeltas } from "./evolution.js?v=12";

export const LEARNING_VERSION = 1;
const MODEL_COUNT = 5;
const PAIR_LIMIT = 10000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pick = (items, rng) => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
const tagKey = (tag) => String(tag).toLowerCase();
const weights = Array.from({ length: 20 }, (_, i) => (i + 1) / 10);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pairKey = (a, b) => `p:${JSON.stringify([a, b].sort())}`;

export function createLearning() {
  return { version: LEARNING_VERSION, rounds: 0, directRounds: 0, models: Array.from({ length: MODEL_COUNT }, () => ({})), artists: {}, pairs: {}, recentEvents: [] };
}

export function compatibleLearning(value) {
  return value?.version === LEARNING_VERSION && value.models?.length === MODEL_COUNT
    && value.models.every((model) => model && typeof model === "object") && value.artists && value.pairs
    && Array.isArray(value.recentEvents) && Number.isSafeInteger(value.rounds);
}

export function seedArtistPreferences(learning, tags, score = 1) {
  const next = structuredClone(compatibleLearning(learning) ? learning : createLearning());
  const delta = clamp(Number(score) || 0, -60, 60) / 10;
  for (const tag of new Set(tags.map(tagKey))) {
    if (!tag.startsWith("artist:")) continue;
    const stat = next.artists[tag] ||= { appearances: 0, comparisons: 0, independent: 0 };
    stat.seeded = true;
    stat.seededScore = (stat.seededScore || 0) + score;
    for (const model of next.models) model[`a:${tag}`] = clamp((model[`a:${tag}`] || 0) + delta, -6, 6);
  }
  return next;
}

// Whitelist only generation inputs. Never hash/store tokens, filenames or UI state.
export async function comparisonContext(settings, image2Image = null, references = null) {
  const inputs = {
    content: settings.contentPrompt, negative: settings.negativePrompt, quality: settings.seedStylePrompt,
    settings: settings.generationSettings,
    image2Image: image2Image ? { image: image2Image.image, strength: image2Image.strength, noise: image2Image.noise } : null,
    references: references ? {
      normalize: references.normalize,
      vibes: (references.vibes || []).map(({ image, strength, informationExtracted }) => ({ image, strength, informationExtracted })),
      precise: (references.precise || []).map(({ image, strength, fidelity, type }) => ({ image, strength, fidelity, type }))
    } : null
  };
  const stable = (value) => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(inputs))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sameContext(a, b) {
  return Boolean(a?.contextKey && a.contextKey === b?.contextKey);
}

function artistValues(genome) {
  return (genome.artists || []).map((item) => ({ tag: tagKey(item.tag), weight: clamp(Number(item.weight) || 1, 0.1, 2) }));
}

export function preferenceFeatures(genome, learning) {
  const features = {};
  const artists = artistValues(genome);
  for (const { tag, weight } of artists) {
    const centered = weight - 1;
    features[`a:${tag}`] = 1;
    features[`w:${tag}`] = centered;
    features[`q:${tag}`] = centered ** 2;
  }
  for (let i = 0; i < artists.length; i += 1) {
    for (let j = i + 1; j < artists.length; j += 1) {
      const key = pairKey(artists[i].tag, artists[j].tag);
      if ((learning.pairs[key]?.rounds || 0) >= 3) features[key] = artists[i].weight * artists[j].weight / 4;
    }
  }
  return features;
}

function difference(winner, loser, learning) {
  const left = preferenceFeatures(winner, learning);
  const right = preferenceFeatures(loser, learning);
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])]
    .map((key) => [key, (left[key] || 0) - (right[key] || 0)]).filter(([, value]) => Math.abs(value) > 1e-9));
}

function dot(model, features) {
  return Object.entries(features).reduce((sum, [key, value]) => sum + (model[key] || 0) * value, 0);
}

function directScore(genome, learning) {
  const artists = artistValues(genome);
  return artists.reduce((sum, item) => sum + (learning.artists[item.tag]?.feedbackScore || 0), 0) / Math.max(1, artists.length) / 10;
}

export function predictPreference(genome, learning) {
  const features = preferenceFeatures(genome, learning);
  const direct = directScore(genome, learning);
  const values = learning.models.map((model) => dot(model, features) + direct);
  const score = mean(values);
  return { score, uncertainty: Math.sqrt(mean(values.map((value) => (value - score) ** 2))), values };
}

// A batch is the sampling unit: its pairwise expansions are correlated.
function poissonOne(rng) {
  let product = 1;
  let count = 0;
  do { count += 1; product *= Math.max(Number.EPSILON, rng()); } while (product > Math.exp(-1) && count < 8);
  return count - 1;
}

export function applyPreferenceVote(learning, candidates, selectedIds = [], dislikedIds = [], {
  baseline = null, promotedId = null, action = "vote", eventId = "", rng = Math.random
} = {}) {
  const next = structuredClone(compatibleLearning(learning) ? learning : createLearning());
  if (eventId && next.recentEvents.includes(eventId)) return { learning: next, candidateDeltas: {}, comparisonCount: 0 };
  const records = candidates.filter((item) => item.status === "success");
  const disliked = new Set(action === "reject" ? records.map((item) => item.id) : action === "ignore" ? [] : dislikedIds);
  const selected = new Set(action === "ignore" || action === "reject" ? [] : selectedIds.filter((id) => !disliked.has(id)));
  const promoted = action === "vote" && records.find((item) => item.id === promotedId && !disliked.has(item.id));
  if (promoted) selected.add(promoted.id);
  const deltas = voteDeltas(records.filter((item) => selected.has(item.id)).length, records.length || 5);
  const candidateDeltas = Object.fromEntries(records.map((item) => [item.id,
    disliked.has(item.id) ? -3 : selected.has(item.id) ? deltas.selected : -1]));
  const comparisons = [];
  const add = (winner, loser, strength) => {
    if (winner.id !== loser.id && sameContext(winner, loser)) comparisons.push({ winner: winner.genome, loser: loser.genome, strength });
  };
  if (action === "vote") {
    for (const winner of records.filter((item) => selected.has(item.id))) {
      for (const loser of records.filter((item) => !selected.has(item.id))) add(winner, loser, disliked.has(loser.id) ? 1 : 0.25);
    }
    if (promoted && baseline) add(promoted, baseline, 1);
  } else if (action === "reject" && baseline) {
    for (const item of records) add(baseline, item, 1);
  }
  const useful = comparisons.filter(({ winner, loser }) => Object.keys(difference(winner, loser, next)).length);
  const rememberWeights = (genome) => {
    for (const { tag, weight } of artistValues(genome)) {
      const stat = next.artists[tag] ||= { appearances: 0, comparisons: 0, independent: 0 };
      if (!stat.observedWeights?.includes(weight)) stat.observedWeights = [...(stat.observedWeights || []), weight].sort((a, b) => a - b);
    }
  };
  if (useful.length) {
    next.rounds += 1;
    const seen = new Set();
    const distinguished = new Set();
    const pairSeen = new Set();
    const identityPatterns = new Map();
    useful.forEach(({ winner, loser }, index) => {
      const diff = difference(winner, loser, next);
      for (const genome of [winner, loser]) {
        rememberWeights(genome);
        const artists = artistValues(genome);
        for (const item of artists) seen.add(item.tag);
        for (let i = 0; i < artists.length; i += 1) {
          for (let j = i + 1; j < artists.length; j += 1) pairSeen.add(pairKey(artists[i].tag, artists[j].tag));
        }
      }
      for (const key of Object.keys(diff).filter((key) => key.startsWith("a:"))) {
        const tag = key.slice(2);
        distinguished.add(tag);
        if (!identityPatterns.has(tag)) identityPatterns.set(tag, Array(useful.length).fill(0));
        identityPatterns.get(tag)[index] = diff[key];
      }
    });
    for (const tag of seen) {
      const stat = next.artists[tag] ||= { appearances: 0, comparisons: 0, independent: 0 };
      stat.appearances += 1;
      if (distinguished.has(tag)) {
        stat.comparisons += 1;
        const pattern = JSON.stringify(identityPatterns.get(tag));
        // Artists moving together are not independent evidence about each member.
        if ([...identityPatterns.values()].filter((value) => JSON.stringify(value) === pattern).length === 1) stat.independent += 1;
      }
    }
    for (const key of pairSeen) {
      const stat = next.pairs[key] ||= { rounds: 0, last: next.rounds };
      stat.rounds += 1;
      stat.last = next.rounds;
    }
    const training = useful.map((item) => ({ ...item, diff: difference(item.winner, item.loser, next) }));
    // Cap a batch at one unit of evidence without promoting an all-weak batch
    // to full strength: neutral-only feedback must stay one quarter as strong.
    const total = training.length;
    next.models.forEach((model) => {
      const repetitions = poissonOne(rng);
      if (!repetitions) return;
      // Proximal L2 update, shared batch gradient, bounded feature-normalized step.
      const gradient = {};
      for (const { winner, loser, diff, strength } of training) {
        const residual = 1 / (1 + Math.exp(clamp(dot(model, diff) + directScore(winner, next) - directScore(loser, next), -30, 30)));
        const norm = Math.max(1, Math.sqrt(Object.values(diff).reduce((sum, value) => sum + value * value, 0)));
        for (const [key, value] of Object.entries(diff)) gradient[key] = (gradient[key] || 0) + residual * value * strength / total / norm;
      }
      const step = 0.8 * repetitions;
      for (const [key, value] of Object.entries(gradient)) {
        const regularization = key.startsWith("p:") ? 0.12 : 0.015;
        model[key] = clamp(((model[key] || 0) + step * value) / (1 + step * regularization), -6, 6);
      }
    });
    const stale = Object.entries(next.pairs).sort((a, b) => b[1].last - a[1].last).slice(PAIR_LIMIT);
    for (const [key] of stale) { delete next.pairs[key]; for (const model of next.models) delete model[key]; }
  }
  if (action !== "ignore") {
    const feedback = new Map();
    for (const item of records) {
      if (!selected.has(item.id) && !disliked.has(item.id)) continue;
      rememberWeights(item.genome);
      const delta = disliked.has(item.id) ? -3 : deltas.selected;
      for (const { tag } of artistValues(item.genome)) {
        const value = feedback.get(tag) || { sum: 0, count: 0, liked: false, disliked: false };
        value.sum += delta;
        value.count += 1;
        value.liked ||= selected.has(item.id);
        value.disliked ||= disliked.has(item.id);
        feedback.set(tag, value);
      }
    }
    let updated = false;
    for (const [tag, value] of feedback) {
      // Mixed feedback for the same artist is ambiguous; the relative weight
      // and combination model above can still learn from those cards.
      if (value.liked && value.disliked) continue;
      const stat = next.artists[tag];
      const previous = stat.feedbackScore || 0;
      const delta = value.sum / value.count;
      // Repeated agreement has diminishing returns but never stops changing
      // the rank; opposing feedback can still reverse the trend.
      stat.feedbackScore = previous + delta / (previous * delta > 0 ? 1 + Math.abs(previous) / 20 : 1);
      stat.feedbackRounds = (stat.feedbackRounds || 0) + 1;
      updated = true;
    }
    if (updated) next.directRounds = (next.directRounds || 0) + 1;
  }
  // Exposure is separate from credit, including ignored/fully rejected cold starts.
  for (const tag of new Set(records.flatMap((item) => item.genome.artists.map((artist) => tagKey(artist.tag))))) {
    next.artists[tag] ||= { appearances: 0, comparisons: 0, independent: 0 };
    next.artists[tag].lastSeen = next.rounds;
  }
  if (eventId) next.recentEvents = [...next.recentEvents, eventId].slice(-100);
  return { learning: next, candidateDeltas, comparisonCount: useful.length };
}

export function preferenceRanking(learning, limit = 20, lowest = false) {
  return Object.entries(learning.artists).map(([tag, stat]) => {
    const identity = mean(learning.models.map((model) => model[`a:${tag}`] || 0)) * 10 + (stat.feedbackScore || 0);
    const scores = (stat.observedWeights?.length ? stat.observedWeights : [1]).map((weight) => {
      const centered = weight - 1;
      return { weight, score: identity + mean(learning.models.map((model) =>
        (model[`w:${tag}`] || 0) * centered + (model[`q:${tag}`] || 0) * centered ** 2)) * 10 };
    }).sort((a, b) => b.score - a.score || a.weight - b.weight);
    return {
      tag, score: identity, bestScore: scores[0].score, weight: scores[0].weight,
      worstScore: scores.at(-1).score, worstWeight: scores.at(-1).weight,
      rounds: stat.comparisons, independent: stat.independent,
      evidence: stat.independent >= 3 ? "有比較依據" : stat.feedbackRounds ? "整圖回饋" : stat.seeded ? "自選起點" : "待確認",
      seeded: Boolean(stat.seeded), feedbackRounds: stat.feedbackRounds || 0
    };
  }).filter((item) => item.rounds > 0 || item.seeded || item.feedbackRounds || learning.artists[item.tag].observedWeights?.length)
    .sort((a, b) => (lowest ? a.score - b.score : b.score - a.score) || b.independent - a.independent || a.tag.localeCompare(b.tag)).slice(0, limit);
}

export function redistributeWeights(artists, rng = Math.random) {
  const result = structuredClone(artists);
  const mutable = result.filter((item) => !item.pinned).sort((a, b) => a.weight - b.weight || a.tag.localeCompare(b.tag));
  if (!mutable.length) return result;
  const extremes = new Map();
  if (mutable.length > 1) {
    extremes.set(mutable[0], "high");
    extremes.set(mutable.at(-1), "low");
  }
  for (const item of mutable) {
    let choices = weights.filter((weight) => Math.abs(weight - item.weight) >= 0.699);
    if (extremes.get(item) === "high") choices = choices.filter((weight) => weight >= 1.2);
    if (extremes.get(item) === "low") choices = choices.filter((weight) => weight <= 0.8);
    // All-high/all-low sets can make the preferred direction infeasible.
    if (!choices.length) choices = weights.filter((weight) => Math.abs(weight - item.weight) >= 0.699);
    item.weight = pick(choices, rng);
  }
  // Reverse equal/high/low clusters too; moving every weight by >= 0.7 remains mandatory.
  if (mutable.length > 1 && mutable[0].weight <= mutable.at(-1).weight) {
    const lowOriginal = artists.find((item) => item.tag === mutable[0].tag).weight;
    const highOriginal = artists.find((item) => item.tag === mutable.at(-1).tag).weight;
    const pairs = weights.flatMap((high) => weights.filter((low) => high > low && Math.abs(high - lowOriginal) >= 0.699
      && Math.abs(low - highOriginal) >= 0.699).map((low) => [high, low]));
    const choice = pick(pairs, rng);
    if (choice) [mutable[0].weight, mutable.at(-1).weight] = choice;
  }
  return result;
}

function signature(genome) {
  return JSON.stringify(genome.artists.map((item) => [tagKey(item.tag), item.weight]).sort((a, b) => a[0].localeCompare(b[0])));
}

export const CANDIDATE_ROLES = { weights: "大幅調權", preferred: "高分延伸", uncertain: "偏好確認", unseen: "新畫師延伸", explore: "全新探索" };

export function generatePreferenceBatch({ batchNumber, parent, artistPool, fixedStyleTerms = [], learning = createLearning(), excludedGenomes = [], rng = Math.random }) {
  if (!artistPool.length) throw new Error("畫師資料庫是空的。");
  const base = structuredClone(parent || { artists: [], styleTerms: fixedStyleTerms });
  base.artists = base.artists.slice(0, 6);
  const [min, max] = artistCountRange(batchNumber);
  const tags = new Set(base.artists.map((item) => tagKey(item.tag)));
  const available = artistPool.filter((item) => !tags.has(tagKey(item.tag)));
  const unseen = available.filter((item) => !learning.artists[tagKey(item.tag)]);
  const ranked = preferenceRanking(learning, 100).filter((item) => item.score > 0);
  const poolLookup = new Map(available.map((item) => [tagKey(item.tag), item]));
  const liked = ranked.map((item) => poolLookup.get(item.tag)).filter(Boolean);
  const observed = available.filter((item) => learning.artists[tagKey(item.tag)]);
  const roles = Object.keys(CANDIDATE_ROLES);
  const results = [];
  const used = new Set([signature(base), ...excludedGenomes.map(signature)]);
  const introduced = new Set();
  const modelIndex = Math.floor(rng() * MODEL_COUNT);
  const createArtist = (tag, weight = pick(weights, rng)) => ({ tag, category: "artist", polarity: "positive", weight });
  const fresh = (items) => {
    const unused = items.filter((item) => !introduced.has(tagKey(item.tag)));
    return unused.length ? unused : items;
  };
  for (const role of roles) {
    const source = fresh(role === "preferred" && liked.length ? liked : role === "uncertain" && observed.length ? observed
      : role === "unseen" && unseen.length ? unseen : available);
    const explorationPool = fresh(unseen.length ? unseen : available.length ? available : artistPool);
    const proposals = [];
    // The operation is drawn once per slot, not selected by the model: 50/50 below six.
    const mutableIndices = base.artists.map((item, index) => !item.pinned ? index : -1).filter((index) => index >= 0);
    const add = base.artists.length < 6 && (!mutableIndices.length || rng() < 0.5);
    // A small high-scoring pool may have exhausted all its single-artist edits.
    // Try the full pool before falling back to a locked copy of the parent.
    const sources = [source];
    if (["preferred", "uncertain", "unseen"].includes(role)) sources.push(fresh(available));
    for (const candidateSource of sources) {
      for (let attempt = 0; attempt < 64; attempt += 1) {
        let artists = structuredClone(base.artists);
        let operation = role;
        if (!artists.length || role === "explore") {
          artists = artists.filter((item) => item.pinned);
          const count = Math.max(artists.length, min + Math.floor(rng() * (max - min + 1)));
          const pool = explorationPool;
          const usedTags = new Set(artists.map((item) => tagKey(item.tag)));
          for (let tries = 0; artists.length < count && tries < 120; tries += 1) {
            const item = pick(pool, rng);
            if (!item || usedTags.has(tagKey(item.tag))) continue;
            artists.push(createArtist(item.tag));
            usedTags.add(tagKey(item.tag));
          }
          operation = "explore";
        } else {
          if (role === "weights") artists = redistributeWeights(artists, rng);
          if (artists.length < min) {
            // Growth applies to preference cards too, even if the saved baseline
            // still has one artist. Keep its identities and fill the missing slots.
            const usedTags = new Set(artists.map((item) => tagKey(item.tag)));
            for (let tries = 0; artists.length < min && tries < 120; tries += 1) {
              const pool = artists.length === base.artists.length && tries < 20 ? candidateSource : available;
              const item = pick(pool, rng);
              if (!item || usedTags.has(tagKey(item.tag))) continue;
              artists.push(createArtist(item.tag));
              usedTags.add(tagKey(item.tag));
            }
            operation = artists.length > base.artists.length ? "grow" : "locked";
          } else if (role !== "weights") {
            if (candidateSource.length && (add || mutableIndices.length)) {
              const item = pick(candidateSource, rng);
              if (add) { artists.push(createArtist(item.tag)); operation = "add"; }
              else {
                const index = pick(mutableIndices, rng);
                artists[index] = createArtist(item.tag, artists[index].weight);
                operation = "replace";
              }
            } else operation = "locked";
          }
        }
        const genome = { artists, styleTerms: structuredClone(fixedStyleTerms), generation: batchNumber,
          parentIds: base.id ? [base.id] : [], role, mutation: { operation, parentId: base.id || null } };
        if (used.has(signature(genome))) continue;
        const prediction = predictPreference(genome, learning);
        const score = role === "preferred" ? prediction.score
          : role === "weights" || role === "uncertain" ? prediction.values[modelIndex] : rng();
        proposals.push({ genome, score });
      }
      if (proposals.length) break;
    }
    proposals.sort((a, b) => b.score - a.score);
    const chosen = proposals[0]?.genome || { artists: structuredClone(base.artists), styleTerms: structuredClone(fixedStyleTerms),
      generation: batchNumber, parentIds: base.id ? [base.id] : [], role, mutation: { operation: "locked", parentId: base.id || null } };
    if (signature(chosen) === signature(base)) chosen.mutation.operation = "locked";
    used.add(signature(chosen));
    for (const item of chosen.artists) if (!tags.has(tagKey(item.tag))) introduced.add(tagKey(item.tag));
    results.push(chosen);
  }
  return results;
}
