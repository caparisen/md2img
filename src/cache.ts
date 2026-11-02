export interface TaxonomyEntry {
  label: string;
}

export interface Taxonomy {
  classifications: Record<string, TaxonomyEntry>;
  tagGroups: Record<string, TaxonomyEntry>;
  tags: Record<string, TaxonomyEntry>;
}

export interface RegistryFamily {
  id: string;
  family: string;
  classifications?: string[];
  tags?: string[];
}

export interface FontApi {
  id: string;
  family: string;
  subsets?: string[];
  weights?: number[];
  styles?: string[];
  variable?: boolean;
  category?: string;
}

export interface CatalogRaw {
  taxonomy: Taxonomy;
  families: RegistryFamily[];
  fonts: FontApi[];
}

export interface LoadResult {
  raw: CatalogRaw;
  fromCache: boolean;
  stale: boolean;
}

const API = "https://api.fontsource.org/v1";
const TAXONOMY_URL = `${API}/registry/taxonomy`;
const FAMILIES_URL = `${API}/registry/families`;
const FONTS_URL = `${API}/fonts`;

const DB_NAME = "md2img";
const DB_VERSION = 1;
const STORE = "cache";
const RECORD_KEY = "fontsource-catalog";
const SCHEMA = 1;

/** 缓存有效期：7 天 */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 同一记录两次版本检查的最小间隔 */
const MIN_CHECK_MS = 6 * 60 * 60 * 1000;

interface CacheRecord {
  schema: number;
  fetchedAt: number;
  lastCheckedAt: number;
  revision: string | null;
  raw: CatalogRaw;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecord(): Promise<CacheRecord | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(RECORD_KEY);
      req.onsuccess = () => resolve((req.result as CacheRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function writeRecord(record: CacheRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function fetchAll(): Promise<{ raw: CatalogRaw; revision: string | null }> {
  const [taxonomyRes, familiesRes, fontsRes] = await Promise.all([
    fetch(TAXONOMY_URL, { cache: "default" }),
    fetch(FAMILIES_URL, { cache: "default" }),
    fetch(FONTS_URL, { cache: "default" }),
  ]);
  if (!taxonomyRes.ok || !familiesRes.ok || !fontsRes.ok) {
    throw new Error(
      `Fontsource API failed: ${taxonomyRes.status}/${familiesRes.status}/${fontsRes.status}`,
    );
  }
  const [taxonomy, families, fonts] = await Promise.all([
    taxonomyRes.json() as Promise<Taxonomy>,
    familiesRes.json() as Promise<RegistryFamily[]>,
    fontsRes.json() as Promise<FontApi[]>,
  ]);
  return {
    raw: { taxonomy, families, fonts },
    revision: taxonomyRes.headers.get("X-Registry-Revision"),
  };
}

/**
 * 读取目录：命中未过期缓存直接返回；过期缓存也先返回（stale=true），由调用方在空闲时刷新；
 * 没有缓存时阻塞拉取一次并写入 IndexedDB。
 */
export async function loadCatalog(): Promise<LoadResult> {
  let cached: CacheRecord | null = null;
  try {
    cached = await readRecord();
  } catch {
    cached = null;
  }

  if (cached && cached.schema === SCHEMA) {
    const age = Date.now() - cached.fetchedAt;
    return { raw: cached.raw, fromCache: true, stale: age > TTL_MS };
  }

  const fresh = await fetchAll();
  const record: CacheRecord = {
    schema: SCHEMA,
    fetchedAt: Date.now(),
    lastCheckedAt: 0,
    revision: fresh.revision,
    raw: fresh.raw,
  };
  try {
    await writeRecord(record);
  } catch {
    // 存储失败不影响使用
  }
  return { raw: fresh.raw, fromCache: false, stale: false };
}

/**
 * 缓存过期后的静默刷新：先发一个 HEAD 读 X-Registry-Revision，
 * 版本没变就只更新检查时间（不下载正文）；变了才重新拉三个 JSON。
 * 没有任何提示，失败静默忽略，本次会话最多执行一次。
 */
export async function refreshStale(onUpdated: (raw: CatalogRaw) => void): Promise<void> {
  let record: CacheRecord | null = null;
  try {
    record = await readRecord();
  } catch {
    return;
  }
  if (!record || record.schema !== SCHEMA) return;

  const now = Date.now();
  if (now - record.fetchedAt < TTL_MS) return;
  if (record.lastCheckedAt && now - record.lastCheckedAt < MIN_CHECK_MS) return;

  try {
    await writeRecord({ ...record, lastCheckedAt: now });
    const head = await fetch(TAXONOMY_URL, { method: "HEAD" });
    if (!head.ok) return;
    const revision = head.headers.get("X-Registry-Revision");
    if (revision && record.revision && revision === record.revision) {
      await writeRecord({ ...record, fetchedAt: now, lastCheckedAt: now });
      return;
    }
    const fresh = await fetchAll();
    await writeRecord({
      schema: SCHEMA,
      fetchedAt: now,
      lastCheckedAt: now,
      revision: fresh.revision,
      raw: fresh.raw,
    });
    onUpdated(fresh.raw);
  } catch {
    // 静默失败
  }
}
