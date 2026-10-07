import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

export interface ScannedProxy {
  url: string;
  host: string;
  latencyMs: number;
  stability: number;
  probes: number;
}

export interface ProxyScanResult {
  updatedAt: number;
  durationMs: number;
  tested: number;
  alive: number;
  items: ScannedProxy[];
}

const SOURCES = [
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
];

// Every probe goes over HTTPS (certificates are verified) and the body must contain a marker,
// so a proxy that rewrites or injects content is rejected.
const TARGETS = [
  { url: 'https://example.com/', marker: 'Example Domain' },
  { url: 'https://www.cloudflare.com/cdn-cgi/trace', marker: 'colo=' },
];

const MAX_CANDIDATES = 400;
const STAGE1_CONCURRENCY = 150;
const STAGE1_TIMEOUT_MS = 4000;
const STAGE2_POOL = 24;
const STAGE2_ROUNDS = 4;
const STAGE2_TIMEOUT_MS = 6000;
const MIN_STABILITY = 0.75;
const MAX_RESULTS = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: ProxyScanResult | null = null;
let inflight: Promise<ProxyScanResult> | null = null;

function isPublicIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

async function loadCandidates(): Promise<string[]> {
  // Always fetch the lists directly so a dead upstream proxy can't block finding a replacement.
  const direct = new Agent();
  const lists = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const res = await undiciFetch(source, { dispatcher: direct, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`${source} responded ${res.status}`);
      return res.text();
    }),
  );

  direct.close().catch(() => {});

  const seen = new Set<string>();
  for (const list of lists) {
    if (list.status !== 'fulfilled') continue;
    for (const line of list.value.split(/\r?\n/)) {
      const match = line.trim().match(/^(?:https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/);
      if (!match || !isPublicIPv4(match[1])) continue;
      const port = Number(match[2]);
      if (port < 1 || port > 65535) continue;
      seen.add(`http://${match[1]}:${port}`);
    }
  }

  const all = [...seen];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, MAX_CANDIDATES);
}

async function probe(proxyUrl: string, target: (typeof TARGETS)[number], timeoutMs: number): Promise<number | null> {
  const agent = new ProxyAgent({ uri: proxyUrl, connectTimeout: timeoutMs });
  const started = Date.now();
  try {
    const res = await undiciFetch(target.url, {
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApexProxyCheck/1.0)' },
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.includes(target.marker) ? Date.now() - started : null;
  } catch {
    return null;
  } finally {
    agent.destroy().catch(() => {});
  }
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function scan(): Promise<ProxyScanResult> {
  const started = Date.now();
  const candidates = await loadCandidates();

  // Stage 1: cheap single probe to discard dead proxies.
  const firstPass = await runPool(candidates, STAGE1_CONCURRENCY, async (url) => ({
    url,
    latency: await probe(url, TARGETS[0], STAGE1_TIMEOUT_MS),
  }));
  const survivors = firstPass
    .filter((r): r is { url: string; latency: number } => r.latency !== null)
    .sort((a, b) => a.latency - b.latency)
    .slice(0, STAGE2_POOL);

  // Stage 2: repeated probes against different hosts to measure stability and typical latency.
  const scored = await Promise.all(
    survivors.map(async ({ url, latency }) => {
      const rounds = await Promise.all(
        Array.from({ length: STAGE2_ROUNDS }, (_, i) => probe(url, TARGETS[i % TARGETS.length], STAGE2_TIMEOUT_MS)),
      );
      const okLatencies = [latency, ...rounds.filter((r): r is number => r !== null)];
      const total = rounds.length + 1;
      const proxy: ScannedProxy = {
        url,
        host: url.replace(/^https?:\/\//, ''),
        latencyMs: median(okLatencies),
        stability: okLatencies.length / total,
        probes: total,
      };
      return proxy;
    }),
  );

  const items = scored
    .filter((p) => p.stability >= MIN_STABILITY)
    .sort((a, b) => b.stability - a.stability || a.latencyMs - b.latencyMs)
    .slice(0, MAX_RESULTS);

  return {
    updatedAt: Date.now(),
    durationMs: Date.now() - started,
    tested: candidates.length,
    alive: firstPass.filter((r) => r.latency !== null).length,
    items,
  };
}

export async function getRankedProxies(refresh = false): Promise<ProxyScanResult> {
  if (!refresh && cache && Date.now() - cache.updatedAt < CACHE_TTL_MS) return cache;
  if (!inflight) {
    inflight = scan()
      .then((result) => {
        if (result.items.length > 0 || !cache) cache = result;
        return cache!;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
