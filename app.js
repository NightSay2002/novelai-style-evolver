import {
  makeInitialGenome,
  makeStartingArtists,
  parseArtistInput,
  parseStylePrompt,
  serializeGenome
} from "./src/evolution.js?v=13";
import { applyPreferenceVote, CANDIDATE_ROLES, comparisonContext, compatibleLearning, createLearning, generatePreferenceBatch, preferenceRanking, sameContext, seedArtistPreferences } from "./src/preference.js?v=4";
import { classifyStylePool, STYLE_LAYERS } from "./src/style-taxonomy.js?v=1";
import { availableNoiseSchedules, availableSamplers, buildNovelAiPayload, DEFAULT_GENERATION_SETTINGS, encodeNovelAiVibe, estimateNovelAiCost, fetchNovelAiAnlas, FIXED_SETTINGS, generateNovelAiImage, modelCapabilities, MODELS, NOISE_SCHEDULES, normalizeGenerationSettings, normalizeImageDimensions, SAMPLERS } from "./src/nai.js?v=10";
import { injectCandidateMetadata } from "./src/png-metadata.js?v=6";
import {
  clearExplorationData,
  deleteFavorite,
  FAVORITE_LIMIT,
  getFavorites,
  getImages,
  getImagesByBatch,
  getState,
  getSavePoint,
  restoreExplorationState,
  saveBatchSavePoint,
  saveFavorite,
  saveImage,
  setState,
  trimImages
} from "./src/storage.js?v=7";

const TOKEN_SESSION_KEY = "novelai_style_evolver_token_session";
const TOKEN_LOCAL_KEY = "novelai_style_evolver_token";
const REMEMBER_KEY = "novelai_style_evolver_remember";
const SETTINGS_KEY = "novelai_style_evolver_settings";
const STYLE_OVERRIDES_KEY = "novelai_style_evolver_style_overrides";
const MOTION_KEY = "novelai_style_evolver_reduce_motion";
const MUSIC_VOLUME_KEY = "novelai_style_evolver_music_volume";
const STATE_VERSION = 4;
const MIN_ARTIST_POST_COUNT = 50;
const DEFAULT_ARTIST_POST_COUNT = 150;

const elements = Object.fromEntries([
  "statusText", "tokenStatus", "tokenInput", "rememberToken", "saveTokenButton", "clearTokenButton",
  "anlasButton", "anlasBalance", "anlasWarning",
  "contentPrompt", "negativePrompt", "seedStylePrompt", "styleSearch", "styleLayerFilter",
  "image2ImageEnabled", "referenceFile", "referencePreview", "referenceInfo", "removeReferenceButton",
  "imageStrength", "imageNoise", "imageStrengthValue", "imageNoiseValue",
  "generationWidth", "generationHeight", "generationSeed", "generationSampler", "generationSteps",
  "generationGuidance", "generationCfgRescale", "generationSettingsStatus", "generationModel", "modelSettingsHint",
  "generationNoiseSchedule", "generationVarietyPlus", "generationDecrisp", "generationSmea", "generationSmeaDyn", "generationAutoSmea", "generationLegacyUc",
  "vibePanel", "precisePanel",
  "stylePoolList", "batchTitle", "progressText", "batchProgress", "candidateGrid", "baselinePreview", "baselineImage", "baselineHint", "customStartButton", "removeBaselineButton",
  "startingArtists", "artistThreshold", "artistThresholdStatus", "rankingBody", "rankingHint",
  "selectionSummary", "generationCost", "nextBatchCost", "stopButton", "ignoreBatchButton", "dislikeAllButton", "submitVoteButton", "generateButton",
  "resetButton", "libraryGrid", "imageDialog", "closeDialogButton", "dialogImage", "dialogPrompt", "previewPrevious", "previewNext", "previewPosition", "previewFavorite",
  "controlsDrawer", "drawerTitle", "libraryDrawer", "libraryTitle", "reduceMotion", "backgroundMusic", "musicButton", "musicVolume"
].map((id) => [id, document.getElementById(id)]));

let allArtists = [];
let artistPool = [];
let artistPostCount = DEFAULT_ARTIST_POST_COUNT;
let stylePool = [];
let categories = {};
let styleOverrides = {};
let objectUrls = new Map();
const currentImages = new Map();
const thumbnailCache = new Map();
let libraryUrls = [];
let libraryView = "history";
let libraryRenderVersion = 0;
let previewNavigation = null;
let previewRecord = null;
let previewUrl = null;
let favoriteIds = new Set();
let favoriteBusy = false;
let baselineUrl = null;
let baselineUrlId = null;
let state = {
  version: STATE_VERSION,
  batchNumber: 1,
  stats: {},
  learning: createLearning(),
  baseline: null,
  promotedId: null,
  parents: [],
  currentBatch: [],
  batchImage2Image: null,
  batchReferences: null,
  selectedIds: [],
  dislikedIds: [],
  votes: [],
  forceExplore: false,
  customArtists: [],
  customStart: null
};
let generating = false;
let submitting = false;
let initialized = false;
let image2Image = { enabled: false, blob: null, originalBlob: null, fileName: "", strength: 0.7, noise: 0 };
let generationSettings = { ...DEFAULT_GENERATION_SETTINGS };
let generationSettingsValid = true;
let referenceBusy = false;
let referenceTools = { vibes: { enabled: false, normalize: true, images: [] }, precise: { enabled: false, images: [] } };
let toolPreviewUrls = [];
let referencePreviewBlob = null;
let referencePreviewUrl = "";
let abortController = null;
let statusTimer = null;
let anlasController = null;
let anlasRefreshTimer = null;
let anlas = null;
const systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const formatStartingArtists = (artists = []) => artists.map((item) => `${item.tag},`).join("\n");

function reducedMotion() {
  return elements.reduceMotion.checked || systemMotion.matches;
}

function applyMotionPreference() {
  document.body.classList.toggle("reduce-motion", reducedMotion());
  if (reducedMotion()) {
    document.querySelectorAll(".card-enter").forEach((card) => card.classList.remove("card-enter"));
    document.getAnimations().forEach((animation) => animation.cancel());
  }
}

function clampMusicVolume(value) {
  const volume = Number(value);
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.18;
}

function updateMusicUi() {
  const button = elements.musicButton;
  const audio = elements.backgroundMusic;
  if (!button || !audio) return;
  const playing = !audio.paused && !audio.ended;
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "暫停背景音樂" : "播放背景音樂");
  button.title = playing ? "暫停背景音樂" : "播放背景音樂";
  button.classList.toggle("is-playing", playing);
  const label = button.querySelector(".music-label");
  if (label) label.textContent = playing ? "播放中" : "音樂";
}

function loadMusicSettings() {
  const volume = clampMusicVolume(localStorage.getItem(MUSIC_VOLUME_KEY) ?? 0.18);
  elements.musicVolume.value = String(volume);
  elements.backgroundMusic.volume = volume;
  updateMusicUi();
}

async function toggleMusic() {
  const audio = elements.backgroundMusic;
  if (!audio || elements.musicButton.disabled) return;
  if (!audio.paused && !audio.ended) {
    audio.pause();
    updateMusicUi();
    return;
  }
  try {
    await audio.play();
  } catch (error) {
    setStatus(error?.name === "NotAllowedError" ? "瀏覽器需要按一下音樂按鈕才能播放。" : "背景音樂無法播放，請確認音訊檔案。", true);
  }
  updateMusicUi();
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);
}

function setStatus(message, error = false) {
  window.clearTimeout(statusTimer);
  elements.statusText.textContent = message;
  elements.statusText.hidden = !message;
  elements.statusText.classList.toggle("is-error", error);
  if (message && !error) statusTimer = window.setTimeout(() => { elements.statusText.hidden = true; }, 5000);
}

function getToken() {
  return sessionStorage.getItem(TOKEN_SESSION_KEY) || localStorage.getItem(TOKEN_LOCAL_KEY) || "";
}

function refreshTokenStatus() {
  const ready = Boolean(getToken());
  elements.tokenStatus.textContent = ready ? "已設定" : "未設定";
  elements.tokenStatus.style.color = ready ? "#7ee3a2" : "";
}

function resetAnlas() {
  window.clearTimeout(anlasRefreshTimer);
  anlasRefreshTimer = null;
  anlasController?.abort();
  anlasController = null;
  anlas = null;
  elements.anlasBalance.textContent = "—";
  elements.anlasWarning.hidden = true;
  elements.anlasButton.classList.remove("is-error");
  elements.anlasButton.disabled = false;
  elements.anlasButton.setAttribute("aria-busy", "false");
  elements.anlasButton.setAttribute("aria-label", "設定 Token 以查詢 Anlas 餘額");
  elements.anlasButton.title = "保存 NovelAI Token 後顯示餘額；點擊開啟設定";
  if (initialized) updateControls();
}

async function refreshAnlas() {
  window.clearTimeout(anlasRefreshTimer);
  anlasRefreshTimer = null;
  const token = getToken();
  if (!token) { resetAnlas(); return; }
  anlasController?.abort();
  const controller = new AbortController();
  anlasController = controller;
  elements.anlasButton.disabled = true;
  elements.anlasButton.setAttribute("aria-busy", "true");
  elements.anlasButton.setAttribute("aria-label", "正在查詢 Anlas 餘額");
  if (!anlas) elements.anlasBalance.textContent = "…";
  try {
    const balance = await fetchNovelAiAnlas({ token, signal: controller.signal });
    if (controller !== anlasController || token !== getToken()) return;
    anlas = balance;
    const format = (value) => value.toLocaleString("en-US");
    elements.anlasBalance.textContent = format(balance.total);
    elements.anlasWarning.hidden = true;
    elements.anlasButton.classList.remove("is-error");
    elements.anlasButton.title = `訂閱 Anlas：${format(balance.subscription)}\n購買 Anlas：${format(balance.purchased)}\n更新於 ${new Date().toLocaleTimeString()}；點擊更新`;
    elements.anlasButton.setAttribute("aria-label", `Anlas 餘額 ${format(balance.total)}，點擊更新`);
  } catch (error) {
    if (controller !== anlasController || token !== getToken()) return;
    if (anlas) anlas = { ...anlas, account: null };
    elements.anlasBalance.textContent = anlas ? anlas.total.toLocaleString("en-US") : "—";
    elements.anlasWarning.hidden = false;
    elements.anlasButton.classList.add("is-error");
    elements.anlasButton.title = `${error.message}\n${anlas ? "目前數字為上次成功查詢的餘額，並非最新。" : "尚未取得餘額。"}點擊重試`;
    elements.anlasButton.setAttribute("aria-label", `${anlas ? "Anlas 顯示舊餘額" : "Anlas 無法取得餘額"}，點擊重試`);
  } finally {
    if (controller === anlasController) {
      anlasController = null;
      elements.anlasButton.disabled = false;
      elements.anlasButton.setAttribute("aria-busy", "false");
      updateControls();
    }
  }
}

function scheduleAnlasRefresh() {
  window.clearTimeout(anlasRefreshTimer);
  // Allow the billing update to settle; merge closely spaced completion events.
  anlasRefreshTimer = window.setTimeout(() => { void refreshAnlas(); }, 500);
}

function saveToken() {
  const token = elements.tokenInput.value.trim().replace(/^Bearer\s+/iu, "");
  if (!token) return setStatus("Token 不可空白。", true);
  sessionStorage.setItem(TOKEN_SESSION_KEY, token);
  localStorage.setItem(REMEMBER_KEY, String(elements.rememberToken.checked));
  if (elements.rememberToken.checked) localStorage.setItem(TOKEN_LOCAL_KEY, token);
  else localStorage.removeItem(TOKEN_LOCAL_KEY);
  elements.tokenInput.value = "";
  refreshTokenStatus();
  resetAnlas();
  void refreshAnlas();
  setStatus("Token 已保存到目前瀏覽器。 ");
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  localStorage.removeItem(TOKEN_LOCAL_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  elements.tokenInput.value = "";
  elements.rememberToken.checked = false;
  refreshTokenStatus();
  resetAnlas();
  setStatus("Token 已清除。 ");
}

function currentSettings() {
  return {
    contentPrompt: elements.contentPrompt.value.trim(),
    negativePrompt: elements.negativePrompt.value.trim(),
    seedStylePrompt: elements.seedStylePrompt.value.trim(),
    artistPostCount,
    generationSettings: { ...generationSettings }
  };
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings()));
}

