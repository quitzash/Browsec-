import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

export type SearchEngineId = 'duckduckgo' | 'bing' | 'wikipedia';

export interface ExitInfo {
  ip: string;
  countryCode: string;
  country: string;
  region: string;
  city: string;
  timezone: string;
}

export interface ScannedProxy {
  url: string;
  host: string;
  latencyMs: number;
  stability: number;
  probes: number;
  engines: SearchEngineId[];
  /** Where sites see you when this proxy carries your traffic, measured through the proxy itself. */
  exit?: ExitInfo;
}

export interface ProxyScanResult {
  country?: string;
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

interface Target {
  url: string;
  marker: string;
}

// Every probe goes over HTTPS (certificates are verified) and the body must contain a marker,
// so a proxy that rewrites, blocks or injects content is rejected.
const GENERIC_TARGETS: Target[] = [
  { url: 'https://example.com/', marker: 'Example Domain' },
  { url: 'https://www.cloudflare.com/cdn-cgi/trace', marker: 'colo=' },
];

// Many free proxies load ordinary sites but are blocked by search engines, so search is tested separately.
const ENGINE_TARGETS: Record<SearchEngineId, Target> = {
  duckduckgo: { url: 'https://html.duckduckgo.com/html/?q=cats', marker: 'result__a' },
  bing: { url: 'https://www.bing.com/search?q=cats', marker: 'b_results' },
  wikipedia: { url: 'https://en.wikipedia.org/wiki/Special:Search?search=cats', marker: 'Wikipedia' },
};
const ENGINE_IDS = Object.keys(ENGINE_TARGETS) as SearchEngineId[];

const MAX_CANDIDATES = 700;
const STAGE1_CONCURRENCY = 200;
const STAGE1_TIMEOUT_MS = 4000;
const STAGE2_POOL = 60;
const STAGE2_CONCURRENCY = 200;
const STAGE2_TIMEOUT_MS = 7000;
const MIN_STABILITY = 0.75;
const RECHECK_POOL = 20;
const MAX_RESULTS = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;

const caches = new Map<string, ProxyScanResult>();
const inflights = new Map<string, Promise<ProxyScanResult>>();

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

const COUNTRY_SOURCE = (code: string) =>
  `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/${code}/data.txt`;

async function loadCandidates(country?: string): Promise<string[]> {
  // Always fetch the lists directly so a dead upstream proxy can't block finding a replacement.
  const direct = new Agent();
  const sources = country ? [COUNTRY_SOURCE(country)] : SOURCES;
  const lists = await Promise.allSettled(
    sources.map(async (source) => {
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

async function probe(proxyUrl: string, target: Target, timeoutMs: number): Promise<number | null> {
  const agent = new ProxyAgent({ uri: proxyUrl, connectTimeout: timeoutMs });
  const started = Date.now();
  try {
    const res = await undiciFetch(target.url, {
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
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

function parseExit(data: any): ExitInfo | null {
  // ipwho.is: { success, ip, country, country_code, region, city, timezone: { id } }
  if (data && data.success !== false && data.ip && (data.country_code || data.country)) {
    return {
      ip: String(data.ip),
      countryCode: String(data.country_code || '').toUpperCase(),
      country: String(data.country || ''),
      region: String(data.region || ''),
      city: String(data.city || ''),
      timezone: String(data.timezone?.id || ''),
    };
  }
  // api.country.is fallback: { ip, country: "DE" }
  if (data && data.ip && typeof data.country === 'string' && data.country.length === 2) {
    return { ip: String(data.ip), countryCode: data.country.toUpperCase(), country: data.country.toUpperCase(), region: '', city: '', timezone: '' };
  }
  return null;
}

const GEO_ENDPOINTS = ['https://ipwho.is/', 'https://api.country.is/'];

/** Ask a geolocation service what it sees. With a proxy URL the request goes through that proxy; otherwise through the process default. */
export async function lookupExit(proxyUrl: string | null, timeoutMs = 8000): Promise<ExitInfo | null> {
  for (const endpoint of GEO_ENDPOINTS) {
    const agent = proxyUrl ? new ProxyAgent({ uri: proxyUrl, connectTimeout: timeoutMs }) : undefined;
    try {
      const res = await undiciFetch(endpoint, {
        ...(agent ? { dispatcher: agent } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApexLocationCheck/1.0)' },
      });
      if (!res.ok) continue;
      const exit = parseExit(await res.json());
      if (exit) return exit;
    } catch {
      // try the next endpoint
    } finally {
      agent?.destroy().catch(() => {});
    }
  }
  return null;
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

async function scan(country?: string): Promise<ProxyScanResult> {
  const started = Date.now();
  const candidates = await loadCandidates(country);

  // Stage 1: cheap single probe to discard dead proxies.
  const firstPass = await runPool(candidates, STAGE1_CONCURRENCY, async (url) => ({
    url,
    latency: await probe(url, GENERIC_TARGETS[0], STAGE1_TIMEOUT_MS),
  }));
  const survivors = firstPass
    .filter((r): r is { url: string; latency: number } => r.latency !== null)
    .sort((a, b) => a.latency - b.latency)
    .slice(0, STAGE2_POOL);

  // Stage 2: repeated generic probes measure stability; search-engine probes decide what the proxy is usable for.
  type Job = { url: string; kind: 'generic' | 'engine'; engine?: SearchEngineId; target: Target };
  const jobs: Job[] = [];
  for (const { url } of survivors) {
    for (const target of [GENERIC_TARGETS[1], GENERIC_TARGETS[0], GENERIC_TARGETS[1]]) {
      jobs.push({ url, kind: 'generic', target });
    }
    for (const engine of ENGINE_IDS) jobs.push({ url, kind: 'engine', engine, target: ENGINE_TARGETS[engine] });
  }
  const outcomes = await runPool(jobs, STAGE2_CONCURRENCY, async (job) => ({
    job,
    latency: await probe(job.url, job.target, STAGE2_TIMEOUT_MS),
  }));

  const scored: ScannedProxy[] = survivors.map(({ url, latency }) => {
    const mine = outcomes.filter((o) => o.job.url === url);
    const generic = mine.filter((o) => o.job.kind === 'generic');
    const engineHits = mine.filter((o) => o.job.kind === 'engine' && o.latency !== null);
    const genericOk = generic.filter((o) => o.latency !== null).length + 1;
    const latencies = [
      latency,
      ...generic.filter((o) => o.latency !== null).map((o) => o.latency as number),
      ...engineHits.map((o) => o.latency as number),
    ];
    return {
      url,
      host: url.replace(/^https?:\/\//, ''),
      latencyMs: median(latencies),
      stability: genericOk / (generic.length + 1),
      probes: generic.length + 1 + ENGINE_IDS.length,
      engines: engineHits.map((o) => o.job.engine as SearchEngineId),
    };
  });

  const shortlist = scored
    .filter((p) => p.stability >= MIN_STABILITY && p.engines.length > 0)
    .sort((a, b) => b.engines.length - a.engines.length || b.stability - a.stability || a.latencyMs - b.latencyMs)
    .slice(0, RECHECK_POOL);

  // Final recheck: free proxies die within minutes, so confirm each finalist's claimed engines once more.
  const rechecks = await runPool(
    shortlist.flatMap((p) => p.engines.map((engine) => ({ p, engine }))),
    STAGE2_CONCURRENCY,
    async ({ p, engine }) => ({ p, engine, latency: await probe(p.url, ENGINE_TARGETS[engine], STAGE2_TIMEOUT_MS) }),
  );
  const rechecked = shortlist
    .map((p) => {
      const passed = rechecks.filter((r) => r.p === p && r.latency !== null);
      return {
        ...p,
        engines: passed.map((r) => r.engine),
        latencyMs: passed.length ? median([...passed.map((r) => r.latency as number), p.latencyMs]) : p.latencyMs,
      };
    })
    .filter((p) => p.engines.length > 0);

  // Where does each finalist really exit? Lists are often wrong, so ask a geolocation service through the proxy itself.
  const exits = await Promise.all(rechecked.map((p) => lookupExit(p.url)));
  const items = rechecked
    .map((p, i): ScannedProxy => ({ ...p, exit: exits[i] || undefined }))
    .filter((p) => !country || p.exit?.countryCode === country)
    .sort((a, b) => b.engines.length - a.engines.length || b.stability - a.stability || a.latencyMs - b.latencyMs)
    .slice(0, MAX_RESULTS);

  return {
    country,
    updatedAt: Date.now(),
    durationMs: Date.now() - started,
    tested: candidates.length,
    alive: firstPass.filter((r) => r.latency !== null).length,
    items,
  };
}

export async function getRankedProxies(refresh = false, country?: string): Promise<ProxyScanResult> {
  const code = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
  const key = code || 'any';
  const cached = caches.get(key);
  if (!refresh && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return cached;
  let pending = inflights.get(key);
  if (!pending) {
    pending = scan(code)
      .then((result) => {
        if (result.items.length > 0 || !caches.has(key)) caches.set(key, result);
        return caches.get(key)!;
      })
      .finally(() => {
        inflights.delete(key);
      });
    inflights.set(key, pending);
  }
  return pending;
}
