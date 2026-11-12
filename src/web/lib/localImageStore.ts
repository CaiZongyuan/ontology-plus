import type {
  AgentImageAttachmentRef,
  AgentImageAttachmentRole,
} from '../../packages/workspace-store/index.js';
import type { TransientTurnImageInput } from '../../packages/agent-runtime/index.js';

export const LOCAL_IMAGE_DB_NAME = 'onto_local_images_v1';
export const LOCAL_IMAGE_STORE_NAME = 'images';
const LOCAL_IMAGE_DB_VERSION = 1;

export interface LocalStoredImageRecord {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
  width?: number;
  height?: number;
  byteLength: number;
  createdAt: string;
}

export interface CompressImageOptions {
  maxEdgePx?: number;
  quality?: number;
  preferredMimeType?: 'image/webp' | 'image/jpeg';
  widthHint?: number;
  heightHint?: number;
}

export interface StoreLocalImageOptions extends CompressImageOptions {
  id?: string;
  name?: string;
  role?: AgentImageAttachmentRole;
  width?: number;
  height?: number;
}

export type LocalImageSyncSnapshot =
  | { status: 'loaded'; record: LocalStoredImageRecord }
  | { status: 'missing' }
  | { status: 'pending' };

/**
 * Read-through cache for zero-flicker synchronous rendering in React (`LocalImageThumbnail`)
 * and deterministic SSR/Node unit tests when `indexedDB` is absent.
 */
const memoryCache = new Map<string, LocalStoredImageRecord | null>();
const fallbackMemoryStore = new Map<string, LocalStoredImageRecord>();

function hasBrowserIndexedDb(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    'indexedDB' in globalThis &&
    Boolean((globalThis as { indexedDB?: IDBFactory }).indexedDB?.open)
  );
}

function nextLocalImageId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `limg-${Date.now().toString(36)}-${rand}`;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function openLocalImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
    const req = idb.open(LOCAL_IMAGE_DB_NAME, LOCAL_IMAGE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_IMAGE_STORE_NAME)) {
        db.createObjectStore(LOCAL_IMAGE_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open local image IndexedDB'));
  });
}

async function idbPutRecord(record: LocalStoredImageRecord): Promise<void> {
  if (!hasBrowserIndexedDb()) {
    fallbackMemoryStore.set(record.id, record);
    return;
  }
  const db = await openLocalImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_IMAGE_STORE_NAME);
      const req = store.put(record);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close?.();
  }
}

async function idbGetRecord(id: string): Promise<LocalStoredImageRecord | null> {
  if (!hasBrowserIndexedDb()) {
    return fallbackMemoryStore.get(id) ?? null;
  }
  const db = await openLocalImageDb();
  try {
    return await new Promise<LocalStoredImageRecord | null>((resolve, reject) => {
      const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOCAL_IMAGE_STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const val = req.result as LocalStoredImageRecord | undefined;
        resolve(val ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
  } finally {
    db.close?.();
  }
}

async function idbDeleteRecord(id: string): Promise<void> {
  fallbackMemoryStore.delete(id);
  if (!hasBrowserIndexedDb()) {
    return;
  }
  const db = await openLocalImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_IMAGE_STORE_NAME);
      const req = store.delete(id);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete transaction failed'));
    });
  } finally {
    db.close?.();
  }
}

async function idbClearAll(): Promise<void> {
  fallbackMemoryStore.clear();
  if (!hasBrowserIndexedDb()) {
    return;
  }
  const db = await openLocalImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_IMAGE_STORE_NAME);
      const req = store.clear();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear transaction failed'));
    });
  } finally {
    db.close?.();
  }
}

/**
 * Resize and compress a browser `Blob` / `File` via `<canvas>` when available in the browser
 * (default max 1600px long edge, WebP/JPEG quality ~0.82), falling back to raw bytes in headless tests.
 */