function loadSettings() {
  elements.generationModel.innerHTML = Object.entries(MODELS).map(([value, model]) => `<option value="${value}">${model.label}</option>`).join("");
  elements.generationSampler.innerHTML = Object.entries(SAMPLERS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  elements.generationNoiseSchedule.innerHTML = Object.entries(NOISE_SCHEDULES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (typeof saved.contentPrompt === "string") elements.contentPrompt.value = saved.contentPrompt;
    if (typeof saved.negativePrompt === "string") elements.negativePrompt.value = saved.negativePrompt;
    if (typeof saved.seedStylePrompt === "string") elements.seedStylePrompt.value = saved.seedStylePrompt;
    if (Number.isSafeInteger(saved.artistPostCount) && saved.artistPostCount >= MIN_ARTIST_POST_COUNT) artistPostCount = saved.artistPostCount;
    if (saved.generationSettings && typeof saved.generationSettings === "object") {
      try { generationSettings = normalizeGenerationSettings(saved.generationSettings); }
      catch { generationSettings = { ...DEFAULT_GENERATION_SETTINGS }; }
    }
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
  elements.artistThreshold.value = String(artistPostCount);
  elements.rememberToken.checked = localStorage.getItem(REMEMBER_KEY) === "true";
  elements.reduceMotion.checked = localStorage.getItem(MOTION_KEY) === "true";
  applyMotionPreference();
  for (const [key, value] of Object.entries(generationSettings)) {
    const input = elements[`generation${key[0].toUpperCase()}${key.slice(1)}`];
    if (input.type === "checkbox") input.checked = value;
    else input.value = String(value);
  }
  renderModelSettings();
}

function updateArtistPool() {
  artistPool = allArtists.filter((item) => Number(item.postCount) >= artistPostCount);
  const customOnly = (state.customArtists || []).filter((item) => !artistPool.some((known) => known.tag.toLowerCase() === item.tag.toLowerCase())).length;
  elements.artistThresholdStatus.textContent = `目前門檻 ${artistPostCount.toLocaleString("en-US")}，共用池 ${artistPool.length.toLocaleString("en-US")} 位畫師${customOnly ? `；另有 ${customOnly} 位本次自選畫師` : ""}。最低 50，不設上限。`;
  elements.artistThresholdStatus.classList.toggle("is-error", !artistPool.length);
}

function explorationArtistPool() {
  const merged = new Map(artistPool.map((item) => [item.tag.toLowerCase(), item]));
  for (const item of state.customArtists || []) merged.set(item.tag.toLowerCase(), item);
  return [...merged.values()];
}

function saveArtistThreshold() {
  const value = Number(elements.artistThreshold.value);
  if (!Number.isSafeInteger(value) || value < MIN_ARTIST_POST_COUNT) {
    elements.artistThreshold.value = String(artistPostCount);
    setStatus("畫師作品數門檻必須是 50 或以上的整數。", true);
    return;
  }
  artistPostCount = value;
  updateArtistPool();
  saveSettings();
  setStatus(artistPool.length ? `畫師門檻已改為 ${value.toLocaleString("en-US")}，下一批生效。` : `門檻 ${value.toLocaleString("en-US")} 暫時找不到共用畫師；仍可使用自選畫師起點。`, !artistPool.length && !(state.customArtists || []).length);
}

function renderModelSettings() {
  const model = elements.generationModel.value;
  const capabilities = modelCapabilities(model);
  const samplers = availableSamplers(model);
  for (const option of elements.generationSampler.options) option.hidden = option.disabled = !samplers.includes(option.value);
  if (!samplers.includes(elements.generationSampler.value)) elements.generationSampler.value = DEFAULT_GENERATION_SETTINGS.sampler;
  const schedules = availableNoiseSchedules(model, elements.generationSampler.value);
  for (const option of elements.generationNoiseSchedule.options) option.hidden = option.disabled = !schedules.includes(option.value);
  if (!schedules.includes(elements.generationNoiseSchedule.value)) elements.generationNoiseSchedule.value = "karras";
  document.querySelectorAll("[data-capability]").forEach((label) => {
    label.hidden = !capabilities[label.dataset.capability];
    label.querySelector("input, select").disabled = label.hidden;
  });
  const smeaDisabled = !capabilities.smea || elements.generationSampler.value === "ddim_v3" || image2Image.enabled;
  for (const key of ["generationSmea", "generationSmeaDyn", "generationAutoSmea"]) elements[key].disabled = smeaDisabled;
  elements.generationNoiseSchedule.disabled ||= elements.generationSampler.value === "ddim_v3";
  elements.modelSettingsHint.hidden = MODELS[model].family === "v5";
  elements.modelSettingsHint.textContent = MODELS[model].family === "v3"
    ? "V3：系統基因轉成近似括號權重，負向詞移至 Negative Prompt；自填內容請使用括號語法。Image2Image／DDIM 不使用 SMEA。"
    : MODELS[model].family === "v4" ? "V4：系統負向風格詞移至 Negative Prompt；不支援負數權重。" : "V4.5：支援 Vibe Transfer 或 Precise Reference，兩者不能同時啟用。";
  renderReferenceTools();
}

function saveGenerationSettings() {
  renderModelSettings();
  try {
    const values = Object.fromEntries(Object.keys(DEFAULT_GENERATION_SETTINGS).map((key) => {
      const input = elements[`generation${key[0].toUpperCase()}${key.slice(1)}`];
      return [key, input.type === "checkbox" ? input.checked : input.tagName === "SELECT" ? input.value : input.valueAsNumber];
    }));
    const next = normalizeGenerationSettings(values);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...currentSettings(), generationSettings: next }));
    generationSettings = next;
    generationSettingsValid = true;
    elements.generationSettingsStatus.textContent = "已自動保存，下一批生效；本批與重試不變。";
    elements.generationSettingsStatus.classList.remove("is-error");
  } catch (error) {
    generationSettingsValid = false;
    elements.generationSettingsStatus.textContent = error.message || "無法保存生成設定。";
    elements.generationSettingsStatus.classList.add("is-error");
  }
  if (!state.currentBatch.length && !generating && !submitting) renderCandidates();
  else updateControls();
}

function renderImage2Image() {
  const hasImage = image2Image.blob instanceof Blob;
  if (referencePreviewBlob !== image2Image.blob) {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    referencePreviewBlob = image2Image.blob;
    referencePreviewUrl = hasImage ? URL.createObjectURL(image2Image.blob) : "";
    if (referencePreviewUrl) elements.referencePreview.src = referencePreviewUrl;
    else elements.referencePreview.removeAttribute("src");
  }
  elements.referencePreview.hidden = !hasImage;
  elements.referenceInfo.textContent = referenceBusy ? "正在處理並保存…"
    : hasImage ? `${image2Image.fileName} · ${image2Image.width || 832} × ${image2Image.height || 1216}${image2Image.enabled ? "" : " · 未啟用"}` : "尚未選擇參考圖";
  elements.image2ImageEnabled.checked = image2Image.enabled;
  elements.image2ImageEnabled.disabled = !hasImage || referenceBusy || !initialized;
  elements.referenceFile.disabled = referenceBusy || !initialized;
  elements.removeReferenceButton.hidden = !hasImage;
  elements.removeReferenceButton.disabled = referenceBusy || !initialized;
  for (const [name, value] of [["imageStrength", image2Image.strength], ["imageNoise", image2Image.noise]]) {
    elements[name].value = String(value);
    elements[`${name}Value`].value = value.toFixed(2);
    elements[name].disabled = !hasImage || referenceBusy || !initialized;
  }
}

async function prepareReferenceImage(file, size = DEFAULT_GENERATION_SETTINGS, background = "#ffffff") {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("參考圖只接受 PNG、JPEG 或 WebP。");
  }
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("參考圖不可空白，且必須小於或等於 20 MB。");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error("無法讀取參考圖片，請換一張有效的 PNG、JPEG 或 WebP。", { cause: error });
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("參考圖解析度過大，請先縮至 4,000 萬像素以下。");
    if (size === "image2image") size = normalizeImageDimensions(bitmap.width, bitmap.height);
    else if (size === "precise") {
      const ratio = bitmap.width / bitmap.height;
      size = ratio > 1.2 ? { width: 1536, height: 1024 } : ratio < 1 / 1.2 ? { width: 1024, height: 1536 } : { width: 1472, height: 1472 };
    } else if (size === "vibe") {
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      size = { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法處理參考圖片。");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("參考圖片轉換失敗。")), "image/png");
    });
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

async function saveImage2Image(changes = {}, file = null) {
  if (referenceBusy || !initialized) return;
  const previous = image2Image;
  referenceBusy = true;
  renderImage2Image();
  updateControls();
  try {
    if (file) changes = { ...changes, ...await prepareReferenceImage(file, "image2image"), originalBlob: file, fileName: file.name, enabled: true };
    const next = { ...previous, ...changes };
    if (![next.strength, next.noise].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error("Strength 與 Noise 必須介於 0 和 1。");
    }
    await setState("image2image", next);
    image2Image = next;
    if (file) {
      elements.generationWidth.value = String(next.width);
      elements.generationHeight.value = String(next.height);
      saveGenerationSettings();
    }
    setStatus(next.blob ? "Image2Image 已保存；修改於下一批生效。" : "參考圖片已移除；下一批使用文字生成。");
  } catch (error) {
    image2Image = previous;
    setStatus(error.message || "無法保存參考圖片。", true);
  } finally {
    referenceBusy = false;
    elements.referenceFile.value = "";
    renderImage2Image();
    renderModelSettings();
    updateControls();
  }
}

function referenceBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("無法讀取已保存的參考圖。"));
    reader.readAsDataURL(blob);
  });
}

