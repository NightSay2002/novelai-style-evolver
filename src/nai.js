const API_BASE_URL = "https://image.novelai.net";
const ACCOUNT_API_URL = `${API_BASE_URL}/user/subscription`;
const REQUEST_TIMEOUT_MS = 600_000;

// Capabilities checked against NovelAI's model settings and image API schema.
export const MODELS = Object.freeze({
  "nai-diffusion-5-full": { label: "V5 Full", family: "v5" },
  "nai-diffusion-5-curated": { label: "V5 Curated", family: "v5" },
  "nai-diffusion-4-5-full": { label: "V4.5 Full", family: "v4.5" },
  "nai-diffusion-4-5-curated": { label: "V4.5 Curated", family: "v4.5" },
  "nai-diffusion-4-full": { label: "V4 Full", family: "v4" },
  "nai-diffusion-4-curated-preview": { label: "V4 Curated", family: "v4" },
  "nai-diffusion-3": { label: "Anime V3", family: "v3" },
  "nai-diffusion-furry-3": { label: "Furry V3", family: "v3" }
});

export function modelCapabilities(model = "nai-diffusion-5-full") {
  if (!Object.hasOwn(MODELS, model)) throw new Error("請選擇有效的模型。");
  const { family } = MODELS[model];
  return {
    vibe: family !== "v5", encodedVibes: family === "v4" || family === "v4.5",
    precise: family === "v4.5", variety: family !== "v5", decrisp: family === "v3",
    smea: family === "v3", legacyUc: family === "v4", numerical: family !== "v3",
    negativeNumerical: family === "v4.5" || family === "v5",
    varietySigma: family === "v4.5" ? 58 : 19
  };
}

export const NOISE_SCHEDULES = Object.freeze({
  karras: "Karras", exponential: "Exponential", polyexponential: "Polyexponential", native: "Native"
});

export const SAMPLERS = Object.freeze({
  k_euler_ancestral: "Euler Ancestral",
  k_euler: "Euler",
  k_dpmpp_2m: "DPM++ 2M",
  k_dpmpp_2s_ancestral: "DPM++ 2S Ancestral",
  k_dpmpp_sde: "DPM++ SDE",
  k_dpmpp_2m_sde: "DPM++ 2M SDE",
  ddim_v3: "DDIM"
});

export function availableSamplers(model) {
  return Object.keys(SAMPLERS).filter((sampler) => sampler !== "ddim_v3" || MODELS[model]?.family === "v3");
}

export function availableNoiseSchedules(model, sampler) {
  if (MODELS[model]?.family === "v5" || sampler === "ddim_v3") return ["karras"];
  return Object.keys(NOISE_SCHEDULES).filter((schedule) => schedule !== "native" || MODELS[model]?.family === "v3");
}

export const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  width: 832, height: 1216, seed: 114514, sampler: "k_euler_ancestral",
  steps: 28, guidance: 5.5, cfgRescale: 0.2,
  model: "nai-diffusion-5-full", noiseSchedule: "karras", varietyPlus: false,
  decrisp: false, smea: false, smeaDyn: false, autoSmea: false, legacyUc: false
});

export function normalizeGenerationSettings(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("生成設定格式不正確。");
  const values = Object.fromEntries(Object.entries(DEFAULT_GENERATION_SETTINGS)
    .map(([key, fallback]) => [key, settings[key] === undefined ? fallback : settings[key]]));
  modelCapabilities(values.model);
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(values[key]) || values[key] < 64 || values[key] > 2048 || values[key] % 64 !== 0) {
      throw new Error("寬、高必須為 64–2048 之間的 64 倍數。");
    }
  }
  if (!Number.isInteger(values.seed) || values.seed < 0 || values.seed > 4294967295) {
    throw new Error("Seed 必須為 0–4294967295 的整數。");
  }
  if (!availableSamplers(values.model).includes(values.sampler)) throw new Error("這個模型不支援所選的 Sampler。");
  if (!Object.hasOwn(NOISE_SCHEDULES, values.noiseSchedule)) throw new Error("請選擇有效的 Noise Schedule。");
  if (MODELS[values.model].family !== "v5" && values.sampler !== "ddim_v3" && !availableNoiseSchedules(values.model, values.sampler).includes(values.noiseSchedule)) {
    throw new Error("這個模型不支援所選的 Noise Schedule。");
  }
  for (const key of ["varietyPlus", "decrisp", "smea", "smeaDyn", "autoSmea", "legacyUc"]) {
    if (typeof values[key] !== "boolean") throw new Error("生成設定的開關格式不正確。");
  }
  if (!Number.isInteger(values.steps) || values.steps < 1 || values.steps > 50) throw new Error("Steps 必須為 1–50 的整數。");
  if (!Number.isFinite(values.guidance) || values.guidance < 0 || values.guidance > 20) throw new Error("Guidance 必須介於 0 和 20。");
  if (!Number.isFinite(values.cfgRescale) || values.cfgRescale < 0 || values.cfgRescale > 1) throw new Error("CFG Rescale 必須介於 0 和 1。");
  return values;
}

