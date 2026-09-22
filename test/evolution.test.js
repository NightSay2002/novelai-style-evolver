import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBatchVote,
  artistCountRange,
  generateBatch,
  genomeFeatureKeys,
  makeStartingArtists,
  parseArtistInput,
  parseStylePrompt,
  serializeGenome,
  STYLE_TERM_MIN,
  STYLE_TERM_MAX,
  voteDeltas
} from "../src/evolution.js";
import { availableNoiseSchedules, availableSamplers, buildNovelAiPayload, DEFAULT_GENERATION_SETTINGS, encodeNovelAiVibe, estimateNovelAiCost, extractZipImages, fetchNovelAiAnlas, generateNovelAiImage, modelCapabilities, MODELS, normalizeGenerationSettings, normalizeImageDimensions, SAMPLERS } from "../src/nai.js";
import { injectCandidateMetadata } from "../src/png-metadata.js";

function seededRandom(seed = 123456789) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function storedZip(name, data) {
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  return new Blob([local, central, end]).arrayBuffer();
}

const categories = {
  quality: { max: 3 }, aesthetic: { max: 3 }, year: { max: 2 },
  complexity: { max: 2 }, medium: { max: 2 }, visual_novel: { max: 1 },
  v5_other: { max: 2 }, custom: { max: 4 }, negative: { max: 3 }
};

const stylePool = [
  { tag: "best quality", category: "quality", polarity: "positive" },
  { tag: "amazing quality", category: "quality", polarity: "positive" },
  { tag: "top aesthetic", category: "aesthetic", polarity: "positive" },
  { tag: "year 2025", category: "year", polarity: "positive" },
  { tag: "year 2026", category: "year", polarity: "positive" },
  { tag: "high complexity", category: "complexity", polarity: "positive" },
  { tag: "ultra complexity", category: "complexity", polarity: "positive" },
  { tag: "watercolor (medium)", category: "medium", polarity: "positive" },
  { tag: "visual novel cg", category: "visual_novel", polarity: "positive" },
  { tag: "depthness", category: "v5_other", polarity: "positive" },
  { tag: "cinematic shot", category: "custom", polarity: "positive" },
  { tag: "multiple views", category: "negative", polarity: "negative" }
];

const artists = Array.from({ length: 30 }, (_, index) => ({ tag: `artist:test_${index + 1}` }));

test("custom artist starts ignore typed weights, normalize tags and draw fresh weights", () => {
  assert.deepEqual(parseArtistInput("1.0::artist:Mashiro_Shiki::, 0.8::artist:minusk9 ::\nprocrastinator39, dhfddf"), [
    "artist:mashiro_shiki", "artist:minusk9", "artist:procrastinator39", "artist:dhfddf"
  ]);
  const starting = makeStartingArtists("0.1::artist:known::, 2.0::artist:unknown::", () => 0.49);
  assert.deepEqual(starting.map((item) => item.tag), ["artist:known", "artist:unknown"]);
  assert(starting.every((item) => item.weight === 1 && item.weight >= 0.1 && item.weight <= 2));
  assert.throws(() => parseArtistInput("a,b,c,d,e,f,g"), /最多 6 位/u);
});

test("three preference extensions change one artist or 1–2 weights and never shrink the preferred core", () => {
  const rng = seededRandom(321);
  const fixed = parseStylePrompt("best quality");
  for (const count of [1, 3, 5, 6]) {
    const parent = { id: "liked", artists: artists.slice(0, count).map(item => ({ ...item, weight: 1, polarity: "positive" })), styleTerms: fixed };
    const before = structuredClone(parent);
    let additions = 0;
    for (let run = 0; run < 30; run++) {
      const batch = generateBatch({ batchNumber: 20, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: fixed, rng });
      for (const [index, genome] of batch.slice(0, 3).entries()) {
        assert.ok(genome.artists.length >= count && genome.artists.length <= Math.min(6, count + 1));
        assert.notDeepEqual(genome.artists, parent.artists);
        assert.deepEqual(genome.styleTerms, fixed);
        assert.equal(new Set(genome.artists.map(item => item.tag)).size, genome.artists.length);
        const fresh = genome.artists.filter(item => !parent.artists.some(old => old.tag === item.tag));
        if (index < 2) {
          assert.equal(fresh.length, 1);
          assert.equal(genome.artists.filter(item => parent.artists.some(old => old.tag === item.tag)).length, count - (genome.artists.length === count ? 1 : 0));
          additions += genome.artists.length > count ? 1 : 0;
        } else {
          assert.deepEqual(genome.artists.map(item => item.tag), parent.artists.map(item => item.tag));
          const changed = genome.artists.filter((item, position) => item.weight !== parent.artists[position].weight);
          assert.ok(changed.length >= 1 && changed.length <= 2);
          assert.ok(changed.every(item => Math.abs(item.weight - 1) <= 0.301));
        }
      }
      assert.ok(batch[3].artists.filter(item => !parent.artists.some(old => old.tag === item.tag)).length >= 2);
      assert.ok(batch[4].artists.every(item => !batch.slice(0, 4).some(other => other.artists.some(old => old.tag === item.tag))));
      assert.equal(new Set(batch.map(genome => JSON.stringify(genome.artists))).size, 5);
    }
    assert.deepEqual(parent, before);
    if (count < 6) assert.ok(additions > 0);
    else assert.equal(additions, 0);
  }
});

test("small pools and boundary weights still change preference cards while pins stay untouched", () => {
  for (const weight of [0.1, 2]) {
    const parent = { id: "small", artists: [{ ...artists[0], weight, polarity: "positive" }], styleTerms: [] };
    for (const genome of generateBatch({ batchNumber: 2, parents: [parent], artistPool: artists.slice(0, 1), stylePool: [], categories: {}, fixedStyleTerms: [], rng: seededRandom(81) }).slice(0, 3)) {
      assert.equal(genome.artists[0].tag, parent.artists[0].tag);
      assert.notEqual(genome.artists[0].weight, weight);
      assert.ok(genome.artists[0].weight >= 0.1 && genome.artists[0].weight <= 2);
    }
  }
  const parent = { id: "pinned", artists: artists.slice(0, 6).map(item => ({ ...item, weight: 1.7, pinned: true })), styleTerms: [] };
  const before = structuredClone(parent);
  for (const genome of generateBatch({ batchNumber: 20, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: [], rng: seededRandom(97) })) assert.deepEqual(genome.artists, before.artists);
  parent.artists.pop();
  for (const genome of generateBatch({ batchNumber: 20, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: [], rng: seededRandom(98) }).slice(0, 3)) {
    assert.equal(genome.artists.length, 6);
    for (const pin of parent.artists) assert.deepEqual(genome.artists.find(item => item.tag === pin.tag), pin);
  }
});

test("historical favorite artists have a real chance in a 52k pool without replacing the exploration slot", () => {
  const pool = Array.from({ length: 52266 }, (_, index) => ({ tag: `artist:large_${index}` }));
  const favorite = pool.at(-1).tag;
  const parent = { id: "current", artists: pool.slice(0, 3).map(item => ({ ...item, weight: 1 })), styleTerms: [] };
  const stats = { [`artist:${favorite}`]: { score: 20, appearances: 100 } };
  const before = structuredClone(stats);
  const rng = seededRandom(816);
  let favorites = 0;
  const newDirections = new Set();
  for (let run = 0; run < 40; run++) {
    const batch = generateBatch({ batchNumber: 20, parents: [parent], artistPool: pool, stylePool: [], categories: {}, fixedStyleTerms: [], stats, rng });
    favorites += batch.slice(0, 2).filter(genome => genome.artists.some(item => item.tag === favorite)).length;
    for (const item of batch[4].artists) newDirections.add(item.tag);
  }
  assert.ok(favorites > 20 && favorites < 65, `historical favorite appeared ${favorites} times`);
  assert.ok(newDirections.size > 100);
  assert.deepEqual(stats, before);
});