function renderReferenceTools() {
  toolPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  toolPreviewUrls = [];
  const capabilities = modelCapabilities(elements.generationModel.value);
  for (const [kind, panel, supported, title] of [["vibes", elements.vibePanel, capabilities.vibe, "Vibe Transfer"], ["precise", elements.precisePanel, capabilities.precise, "Precise Reference"]]) {
    panel.hidden = !supported;
    if (!supported) continue;
    const tool = referenceTools[kind];
    const disabled = referenceBusy || !initialized;
    const active = tool.images.filter((item) => item.enabled);
    const unencoded = capabilities.encodedVibes && kind === "vibes" ? active.filter((item) => !item.encodings?.[`${elements.generationModel.value}:${item.informationExtracted}`]).length : 0;
    const headingId = `${kind}Enabled`;
    panel.innerHTML = `<label class="image2image-heading" for="${headingId}">${title}<span>選用 · 下一批生效</span><input id="${headingId}" data-tool-field="enabled" type="checkbox" ${tool.enabled ? "checked" : ""} ${disabled || !tool.images.length ? "disabled" : ""} /></label>
      <input type="file" data-tool-upload accept="image/png,image/jpeg,image/webp" multiple aria-label="${title} 參考圖片" ${disabled ? "disabled" : ""} />
      ${kind === "vibes" && capabilities.encodedVibes ? `<label class="reference-options"><input type="checkbox" data-tool-field="normalize" ${tool.normalize ? "checked" : ""} ${disabled ? "disabled" : ""} /> Normalize Reference Strengths</label><button type="button" class="secondary" data-tool-encode ${disabled || generating || submitting || !unencoded ? "disabled" : ""}>${!active.length ? "尚未選擇 Vibe" : unencoded ? `編碼 ${unencoded} 張 · ${unencoded * 2} Anlas` : "Vibe 編碼已就緒"}</button>` : ""}
      <div class="reference-tool-list">${tool.images.map((item, index) => {
        const url = URL.createObjectURL(item.blob);
        toolPreviewUrls.push(url);
        const secondField = kind === "vibes" ? "informationExtracted" : "fidelity";
        const secondLabel = kind === "vibes" ? "Information Extracted" : "Fidelity";
        return `<div class="reference-tool-item" data-reference-id="${escapeHtml(item.id)}"><div class="reference-image-row"><img class="reference-preview" src="${url}" alt="${title} 參考圖 ${index + 1}" /><div class="reference-image-controls"><p class="hint">${escapeHtml(item.fileName)}</p><label class="reference-options"><input type="checkbox" data-tool-field="enabled" ${item.enabled ? "checked" : ""} ${disabled ? "disabled" : ""} /> 使用這張</label><button type="button" class="ghost" data-tool-remove ${disabled ? "disabled" : ""}>移除</button></div></div>
        ${kind === "precise" ? `<label class="reference-options">類型<select data-tool-field="type" aria-label="Precise Reference 類型 ${index + 1}" ${disabled ? "disabled" : ""}>${[["character", "角色"], ["style", "畫風"], ["character&style", "角色＋畫風"]].map(([value, label]) => `<option value="${value}" ${value === item.type ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}
        <div class="reference-settings">${[["strength", "Strength", -1], [secondField, secondLabel, kind === "vibes" ? 0 : -1]].map(([field, label, min]) => `<div><label>${label}<output>${item[field].toFixed(2)}</output></label><input type="range" data-tool-field="${field}" min="${min}" max="1" step="0.01" value="${item[field]}" aria-label="${title} ${label} ${index + 1}" ${disabled ? "disabled" : ""} /></div>`).join("")}</div></div>`;
      }).join("")}</div>
      <p class="hint">${kind === "vibes" ? capabilities.encodedVibes
        ? "最多 16 張；首次編碼每張 2 Anlas，模型／Information Extracted 改變需新編碼；快取在本機。超過 4 張，每多一張每次生成另加 2 Anlas。"
        : "最多 16 張；V3 直接使用圖片，不需獨立編碼。"
        : "每張參考每次生成另加 5 Anlas（五張候選共 25 Anlas）；等比例補黑邊至官方尺寸。多個角色參考可能混合角色。"} 圖片與設定保存在本機；Vibe 與 Precise 互斥，切換模型不刪圖。</p>`;
  }
}

async function saveReferenceTool(kind, changes = {}, files = [], id = "") {
  if (referenceBusy || !initialized) return;
  referenceBusy = true;
  renderImage2Image();
  renderReferenceTools();
  updateControls();
  try {
    const next = structuredClone(referenceTools);
    const tool = next[kind];
    if (files.length) {
      if (kind === "vibes" && tool.images.length + files.length > 16) throw new Error("Vibe Transfer 最多 16 張圖片。");
      for (const file of files) tool.images.push({
        id: uid("reference"), fileName: file.name, enabled: true,
        blob: (await prepareReferenceImage(file, kind === "vibes" ? "vibe" : "precise", kind === "precise" ? "#000000" : "#ffffff")).blob,
        strength: kind === "vibes" ? 0.6 : 1, informationExtracted: 1, fidelity: 1, type: "style", encodings: {}
      });
      tool.enabled = true;
    } else if (id) {
      if (changes.remove) tool.images = tool.images.filter((item) => item.id !== id);
      else Object.assign(tool.images.find((item) => item.id === id), changes);
    } else Object.assign(tool, changes);
    if (!tool.images.length) tool.enabled = false;
    if (tool.enabled) next[kind === "vibes" ? "precise" : "vibes"].enabled = false;
    await setState("referenceTools", next);
    referenceTools = next;
    setStatus("參考工具已保存；下一批生效。");
  } catch (error) {
    setStatus(error.message || "無法保存參考工具。", true);
  } finally {
    referenceBusy = false;
    renderImage2Image();
    renderReferenceTools();
    updateControls();
  }
}

async function encodeVibes() {
  if (referenceBusy || generating || submitting || !initialized) return;
  const model = elements.generationModel.value;
  if (!modelCapabilities(model).encodedVibes) return;
  if (!getToken()) { openPanel("settings"); return setStatus("請先保存 NovelAI Token。", true); }
  const pending = referenceTools.vibes.images.filter((item) => item.enabled && !item.encodings?.[`${model}:${item.informationExtracted}`]);
  if (!pending.length) return;
  if (!window.confirm(`編碼 ${pending.length} 張 Vibe 需要 ${pending.length * 2} Anlas。模型或 Information Extracted 改變可能需重新編碼。繼續？`)) return;
  referenceBusy = true;
  renderImage2Image();
  renderReferenceTools();
  updateControls();
  try {
    for (const item of pending) {
      const encoding = await encodeNovelAiVibe({ token: getToken(), model, image: await referenceBase64(item.blob), informationExtracted: item.informationExtracted });
      // Save each successful paid encoding immediately, even if a later image fails.
      item.encodings ??= {};
      item.encodings[`${model}:${item.informationExtracted}`] = encoding;
      await setState("referenceTools", referenceTools);
    }
    setStatus("Vibe 編碼已保存，可開始生成。");
  } catch (error) {
    setStatus(error.message || "Vibe 編碼失敗。", true);
  } finally {
    referenceBusy = false;
    renderImage2Image();
    renderReferenceTools();
    updateControls();
    scheduleAnlasRefresh();
  }
}

async function snapshotReferenceTools(model, tools) {
  const capabilities = modelCapabilities(model);
  const snapshot = { vibes: [], precise: [], normalize: tools.vibes.normalize };
  for (const kind of ["vibes", "precise"]) {
    if (!(kind === "vibes" ? capabilities.vibe : capabilities.precise) || !tools[kind].enabled) continue;
    for (const item of tools[kind].images.filter((value) => value.enabled)) {
      const image = kind === "vibes" && capabilities.encodedVibes ? item.encodings?.[`${model}:${item.informationExtracted}`] : await referenceBase64(item.blob);
      if (!image) throw new Error("Vibe 尚未以目前模型與 Information Extracted 編碼，請到內容 Prompt 按編碼。");
      snapshot[kind].push({ image, fileName: item.fileName, strength: item.strength, informationExtracted: item.informationExtracted, fidelity: item.fidelity, type: item.type });
    }
  }
  return snapshot.vibes.length || snapshot.precise.length ? snapshot : null;
}

async function loadJson(path, fallbackPath = "") {
  let response = await fetch(path, { cache: "no-store" });
  if (!response.ok && fallbackPath) response = await fetch(fallbackPath, { cache: "no-store" });
  if (!response.ok) throw new Error(`無法載入 ${path}。`);
  return response.json();
}

function candidateRecord(genome, index, settings, reference, references, savePointId) {
  const id = uid("candidate");
  const batchId = `batch_${state.batchNumber}`;
  const capabilities = modelCapabilities(settings.generationSettings.model);
  const prompt = serializeGenome(genome, settings.contentPrompt, capabilities);
  const negativePrompt = capabilities.negativeNumerical ? settings.negativePrompt
    : serializeGenome(genome, settings.negativePrompt, { ...capabilities, negative: true });
  const request = buildNovelAiPayload(prompt, negativePrompt, reference, settings.generationSettings, references);
  // Keep the reference once in batch state, not in every history record or downloaded PNG.
  delete request.parameters.image;
  delete request.parameters.reference_image_multiple;
  delete request.parameters.director_reference_images;
  return {
    id,
    savePointId,
    batchId,
    index,
    createdAt: new Date().toISOString(),
    status: "pending",
    error: "",
    genome: { ...genome, id },
    prompt,
    negativePrompt,
    generationSettings: { ...settings.generationSettings },
    fixedSettings: {
      ...FIXED_SETTINGS,
      ...settings.generationSettings,
      model: `NAI Diffusion ${MODELS[settings.generationSettings.model].label}`,
      size: `${settings.generationSettings.width} × ${settings.generationSettings.height}`,
      sampler: SAMPLERS[settings.generationSettings.sampler],
      noiseSchedule: request.parameters.noise_schedule || null,
      varietyPlus: request.parameters.skip_cfg_above_sigma !== null,
      decrisp: request.parameters.dynamic_thresholding,
      smea: request.parameters.sm, smeaDyn: request.parameters.sm_dyn,
      legacyUc: request.parameters.v4_negative_prompt?.legacy_uc || false
    },
    request,
    image2Image: reference ? { fileName: reference.fileName, strength: reference.strength, noise: reference.noise } : null,
    referenceTools: references ? {
      normalize: references.normalize,
      vibes: references.vibes.map(({ image, ...details }) => details),
      precise: references.precise.map(({ image, ...details }) => details)
    } : null
  };
}

async function persistState() {
  await setState("active", state);
}

function releaseCandidateUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  currentImages.clear();
}

async function thumbnailFor(record, maxEdge) {
  const key = `${record.id}:${record.createdAt || ""}:${record.blob.size}:${record.blob.type}:${maxEdge}`;
  const cached = thumbnailCache.get(key);
  if (cached) {
    thumbnailCache.delete(key);
    thumbnailCache.set(key, cached);
    return cached;
  }
  const pending = (async () => {
    let bitmap;
    let canvas;
    try {
      bitmap = await createImageBitmap(record.blob);
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("瀏覽器無法處理縮圖。");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("縮圖轉換失敗。")), "image/webp", 0.7);
      });
    } catch (error) {
      console.warn("無法製作縮圖，暫時使用原圖：", error.message);
      return record.blob;
    } finally {
      bitmap?.close();
      if (canvas) canvas.width = canvas.height = 1;
    }
  })();
  thumbnailCache.set(key, pending);
  // Bound encoded thumbnails; full-resolution bitmaps are always released.
  while (thumbnailCache.size > 100) thumbnailCache.delete(thumbnailCache.keys().next().value);
  return pending;
}

async function attachCurrentImages() {
  releaseCandidateUrls();
  if (!state.currentBatch.length) return;
  const images = await getImagesByBatch(state.currentBatch[0].batchId);
  const ids = new Set(state.currentBatch.map((item) => item.id));
  for (const image of images.filter((item) => ids.has(item.id))) {
    currentImages.set(image.id, image);
    objectUrls.set(image.id, URL.createObjectURL(await thumbnailFor(image, 640)));
  }
}

function makeCard(candidate, index, animate) {
  const card = document.createElement("article");
  card.className = `candidate${animate && !reducedMotion() ? " card-enter" : ""}`;
  card.dataset.id = candidate?.id || `empty-${index}`;
  card.style.setProperty("--card-index", index);
  card.innerHTML = `<button type="button" class="card-select" data-action="select" aria-label="選取候選 ${index + 1}" aria-pressed="false" title="點框內選取／取消；點圖片放大" disabled></button>
    <div class="card-crown" aria-hidden="true"><span>${["I", "II", "III", "IV", "V"][index]}</span><span class="card-feedback" hidden>不喜歡</span></div>
    <div class="card-visual"><div class="card-flipper">
    <div class="card-back"><span class="card-corner">${String(index + 1).padStart(2, "0")}</span><div class="card-seal">${icon("spark")}</div><span class="card-back-status">等待抽取</span></div>
    <button type="button" class="card-front" data-action="preview" aria-label="放大候選 ${index + 1}" disabled tabindex="-1"><img alt="候選 ${index + 1}" decoding="async" /></button>
    </div></div>
    <div class="candidate-body">
      <div class="candidate-title"><span class="candidate-name">${icon("spark")}候選 ${String(index + 1).padStart(2, "0")}</span><span class="artist-count"></span></div>
      <div class="candidate-strategy"><span class="candidate-role"></span><button type="button" class="promote-button" data-action="promote" aria-pressed="false" disabled>設為目前最佳</button></div>
      <div class="candidate-actions">
        <button type="button" class="prompt-button" data-action="details" disabled aria-label="候選 ${index + 1} 的完整 Prompt">Prompt ↗</button>
        <button type="button" class="retry-button" data-action="retry" hidden>重試</button>
        <button type="button" class="retry-button" data-action="image-retry" hidden>重載圖片</button>
        <button type="button" class="icon-button like-button" data-action="like" title="讚好 · 與點邊框選取相同" aria-label="讚好候選 ${index + 1}" aria-pressed="false" disabled>${icon("like")}</button>
        <button type="button" class="icon-button dislike-button" data-action="dislike" title="不喜歡 · −3；有讚好時建立較強比較" aria-label="不喜歡候選 ${index + 1}" aria-pressed="false" disabled>${icon("dislike")}</button>
        <button type="button" class="icon-button favorite-button" data-action="favorite" title="收藏 · 保存儲存點，不影響評分" aria-label="收藏候選 ${index + 1}" aria-pressed="false" disabled>${icon("star")}</button>
        <button type="button" class="icon-button" data-action="download" title="下載" aria-label="下載候選 ${index + 1}" disabled>${icon("download")}</button>
      </div>
    </div>`;
  card.addEventListener("animationend", (event) => {
    if (event.target === card) card.classList.remove("card-enter");
  });
  const image = card.querySelector("img");
  image.addEventListener("load", () => {
    card.classList.add("is-revealed");
    delete card.dataset.imageError;
    card.querySelector(".card-back").setAttribute("aria-hidden", "true");
    card.querySelector('[data-action="preview"]').removeAttribute("tabindex");
    card.querySelector('[data-action="image-retry"]').hidden = true;
  });
  image.addEventListener("error", () => {
    card.classList.remove("is-revealed");
    card.dataset.imageError = "true";
    card.querySelector(".card-back").removeAttribute("aria-hidden");
    card.querySelector(".card-back-status").textContent = "圖片顯示失敗，請重載圖片";
    card.querySelector('[data-action="image-retry"]').hidden = false;
  });
  return card;
}

