import type { CheerioAPI } from 'cheerio';

export interface RewriteCtx {
  tabId: string;
  isPrivate: boolean;
  /** Public origin of this app, e.g. https://host:3000. Rewritten URLs must be absolute, otherwise <base> sends them to the target site. */
  origin: string;
}

const NON_HTTP = /^(data|blob|javascript|about|mailto|tel|sms|chrome|file):/i;

// encodeURIComponent leaves ! ' ( ) * alone, which would terminate an unquoted CSS url(...) early.
function encodeParam(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Path-style proxy URL: /api/proxy/<tab>.<private>/<scheme>/<host>/<path>?<query>
 * Keeping the target's own path structure means relative URLs, `import.meta.url` and bundlers that
 * build chunk URLs by string concatenation keep resolving inside the proxy.
 */
export function proxyPath(abs: string, ctx: RewriteCtx): string {
  const u = new URL(abs);
  const tab = encodeParam(ctx.tabId || '-');
  return `${ctx.origin}/api/proxy/${tab}.${ctx.isPrivate ? 1 : 0}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`;
}

/** Resolve `value` against `base` and point it at the proxy. Leaves non-http(s) values untouched. */
export function toProxied(value: string, base: string, ctx: RewriteCtx): string {
  const v = value.trim();
  if (!v || v.startsWith('#') || NON_HTTP.test(v) || v.startsWith('/api/proxy') || v.startsWith(`${ctx.origin}/api/proxy`)) return value;
  try {
    const url = new URL(v, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    return proxyPath(url.href, ctx);
  } catch {
    return value;
  }
}

export function rewriteSrcset(value: string, base: string, ctx: RewriteCtx): string {
  return value
    .split(/,\s+/)
    .map((part) => {
      const [url, ...descriptor] = part.trim().split(/\s+/);
      if (!url) return part;
      return [toProxied(url, base, ctx), ...descriptor].join(' ');
    })
    .join(', ');
}

export function rewriteCss(css: string, base: string, ctx: RewriteCtx): string {
  return css
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q: string, u: string) => `@import ${q}${toProxied(u, base, ctx)}${q}`)
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (m, q: string, u: string) => {
      const next = toProxied(u, base, ctx);
      return next === u ? m : `url(${q}${next}${q})`;
    });
}

/** Static/dynamic ES module specifiers resolve against the module's own URL, which is now /api/proxy, so make them absolute. */
export function rewriteJsImports(js: string, base: string, ctx: RewriteCtx): string {
  if (!/\b(import|from)\b/.test(js)) return js;
  return js.replace(
    /(\b(?:from|import)\s*\(?\s*)(['"])((?:\.{1,2}\/|\/|https?:\/\/)[^'"\n]*)\2/g,
    (_m, head: string, q: string, spec: string) => `${head}${q}${toProxied(spec, base, ctx)}${q}`,
  );
}

const ASSET_REL = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|apple-touch-icon-precomposed|mask-icon|preload|modulepreload|prefetch|image_src)(\s|$)/i;

const SRC_SELECTORS: [string, string][] = [
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['img[data-src]', 'data-src'],
  ['source[src]', 'src'],
  ['source[data-src]', 'data-src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['embed[src]', 'src'],
  ['iframe[src]', 'src'],
  ['input[type=image][src]', 'src'],
  ['object[data]', 'data'],
];

/** Route every resource a page references through the proxy so the upstream proxy carries them too. */
export function rewriteHtmlResources($: CheerioAPI, base: string, ctx: RewriteCtx): void {
  for (const [selector, attr] of SRC_SELECTORS) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) $(el).attr(attr, toProxied(value, base, ctx));
    });
  }

  for (const attr of ['srcset', 'data-srcset']) {
    $(`img[${attr}], source[${attr}]`).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) $(el).attr(attr, rewriteSrcset(value, base, ctx));
    });
  }

  $('link[href]').each((_, el) => {
    const rel = $(el).attr('rel') || '';
    const href = $(el).attr('href');
    if (href && ASSET_REL.test(rel)) $(el).attr('href', toProxied(href, base, ctx));
  });

  $('style').each((_, el) => {
    const text = $(el).html();
    if (text && (text.includes('url(') || text.includes('@import'))) $(el).html(rewriteCss(text, base, ctx));
  });
  $('[style*="url("]').each((_, el) => {
    const value = $(el).attr('style');
    if (value) $(el).attr('style', rewriteCss(value, base, ctx));
  });

  $('form').each((_, el) => {
    const method = ($(el).attr('method') || 'get').toLowerCase();
    if (method !== 'post') return;
    const action = $(el).attr('action') || base;
    let host = '';
    try {
      host = new URL(action, base).hostname;
    } catch {}
    // DuckDuckGo answers POSTed searches from server IPs with a bot challenge, but the same query as a GET works.
    // GET forms are handled by the page bridge, which needs the real (unproxied) action.
    if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) {
      $(el).attr('method', 'get');
      return;
    }
    $(el).attr('action', toProxied(action, base, ctx));
  });

  // Integrity hashes and CORS modes break once the bytes come from a different origin and path.
  $('script[integrity], link[integrity]').removeAttr('integrity');
  $('script[crossorigin], link[crossorigin], img[crossorigin]').removeAttr('crossorigin');
  $('meta[http-equiv]').each((_, el) => {
    if (/content-security-policy/i.test($(el).attr('http-equiv') || '')) $(el).remove();
  });
}