test("artist weight buckets influence new draws and local changes without eliminating new values", () => {
  const parent = { id: "current", artists: [{ ...artists[0], weight: 1.4 }], styleTerms: [] };
  const target = artists[1].tag;
  const stats = {
    [`artist:${target}`]: { score: 20, appearances: 100 },
    [`artist-weight:${target}:+1.7`]: { score: 20, appearances: 100 },
    [`artist-weight:${artists[0].tag}:+1.7`]: { score: 20, appearances: 100 }
  };
  const rng = seededRandom(188);
  let learnedDraws = 0, targetDraws = 0, learnedTweaks = 0;
  const otherWeights = new Set();
  for (let run = 0; run < 100; run++) {
    const batch = generateBatch({ batchNumber: 20, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: [], stats, rng });
    for (const genome of batch.slice(0, 2)) {
      const item = genome.artists.find(item => item.tag === target);
      if (item) { targetDraws++; if (item.weight === 1.7) learnedDraws++; else otherWeights.add(item.weight); }
    }
    if (batch[2].artists[0].weight === 1.7) learnedTweaks++;
  }
  assert.ok(learnedDraws > targetDraws * 0.65 && learnedDraws < targetDraws);
  assert.ok(learnedTweaks > 65 && learnedTweaks < 100);
  assert.ok(otherWeights.size > 3);
});

test("artist-only preference extensions remain changing over 60 feedback rounds and force exploration on request", () => {
  let parent = { id: "initial", artists: [], styleTerms: [] };
  let stats = {};
  const rng = seededRandom(129);
  for (let round = 1; round <= 60; round++) {
    const batch = generateBatch({ batchNumber: round, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: [], stats, rng });
    if (parent.artists.length) for (const genome of batch.slice(0, 3)) assert.notDeepEqual(genome.artists, parent.artists);
    const candidates = batch.map((genome, index) => ({ id: `${round}-${index}`, genome }));
    stats = applyBatchVote(stats, candidates, [candidates[round % 3].id]).stats;
    parent = batch[round % 3];
    assert.ok(parent.artists.length >= 1 && parent.artists.length <= 6);
  }
  const forced = generateBatch({ batchNumber: 61, parents: [parent], artistPool: artists, stylePool: [], categories: {}, fixedStyleTerms: [], stats, forceExplore: true, rng });
  for (const genome of forced) assert.ok(genome.artists.every(item => !parent.artists.some(old => old.tag === item.tag)));
});

test("artist-only batches preserve exact manual quality terms through inheritance, crossover and exploration", () => {
  const fixed = parseStylePrompt("-2::artist collaboration::, year 2025, year 2026, {{{detail background}}}, 0.3::watercolor::, 1.7::best quality::");
  const original = structuredClone(fixed);
  let parents = [explorationParent(), { ...explorationParent(), id: "other" }];
  const before = structuredClone(parents);
  const rng = seededRandom(27);
  for (let round = 1; round <= 60; round += 1) {
    const genomes = generateBatch({ batchNumber: round, parents, artistPool: diverseArtists,
      stylePool: diverseStyles, categories: diverseCategories, fixedStyleTerms: fixed, forceExplore: round % 3 === 0, rng });
    for (const genome of genomes) {
      assert.deepEqual(genome.styleTerms, original);
      assert.notEqual(genome.styleTerms, fixed);
      assert.ok(genome.artists.length >= 1 && genome.artists.length <= 6);
    }
    if (round === 1) assert.deepEqual(parents, before);
    assert.equal(new Set(genomes.map((genome) => JSON.stringify(genome.artists))).size, 5);
    parents = [genomes[0], genomes[3]];
  }
  assert.deepEqual(fixed, original);
});

test("fixed manual quality can be empty or exceed old style quotas and ignores old pinned styles", () => {
  const parent = explorationParent();
  parent.styleTerms = Array.from({ length: 40 }, (_, index) => ({ tag: `old-${index}`, pinned: true, weight: 2, category: "custom", polarity: "positive" }));
  for (const fixed of [[], parseStylePrompt(Array.from({ length: 30 }, (_, index) => `manual ${index}`).join(","))]) {
    for (const genome of generateBatch({ batchNumber: 30, parents: [parent], artistPool: diverseArtists,
      stylePool: [], categories: {}, fixedStyleTerms: fixed, rng: seededRandom(41) })) assert.deepEqual(genome.styleTerms, fixed);
  }
  assert.throws(() => generateBatch({ batchNumber: 1, parents: [parent], artistPool: diverseArtists,
    stylePool: [], categories: {}, fixedStyleTerms: "invalid" }), /質量詞必須是陣列/u);
});

test("parses numeric, negative and brace emphasis into structured style terms", () => {
  const parsed = parseStylePrompt(
    "-2::artist collaboration::, year 2025, {{{detail background}}}, visual novel cg",
    stylePool
  );
  assert.deepEqual(parsed.map(({ tag, category, polarity, weight }) => ({ tag, category, polarity, weight })), [
    { tag: "artist collaboration", category: "negative", polarity: "negative", weight: 2 },
    { tag: "year 2025", category: "year", polarity: "positive", weight: 1 },
    { tag: "detail background", category: "custom", polarity: "positive", weight: 1.2 },
    { tag: "visual novel cg", category: "visual_novel", polarity: "positive", weight: 1 }
  ]);
});

test("serializes artists, content and style in stable order", () => {
  const prompt = serializeGenome({
    artists: [{ tag: "artist:kuroduki", weight: 1.1, polarity: "positive" }],
    styleTerms: [{ tag: "simple illustration", weight: 1, polarity: "negative" }]
  }, "solo, 1girl");
  assert.equal(prompt, "1.1::artist:kuroduki::,\nsolo, 1girl,\n-1::simple illustration::");
});

test("separates digit-ending tags from NovelAI's closing weight delimiter", () => {
  const prompt = serializeGenome({
    artists: [{ tag: "artist:test_123", weight: 0.8, polarity: "positive" }],
    styleTerms: [{ tag: "year 2025", weight: 1.3, polarity: "positive" }]
  });
  assert.equal(prompt, "0.8::artist:test_123 ::,\n1.3::year 2025 ::");
  assert.doesNotMatch(prompt, /(?:123|2025)::$/mu);
});

test("uses the agreed artist-count stages", () => {
  assert.deepEqual(artistCountRange(1), [1, 1]);
  assert.deepEqual(artistCountRange(2), [1, 2]);
  assert.deepEqual(artistCountRange(3), [2, 3]);
  assert.deepEqual(artistCountRange(5), [3, 6]);
  assert.deepEqual(artistCountRange(8), [3, 6]);
});