function renderCandidates({ animate = false } = {}) {
  const size = state.currentBatch[0]?.generationSettings || state.currentBatch[0]?.request?.parameters || generationSettings;
  elements.candidateGrid.style.setProperty("--card-aspect-ratio", `${size.width} / ${size.height}`);
  elements.candidateGrid.style.setProperty("--card-grid-scale", String(5 * size.width / size.height));
  elements.candidateGrid.dataset.shape = size.width > size.height ? "landscape" : size.width === size.height ? "square" : "portrait";
  elements.batchTitle.textContent = `第 ${state.batchNumber} 批`;
  const successCount = state.currentBatch.filter((item) => item.status === "success").length;
  const selected = new Set(state.selectedIds);
  const disliked = new Set(state.dislikedIds);
  elements.progressText.textContent = `${successCount} / 5`;
  elements.batchProgress.value = successCount;
  const candidates = state.currentBatch.length ? state.currentBatch : Array(5).fill(null);
  const ids = candidates.map((candidate, index) => candidate?.id || `empty-${index}`);
  const oldCards = [...elements.candidateGrid.children];
  if (oldCards.length !== ids.length || oldCards.some((card, index) => card.dataset.id !== ids[index])) {
    elements.candidateGrid.replaceChildren(...candidates.map((candidate, index) => makeCard(candidate, index, animate)));
    elements.candidateGrid.scrollLeft = 0;
  }
  candidates.forEach((candidate, index) => {
    const card = elements.candidateGrid.children[index];
    if (!candidate) {
      card.querySelector(".artist-count").textContent = "未知畫風";
      return;
    }
    const success = candidate.status === "success";
    card.classList.toggle("selected", selected.has(candidate.id));
    card.classList.toggle("is-disliked", disliked.has(candidate.id));
    card.querySelector(".card-feedback").hidden = !disliked.has(candidate.id);
    card.classList.toggle("is-loading", candidate.status === "loading");
    card.classList.toggle("has-error", candidate.status === "error");
    card.querySelector(".card-back-status").textContent = card.dataset.imageError ? "圖片顯示失敗，請重載圖片"
      : candidate.status === "loading" ? "正在描繪畫風…"
      : candidate.status === "error" ? candidate.error || "生成失敗"
        : success ? "圖片載入中…" : "等待生成";
    card.querySelector(".artist-count").textContent = `${candidate.genome.artists.length} 位畫師`;
    card.querySelector(".candidate-role").textContent = candidate.genome.mutation?.operation === "locked" ? "固定／候選不足"
      : candidate.genome.mutation?.operation === "grow" ? { weights: "調權增員", preferred: "高分增員", uncertain: "確認增員", unseen: "新畫師增員" }[candidate.genome.role]
        : candidate.genome.mutation?.operation === "explore" && candidate.genome.role !== "explore" ? "初始探索" : CANDIDATE_ROLES[candidate.genome.role] || "舊批次";
    const promoteButton = card.querySelector('[data-action="promote"]');
    const promoted = state.promotedId === candidate.id;
    promoteButton.textContent = promoted ? "提交時晉升 ✓" : sameContext(state.baseline, candidate) ? "比基準更好" : "設為目前最佳";
    promoteButton.title = state.baseline ? "提交後設為主要起點；普通讚好不會取代基準" : "可指定首次起點；未指定時採用第一張讚好的圖";
    promoteButton.setAttribute("aria-pressed", String(promoted));
    promoteButton.disabled = !success || generating || submitting;
    const selectButton = card.querySelector('[data-action="select"]');
    selectButton.setAttribute("aria-pressed", String(selected.has(candidate.id)));
    selectButton.setAttribute("aria-label", `${selected.has(candidate.id) ? "取消選取" : "選取"}候選 ${index + 1}`);
    selectButton.disabled = !success || generating || submitting;
    const likeButton = card.querySelector('[data-action="like"]');
    likeButton.setAttribute("aria-pressed", String(selected.has(candidate.id)));
    likeButton.setAttribute("aria-label", `${selected.has(candidate.id) ? "取消讚好" : "讚好"}候選 ${index + 1}`);
    likeButton.title = selected.has(candidate.id) ? "取消讚好" : "讚好 · 與點邊框選取相同";
    likeButton.disabled = selectButton.disabled;
    const dislikeButton = card.querySelector('[data-action="dislike"]');
    dislikeButton.setAttribute("aria-pressed", String(disliked.has(candidate.id)));
    dislikeButton.setAttribute("aria-label", `${disliked.has(candidate.id) ? "取消不喜歡" : "不喜歡"}候選 ${index + 1}`);
    dislikeButton.title = disliked.has(candidate.id) ? "取消不喜歡" : "不喜歡 · −3；有讚好時建立較強比較";
    dislikeButton.disabled = !success || generating || submitting;
    for (const action of ["favorite", "download", "preview", "details"]) {
      card.querySelector(`[data-action="${action}"]`).disabled = !success || submitting;
    }
    const favoriteButton = card.querySelector('[data-action="favorite"]');
    const favorited = favoriteIds.has(candidate.id);
    favoriteButton.classList.toggle("is-favorite", favorited);
    favoriteButton.setAttribute("aria-pressed", String(favorited));
    favoriteButton.setAttribute("aria-label", `${favorited ? "取消收藏" : "收藏"}候選 ${index + 1}`);
    favoriteButton.title = favorited ? "取消收藏 · 不影響評分" : favoriteIds.size >= FAVORITE_LIMIT ? "收藏已滿，請先取消其他收藏" : "收藏 · 保存儲存點，不影響評分";
    favoriteButton.disabled ||= favoriteBusy || (!favorited && favoriteIds.size >= FAVORITE_LIMIT);
    const retry = card.querySelector('[data-action="retry"]');
    retry.hidden = candidate.status !== "error";
    retry.disabled = generating || submitting;
    const image = card.querySelector("img");
    const url = objectUrls.get(candidate.id);
    if (url && image.getAttribute("src") !== url) image.src = url;
  });
  renderBaseline();
  if (elements.controlsDrawer.open && elements.controlsDrawer.dataset.panel === "ranking") renderRanking();
  updateControls();
}

function renderBaseline() {
  const record = state.baseline;
  const startingArtists = !record ? state.parents[0]?.artists || [] : [];
  const isCustomStart = !record && state.customStart?.id && state.parents[0]?.id === state.customStart.id;
  if (baselineUrlId !== record?.id) {
    if (baselineUrl) URL.revokeObjectURL(baselineUrl);
    baselineUrl = record?.blob ? URL.createObjectURL(record.thumbnailBlob || record.blob) : null;
    baselineUrlId = record?.id;
    if (baselineUrl) elements.baselineImage.src = baselineUrl;
    else elements.baselineImage.removeAttribute("src");
  }
  elements.baselinePreview.hidden = !baselineUrl;
  elements.removeBaselineButton.hidden = !record;
  elements.baselineHint.textContent = isCustomStart && startingArtists.length ? `自選起點 · ${startingArtists.map((item) => item.tag.replace(/^artist:/u, "")).slice(0, 2).join("、")}${startingArtists.length > 2 ? ` ＋${startingArtists.length - 2}` : ""}`
    : !record && startingArtists.length ? `未設圖片基準 · 沿用 ${startingArtists.length} 位畫師組合`
    : !record ? "尚未建立圖片基準。"
    : state.currentBatch.length && !sameContext(record, state.currentBatch[0]) ? "不同生成設定 · 僅供參考，不計勝負"
      : "保留此起點，直到你選出更好的圖。";
  elements.customStartButton.textContent = startingArtists.length || record ? "更換畫師起點" : "輸入畫師起點";
}

