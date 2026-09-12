const DB_NAME = "novelai_style_evolver";
const DB_VERSION = 2;
const IMAGE_LIMIT = 50;
const FAVORITE_LIMIT = 50;

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 操作失敗。"));
  });
}

export function openDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("瀏覽器不支援 IndexedDB。"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("state")) database.createObjectStore("state");
      if (!database.objectStoreNames.contains("images")) {
        const store = database.createObjectStore("images", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains("favorites")) {
        const store = database.createObjectStore("favorites", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains("savepoints")) database.createObjectStore("savepoints", { keyPath: "id" });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); databasePromise = undefined; };
      resolve(request.result);
    };
    request.onblocked = () => { blocked = true; reject(new Error("本機資料庫升級被舊頁面阻擋，請關閉其他工具頁面再重新載入。")); };
    request.onerror = () => reject(request.error || new Error("無法開啟本機資料庫。"));
  }).catch((error) => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function transaction(storeName, mode, callback) {
  const database = await openDatabase();
  const tx = database.transaction(storeName, mode);
  const completion = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("本機資料庫交易失敗。"));
    tx.onabort = () => reject(tx.error || new Error("本機資料庫交易已中止。"));
  });
  try {
    const result = await callback(tx.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), tx);
    await completion;
    return result;
  } catch (error) {
    try { tx.abort(); } catch (abortError) { if (abortError.name !== "InvalidStateError") throw abortError; }
    await completion.catch(() => {});
    throw error;
  }
}

export async function saveBatchSavePoint(point, active) {
  await transaction(["savepoints", "state", "images", "favorites"], "readwrite", (store, tx) => {
    store.put(point);
    tx.objectStore("state").put(active, "active");
    return pruneInTransaction(store, tx);
  });
}

export async function getSavePoint(id) {
  if (!id) return null;
  return await transaction("savepoints", "readonly", (store) => requestResult(store.get(id))) ?? null;
}

export async function restoreExplorationState(active, image2Image, referenceTools) {
  await transaction(["state", "savepoints", "images", "favorites"], "readwrite", (store, tx) => {
    store.put(active, "active");
    store.put(image2Image, "image2image");
    store.put(referenceTools, "referenceTools");
    return pruneInTransaction(tx.objectStore("savepoints"), tx);
  });
}

async function pruneInTransaction(store, tx) {
  const [keys, images, favorites, active] = await Promise.all([
    requestResult(store.getAllKeys()), requestResult(tx.objectStore("images").getAll()),
    requestResult(tx.objectStore("favorites").getAll()), requestResult(tx.objectStore("state").get("active"))
  ]);
  const keep = new Set([...images, ...favorites, ...(active?.currentBatch || [])].map((item) => item.savePointId).filter(Boolean));
  for (const key of keys) if (!keep.has(key)) store.delete(key);
}

export async function pruneSavePoints() {
  await transaction(["savepoints", "images", "favorites", "state"], "readwrite", pruneInTransaction);
}

export async function getState(key, fallback = null) {
  const value = await transaction("state", "readonly", (store) => requestResult(store.get(key)));
  return value ?? fallback;
}

export async function setState(key, value) {
  await transaction("state", "readwrite", (store) => requestResult(store.put(value, key)));
}

export async function deleteState(key) {
  await transaction("state", "readwrite", (store) => requestResult(store.delete(key)));
}

export async function saveImage(record) {
  await transaction("images", "readwrite", (store) => requestResult(store.put(record)));
  await trimImages();
}

export async function deleteImage(id) {
  await transaction("images", "readwrite", (store) => requestResult(store.delete(id)));
  await pruneSavePoints();
}

export async function getImages() {
  const values = await transaction("images", "readonly", (store) => requestResult(store.getAll()));
  return values.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function getImagesByBatch(batchId) {
  return (await getImages()).filter((item) => item.batchId === batchId);
}

export async function trimImages(limit = IMAGE_LIMIT) {
  const images = await getImages();
  const stale = images.slice(limit);
  if (stale.length) await transaction("images", "readwrite", (store) => {
    for (const item of stale) store.delete(item.id);
  });
  await pruneSavePoints();
  return stale.length;
}

export async function saveFavorite(record) {
  await transaction(["favorites", "savepoints"], "readwrite", async (store, tx) => {
    if (record.savePointId && !await requestResult(tx.objectStore("savepoints").get(record.savePointId))) throw new Error("這張圖片的儲存點已不存在，請重新載入歷史。");
    const existing = await requestResult(store.get(record.id));
    if (!existing && await requestResult(store.count()) >= FAVORITE_LIMIT) throw new Error(`收藏已達 ${FAVORITE_LIMIT} 張，請先取消其他收藏。`);
    await requestResult(store.put({ ...record, favoritedAt: existing?.favoritedAt || new Date().toISOString() }));
  });
}

export async function deleteFavorite(id) {
  await transaction("favorites", "readwrite", (store) => requestResult(store.delete(id)));
  await pruneSavePoints();
}

export async function getFavorites() {
  const values = await transaction("favorites", "readonly", (store) => requestResult(store.getAll()));
  return values.sort((left, right) => String(right.favoritedAt).localeCompare(String(left.favoritedAt)));
}

export async function isFavorite(id) {
  return Boolean(await transaction("favorites", "readonly", (store) => requestResult(store.get(id))));
}

export async function clearExplorationData() {
  await transaction(["state", "images"], "readwrite", (store, tx) => {
    store.delete("active");
    tx.objectStore("images").clear();
  });
  await pruneSavePoints();
}

export { IMAGE_LIMIT, FAVORITE_LIMIT };