test("creates five unique first-batch genomes within category and weight limits", () => {
  const parent = {
    id: "initial", artists: [], generation: 0,
    styleTerms: parseStylePrompt("year 2025, best quality, high complexity, visual novel cg", stylePool)
  };
  const genomes = generateBatch({
    batchNumber: 1, parents: [parent], artistPool: artists, stylePool,
    categories, stats: {}, rng: seededRandom(4)
  });
  assert.equal(genomes.length, 5);
  assert.equal(new Set(genomes.map((genome) => JSON.stringify(genome))).size, 5);
  assert.equal(new Set(genomes.map((genome) => genome.artists[0].tag)).size, 5);
  for (const genome of genomes) {
    assert.equal(genome.artists.length, 1);
    for (const item of [...genome.artists, ...genome.styleTerms]) {
      assert.ok(item.weight >= 0.1 && item.weight <= 2);
    }
    const counts = Object.groupBy(genome.styleTerms, (item) => item.category);
    for (const [category, items] of Object.entries(counts)) {
      assert.ok(items.length <= categories[category].max);
    }
  }
});

const visualCategories = ["medium", "coloring", "lighting", "linework", "texture", "rendering"];
const diverseCategories = { ...categories, ...Object.fromEntries(visualCategories.map((category) => [category, { max: 3 }])) };
const diverseStyles = [...stylePool, ...Array.from({ length: 120 }, (_, index) => ({
  tag: `visual style ${index + 1}`, category: visualCategories[index % visualCategories.length], polarity: "positive"
}))];
const diverseArtists = Array.from({ length: 150 }, (_, index) => ({ tag: `artist:diverse_${index + 1}` }));

function explorationParent() {
  return {
    id: "preferred",
    artists: diverseArtists.slice(0, 6).map((item) => ({ ...item, category: "artist", polarity: "positive", weight: 1 })),
    styleTerms: [
      ...parseStylePrompt("best quality, top aesthetic, year 2025, high complexity", diverseStyles),
      ...diverseStyles.slice(12, 18).map((item) => ({ ...item, weight: 1 }))
    ]
  };
}

function assertGenomeLimits(genome) {
  assert.ok(genome.artists.length >= 1 && genome.artists.length <= 6);
  assert.equal(new Set(genome.artists.map((item) => item.tag)).size, genome.artists.length);
  assert.equal(new Set(genome.styleTerms.map((item) => item.tag)).size, genome.styleTerms.length);
  assert.ok(genome.styleTerms.length >= STYLE_TERM_MIN && genome.styleTerms.length <= STYLE_TERM_MAX);
  for (const item of [...genome.artists, ...genome.styleTerms]) assert.ok(item.weight >= 0.1 && item.weight <= 2);
  for (const [category, items] of Object.entries(Object.groupBy(genome.styleTerms, (item) => item.category))) {
    assert.ok(items.length <= diverseCategories[category].max);
  }
}

test("keeps one nearby candidate, two recombinations and two fresh directions over 60 feedback rounds", () => {
  let parent = explorationParent();
  let stats = Object.fromEntries(genomeFeatureKeys(parent).singles.map((key) => [key,
    { score: 20, appearances: 500, positive: 500, negative: 0 }]));
  const rng = seededRandom(190819);
  for (let round = 1; round <= 60; round += 1) {
    const parentBefore = structuredClone(parent);
    const statsBefore = structuredClone(stats);
    const artistTags = new Set(parent.artists.map((item) => item.tag));
    const styleTags = new Set(parent.styleTerms.map((item) => item.tag));
    const genomes = generateBatch({
      batchNumber: round + 10, parents: [parent], artistPool: diverseArtists, stylePool: diverseStyles,
      categories: diverseCategories, stats, rng
    });
    assert.deepEqual(parent, parentBefore);
    assert.deepEqual(stats, statsBefore);
    assert.ok(genomes[0].artists.some((item) => item.tag === parent.artists[0].tag), `round ${round}: nearby inheritance`);
    for (const genome of genomes.slice(1, 3)) {
      assert.ok(genome.artists.filter((item) => !artistTags.has(item.tag)).length >= 2, `round ${round}: recombined artists`);
    }
    for (const genome of genomes.slice(3)) {
      assert.ok(genome.artists.every((item) => !artistTags.has(item.tag)), `round ${round}: fresh artists`);
    }
    assert.ok(genomes[3].artists.every((item) => !genomes[4].artists.some((other) => other.tag === item.tag)));
    for (const genome of genomes.slice(1)) {
      const freshStyles = genome.styleTerms.filter((item) => !styleTags.has(item.tag));
      assert.ok(freshStyles.length >= Math.min(genome.styleTerms.length, Math.max(2, Math.ceil(parent.styleTerms.length * 0.5))), `round ${round}: changed style tags`);
      assert.ok(freshStyles.filter((item) => visualCategories.includes(item.category)).length >= 2, `round ${round}: visual changes`);
    }
    genomes.forEach(assertGenomeLimits);
    const candidates = genomes.map((genome, index) => ({ id: `${round}-${index}`, genome }));
    const selected = round <= 30 ? 0 : round % 5;
    stats = applyBatchVote(stats, candidates, [candidates[selected].id]).stats;
    parent = { ...genomes[selected], id: candidates[selected].id };
  }
});

test("forced exploration changes all five directions even at round 1000 with saturated preferences", () => {
  const parent = explorationParent();
  const stats = Object.fromEntries(genomeFeatureKeys(parent).singles.map((key) => [key,
    { score: 20, appearances: 10_000, positive: 10_000, negative: 0 }]));
  const genomes = generateBatch({
    batchNumber: 1000, parents: [parent], artistPool: diverseArtists, stylePool: diverseStyles,
    categories: diverseCategories, stats, forceExplore: true, rng: seededRandom(88)
  });
  const oldArtists = new Set(parent.artists.map((item) => item.tag));
  const oldStyles = new Set(parent.styleTerms.map((item) => item.tag));
  for (const genome of genomes) {
    assert.ok(genome.artists.every((item) => !oldArtists.has(item.tag)));
    assert.ok(genome.styleTerms.filter((item) => !oldStyles.has(item.tag)).length >= 8);
    assertGenomeLimits(genome);
  }
  assert.equal(new Set(genomes.flatMap((genome) => genome.artists.map((item) => item.tag))).size,
    genomes.reduce((sum, genome) => sum + genome.artists.length, 0));
});

test("draws every style-count value from 12 through 25 with varied combinations", () => {
  const parent = explorationParent();
  parent.styleTerms[0] = { ...parent.styleTerms[0], pinned: true, weight: 1.6 };
  const before = structuredClone(parent);
  const counts = new Set();
  const combinations = new Set();
  const rng = seededRandom(54);
  for (let round = 1; round <= 30; round += 1) {
    const genomes = generateBatch({
      batchNumber: round, parents: [parent], artistPool: diverseArtists, stylePool: diverseStyles,
      categories: diverseCategories, rng
    });
    for (const genome of genomes) {
      assertGenomeLimits(genome);
      assert.deepEqual(genome.styleTerms.find((item) => item.tag === parent.styleTerms[0].tag), parent.styleTerms[0]);
      counts.add(genome.styleTerms.length);
      combinations.add(genome.styleTerms.map((item) => item.tag).sort().join(","));
    }
  }
  assert.deepEqual([...counts].sort((left, right) => left - right), Array.from({ length: 14 }, (_, index) => index + 12));
  assert.ok(combinations.size > 140);
  assert.deepEqual(parent, before);
});