function correlationId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function normalizeImageDimensions(width, height) {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)) throw new Error("圖片尺寸不正確。");
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const fit = (value) => Math.max(64, Math.min(2048, Math.round(value * scale / 64) * 64));
  return { width: fit(width), height: fit(height) };
}

// Estimate only: coefficients/order checked against the referenced launcher.
// The server's final billing and remaining V5 usage allowance take precedence.
export function estimateNovelAiCost({ generationSettings = {}, image2Image = null, references = null, account = null, count = 5 } = {}) {
  const settings = normalizeGenerationSettings(generationSettings);
  if (!Number.isInteger(count) || count < 0) throw new Error("生成張數不正確。");
  const capabilities = modelCapabilities(settings.model);
  const area = Math.max(settings.width * settings.height, 65536);
  const smea = capabilities.smea && !image2Image && settings.sampler !== "ddim_v3"
    && (settings.autoSmea ? area >= 1024 * 1024 : settings.smea || settings.smeaDyn);
  const base = Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * settings.steps);
  const smeaCost = Math.ceil(base * (smea ? settings.smeaDyn ? 1.4 : 1.2 : 1));
  const strength = image2Image?.strength ?? 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("Strength 必須介於 0 和 1。");
  const basePerImage = Math.max(2, Math.ceil(smeaCost * (MODELS[settings.model].family === "v5" ? 1.5 : 1) * strength));
  const referencePerImage = capabilities.precise ? (references?.precise?.length || 0) * 5 : 0;
  const vibePerImage = capabilities.encodedVibes ? Math.max(0, (references?.vibes?.length || 0) - 4) * 2 : 0;
  const extraPerImage = referencePerImage + vibePerImage;
  const freeSize = settings.steps <= 28 && area <= 1024 * 1024;
  const v5 = MODELS[settings.model].family === "v5";
  const couldBeFree = freeSize && account?.isOpus !== false && (!v5 || account?.opusUsageExhausted !== true);
  const confirmedFree = couldBeFree && account?.isOpus === true && (!v5 || account.opusUsageExhausted === false);
  return {
    count, basePerImage, extraPerImage,
    min: (couldBeFree ? extraPerImage : basePerImage + extraPerImage) * count,
    max: (confirmedFree ? extraPerImage : basePerImage + extraPerImage) * count,
    unsupported: basePerImage > 140
  };
}

async function errorMessage(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `NovelAI 請求失敗 (${response.status})。`;
  try {
    const value = JSON.parse(text);
    return value.message || value.error || value.detail || text;
  } catch {
    return text;
  }
}