function renderRanking() {
  const ranking = preferenceRanking(state.learning);
  elements.rankingHint.textContent = ranking.length ? `已學習 ${state.learning.rounds} 輪有效比較。分數為相對偏好，不是勝率；待確認的畫師尚未被充分區分。`
    : "尚無可排名的比較。先讚好、比較基準，再提交；忽略不會產生勝負。";
  elements.rankingBody.innerHTML = ranking.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.tag.replace(/^artist:/u, ""))}</td><td>${item.score.toFixed(1)}</td><td>${item.rounds}</td><td>${item.evidence}</td></tr>`).join("");
}

function updateControls() {
  updatePreviewFavorite();
  const completed = state.currentBatch.length === 5 && state.currentBatch.every((item) => item.status === "success");
  const successCount = state.currentBatch.filter((item) => item.status === "success").length;
  const selectedCount = state.selectedIds.length;
  const dislikedCount = state.dislikedIds.length;
  const busy = generating || submitting || referenceBusy || !initialized;
  document.querySelector('[data-library="favorites"]').textContent = `收藏 ${favoriteIds.size} / ${FAVORITE_LIMIT}`;
  elements.libraryGrid.querySelectorAll("[data-restore-savepoint]").forEach((button) => { button.disabled = busy || favoriteBusy || !button.dataset.restoreSavepoint; });
  document.body.classList.toggle("is-generating", generating);
  document.body.classList.toggle("is-evaluating", completed && !busy);
  elements.selectionSummary.hidden = !state.currentBatch.length && !submitting;
  elements.selectionSummary.textContent = submitting ? "正在提交偏好…"
    : generating ? `已生成 ${successCount} / 5 張`
      : completed ? `已選 ${selectedCount} / 5 張${dislikedCount ? ` · 不喜歡 ${dislikedCount} 張` : " · 可多選"}` : `已完成 ${successCount} / 5 張`;
  elements.submitVoteButton.querySelector("span").textContent = dislikedCount ? "提交偏好 · 抽下一批" : selectedCount ? `提交 ${selectedCount} 張 · 抽下一批` : "選取後抽下一批";
  elements.submitVoteButton.disabled = !completed || (!selectedCount && !dislikedCount) || busy || !generationSettingsValid;
  elements.submitVoteButton.hidden = !completed;
  elements.dislikeAllButton.disabled = !completed || busy || !generationSettingsValid;
  elements.dislikeAllButton.hidden = !completed;
  const comparable = sameContext(state.baseline, state.currentBatch[0]);
  elements.dislikeAllButton.textContent = comparable ? "全部不喜歡 · 都不如基準" : "全部不喜歡";
  elements.dislikeAllButton.title = comparable ? "五張各 −3；學習目前最佳勝過本批五張，保留起點" : "五張各 −3；沒有同設定基準，不捏造勝負，保留起點";
  elements.ignoreBatchButton.disabled = !completed || busy || !generationSettingsValid;
  elements.ignoreBatchButton.hidden = !completed;
  elements.stopButton.disabled = !generating || abortController?.signal.aborted;
  elements.stopButton.hidden = !generating;
  elements.generateButton.disabled = busy || completed || (!state.currentBatch.length && !generationSettingsValid);
  elements.generateButton.hidden = completed || generating || submitting;
  elements.generateButton.querySelector("span").textContent = state.currentBatch.length ? `繼續生成 ${5 - successCount} 張` : "抽取 5 張畫風";
  for (const [button, costLabel, continuing] of [[elements.generateButton, elements.generationCost, Boolean(state.currentBatch.length)], [elements.submitVoteButton, elements.nextBatchCost, false]]) {
    costLabel.hidden = button.hidden;
    try {
      if (!continuing && !generationSettingsValid) throw new Error("請先修正生成設定。");
      const candidate = continuing ? state.currentBatch[0] : null;
      const references = continuing ? state.batchReferences : {
        vibes: referenceTools.vibes.enabled ? referenceTools.vibes.images.filter((item) => item.enabled) : [],
        precise: referenceTools.precise.enabled ? referenceTools.precise.images.filter((item) => item.enabled) : []
      };
      const cost = estimateNovelAiCost({
        generationSettings: candidate ? candidate.generationSettings || DEFAULT_GENERATION_SETTINGS : generationSettings,
        image2Image: continuing ? state.batchImage2Image : image2Image.enabled && image2Image.blob ? image2Image : null,
        references, account: anlas?.account, count: continuing ? 5 - successCount : 5
      });
      if (cost.unsupported) throw new Error("此設定可能超出 NAI 單張計費限制，費用需由 NAI 確認。");
      costLabel.textContent = `預估 ${cost.min === cost.max ? cost.max : `${cost.min}–${cost.max}`} Anlas`;
      costLabel.title = `${cost.count} 次單張生成的總費用預估；一般單張 ${cost.basePerImage}、參考附加費 ${cost.extraPerImage} Anlas。${cost.min !== cost.max ? "帳戶／V5 免費用量尚未確認，顯示可能範圍。" : ""}Vibe 編碼費另計；免費用量可能在途中耗盡，最終以 NAI 計費為準。`;
    } catch (error) {
      costLabel.textContent = "費用待確認";
      costLabel.title = error.message;
    }
  }
  elements.startingArtists.disabled = busy;
  elements.customStartButton.disabled = busy;
  elements.removeBaselineButton.disabled = busy;
  elements.artistThreshold.disabled = busy;
  elements.resetButton.disabled = busy;
  elements.saveTokenButton.disabled = busy;
  elements.clearTokenButton.disabled = busy;
  const encodeButton = elements.vibePanel.querySelector("[data-tool-encode]");
  if (encodeButton) encodeButton.disabled = busy || !referenceTools.vibes.images.some((item) => item.enabled && !item.encodings?.[`${elements.generationModel.value}:${item.informationExtracted}`]);
}

function findCandidate(id) {
  return state.currentBatch.find((item) => item.id === id);
}

function waitBetweenImages(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 500 + Math.random() * 1000);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function generateCandidate(candidate) {
  candidate.status = "loading";
  candidate.error = "";
  await persistState();
  renderCandidates();
  try {
    if (abortController.signal.aborted) throw new Error("已停止生成。");
    const image = await generateNovelAiImage({
      token: getToken(),
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      image2Image: state.batchImage2Image || null,
      generationSettings: candidate.generationSettings || DEFAULT_GENERATION_SETTINGS,
      references: state.batchReferences || null,
      signal: abortController.signal
    });
    candidate.status = "success";
    const record = { ...candidate, blob: image.blob, fileName: image.name || `${candidate.id}.png` };
    await saveImage(record);
    currentImages.set(candidate.id, record);
    const thumbnail = await thumbnailFor(record, 640);
    const previousUrl = objectUrls.get(candidate.id);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    objectUrls.set(candidate.id, URL.createObjectURL(thumbnail));
    if (elements.libraryDrawer.open) await renderLibrary();
  } catch (error) {
    candidate.status = abortController?.signal.aborted ? "pending" : "error";
    candidate.error = abortController?.signal.aborted ? "" : error.message || "生成失敗。";
    if (!abortController?.signal.aborted) setStatus(`候選 ${candidate.index + 1}：${candidate.error}`, true);
  }
  await persistState();
  renderCandidates();
  return candidate.status === "success";
}

async function prepareBatch() {
  const settings = currentSettings();
  const reference = structuredClone(image2Image);
  const tools = structuredClone(referenceTools);
  const point = {
    id: uid("savepoint"), version: STATE_VERSION, createdAt: new Date().toISOString(),
    batchNumber: state.batchNumber, stats: structuredClone(state.stats), votes: structuredClone(state.votes),
    learning: structuredClone(state.learning), baseline: structuredClone(state.baseline),
    customArtists: structuredClone(state.customArtists || []),
    customStart: structuredClone(state.customStart || null),
    settings, image2Image: reference, referenceTools: tools, styleOverrides: structuredClone(styleOverrides)
  };
  saveSettings();
  const batchReferences = await snapshotReferenceTools(settings.generationSettings.model, tools);
  const batchImage2Image = reference.enabled && reference.blob ? {
    image: await referenceBase64(settings.generationSettings.width === (reference.width || 832) && settings.generationSettings.height === (reference.height || 1216)
      ? reference.blob : (await prepareReferenceImage(reference.originalBlob || reference.blob, settings.generationSettings)).blob),
    fileName: reference.fileName,
    strength: reference.strength,
    noise: reference.noise
  } : null;
  const contextKey = await comparisonContext(settings, batchImage2Image, batchReferences);
  point.contextKey = contextKey;
  const recent = state.votes.slice(-50).flatMap((vote) => vote.candidates || []);
  const genomes = generatePreferenceBatch({
    batchNumber: state.batchNumber, parent: state.baseline?.genome || state.parents[0], artistPool: explorationArtistPool(),
    fixedStyleTerms: parseStylePrompt(settings.seedStylePrompt), learning: state.learning,
    excludedGenomes: recent.filter((item) => item.contextKey === contextKey).map((item) => item.genome)
  });
  const next = {
    ...state, batchReferences, batchImage2Image,
    currentBatch: genomes.map((genome, index) => ({ ...candidateRecord(genome, index, settings, batchImage2Image, batchReferences, point.id), contextKey })),
    selectedIds: [], dislikedIds: [], promotedId: null, forceExplore: false
  };
  await saveBatchSavePoint(point, next);
  state = next;
}

async function generateBatchImages() {
  if (generating || submitting || referenceBusy || !initialized) return;
  if (!state.currentBatch.length && !generationSettingsValid) {
    openPanel("settings");
    return setStatus("請先修正生成設定再抽下一批。", true);
  }
  if (!getToken()) {
    renderCandidates();
    openPanel("settings");
    elements.tokenInput.focus();
    return setStatus("請先保存 NovelAI Token。", true);
  }
  generating = true;
  abortController = new AbortController();
  updateControls();
  try {
    const newBatch = !state.currentBatch.length;
    if (newBatch) await prepareBatch();
    setStatus(`正在順序生成第 ${state.batchNumber} 批…`);
    renderCandidates({ animate: newBatch });
    const pendingCandidates = state.currentBatch.filter((candidate) => candidate.status !== "success");
    for (const [index, candidate] of pendingCandidates.entries()) {
      if (index > 0) await waitBetweenImages(abortController.signal);
      if (abortController.signal.aborted) break;
      const succeeded = await generateCandidate(candidate);
      if (!succeeded && /^NovelAI (?:401|403|429):/u.test(candidate.error)) break;
    }
    const completed = state.currentBatch.every((item) => item.status === "success");
    setStatus(completed ? "本批已完成，請選擇喜歡的候選。" : "本批尚未完成，可重試失敗項或繼續生成。", !completed);
  } catch (error) {
    setStatus(error.message || "無法準備這一批，請重試。", true);
  } finally {
    generating = false;
    abortController = null;
    renderCandidates();
    scheduleAnlasRefresh();
  }
}

async function retryCandidate(candidate) {
  if (generating || submitting || referenceBusy || !candidate) return;
  if (!getToken()) {
    openPanel("settings");
    return setStatus("請先保存 NovelAI Token。", true);
  }
  generating = true;
  abortController = new AbortController();
  renderCandidates();
  try {
    const success = await generateCandidate(candidate);
    if (success) setStatus(`候選 ${candidate.index + 1} 已完成。`);
  } catch (error) {
    setStatus(error.message || "重試失敗。", true);
  } finally {
    generating = false;
    abortController = null;
    renderCandidates();
    scheduleAnlasRefresh();
  }
}

async function gatherCards(selectedIds) {
  if (reducedMotion()) return;
  const grid = elements.candidateGrid.getBoundingClientRect();
  const animations = [...elements.candidateGrid.children].map((card, index) => {
    const selected = selectedIds.includes(card.dataset.id);
    const rect = card.getBoundingClientRect();
    const shift = grid.left + grid.width / 2 - rect.left - rect.width / 2;
    return card.animate([
      { transform: getComputedStyle(card).transform, opacity: 1 },
      { transform: selected ? `translate(${shift}px, 35px) scale(.84) rotate(${index - 2}deg)` : "translateY(25px) scale(.96)", opacity: 0 }
    ], { duration: selected ? 380 : 230, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
  });
  await Promise.allSettled(animations.map((animation) => animation.finished));
}

async function submitVote(selectedIds, dislikedIds, action = "vote") {
  const completed = state.currentBatch.length === 5 && state.currentBatch.every((item) => item.status === "success");
  if (!completed || generating || submitting || referenceBusy || !generationSettingsValid) return;
  submitting = true;
  renderCandidates();
  try {
    const promotedId = action === "vote" ? state.promotedId : null;
    if (promotedId && !selectedIds.includes(promotedId)) selectedIds = [...selectedIds, promotedId];
    const update = applyPreferenceVote(state.learning, state.currentBatch, selectedIds, dislikedIds, {
      baseline: state.baseline, promotedId, action, eventId: state.currentBatch[0].id
    });
    let baseline = state.baseline;
    // The first like supplies a starting reference, not a ranking among liked cards.
    // Once established, only an explicit promotion may replace the baseline.
    const startingId = promotedId || (!baseline && action === "vote" ? selectedIds.find((id) => findCandidate(id)?.status === "success") : null);
    if (startingId) {
      const record = currentImages.get(startingId) || (await getImages()).find((item) => item.id === startingId);
      if (!record?.blob) throw new Error("找不到起點圖片，偏好尚未提交，請重新載入。");
      baseline = { ...record, contextKey: findCandidate(startingId).contextKey, thumbnailBlob: await thumbnailFor(record, 160) };
    }
    const vote = {
      id: uid("vote"), batchNumber: state.batchNumber, batchId: state.currentBatch[0].batchId,
      selectedIds, dislikedIds, action, promotedId, candidateDeltas: update.candidateDeltas,
      comparisonCount: update.comparisonCount,
      candidates: state.currentBatch.map(({ id, genome, prompt, negativePrompt, contextKey }) => ({ id, genome, prompt, negativePrompt, contextKey })),
      createdAt: new Date().toISOString()
    };
    const next = { ...state, learning: update.learning, baseline,
      parents: baseline ? [structuredClone(baseline.genome)] : state.parents,
      votes: [...state.votes, vote], batchNumber: state.batchNumber + 1, currentBatch: [],
      batchImage2Image: null, batchReferences: null, selectedIds: [], dislikedIds: [], promotedId: null, forceExplore: false };
    // Commit before replacing memory. A failed write must be safe to retry.
    await setState("active", next);
    await gatherCards(selectedIds);
    state = next;
    releaseCandidateUrls();
  } catch (error) {
    submitting = false;
    renderCandidates();
    setStatus(error.message || "無法保存本批偏好。", true);
    return;
  }
  // Keep the gathered cards hidden until the next batch replaces them with animated cards.
  submitting = false;
  await generateBatchImages();
}

async function toggleFavorite(record) {
  if (favoriteBusy || submitting) return;
  favoriteBusy = true;
  renderCandidates();
  try {
    if (favoriteIds.has(record.id)) {
      const inHistory = (await getImages()).some((item) => item.id === record.id);
      await deleteFavorite(record.id);
      favoriteIds.delete(record.id);
      setStatus(inHistory ? "已取消收藏；歷史中的圖片不會刪除。" : state.baseline?.id === record.id ? "已取消收藏；目前最佳基準仍保留。" : "已取消收藏；這張圖片已離開歷史，此收藏無法復原。");
    } else {
      await saveFavorite(record);
      favoriteIds.add(record.id);
      setStatus(record.savePointId ? "已收藏圖片與完整儲存點。" : "已收藏舊圖片；此紀錄沒有完整儲存點。");
    }
  } catch (error) {
    setStatus(error.message || "無法更新收藏，請檢查本機儲存空間。", true);
  } finally {
    favoriteBusy = false;
    renderCandidates();
    await renderLibrary();
  }
}

async function restoreSavePoint(record) {
  if (generating || submitting || referenceBusy || favoriteBusy || !initialized) return;
  if (!record.savePointId) return setStatus("這張舊圖片沒有完整儲存點，無法精確還原分數與參考圖。", true);
  if (!window.confirm("載入儲存點會替換目前探索、分數、Prompt、生成設定與參考圖。本批未提交的選擇不會計分；歷史、收藏和 Token 保留。繼續？")) return;
  submitting = referenceBusy = true;
  renderCandidates();
  renderImage2Image();
  renderReferenceTools();
  const previousSettings = localStorage.getItem(SETTINGS_KEY);
  const previousOverrides = localStorage.getItem(STYLE_OVERRIDES_KEY);
  let settingsWritten = false;
  try {
    const point = await getSavePoint(record.savePointId);
    if (!point || point.version !== STATE_VERSION || !Number.isSafeInteger(point.batchNumber + 1) || point.batchNumber < 1 || !point.settings || !point.stats || !Array.isArray(point.votes) || !point.image2Image || !point.referenceTools || !point.styleOverrides || !Array.isArray(record.genome?.artists) || !Array.isArray(record.genome?.styleTerms)) {
      throw new Error("儲存點缺失或版本不相容，未更改目前探索。");
    }
    const settings = { ...point.settings, generationSettings: normalizeGenerationSettings(point.settings.generationSettings) };
    if (![settings.contentPrompt, settings.negativePrompt, settings.seedStylePrompt].every((value) => typeof value === "string") ||
      ![point.image2Image.strength, point.image2Image.noise].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
      point.image2Image.enabled && !(point.image2Image.blob instanceof Blob) ||
      ["vibes", "precise"].some((kind) => !Array.isArray(point.referenceTools[kind]?.images) || point.referenceTools[kind].images.some((item) => !(item.blob instanceof Blob)))) {
      throw new Error("儲存點內容不完整，未更改目前探索。");
    }
    const next = {
      version: STATE_VERSION, batchNumber: point.batchNumber + 1, stats: {},
      learning: compatibleLearning(point.learning) ? structuredClone(point.learning) : createLearning(),
      // "From here" explicitly chooses this saved image as the new baseline,
      // without inventing a win against the baseline in the saved snapshot.
      baseline: { ...record, thumbnailBlob: await thumbnailFor(record, 160) }, promotedId: null,
      parents: [structuredClone(record.genome)], votes: structuredClone(point.votes), forceExplore: false,
      customArtists: Array.isArray(point.customArtists) ? structuredClone(point.customArtists).slice(0, 6) : [],
      customStart: point.customStart?.artists?.length ? structuredClone(point.customStart) : null,
      currentBatch: [], selectedIds: [], dislikedIds: [], batchImage2Image: null, batchReferences: null
    };
    settingsWritten = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(STYLE_OVERRIDES_KEY, JSON.stringify(point.styleOverrides));
    await restoreExplorationState(next, point.image2Image, point.referenceTools);
    state = next;
    image2Image = structuredClone(point.image2Image);
    referenceTools = structuredClone(point.referenceTools);
    styleOverrides = structuredClone(point.styleOverrides);
    releaseCandidateUrls();
    loadSettings();
    updateArtistPool();
    elements.startingArtists.value = state.customStart ? formatStartingArtists(state.customStart.artists) : "";
    generationSettingsValid = true;
    elements.generationSettingsStatus.classList.remove("is-error");
    elements.generationSettingsStatus.textContent = "已還原儲存點設定，下一批生效。";
    renderStylePool();
    elements.imageDialog.close();
    elements.libraryDrawer.close();
    elements.controlsDrawer.close();
    setStatus(`已還原第 ${point.batchNumber} 批候選 ${record.index + 1} 的設定與學習，以此圖為基準；${compatibleLearning(point.learning) ? "按抽牌即可繼續。" : "舊儲存點沒有新版學習資料，已從中立開始。"}`);
  } catch (error) {
    if (settingsWritten) {
      for (const [key, value] of [[SETTINGS_KEY, previousSettings], [STYLE_OVERRIDES_KEY, previousOverrides]]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }
    setStatus(error.message || "儲存點還原失敗，目前探索未更改。", true);
  } finally {
    submitting = referenceBusy = false;
    renderImage2Image();
    renderModelSettings();
    renderCandidates();
    await renderLibrary();
  }
}

async function downloadCandidate(candidate) {
  const image = (await getImages()).find((item) => item.id === candidate.id);
  if (!image) return;
  await downloadRecord(image);
}

async function downloadRecord(record) {
  const blob = await injectCandidateMetadata(record.blob, record);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `novelai-style-${record.batchId}-${record.index + 1}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updatePreviewFavorite() {
  const favorited = previewRecord && favoriteIds.has(previewRecord.id);
  elements.previewFavorite.hidden = !previewRecord;
  elements.previewFavorite.disabled = !previewRecord || favoriteBusy || submitting || (!favorited && favoriteIds.size >= FAVORITE_LIMIT);
  elements.previewFavorite.classList.toggle("is-favorite", Boolean(favorited));
  elements.previewFavorite.setAttribute("aria-pressed", String(Boolean(favorited)));
  elements.previewFavorite.setAttribute("aria-label", favorited ? "取消收藏目前圖片" : "收藏目前圖片");
  elements.previewFavorite.title = favorited ? "取消收藏" : favoriteIds.size >= FAVORITE_LIMIT ? "收藏已達 50 張" : "收藏圖片與儲存點";
  elements.previewFavorite.querySelector("span").textContent = favorited ? "已收藏" : "收藏";
}