test("shortens oversized genomes without losing fixed terms and rejects more than 25 fixed terms", () => {
  const parent = explorationParent();
  parent.styleTerms = diverseStyles.slice(12, 48).map((item, index) => ({ ...item, weight: 1, pinned: index < 6 }));
  const genomes = generateBatch({
    batchNumber: 30, parents: [parent], artistPool: diverseArtists, stylePool: diverseStyles,
    categories: diverseCategories, rng: seededRandom(91)
  });
  for (const genome of genomes) {
    assertGenomeLimits(genome);
    for (const item of parent.styleTerms.filter((term) => term.pinned)) assert.deepEqual(genome.styleTerms.find((term) => term.tag === item.tag), item);
  }
  const fixed = { ...parent, styleTerms: parent.styleTerms.map((item) => ({ ...item, pinned: true })) };
  const before = structuredClone(fixed);
  assert.throws(() => generateBatch({
    batchNumber: 30, parents: [fixed], artistPool: diverseArtists, stylePool: diverseStyles,
    categories: diverseCategories, rng: seededRandom(91)
  }), /固定風格詞超過 25/u);
  assert.deepEqual(fixed, before);
});

test("multi-parent recombination and fresh exploration preserve fixed terms and weights", () => {
  const left = explorationParent();
  left.id = "left";
  left.artists[0].pinned = true;
  left.artists[0].weight = 1.7;
  left.styleTerms[0].pinned = true;
  left.styleTerms[0].weight = 0.4;
  left.styleTerms.push({ tag: "fixed negative", category: "negative", polarity: "negative", pinned: true, weight: 2 });
  const right = structuredClone(left);
  right.id = "right";
  right.artists.splice(1, 5, ...diverseArtists.slice(6, 11).map((item) => ({ ...item, weight: 1, polarity: "positive" })));
  const before = structuredClone([left, right]);
  for (const batchNumber of [1, 25]) {
    const genomes = generateBatch({
      batchNumber, parents: [left, right], artistPool: diverseArtists, stylePool: diverseStyles,
      categories: diverseCategories, rng: seededRandom(batchNumber)
    });
    assert.deepEqual(genomes[2].parentIds, ["left", "right"]);
    for (const genome of genomes) {
      assert.deepEqual(genome.artists.find((item) => item.tag === left.artists[0].tag), left.artists[0]);
      for (const item of left.styleTerms.filter((term) => term.pinned)) {
        assert.deepEqual(genome.styleTerms.find((term) => term.tag === item.tag), item);
      }
      assertGenomeLimits(genome);
    }
    const used = new Set([...left.artists, ...right.artists].map((item) => item.tag));
    for (const genome of genomes.slice(3)) assert.ok(genome.artists.filter((item) => !item.pinned).every((item) => !used.has(item.tag)));
  }
  assert.deepEqual([left, right], before);
});

test("small or empty style pools terminate without duplicates or changing fixed artists", () => {
  const parent = { id: "small", artists: [{ ...artists[0], weight: 1, pinned: true }], styleTerms: [] };
  for (const batchNumber of [1, 1000]) {
    const genomes = generateBatch({
      batchNumber, parents: [parent], artistPool: artists.slice(0, 1), stylePool: [],
      categories, rng: () => 0.5
    });
    assert.equal(genomes.length, 5);
    for (const genome of genomes) {
      assert.deepEqual(genome.artists, parent.artists);
      assert.deepEqual(genome.styleTerms, []);
    }
  }
  const allFixed = { ...parent, artists: artists.slice(0, 6).map((item) => ({ ...item, pinned: true, weight: 2 })) };
  const genomes = generateBatch({
    batchNumber: 1, parents: [allFixed], artistPool: artists, stylePool: diverseStyles,
    categories: diverseCategories, rng: seededRandom(18)
  });
  for (const genome of genomes) {
    assert.deepEqual(genome.artists, allFixed.artists);
    assertGenomeLimits(genome);
  }
});

test("crossover prefers the fixed version of a shared tag over an unfixed parent copy", () => {
  const left = explorationParent();
  left.id = "left";
  const right = structuredClone(left);
  right.id = "right";
  right.artists[0] = { ...right.artists[0], pinned: true, weight: 0.3 };
  right.styleTerms[0] = { ...right.styleTerms[0], pinned: true, weight: 1.9 };
  const genomes = generateBatch({
    batchNumber: 20, parents: [left, right], artistPool: diverseArtists, stylePool: diverseStyles,
    categories: diverseCategories, rng: seededRandom(11)
  });
  assert.deepEqual(genomes[2].artists.find((item) => item.tag === right.artists[0].tag), right.artists[0]);
  assert.deepEqual(genomes[2].styleTerms.find((item) => item.tag === right.styleTerms[0].tag), right.styleTerms[0]);
});

test("fresh exploration still respects positive and negative feedback without locking to high scores", () => {
  const pool = diverseArtists.slice(0, 100);
  const stats = Object.fromEntries(pool.map((item, index) => [`artist:${item.tag}`, {
    score: index < 50 ? 20 : -20, appearances: 100, positive: index < 50 ? 100 : 0, negative: index < 50 ? 0 : 100
  }]));
  const positive = new Set(pool.slice(0, 50).map((item) => item.tag));
  const before = structuredClone(stats);
  const rng = seededRandom(71);
  let preferred = 0;
  const drawn = new Set();
  for (let run = 0; run < 80; run += 1) {
    const genomes = generateBatch({
      batchNumber: 1, parents: [{ id: "initial", artists: [], styleTerms: [] }], artistPool: pool, stylePool: [],
      categories, stats, forceExplore: true, rng
    });
    for (const genome of genomes) {
      const tag = genome.artists[0].tag;
      if (positive.has(tag)) preferred += 1;
      drawn.add(tag);
    }
  }
  assert.ok(preferred > 400 * 0.7 && preferred < 400 * 0.95);
  assert.ok(drawn.size > 70);
  assert.deepEqual(stats, before);
});

test("replacement can change a style tag when its category is already full", () => {
  const parent = { id: "full", artists: [{ ...artists[0], weight: 1 }], styleTerms: [{ ...stylePool[0], weight: 1 }] };
  const genomes = generateBatch({
    batchNumber: 1, parents: [parent], artistPool: artists, stylePool: stylePool.slice(0, 2),
    categories: { quality: { max: 1 } }, rng: () => 0.7
  });
  assert.equal(genomes[0].styleTerms.length, 1);
  assert.equal(genomes[0].styleTerms[0].tag, "amazing quality");
});

test("balances multi-select votes and keeps pair influence smaller", () => {
  assert.deepEqual(voteDeltas(1), { selected: 4, unselected: -1 });
  assert.deepEqual(voteDeltas(2), { selected: 1.5, unselected: -1 });
  assert.deepEqual(voteDeltas(5), { selected: 0.25, unselected: 0 });
  assert.deepEqual(voteDeltas(0), { selected: 0, unselected: -1 });
  const candidates = artists.slice(0, 5).map((artist, index) => ({
    id: `c${index}`,
    genome: { artists: [{ ...artist, weight: 1, polarity: "positive" }], styleTerms: [] }
  }));
  const result = applyBatchVote({}, candidates, ["c0"]);
  const keys = genomeFeatureKeys(candidates[0].genome);
  assert.equal(result.stats[keys.singles[0]].score, 4);
  assert.deepEqual(result.candidateDeltas, { c0: 4, c1: -1, c2: -1, c3: -1, c4: -1 });
  for (const candidate of candidates.slice(1)) {
    for (const key of genomeFeatureKeys(candidate.genome).singles) {
      assert.equal(result.stats[key].score, -1);
    }
  }
});

