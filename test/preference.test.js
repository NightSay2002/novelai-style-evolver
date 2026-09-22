import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { applyPreferenceVote, comparisonContext, compatibleLearning, createLearning, generatePreferenceBatch, preferenceFeatures, preferenceRanking, predictPreference, redistributeWeights, seedArtistPreferences } from "../src/preference.js";

function random(seed = 1) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
const artist = (tag, weight = 1, pinned = false) => ({ tag: `artist:${tag}`, weight, pinned, polarity: "positive" });
const genome = (...artists) => ({ artists, styleTerms: [], id: "parent" });
const card = (id, value, contextKey = "same") => ({ id, genome: value, status: "success", contextKey });

test("custom starting artists receive an additive +1 preference and rank without fake comparisons", () => {
  const original = createLearning();
  const seeded = seedArtistPreferences(original, ["artist:known", "artist:unknown"], 1);
  assert.deepEqual(original, createLearning());
  for (const tag of ["artist:known", "artist:unknown"]) {
    assert.equal(predictPreference(genome({ tag, weight: 1 }), seeded).score, 0.1);
    assert.equal(seeded.artists[tag].comparisons, 0);
  }
  assert.deepEqual(preferenceRanking(seeded).map(({ tag, score, rounds, evidence }) => ({ tag, score, rounds, evidence })), [
    { tag: "artist:known", score: 1, rounds: 0, evidence: "自選起點" },
    { tag: "artist:unknown", score: 1, rounds: 0, evidence: "自選起點" }
  ]);
  const twice = seedArtistPreferences(seeded, ["artist:known"], 1);
  assert.equal(preferenceRanking(twice).find((item) => item.tag === "artist:known").score, 2);
});

test("comparison fingerprint isolates all effective inputs and excludes credentials / filenames", async () => {
  const settings = { contentPrompt: "solo", negativePrompt: "text", seedStylePrompt: "quality", generationSettings: { model: "v5", seed: 1, width: 832 } };
  const first = await comparisonContext(settings);
  assert.equal(first.length, 64);
  assert.equal(first, await comparisonContext({ ...settings, token: "not-a-real-token" }));
  for (const key of ["contentPrompt", "negativePrompt", "seedStylePrompt"]) assert.notEqual(first, await comparisonContext({ ...settings, [key]: "different" }));
  for (const key of ["model", "seed", "width"]) assert.notEqual(first, await comparisonContext({ ...settings, generationSettings: { ...settings.generationSettings, [key]: "different" } }));
  const image = { image: "image-1", strength: 0.7, noise: 0, fileName: "a.png" };
  const withImage = await comparisonContext(settings, image);
  assert.notEqual(first, withImage);
  assert.equal(withImage, await comparisonContext(settings, { ...image, fileName: "renamed.png" }));
  for (const change of [{ image: "image-2" }, { noise: 0.2 }, { strength: 0.5 }]) assert.notEqual(withImage, await comparisonContext(settings, { ...image, ...change }));
  const refs = { normalize: true, vibes: [{ image: "encoded", strength: 0.5, informationExtracted: 1 }], precise: [] };
  assert.notEqual(first, await comparisonContext(settings, null, refs));
  assert.notEqual(await comparisonContext(settings, null, refs), await comparisonContext(settings, null, { ...refs, normalize: false }));
});

test("pairwise credit cancels common artists; strong dislike and neutral points remain image-level", () => {
  const good = card("a", genome(artist("common"), artist("good")));
  const bad = card("b", genome(artist("common"), artist("bad")));
  const neutral = card("c", genome(artist("common"), artist("neutral")));
  const before = createLearning();
  const { learning, candidateDeltas, comparisonCount } = applyPreferenceVote(before, [good, bad, neutral], ["a"], ["b"], { rng: random(2) });
  assert.deepEqual(before, createLearning());
  assert.deepEqual(candidateDeltas, { a: 2, b: -3, c: -1 });
  assert.equal(comparisonCount, 2);
  assert(learning.models.every((model) => !model["a:artist:common"]));
  assert.equal(learning.artists["artist:common"].comparisons, 0);
  assert(predictPreference(good.genome, learning).score > predictPreference(bad.genome, learning).score);
  assert(predictPreference(neutral.genome, learning).score > predictPreference(bad.genome, learning).score);
});