function showPreview(record, showDetails = false, navigation = null) {
  if (!record.blob) return;
  const nextUrl = URL.createObjectURL(record.blob);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = nextUrl;
  previewNavigation = navigation;
  previewRecord = record;
  updatePreviewFavorite();
  elements.dialogImage.src = nextUrl;
  elements.dialogImage.alt = `${navigation?.source || "本批"} · ${record.batchId || ""} 候選 ${record.index + 1}`;
  elements.dialogPrompt.textContent = `${record.prompt}\n\nNegative Prompt:\n${record.negativePrompt || "(空白)"}`;
  elements.imageDialog.querySelector("details").open = showDetails;
  elements.previewPrevious.hidden = elements.previewNext.hidden = elements.previewPosition.hidden = !navigation;
  elements.previewPrevious.disabled = !navigation || navigation.index <= 0;
  elements.previewNext.disabled = !navigation || navigation.index >= navigation.records.length - 1;
  elements.previewPosition.textContent = navigation ? `${navigation.source} · ${navigation.index + 1} / ${navigation.records.length}` : "";
  if (!elements.imageDialog.open) elements.imageDialog.showModal();
}

function navigatePreview(direction) {
  if (!elements.imageDialog.open || !previewNavigation) return;
  const index = previewNavigation.index + direction;
  if (index < 0 || index >= previewNavigation.records.length) return;
  showPreview(previewNavigation.records[index], elements.imageDialog.querySelector("details").open,
    { ...previewNavigation, index });
}

async function handleCandidateAction(event) {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const card = event.target.closest(".candidate");
  const candidate = findCandidate(card?.dataset.id);
  if (!action || !candidate) return;
  if (action === "select" || action === "like" || action === "dislike" || action === "promote") {
    if (generating || submitting || candidate.status !== "success") return;
    const selected = new Set(state.selectedIds);
    const disliked = new Set(state.dislikedIds);
    if (action === "promote") {
      state.promotedId = state.promotedId === candidate.id ? null : candidate.id;
      if (state.promotedId) selected.add(candidate.id);
      disliked.delete(candidate.id);
    } else if (action === "dislike") {
      disliked.has(candidate.id) ? disliked.delete(candidate.id) : disliked.add(candidate.id);
      selected.delete(candidate.id);
    } else {
      selected.has(candidate.id) ? selected.delete(candidate.id) : selected.add(candidate.id);
      disliked.delete(candidate.id);
    }
    state.selectedIds = [...selected];
    state.dislikedIds = [...disliked];
    if (!selected.has(state.promotedId)) state.promotedId = null;
    renderCandidates();
    try { await persistState(); } catch { setStatus("偏好標記無法保存，請檢查瀏覽器儲存空間。", true); }
  } else if (submitting) return;
  else if (action === "retry") await retryCandidate(candidate);
  else if (action === "favorite") {
    const record = (await getImages()).find((item) => item.id === candidate.id) || (await getFavorites()).find((item) => item.id === candidate.id);
    if (record) await toggleFavorite(record);
  }
  else if (action === "download") await downloadCandidate(candidate);
  else if (action === "preview") showPreview(currentImages.get(candidate.id) || candidate);
  else if (action === "details") showPreview(currentImages.get(candidate.id) || candidate, true);
  else if (action === "image-retry") card.querySelector("img").src = objectUrls.get(candidate.id);
}

function releaseLibraryUrls() {
  libraryUrls.forEach((url) => URL.revokeObjectURL(url));
  libraryUrls = [];
}

function expandLibraryItem(item = null) {
  if (!elements.libraryDrawer.open) return;
  const cards = [...elements.libraryGrid.querySelectorAll(".library-item")];
  if (!cards.length) { elements.libraryGrid.style.removeProperty("grid-template-rows"); return; }
  const columns = getComputedStyle(elements.libraryGrid).gridTemplateColumns.split(" ").length;
  const rows = Math.ceil(cards.length / columns);
  const expandedRow = item ? Math.floor(cards.indexOf(item) / columns) : -1;
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const heights = Array.from({ length: rows }, (_, row) => {
    const height = Math.max(...cards.slice(row * columns, (row + 1) * columns).map((card) => card.getBoundingClientRect().height));
    return `${!canHover || row === expandedRow || row === rows - 1 ? height : Math.min(64, height)}px`;
  });
  cards.forEach((card) => card.classList.toggle("is-library-expanded", card === item));
  elements.libraryGrid.style.gridTemplateRows = heights.join(" ");
}

async function renderLibrary() {
  if (!elements.libraryDrawer.open) return;
  const version = ++libraryRenderVersion;
  const favorites = await getFavorites();
  const values = libraryView === "favorites" ? favorites : await getImages();
  if (version !== libraryRenderVersion || !elements.libraryDrawer.open) return;
  favoriteIds = new Set(favorites.map((item) => item.id));
  updateControls();
  const thumbnails = [];
  // Decode one original at a time, and abandon stale renders before creating URLs.
  for (const item of values) {
    thumbnails.push(await thumbnailFor(item, 320));
    if (version !== libraryRenderVersion || !elements.libraryDrawer.open) return;
  }
  releaseLibraryUrls();
  if (!values.length) {
    elements.libraryGrid.style.removeProperty("grid-template-rows");
    elements.libraryGrid.innerHTML = `<p class="empty-library">${libraryView === "favorites" ? "還沒有收藏。" : "還沒有生成記錄。"}</p>`;
    return;
  }
  elements.libraryGrid.innerHTML = values.map((item, index) => {
    const size = item.generationSettings || item.request?.parameters || DEFAULT_GENERATION_SETTINGS;
    const url = URL.createObjectURL(thumbnails[index]);
    libraryUrls.push(url);
    const favorited = favoriteIds.has(item.id);
    return `<article class="library-item" data-library-id="${escapeHtml(item.id)}" data-library-index="${index}" style="aspect-ratio: ${Number(size.width)} / ${Number(size.height)}"><button type="button" class="library-preview" aria-label="預覽 ${escapeHtml(item.batchId)} 候選 ${item.index + 1}"><img src="${url}" alt="${escapeHtml(item.batchId)} 候選 ${item.index + 1}" loading="lazy" decoding="async" /></button><div class="library-actions"><button type="button" class="favorite-button${favorited ? " is-favorite" : ""}" data-toggle-favorite="${escapeHtml(item.id)}" aria-pressed="${favorited}" aria-label="${favorited ? "取消收藏" : "收藏"} ${escapeHtml(item.batchId)} 候選 ${item.index + 1}" title="${favorited ? "取消收藏" : "收藏圖片與儲存點"}" ${favoriteBusy || submitting || (!favorited && favoriteIds.size >= FAVORITE_LIMIT) ? "disabled" : ""}>${icon("star")}</button><button type="button" data-download-library="${escapeHtml(item.id)}">下載</button>${libraryView === "favorites" ? `<button type="button" class="savepoint-button" data-restore-savepoint="${escapeHtml(item.savePointId || "")}" title="${item.savePointId ? "還原當時的分數、Prompt、設定與全部參考圖" : "舊紀錄沒有完整快照，不能精確還原"}" ${!item.savePointId || generating || submitting || referenceBusy || favoriteBusy ? "disabled" : ""}>${item.savePointId ? "從此繼續" : "舊紀錄 · 無儲存點"}</button>` : ""}</div></article>`;
  }).join("");
  expandLibraryItem();
  elements.libraryGrid.querySelectorAll(".library-item").forEach((item) => {
    item.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") expandLibraryItem(item); });
    item.addEventListener("pointerleave", () => {
      if (!item.contains(document.activeElement)) expandLibraryItem(document.activeElement?.closest(".library-item"));
    });
  });
  elements.libraryGrid.querySelectorAll(".library-preview").forEach((button, index) => {
    const source = libraryView === "favorites" ? "收藏" : "歷史";
    button.addEventListener("click", () => showPreview(values[index], false, { records: values, index, source }));
  });
  elements.libraryGrid.querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.addEventListener("click", async () => {
      const record = values.find((item) => item.id === button.dataset.toggleFavorite);
      if (record) await toggleFavorite(record);
    });
  });
  elements.libraryGrid.querySelectorAll("[data-restore-savepoint]").forEach((button, index) => {
    button.addEventListener("click", () => restoreSavePoint(values[index]));
  });
  elements.libraryGrid.querySelectorAll("[data-download-library]").forEach((button) => {
    button.addEventListener("click", async () => {
      const record = values.find((item) => item.id === button.dataset.downloadLibrary);
      if (record) await downloadRecord(record);
    });
  });
  renderCandidates();
}

