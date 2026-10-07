import fs from 'fs';
import path from 'path';
import { dataDir } from './warp.ts';

/**
 * localStorage / sessionStorage for pages opened in this browser.
 *
 * Every proxied site runs inside one app origin in the browser, so without this all sites would
 * share a single localStorage bucket: one site could read the tokens another site stored, and the
 * app's own UI keys would collide with theirs. Storage is therefore namespaced by the real site
 * origin (localStorage) or site origin plus tab (sessionStorage), exactly how a browser scopes it.
 *
 * localStorage is saved to storage.json in the app data directory on this device, written atomically
 * with mode 0600. sessionStorage deliberately stays in memory only: browsers clear it when the
 * browser closes, and it is dropped when its tab closes.
 */

export interface StorageScope {
  origin: string;
  tabId: string;
  isPrivate: boolean;
}

const storeFile = () => path.join(dataDir(), 'storage.json');
const MAX_ORIGIN_BYTES = 2 * 1024 * 1024;

type OriginStorage = Record<string, string>;

let localByOrigin: Record<string, OriginStorage> | null = null;
let loading: Promise<Record<string, OriginStorage>> | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let warnedUnpersistable = false;
let warnedTooLarge = false;

// tabId -> origin -> data. In memory only, for both regular and private tabs.
const sessionByTab = new Map<string, Map<string, OriginStorage>>();
// Private tabs keep localStorage here as well: same isolation, nothing on disk.
const privateLocal = new Map<string, OriginStorage>();

function load(): Promise<Record<string, OriginStorage>> {
  if (localByOrigin) return Promise.resolve(localByOrigin);
  if (!loading) {
    loading = (async () => {
      let data: Record<string, OriginStorage> = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.local && typeof parsed.local === 'object') {
          data = parsed.local;
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') console.warn(`[storage] Saved site data could not be read (${err?.message}); starting empty.`);
      }
      localByOrigin = data;
      return data;
    })();
  }
  return loading;
}
load();

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushStorage();
  }, 250);
  flushTimer.unref?.();
}

export async function flushStorage(): Promise<void> {
  if (!dirty || !localByOrigin) return;
  try {
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, local: localByOrigin }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false;
  } catch (err: any) {
    if (!warnedUnpersistable) {
      warnedUnpersistable = true;
      console.warn(`[storage] Could not write ${storeFile()} (${err?.message}); site data lasts until the server stops.`);
    }
  }
}

/** Only plain string maps cross the boundary — same contract the Storage interface promises. */
function sanitizeMap(input: unknown): OriginStorage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: OriginStorage = {};
  let bytes = 0;
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 5000) break;
    if (typeof value !== 'string') continue;
    const k = String(key).slice(0, 1024);
    const v = value.length > 1024 * 1024 ? value.slice(0, 1024 * 1024) : value;
    bytes += k.length + v.length;
    if (bytes > MAX_ORIGIN_BYTES) {
      if (!warnedTooLarge) {
        warnedTooLarge = true;
        console.warn(`[storage] A site tried to store more than ${MAX_ORIGIN_BYTES} bytes for one origin; the rest was dropped (browsers cap localStorage around 5 MB too).`);
      }
      break;
    }
    out[k] = v;
    count++;
  }
  return count || Object.keys(input).length === 0 ? out : null;
}

export async function readStorage(scope: StorageScope): Promise<{ local: OriginStorage; session: OriginStorage }> {
  const origin = scope.origin;
  let local: OriginStorage = {};
  if (scope.isPrivate) {
    local = privateLocal.get(`${scope.tabId}|${origin}`) || {};
  } else {
    local = (await load())[origin] || {};
  }
  const session = sessionByTab.get(scope.tabId)?.get(origin) || {};
  return { local, session };
}

export async function writeStorage(scope: StorageScope, data: { local?: unknown; session?: unknown }): Promise<void> {
  const origin = scope.origin;
  if (data.local !== undefined) {
    const clean = sanitizeMap(data.local);
    if (clean) {
      if (scope.isPrivate) {
        privateLocal.set(`${scope.tabId}|${origin}`, clean);
      } else {
        const all = await load();
        all[origin] = clean;
        scheduleFlush();
      }
    }
  }
  if (data.session !== undefined) {
    const clean = sanitizeMap(data.session);
    if (clean) {
      let perTab = sessionByTab.get(scope.tabId);
      if (!perTab) {
        perTab = new Map();
        sessionByTab.set(scope.tabId, perTab);
      }
      perTab.set(origin, clean);
    }
  }
}

/** A tab closed or left private mode: drop its sessionStorage and private localStorage. */
export function forgetTab(tabId: string): void {
  if (!tabId) return;
  sessionByTab.delete(tabId);
  for (const key of [...privateLocal.keys()]) {
    if (key.startsWith(`${tabId}|`)) privateLocal.delete(key);
  }
}

/** "Forget saved logins": wipes persisted site data from this device. */
export async function forgetSavedStorage(): Promise<void> {
  sessionByTab.clear();
  privateLocal.clear();
  await load();
  localByOrigin = {};
  dirty = true;
  await flushStorage();
}
