import fs from 'fs';
import path from 'path';
import { CookieJar, MemoryCookieStore } from 'tough-cookie';
import { dataDir } from './warp.ts';

/**
 * Saved logins: a real cookie jar per browsing session, kept on this device.
 *
 * Why cookies live here instead of in browser cookies:
 *  - every proxied site is served from this app's single origin in the browser, so a browser cookie
 *    jar would mix all sites together and one site's login could be sent to another site;
 *  - the jar must survive reloads and new tabs (that is the point), and private tabs must not.
 *
 * tough-cookie enforces the cookie rules a browser enforces: Domain (including subdomains and the
 * public-suffix list), Path, Secure, expiry, and HttpOnly. HttpOnly values are never handed to page
 * JavaScript: document.cookie emulation only receives the non-HttpOnly cookies.
 *
 * The file is written atomically with mode 0600 under the app data directory, and is never uploaded
 * anywhere. Hosts that cannot write to disk (serverless) fall back to memory for the run.
 */

export interface JarScope {
  isPrivate: boolean;
  tabId: string;
}

const storeFile = () => path.join(dataDir(), 'cookies.json');

let persistentJar: CookieJar | null = null;
let loading: Promise<CookieJar> | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let warnedUnpersistable = false;

// Private tabs get their own jar; it lives in memory only and dies with the tab. Bounded so a long
// session that opens and closes many private tabs cannot grow this map without limit.
const privateJars = new Map<string, CookieJar>();
const MAX_PRIVATE_JARS = 64;

function memoryJar(): CookieJar {
  return new CookieJar(new MemoryCookieStore());
}

async function loadPersistent(): Promise<CookieJar> {
  if (persistentJar) return persistentJar;
  if (!loading) {
    loading = (async () => {
      let jar = memoryJar();
      try {
        const raw = fs.readFileSync(storeFile(), 'utf8');
        jar = await CookieJar.deserialize(JSON.parse(raw));
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn(`[cookies] Saved logins could not be read (${err?.message}); starting from an empty jar.`);
        }
      }
      persistentJar = jar;
      return jar;
    })();
  }
  return loading;
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushSavedLogins();
  }, 250);
  flushTimer.unref?.();
}

/** Write the jar out atomically so a crash mid-write can never corrupt saved logins. */
export async function flushSavedLogins(): Promise<void> {
  if (!dirty || !persistentJar) return;
  const jar = persistentJar;
  try {
    const data = await jar.serialize();
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false;
  } catch (err: any) {
    if (!warnedUnpersistable) {
      warnedUnpersistable = true;
      console.warn(`[cookies] Could not write ${storeFile()} (${err?.message}); logins last until the server stops.`);
    }
  }
}

async function jarFor(scope: JarScope): Promise<CookieJar> {
  if (!scope.isPrivate) return loadPersistent();
  const key = scope.tabId || '-';
  let jar = privateJars.get(key);
  if (!jar) {
    jar = memoryJar();
    if (privateJars.size >= MAX_PRIVATE_JARS) {
      const oldest = privateJars.keys().next().value;
      if (oldest !== undefined) privateJars.delete(oldest);
    }
    privateJars.set(key, jar);
  }
  return jar;
}

/** The Cookie header to send upstream for this URL — empty when the site has no cookies yet. */
export async function cookieHeaderFor(url: string, scope: JarScope): Promise<string> {
  try {
    const jar = await jarFor(scope);
    return (await jar.getCookieString(url)) || '';
  } catch {
    return '';
  }
}

/**
 * Store every Set-Cookie the site sent. Called once per redirect hop, because a login typically
 * sets its session cookie on a 302 rather than on the final page.
 */
export async function storeSetCookies(url: string, values: string[], scope: JarScope): Promise<void> {
  if (!values.length) return;
  try {
    const jar = await jarFor(scope);
    for (const line of values) {
      try {
        await jar.setCookie(line, url);
      } catch {
        // A cookie with attributes no browser would accept is dropped, exactly like a browser drops it.
      }
    }
    if (!scope.isPrivate) scheduleFlush();
  } catch (err: any) {
    console.warn(`[cookies] Could not store a cookie for ${url}: ${err?.message}`);
  }
}

/**
 * The non-HttpOnly cookies for this page, for document.cookie emulation in the shim. HttpOnly
 * session cookies stay hidden from page script, the same rule a browser applies.
 */
export async function pageCookiesFor(url: string, scope: JarScope): Promise<string> {
  try {
    const jar = await jarFor(scope);
    const cookies = await jar.getCookies(url);
    return cookies
      .filter((cookie) => !cookie.httpOnly)
      .map((cookie) => `${cookie.key}=${cookie.value}`)
      .join('; ');
  } catch {
    return '';
  }
}

/** A tab closed or left private mode: drop everything it was holding in memory. */
export function forgetTab(tabId: string): void {
  if (tabId) privateJars.delete(tabId);
}

/** "Forget saved logins": wipes the on-disk jar (and its in-memory copy). */
export async function forgetSavedLogins(): Promise<void> {
  privateJars.clear();
  persistentJar = memoryJar();
  loading = Promise.resolve(persistentJar);
  dirty = true;
  await flushSavedLogins();
}

/** How much is saved on this device, for the Settings panel. */
export async function savedLoginSummary(): Promise<{ sites: number; cookies: number }> {
  try {
    const jar = await loadPersistent();
    const { cookies } = await jar.serialize();
    const domains = new Set(cookies.map((c: any) => String(c.domain || '').replace(/^\./, '')).filter(Boolean));
    return { sites: domains.size, cookies: cookies.length };
  } catch {
    return { sites: 0, cookies: 0 };
  }
}