const SHIM_SOURCE = String.raw`
(function () {
  var CTX = __CTX__;
  // Single-page apps (Next.js, Remix, React Router...) compare location.pathname with the route they were rendered for.
  // Show them their real path instead of /api/proxy/..., or they decide the page is wrong and reload forever.
  try {
    var pageUrl = new URL(CTX.page);
    // An explicit origin is required: a bare path would resolve against <base> (the real site) and be rejected as cross-origin.
    history.replaceState(history.state, '', location.origin + '/' + pageUrl.pathname.replace(/^\/+/, '') + pageUrl.search + pageUrl.hash);
  } catch (e) {}

  var seg = encodeURIComponent(CTX.tabId || '-') + '.' + (CTX.isPrivate === 'true' ? 1 : 0);
  var SKIP = /^(data|blob|javascript|about|mailto|tel|sms):/i;

  // ---- Saved on this device, namespaced per site -------------------------------------------
  // Every site here runs on this app's single origin, so without this all of them (and the app
  // itself) would share one localStorage bucket. Keep each site's data separate in memory, expose
  // it through the normal Storage / document.cookie APIs, and write changes back to the server,
  // which stores them on this device. These references are captured before fetch/sendBeacon get
  // patched below, because the wrapper below would send /api/storage to the real site instead.
  var rawFetch = window.fetch ? window.fetch.bind(window) : null;
  var rawBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  var localData = CTX.local || {};
  var sessionData = CTX.session || {};
  var cookieEntries = {};
  (CTX.docCookies || '').split(';').forEach(function (pair) {
    pair = pair.trim();
    if (!pair) return;
    var eq = pair.indexOf('=');
    if (eq > 0) cookieEntries[pair.slice(0, eq)] = pair;
  });
  var cookieWrites = [];
  var storeTimer = null;

  function postStore(unload) {
    try {
      var payload = {
        token: CTX.token,
        origin: CTX.page ? new URL(CTX.page).origin : '',
        tabId: CTX.tabId || '',
        isPrivate: CTX.isPrivate === 'true',
        local: localData,
        session: sessionData
      };
      if (cookieWrites.length) payload.cookies = cookieWrites.slice();
      var text = JSON.stringify(payload);
      var url = location.origin + '/api/storage';
      if (unload) {
        // This page lives in an iframe that is navigated away the instant it unloads, which can
        // kill a request the page starts itself (ERR_ABORTED). Hand the data to the parent window
        // instead: it outlives this frame and sends it with a keepalive fetch. The beacon stays as
        // a fallback for when the parent is gone too; the endpoint is idempotent, so a double
        // delivery is harmless.
        var handedOff = false;
        try {
          window.parent.postMessage({ type: 'APEX_STORAGE_FLUSH', payload: payload }, '*');
          handedOff = true;
        } catch (e) {}
        if (rawBeacon && text.length < 50000) {
          rawBeacon(url, new Blob([text], { type: 'application/json' }));
          cookieWrites = [];
          return;
        }
        if (handedOff) { cookieWrites = []; return; }
      }
      if (rawFetch) {
        rawFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: text,
          keepalive: !!unload,
          credentials: 'same-origin'
        }).then(function () { cookieWrites = []; }, function () {});
      }
    } catch (e) {}
  }

  function scheduleStore(immediate) {
    if (storeTimer) clearTimeout(storeTimer);
    if (immediate) { storeTimer = null; postStore(true); return; }
    storeTimer = setTimeout(function () { storeTimer = null; postStore(false); }, 350);
  }
  // Last chance to flush before the document goes away.
  window.addEventListener('pagehide', function () { scheduleStore(true); });

  function makeStorage(data) {
    var api = Object.create(window.Storage && Storage.prototype ? Storage.prototype : null);
    api.getItem = function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; };
    api.setItem = function (k, v) { data[String(k)] = String(v); scheduleStore(); };
    api.removeItem = function (k) { delete data[String(k)]; scheduleStore(); };
    api.clear = function () { Object.keys(data).forEach(function (k) { delete data[k]; }); scheduleStore(); };
    api.key = function (i) { var ks = Object.keys(data); return i >= 0 && i < ks.length ? ks[i] : null; };
    Object.defineProperty(api, 'length', { configurable: true, enumerable: false, get: function () { return Object.keys(data).length; } });
    return api;
  }
  var localStore = makeStorage(localData);
  var sessionStore = makeStorage(sessionData);
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return localStore; } });
  } catch (e) {}
  try {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return sessionStore; } });
  } catch (e) {}

  // document.cookie for this site's own cookies, minus HttpOnly ones (those stay server-side, as in
  // a real browser). Assignments are forwarded to the jar with their attributes intact.
  try {
    var cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookieDesc && cookieDesc.get && cookieDesc.set) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        enumerable: cookieDesc.enumerable,
        get: function () {
          return Object.keys(cookieEntries).map(function (k) { return cookieEntries[k]; }).join('; ');
        },
        set: function (line) {
          try {
            line = String(line);
            var first = line.split(';')[0];
            var eq = first.indexOf('=');
            if (eq <= 0) return;
            var name = first.slice(0, eq).trim();
            if (!name) return;
            var dead = false;
            var parts = line.split(';');
            for (var i = 1; i < parts.length; i++) {
              var attr = parts[i].trim().toLowerCase();
              if (attr.indexOf('max-age=') === 0 && parseInt(attr.slice(8), 10) <= 0) dead = true;
              else if (attr.indexOf('expires=') === 0) {
                var when = Date.parse(parts[i].slice(parts[i].indexOf('=') + 1));
                if (!isNaN(when) && when <= Date.now()) dead = true;
              }
            }
            if (dead) delete cookieEntries[name];
            else cookieEntries[name] = first.trim();
            cookieWrites.push(line.trim());
            scheduleStore();
          } catch (e) {}
        }
      });
    }
  } catch (e) {}

  function wrap(u) {
    try {
      if (u == null) return u;
      var s = String(u);
      if (!s || s.charAt(0) === '#' || SKIP.test(s)) return u;
      var abs = new URL(s, document.baseURI);
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return u;
      if (abs.origin === location.origin && abs.pathname.indexOf('/api/proxy') === 0) return u;
      // Pages build URLs from location.origin, which here is this app. They mean their own site.
      // They may also drop the port (location.hostname + path), which lands on plain "localhost".
      if (abs.origin === location.origin || abs.hostname === location.hostname) { try { abs = new URL(abs.pathname + abs.search, CTX.base); } catch (e) {} }
      return location.origin + '/api/proxy/' + seg + '/' + abs.protocol.slice(0, -1) + '/' + abs.host + abs.pathname + abs.search;
    } catch (e) { return u; }
  }

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' || (window.URL && input instanceof URL)) input = wrap(input);
        else if (input && input.url) input = new Request(wrap(input.url), input);
      } catch (e) {}
      return nativeFetch.call(this, input, init);
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = wrap(url);
    return nativeOpen.apply(this, args);
  };

  function wrapSrcset(v) {
    try {
      return String(v).split(/,\s+/).map(function (part) {
        var bits = part.trim().split(/\s+/);
        if (!bits[0]) return part;
        bits[0] = wrap(bits[0]);
        return bits.join(' ');
      }).join(', ');
    } catch (e) { return v; }
  }

  function patchProp(ctor, prop, transform) {
    transform = transform || wrap;
    try {
      if (!ctor) return;
      var d = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(ctor.prototype, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function (v) { d.set.call(this, transform(v)); }
      });
    } catch (e) {}
  }
  patchProp(window.HTMLImageElement, 'src');
  patchProp(window.HTMLScriptElement, 'src');
  patchProp(window.HTMLSourceElement, 'src');
  patchProp(window.HTMLMediaElement, 'src');
  patchProp(window.HTMLIFrameElement, 'src');
  patchProp(window.HTMLLinkElement, 'href');
  patchProp(window.HTMLEmbedElement, 'src');
  patchProp(window.HTMLTrackElement, 'src');
  patchProp(window.HTMLImageElement, 'srcset', wrapSrcset);
  patchProp(window.HTMLSourceElement, 'srcset', wrapSrcset);

  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      var n = String(name).toLowerCase();
      var t = this.tagName;
      if ((n === 'src' && /^(IMG|SCRIPT|SOURCE|VIDEO|AUDIO|IFRAME|EMBED|TRACK|INPUT)$/.test(t)) ||
          (n === 'href' && t === 'LINK') || (n === 'poster' && t === 'VIDEO')) {
        value = wrap(value);
      } else if (n === 'srcset' && (t === 'IMG' || t === 'SOURCE')) {
        value = wrapSrcset(value);
      }
    } catch (e) {}
    return nativeSetAttribute.call(this, name, value);
  };

  if (window.Worker) {
    var NativeWorker = window.Worker;
    window.Worker = function (url, opts) { return new NativeWorker(wrap(url), opts); };
    window.Worker.prototype = NativeWorker.prototype;
  }
  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return nativeBeacon(wrap(url), data); };
  }

  // Pages call pushState with their real URL, which is cross-origin from here and would throw.
  ['pushState', 'replaceState'].forEach(function (key) {
    var native = history[key];
    history[key] = function (state, title, url) {
      try { return native.call(history, state, title, url); }
      catch (e) { return native.call(history, state, title); }
    };
  });
})();
`;

export interface PageState {
  local?: Record<string, string>;
  session?: Record<string, string>;
  docCookies?: string;
  token?: string;
}

export function buildClientShim(
  ctx: Pick<RewriteCtx, 'tabId' | 'isPrivate'>,
  realBase: string,
  pageUrl: string,
  pageState: PageState = {},
): string {
  const payload = JSON.stringify({
    tabId: ctx.tabId,
    isPrivate: ctx.isPrivate ? 'true' : 'false',
    base: realBase,
    page: pageUrl,
    local: pageState.local || {},
    session: pageState.session || {},
    docCookies: pageState.docCookies || '',
    token: pageState.token || '',
  }).replace(/</g, '\\u003c');
  return `<script id="__apex_proxy_shim__">${SHIM_SOURCE.replace('__CTX__', payload)}</script>`;
}
