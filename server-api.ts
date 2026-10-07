import express from 'express';
import type { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

dotenv.config();

const defaultDispatcher = getGlobalDispatcher();

type ProxyTestResult = { ok: boolean; latencyMs: number | null; error: string | null; checkedAt: number };

interface UpstreamProxyState {
  enabled: boolean;
  url: string;
  source: 'env' | 'runtime' | 'none';
  error: string | null;
  lastTest: ProxyTestResult | null;
}

const upstream: UpstreamProxyState = {
  enabled: false,
  url: '',
  source: 'none',
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
    upstream.error = 'A proxy URL is required to enable proxy mode';
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
      throw new Error('Proxy URL must start with http:// or https://');
    }
    setGlobalDispatcher(new ProxyAgent(upstream.url));
    upstream.error = null;
  } catch (err: any) {
    upstream.error = err?.message || 'Invalid proxy configuration';
    setGlobalDispatcher(defaultDispatcher);
  }
}

const envProxyUrl = process.env.UPSTREAM_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (envProxyUrl) {
  upstream.url = envProxyUrl;
  upstream.source = 'env';
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
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { valid: false, error: 'Access to private or local network hosts is restricted.' };
    }

    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function jarCookieName(tabId: string): string {
  return `apex_jar_${tabId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function readCookie(req: Request, name: string): string {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return '';
}

function persistJar(res: Response, name: string, value: string, isPrivate: boolean): void {
  if (!value || value.length > 3000) return;
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(isPrivate ? {} : { maxAge: 7 * 24 * 60 * 60 * 1000 }),
  });
}

export function createApiApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/api/session/clear', (req: Request, res: Response) => {
    const tabId = ((req.query.tabId || req.body?.tabId) as string) || '';
    if (tabId) {
      res.clearCookie(jarCookieName(tabId), { path: '/' });
      console.log(`[Private Session] Cleared session cookies and storage for tab: ${tabId}`);
    }
    return res.json({ success: true, message: `Session for tab ${tabId || 'unknown'} cleared.` });
  });

  app.get('/api/network', (_req: Request, res: Response) => {
    return res.json({ proxy: proxyStatus() });
  });

  app.post('/api/network', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;
    const rawUrl = body.url ?? query.url;
    const rawEnabled = body.enabled ?? query.enabled;
    const rawTest = body.test ?? query.test;

    if (typeof rawUrl === 'string') {
      const next = rawUrl.trim();
      if (!next) {
        upstream.url = '';
        upstream.enabled = false;
        upstream.source = 'none';
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
      }
    }

    const enabled = rawEnabled === true || rawEnabled === 'true';
    const disabled = rawEnabled === false || rawEnabled === 'false';
    if (enabled || disabled) {
      upstream.enabled = enabled;
      if (enabled) upstream.source = upstream.source === 'env' ? 'env' : 'runtime';
    }

    applyUpstreamProxy();

    if (rawTest === true || rawTest === 'true') {
      upstream.lastTest = await runProxyTest();
    }

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

  app.all('/api/proxy', async (req: Request, res: Response) => {
    const urlParam = req.query.url as string;
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

    let targetUrl = validation.url;
    const tabId = (req.query.tabId as string) || '';
    const isPrivate = req.query.isPrivate === 'true';
    const jarName = tabId ? jarCookieName(tabId) : '';
    const existingJar = jarName ? decodeURIComponent(readCookie(req, jarName)) : '';

    try {
      const parsedTarget = new URL(targetUrl);
      if (parsedTarget.hostname.includes('google.') && (parsedTarget.pathname === '/search' || parsedTarget.pathname.startsWith('/search'))) {
        const q = parsedTarget.searchParams.get('q');
        if (q) {
          targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
        }
      }
    } catch {}

    try {
      const forwardHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      };

      if (existingJar) {
        forwardHeaders['Cookie'] = existingJar;
      }

      const fetchOptions: RequestInit = {
        method: req.method === 'POST' ? 'POST' : 'GET',
        headers: forwardHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(18000),
      };

      const response = await fetch(targetUrl, fetchOptions);
      const finalUrl = response.url;
      const contentType = response.headers.get('content-type') || '';

      if (response.status === 401 || response.status === 403) {
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
                <h1>Cloud Proxy Restriction</h1>
                <p>This destination website enforces strict anti-proxy controls that block datacenter IP addresses from rendering its pages.</p>
                <div class="url-box">${targetUrl}</div>
                <div class="actions">
                  <button class="btn-primary" onclick="window.parent.postMessage({type: 'APEX_SWITCH_TO_DIRECT'}, '*')">
                    Switch to Direct Mode (Bypasses Proxy)
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

      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader && jarName) {
        const firstPair = setCookieHeader.split(';')[0];
        const combined = existingJar ? `${existingJar}; ${firstPair}` : firstPair;
        persistJar(res, jarName, combined, isPrivate);
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

      if (contentType.includes('text/html')) {
        const htmlText = await response.text();
        const $ = cheerio.load(htmlText);

        if (htmlText.includes('That’s an error') && (htmlText.includes('401') || htmlText.includes('malformed'))) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <title>Search Provider Proxy Notice</title>
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
                  <h1>Google Search Proxy Notice</h1>
                  <p>Google blocks datacenter cloud proxies from loading its search results directly. Switch to DuckDuckGo for unrestricted live web search, or view Google in Direct Mode.</p>
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

        $('meta[http-equiv="refresh"]').remove();

        if ($('base').length === 0) {
          $('head').prepend(`<base href="${finalUrl}">`);
        } else {
          $('base').first().attr('href', finalUrl);
        }

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

        $('head').append(bridgeScript);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send($.html());
      } else {
        res.setHeader('Content-Type', contentType);
        const buffer = await response.arrayBuffer();
        return res.send(Buffer.from(buffer));
      }
    } catch (err: any) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const proxyRetryButton = upstream.enabled && !upstream.error
        ? `<button class="btn-secondary" onclick="fetch('/api/network?enabled=false', {method: 'POST'}).then(function () { window.parent.location.reload(); })">Retry Without Upstream Proxy</button>`
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
              <p>Apex Browser proxy could not establish a connection to the requested address. The host might be unreachable, blocking automated proxies, or the connection timed out.</p>
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