test("multi-likes are unordered; no implicit comparisons for ignore, cross-context or all liked", () => {
  const candidates = [card("a", genome(artist("a"))), card("b", genome(artist("b")))];
  for (const options of [{ action: "ignore" }, { action: "reject" }, {}]) {
    const result = applyPreferenceVote(createLearning(), candidates, ["a", "b"], [], options);
    assert.equal(result.comparisonCount, 0);
    assert.equal(result.learning.rounds, 0);
    assert(result.learning.models.every((model) => !Object.keys(model).length));
  }
  const different = [{ ...candidates[1], contextKey: "other" }];
  assert.equal(applyPreferenceVote(createLearning(), [candidates[0], ...different], ["a"], ["b"]).comparisonCount, 0);
  assert.equal(applyPreferenceVote(createLearning(), candidates, [], [], { action: "reject", baseline: different[0] }).comparisonCount, 0);
});

test("weak-only feedback stays one quarter as strong after batch normalization", () => {
  const candidates = [card("a", genome(artist("a"))), card("b", genome(artist("b")))];
  const weak = applyPreferenceVote(createLearning(), candidates, ["a"], [], { rng: random(2) }).learning;
  const strong = applyPreferenceVote(createLearning(), candidates, ["a"], ["b"], { rng: random(2) }).learning;
  assert(predictPreference(candidates[0].genome, strong).score > 0);
  strong.models.forEach((model, index) => {
    for (const [key, value] of Object.entries(model)) assert(Math.abs(weak.models[index][key] * 4 - value) < 1e-12);
  });
  const repeated = [candidates[0], ...Array.from({ length: 4 }, (_, index) => ({ ...candidates[1], id: `b${index}` }))];
  const expanded = applyPreferenceVote(createLearning(), repeated, ["a"], repeated.slice(1).map((item) => item.id), { rng: random(2) }).learning;
  assert.deepEqual(expanded.models, strong.models, "correlated expansions must not multiply evidence");
});

test("promotion and reject learn explicit baseline comparisons once; baseline is never mutated", () => {
  const baseline = card("base", genome(artist("old")));
  const candidates = [card("a", genome(artist("new")))];
  const stored = structuredClone(baseline);
  const promoted = applyPreferenceVote(createLearning(), candidates, [], [], { baseline, promotedId: "a", eventId: "event", rng: random(5) });
  assert.equal(promoted.comparisonCount, 1);
  assert(predictPreference(candidates[0].genome, promoted.learning).score > predictPreference(baseline.genome, promoted.learning).score);
  const duplicate = applyPreferenceVote(promoted.learning, candidates, [], [], { baseline, promotedId: "a", eventId: "event" });
  assert.deepEqual(duplicate.learning, promoted.learning);
  assert.deepEqual(baseline, stored);
  const rejected = applyPreferenceVote(createLearning(), candidates, [], ["a"], { baseline, action: "reject", rng: random(5) });
  assert.equal(rejected.comparisonCount, 1);
  assert.equal(rejected.candidateDeltas.a, -3);
  assert(predictPreference(baseline.genome, rejected.learning).score > predictPreference(candidates[0].genome, rejected.learning).score);
  const first = applyPreferenceVote(createLearning(), candidates, [], [], { promotedId: "a" });
  assert.equal(first.comparisonCount, 0);
});

test("continuous weight features learn a non-monotonic optimum without blaming artist identity", () => {
  let learning = createLearning();
  const rng = random(17);
  const mid = card("mid", genome(artist("a", 1)));
  for (let i = 0; i < 150; i += 1) {
    const low = card("low", genome(artist("a", 0.1)));
    const high = card("high", genome(artist("a", 2)));
    learning = applyPreferenceVote(learning, [mid, low, high], ["mid"], ["low", "high"], { rng }).learning;
  }
  const score = (w) => predictPreference(genome(artist("a", w)), learning).score;
  assert(score(1) > score(0.1) && score(1) > score(2));
  assert.notEqual(score(0.7), score(1.1));
  assert(learning.models.every((model) => !model["a:artist:a"]));
  assert(learning.models.some((model, index) => JSON.stringify(model) !== JSON.stringify(learning.models[(index + 1) % 5])));
});

test("pair corrections require three different rounds and co-moving artists stay unconfirmed", () => {
  let learning = createLearning();
  const a = card("a", genome(artist("a"), artist("b")));
  const b = card("b", genome(artist("c"), artist("d")));
  const rng = random(22);
  for (let round = 1; round <= 3; round += 1) {
    learning = applyPreferenceVote(learning, [a, b], ["a"], ["b"], { rng }).learning;
    assert.equal(Object.keys(preferenceFeatures(a.genome, learning)).some((key) => key.startsWith("p:")), round >= 3);
  }
  assert(preferenceRanking(learning).every((item) => item.evidence === "待確認"));
  assert(learning.models.every((model) => Object.values(model).every(Number.isFinite)));
});

