import { classifyStyle } from "./style-taxonomy.js?v=1";

export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 2;
export const SCORE_MIN = -20;
export const SCORE_MAX = 20;
export const STYLE_CORE_MIN = 10;
export const STYLE_CORE_MAX = 19;
export const STYLE_AUX_MIN = 2;
export const STYLE_AUX_MAX = 6;
export const STYLE_TERM_MIN = STYLE_CORE_MIN + STYLE_AUX_MIN;
export const STYLE_TERM_MAX = STYLE_CORE_MAX + STYLE_AUX_MAX;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundWeight = (value) => Math.round(clamp(value, WEIGHT_MIN, WEIGHT_MAX) * 10) / 10;
const randomInt = (min, max, rng = Math.random) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (items, rng = Math.random) => items[Math.floor(rng() * items.length)];

export function formatWeight(value) {
  return String(roundWeight(Math.abs(Number(value) || 1)));
}

export function weightedToken(item) {
  const magnitude = formatWeight(item.weight);
  const signed = item.polarity === "negative" ? `-${magnitude}` : magnitude;
  // NovelAI parses a number touching the closing delimiter as another weight
  // (for example `year 2025::`). Keep a space before `::` for digit-ending tags.
  const tag = /\d$/u.test(item.tag) ? `${item.tag} ` : item.tag;
  return `${signed}::${tag}::`;
}

export function serializeGenome(genome, contentPrompt = "", { numerical = true, negativeNumerical = true, negative = false } = {}) {
  const format = (item) => {
    if (numerical) return weightedToken({ ...item, polarity: negative ? "positive" : item.polarity });
    const weight = Math.abs(Number(item.weight) || 1);
    const count = Math.round(Math.abs(Math.log(weight) / Math.log(1.05)));
    const open = weight >= 1 ? "{" : "[";
    const close = weight >= 1 ? "}" : "]";
    return `${open.repeat(count)}${item.tag.replace(/^artist:/u, "")}${close.repeat(count)}`;
  };
  const terms = genome.styleTerms.filter((item) => negative
    ? !negativeNumerical && item.polarity === "negative" : negativeNumerical || item.polarity !== "negative");
  return [
    ...(negative ? [] : genome.artists.map(format)),
    String(contentPrompt || "").trim(),
    ...terms.map(format)
  ].filter(Boolean).join(",\n");
}