export async function compressImageBlob(
  blob: Blob,
  options: CompressImageOptions = {},
): Promise<{
  mimeType: string;
  dataBase64: string;
  byteLength: number;
  width?: number;
  height?: number;
}> {
  const maxEdgePx = options.maxEdgePx ?? 1600;
  const quality = options.quality ?? 0.82;
  const preferredMime = options.preferredMimeType ?? 'image/webp';

  if (
    typeof createImageBitmap === 'function' &&
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    try {
      const bitmap = await createImageBitmap(blob);
      const srcW = bitmap.width;
      const srcH = bitmap.height;
      const maxSrcEdge = Math.max(srcW, srcH);
      const scale = maxSrcEdge > maxEdgePx ? maxEdgePx / maxSrcEdge : 1;
      const targetW = Math.max(1, Math.round(srcW * scale));
      const targetH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (ctx && typeof canvas.toBlob === 'function') {
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close?.();

        const encodedBlob =
          (await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), preferredMime, quality),
          )) ??
          (await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
          ));

        if (encodedBlob && encodedBlob.size > 0) {
          const buf = await encodedBlob.arrayBuffer();
          return {
            mimeType: encodedBlob.type || preferredMime,
            dataBase64: arrayBufferToBase64(buf),
            byteLength: encodedBlob.size,
            width: targetW,
            height: targetH,
          };
        }
      } else {
        bitmap.close?.();
      }
    } catch {
      // Graceful passthrough when canvas or createImageBitmap is unsupported in test environments
    }
  }

  const rawBuf = await blob.arrayBuffer();
  return {
    mimeType: blob.type || 'image/webp',
    dataBase64: arrayBufferToBase64(rawBuf),
    byteLength: rawBuf.byteLength,
    ...(options.widthHint !== undefined ? { width: options.widthHint } : {}),
    ...(options.heightHint !== undefined ? { height: options.heightHint } : {}),
  };
}

/**
 * Compress and store an uploaded or clipboard-pasted image in browser-local IndexedDB ONLY,
 * returning both the local record and the lightweight `AgentImageAttachmentRef` safe for session metadata.
 */
export async function storeUploadedOrPastedImage(
  fileOrBlob: Blob | File,
  options: StoreLocalImageOptions = {},
): Promise<{
  record: LocalStoredImageRecord;
  ref: AgentImageAttachmentRef;
}> {
  const inferredName =
    options.name?.trim() ||
    ('name' in fileOrBlob && typeof fileOrBlob.name === 'string' && fileOrBlob.name.trim()
      ? fileOrBlob.name.trim()
      : `pasted-image-${Date.now().toString(36)}.webp`);

  const compressed = await compressImageBlob(fileOrBlob, {
    ...options,
    ...(options.width !== undefined ? { widthHint: options.width } : {}),
    ...(options.height !== undefined ? { heightHint: options.height } : {}),
  });

  const id = options.id?.trim() || nextLocalImageId();
  const record: LocalStoredImageRecord = {
    id,
    name: inferredName,
    mimeType: compressed.mimeType,
    dataBase64: compressed.dataBase64,
    ...(compressed.width !== undefined ? { width: compressed.width } : {}),
    ...(compressed.height !== undefined ? { height: compressed.height } : {}),
    byteLength: compressed.byteLength,
    createdAt: new Date().toISOString(),
  };

  await idbPutRecord(record);
  memoryCache.set(id, record);

  const ref: AgentImageAttachmentRef = {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    source: 'local',
    ...(record.width !== undefined ? { width: record.width } : {}),
    ...(record.height !== undefined ? { height: record.height } : {}),
    ...(options.role ? { role: options.role } : {}),
  };

  return { record, ref };
}

export async function loadLocalImage(id: string): Promise<LocalStoredImageRecord | null> {
  if (!id) return null;
  if (memoryCache.has(id)) {
    return memoryCache.get(id) ?? null;
  }
  try {
    const record = await idbGetRecord(id);
    memoryCache.set(id, record);
    return record;
  } catch {
    return fallbackMemoryStore.get(id) ?? null;
  }
}

