import express from 'express';
import type { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { Agent, ProxyAgent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import net from 'net';
import { Readable } from 'stream';
import { createHash, createHmac, randomBytes } from 'crypto';
import { getRankedProxies, lookupExit } from './proxy-scanner.ts';
import { connectWarp, setWarpExitHandler, stopWarp, warpStatus } from './warp.ts';
import { AssetCache, Semaphore, pageUrlFromReferer, sendText, type CachedAsset } from './proxy-perf.ts';
import { buildClientShim, rewriteCss, rewriteHtmlResources, rewriteJsImports } from './proxy-rewrite.ts';
import { cookieHeaderFor, forgetSavedLogins, forgetTab, pageCookiesFor, savedLoginSummary, storeSetCookies, type JarScope } from './cookie-store.ts';
import { forgetTab as forgetTabStorage, forgetSavedStorage, readStorage, writeStorage } from './web-storage.ts';

dotenv.config();

// Node races IPv6/IPv4 connection attempts with a 250ms budget each; cold DNS or a slow route makes that fail spuriously.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2000);

const defaultDispatcher = getGlobalDispatcher();

// Free proxies drop connections when a page fires dozens of parallel requests, so queue them instead.
const upstreamGate = new Semaphore(Math.max(1, Number(process.env.UPSTREAM_MAX_CONCURRENCY) || 8));
const assetCache = new AssetCache();

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

type ProxyTestResult = { ok: boolean; latencyMs: number | null; error: string | null; checkedAt: number };

type VpnProvider = 'warp' | 'free' | 'custom' | 'none';

interface UpstreamProxyState {
  enabled: boolean;
  url: string;
  source: 'env' | 'runtime' | 'none';
  /** Which VPN service is behind the upstream address. */
  provider: VpnProvider;
  error: string | null;
  lastTest: ProxyTestResult | null;
}

const upstream: UpstreamProxyState = {
  enabled: false,
  url: '',
  source: 'none',
  provider: 'none',
  error: null,
  lastTest: null,
};

function maskProxyUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return value;
  }
}

function applyUpstreamProxy(): void {
  if (upstream.enabled && !upstream.url) {
    upstream.enabled = false;
    upstream.error = 'A VPN server address is required to connect';
    setGlobalDispatcher(defaultDispatcher);
    return;
  }

  if (!upstream.enabled || !upstream.url) {
    setGlobalDispatcher(defaultDispatcher);
    upstream.error = null;
    return;
  }

  try {
    const parsed = new URL(upstream.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('The VPN server address must start with http:// or https://');
    }
    setGlobalDispatcher(new ProxyAgent(upstream.url));
    upstream.error = null;
  } catch (err: any) {
    upstream.error = err?.message || 'Invalid VPN server address';
    setGlobalDispatcher(defaultDispatcher);
  }
}

// If the WARP tunnel dies, stop sending traffic into a dead local port.
setWarpExitHandler(() => {
  if (upstream.provider !== 'warp') return;
  upstream.enabled = false;
  upstream.url = '';
  upstream.source = 'none';
  upstream.provider = 'none';
  upstream.error = null;
  applyUpstreamProxy();
});

const envProxyUrl = process.env.UPSTREAM_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (envProxyUrl) {
  upstream.url = envProxyUrl;
  upstream.source = 'env';
  upstream.provider = 'custom';
  upstream.enabled = process.env.UPSTREAM_PROXY_ENABLED !== 'false';
  applyUpstreamProxy();
}

