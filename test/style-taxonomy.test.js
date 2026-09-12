import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyStyle, classifyStylePool } from "../src/style-taxonomy.js";
import { generateBatch, makeInitialGenome, parseStylePrompt, genomeFeatureKeys } from "../src/evolution.js";

const original = JSON.parse(readFileSync(new URL("../data/style-tags.json", import.meta.url), "utf8"));
const classified = classifyStylePool(original.tags);
const pool = classified.filter((item) => item.enabled !== false);
const artists = Array.from({ length: 100 }, (_, index) => ({ tag: `artist:layer-${index}` }));
function random(seed = 42) {
  let value = seed;
  return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 2 ** 32; };
}
const initial = () => makeInitialGenome(parseStylePrompt("best quality, year 2025, watercolor, soft shading, pastel colors", classified));
function batch(parent, rng = random(), forceExplore = false) {
  return generateBatch({ batchNumber: 20, parents: [parent], stylePool: pool, artistPool: artists,
    categories: original.categories, forceExplore, rng });
}

test("all 1000 existing records have an explicit reviewed classification without changing tag/category", () => {
  assert.equal(classified.length, 1000);
  classified.forEach((item, index) => {
    assert.equal(item.reviewed, true, item.tag);
    assert.equal(item.tag, original.tags[index].tag);
    assert.equal(item.category, original.tags[index].category);
    assert.ok(["medium", "shading", "color", "auxiliary"].includes(item.layer));
    assert.ok(item.facet);
  });
  assert.equal(classifyStyle("crayon drawing").layer, "medium");
  assert.equal(classifyStyle("colored pencil").layer, "medium");
  assert.equal(classifyStyle("high contrast").layer, "shading");
  assert.equal(classifyStyle("cool shadows").layer, "color");
  assert.equal(classifyStyle("year 2026").layer, "auxiliary");
  assert.equal(classifyStyle("flow glow (hololive)").enabled, false);
  assert.equal(classifyStyle("soft hard shading").enabled, false);
  assert.equal(classifyStyle("unreviewed personal phrase").reviewed, false);
});

test("draws three-layer 10–19 plus auxiliary 2–6, covers 12–25 and preserves exploration over 60 rounds", () => {
  const rng = random(781);
  const totals = new Set();
  const coreTotals = new Set();
  const auxiliaryTotals = new Set();
  let parent = initial();
  for (let round = 0; round < 60; round += 1) {
    const before = structuredClone(parent);
    const old = new Set(parent.styleTerms.map((item) => item.tag));
    const genomes = batch(parent, rng);
    assert.deepEqual(parent, before);
    for (const [index, genome] of genomes.entries()) {
      const counts = Object.fromEntries(["medium", "shading", "color", "auxiliary"].map((layer) =>
        [layer, genome.styleTerms.filter((item) => item.layer === layer).length]));
      const core = counts.medium + counts.shading + counts.color;
      assert.ok(core >= 10 && core <= 19);
      assert.ok(counts.auxiliary >= 2 && counts.auxiliary <= 6);
      assert.ok(counts.medium >= 3 && counts.medium <= 6);
      assert.ok(counts.shading >= 4 && counts.shading <= 7);
      assert.ok(counts.color >= 3 && counts.color <= 6);
      assert.equal(new Set(genome.styleTerms.map((item) => item.tag)).size, genome.styleTerms.length);
      for (const item of genome.styleTerms) {
        assert.ok(item.weight >= 0.1 && item.weight <= 2);
        assert.notEqual(classifyStyle(item.tag).enabled, false);
        if (!["suppression", "custom"].includes(item.facet)) {
          assert.equal(genome.styleTerms.filter((other) => other.layer === item.layer && other.facet === item.facet
            && (item.layer !== "auxiliary" || other.polarity === item.polarity)).length, 1);
        }
      }
      if (index > 0) assert.ok(genome.styleTerms.filter((item) => !old.has(item.tag)).length >= 4);
      totals.add(genome.styleTerms.length); coreTotals.add(core); auxiliaryTotals.add(counts.auxiliary);
    }
    parent = genomes[round % 5];
  }
  assert.deepEqual([...totals].sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 12));
  assert.equal(coreTotals.size, 10);
  assert.equal(auxiliaryTotals.size, 5);
});

test("negative numeric medium stays in medium and preference feature keys do not change", () => {
  const terms = parseStylePrompt("-1.4::watercolor::, 1.7::year 2025 ::", classified);
  assert.equal(terms[0].layer, "medium");
  assert.equal(terms[0].polarity, "negative");
  const genome = makeInitialGenome(terms);
  const legacy = makeInitialGenome(terms.map(({ layer, facet, ...item }) => item));
  assert.deepEqual(genomeFeatureKeys(genome), genomeFeatureKeys(legacy));
  terms[0].pinned = true;
  for (const result of batch(makeInitialGenome(terms))) {
    assert.deepEqual(result.styleTerms.find((item) => item.tag === "watercolor"), terms[0]);
  }
});

test("rejects excessive auxiliary/core/total pins without mutating parents", () => {
  for (const [layer, count] of [["auxiliary", 7], ["medium", 20], ["medium", 26]]) {
    const parent = makeInitialGenome(Array.from({ length: count }, (_, index) =>
      ({ tag: `fixed-${index}`, layer, facet: "custom", weight: 1.3, pinned: true, polarity: "positive" })));
    const before = structuredClone(parent);
    assert.throws(() => batch(parent), /固定/u);
    assert.deepEqual(parent, before);
  }
});

test("restricted pools underfill safely and unknown pinned custom terms survive", () => {
  const parent = makeInitialGenome([{ tag: "personal phrase", layer: "auxiliary", facet: "custom", weight: 1.8, pinned: true, polarity: "positive" }]);
  const genomes = generateBatch({ batchNumber: 20, parents: [parent], artistPool: artists,
    stylePool: pool.filter((item) => item.tag === "watercolor (medium)"), categories: original.categories, rng: random() });
  for (const genome of genomes) {
    assert.equal(genome.styleTerms.length, 2);
    assert.deepEqual(genome.styleTerms.find((item) => item.pinned), parent.styleTerms[0]);
  }
});