function renderStylePool() {
  const query = elements.styleSearch.value.trim().toLowerCase();
  const layer = elements.styleLayerFilter.value;
  const items = stylePool.map((item) => ({ ...item, ...(styleOverrides[item.tag] || {}) }))
    .filter((item) => !query || item.tag.includes(query))
    .filter((item) => !layer || item.layer === layer)
    .slice(0, 200);
  elements.stylePoolList.innerHTML = items.map((item) => `<div class="style-row" data-tag="${escapeHtml(item.tag)}">
    <input type="checkbox" aria-label="啟用 ${escapeHtml(item.tag)}" data-style-field="enabled" ${item.enabled !== false ? "checked" : ""} />
    <span title="${escapeHtml([STYLE_LAYERS[item.layer], item.facet, item.reason, item.source].filter(Boolean).join(" · "))}">${escapeHtml(item.tag)}<small class="style-layer-label">${escapeHtml(STYLE_LAYERS[item.layer] || "附加控制")}</small></span>
    <select aria-label="${escapeHtml(item.tag)} 的方向" data-style-field="polarity"><option value="positive" ${item.polarity !== "negative" ? "selected" : ""}>正向</option><option value="negative" ${item.polarity === "negative" ? "selected" : ""}>負向</option></select>
    <span><input type="checkbox" aria-label="固定 ${escapeHtml(item.tag)}" data-style-field="pinned" ${item.pinned ? "checked" : ""} title="固定" /> 固</span>
  </div>`).join("");
}

function updateStyleOverride(event) {
  const field = event.target.dataset.styleField;
  const row = event.target.closest("[data-tag]");
  if (!field || !row) return;
  const tag = row.dataset.tag;
  const current = styleOverrides[tag] || {};
  current[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  styleOverrides[tag] = current;
  localStorage.setItem(STYLE_OVERRIDES_KEY, JSON.stringify(styleOverrides));
}

async function applyStartingArtists() {
  if (generating || submitting || referenceBusy || !initialized) return;
  try {
    const tags = parseArtistInput(elements.startingArtists.value);
    const previousTags = (state.customStart?.artists || []).map((item) => item.tag);
    if (tags.join("\n") === previousTags.join("\n")) {
      elements.startingArtists.value = formatStartingArtists(state.customStart?.artists);
      return;
    }
    if (!tags.length) {
      const next = { ...state, customArtists: [], customStart: null,
        parents: state.baseline ? state.parents : [makeInitialGenome(parseStylePrompt(elements.seedStylePrompt.value))] };
      await setState("active", next);
      state = next;
      updateArtistPool();
      renderCandidates();
      setStatus("已移除自選畫師起點；現有圖片與偏好紀錄保留。");
      return;
    }
    const artists = makeStartingArtists(elements.startingArtists.value);
    const known = new Map(allArtists.map((item) => [item.tag.toLowerCase(), item]));
    const customArtists = artists.map((item) => ({
      ...(known.get(item.tag.toLowerCase()) || { tag: item.tag, postCount: null }),
      custom: true
    }));
    const genome = makeInitialGenome(parseStylePrompt(elements.seedStylePrompt.value));
    genome.id = uid("custom_start");
    genome.artists = artists;
    const unseededTags = tags.filter((tag) => !state.learning.artists[tag]?.seeded);
    const next = { ...state, parents: [genome], customArtists, customStart: structuredClone(genome),
      learning: seedArtistPreferences(state.learning, unseededTags, 1), baseline: null, promotedId: null,
      currentBatch: [], batchImage2Image: null, batchReferences: null,
      selectedIds: [], dislikedIds: [], batchNumber: 1 };
    await setState("active", next);
    state = next;
    elements.startingArtists.value = formatStartingArtists(artists);
    releaseCandidateUrls();
    updateArtistPool();
    renderCandidates();
    setStatus(`已套用 ${artists.length} 位畫師起點；NAI 權重已重新隨機抽取，每位初始偏好 +1。`);
  } catch (error) {
    setStatus(error.message || "無法套用畫師起點。", true);
  }
}

async function removeBaseline() {
  if (generating || submitting || referenceBusy || !initialized || !state.baseline) return;
  const previous = { baseline: state.baseline, parents: state.parents, promotedId: state.promotedId };
  try {
    state.baseline = null;
    state.parents = [structuredClone(previous.baseline.genome)];
    state.promotedId = null;
    await persistState();
    renderCandidates();
    setStatus("已刪除目前最佳圖片基準；畫師組合仍會繼續使用，下一次提交讚好可建立新基準。");
  } catch (error) {
    Object.assign(state, previous);
    renderCandidates();
    setStatus(error.message || "無法刪除目前最佳基準。", true);
  }
}

async function resetExploration() {
  if (generating || submitting || referenceBusy || !initialized) return;
  if (!window.confirm("清除目前演化分數、批次與未收藏歷史？自選畫師起點、內容、參考圖、Token、資料池和收藏會保留。")) return;
  await clearExplorationData();
  const terms = parseStylePrompt(elements.seedStylePrompt.value);
  const customStart = state.customStart?.artists?.length ? structuredClone(state.customStart) : null;
  const customArtists = customStart ? structuredClone(state.customArtists || []) : [];
  const learning = customStart ? seedArtistPreferences(createLearning(), customStart.artists.map((item) => item.tag), 1) : createLearning();
  state = { version: STATE_VERSION, batchNumber: 1, stats: {}, learning, baseline: null, promotedId: null,
    parents: [customStart || makeInitialGenome(terms)], currentBatch: [], batchImage2Image: null, batchReferences: null,
    selectedIds: [], dislikedIds: [], votes: [], forceExplore: false, customArtists, customStart };
  releaseCandidateUrls();
  updateArtistPool();
  await persistState();
  renderCandidates();
  await renderLibrary();
  elements.controlsDrawer.close();
  setStatus(customStart ? "探索資料已重設；自選畫師起點與隨機權重已保留。" : "探索資料已重設。 ");
}

function syncDrawerButtons() {
  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.setAttribute("aria-expanded", String(elements.controlsDrawer.open && elements.controlsDrawer.dataset.panel === button.dataset.panel));
  });
  document.querySelectorAll("[data-drawer-library]").forEach((button) => {
    button.setAttribute("aria-expanded", String(elements.libraryDrawer.open && libraryView === button.dataset.drawerLibrary));
  });
}

function openPanel(panel) {
  elements.libraryDrawer.close();
  elements.drawerTitle.textContent = { content: "內容 Prompt", style: "質量詞", start: "畫師起點與門檻", settings: "生成與偏好設定", ranking: "目前畫師排名" }[panel];
  if (panel === "ranking") renderRanking();
  elements.controlsDrawer.dataset.panel = panel;
  document.querySelectorAll("[data-panel-body]").forEach((section) => { section.hidden = section.dataset.panelBody !== panel; });
  if (!elements.controlsDrawer.open) elements.controlsDrawer.showModal();
  elements.controlsDrawer.querySelector(".drawer-body").scrollTop = 0;
  syncDrawerButtons();
}