export function splitPromptTokens(prompt = "") {
  const result = [];
  let current = "";
  let numericBlock = false;
  for (let index = 0; index < String(prompt).length; index += 1) {
    const char = prompt[index];
    const pair = prompt.slice(index, index + 2);
    if (pair === "::") {
      numericBlock = !numericBlock;
      current += pair;
      index += 1;
      continue;
    }
    if (char === "," && !numericBlock) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function inferCategory(tag, styleLookup = new Map()) {
  const known = styleLookup.get(tag.toLowerCase());
  if (known?.category) return known.category;
  if (/^year \d{4}$/u.test(tag)) return "year";
  if (/ complexity$/u.test(tag)) return "complexity";
  if (/^visual novel /u.test(tag)) return "visual_novel";
  if (/ \(medium\)$/u.test(tag)) return "medium";
  return "custom";
}

export function parseStylePrompt(prompt = "", styleTags = []) {
  const lookup = new Map(styleTags.map((item) => [item.tag.toLowerCase(), item]));
  const layered = styleTags.some((item) => item.layer);
  return splitPromptTokens(prompt).map((raw) => {
    let tag = raw.trim();
    let polarity = "positive";
    let weight = 1;
    const numeric = tag.match(/^(-?\d+(?:\.\d+)?)::([\s\S]*?)::$/u);
    if (numeric) {
      const parsed = Number(numeric[1]);
      polarity = parsed < 0 ? "negative" : "positive";
      weight = roundWeight(Math.abs(parsed));
      tag = numeric[2].trim();
    } else {
      const braces = tag.match(/^(\{+)([\s\S]*?)(\}+)$/u);
      if (braces && braces[1].length === braces[3].length) {
        weight = roundWeight(1.05 ** braces[1].length);
        tag = braces[2].trim();
      }
    }
    const known = lookup.get(tag.toLowerCase());
    const classification = known?.layer ? known : layered ? classifyStyle(tag) : null;
    return {
      tag,
      ...(classification ? { layer: classification.layer, facet: classification.facet } : {}),
      category: polarity === "negative" ? "negative" : inferCategory(tag, lookup),
      polarity: numeric ? polarity : known?.polarity || polarity,
      weight,
      pinned: false
    };
  }).filter((item) => item.tag && !item.tag.startsWith("artist:"));
}

export function artistCountRange(batchNumber) {
  if (batchNumber <= 1) return [1, 1];
  if (batchNumber <= 2) return [1, 2];
  if (batchNumber <= 4) return [2, 3];
  return [3, 6];
}

export function voteDeltas(selectedCount, total = 5) {
  if (selectedCount <= 0) return { selected: 0, unselected: -1 };
  if (selectedCount >= total) return { selected: 0.25, unselected: 0 };
  return { selected: (total - selectedCount) / selectedCount, unselected: -1 };
}

function itemKey(prefix, item) {
  return `${prefix}:${item.tag.toLowerCase()}`;
}

function bucketKey(prefix, item) {
  const sign = item.polarity === "negative" ? "-" : "+";
  return `${prefix}-weight:${item.tag.toLowerCase()}:${sign}${formatWeight(item.weight)}`;
}

export function genomeFeatureKeys(genome) {
  const singles = [
    ...genome.artists.flatMap((item) => [itemKey("artist", item), bucketKey("artist", item)]),
    ...genome.styleTerms.flatMap((item) => [itemKey("style", item), bucketKey("style", item)])
  ];
  const tags = [
    ...genome.artists.map((item) => itemKey("artist", item)),
    ...genome.styleTerms.map((item) => itemKey("style", item))
  ].sort();
  const pairs = [];
  for (let left = 0; left < tags.length; left += 1) {
    for (let right = left + 1; right < tags.length; right += 1) {
      pairs.push(`pair:${tags[left]}|${tags[right]}`);
    }
  }
  return { singles, pairs };
}

function ensureStat(stats, key) {
  if (!stats[key]) stats[key] = { score: 0, appearances: 0, positive: 0, negative: 0 };
  return stats[key];
}

export function applyBatchVote(stats = {}, candidates = [], selectedIds = [], dislikedIds = []) {
  const next = structuredClone(stats);
  Object.values(next).forEach((stat) => {
    stat.score = clamp(stat.score * 0.995, SCORE_MIN, SCORE_MAX);
  });
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const disliked = new Set(dislikedIds.filter((id) => candidateIds.has(id)));
  const selected = new Set(selectedIds.filter((id) => candidateIds.has(id) && !disliked.has(id)));
  const deltas = voteDeltas(selected.size, candidates.length || 5);
  const candidateDeltas = {};
  for (const candidate of candidates) {
    // Explicit dislike is stronger than simply leaving a candidate unselected.
    const delta = disliked.has(candidate.id) ? -3 : selected.has(candidate.id) ? deltas.selected : deltas.unselected;
    candidateDeltas[candidate.id] = delta;
    const keys = genomeFeatureKeys(candidate.genome);
    for (const key of keys.singles) {
      const stat = ensureStat(next, key);
      stat.score = clamp(stat.score + delta, SCORE_MIN, SCORE_MAX);
      stat.appearances += 1;
      if (delta > 0) stat.positive += 1;
      if (delta < 0) stat.negative += 1;
    }
    for (const key of keys.pairs) {
      const stat = ensureStat(next, key);
      stat.score = clamp(stat.score + delta * 0.25, SCORE_MIN, SCORE_MAX);
      stat.appearances += 1;
      if (delta > 0) stat.positive += 1;
      if (delta < 0) stat.negative += 1;
    }
  }
  const pairEntries = Object.entries(next).filter(([key]) => key.startsWith("pair:"));
  if (pairEntries.length > 60_000) {
    const keep = new Set(pairEntries
      .sort((left, right) => (
        right[1].appearances - left[1].appearances
        || Math.abs(right[1].score) - Math.abs(left[1].score)
      ))
      .slice(0, 50_000)
      .map(([key]) => key));
    for (const [key] of pairEntries) if (!keep.has(key)) delete next[key];
  }
  return { stats: next, candidateDeltas };
}

function scoreFor(stats, key) {
  return stats[key]?.score || 0;
}

export function genomeFitness(genome, stats = {}) {
  const { singles, pairs } = genomeFeatureKeys(genome);
  const singleScore = singles.length
    ? singles.reduce((sum, key) => sum + scoreFor(stats, key), 0) / singles.length
    : 0;
  const pairScore = pairs.length
    ? pairs.reduce((sum, key) => sum + scoreFor(stats, key), 0) / pairs.length
    : 0;
  const appearances = singles.reduce((sum, key) => sum + (stats[key]?.appearances || 0), 0);
  const novelty = 1 / Math.sqrt(1 + appearances / Math.max(1, singles.length));
  return singleScore + pairScore * 0.25 + novelty;
}

function poolWeight(item, kind, stats, explore) {
  const key = itemKey(kind, item);
  const stat = stats[key] || { score: 0, appearances: 0 };
  if (explore) return Math.exp(clamp(stat.score / 10, -1, 1)) * (1 + 3 / Math.sqrt(1 + stat.appearances));
  return Math.exp(clamp(stat.score / 5, -3, 3)) + 1 / Math.sqrt(1 + stat.appearances);
}

function weightedPick(items, getWeight, rng = Math.random) {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(0.0001, getWeight(item)));
  let cursor = rng() * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return items[index];
  }
  return items.at(-1);
}