test("large redistribution changes every unlocked weight by >= .7 and reverses dominance", () => {
  const rng = random(18);
  for (const old of [[0.2, 1.2, 0.6, 0.6, 0.1, 0.7], [2, 2, 2], [0.1, 0.1, 0.1], [1.3, 1.4], [1]]) {
    const artists = old.map((weight, index) => artist(String(index), weight));
    for (let trial = 0; trial < 100; trial += 1) {
      const result = redistributeWeights(artists, rng);
      result.forEach((item, index) => {
        assert(Math.abs(item.weight - artists[index].weight) >= 0.699);
        assert(item.weight >= 0.1 && item.weight <= 2);
      });
      if (old.length > 1) {
        const ordered = [...artists].sort((a, b) => a.weight - b.weight || a.tag.localeCompare(b.tag));
        assert(result.find((a) => a.tag === ordered[0].tag).weight > result.find((a) => a.tag === ordered.at(-1).tag).weight);
      }
    }
  }
  const pinned = artist("pin", 0.8, true);
  assert.deepEqual(redistributeWeights([pinned, artist("a")], rng)[0], pinned);
});

test("1+3+1 preserves replacement weights and pins, permits additions, and keeps quality fixed", () => {
  assert.throws(() => generatePreferenceBatch({ batchNumber: 1, artistPool: [] }), /畫師資料庫是空的/);
  const rng = random(3);
  const pool = Array.from({ length: 100 }, (_, i) => ({ tag: `artist:${i}` }));
  const quality = [{ tag: "best quality", weight: 1.5 }];
  const counts = { add: 0, replace: 0, grow: 0 };
  for (let size = 1; size <= 6; size += 1) {
    const parent = genome(...Array.from({ length: size }, (_, i) => artist(String(i), 0.2 + i * 0.3, i === 0 && size > 1)));
    for (let trial = 0; trial < 25; trial += 1) {
      const batch = generatePreferenceBatch({ batchNumber: 20, parent, artistPool: pool, fixedStyleTerms: quality, rng });
      assert.deepEqual(batch.map((item) => item.role), ["weights", "preferred", "uncertain", "unseen", "explore"]);
      assert.equal(new Set(batch.map((item) => JSON.stringify(item.artists))).size, 5);
      for (const candidate of batch) {
        assert.deepEqual(candidate.styleTerms, quality);
        assert(candidate.artists.length >= 3 && candidate.artists.length <= 6);
        assert.equal(new Set(candidate.artists.map((item) => item.tag)).size, candidate.artists.length);
        if (size > 1) assert.deepEqual(candidate.artists.find((item) => item.pinned), parent.artists[0]);
      }
      for (const candidate of batch.slice(1, 4)) {
        counts[candidate.mutation.operation] += 1;
        const added = candidate.artists.filter((item) => !parent.artists.some((old) => old.tag === item.tag));
        const removed = parent.artists.filter((item) => !candidate.artists.some((next) => next.tag === item.tag));
        assert.equal(added.length, size < 3 ? 3 - size : 1);
        if (size < 3) {
          assert.equal(candidate.mutation.operation, "grow");
          assert.equal(removed.length, 0);
        }
        assert(removed.length <= 1);
        if (removed.length) assert.equal(added[0].weight, removed[0].weight);
        candidate.artists.filter((item) => !added.includes(item)).forEach((item) => assert.deepEqual(item, parent.artists.find((old) => old.tag === item.tag)));
      }
    }
  }
  assert(counts.grow === 150 && counts.add > 60 && counts.replace > 100);
  const locked = genome(...pool.slice(0, 6).map((item) => ({ ...item, weight: 1, pinned: true })));
  assert(generatePreferenceBatch({ batchNumber: 20, parent: locked, artistPool: pool, rng }).every((item) => item.mutation.operation === "locked"));
});