test("explicit dislikes penalize artists, style terms, weight buckets and pairs more strongly", () => {
  const candidates = artists.slice(0, 5).map((artist, index) => ({
    id: `c${index}`,
    genome: {
      artists: [{ ...artist, weight: 1, polarity: "positive" }],
      styleTerms: [{ ...stylePool[index], weight: 1 }]
    }
  }));
  const initial = {};
  const result = applyBatchVote(initial, candidates, ["c0"], ["c1"]);
  assert.deepEqual(result.candidateDeltas, { c0: 4, c1: -3, c2: -1, c3: -1, c4: -1 });
  const { singles, pairs } = genomeFeatureKeys(candidates[1].genome);
  for (const key of singles) assert.deepEqual(result.stats[key], { score: -3, appearances: 1, positive: 0, negative: 1 });
  for (const key of pairs) assert.equal(result.stats[key].score, -0.75);
  assert.deepEqual(initial, {});
});

test("dislike-only and all-disliked batches preserve neutral penalties and score limits", () => {
  const candidates = artists.slice(0, 5).map((artist, index) => ({
    id: `c${index}`,
    genome: { artists: [{ ...artist, weight: 1, polarity: "positive" }], styleTerms: [] }
  }));
  const onlyDisliked = applyBatchVote({}, candidates, [], ["c1"]);
  assert.deepEqual(onlyDisliked.candidateDeltas, { c0: -1, c1: -3, c2: -1, c3: -1, c4: -1 });
  const key = genomeFeatureKeys(candidates[1].genome).singles[0];
  const initial = { [key]: { score: -19, appearances: 10, positive: 0, negative: 10 } };
  const allDisliked = applyBatchVote(initial, candidates, [], candidates.map((item) => item.id));
  assert.ok(Object.values(allDisliked.candidateDeltas).every((delta) => delta === -3));
  assert.equal(allDisliked.stats[key].score, -20);
  assert.equal(initial[key].score, -19);
});

test("ignored batches use the ordinary penalty for all five candidates and their features", () => {
  const candidates = artists.slice(0, 5).map((artist, index) => ({
    id: `c${index}`,
    genome: {
      artists: [{ ...artist, weight: 1, polarity: "positive" }],
      styleTerms: [{ ...stylePool[index], weight: 1 }]
    }
  }));
  const result = applyBatchVote({}, candidates, [], []);
  assert.deepEqual(result.candidateDeltas, { c0: -1, c1: -1, c2: -1, c3: -1, c4: -1 });
  for (const candidate of candidates) {
    const { singles, pairs } = genomeFeatureKeys(candidate.genome);
    for (const key of singles) assert.deepEqual(result.stats[key], { score: -1, appearances: 1, positive: 0, negative: 1 });
    for (const key of pairs) assert.equal(result.stats[key].score, -0.25);
  }
});

test("duplicate, stale and conflicting feedback IDs cannot amplify votes", () => {
  const candidates = artists.slice(0, 5).map((artist, index) => ({
    id: `c${index}`,
    genome: { artists: [{ ...artist, weight: 1, polarity: "positive" }], styleTerms: [] }
  }));
  const result = applyBatchVote({}, candidates, ["c0", "c0", "c1", "stale"], ["c1", "c1", "stale"]);
  assert.deepEqual(result.candidateDeltas, { c0: 4, c1: -3, c2: -1, c3: -1, c4: -1 });
  const key = genomeFeatureKeys(candidates[1].genome).singles[0];
  assert.equal(result.stats[key].appearances, 1);
});

test("builds a fixed V5 Full payload without hidden quality or UC presets", () => {
  const payload = buildNovelAiPayload("prompt", "negative");
  assert.equal(payload.model, "nai-diffusion-5-full");
  assert.equal(payload.parameters.seed, 114514);
  assert.equal(payload.parameters.sampler, "k_euler_ancestral");
  assert.equal(payload.parameters.steps, 28);
  assert.equal(payload.parameters.scale, 5.5);
  assert.equal(payload.parameters.uncond_scale, 1);
  assert.equal(payload.parameters.deliberate_euler_ancestral_bug, false);
  assert.equal(payload.parameters.prefer_brownian, true);
  assert.equal(payload.parameters.skip_cfg_above_sigma, null);
  assert.equal(payload.parameters.skip_cfg_below_sigma, 0);
  assert.equal(payload.parameters.qualityToggle, false);
  assert.equal(payload.parameters.tag_hint_qt, 0);
  assert.equal(payload.parameters.tag_hint_uc_preset, 0);
  assert.equal(payload.parameters.v4_prompt.caption.base_caption, "prompt");
});

test("extracts a stored PNG entry from the NovelAI ZIP response", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const images = await extractZipImages(await storedZip("image_0.png", png));
  assert.equal(images.length, 1);
  assert.equal(images[0].name, "image_0.png");
  assert.equal(images[0].blob.type, "image/png");
  assert.deepEqual(Array.from(new Uint8Array(await images[0].blob.arrayBuffer())), Array.from(png));
});

test("Image2Image is optional and preserves the original text-generation payload", () => {
  const payload = buildNovelAiPayload("prompt", "negative");
  assert.deepEqual(buildNovelAiPayload("prompt", "negative", null), payload);
  assert.equal(payload.action, "generate");
  for (const field of ["image", "strength", "noise"]) assert.equal(field in payload.parameters, false);
});

test("editable generation settings override only the requested NAI parameters", () => {
  const settings = { width: 1216, height: 832, seed: 20260912, sampler: "k_euler", steps: 21, guidance: 7, cfgRescale: 0.35 };
  const original = buildNovelAiPayload("p", "n");
  const changed = buildNovelAiPayload("p", "n", null, { ...settings, qualityToggle: true, ucPreset: 0 });
  assert.deepEqual(changed.parameters, { ...original.parameters,
    width: settings.width, height: settings.height, seed: settings.seed, sampler: settings.sampler,
    steps: settings.steps, scale: settings.guidance, cfg_rescale: settings.cfgRescale
  });
  assert.equal(changed.action, "generate");
  assert.equal(changed.parameters.qualityToggle, false);
  assert.equal(changed.parameters.ucPreset, 4);
  assert.deepEqual(normalizeGenerationSettings({ seed: 0 }), { ...DEFAULT_GENERATION_SETTINGS, seed: 0 });
  assert.deepEqual(settings, { width: 1216, height: 832, seed: 20260912, sampler: "k_euler", steps: 21, guidance: 7, cfgRescale: 0.35 });
});

test("generation setting bounds and supported samplers are accepted", () => {
  for (const sampler of Object.keys(SAMPLERS)) {
    const model = sampler === "ddim_v3" ? "nai-diffusion-3" : DEFAULT_GENERATION_SETTINGS.model;
    const low = normalizeGenerationSettings({ width: 64, height: 64, seed: 0, steps: 1, guidance: 0, cfgRescale: 0, sampler, model });
    const high = normalizeGenerationSettings({ width: 2048, height: 2048, seed: 4294967295, steps: 50, guidance: 20, cfgRescale: 1, sampler, model });
    assert.equal(low.sampler, sampler);
    assert.equal(high.seed, 4294967295);
  }
});

test("invalid generation settings fail before building a request", () => {
  for (const settings of [null, [], 1, "bad", { width: 800 }, { height: 2050 }, { width: 0 }, { height: "832" },
    { seed: -1 }, { seed: 4294967296 }, { seed: 1.5 }, { steps: 0 }, { steps: 51 }, { steps: 2.5 },
    { guidance: NaN }, { guidance: 20.1 }, { cfgRescale: -0.01 }, { cfgRescale: Infinity }, { sampler: "unknown" }]) {
    assert.throws(() => buildNovelAiPayload("p", "n", null, settings), /設定|寬|Seed|Steps|Guidance|CFG Rescale|Sampler/u);
  }
});