export function buildNovelAiPayload(prompt, negativePrompt, image2Image = null, generationSettings = {}, references = null) {
  const settings = normalizeGenerationSettings(generationSettings);
  const capabilities = modelCapabilities(settings.model);
  const parameters = {
    width: settings.width,
    height: settings.height,
    scale: settings.guidance,
    sampler: settings.sampler,
    steps: settings.steps,
    n_samples: 1,
    seed: settings.seed,
    ucPreset: settings.model === "nai-diffusion-3" ? 3 : settings.model === "nai-diffusion-furry-3" ? 2 : 4,
    qualityToggle: false,
    tag_hint_qt: 0,
    tag_hint_uc_preset: 0,
    uncond_scale: 1,
    dynamic_thresholding: capabilities.decrisp && settings.decrisp,
    sm: capabilities.smea && !image2Image && settings.sampler !== "ddim_v3"
      && (settings.autoSmea ? settings.width * settings.height >= 1024 * 1024 : settings.smea || settings.smeaDyn),
    sm_dyn: false,
    cfg_rescale: settings.cfgRescale,
    noise_schedule: MODELS[settings.model].family === "v5" ? "karras" : settings.noiseSchedule,
    skip_cfg_above_sigma: capabilities.variety && settings.varietyPlus
      ? capabilities.varietySigma * Math.sqrt(settings.width * settings.height / (832 * 1216)) : null,
    skip_cfg_below_sigma: 0,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    params_version: 4,
    image_format: "png",
    prompt,
    negative_prompt: negativePrompt,
    v4_prompt: {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: false,
      legacy_uc: false
    },
    v4_negative_prompt: {
      caption: { base_caption: negativePrompt, char_captions: [] },
      use_coords: false,
      use_order: false,
      legacy_uc: false
    }
  };
  parameters.sm_dyn = parameters.sm && settings.smeaDyn;
  if (MODELS[settings.model].family === "v3") {
    delete parameters.v4_prompt;
    delete parameters.v4_negative_prompt;
  } else if (capabilities.legacyUc) {
    parameters.v4_negative_prompt.legacy_uc = settings.legacyUc;
  }
  if (MODELS[settings.model].family !== "v5") {
    delete parameters.tag_hint_qt;
    delete parameters.tag_hint_uc_preset;
  }
  if (settings.sampler === "ddim_v3") delete parameters.noise_schedule;
  if (image2Image) {
    const image = String(image2Image.image || "").replace(/^data:image\/(?:png|jpeg|webp);base64,/iu, "");
    if (!image || image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(image)) {
      throw new Error("Image2Image 參考圖片資料不正確，請重新選擇圖片。");
    }
    const strength = image2Image.strength ?? 0.7;
    const noise = image2Image.noise ?? 0;
    if (![strength, noise].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error("Image2Image 的 Strength 與 Noise 必須介於 0 和 1。");
    }
    Object.assign(parameters, { image, strength, noise });
  }
  const vibes = references?.vibes || [];
  const precise = references?.precise || [];
  if (!Array.isArray(vibes) || !Array.isArray(precise)) throw new Error("參考工具資料格式不正確。");
  if (vibes.length && precise.length) throw new Error("Vibe Transfer 與 Precise Reference 不能同時使用。");
  if (vibes.length && !capabilities.vibe || precise.length && !capabilities.precise) throw new Error("目前模型不支援這個參考工具。");
  if (vibes.length > 16) throw new Error("Vibe Transfer 最多 16 張圖片。");
  for (const item of [...vibes, ...precise]) {
    if (!item.image || item.image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(item.image)) throw new Error("參考工具圖片／編碼資料不正確。");
    if (!Number.isFinite(item.strength) || item.strength < -1 || item.strength > 1) throw new Error("參考強度必須介於 -1 和 1。");
  }
  if (vibes.length) {
    parameters.reference_image_multiple = vibes.map((item) => item.image);
    parameters.reference_strength_multiple = vibes.map((item) => item.strength);
    if (capabilities.encodedVibes) {
      parameters.normalize_reference_strength_multiple = references.normalize !== false;
    } else {
      for (const item of vibes) if (!Number.isFinite(item.informationExtracted) || item.informationExtracted < 0 || item.informationExtracted > 1) throw new Error("Information Extracted 必須介於 0 和 1。");
      parameters.reference_information_extracted_multiple = vibes.map((item) => item.informationExtracted);
      parameters.uncond_per_vibe = true;
      parameters.wonky_vibe_correlation = true;
    }
  }
  if (precise.length) {
    for (const item of precise) {
      if (!["character", "style", "character&style"].includes(item.type)) throw new Error("請選擇有效的 Precise Reference 類型。");
      if (!Number.isFinite(item.fidelity) || item.fidelity < -1 || item.fidelity > 1) throw new Error("Fidelity 必須介於 -1 和 1。");
    }
    parameters.director_reference_images = precise.map((item) => item.image);
    parameters.director_reference_descriptions = precise.map((item) => ({ caption: { base_caption: item.type, char_captions: [] }, legacy_uc: false }));
    parameters.director_reference_information_extracted = precise.map(() => 1);
    parameters.director_reference_strength_values = precise.map((item) => item.strength);
    // NovelAI's UI maps Fidelity to the inverse secondary strength.
    parameters.director_reference_secondary_strength_values = precise.map((item) => 1 - item.fidelity);
  }
  return { action: image2Image ? "img2img" : "generate", input: prompt, model: settings.model, parameters };
}

