// Synthetic preferences only. No network, images, tokens or browser storage.
import { applyBatchVote, artistCountRange, generateBatch, makeInitialGenome } from "../src/evolution.js";
import { applyPreferenceVote, createLearning, generatePreferenceBatch } from "../src/preference.js";

const seeds = Number(process.argv[2] || 12);
const rounds = Number(process.argv[3] || 35);
if (![seeds, rounds].every((value) => Number.isInteger(value) && value >= 1 && value <= 200)) throw new Error("Use 1–200 seeds and rounds.");
const pool = Array.from({ length: 128 }, (_, index) => ({ tag: `artist:${index}` }));
const rngFor = (seed) => {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
};
function utility(genome, scenario) {
  const values = genome.artists.map((item) => {
    const id = Number(item.tag.split(":")[1]);
    const quality = Math.sin(id * 2.399) * 1.5 + 0.25;
    const optimum = 0.7 + (id % 7) * 0.15;
    const weightEffect = scenario === "additive" ? item.weight : 1 - 1.6 * (item.weight - optimum) ** 2;
    return { id, contribution: quality * weightEffect };
  });
  let score = values.reduce((sum, value) => sum + value.contribution, 0) / Math.sqrt(Math.max(1, values.length));
  if (scenario === "interactions" || scenario === "noisy") {
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        score += values[i].id % 4 === values[j].id % 4 ? 0.5 : -0.15;
      }
    }
  }
  return score;
}

function run(method, scenario, seed) {
  const rng = rngFor(seed);
  const feedbackRng = rngFor(seed + 9000);
  let learning = createLearning();
  let stats = {};
  let parents = [makeInitialGenome([])];
  let baseline = null;
  let forceExplore = false;
  let best = -Infinity;
  let accumulatedBest = 0;
  let lastBatchQuality = 0;
  const artistsSeen = new Set();
  for (let round = 1; round <= rounds; round += 1) {
    let genomes;
    if (method === "new") genomes = generatePreferenceBatch({ batchNumber: round, parent: baseline?.genome || parents[0], artistPool: pool, learning, rng });
    else if (method === "old") genomes = generateBatch({ batchNumber: round, parents, artistPool: pool, stylePool: [], fixedStyleTerms: [], categories: {}, stats, forceExplore, rng });
    else genomes = Array.from({ length: 5 }, () => {
      const artists = [];
      const [min, max] = artistCountRange(round);
      const count = min + Math.floor(rng() * (max - min + 1));
      while (artists.length < count) {
        const item = pool[Math.floor(rng() * pool.length)];
        if (!artists.some((old) => old.tag === item.tag)) artists.push({ ...item, weight: (1 + Math.floor(rng() * 20)) / 10 });
      }
      return { artists, styleTerms: [] };
    });
    const candidates = genomes.map((genome, index) => ({ id: `${round}-${index}`, status: "success", contextKey: "fixed", genome }));
    const scores = candidates.map((item) => utility(item.genome, scenario));
    candidates.forEach((item) => item.genome.artists.forEach((artist) => artistsSeen.add(artist.tag)));
    const highest = Math.max(...scores);
    best = Math.max(best, highest);
    accumulatedBest += best;
    lastBatchQuality = scores.reduce((sum, score) => sum + score, 0) / 5;
    const oldBest = baseline ? utility(baseline.genome, scenario) : -Infinity;
    const accepted = highest >= Math.max(0.4, oldBest - 0.4);
    let selected = accepted ? candidates.filter((_, index) => scores[index] >= highest - 0.2).map((item) => item.id) : [];
    // Noisy ordinary votes; explicit baseline promotion remains an oracle control.
    if (scenario === "noisy" && feedbackRng() < 0.15) selected = [candidates[Math.floor(feedbackRng() * 5)].id];
    const disliked = candidates.filter((item, index) => !selected.includes(item.id) && scores[index] < oldBest - 0.4).map((item) => item.id);
    const promoted = highest > oldBest && highest > 0 ? candidates[scores.indexOf(highest)] : null;
    if (method === "new") learning = applyPreferenceVote(learning, candidates, selected, disliked, {
      baseline, promotedId: promoted?.id, action: !selected.length && !promoted ? "reject" : "vote", rng, eventId: `r${round}`
    }).learning;
    if (method === "old") {
      stats = applyBatchVote(stats, candidates, selected, disliked).stats;
      if (selected.length) { parents = candidates.filter((item) => selected.includes(item.id)).map((item) => item.genome); forceExplore = false; }
      else forceExplore = true;
    }
    if (promoted) baseline = promoted;
  }
  return { best, averageBest: accumulatedBest / rounds, lastBatchQuality, diversity: artistsSeen.size,
    learningKB: JSON.stringify(learning).length / 1024 };
}

const results = [];
for (const scenario of ["additive", "weight-optimum", "interactions", "noisy"]) {
  for (const method of ["old", "random", "new"]) {
    const runs = Array.from({ length: seeds }, (_, index) => run(method, scenario, index + 1));
    const row = { scenario, method };
    for (const key of Object.keys(runs[0])) row[key] = Number((runs.reduce((sum, item) => sum + item[key], 0) / seeds).toFixed(3));
    results.push(row);
  }
}
console.log(JSON.stringify({ seeds, rounds, imagesPerRun: rounds * 5, note: "Synthetic utility units; not NAI image quality. Noisy votes do not corrupt the oracle baseline promotion.", results }, null, 2));