test("fifth batch has at least three artists even when a one-artist baseline is never promoted", () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ tag: `artist:${i}` }));
  const parent = genome(artist("0", 0.8));
  const original = structuredClone(parent);
  const quality = [{ tag: "best quality", weight: 1.5 }];
  for (let seed = 1; seed <= 10; seed++) {
    const rng = random(seed);
    for (let round = 1; round <= 8; round++) {
      const batch = generatePreferenceBatch({ batchNumber: round, parent, artistPool: pool, fixedStyleTerms: quality, rng });
      const min = round >= 5 ? 3 : round >= 3 ? 2 : 1;
      for (const candidate of batch) {
        assert(candidate.artists.length >= min && candidate.artists.length <= 6, `round ${round} must meet its minimum`);
        assert.equal(new Set(candidate.artists.map(item => item.tag)).size, candidate.artists.length);
        assert(candidate.artists.every(item => item.weight >= 0.1 && item.weight <= 2));
        assert.deepEqual(candidate.styleTerms, quality);
      }
      if (round >= 3) {
        batch.slice(0, 4).forEach((candidate, index) => {
          assert.equal(candidate.mutation.operation, "grow");
          const retained = candidate.artists.find(item => item.tag === parent.artists[0].tag);
          assert(retained);
          if (index === 0) assert(Math.abs(retained.weight - 0.8) >= 0.699);
          else assert.deepEqual(retained, parent.artists[0]);
        });
      }
    }
  }
  assert.deepEqual(parent, original, "candidate growth must not silently overwrite the saved baseline");
  const pinned = genome(artist("0", 0.8, true));
  const pinnedBatch = generatePreferenceBatch({ batchNumber: 5, parent: pinned, artistPool: pool, rng: random(5) });
  assert(pinnedBatch.every(candidate => candidate.artists.length >= 3 && candidate.artists.some(item => item.pinned && item.tag === "artist:0" && item.weight === 0.8)));
  const coldStart = generatePreferenceBatch({ batchNumber: 5, artistPool: pool, rng: random(5) });
  assert(coldStart.every(candidate => candidate.artists.length >= 3));
});

test("52k pool uses learned high scorers without biasing the fresh slot; bounded performance", () => {
  const pool = Array.from({ length: 52266 }, (_, i) => ({ tag: `artist:${i}` }));
  const learning = createLearning();
  learning.artists["artist:42"] = { comparisons: 10, independent: 10, appearances: 10 };
  learning.models.forEach((model) => { model["a:artist:42"] = 3; });
  const parent = genome(artist("0"), artist("1", 0.3), artist("2", 1.5));
  const start = performance.now();
  const batch = generatePreferenceBatch({ batchNumber: 20, parent, artistPool: pool, learning, rng: random(4) });
  assert(batch[1].artists.some((item) => item.tag === "artist:42"));
  assert(batch[4].artists.every((item) => !["artist:0", "artist:1", "artist:2", "artist:42"].includes(item.tag)));
  assert(performance.now() - start < 2000, "52k proposals must complete within 2 seconds, not scan the pool per proposal");
  assert(compatibleLearning(structuredClone(learning)));
  assert(!compatibleLearning({ version: 0 }));
});

test("high-score extensions avoid prior batches and use another artist when ranked edits are exhausted", () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ tag: `artist:${i}` }));
  const parent = genome(...Array.from({ length: 6 }, (_, i) => artist(String(i), 1, i === 0)));
  const learning = createLearning();
  learning.artists["artist:42"] = { comparisons: 10, independent: 10, appearances: 10 };
  learning.models.forEach((model) => { model["a:artist:42"] = 3; });
  const key = value => JSON.stringify(value.artists.map(item => [item.tag.toLowerCase(), item.weight]).sort());
  // Every permitted placement of the sole high-scoring artist has already run.
  const prior = parent.artists.flatMap((item, index) => item.pinned ? [] : [{ artists: parent.artists.map((old, i) => i === index ? artist("42", old.weight) : old) }]);
  const seen = new Set([key(parent), ...prior.map(key)]);
  const rng = random(22);
  for (let round = 0; round < 20; round++) {
    const batch = generatePreferenceBatch({ batchNumber: 20 + round, parent, artistPool: pool, learning, excludedGenomes: prior, rng });
    assert.equal(batch[1].mutation.operation, "replace");
    assert(batch[1].artists.every(item => item.tag !== "artist:42"), "exhausted ranked edits must widen the pool");
    for (const candidate of batch) {
      assert(!seen.has(key(candidate)), "same-setting prior combinations must not be regenerated");
      seen.add(key(candidate));
      assert.deepEqual(candidate.artists.find(item => item.pinned), parent.artists[0]);
    }
    for (const candidate of batch.slice(1, 4)) {
      const added = candidate.artists.filter(item => !parent.artists.some(old => old.tag === item.tag));
      const removed = parent.artists.filter(item => !candidate.artists.some(next => next.tag === item.tag));
      assert.equal(added.length, 1);
      assert.equal(removed.length, 1);
      assert.equal(added[0].weight, removed[0].weight);
    }
    prior.push(...batch);
  }
});