export function drawWeight(rng = Math.random, polarity = "positive", extremeChance = 0.1) {
  const raw = rng() < extremeChance
    ? WEIGHT_MIN + rng() * (WEIGHT_MAX - WEIGHT_MIN)
    : (rng() + rng()) / 2 * (WEIGHT_MAX - WEIGHT_MIN) + WEIGHT_MIN;
  return { weight: roundWeight(raw), polarity };
}

function mutateWeight(item, rng) {
  const direction = rng() < 0.5 ? -1 : 1;
  const amount = pick([0.1, 0.2, 0.3], rng);
  return { ...item, weight: roundWeight(item.weight + direction * amount) };
}

function categoryCounts(items) {
  return items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
}

function canAddStyle(item, current, categories) {
  if (item.layer) {
    if (current.some((value) => value.tag.toLowerCase() === item.tag.toLowerCase())) return false;
    const limit = item.facet === "suppression" ? 3 : item.facet === "custom" ? 2 : 1;
    const sameFacet = current.filter((value) => value.layer === item.layer && value.facet === item.facet
      && (item.layer !== "auxiliary" || value.polarity === item.polarity));
    if (sameFacet.length >= limit) return false;
    if (item.layer === "medium" && item.facet?.startsWith("line-")) {
      if (item.tag === "no lineart" && current.some((value) => value.layer === "medium" && value.facet?.startsWith("line-"))) return false;
      if (current.some((value) => value.tag === "no lineart")) return false;
    }
    return true;
  }
  const counts = categoryCounts(current);
  const maximum = Number(categories[item.category]?.max ?? 4);
  return (counts[item.category] || 0) < maximum && !current.some((value) => value.tag === item.tag);
}

function preferredWeight(tag, weights, stats, rng) {
  const choices = weights.map((weight) => ({ tag, weight, polarity: "positive" }));
  const liked = choices.filter((item) => scoreFor(stats, bucketKey("artist", item)) > 0);
  return weightedPick(liked.length && rng() < 0.7 ? liked : choices,
    (item) => Math.exp(clamp(scoreFor(stats, bucketKey("artist", item)) / 5, -3, 3)), rng).weight;
}