async function runProxyTest(): Promise<ProxyTestResult> {
  const started = Date.now();
  try {
    const response = await fetch('https://example.com/', {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    return {
      ok: response.ok,
      latencyMs: Date.now() - started,
      error: response.ok ? null : `Upstream responded with ${response.status}`,
      checkedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: null,
      error: err?.message || 'Connection failed',
      checkedAt: Date.now(),
    };
  }
}

function proxyStatus() {
  return {
    enabled: upstream.enabled,
    url: upstream.url ? maskProxyUrl(upstream.url) : '',
    source: upstream.source,
    provider: upstream.provider,
    error: upstream.error,
    active: upstream.enabled && !upstream.error,
    lastTest: upstream.lastTest,
  };
}

function sanitizeAndValidateUrl(inputUrl: string): { valid: boolean; url?: string; error?: string } {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let formatted = inputUrl.trim();
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
  }

  try {
    const parsed = new URL(formatted);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are supported' };
    }

    const hostname = parsed.hostname.toLowerCase();
    // Opt-in for development: APEX_ALLOW_LOCAL=1 lets the browser reach addresses on this machine
    // (a local dev server, a test fixture). Blocked by default so a hostile page cannot scan the LAN.
    const allowLocal = process.env.APEX_ALLOW_LOCAL === '1';
    const isLocalAddress =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    if (isLocalAddress && !allowLocal) {
      return { valid: false, error: 'Access to private or local network hosts is restricted.' };
    }

    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/** The origin the browser used to reach this server, so rewritten URLs can be absolute. */
function publicOrigin(req: Request): string {
  const first = (value: unknown) => String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol || 'http';
  const host = first(req.headers['x-forwarded-host']) || req.get('host') || 'localhost';
  // Both end up inside HTML/CSS/JS text, so refuse anything that isn't a plain scheme and host[:port].
  if (!/^https?$/.test(proto) || !/^[a-z0-9.\-:\[\]]+$/i.test(host)) return 'http://localhost:3000';
  return `${proto}://${host}`;
}

// Direct mode shows a site inside the app using the visitor's own connection, which only works if the site allows
// being embedded. Look at its framing headers so the app can offer a new tab instead of a broken page.
const frameCache = new Map<string, { frameable: boolean; reason: string; at: number }>();
const directAgent = new Agent();

async function checkFrameable(rawUrl: string): Promise<{ frameable: boolean; reason: string }> {
  const valid = sanitizeAndValidateUrl(rawUrl);
  if (!valid.valid || !valid.url) return { frameable: true, reason: 'unchecked' };
  const target = new URL(valid.url);
  const key = target.origin + target.pathname;
  const cached = frameCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return { frameable: cached.frameable, reason: cached.reason };

  let result = { frameable: true, reason: 'unchecked' };
  try {
    const res = await undiciFetch(valid.url, {
      dispatcher: directAgent,
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    res.body?.cancel().catch(() => {});
    if (res.status >= 400) {
      // Blocked or erroring for this server's address: the headers say nothing about the visitor's browser.
      result = { frameable: true, reason: 'unchecked' };
    } else {
      const csp = res.headers.get('content-security-policy') || '';
      const ancestors = csp.match(/frame-ancestors([^;]*)/i);
      const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
      if (ancestors) {
        const tokens = ancestors[1].trim().split(/\s+/).filter(Boolean);
        result = tokens.includes('*')
          ? { frameable: true, reason: 'allowed' }
          : { frameable: false, reason: 'the site restricts which pages can embed it' };
      } else if (/deny|sameorigin|allow-from/.test(xfo)) {
        result = { frameable: false, reason: 'the site does not allow embedding' };
      } else {
        result = { frameable: true, reason: 'allowed' };
      }
    }
  } catch {
    result = { frameable: true, reason: 'unchecked' };
  }
  frameCache.set(key, { ...result, at: Date.now() });
  return result;
}

// Page script reports what its site stored and any document.cookie assignment. It cannot be trusted
// to name its own site: every proxied site shares this app's single origin in the browser. Each
// document therefore gets a token bound to its real origin and tab and signed with a per-process
// secret; the server derives the site from the token, so one site can never write into another
// site's storage or cookie jar.
const storageSecret = randomBytes(32);

interface StorageSite {
  origin: string;
  tabId: string;
  isPrivate: boolean;
}

function signStorage(site: StorageSite): string {
  return createHmac('sha256', storageSecret).update(`${site.origin}\n${site.tabId}\n${site.isPrivate ? 1 : 0}`).digest('hex');
}

function verifyStorage(body: Record<string, any>): StorageSite | null {
  const site: StorageSite = {
    origin: String(body.origin || ''),
    tabId: String(body.tabId || ''),
    isPrivate: body.isPrivate === true || body.isPrivate === 'true',
  };
  if (!/^https?:\/\/[^/\s]+$/.test(site.origin)) return null;
  const claimed = String(body.token || '');
  const expected = signStorage(site);
  if (claimed.length !== expected.length) return null;
  return site;
}

export function createApiApp(): express.Express {
  const app = express();

  const keepRawBody = (req: any, _res: any, buf: Buffer) => {
    req.rawBody = buf;
  };
  app.use(express.json({ limit: '10mb', verify: keepRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '10mb', verify: keepRawBody }));

  app.post('/api/session/clear', (req: Request, res: Response) => {
    const tabId = ((req.query.tabId || req.body?.tabId) as string) || '';
    const forgetAll = String(req.query.all ?? req.body?.all ?? '') === 'true';
    if (forgetAll) {
      void forgetSavedLogins();
      void forgetSavedStorage();
    }
    if (tabId) {
      // A closed (or de-privatised) tab loses its in-memory session data. Saved logins from regular
      // tabs live on the device and are not touched here.
      forgetTab(tabId);
      forgetTabStorage(tabId);
      console.log(`[Session] Dropped in-memory storage for tab: ${tabId}${forgetAll ? ' and all saved logins' : ''}`);
    }
    return res.json({ success: true, message: `Session for tab ${tabId || 'unknown'} cleared.` });
  });

  // What a proxied page's script saved: localStorage for its site (and sessionStorage for its tab),
  // plus any document.cookie assignments, all written to this device.
  app.post('/api/storage', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const site = verifyStorage(body);
    if (!site) return res.status(403).json({ error: 'Invalid storage token' });
    if (body.local !== undefined || body.session !== undefined) {
      void writeStorage(site, { local: body.local, session: body.session });
    }
    const cookies = Array.isArray(body.cookies)
      ? body.cookies.filter((c: unknown): c is string => typeof c === 'string' && c.length > 0 && c.length <= 4096).slice(0, 30)
      : [];
    if (cookies.length) void storeSetCookies(site.origin, cookies, { isPrivate: site.isPrivate, tabId: site.tabId });
    return res.json({ ok: true });
  });

  // How many logins are stored on this device, for the Settings panel.
  app.get('/api/logins', async (_req: Request, res: Response) => {
    res.json({ logins: await savedLoginSummary() });
  });

  app.get('/api/network', async (req: Request, res: Response) => {
    if (req.query.warp === 'true') {
      return res.json({ warp: warpStatus(), proxy: proxyStatus() });
    }
    if (req.query.frameable === 'true') {
      return res.json(await checkFrameable(String(req.query.url || '')));
    }
    if (req.query.location === 'true') {
      // What websites see right now: the exit of the upstream proxy if one is active, otherwise this server itself.
      const exit = await lookupExit(null, 8000);
      return res.json({ proxy: proxyStatus(), egress: exit, viaProxy: upstream.enabled && !upstream.error });
    }
    if (req.query.proxies === 'true') {
      try {
        const proxies = await getRankedProxies(req.query.refresh === 'true', typeof req.query.country === 'string' ? req.query.country : undefined);
        return res.json({ proxy: proxyStatus(), proxies });
      } catch (err: any) {
        return res.status(502).json({ proxy: proxyStatus(), error: err?.message || 'Proxy scan failed' });
      }
    }
    return res.json({ proxy: proxyStatus() });
  });

  app.post('/api/network', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;
    const rawUrl = body.url ?? query.url;
    const rawEnabled = body.enabled ?? query.enabled;
    const rawTest = body.test ?? query.test;
    const rawRevert = body.revertOnFail ?? query.revertOnFail;
    const rawExpectCountry = body.expectCountry ?? query.expectCountry;
    const rawWarp = body.warp ?? query.warp;
    const rawProvider = body.provider ?? query.provider;
    const previous = { url: upstream.url, enabled: upstream.enabled, source: upstream.source, provider: upstream.provider };
    const restorePrevious = () => {
      upstream.url = previous.url;
      upstream.enabled = previous.enabled;
      upstream.source = previous.source;
      upstream.provider = previous.provider;
      applyUpstreamProxy();
    };

    if (rawWarp === 'connect') {
      try {
        const { url } = await connectWarp();
        upstream.url = url;
        upstream.enabled = true;
        upstream.source = 'runtime';
        upstream.provider = 'warp';
        applyUpstreamProxy();
        upstream.lastTest = await runProxyTest();
        const egress = await lookupExit(null, 9000);
        return res.json({ proxy: proxyStatus(), warp: warpStatus(), egress });
      } catch (err: any) {
        restorePrevious();
        return res.status(502).json({ error: err?.message || 'Could not connect to Cloudflare WARP', proxy: proxyStatus(), warp: warpStatus() });
      }
    }
    if (rawWarp === 'disconnect') {
      await stopWarp();
      if (upstream.provider === 'warp') {
        upstream.enabled = false;
        upstream.url = '';
        upstream.source = 'none';
        upstream.provider = 'none';
        applyUpstreamProxy();
      }
      return res.json({ proxy: proxyStatus(), warp: warpStatus() });
    }

    if (typeof rawUrl === 'string') {
      const next = rawUrl.trim();
      if (!next) {
        upstream.url = '';
        upstream.enabled = false;
        upstream.source = 'none';
        upstream.provider = 'none';
      } else if (next.includes('****') && upstream.url) {
        try {
          const incoming = new URL(next);
          const previous = new URL(upstream.url);
          incoming.password = previous.password;
          upstream.url = incoming.toString();
          upstream.source = 'runtime';
        } catch {
          upstream.url = next;
          upstream.source = 'runtime';
        }
      } else {
        upstream.url = next;
        upstream.source = 'runtime';
        upstream.provider = rawProvider === 'free' ? 'free' : 'custom';
      }
    }

    const enabled = rawEnabled === true || rawEnabled === 'true';
    const disabled = rawEnabled === false || rawEnabled === 'false';
    if (enabled || disabled) {
      upstream.enabled = enabled;
      if (enabled) upstream.source = upstream.source === 'env' ? 'env' : 'runtime';
    }

    // Turning the VPN off while it is WARP means stopping the tunnel, not leaving a helper process running.
    if (upstream.provider === 'warp' && !upstream.enabled) {
      await stopWarp();
      upstream.url = '';
      upstream.source = 'none';
      upstream.provider = 'none';
    }

    applyUpstreamProxy();

    // Once the user has moved to a different server, the WARP tunnel is no longer needed.
    const releaseWarpIfReplaced = async () => {
      if (previous.provider === 'warp' && upstream.provider !== 'warp') await stopWarp();
    };

    if (rawTest === true || rawTest === 'true') {
      upstream.lastTest = await runProxyTest();
      // Picking a proxy from the list must not leave the app on one that just stopped responding.
      if (!upstream.lastTest.ok && (rawRevert === true || rawRevert === 'true')) {
        const failed = upstream.lastTest;
        restorePrevious();
        upstream.lastTest = failed;
        return res.json({ proxy: proxyStatus(), reverted: true });
      }
    }

    // Verify the proxy really exits where we were told, using the exit IP's own country, not the list's claim.
    if (typeof rawExpectCountry === 'string' && /^[A-Za-z]{2}$/.test(rawExpectCountry) && upstream.enabled && !upstream.error) {
      const expected = rawExpectCountry.toUpperCase();
      const exit = await lookupExit(null, 9000);
      if (!exit || exit.countryCode !== expected) {
        restorePrevious();
        return res.json({
          proxy: proxyStatus(),
          reverted: true,
          reason: exit ? `exits in ${exit.country || exit.countryCode}, not ${expected}` : 'could not verify where it exits',
        });
      }
      await releaseWarpIfReplaced();
      return res.json({ proxy: proxyStatus(), egress: exit });
    }

    await releaseWarpIfReplaced();
    return res.json({ proxy: proxyStatus() });
  });

  app.get('/api/suggest', async (req: Request, res: Response) => {
    const query = ((req.query.q as string) || '').trim();
    if (!query) {
      return res.json({ suggestions: [] });
    }

    try {
      const duckDuckGoSuggestUrl = `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`;
      const response = await fetch(duckDuckGoSuggestUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && Array.isArray(data[1])) {
          return res.json({ suggestions: data[1].slice(0, 7) });
        }
      }
    } catch (err) {
      // Graceful fallback
    }

    return res.json({ suggestions: [] });
  });

  app.get('/api/inspect', async (req: Request, res: Response) => {
    const urlParam = req.query.url as string;
    const validation = sanitizeAndValidateUrl(urlParam);
    if (!validation.valid || !validation.url) {
      return res.status(400).json({ error: validation.error || 'Invalid URL' });
    }

    const startTime = Date.now();
    try {
      const targetUrl = validation.url;
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || 'unknown';
      const contentLength = response.headers.get('content-length') || 'chunked';
      const serverHeader = response.headers.get('server') || 'Hidden';

      const headersList: { name: string; value: string }[] = [];
      response.headers.forEach((val, key) => {
        headersList.push({ name: key, value: val });
      });

      let title = '';
      let description = '';
      let ogImage = '';
      let linkCount = 0;
      let imageCount = 0;

      if (contentType.includes('text/html')) {
        const htmlText = await response.text();
        const $ = cheerio.load(htmlText);
        title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || '';
        description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
        ogImage = $('meta[property="og:image"]').attr('content') || '';
        linkCount = $('a[href]').length;
        imageCount = $('img[src]').length;
      }

      return res.json({
        url: targetUrl,
        finalUrl: response.url,
        status: response.status,
        statusText: response.statusText,
        latencyMs,
        contentType,
        contentLength,
        serverHeader,
        headers: headersList,
        meta: {
          title,
          description,
          ogImage,
          linkCount,
          imageCount,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err.message || 'Failed to inspect host',
        latencyMs: Date.now() - startTime,
      });
    }
  });

  app.get('/api/extract', async (req: Request, res: Response) => {
    const urlParam = req.query.url as string;
    const validation = sanitizeAndValidateUrl(urlParam);
    if (!validation.valid || !validation.url) {
      return res.status(400).json({ error: validation.error || 'Invalid URL' });
    }

    try {
      const targetUrl = validation.url;
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: `Target server responded with ${response.status} ${response.statusText}` });
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      $('script, style, noscript, nav, header, footer, iframe, aside, svg, form, .ad, .advertisement, [role="banner"], [role="navigation"]').remove();

      const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled Article';
      const author = $('meta[name="author"]').attr('content') || $('.author, [rel="author"], .byline').first().text().trim() || '';
      const siteName = $('meta[property="og:site_name"]').attr('content') || new URL(targetUrl).hostname;
      const publishedTime = $('meta[property="article:published_time"]').attr('content') || $('time').first().text().trim() || '';
      const leadImage = $('meta[property="og:image"]').attr('content') || $('article img, main img').first().attr('src') || '';

      const elements: { type: 'h2' | 'h3' | 'p' | 'blockquote' | 'img'; text?: string; src?: string; alt?: string }[] = [];
      const container = $('article, main, [role="main"], .post-content, .entry-content, #content, body').first();

      container.find('h2, h3, p, blockquote, img').each((_, el) => {
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'img') {
          let src = $(el).attr('src');
          if (src) {
            try {
              src = new URL(src, targetUrl).toString();
              elements.push({ type: 'img', src, alt: $(el).attr('alt') || '' });
            } catch {
              // ignore bad img url
            }
          }
        } else {
          const text = $(el).text().trim();
          if (text.length > 20 || tagName.startsWith('h')) {
            if (tagName === 'h2' || tagName === 'h3' || tagName === 'p' || tagName === 'blockquote') {
              elements.push({ type: tagName, text });
            }
          }
        }
      });

      const allText = elements.filter(e => e.text).map(e => e.text).join(' ');
      const wordCount = allText.split(/\s+/).filter(Boolean).length;
      const readingTimeMin = Math.max(1, Math.ceil(wordCount / 200));

      return res.json({
        url: targetUrl,
        title,
        author,
        siteName,
        publishedTime,
        leadImage,
        wordCount,
        readingTimeMin,
        elements: elements.slice(0, 150),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to extract article content' });
    }
  });

  app.all(['/api/proxy', '/api/proxy/*'], async (req: Request, res: Response) => {
    // Two address forms: ?url=<target> (top-level navigation) and /api/proxy/<tab>.<private>/<scheme>/<host>/<path> (subresources).
    let urlParam = req.query.url as string;
    let pathTab = '';
    let pathPrivate = false;
    if (req.path.startsWith('/api/proxy/')) {
      const raw = req.originalUrl;
      const q = raw.indexOf('?');
      const rest = (q < 0 ? raw : raw.slice(0, q)).slice('/api/proxy/'.length).split('/');
      const [ctxSeg = '', scheme = '', host = '', ...tail] = rest;
      const dot = ctxSeg.lastIndexOf('.');
      try {
        const tab = decodeURIComponent(dot < 0 ? ctxSeg : ctxSeg.slice(0, dot));
        pathTab = tab === '-' ? '' : tab;
      } catch {}
      pathPrivate = ctxSeg.endsWith('.1');
      urlParam = /^https?$/.test(scheme) && host ? `${scheme}://${host}/${tail.join('/')}${q < 0 ? '' : raw.slice(q)}` : '';
    }
    const validation = sanitizeAndValidateUrl(urlParam);

    if (!validation.valid || !validation.url) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #ededed; display: grid; place-content: center; height: 100vh; margin: 0; text-align: center; }
              .box { max-width: 480px; padding: 32px; border: 1px solid #262626; border-radius: 12px; background: #141414; }
              h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #f87171; }
              p { font-size: 14px; color: #a3a3a3; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>Invalid URL Requested</h1>
              <p>${validation.error || 'Please enter a valid website address in the address bar.'}</p>
            </div>
          </body>
        </html>
      `);
    }

    const targetUrl = validation.url;
    const tabId = pathTab || (req.query.tabId as string) || '';
    const isPrivate = pathPrivate || req.query.isPrivate === 'true';
    const rewriteCtx = { tabId, isPrivate, origin: publicOrigin(req) };
    // Browsers label every request with what it is for; only real documents get interstitials and the injected bridge.
    const dest = String(req.headers['sec-fetch-dest'] || 'document').toLowerCase();
    const isDocument = ['document', 'iframe', 'frame', 'embed', 'object'].includes(dest);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || '*'));
      return res.status(204).end();
    }
    // Cookies come from the jar saved on this device, keyed by the real site's domain and rules.
    // The browser's own cookies are never forwarded: it only knows this app's one origin for all sites.
    const scope: JarScope = { isPrivate, tabId };
    let cookieHeader = await cookieHeaderFor(targetUrl, scope);

    try {
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      const targetOrigin = new URL(targetUrl).origin;
      const pageUrl = pageUrlFromReferer(req.headers.referer);
      const rawLang = String(req.headers['accept-language'] || '');
      const acceptLanguage = /^[\w\-,;=.* ]{2,200}$/.test(rawLang) ? rawLang : 'en-US,en;q=0.9';
      const forwardHeaders: Record<string, string> = isDocument
        ? {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            // The visitor's own language, so sites localise for them rather than for this server.
            'Accept-Language': acceptLanguage,
            'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          }
        : {
            'User-Agent': UA,
            'Accept': String(req.headers.accept || '*/*'),
            'Accept-Language': acceptLanguage,
            // Hotlink protection and CORS checks look at the page that asked, not at the asset's own host.
            'Referer': pageUrl || `${targetOrigin}/`,
          };
      if (!isDocument && pageUrl && (dest === 'empty' || dest === 'font')) {
        forwardHeaders['Origin'] = new URL(pageUrl).origin;
      }

      if (!isDocument && req.headers.range) {
        forwardHeaders['Range'] = String(req.headers.range);
      }
      if (cookieHeader) {
        forwardHeaders['Cookie'] = cookieHeader;
      }

      const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? req.method : 'GET';
      let body: Buffer | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const contentTypeIn = String(req.headers['content-type'] || '');
        if (contentTypeIn) forwardHeaders['Content-Type'] = contentTypeIn;
        forwardHeaders['Origin'] = pageUrl ? new URL(pageUrl).origin : targetOrigin;
        body = (req as any).rawBody as Buffer | undefined;
        if (!body) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          body = Buffer.concat(chunks);
        }
      }

      // Static assets: serve repeats from memory instead of going back through a slow upstream proxy.
      const cacheable = !isDocument && method === 'GET' && !req.headers.range && ['style', 'script', 'image', 'font'].includes(dest);
      const cacheKey = cacheable
        ? `${targetUrl}|${cookieHeader ? createHash('sha1').update(cookieHeader).digest('hex') : ''}`
        : '';

      const emitAsset = async (asset: CachedAsset, state: 'hit' | 'miss') => {
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.setHeader('X-Proxy-Cache', state);
        if (/text\/css/i.test(asset.contentType)) {
          const css = rewriteCss(asset.body.toString('utf8'), asset.finalUrl, rewriteCtx);
          return sendText(req, res, asset.status, 'text/css; charset=utf-8', css);
        }
        if (/javascript|ecmascript/i.test(asset.contentType)) {
          const js = rewriteJsImports(asset.body.toString('utf8'), asset.finalUrl, rewriteCtx);
          return sendText(req, res, asset.status, 'application/javascript; charset=utf-8', js);
        }
        res.status(asset.status);
        res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
        for (const [name, value] of Object.entries(asset.headers)) res.setHeader(name, value);
        res.setHeader('Content-Length', asset.body.length);
        res.end(asset.body);
      };

      const hit = cacheKey ? assetCache.get(cacheKey) : undefined;
      if (hit) return await emitAsset(hit, 'hit');

      let releaseGate: (() => void) | null = null;
      // Queue behind the concurrency cap when an upstream proxy is carrying traffic. Media streams are exempt: they are few and long-lived.
      if (upstream.enabled && !upstream.error && dest !== 'video' && dest !== 'audio') {
        releaseGate = await upstreamGate.acquire();
        res.on('close', releaseGate);
        if (res.destroyed) {
          releaseGate();
          return;
        }
      }

      // Time out waiting for response headers only, so long media streams are not cut off mid-playback.
      const controller = new AbortController();
      res.on('close', () => controller.abort());

      const getSetCookies = (r: FetchResponse): string[] => {
        const headers = r.headers as any;
        if (typeof headers.getSetCookie === 'function') return headers.getSetCookie() || [];
        const single = r.headers.get('set-cookie');
        return single ? [single] : [];
      };

      // Follow redirects by hand. fetch() internally swallows Set-Cookie from intermediate hops, and
      // a login normally sets its session cookie on a 302 on the way to the page it lands on — so
      // each hop's cookies go into this device's jar and the next hop sends them back, the way a
      // browser does. Redirects are also re-cookie'd, and a POST that a 302 turns into a GET.
      const followRedirects = async (): Promise<{ response: FetchResponse; url: string }> => {
        const startCookies = await cookieHeaderFor(targetUrl, scope);
        if (startCookies) forwardHeaders['Cookie'] = startCookies;
        else delete forwardHeaders['Cookie'];
        let hopUrl = targetUrl;
        let hopMethod = method;
        let hopBody = body;
        for (let hop = 0; hop < 20; hop++) {
          const headerTimer = setTimeout(() => controller.abort(), 18000);
          let hopResponse: FetchResponse;
          try {
            hopResponse = await fetch(hopUrl, {
              method: hopMethod,
              headers: forwardHeaders,
              body: hopBody as any,
              redirect: 'manual',
              signal: controller.signal,
            });
          } finally {
            clearTimeout(headerTimer);
          }
          const setCookies = getSetCookies(hopResponse);
          if (setCookies.length) {
            sawSetCookie = true;
            await storeSetCookies(hopUrl, setCookies, scope);
          }
          const location = hopResponse.headers.get('location');
          if (hopResponse.status < 300 || hopResponse.status >= 400 || !location) {
            return { response: hopResponse, url: hopUrl };
          }
          let next: URL;
          try {
            next = new URL(location, hopUrl);
          } catch {
            return { response: hopResponse, url: hopUrl };
          }
          if (next.protocol !== 'http:' && next.protocol !== 'https:') return { response: hopResponse, url: hopUrl };
          // Browser semantics: 301/302/303 turn a POST into a GET (dropping its body); 307/308 replay it.
          if (hopResponse.status !== 307 && hopResponse.status !== 308 && hopMethod !== 'GET' && hopMethod !== 'HEAD') {
            hopMethod = 'GET';
            hopBody = undefined;
            delete forwardHeaders['Content-Type'];
            if (!pageUrl) forwardHeaders['Origin'] = next.origin;
          }
          const nextCookies = await cookieHeaderFor(next.toString(), scope);
          if (nextCookies) forwardHeaders['Cookie'] = nextCookies;
          else delete forwardHeaders['Cookie'];
          hopResponse.body?.cancel?.().catch(() => {});
          hopUrl = next.toString();
        }
        throw new Error('Too many redirects');
      };

      let sawSetCookie = false;
      let fetched: { response: FetchResponse; url: string };
      try {
        try {
          fetched = await followRedirects();
        } catch (firstError: any) {
          // Free proxies and busy hosts drop connections now and then; an idempotent request is safe to retry once.
          if ((method !== 'GET' && method !== 'HEAD') || controller.signal.aborted) throw firstError;
          fetched = await followRedirects();
        }
      } finally {
        // The gate limits connection setup to a flaky proxy; once headers are back the slot is free again,
        // so long-lived bodies (streams, long-polling) don't hold up the rest of the page.
        releaseGate?.();
      }
      const response = fetched.response;
      const finalUrl = fetched.url;
      const contentType = response.headers.get('content-type') || '';

      if (cacheKey && !sawSetCookie && response.status === 200 && Number(response.headers.get('content-length') || 0) <= assetCache.maxItemBytes) {
        const body = Buffer.from(await response.arrayBuffer());
        const extra: Record<string, string> = {};
        for (const name of ['etag', 'last-modified']) {
          const value = response.headers.get(name);
          if (value) extra[name] = value;
        }
        const asset: CachedAsset = { status: 200, contentType, finalUrl, body, headers: extra, storedAt: Date.now() };
        assetCache.set(cacheKey, asset);
        return await emitAsset(asset, 'miss');
      }

      if (isDocument && (response.status === 401 || response.status === 403)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>Access Restricted by Host</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background-color: #0c0d10;
                  color: #f3f4f6;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  padding: 24px;
                  box-sizing: border-box;
                }
                .card {
                  max-width: 540px;
                  width: 100%;
                  background: #16171c;
                  border: 1px solid #282a32;
                  border-radius: 16px;
                  padding: 32px;
                  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                }
                .badge {
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  padding: 4px 10px;
                  background: rgba(239, 68, 68, 0.12);
                  border: 1px solid rgba(239, 68, 68, 0.25);
                  color: #f87171;
                  border-radius: 9999px;
                  font-size: 11px;
                  font-weight: 600;
                  margin-bottom: 16px;
                }
                h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; color: #fff; }
                p { font-size: 13px; line-height: 1.6; color: #9ca3af; margin: 0 0 20px; }
                .url-box {
                  background: #0d0e12;
                  border: 1px solid #23252d;
                  border-radius: 8px;
                  padding: 10px 12px;
                  font-family: monospace;
                  font-size: 11px;
                  color: #cbd5e1;
                  word-break: break-all;
                  margin-bottom: 24px;
                }
                .actions {
                  display: flex;
                  flex-direction: column;
                  gap: 10px;
                }
                button, a {
                  padding: 11px 16px;
                  border-radius: 10px;
                  font-size: 13px;
                  font-weight: 500;
                  cursor: pointer;
                  text-align: center;
                  text-decoration: none;
                  transition: all 0.15s ease;
                  display: block;
                }
                .btn-primary {
                  background: #0284c7;
                  border: 1px solid #0369a1;
                  color: #fff;
                }
                .btn-primary:hover { background: #0369a1; }
                .btn-secondary {
                  background: #23252d;
                  border: 1px solid #333642;
                  color: #e2e8f0;
                }
                .btn-secondary:hover { background: #2d303a; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="badge">HTTP ${response.status} Host Restriction</div>
                <h1>Blocked by this site</h1>
                <p>This website blocks VPN and datacenter addresses from loading its pages.</p>
                <div class="url-box">${targetUrl}</div>
                <div class="actions">
                  <button class="btn-primary" onclick="window.parent.postMessage({type: 'APEX_SWITCH_TO_DIRECT'}, '*')">
                    Switch to Direct Mode (bypasses the VPN)
                  </button>
                  <button class="btn-secondary" onclick="window.parent.postMessage({type: 'APEX_NAVIGATE_TO', url: 'https://duckduckgo.com'}, '*')">
                    Open DuckDuckGo Search
                  </button>
                  <button class="btn-secondary" onclick="window.parent.postMessage({type: 'APEX_NAVIGATE_HOME'}, '*')">
                    Return to Homepage
                  </button>
                </div>
              </div>
            </body>
          </html>
        `);
      }

      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Content-Security-Policy-Report-Only');
      res.removeHeader('Cross-Origin-Embedder-Policy');
      res.removeHeader('Cross-Origin-Opener-Policy');
      res.removeHeader('Cross-Origin-Resource-Policy');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('X-Proxy-Target-Url', finalUrl);

      if (isDocument && contentType.includes('text/html')) {
        const htmlText = await response.text();
        const $ = cheerio.load(htmlText);

        if (htmlText.includes('That’s an error') && (htmlText.includes('401') || htmlText.includes('malformed'))) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <title>Search Provider Notice</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background-color: #0c0d10;
                    color: #f3f4f6;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    padding: 24px;
                    box-sizing: border-box;
                  }
                  .card {
                    max-width: 520px;
                    width: 100%;
                    background: #16171c;
                    border: 1px solid #282a32;
                    border-radius: 16px;
                    padding: 32px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                    text-align: center;
                  }
                  h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; color: #fff; }
                  p { font-size: 13px; line-height: 1.6; color: #9ca3af; margin: 0 0 24px; }
                  .actions { display: flex; flex-direction: column; gap: 10px; }
                  button {
                    padding: 12px 18px;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s ease;
                  }
                  .btn-primary { background: #0284c7; border: 1px solid #0369a1; color: #fff; }
                  .btn-primary:hover { background: #0369a1; }
                  .btn-secondary { background: #23252d; border: 1px solid #333642; color: #e2e8f0; }
                  .btn-secondary:hover { background: #2d303a; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>Google blocks VPN searches</h1>
                  <p>Google blocks VPN and datacenter addresses from loading its search results. Switch to DuckDuckGo for unrestricted live web search, or view Google in Direct Mode.</p>
                  <div class="actions">
                    <button class="btn-primary" onclick="window.parent.postMessage({type: 'APEX_NAVIGATE_TO', url: 'https://duckduckgo.com'}, '*')">
                      Search with DuckDuckGo
                    </button>
                    <button class="btn-secondary" onclick="window.parent.postMessage({type: 'APEX_SWITCH_TO_DIRECT'}, '*')">
                      Switch to Direct Mode
                    </button>
                  </div>
                </div>
              </body>
            </html>
          `);
        }

        $('script').each((_, el) => {
          const scriptContent = $(el).html() || '';
          if (
            scriptContent.includes('top.location') ||
            scriptContent.includes('window.top') ||
            scriptContent.includes('self !== top') ||
            scriptContent.includes('top != self') ||
            scriptContent.includes('window.location.replace')
          ) {
            $(el).remove();
          }
        });

        // Redirect stubs (meta refresh, or a script that just calls location.replace) must navigate through the app,
        // not the real URL, so hand them to the bridge instead of letting them run or silently deleting them.
        const redirects: { url: string; delayMs: number }[] = [];
        $('meta[http-equiv]').each((_, el) => {
          if (($(el).attr('http-equiv') || '').toLowerCase() !== 'refresh') return;
          const match = ($(el).attr('content') || '').match(/^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?['"]?([^'"]+)/i);
          if (!match || !match[2]) return;
          try {
            redirects.push({ url: new URL(match[2].trim(), finalUrl).toString(), delayMs: Math.min(60, Number(match[1] || 0)) * 1000 });
          } catch {}
        });
        $('meta[http-equiv="refresh"]').remove();

        // Honour a <base href> the page already declares, then pin it to an absolute URL.
        let docBase = finalUrl;
        const declaredBase = $('base[href]').first().attr('href');
        if (declaredBase) {
          try {
            docBase = new URL(declaredBase, finalUrl).toString();
          } catch {}
        }
        $('base').remove();

        // Inline scripts that navigate: rewrite only the navigation call, in place, so the rest of the
        // script still runs (storage writes, state setup, timers) and keeps its own timing. Deleting the
        // whole script would destroy page logic; letting a cross-origin navigation run would leave this
        // app's origin. JSON/template data blocks are never touched.
        const navCallPattern =
          /(?:(?:window|document)\.)?(?:parent\.|top\.)?location(?:(?:\.replace|\.assign)\s*\(\s*(['"])([^'"]+)\1\s*\)|(?:\.href\s*=|\s*=)\s*(['"])([^'"]+)\3)/g;
        const executableScriptType = /^(?:text|application)\/(?:x-)?javascript$|^module$|^text\/ecmascript$|^application\/ecmascript$/;
        $('script:not([src])').each((_, el) => {
          const type = (($(el).attr('type') || '') as string).trim().toLowerCase();
          if (type && !executableScriptType.test(type)) return;
          const source = $(el).text();
          if (!/location\s*(?:\.href\s*=|\.replace\s*\(|\.assign\s*\(|\s*=)/.test(source)) return;
          const rewritten = source.replace(navCallPattern, (matched, _q1, callUrl, _q2, assignUrl) => {
            try {
              const target = new URL(String(callUrl ?? assignUrl), docBase);
              if (target.protocol !== 'http:' && target.protocol !== 'https:') return matched;
              return `window.parent.postMessage({ type: 'APEX_NAVIGATE_TO', url: ${JSON.stringify(target.toString()).replace(/</g, '\\u003c')} }, '*')`;
            } catch {
              return matched;
            }
          });
          if (rewritten !== source) $(el).text(rewritten);
        });

        rewriteHtmlResources($, docBase, rewriteCtx);
        // Hand the page its own site's storage and non-HttpOnly cookies inline (site scripts read
        // them on the first line); the shim writes changes back to this device through /api/storage.
        const pageSite: StorageSite = { origin: new URL(finalUrl).origin, tabId, isPrivate };
        const pageStorage = await readStorage(pageSite);
        const docCookies = await pageCookiesFor(finalUrl, scope);
        $('head').prepend(
          `<base href="${docBase}">${buildClientShim(rewriteCtx, docBase, finalUrl, {
            ...pageStorage,
            docCookies,
            token: signStorage(pageSite),
          })}`,
        );

        const bridgeScript = `
        <script id="__apex_browser_bridge__">
          (function() {
            var currentUrl = ${JSON.stringify(finalUrl)};

            function reportMetadata() {
              try {
                var title = document.title || currentUrl;
                var favicon = '';
                var iconLink = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
                if (iconLink && iconLink.href) {
                  favicon = iconLink.href;
                }
                window.parent.postMessage({
                  type: 'APEX_PAGE_LOADED',
                  url: currentUrl,
                  title: title,
                  favicon: favicon
                }, '*');
              } catch(e) {}
            }

            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', reportMetadata);
            } else {
              reportMetadata();
            }

            try {
              var titleEl = document.querySelector('title');
              if (titleEl) {
                new MutationObserver(function() {
                  reportMetadata();
                }).observe(titleEl, { childList: true, subtree: true });
              }
            } catch(e) {}

            document.addEventListener('click', function(e) {
              var target = e.target;
              while (target && target.tagName !== 'A') {
                target = target.parentElement;
              }
              if (!target) return;
              var href = target.getAttribute('href');
              if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

              try {
                var resolved = new URL(href, currentUrl).href;
                try {
                  // Search results link through a tracking redirect; go straight to the destination.
                  var ru = new URL(resolved);
                  var isDdg = ru.hostname === 'duckduckgo.com' || ru.hostname.slice(-14) === '.duckduckgo.com';
                  var isGoogle = ru.hostname.indexOf('google.') !== -1;
                  if (isDdg && ru.pathname === '/l/' && ru.searchParams.get('uddg')) resolved = ru.searchParams.get('uddg');
                  else if (isGoogle && ru.pathname === '/url' && (ru.searchParams.get('q') || ru.searchParams.get('url'))) resolved = ru.searchParams.get('q') || ru.searchParams.get('url');
                } catch(e) {}
                if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
                  e.preventDefault();
                  e.stopPropagation();
                  window.parent.postMessage({
                    type: 'APEX_NAVIGATE_TO',
                    url: resolved
                  }, '*');
                }
              } catch(err) {}
            }, true);

            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form && form.method && form.method.toUpperCase() === 'GET') {
                var action = form.getAttribute('action') || currentUrl;
                try {
                  var actionUrl = new URL(action, currentUrl);
                  var formData = new FormData(form);
                  formData.forEach(function(val, key) {
                    actionUrl.searchParams.append(key, val);
                  });
                  e.preventDefault();
                  window.parent.postMessage({
                    type: 'APEX_NAVIGATE_TO',
                    url: actionUrl.href
                  }, '*');
                } catch(err) {}
              }
            }, true);

            window.addEventListener('scroll', function() {
              try {
                var scrollPercent = (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100;
                window.parent.postMessage({
                  type: 'APEX_PAGE_SCROLL',
                  scrollPercent: Math.min(100, Math.max(0, scrollPercent))
                }, '*');
              } catch(e) {}
            }, { passive: true });
          })();
        </script>
      `;

        const redirect = redirects.sort((a, b) => a.delayMs - b.delayMs)[0];
        const redirectScript = redirect && redirect.url !== finalUrl
          ? `<script>setTimeout(function () { window.parent.postMessage({ type: 'APEX_NAVIGATE_TO', url: ${JSON.stringify(redirect.url).replace(/</g, '\\u003c')} }, '*'); }, ${redirect.delayMs});</script>`
          : '';
        $('head').append(bridgeScript + redirectScript);

        return await sendText(req, res, 200, 'text/html; charset=utf-8', $.html());
      }

      // Subresources, API calls and non-HTML documents.
      // Only cache static assets, and only in the browser's own cache: API responses and pages can be personal,
      // and a shared cache in front of this server must never hand them to someone else.
      if (!isDocument && response.ok && ['style', 'script', 'image', 'font', 'video', 'audio'].includes(dest)) {
        res.setHeader('Cache-Control', 'private, max-age=600');
      } else {
        res.setHeader('Cache-Control', 'no-store');
      }

      if (/text\/css/i.test(contentType)) {
        const css = await response.text();
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        return res.status(response.status).send(rewriteCss(css, finalUrl, rewriteCtx));
      }

      if (/javascript|ecmascript/i.test(contentType)) {
        const js = await response.text();
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.status(response.status).send(rewriteJsImports(js, finalUrl, rewriteCtx));
      }

      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      for (const name of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (!response.headers.get('content-encoding')) {
        const length = response.headers.get('content-length');
        if (length) res.setHeader('Content-Length', length);
      }
      res.status(response.status);
      if (!response.body || method === 'HEAD') return res.end();
      const stream = Readable.fromWeb(response.body as any);
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    } catch (err: any) {
      console.warn(`[proxy] ${req.method} ${targetUrl} failed: ${err?.message}${err?.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
      if (!isDocument) {
        return res.status(502).type('text/plain').send(`VPN fetch failed: ${err?.message || 'unknown error'}`);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const proxyRetryButton = upstream.enabled && !upstream.error
        ? `<button class="btn-secondary" onclick="fetch('/api/network?enabled=false', {method: 'POST'}).then(function () { window.parent.location.reload(); })">Retry Without VPN Server</button>`
        : '';
      return res.status(502).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Navigation Error</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #0c0d0e;
                color: #f3f4f6;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 24px;
                box-sizing: border-box;
              }
              .card {
                max-width: 520px;
                width: 100%;
                background: #17181c;
                border: 1px solid #27282d;
                border-radius: 12px;
                padding: 32px;
                box-shadow: 0 16px 36px rgba(0,0,0,0.4);
              }
              .icon {
                width: 44px;
                height: 44px;
                border-radius: 10px;
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #f87171;
                font-size: 20px;
                margin-bottom: 20px;
              }
              h1 {
                font-size: 20px;
                font-weight: 600;
                margin: 0 0 10px;
                color: #ffffff;
              }
              p {
                font-size: 13px;
                line-height: 1.6;
                color: #9ca3af;
                margin: 0 0 20px;
              }
              .meta {
                background: #0e0f11;
                border: 1px solid #27282d;
                border-radius: 8px;
                padding: 12px 14px;
                font-family: monospace;
                font-size: 12px;
                color: #d1d5db;
                word-break: break-all;
                margin-bottom: 24px;
              }
              .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
              }
              button {
                padding: 10px 18px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
              }
              .btn-primary {
                background: #2563eb;
                border: 1px solid #3b82f6;
                color: #ffffff;
              }
              .btn-primary:hover {
                background: #1d4ed8;
              }
              .btn-secondary {
                background: #27282d;
                border: 1px solid #383a42;
                color: #e5e7eb;
              }
              .btn-secondary:hover {
                background: #32353c;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✕</div>
              <h1>Unable to load website</h1>
              <p>Apex VPN could not establish a connection to the requested address. The host might be unreachable, blocking VPN addresses, or the connection timed out.</p>
              <div class="meta">${targetUrl}</div>
              <div class="actions">
                <button class="btn-primary" onclick="window.location.reload()">Try Again</button>
                <button class="btn-secondary" onclick="window.parent.postMessage({type: 'APEX_NAVIGATE_HOME'}, '*')">Go to Home</button>
                ${proxyRetryButton}
              </div>
            </div>
          </body>
        </html>
      `);
    }
  });

  return app;
}

export const apiApp = createApiApp();