async function openLibrary(view) {
  libraryView = view;
  elements.controlsDrawer.close();
  elements.libraryTitle.textContent = view === "favorites" ? "收藏的畫風" : "生成歷史";
  document.querySelectorAll("[data-library]").forEach((button) => {
    const active = button.dataset.library === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  if (!elements.libraryDrawer.open) elements.libraryDrawer.showModal();
  syncDrawerButtons();
  await renderLibrary();
}

function bindEvents() {
  elements.saveTokenButton.addEventListener("click", saveToken);
  elements.clearTokenButton.addEventListener("click", clearToken);
  elements.anlasButton.addEventListener("click", () => {
    if (getToken()) void refreshAnlas();
    else { openPanel("settings"); elements.tokenInput.focus(); }
  });
  elements.musicButton.addEventListener("click", () => { void toggleMusic(); });
  elements.musicVolume.addEventListener("input", () => {
    const volume = clampMusicVolume(elements.musicVolume.value);
    elements.backgroundMusic.volume = volume;
    localStorage.setItem(MUSIC_VOLUME_KEY, String(volume));
  });
  elements.backgroundMusic.addEventListener("play", updateMusicUi);
  elements.backgroundMusic.addEventListener("pause", updateMusicUi);
  elements.backgroundMusic.addEventListener("ended", updateMusicUi);
  elements.backgroundMusic.addEventListener("error", () => {
    elements.musicButton.disabled = true;
    elements.musicVolume.disabled = true;
    setStatus("背景音樂載入失敗，請確認 background-music.flac 存在。", true);
  });
  elements.contentPrompt.addEventListener("input", saveSettings);
  elements.negativePrompt.addEventListener("input", saveSettings);
  elements.referenceFile.addEventListener("change", () => {
    const file = elements.referenceFile.files[0];
    if (file) void saveImage2Image({}, file);
  });
  elements.image2ImageEnabled.addEventListener("change", () => { void saveImage2Image({ enabled: elements.image2ImageEnabled.checked }); });
  elements.removeReferenceButton.addEventListener("click", () => { void saveImage2Image({ enabled: false, blob: null, originalBlob: null, fileName: "" }); });
  for (const [kind, panel] of [["vibes", elements.vibePanel], ["precise", elements.precisePanel]]) {
    panel.addEventListener("change", (event) => {
      const input = event.target;
      const id = input.closest("[data-reference-id]")?.dataset.referenceId || "";
      if (input.matches("[data-tool-upload]")) void saveReferenceTool(kind, {}, [...input.files]);
      else if (input.dataset.toolField) void saveReferenceTool(kind, { [input.dataset.toolField]: input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value }, [], id);
    });
    panel.addEventListener("input", (event) => {
      if (event.target.type === "range") event.target.parentElement.querySelector("output").value = Number(event.target.value).toFixed(2);
    });
    panel.addEventListener("click", (event) => {
      if (event.target.closest("[data-tool-encode]")) void encodeVibes();
      if (event.target.closest("[data-tool-remove]")) void saveReferenceTool(kind, { remove: true }, [], event.target.closest("[data-reference-id]").dataset.referenceId);
    });
  }
  for (const key of Object.keys(DEFAULT_GENERATION_SETTINGS)) {
    const input = elements[`generation${key[0].toUpperCase()}${key.slice(1)}`];
    input.addEventListener("input", saveGenerationSettings);
    input.addEventListener("change", saveGenerationSettings);
  }
  for (const [name, field] of [["imageStrength", "strength"], ["imageNoise", "noise"]]) {
    elements[name].addEventListener("input", () => { elements[`${name}Value`].value = Number(elements[name].value).toFixed(2); });
    elements[name].addEventListener("change", () => { void saveImage2Image({ [field]: Number(elements[name].value) }); });
  }
  elements.seedStylePrompt.addEventListener("input", saveSettings);
  elements.customStartButton.addEventListener("click", () => openPanel("start"));
  elements.removeBaselineButton.addEventListener("click", removeBaseline);
  elements.startingArtists.addEventListener("change", () => { void applyStartingArtists(); });
  elements.artistThreshold.addEventListener("change", saveArtistThreshold);
  elements.generateButton.addEventListener("click", generateBatchImages);
  elements.stopButton.addEventListener("click", () => {
    abortController?.abort();
    setStatus("已要求停止；已完成的圖片會保留。 ");
    updateControls();
  });
  elements.submitVoteButton.addEventListener("click", () => submitVote([...state.selectedIds], [...state.dislikedIds]));
  elements.ignoreBatchButton.addEventListener("click", () => submitVote([], [], "ignore"));
  elements.dislikeAllButton.addEventListener("click", () => submitVote([], state.currentBatch.map((candidate) => candidate.id), "reject"));
  elements.baselinePreview.addEventListener("click", () => { if (state.baseline) showPreview(state.baseline); });
  elements.resetButton.addEventListener("click", resetExploration);
  elements.candidateGrid.addEventListener("click", handleCandidateAction);
  elements.styleSearch.addEventListener("input", renderStylePool);
  elements.styleLayerFilter.addEventListener("change", renderStylePool);
  elements.stylePoolList.addEventListener("change", updateStyleOverride);
  document.querySelectorAll("[data-library]").forEach((button) => {
    button.addEventListener("click", () => openLibrary(button.dataset.library));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "history" : event.key === "End" ? "favorites" : libraryView === "history" ? "favorites" : "history";
      openLibrary(next);
      document.querySelector(`[data-library="${next}"]`).focus();
    });
  });
  document.querySelectorAll("[data-panel]").forEach((button) => button.addEventListener("click", () => openPanel(button.dataset.panel)));
  document.querySelectorAll("[data-drawer-library]").forEach((button) => button.addEventListener("click", () => openLibrary(button.dataset.drawerLibrary)));
  document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  elements.closeDialogButton.addEventListener("click", () => elements.imageDialog.close());
  elements.previewPrevious.addEventListener("click", () => navigatePreview(-1));
  elements.previewNext.addEventListener("click", () => navigatePreview(1));
  elements.previewFavorite.addEventListener("click", async () => {
    const current = previewRecord;
    if (!current || favoriteBusy || submitting) return;
    const record = current.blob ? current
      : (await getImages()).find((item) => item.id === current.id) || (await getFavorites()).find((item) => item.id === current.id);
    if (record) await toggleFavorite(record);
    else setStatus("找不到這張圖片的儲存紀錄，無法收藏。", true);
  });
  elements.libraryGrid.addEventListener("focusin", (event) => expandLibraryItem(event.target.closest(".library-item")));
  elements.libraryGrid.addEventListener("focusout", (event) => {
    const hovered = elements.libraryGrid.querySelector(".library-item:hover");
    expandLibraryItem(hovered || event.relatedTarget?.closest?.(".library-item") || null);
  });
  window.addEventListener("resize", () => expandLibraryItem(elements.libraryGrid.querySelector(".is-library-expanded")));
  elements.imageDialog.addEventListener("keydown", (event) => {
    if (!previewNavigation || !["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    event.preventDefault();
    event.stopPropagation();
    navigatePreview(event.key === "ArrowLeft" ? -1 : 1);
  });
  elements.imageDialog.addEventListener("close", () => {
    if (elements.imageDialog.open) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewNavigation = null;
    previewRecord = null;
    updatePreviewFavorite();
    elements.dialogImage.removeAttribute("src");
    elements.dialogPrompt.textContent = "";
  });
  elements.libraryDrawer.addEventListener("close", () => {
    if (elements.libraryDrawer.open) return;
    libraryRenderVersion += 1;
    releaseLibraryUrls();
    elements.libraryGrid.replaceChildren();
    elements.libraryGrid.style.removeProperty("grid-template-rows");
  });
  for (const dialog of [elements.controlsDrawer, elements.libraryDrawer, elements.imageDialog]) {
    dialog.addEventListener("close", syncDrawerButtons);
    let startedOnBackdrop = false;
    dialog.addEventListener("pointerdown", (event) => { startedOnBackdrop = event.target === dialog && outsideDialog(event, dialog); });
    dialog.addEventListener("click", (event) => {
      if (startedOnBackdrop && event.target === dialog && outsideDialog(event, dialog)) dialog.close();
      startedOnBackdrop = false;
    });
  }
  elements.reduceMotion.addEventListener("change", () => {
    localStorage.setItem(MOTION_KEY, String(elements.reduceMotion.checked));
    applyMotionPreference();
  });
  systemMotion.addEventListener("change", applyMotionPreference);
  document.addEventListener("visibilitychange", () => document.body.classList.toggle("page-hidden", document.hidden));
}

function outsideDialog(event, dialog) {
  const bounds = dialog.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
}

async function initialize() {
  const removedHistory = await trimImages();
  favoriteIds = new Set((await getFavorites()).map((item) => item.id));
  loadSettings();
  loadMusicSettings();
  renderImage2Image();
  const savedReference = await getState("image2image", null);
  if (savedReference) {
    image2Image = {
      blob: savedReference.blob instanceof Blob ? savedReference.blob : null,
      originalBlob: savedReference.originalBlob instanceof Blob ? savedReference.originalBlob : null,
      width: savedReference.width || 832, height: savedReference.height || 1216,
      fileName: typeof savedReference.fileName === "string" ? savedReference.fileName : "參考圖",
      enabled: Boolean(savedReference.enabled && savedReference.blob instanceof Blob),
      strength: Number.isFinite(savedReference.strength) && savedReference.strength >= 0 && savedReference.strength <= 1 ? savedReference.strength : 0.7,
      noise: Number.isFinite(savedReference.noise) && savedReference.noise >= 0 && savedReference.noise <= 1 ? savedReference.noise : 0
    };
  }
  const savedTools = await getState("referenceTools", null);
  if (savedTools) {
    for (const kind of ["vibes", "precise"]) {
      const tool = savedTools[kind];
      if (!Array.isArray(tool?.images)) continue;
      const images = tool.images.filter((item) => item?.blob instanceof Blob).map((item) => ({
        ...item, id: typeof item.id === "string" ? item.id : uid("reference"),
        fileName: typeof item.fileName === "string" ? item.fileName : "參考圖", enabled: item.enabled !== false,
        strength: Number.isFinite(item.strength) && Math.abs(item.strength) <= 1 ? item.strength : kind === "vibes" ? 0.6 : 1,
        informationExtracted: Number.isFinite(item.informationExtracted) && item.informationExtracted >= 0 && item.informationExtracted <= 1 ? item.informationExtracted : 1,
        fidelity: Number.isFinite(item.fidelity) && Math.abs(item.fidelity) <= 1 ? item.fidelity : 1,
        type: ["character", "style", "character&style"].includes(item.type) ? item.type : "style",
        encodings: item.encodings && typeof item.encodings === "object" && !Array.isArray(item.encodings) ? item.encodings : {}
      }));
      referenceTools[kind] = { enabled: Boolean(tool.enabled && images.length), normalize: tool.normalize !== false, images: kind === "vibes" ? images.slice(0, 16) : images };
    }
    if (referenceTools.vibes.enabled) referenceTools.precise.enabled = false;
  }
  try { styleOverrides = JSON.parse(localStorage.getItem(STYLE_OVERRIDES_KEY) || "{}"); } catch { styleOverrides = {}; }
  const [artistsData, stylesData] = await Promise.all([
    loadJson("./data/artists.json", "./data/.gelbooru-checkpoint.json"),
    loadJson("./data/style-tags.json", "./data/style-tags.seed.json")
  ]);
  allArtists = (Array.isArray(artistsData.artists)
    ? artistsData.artists
    : Object.values(artistsData.artists || {}).map((item) => ({
      tag: `artist:${item.name}`,
      sourceTagId: item.id,
      postCount: item.postCount
    }))).filter((item) => Number(item.postCount) >= MIN_ARTIST_POST_COUNT);
  stylePool = stylesData.tags || [];
  for (let year = 2000; year <= 2026; year += 1) {
    const tag = `year ${year}`;
    if (!stylePool.some((item) => item.tag === tag)) {
      stylePool.push({ tag, category: "year", polarity: "positive", source: "nai-official", postCount: null });
    }
  }
  categories = stylesData.categories || {};
  stylePool = classifyStylePool(stylePool);
  const allowedStyleTags = new Set(stylePool.map((item) => item.tag));
  styleOverrides = Object.fromEntries(Object.entries(styleOverrides).filter(([tag]) => allowedStyleTags.has(tag)));
  localStorage.setItem(STYLE_OVERRIDES_KEY, JSON.stringify(styleOverrides));
  const restored = await getState("active", null);
  const discardedOldEvolution = Boolean(restored?.parents?.length && restored.version !== STATE_VERSION);
  if (discardedOldEvolution) await clearExplorationData();
  if (restored?.parents?.length && restored.version === STATE_VERSION) {
    state = restored;
    state.customArtists = Array.isArray(restored.customArtists) ? restored.customArtists.slice(0, 6) : [];
    state.customStart = restored.customStart?.artists?.length ? restored.customStart
      : restored.parents[0]?.id?.startsWith("custom_start_") && state.customArtists.length ? structuredClone(restored.parents[0]) : null;
    state.currentBatch = state.currentBatch.map((item) => item.status === "loading" ? { ...item, status: "pending" } : item);
    state.dislikedIds = [...new Set(Array.isArray(restored.dislikedIds) ? restored.dislikedIds : [])]
      .filter((id) => state.currentBatch.some((item) => item.id === id && item.status === "success") && !state.selectedIds.includes(id));
  }
  else state.parents = [makeInitialGenome(parseStylePrompt(elements.seedStylePrompt.value))];
  const migratedLearning = !compatibleLearning(state.learning);
  if (migratedLearning) {
    state.learning = state.customStart ? seedArtistPreferences(createLearning(), state.customStart.artists.map((item) => item.tag), 1) : createLearning();
    state.stats = {};
    state.baseline = null;
  }
  state.baseline ||= null;
  state.customArtists ||= [];
  state.customStart ||= null;
  if (state.customStart) elements.startingArtists.value = formatStartingArtists(state.customStart.artists);
  updateArtistPool();
  state.promotedId = state.currentBatch.some((item) => item.id === state.promotedId && item.status === "success" && state.selectedIds.includes(item.id)) ? state.promotedId : null;
  // Frozen legacy cards can still be compared within their original batch only.
  const legacyContext = state.currentBatch.length ? `legacy:${state.currentBatch[0].id}` : null;
  state.currentBatch.forEach((item) => { item.contextKey ||= legacyContext; });
  if (migratedLearning) await persistState();
  await attachCurrentImages();
  initialized = true;
  renderImage2Image();
  renderModelSettings();
  refreshTokenStatus();
  renderStylePool();
  renderCandidates();
  await renderLibrary();
  bindEvents();
  void refreshAnlas();
  if (discardedOldEvolution) setStatus("已清除不相容的舊版演化紀錄。收藏與 Token 已保留。");
  else if (migratedLearning) setStatus("新版組合學習已從中立開始；目前圖片、起始組合、設定及收藏保留。");
  else if (removedHistory) setStatus(`已依 50 張上限移除 ${removedHistory} 張最舊歷史；收藏保留。刪除的未收藏歷史無法復原。`);
  else if (favoriteIds.size > FAVORITE_LIMIT) setStatus("既有收藏已超過 50 張，未自動刪除；請取消部分收藏後再新增。", true);
}

initialize().catch((error) => {
  setStatus(error.message || "初始化失敗。", true);
  elements.candidateGrid.innerHTML = `<div class="candidate-placeholder">${escapeHtml(error.message || "初始化失敗。")}</div>`;
});