function createArtist(tag, rng, stats = null) {
  const weights = Array.from({ length: 20 }, (_, index) => (index + 1) / 10);
  const remembered = stats && weights.some((weight) => stats[bucketKey("artist", { tag, weight, polarity: "positive" })]);
  const weight = remembered ? preferredWeight(tag, weights, stats, rng) : drawWeight(rng).weight;
  return { tag, category: "artist", polarity: "positive", weight };
}

function pickArtist(items, stats, explore, rng, preferred = false) {
  // Give remembered favorites their own chance, rather than diluting them
  // among tens of thousands of unseen artists. Exploration stays unrestricted.
  const liked = preferred && !explore ? items.filter((item) => scoreFor(stats, itemKey("artist", item)) > 0) : [];
  return weightedPick(liked.length && rng() < 0.5 ? liked : items,
    (item) => poolWeight(item, "artist", stats, explore), rng);
}

function changeArtistWeight(item, stats, rng) {
  const weights = Array.from({ length: 20 }, (_, index) => (index + 1) / 10)
    .filter((weight) => Math.abs(weight - item.weight) > 0.001 && Math.abs(weight - item.weight) <= 0.301);
  return { ...item, weight: preferredWeight(item.tag, weights, stats, rng) };
}

function createStyle(item, rng) {
  const polarity = item.polarity === "negative" ? "negative" : "positive";
  return {
    tag: item.tag,
    ...(item.layer ? { layer: item.layer, facet: item.facet } : {}),
    category: polarity === "negative" ? "negative" : item.category,
    polarity,
    pinned: Boolean(item.pinned),
    ...drawWeight(rng, polarity)
  };
}

