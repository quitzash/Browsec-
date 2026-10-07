import zlib from 'zlib';
import { promisify } from 'util';
import type { Request, Response } from 'express';

const gzip = promisify(zlib.gzip);

/** Caps how many requests are in flight at once. Free proxies drop connections when flooded with parallel requests. */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /**
   * Waits for a free slot. After `maxWaitMs` the caller proceeds anyway (fail open), so a few slow or hung
   * requests can never starve everything queued behind them.
   */
  acquire(maxWaitMs = 4000): Promise<() => void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grant = () => {
        if (timer) clearTimeout(timer);
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.max) {
        grant();
        return;
      }
      this.queue.push(grant);
      timer = setTimeout(() => {
        const index = this.queue.indexOf(grant);
        if (index !== -1) this.queue.splice(index, 1);
        resolve(() => {});
      }, maxWaitMs);
    });
  }
}

export interface CachedAsset {
  status: number;
  contentType: string;
  finalUrl: string;
  body: Buffer;
  headers: Record<string, string>;
  storedAt: number;
}

/** Small in-memory LRU of upstream responses. Bodies are stored raw; rewriting happens on every hit. */
export class AssetCache {
  private map = new Map<string, CachedAsset>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly ttlMs = 10 * 60 * 1000,
    readonly maxItemBytes = 3 * 1024 * 1024,
  ) {}

  get(key: string): CachedAsset | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, entry: CachedAsset): void {
    if (entry.body.length > this.maxItemBytes) return;
    this.delete(key);
    this.map.set(key, entry);
    this.bytes += entry.body.length;
    for (const oldest of this.map.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(oldest);
    }
  }

  private delete(key: string): void {
    const entry = this.map.get(key);
    if (!entry) return;
    this.bytes -= entry.body.length;
    this.map.delete(key);
  }
}

/** Send text, gzipped when the browser accepts it. The Codespaces/Vercel hop in front of this server is the slow leg. */
export async function sendText(req: Request, res: Response, status: number, contentType: string, text: string): Promise<void> {
  const raw = Buffer.from(text, 'utf8');
  res.status(status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Vary', 'Accept-Encoding');
  if (raw.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    const compressed = await gzip(raw);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', compressed.length);
    res.end(compressed);
    return;
  }
  res.setHeader('Content-Length', raw.length);
  res.end(raw);
}

/** Recover the real page URL from the Referer a proxied page's subresource request carries. */
export function pageUrlFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (u.pathname === '/api/proxy') {
      const target = u.searchParams.get('url');
      return target && /^https?:\/\//i.test(target) ? target : null;
    }
    if (!u.pathname.startsWith('/api/proxy/')) return null;
    const [, scheme = '', host = '', ...tail] = u.pathname.slice('/api/proxy/'.length).split('/');
    if (!/^https?$/.test(scheme) || !host) return null;
    return `${scheme}://${host}/${tail.join('/')}${u.search}`;
  } catch {
    return null;
  }
}