export function peekLocalImageSync(id: string): LocalImageSyncSnapshot {
  if (!id) return { status: 'missing' };
  if (memoryCache.has(id)) {
    const cached = memoryCache.get(id);
    return cached ? { status: 'loaded', record: cached } : { status: 'missing' };
  }
  if (!hasBrowserIndexedDb()) {
    const mem = fallbackMemoryStore.get(id);
    return mem ? { status: 'loaded', record: mem } : { status: 'missing' };
  }
  return { status: 'pending' };
}

export function toLocalImageDataUrl(record: Pick<LocalStoredImageRecord, 'mimeType' | 'dataBase64'>): string {
  return `data:${record.mimeType || 'image/webp'};base64,${record.dataBase64}`;
}

export async function deleteLocalImage(id: string): Promise<void> {
  if (!id) return;
  memoryCache.set(id, null);
  await idbDeleteRecord(id);
}

export async function clearLocalImageStore(): Promise<void> {
  for (const key of memoryCache.keys()) {
    memoryCache.set(key, null);
  }
  await idbClearAll();
}

export function resetLocalImageMemoryCacheForTests(): void {
  memoryCache.clear();
}

export async function resetLocalImageStoreForTests(): Promise<void> {
  memoryCache.clear();
  try {
    await idbClearAll();
  } catch {
    fallbackMemoryStore.clear();
  }
}

export interface ClipboardLikeData {
  items?: ArrayLike<{
    kind?: string;
    type: string;
    getAsFile: () => File | null;
  }>;
  files?: ArrayLike<File>;
}

/** Extract pasted image `File` objects from a clipboard `DataTransfer` payload. */
export function extractClipboardImageFiles(
  clipboardData: ClipboardLikeData | null | undefined,
): File[] {
  if (!clipboardData) return [];
  const extracted: File[] = [];

  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i];
      if (!item) continue;
      if ((item.kind === undefined || item.kind === 'file') && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) extracted.push(file);
      }
    }
  }

  if (extracted.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files[i];
      if (file && file.type.startsWith('image/')) {
        extracted.push(file);
      }
    }
  }

  return extracted;
}

/**
 * Resolve lightweight `AgentImageAttachmentRef[]` into transient turn inputs right before
 * dispatching an Agent Run request. Local base64 bytes stay in memory for the single HTTP stream
 * and are never persisted to SQLite.
 */
export async function resolveTurnImagesForRequest(
  refs: readonly AgentImageAttachmentRef[],
  fallbackNotesById?: Record<string, string | undefined>,
): Promise<TransientTurnImageInput[]> {
  const resolved: TransientTurnImageInput[] = [];

  for (const ref of refs) {
    const note = fallbackNotesById?.[ref.id];
    if (ref.source === 'remote' && ref.remoteUrl) {
      resolved.push({
        id: ref.id,
        name: ref.name,
        mimeType: ref.mimeType,
        remoteUrl: ref.remoteUrl,
        ...(ref.width !== undefined ? { width: ref.width } : {}),
        ...(ref.height !== undefined ? { height: ref.height } : {}),
        ...(ref.role ? { role: ref.role } : {}),
        ...(note ? { textFallbackNote: note } : {}),
      });
      continue;
    }

    const localRecord = await loadLocalImage(ref.id);
    resolved.push({
      id: ref.id,
      name: ref.name,
      mimeType: localRecord?.mimeType ?? ref.mimeType,
      ...(localRecord ? { dataBase64: localRecord.dataBase64 } : {}),
      ...((localRecord?.width ?? ref.width) !== undefined
        ? { width: localRecord?.width ?? ref.width }
        : {}),
      ...((localRecord?.height ?? ref.height) !== undefined
        ? { height: localRecord?.height ?? ref.height }
        : {}),
      ...(ref.role ? { role: ref.role } : {}),
      ...(note ? { textFallbackNote: note } : {}),
    });
  }

  return resolved;
}
