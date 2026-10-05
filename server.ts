import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT ? Number(process.env.PORT) : 3000;

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper: validate URL to prevent SSRF and handle formatting
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
    // Block local addresses / cloud metadata endpoints
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

// Per-tab session cookie jars for tab isolation and private browsing
const tabCookieJars = new Map<string, string>();

// Endpoint to clear all session cookies and isolated storage for a tab (especially private tabs)
app.post('/api/session/clear', (req: Request, res: Response) => {
  const tabId = (req.query.tabId || req.body?.tabId) as string;
  if (tabId) {
    tabCookieJars.delete(tabId);
    console.log(`[Private Session] Cleared session cookies and storage for tab: ${tabId}`);
  }
  return res.json({ success: true, message: `Session for tab ${tabId || 'unknown'} cleared.` });
});

// 1. Omnibox Autocomplete / Suggestions Endpoint
app.get('/api/suggest', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
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
      // DuckDuckGo returns [query, [sug1, sug2, ...]]
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return res.json({ suggestions: data[1].slice(0, 7) });
      }
    }
  } catch (err) {
    // Graceful fallback
  }

  return res.json({ suggestions: [] });
});

// 2. Page Inspector & Header Diagnostics API
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

// 3. Reader Mode Extractor API
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

    // Remove noise
    $('script, style, noscript, nav, header, footer, iframe, aside, svg, form, .ad, .advertisement, [role="banner"], [role="navigation"]').remove();

    const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled Article';
    const author = $('meta[name="author"]').attr('content') || $('.author, [rel="author"], .byline').first().text().trim() || '';
    const siteName = $('meta[property="og:site_name"]').attr('content') || new URL(targetUrl).hostname;
    const publishedTime = $('meta[property="article:published_time"]').attr('content') || $('time').first().text().trim() || '';
    const leadImage = $('meta[property="og:image"]').attr('content') || $('article img, main img').first().attr('src') || '';

    // Collect article paragraphs & headings
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

    // Word count calculation
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

// 4. Smart Web Proxy Engine
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

  // If user searched via Google (which blocks Cloud Run datacenter proxies with 401),
  // automatically rewrite search queries to DuckDuckGo HTML for flawless results
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
    // Forward requested headers while setting realistic modern browser headers
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

    // Attach isolated session cookies for this tab if available
    if (tabId && tabCookieJars.has(tabId)) {
      forwardHeaders['Cookie'] = tabCookieJars.get(tabId)!;
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

    // If host responds with 401 / 403 or blocks datacenter proxies:
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

    // Capture and isolate any set-cookie response headers for this tab
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader && tabId) {
      const existing = tabCookieJars.get(tabId) || '';
      const combined = existing ? `${existing}; ${setCookieHeader.split(';')[0]}` : setCookieHeader.split(';')[0];
      tabCookieJars.set(tabId, combined);
    }

    // Strip frame-blocking and security restriction headers
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');

    // Add permissive CORS & iframe embedding headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Proxy-Target-Url', finalUrl);

    if (contentType.includes('text/html')) {
      const htmlText = await response.text();
      const $ = cheerio.load(htmlText);

      // Check if page body returned Google's "401. That's an error"
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

      // 1. Remove frame-busting scripts
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

      // 2. Remove meta refresh redirects that break out of iframe
      $('meta[http-equiv="refresh"]').remove();

      // 3. Ensure <base href="..."> is present so relative images, styles, and links resolve
      if ($('base').length === 0) {
        $('head').prepend(`<base href="${finalUrl}">`);
      } else {
        $('base').first().attr('href', finalUrl);
      }

      // 4. Inject Apex Browser Bridge client script
      const bridgeScript = `
        <script id="__apex_browser_bridge__">
          (function() {
            var currentUrl = ${JSON.stringify(finalUrl)};
            
            // Notify parent of initial loaded page metadata
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

            // Title mutation observer
            try {
              var titleEl = document.querySelector('title');
              if (titleEl) {
                new MutationObserver(function() {
                  reportMetadata();
                }).observe(titleEl, { childList: true, subtree: true });
              }
            } catch(e) {}

            // Intercept link clicks to navigate smoothly inside Apex Browser
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
                // If it's http or https, notify browser chrome to navigate
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

            // Intercept form submissions (GET searches)
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

            // Report scroll position for browser scrollbar indicators
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
      // Forward non-HTML content (images, fonts, stylesheets, scripts)
      res.setHeader('Content-Type', contentType);
      const buffer = await response.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
  } catch (err: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
              font-size: 14px;
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
            </div>
          </div>
        </body>
      </html>
    `);
  }
});

// Configure Vite or Static Serve
async function setupServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Browser full-stack server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

setupServer();