export async function fetchNovelAiAnlas({ token, signal }) {
  const authorization = token?.trim().replace(/^Bearer\s+/iu, "").trim();
  if (!authorization) throw new Error("請先保存 NovelAI API Token。");
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), 15_000);
  const abort = () => controller.abort("cancelled");
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(ACCOUNT_API_URL, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${authorization}`, Accept: "application/json" }
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? "Token 無效或沒有查詢餘額的權限。" : `Anlas 查詢失敗（HTTP ${response.status}）。`);
    const data = await response.json().catch((error) => { throw new Error("NAI 餘額資料格式不正確。", { cause: error }); });
    const steps = data?.trainingStepsLeft;
    // Some older responses expose a single number instead of the balance object.
    const subscription = typeof steps === "number" ? steps : steps?.fixedTrainingStepsLeft ?? 0;
    const purchased = typeof steps === "number" ? 0 : steps?.purchasedTrainingSteps ?? 0;
    if (steps == null || (typeof steps !== "number" && steps.fixedTrainingStepsLeft == null && steps.purchasedTrainingSteps == null)
      || !Number.isSafeInteger(subscription) || subscription < 0 || !Number.isSafeInteger(purchased) || purchased < 0
      || !Number.isSafeInteger(subscription + purchased)) throw new Error("NAI 未回傳有效的 Anlas 餘額。");
    const privileged = [1, 2, 3, 4].includes(data.accountType);
    const active = privileged || (Number.isFinite(data.expiresAt) ? data.tier > 0 && data.expiresAt > Date.now() / 1000
      : typeof data.active === "boolean" ? data.active : null);
    const isOpus = [0, 1, 2, 3].includes(data.tier) ? data.tier === 3 ? active : false : null;
    const opusUsageExhausted = typeof data.usage?.isNegative === "boolean" ? data.usage.isNegative : null;
    return { total: subscription + purchased, subscription, purchased, account: { isOpus, opusUsageExhausted } };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(controller.signal.reason === "timeout" ? "Anlas 查詢逾時。" : "已取消 Anlas 查詢。", { cause: error });
    if (error instanceof TypeError) throw new Error("無法連線至 NAI 餘額 API，請檢查網路或瀏覽器限制。", { cause: error });
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function encodeNovelAiVibe({ token, model, image, informationExtracted = 1, signal }) {
  if (!token?.trim()) throw new Error("請先輸入 NovelAI API Token。");
  if (!modelCapabilities(model).encodedVibes) throw new Error("這個模型不需要 Vibe 編碼。");
  if (!image || !/^[A-Za-z0-9+/]+={0,2}$/u.test(image) || image.length % 4 !== 0) throw new Error("Vibe 圖片資料不正確。");
  if (!Number.isFinite(informationExtracted) || informationExtracted < 0 || informationExtracted > 1) throw new Error("Information Extracted 必須介於 0 和 1。");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort("cancelled");
  if (signal?.aborted) controller.abort("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${API_BASE_URL}/ai/encode-vibe`, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${token.trim().replace(/^Bearer\s+/iu, "")}`, "Content-Type": "application/json", "x-correlation-id": correlationId() },
      body: JSON.stringify({ model, image, information_extracted: informationExtracted })
    });
    if (!response.ok) throw new Error(`NovelAI ${response.status}: ${await errorMessage(response)}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("NovelAI 沒有回傳 Vibe 編碼。");
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(binary);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(controller.signal.reason === "timeout" ? "Vibe 編碼逾時。" : "已停止 Vibe 編碼。", { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("NovelAI 回傳的 ZIP 不完整。");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("目前瀏覽器不支援 ZIP 解壓縮。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractZipImages(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entries = view.getUint16(eocd + 10, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const images = [];
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("ZIP 目錄格式不正確。");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP 圖片資料格式不正確。");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (!data) throw new Error(`不支援 ZIP 壓縮方式 ${method}。`);
    if (/\.(?:png|webp|jpe?g)$/iu.test(name)) {
      const mimeType = /\.webp$/iu.test(name) ? "image/webp" : /\.jpe?g$/iu.test(name) ? "image/jpeg" : "image/png";
      images.push({ name, blob: new Blob([data], { type: mimeType }) });
    }
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  if (!images.length) throw new Error("NovelAI 沒有回傳可讀取的圖片。");
  return images;
}

export async function generateNovelAiImage({ token, prompt, negativePrompt = "", image2Image = null, generationSettings = {}, references = null, signal }) {
  if (!token?.trim()) throw new Error("請先輸入 NovelAI API Token。");
  if (!prompt?.trim()) throw new Error("Prompt 不可空白。");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort("cancelled");
  if (signal?.aborted) controller.abort("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${API_BASE_URL}/ai/generate-image`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token.trim().replace(/^Bearer\s+/iu, "")}`,
        "Content-Type": "application/json",
        "x-correlation-id": correlationId()
      },
      body: JSON.stringify(buildNovelAiPayload(prompt, negativePrompt, image2Image, generationSettings, references))
    });
    if (!response.ok) throw new Error(`NovelAI ${response.status}: ${await errorMessage(response)}`);
    const [image] = await extractZipImages(await response.arrayBuffer());
    return image;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason === "timeout" ? "NovelAI 請求逾時。" : "已停止生成。", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export const FIXED_SETTINGS = Object.freeze({
  model: "NAI Diffusion V5 Full",
  size: "832 × 1216",
  seed: 114514,
  sampler: "Euler Ancestral",
  steps: 28,
  guidance: 5.5,
  unconditionalScale: 1,
  cfgRescale: 0.2,
  deliberateEulerAncestralBug: false,
  preferBrownian: true,
  qualityTags: false,
  ucPreset: "None"
});