test("Image2Image supplies base64 and defaults without changing fixed NAI settings", () => {
  const original = buildNovelAiPayload("prompt", "negative");
  const payload = buildNovelAiPayload("prompt", "negative", { image: "data:image/png;base64,aGVsbG8=" });
  assert.equal(payload.action, "img2img");
  assert.equal(payload.parameters.image, "aGVsbG8=");
  assert.equal(payload.parameters.strength, 0.7);
  assert.equal(payload.parameters.noise, 0);
  const { image, strength, noise, ...fixed } = payload.parameters;
  assert.deepEqual(fixed, original.parameters);
  const bounds = buildNovelAiPayload("prompt", "negative", { image, strength: 0, noise: 1 });
  assert.equal(bounds.parameters.strength, 0);
  assert.equal(bounds.parameters.noise, 1);
});

test("Image2Image rejects invalid image data and out-of-range parameters", () => {
  for (const image of ["", "http://example.com/image.png", "abc", "aGVsbG8=!"]) {
    assert.throws(() => buildNovelAiPayload("p", "n", { image }), /參考圖片/u);
  }
  for (const value of [-0.01, 1.01, NaN, Infinity, "0.5"]) {
    for (const field of ["strength", "noise"]) {
      assert.throws(() => buildNovelAiPayload("p", "n", { image: "aGVsbG8=", [field]: value }), /介於 0 和 1/u);
    }
  }
});

test("the NAI request forwards Image2Image and leaves the caller's snapshot unchanged", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const reference = { image: "aGVsbG8=", strength: 0.35, noise: 0.12 };
  const before = structuredClone(reference);
  const settings = { width: 1024, height: 768, seed: 0, steps: 25, guidance: 6, cfgRescale: 0.4, sampler: "k_dpmpp_2m" };
  let sent;
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.fetch = async (url, options) => {
      sent = JSON.parse(options.body);
      return new Response(await storedZip("image_0.png", new Uint8Array([137, 80, 78, 71])), { status: 200 });
    };
    const image = await generateNovelAiImage({ token: "test-only", prompt: "p", negativePrompt: "n", image2Image: reference, generationSettings: settings });
    assert.equal(image.name, "image_0.png");
    assert.equal(sent.action, "img2img");
    assert.equal(sent.parameters.image, reference.image);
    assert.equal(sent.parameters.strength, reference.strength);
    assert.equal(sent.parameters.noise, reference.noise);
    assert.equal(sent.parameters.width, 1024);
    assert.equal(sent.parameters.height, 768);
    assert.equal(sent.parameters.seed, 0);
    assert.equal(sent.parameters.sampler, "k_dpmpp_2m");
    assert.equal(sent.parameters.steps, 25);
    assert.equal(sent.parameters.scale, 6);
    assert.equal(sent.parameters.cfg_rescale, 0.4);
    assert.deepEqual(reference, before);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test("adds UTF-8 candidate metadata before a PNG IEND chunk", async () => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const iend = Uint8Array.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  const source = new Blob([signature, iend], { type: "image/png" });
  const result = await injectCandidateMetadata(source, {
    createdAt: "2026-09-12T00:00:00Z", batchId: "batch_1",
    prompt: "畫師", negativePrompt: "", genome: {}, fixedSettings: {}, request: {}
  });
  const bytes = new Uint8Array(await result.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.ok(result.size > source.size);
  assert.match(text, /NovelAIStyleEvolver/u);
  assert.match(text, /畫師/u);
  assert.deepEqual(Array.from(bytes.slice(-12)), Array.from(iend));
});

test("all eight current models use the correct capability and prompt families", () => {
  assert.equal(Object.keys(MODELS).length, 8);
  for (const [model, { family }] of Object.entries(MODELS)) {
    const capabilities = modelCapabilities(model);
    const payload = buildNovelAiPayload("p", "n", null, { model });
    assert.equal(payload.model, model);
    assert.equal(capabilities.vibe, family !== "v5");
    assert.equal(capabilities.precise, family === "v4.5");
    assert.equal(capabilities.decrisp, family === "v3");
    assert.equal(capabilities.smea, family === "v3");
    assert.equal(Boolean(payload.parameters.v4_prompt), family !== "v3");
    assert.equal(payload.parameters.params_version, 4);
    assert.equal(payload.parameters.qualityToggle, false);
    assert.equal(payload.parameters.ucPreset, model === "nai-diffusion-3" ? 3 : model === "nai-diffusion-furry-3" ? 2 : 4);
    assert.equal(availableSamplers(model).includes("ddim_v3"), family === "v3");
    assert.equal(availableNoiseSchedules(model, "k_euler").includes("native"), family === "v3");
  }
});

test("unsupported advanced switches do not change the existing V5 payload", () => {
  const original = buildNovelAiPayload("p", "n");
  const changed = buildNovelAiPayload("p", "n", null, {
    varietyPlus: true, decrisp: true, smea: true, smeaDyn: true, autoSmea: true, legacyUc: true, noiseSchedule: "exponential"
  });
  assert.deepEqual(changed, original);
});

test("Variety sigma follows model and image area, while only V4 exposes legacy UC", () => {
  for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-full", "nai-diffusion-3"]) {
    const payload = buildNovelAiPayload("p", "n", null, { model, varietyPlus: true, legacyUc: true });
    assert.equal(payload.parameters.skip_cfg_above_sigma, modelCapabilities(model).varietySigma);
    const larger = buildNovelAiPayload("p", "n", null, { model, varietyPlus: true, width: 1664, height: 1216 });
    assert.equal(larger.parameters.skip_cfg_above_sigma, modelCapabilities(model).varietySigma * Math.sqrt(2));
    if (payload.parameters.v4_negative_prompt) assert.equal(payload.parameters.v4_negative_prompt.legacy_uc, model === "nai-diffusion-4-full");
  }
});

test("V3 SMEA, DYN, Auto and Decrisp respect sampler and Image2Image compatibility", () => {
  const base = { model: "nai-diffusion-3", smeaDyn: true, decrisp: true };
  const payload = buildNovelAiPayload("p", "n", null, base);
  assert.equal(payload.parameters.sm, true);
  assert.equal(payload.parameters.sm_dyn, true);
  assert.equal(payload.parameters.dynamic_thresholding, true);
  const image = buildNovelAiPayload("p", "n", { image: "aGVsbG8=" }, base);
  assert.equal(image.parameters.sm, false);
  assert.equal(image.parameters.sm_dyn, false);
  const ddim = buildNovelAiPayload("p", "n", null, { ...base, sampler: "ddim_v3" });
  assert.equal(ddim.parameters.sm, false);
  assert.equal("noise_schedule" in ddim.parameters, false);
  for (const [width, height, enabled] of [[832, 1216, false], [1024, 1024, true], [1216, 896, true]]) {
    assert.equal(buildNovelAiPayload("p", "n", null, { model: base.model, autoSmea: true, width, height }).parameters.sm, enabled);
    assert.equal(buildNovelAiPayload("p", "n", null, { ...base, smea: true, autoSmea: true, width, height }).parameters.sm_dyn, enabled);
  }
});