function shuffled(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(0, index, rng);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function fillArtists(parent, targetCount, artistPool, stats, mode, excluded, rng, preferred = false) {
  const pinned = parent.artists.filter((item) => item.pinned);
  const mutable = parent.artists.filter((item) => !item.pinned);
  const slots = Math.max(0, targetCount - pinned.length);
  const retained = mode === "explore" ? [] : mode === "balanced"
    ? shuffled(mutable, rng).slice(0, Math.max(0, Math.min(Math.floor(mutable.length / 2), slots - 2)))
    : mutable.slice(0, slots);
  const artists = [...pinned, ...retained].map((item) => ({ ...item }));
  while (artists.length < targetCount) {
    const available = artistPool.filter((item) => !artists.some((value) => value.tag === item.tag));
    const fresh = available.filter((item) => !excluded.has(item.tag));
    const source = pickArtist(fresh.length ? fresh : available, stats, mode === "explore", rng, preferred);
    if (!source) break;
    artists.push(createArtist(source.tag, rng, preferred ? stats : null));
  }
  return artists.slice(0, 6);
}

function extendArtists(parent, artistPool, stats, excluded, index, rng) {
  const artists = parent.artists.map((item) => ({ ...item }));
  const mutable = artists.filter((item) => !item.pinned);
  const available = artistPool.filter((item) => !excluded.has(item.tag) && !artists.some((value) => value.tag === item.tag));
  if (available.length && (artists.length < 6 || mutable.length) && (index < 2 || !mutable.length)) {
    const source = pickArtist(available, stats, false, rng, true);
    const added = createArtist(source.tag, rng, stats);
    if (artists.length < 6 && (!mutable.length || rng() < 0.45)) artists.push(added);
    else if (mutable.length) {
      const replaced = weightedPick(mutable,
        (item) => Math.exp(-clamp(scoreFor(stats, itemKey("artist", item)) / 5, -3, 3)), rng);
      artists[artists.indexOf(replaced)] = added;
    }
    return artists;
  }
  // Weight changes exclude the current value, including at 0.1 and 2.0.
  for (const item of shuffled(mutable, rng).slice(0, mutable.length ? randomInt(1, Math.min(2, mutable.length), rng) : 0)) {
    artists[artists.indexOf(item)] = changeArtistWeight(item, stats, rng);
  }
  return artists;
}

function changeOneStyle(styles, stylePool, categories, stats, rng) {
  const mutable = styles.map((item, index) => ({ item, index })).filter(({ item }) => !item.pinned);
  const action = rng();
  if (mutable.length && action < 0.4) {
    const target = pick(mutable, rng);
    styles[target.index] = mutateWeight(target.item, rng);
    return;
  }
  if (mutable.length && action < 0.62) {
    styles.splice(pick(mutable, rng).index, 1);
    return;
  }
  const target = mutable.length && action < 0.82 ? pick(mutable, rng) : null;
  const remaining = target ? styles.filter((_, index) => index !== target.index) : styles;
  const available = stylePool.map((item) => ({ ...item, category: item.polarity === "negative" ? "negative" : item.category }))
    .filter((item) => item.tag !== target?.item.tag && canAddStyle(item, remaining, categories));
  const source = weightedPick(available, (item) => poolWeight(item, "style", stats, false), rng);
  if (!source) return;
  if (target) styles[target.index] = createStyle(source, rng);
  else {
    styles.push(createStyle(source, rng));
  }
}

const visualCategories = new Set(["medium", "coloring", "lighting", "linework", "texture", "rendering"]);

function recomposeLayeredStyles(parent, stylePool, stats, mode, excluded, rng) {
  const layers = ["medium", "shading", "color", "auxiliary"];
  const terms = parent.map((item) => ({ ...item, ...(item.layer ? {} : classifyStyle(item.tag)) }));
  const pinned = terms.filter((item) => item.pinned);
  const counts = Object.fromEntries(layers.map((layer) => [layer, pinned.filter((item) => item.layer === layer).length]));
  if (pinned.length > STYLE_TERM_MAX) throw new Error("固定風格詞超過 25 個，請先取消部分固定。");
  if (counts.auxiliary > STYLE_AUX_MAX || pinned.length - counts.auxiliary > STYLE_CORE_MAX) {
    throw new Error("固定詞超過三層 19 詞或附加控制 6 詞的上限，請先取消部分固定。");
  }
  // Draw a total first, then a feasible split. Pins take precedence over the
  // usual per-layer ranges (medium 3–6, shading 4–7, color 3–6).
  const splits = [];
  for (let medium = Math.max(3, counts.medium); medium <= Math.max(6, counts.medium); medium += 1) {
    for (let shading = Math.max(4, counts.shading); shading <= Math.max(7, counts.shading); shading += 1) {
      for (let color = Math.max(3, counts.color); color <= Math.max(6, counts.color); color += 1) {
        const total = medium + shading + color;
        if (total >= STYLE_CORE_MIN && total <= STYLE_CORE_MAX) splits.push({ medium, shading, color, total });
      }
    }
  }
  if (!splits.length) throw new Error("固定詞的三層分配沒有足夠位置，請減少固定詞。");
  const totals = [...new Set(splits.map((split) => split.total))];
  const coreTotal = pick(totals, rng);
  const targets = { ...pick(splits.filter((split) => split.total === coreTotal), rng),
    auxiliary: randomInt(Math.max(STYLE_AUX_MIN, counts.auxiliary), STYLE_AUX_MAX, rng) };
  const result = pinned.map((item) => ({ ...item }));
  for (const layer of layers) {
    const mutable = shuffled(terms.filter((item) => item.layer === layer && !item.pinned), rng);
    const slots = targets[layer] - counts[layer];
    const replacements = mode === "conservative" ? 0 : Math.min(slots, Math.max(1,
      Math.ceil(mutable.length * (mode === "explore" ? 0.8 : 0.5))));
    const keep = Math.min(mutable.length, Math.max(0, slots - replacements));
    let retained = 0;
    for (const item of mutable) {
      if (retained >= keep) break;
      if (canAddStyle(item, result, {})) { result.push({ ...item }); retained += 1; }
    }
    while (result.filter((item) => item.layer === layer).length < targets[layer]) {
      const available = stylePool.filter((item) => item.layer === layer && item.enabled !== false && canAddStyle(item, result, {}));
      const fresh = available.filter((item) => !excluded.has(item.tag));
      const source = weightedPick(fresh.length ? fresh : available,
        (item) => poolWeight(item, "style", stats, mode === "explore"), rng);
      if (!source) break; // A restricted pool cannot be padded with duplicates.
      result.push(createStyle(source, rng));
    }
  }
  return result;
}

function recomposeStyles(parent, stylePool, categories, stats, mode, excluded, rng) {
  if (stylePool.some((item) => item.layer)) return recomposeLayeredStyles(parent, stylePool, stats, mode, excluded, rng);
  const pinned = parent.filter((item) => item.pinned);
  if (pinned.length > STYLE_TERM_MAX) throw new Error("固定風格詞超過 25 個，請先取消部分固定。");
  const targetCount = Math.max(pinned.length, randomInt(STYLE_TERM_MIN, STYLE_TERM_MAX, rng));
  const slots = targetCount - pinned.length;
  const explore = mode === "explore";
  let mutable = parent.filter((item) => !item.pinned);
  if (mode === "conservative") {
    if (mutable.length > slots) mutable = shuffled(mutable, rng).slice(0, slots);
  } else {
    mutable = shuffled(mutable, rng)
      .sort((left, right) => Number(visualCategories.has(right.category)) - Number(visualCategories.has(left.category)));
    // Count distinct replacements, not weight tweaks. When drawing a shorter
    // genome, reserve fresh slots instead of only deleting inherited terms.
    const freshSlots = Math.min(slots, Math.max(2, Math.ceil(mutable.length * (explore ? 0.8 : 0.5))));
    const changes = Math.max(2, Math.ceil(mutable.length * (explore ? 0.8 : 0.5)), mutable.length - slots + freshSlots);
    mutable = mutable.slice(changes);
  }
  const styles = pinned.map((item) => ({ ...item }));
  for (const item of mutable) if (canAddStyle(item, styles, categories)) styles.push({ ...item });
  const sources = stylePool.map((item) => ({ ...item, category: item.polarity === "negative" ? "negative" : item.category }));
  let freshVisuals = 0;
  while (styles.length < targetCount) {
    const available = sources.filter((item) => canAddStyle(item, styles, categories));
    const fresh = available.filter((item) => !excluded.has(item.tag));
    const visual = fresh.filter((item) => item.polarity !== "negative" && visualCategories.has(item.category));
    const choices = mode !== "conservative" && freshVisuals < 2 && visual.length ? visual : fresh.length ? fresh : available;
    const source = weightedPick(choices, (item) => poolWeight(item, "style", stats, explore), rng);
    if (!source) break;
    if (!excluded.has(source.tag) && source.polarity !== "negative" && visualCategories.has(source.category)) freshVisuals += 1;
    styles.push(createStyle(source, rng));
  }
  return styles;
}

function crossover(left, right, categories, rng) {
  const artistSource = [...left.artists, ...right.artists]
    .sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned))).filter((item, index, all) =>
    all.findIndex((value) => value.tag === item.tag) === index);
  const styleSource = [...left.styleTerms, ...right.styleTerms]
    .sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned))).filter((item, index, all) =>
    all.findIndex((value) => value.tag === item.tag) === index);
  const styles = styleSource.filter((item) => item.pinned).map((item) => ({ ...item }));
  for (const item of shuffled(styleSource.filter((item) => !item.pinned), rng)) {
    if (canAddStyle(item, styles, categories) && rng() < 0.65) styles.push({ ...item });
  }
  return {
    artists: [...artistSource.filter((item) => item.pinned), ...shuffled(artistSource.filter((item) => !item.pinned), rng)]
      .slice(0, 6).map((item) => ({ ...item })),
    styleTerms: styles.length ? styles : left.styleTerms.map((item) => ({ ...item }))
  };
}