test("Vibe raw V3 and encoded V4 requests use distinct parameter formats without mutation", () => {
  const references = { vibes: [{ image: "aGVsbG8=", strength: 0.6, informationExtracted: 0.4 }], normalize: false };
  const original = structuredClone(references);
  const v3 = buildNovelAiPayload("p", "n", null, { model: "nai-diffusion-3" }, references).parameters;
  assert.deepEqual(v3.reference_image_multiple, ["aGVsbG8="]);
  assert.deepEqual(v3.reference_information_extracted_multiple, [0.4]);
  assert.equal(v3.uncond_per_vibe, true);
  for (const model of ["nai-diffusion-4-full", "nai-diffusion-4-5-curated"]) {
    const encoded = buildNovelAiPayload("p", "n", null, { model }, references).parameters;
    assert.deepEqual(encoded.reference_image_multiple, ["aGVsbG8="]);
    assert.deepEqual(encoded.reference_strength_multiple, [0.6]);
    assert.equal(encoded.normalize_reference_strength_multiple, false);
    assert.equal("reference_information_extracted_multiple" in encoded, false);
    assert.equal("uncond_per_vibe" in encoded, false);
  }
  assert.deepEqual(references, original);
});

test("V4.5 Precise Reference uses director arrays, reference types and inverse Fidelity", () => {
  const references = { precise: ["character", "style", "character&style"].map((type, index) => ({ image: "aGVsbG8=", strength: 0.8, fidelity: index / 2, type })) };
  const original = structuredClone(references);
  for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]) {
    const parameters = buildNovelAiPayload("p", "n", null, { model }, references).parameters;
    assert.deepEqual(parameters.director_reference_secondary_strength_values, [1, 0.5, 0]);
    assert.deepEqual(parameters.director_reference_strength_values, [0.8, 0.8, 0.8]);
    assert.deepEqual(parameters.director_reference_information_extracted, [1, 1, 1]);
    assert.deepEqual(parameters.director_reference_descriptions.map(item => item.caption.base_caption), ["character", "style", "character&style"]);
    assert.equal("character_references" in parameters, false);
  }
  assert.deepEqual(references, original);
});

test("invalid models, feature combinations and reference fields are rejected", () => {
  for (const settings of [{ model: "bad" }, { model: "nai-diffusion-4-full", noiseSchedule: "native" }, { noiseSchedule: "bad" }, { smea: "true" }, { sampler: "ddim_v3" }]) {
    assert.throws(() => normalizeGenerationSettings(settings));
  }
  const vibe = { image: "aGVsbG8=", strength: 0.6, informationExtracted: 1 };
  const precise = { image: "aGVsbG8=", strength: 1, fidelity: 1, type: "style" };
  for (const [model, references] of [
    ["nai-diffusion-5-full", { vibes: [vibe] }], ["nai-diffusion-4-full", { precise: [precise] }],
    ["nai-diffusion-4-5-full", { vibes: [vibe], precise: [precise] }],
    ["nai-diffusion-3", { vibes: Array(17).fill(vibe) }],
    ["nai-diffusion-3", { vibes: [{ ...vibe, image: "not valid" }] }],
    ["nai-diffusion-3", { vibes: [{ ...vibe, informationExtracted: 1.1 }] }],
    ["nai-diffusion-4-5-full", { precise: [{ ...precise, type: "bad" }] }],
    ["nai-diffusion-4-5-full", { precise: [{ ...precise, fidelity: NaN }] }]
  ]) assert.throws(() => buildNovelAiPayload("p", "n", null, { model }, references));
});

test("legacy model gene serialization approximates brackets and moves negative style into UC", () => {
  const genome = { artists: [{ tag: "artist:example", weight: 1.1 }], styleTerms: [{ tag: "watercolor", weight: 0.5 }, { tag: "simple illustration", weight: 1.4, polarity: "negative" }] };
  const original = structuredClone(genome);
  const v3 = modelCapabilities("nai-diffusion-3");
  assert.equal(serializeGenome(genome, "solo", v3), "{{example}},\nsolo,\n" + "[".repeat(14) + "watercolor" + "]".repeat(14));
  const v3Negative = serializeGenome(genome, "text", { ...v3, negative: true });
  assert.equal(v3Negative, "text,\n" + "{".repeat(7) + "simple illustration" + "}".repeat(7));
  const v4 = modelCapabilities("nai-diffusion-4-full");
  assert.equal(serializeGenome(genome, "text", { ...v4, negative: true }), "text,\n1.4::simple illustration::");
  assert(serializeGenome(genome, "solo", modelCapabilities("nai-diffusion-4-5-full")).includes("-1.4::simple illustration::"));
  assert.deepEqual(genome, original);
});

test("Vibe encoding sends the official request and returns binary as base64 without real API calls", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let sent;
  let calls = 0;
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.fetch = async (url, options) => {
      calls++;
      sent = { url, headers: options.headers, body: JSON.parse(options.body) };
      return new Response(new Uint8Array([1, 2, 3, 255]), { status: 201 });
    };
    const settings = { token: "test-only", model: "nai-diffusion-4-5-full", image: "aGVsbG8=", informationExtracted: 0.4 };
    assert.equal(await encodeNovelAiVibe(settings), "AQID/w==");
    assert.equal(sent.url, "https://image.novelai.net/ai/encode-vibe");
    assert.deepEqual(sent.body, { model: settings.model, image: settings.image, information_extracted: 0.4 });
    assert.equal(sent.headers.Authorization, "Bearer test-only");
    for (const changes of [{ token: "" }, { model: "nai-diffusion-3" }, { image: "bad" }, { informationExtracted: 2 }]) await assert.rejects(encodeNovelAiVibe({ ...settings, ...changes }));
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "test rate limit" }), { status: 429 });
    await assert.rejects(encodeNovelAiVibe(settings), /429.*test rate limit/u);
    globalThis.fetch = async () => new Response(new Uint8Array(), { status: 201 });
    await assert.rejects(encodeNovelAiVibe(settings), /沒有回傳/u);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test("Anlas reads subscription and purchased balance with the existing Bearer token, including zero and legacy balances", async () => {
  const previousFetch = globalThis.fetch;
  let sent;
  let calls = 0;
  let steps = { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 156125 };
  const account = { isOpus: null, opusUsageExhausted: null };
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      sent = { url, options };
      return Response.json({ trainingStepsLeft: steps });
    };
    assert.deepEqual(await fetchNovelAiAnlas({ token: " Bearer test-only " }), { total: 166125, subscription: 10000, purchased: 156125, account });
    assert.equal(sent.url, "https://image.novelai.net/user/subscription");
    assert.equal(sent.options.method, "GET");
    assert.equal(sent.options.cache, "no-store");
    assert.equal(sent.options.headers.Authorization, "Bearer test-only");
    assert.equal(sent.options.body, undefined);
    await assert.rejects(fetchNovelAiAnlas({ token: " " }), /Token/u);
    assert.equal(calls, 1);
    steps = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 };
    assert.deepEqual(await fetchNovelAiAnlas({ token: "test-only" }), { total: 0, subscription: 0, purchased: 0, account });
    steps = 15;
    assert.deepEqual(await fetchNovelAiAnlas({ token: "test-only" }), { total: 15, subscription: 15, purchased: 0, account });
    steps = { purchasedTrainingSteps: 8 };
    assert.equal((await fetchNovelAiAnlas({ token: "test-only" })).total, 8);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anlas uses subscription expiry and V5 usage status, never the size of the balance, to identify free eligibility", async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const [details, expected] of [
      [{ tier: 3, active: true, usage: { isNegative: false } }, { isOpus: true, opusUsageExhausted: false }],
      [{ tier: 3, active: true, expiresAt: 1, usage: { isNegative: true } }, { isOpus: false, opusUsageExhausted: true }],
      [{ tier: 3, active: false, expiresAt: Date.now() / 1000 + 3600 }, { isOpus: true, opusUsageExhausted: null }],
      [{ tier: 3, active: false, accountType: 1 }, { isOpus: true, opusUsageExhausted: null }],
      [{ tier: 1, active: true }, { isOpus: false, opusUsageExhausted: null }],
      [{ tier: 3 }, { isOpus: null, opusUsageExhausted: null }],
      [{}, { isOpus: null, opusUsageExhausted: null }]
    ]) {
      globalThis.fetch = async () => Response.json({ ...details, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 166125 } });
      assert.deepEqual((await fetchNovelAiAnlas({ token: "test-only" })).account, expected);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Image2Image keeps legal source dimensions and scales or rounds unsupported dimensions without swapping orientation", () => {
  for (const [width, height, expected] of [
    [832, 1216, { width: 832, height: 1216 }], [1216, 832, { width: 1216, height: 832 }],
    [1024, 1024, { width: 1024, height: 1024 }], [400, 200, { width: 384, height: 192 }],
    [4096, 2048, { width: 2048, height: 1024 }], [3000, 4000, { width: 1536, height: 2048 }],
    [1, 1, { width: 64, height: 64 }], [1280, 720, { width: 1280, height: 704 }]
  ]) assert.deepEqual(normalizeImageDimensions(width, height), expected);
  for (const value of [0, -1, NaN, Infinity, "832", 1.5]) assert.throws(() => normalizeImageDimensions(value, 1216), /尺寸/u);
});

test("cost estimates respect sequential Opus generation, expired usage, model pricing, remaining count and Image2Image strength", () => {
  const paid = { isOpus: false };
  const opus = { isOpus: true, opusUsageExhausted: false };
  assert.deepEqual(estimateNovelAiCost({ account: paid }), { count: 5, basePerImage: 30, extraPerImage: 0, min: 150, max: 150, unsupported: false });
  assert.equal(estimateNovelAiCost({ account: opus }).max, 0);
  assert.equal(estimateNovelAiCost({ account: { isOpus: true, opusUsageExhausted: true } }).min, 150);
  const unknown = estimateNovelAiCost();
  assert.equal(unknown.min, 0);
  assert.equal(unknown.max, 150);
  assert.equal(estimateNovelAiCost({ account: { isOpus: true } }).max, 150);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { steps: 29 } }).min, 150);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { width: 1216, height: 1216 } }).min, 220);
  assert.equal(estimateNovelAiCost({ account: paid, count: 3 }).max, 90);
  assert.equal(estimateNovelAiCost({ account: paid, count: 0 }).max, 0);
  assert.equal(estimateNovelAiCost({ account: paid, image2Image: { strength: 0.35 } }).basePerImage, 11);
  assert.equal(estimateNovelAiCost({ account: opus, image2Image: { strength: 0.35 } }).max, 0);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { model: "nai-diffusion-4-5-full" } }).max, 0);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: { model: "nai-diffusion-4-full" } }).basePerImage, 20);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: { width: 2048, height: 2048, steps: 50 } }).unsupported, true);
  assert.throws(() => estimateNovelAiCost({ count: -1 }), /張數/u);
  assert.throws(() => estimateNovelAiCost({ image2Image: { strength: 2 } }), /Strength/u);
});

test("cost estimates mirror effective SMEA and add Vibe or Precise fees even when base generation is free", () => {
  const paid = { isOpus: false };
  const opus = { isOpus: true, opusUsageExhausted: false };
  const v3 = { model: "nai-diffusion-3", smea: true };
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: v3 }).basePerImage, 24);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: { ...v3, smeaDyn: true } }).basePerImage, 28);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: { ...v3, autoSmea: true } }).basePerImage, 20);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: { ...v3, sampler: "ddim_v3" } }).basePerImage, 20);
  assert.equal(estimateNovelAiCost({ account: paid, generationSettings: v3, image2Image: { strength: 1 } }).basePerImage, 20);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { model: "nai-diffusion-4-5-full" }, references: { precise: [{}, {}] } }).max, 50);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { model: "nai-diffusion-4-full" }, references: { vibes: [{}, {}, {}, {}, {}, {}] } }).max, 20);
  assert.equal(estimateNovelAiCost({ account: opus, generationSettings: { model: "nai-diffusion-3" }, references: { vibes: [{}, {}, {}, {}, {}] } }).max, 0);
  assert.equal(estimateNovelAiCost({ account: opus, references: { precise: [{}], vibes: [{}, {}, {}, {}, {}] } }).max, 0);
});

test("Anlas rejects missing or malformed balance data instead of inventing a zero balance", async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const steps of [undefined, null, {}, "5", [], -1, 0.1, { fixedTrainingStepsLeft: "5" }, { purchasedTrainingSteps: -1 }, { fixedTrainingStepsLeft: Number.MAX_SAFE_INTEGER, purchasedTrainingSteps: 1 }]) {
      globalThis.fetch = async () => Response.json({ trainingStepsLeft: steps });
      await assert.rejects(fetchNovelAiAnlas({ token: "test-only" }), /有效的 Anlas 餘額/u);
    }
    globalThis.fetch = async () => new Response("not json");
    await assert.rejects(fetchNovelAiAnlas({ token: "test-only" }), /格式不正確/u);
    for (const status of [401, 403, 429, 500]) {
      globalThis.fetch = async () => new Response("ignored body", { status });
      await assert.rejects(fetchNovelAiAnlas({ token: "test-only" }), status === 401 || status === 403 ? /Token 無效/u : new RegExp(`HTTP ${status}`));
    }
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(fetchNovelAiAnlas({ token: "test-only" }), /網路或瀏覽器限制/u);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anlas cancels stale account requests and bounds queries with a 15 second timeout", async () => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let fireTimeout;
  let fetched = 0;
  let cleared = 0;
  try {
    globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 15000); fireTimeout = callback; return 123; };
    globalThis.clearTimeout = (timer) => { assert.equal(timer, 123); cleared++; };
    globalThis.fetch = async (url, { signal }) => {
      fetched++;
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    };
    const controller = new AbortController();
    const cancelled = fetchNovelAiAnlas({ token: "test-only", signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, /已取消/u);
    await assert.rejects(fetchNovelAiAnlas({ token: "test-only", signal: controller.signal }), /已取消/u);
    assert.equal(fetched, 1);
    const timedOut = fetchNovelAiAnlas({ token: "test-only" });
    fireTimeout();
    await assert.rejects(timedOut, /逾時/u);
    assert.equal(cleared, 3);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test("generation forwards the frozen model and Precise references, not a current UI setting", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const references = { precise: [{ image: "aGVsbG8=", type: "style", strength: 0.6, fidelity: 0.8 }] };
  const original = structuredClone(references);
  let sent;
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.fetch = async (url, options) => {
      sent = JSON.parse(options.body);
      return new Response(await storedZip("image.png", new Uint8Array([137, 80, 78, 71])), { status: 200 });
    };
    await generateNovelAiImage({ token: "test-only", prompt: "p", generationSettings: { model: "nai-diffusion-4-5-curated" }, references });
    assert.equal(sent.model, "nai-diffusion-4-5-curated");
    assert.deepEqual(sent.parameters.director_reference_images, ["aGVsbG8="]);
    assert(Math.abs(sent.parameters.director_reference_secondary_strength_values[0] - 0.2) < 1e-10);
    assert.deepEqual(references, original);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