export function genomeSignature(genome) {
  return JSON.stringify({
    artists: genome.artists.map((item) => [item.tag, item.weight]).sort(),
    styles: genome.styleTerms.map((item) => [item.tag, item.polarity, item.weight]).sort()
  });
}

export function generateBatch({
  batchNumber,
  parents,
  artistPool,
  stylePool,
  categories,
  stats = {},
  fixedStyleTerms,
  forceExplore = false,
  rng = Math.random
}) {
  if (!artistPool.length) throw new Error("畫師資料庫是空的。");
  if (!parents.length) throw new Error("缺少初始畫風基因。");
  if (fixedStyleTerms !== undefined && !Array.isArray(fixedStyleTerms)) throw new TypeError("質量詞必須是陣列。");
  const fixed = fixedStyleTerms !== undefined;
  const [minimum, maximum] = artistCountRange(batchNumber);
  const results = [];
  const signatures = new Set();
  const parentArtists = new Set(parents.flatMap((parent) => parent.artists.map((item) => item.tag)));
  const parentStyles = new Set(parents.flatMap((parent) => parent.styleTerms.map((item) => item.tag)));
  for (let index = 0; index < 5; index += 1) {
    const mode = forceExplore ? "explore" : fixed
      ? index < 3 ? "conservative" : index === 3 ? "balanced" : "explore"
      : index === 0 ? "conservative" : index < 3 ? "balanced" : "explore";
    const explore = mode === "explore";
    let attempts = 0;
    let genome;
    do {
      const parent = parents[index % parents.length];
      const otherParent = index === (fixed ? 3 : 2) && parents.length > 1 ? parents[(index + 1) % parents.length] : null;
      genome = otherParent
        ? crossover(fixed ? { ...parent, styleTerms: [] } : parent,
          fixed ? { ...otherParent, styleTerms: [] } : otherParent, categories, rng)
        : structuredClone(parent);
      let artistMin = minimum;
      let artistMax = maximum;
      if (batchNumber >= 8 && explore && rng() < 0.1) [artistMin, artistMax] = [1, 2];
      const targetCount = randomInt(artistMin, artistMax, rng);
      const excludedArtists = new Set(parentArtists);
      if (fixed && mode === "conservative") for (const result of results) for (const item of result.artists) excludedArtists.add(item.tag);
      if (explore) for (const result of results) for (const item of result.artists) excludedArtists.add(item.tag);
      genome.artists = fixed && mode === "conservative" && parent.artists.length
        ? extendArtists(parent, artistPool, stats, excludedArtists, index, rng)
        : fillArtists(genome, targetCount, artistPool, stats, mode, excludedArtists, rng, fixed);
      if (mode === "conservative" && !fixed) {
        const mutable = genome.artists.map((item, position) => ({ item, position })).filter(({ item }) => !item.pinned);
        const target = pick(mutable, rng);
        if (target) genome.artists[target.position] = mutateWeight(target.item, rng);
        changeOneStyle(genome.styleTerms, stylePool, categories, stats, rng);
      }
      genome.styleTerms = fixed ? structuredClone(fixedStyleTerms)
        : recomposeStyles(genome.styleTerms, stylePool, categories, stats, mode, parentStyles, rng);
      if (batchNumber <= 2 && (!fixed || !parent.artists.length)) {
        const used = new Set(results.flatMap((result) => result.artists.map((item) => item.tag)));
        genome.artists = genome.artists.map((item) => {
          if (item.pinned || !used.has(item.tag)) return item;
          const available = artistPool.filter((source) => (
            !used.has(source.tag) && !genome.artists.some((value) => value.tag === source.tag)
          ));
          const source = weightedPick(available, (value) => poolWeight(value, "artist", stats, explore), rng);
          return source ? createArtist(source.tag, rng) : item;
        });
      }
      genome.artists = genome.artists.slice(0, 6);
      genome.parentIds = [...new Set([parent.id, otherParent?.id].filter(Boolean))];
      genome.generation = batchNumber;
      attempts += 1;
    } while (signatures.has(genomeSignature(genome)) && attempts < 30);
    signatures.add(genomeSignature(genome));
    results.push(genome);
  }
  return results;
}

export function makeInitialGenome(styleTerms) {
  return { id: "initial", generation: 0, parentIds: [], artists: [], styleTerms: structuredClone(styleTerms) };
}
