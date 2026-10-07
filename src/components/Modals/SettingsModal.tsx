import React, { useCallback, useEffect, useState } from 'react';
import { BrowserSettings } from '../../types';
import { SEARCH_ENGINES, THEMES } from '../../constants/presets';
import { Settings, X, Shield, Search, Globe, Bookmark, Palette, KeyRound, Network, Activity, RefreshCw, Check, MapPin } from 'lucide-react';

interface UpstreamProxyStatus {
  enabled: boolean;
  url: string;
  source: 'env' | 'runtime' | 'none';
  /** Which VPN service is behind the connection. */
  provider?: 'warp' | 'free' | 'custom' | 'none';
  error: string | null;
  active: boolean;
  lastTest: { ok: boolean; latencyMs: number | null; error: string | null; checkedAt: number } | null;
}

interface RankedProxy {
  url: string;
  host: string;
  latencyMs: number;
  stability: number;
  probes: number;
  engines: string[];
}

const ENGINE_LABELS: Record<string, string> = { duckduckgo: 'DDG', bing: 'Bing', wikipedia: 'Wiki' };

interface ProxyScan {
  updatedAt: number;
  durationMs: number;
  tested: number;
  alive: number;
  items: RankedProxy[];
}

interface GeoInfo {
  ip: string;
  countryCode: string;
  country: string;
  region?: string;
  city?: string;
}

const MATCH_COUNTRIES = [
  'US', 'GB', 'DE', 'FR', 'NL', 'CA', 'AU', 'SG', 'JP', 'IN', 'BR', 'ID', 'TH', 'VN', 'TR', 'RU', 'UA', 'PL', 'IT', 'ES',
  'MX', 'ZA', 'KR', 'HK', 'AE', 'PH', 'PK', 'BD', 'AR', 'CL',
];

const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))) : '🌐';

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
};

const describeGeo = (g: GeoInfo | null) =>
  g ? [g.city, g.region && g.region !== g.city ? g.region : '', g.country || countryName(g.countryCode)].filter(Boolean).join(', ') : '';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: BrowserSettings;
  onUpdateSettings: (newSettings: Partial<BrowserSettings>) => void;
  /** How the active tab reaches sites: 'direct' = this browser's own connection, 'proxy' = through the server. */
  connection: 'direct' | 'proxy';
  onSetConnection: (connection: 'direct' | 'proxy') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  connection,
  onSetConnection,
}) => {
  const [proxy, setProxy] = useState<UpstreamProxyStatus | null>(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<ProxyScan | null>(null);
  // What is stored on this device (shown, and erasable, in Settings).
  const [logins, setLogins] = useState<{ sites: number; cookies: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Location: what sites see (the server or proxy exit) versus where the user really is.
  const [egress, setEgress] = useState<GeoInfo | null>(null);
  const [egressViaProxy, setEgressViaProxy] = useState(false);
  const [realGeo, setRealGeo] = useState<GeoInfo | null>(null);
  const [realFailed, setRealFailed] = useState(false);
  const [matchCountry, setMatchCountry] = useState('');
  // Which VPN service the Connect button uses, and whether the Cloudflare WARP helper can run on this machine.
  const [service, setService] = useState<'warp' | 'free'>('warp');
  const [warp, setWarp] = useState<{ supported: boolean; reason?: string; installed: boolean; registered: boolean; running: boolean } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/network')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.proxy) {
          setProxy(data.proxy);
          setProxyUrl(data.proxy.url);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const refreshEgress = useCallback(async () => {
    try {
      const res = await fetch('/api/network?location=true');
      const data = await res.json();
      setEgress(data.egress || null);
      setEgressViaProxy(!!data.viaProxy);
    } catch {
      setEgress(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    refreshEgress();
    fetch('/api/network?warp=true')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.warp) return;
        setWarp(data.warp);
        if (!data.warp.supported) setService('free');
        else if (data.proxy?.active && data.proxy.provider === 'free') setService('free');
      })
      .catch(() => {});
    fetch('/api/logins')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.logins) setLogins(data.logins);
      })
      .catch(() => {});
    // Looked up by the browser itself, so it reflects the user's own connection and not this server's.
    fetch('https://ipwho.is/')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.success !== false && data.country_code) {
          setRealGeo({ ip: data.ip, countryCode: data.country_code, country: data.country, region: data.region, city: data.city });
          setMatchCountry((prev) => prev || data.country_code);
          setRealFailed(false);
        } else setRealFailed(true);
      })
      .catch(() => !cancelled && setRealFailed(true));
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshEgress]);

  const saveProxy = useCallback(async (payload: { enabled?: boolean; url?: string; test?: boolean; revertOnFail?: boolean; provider?: string }) => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (typeof payload.enabled === 'boolean') params.set('enabled', String(payload.enabled));
      if (typeof payload.url === 'string') params.set('url', payload.url);
      if (payload.test) params.set('test', 'true');
      if (payload.revertOnFail) params.set('revertOnFail', 'true');
      if (payload.provider) params.set('provider', payload.provider);
      const res = await fetch(`/api/network?${params.toString()}`, { method: 'POST' });
      const data = await res.json();
      if (data.proxy) {
        setProxy(data.proxy);
        setProxyUrl(data.proxy.url);
      }
      setNotice(
        data.reverted
          ? 'That VPN server stopped responding, so your previous setting was kept. Pick another or rescan.'
          : null,
      );
    } catch {
      // network failure keeps the previous status on screen
    } finally {
      setBusy(false);
    }
  }, []);

  const scanProxies = useCallback(async (refresh: boolean) => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch(`/api/network?proxies=true${refresh ? '&refresh=true' : ''}`);
      const data = await res.json();
      if (!res.ok || !data.proxies) throw new Error(data.error || 'Scan failed');
      setScan(data.proxies);
    } catch (err: any) {
      setScanError(err?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, []);

  const selectProxy = useCallback(
    (url: string) => saveProxy({ url, enabled: true, test: true, revertOnFail: true, provider: 'free' }),
    [saveProxy],
  );

  const forgetLogins = async () => {
    try {
      await fetch('/api/session/clear?all=true', { method: 'POST' });
      setLogins({ sites: 0, cookies: 0 });
      setNotice('All saved logins and site data were erased from this device.');
    } catch {
      setNotice('Could not erase the saved logins. Try again.');
    }
  };

  const connectWarp = async () => {
    setLocBusy(true);
    setLocMsg(
      warp?.installed && warp?.registered
        ? 'Connecting to Cloudflare WARP…'
        : 'Setting up Cloudflare WARP: downloading two small helper programs and registering a free WARP device. This happens once and takes about 30 seconds…',
    );
    try {
      const res = await fetch('/api/network?warp=connect', { method: 'POST' });
      const data = await res.json();
      if (data.proxy) {
        setProxy(data.proxy);
        setProxyUrl(data.proxy.url);
      }
      if (data.warp) setWarp(data.warp);
      if (!res.ok) {
        setLocMsg(`Could not connect to Cloudflare WARP: ${data.error || 'unknown error'}`);
        return;
      }
      const where = data.egress ? ` Sites now see a Cloudflare address near ${describeGeo(data.egress) || countryName(data.egress.countryCode)}.` : '';
      setLocMsg(`Connected through Cloudflare WARP.${where}`);
      await refreshEgress();
    } catch {
      setLocMsg('Connecting failed. Check your connection and try again.');
    } finally {
      setLocBusy(false);
    }
  };

  const disconnectVpn = async () => {
    if (proxy?.provider === 'warp') {
      setBusy(true);
      try {
        const res = await fetch('/api/network?warp=disconnect', { method: 'POST' });
        const data = await res.json();
        if (data.proxy) {
          setProxy(data.proxy);
          setProxyUrl(data.proxy.url);
        }
        if (data.warp) setWarp(data.warp);
      } catch {
        // keep the previous status on screen
      } finally {
        setBusy(false);
      }
    } else {
      await saveProxy({ enabled: false });
    }
    setLocMsg(null);
    await refreshEgress();
  };

  const matchLocation = async () => {
    const code = matchCountry || realGeo?.countryCode;
    if (!code) return;
    setLocBusy(true);
    setLocMsg(`Looking for a working VPN server that really exits in ${countryName(code)}. This takes about 40 seconds…`);
    try {
      const res = await fetch(`/api/network?proxies=true&country=${code}&refresh=true`);
      const data = await res.json();
      const items: RankedProxy[] = data?.proxies?.items ?? [];
      if (!items.length) {
        setLocMsg(`No working VPN server exits in ${countryName(code)} right now. Try again in a minute, or pick a nearby country.`);
        return;
      }
      for (const item of items.slice(0, 4)) {
        const params = new URLSearchParams({ enabled: 'true', url: item.url, test: 'true', revertOnFail: 'true', expectCountry: code, provider: 'free' });
        const r = await fetch(`/api/network?${params.toString()}`, { method: 'POST' });
        const d = await r.json();
        if (d.proxy) {
          setProxy(d.proxy);
          setProxyUrl(d.proxy.url);
        }
        if (!d.reverted) {
          setLocMsg(`Connected. Sites now see you in ${countryName(code)}.`);
          await refreshEgress();
          return;
        }
      }
      setLocMsg(`Found VPN servers listed for ${countryName(code)}, but none passed the check just now. Try again.`);
    } catch {
      setLocMsg('Connecting failed. Check your connection and try again.');
    } finally {
      setLocBusy(false);
    }
  };

  const isDirect = connection === 'direct';
  const egressCode = egress?.countryCode || '';
  const realCode = realGeo?.countryCode || '';
  // In direct mode the browser itself loads the site, so the server's address is irrelevant.
  const seenAs = isDirect ? realGeo : egress;
  const seenCode = isDirect ? realCode : egressCode;
  const mismatch = !!seenCode && !!realCode && seenCode !== realCode;

  if (!isOpen) return null;

  // Search engines that ride on DuckDuckGo's HTML endpoint need a proxy DuckDuckGo doesn't block.
  const preferredEngine =
    settings.defaultSearchEngine === 'google' ? 'duckduckgo' : settings.defaultSearchEngine;
  const rankedItems = scan
    ? [...scan.items].sort(
        (a, b) =>
          Number(b.engines.includes(preferredEngine)) - Number(a.engines.includes(preferredEngine)),
      )
    : [];

  const statusBadge = !proxy ? (
    <span className="text-[10px] font-medium text-neutral-500">loading…</span>
  ) : proxy.error ? (
    <span className="text-[10px] font-medium text-red-400">error</span>
  ) : proxy.active ? (
    <span className="text-[10px] font-medium text-emerald-400">active</span>
  ) : (
    <span className="text-[10px] font-medium text-neutral-500">off</span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#14151a] border border-[#272932] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#242630]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Browser Preferences</h2>
              <p className="text-[11px] text-neutral-400">Customize navigation & interface</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-[#20222a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh] text-xs">
          {/* Default Search Engine */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-sky-400" />
              <span>Default Search Engine</span>
            </label>
            <p className="text-[11px] text-neutral-400">
              Used when entering keywords directly into the omnibox address bar.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {SEARCH_ENGINES.map((engine) => (
                <button
                  key={engine.id}
                  onClick={() => onUpdateSettings({ defaultSearchEngine: engine.id })}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                    settings.defaultSearchEngine === engine.id
                      ? 'bg-sky-500/15 border-sky-500/50 text-white shadow-xs'
                      : 'bg-[#191b22] border-[#272933] text-neutral-300 hover:bg-[#20222b]'
                  }`}
                >
                  <span className="text-base">{engine.icon}</span>
                  <span className="font-medium text-xs truncate">{engine.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#242630]" />

          {/* Bookmarks Bar Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                <span>Show Bookmarks Bar</span>
              </label>
              <p className="text-[11px] text-neutral-400">
                Display favorite shortcuts directly beneath the navigation bar.
              </p>
            </div>
            <button
              onClick={() => onUpdateSettings({ showBookmarksBar: !settings.showBookmarksBar })}
              className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
                settings.showBookmarksBar ? 'bg-sky-600' : 'bg-neutral-800'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.showBookmarksBar ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="h-px bg-[#242630]" />

          {/* Theme */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-indigo-400" />
              <span>Theme Appearance</span>
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {THEMES.map((th) => (
                <button
                  key={th.id}
                  onClick={() => onUpdateSettings({ theme: th.id as any })}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                    settings.theme === th.id
                      ? 'bg-neutral-800 border-sky-400 text-white ring-1 ring-sky-400/30'
                      : 'bg-[#191b22] border-[#272933] text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full ${th.bg} border ${th.border}`} />
                  <span className="font-medium text-xs">{th.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#242630]" />

          {/* Location */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-white flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-rose-400" />
              <span>VPN &amp; location</span>
            </label>
            <p className="text-[11px] text-neutral-400">
              {isDirect
                ? 'Your own connection: sites see your real address, exactly as in any normal browser.'
                : 'VPN: pages are fetched by a VPN server, so sites see its location instead of yours. This covers this browser only, not your whole device.'}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              {([
                ['direct', 'My own connection', 'Shows your real location'],
                ['proxy', 'VPN', 'Hides your location'],
              ] as const).map(([value, title, hint]) => (
                <button
                  key={value}
                  onClick={() => onSetConnection(value)}
                  className={`text-left p-2.5 rounded-xl border transition-all ${
                    connection === value
                      ? 'bg-sky-500/15 border-sky-500/50 text-white'
                      : 'bg-[#191b22] border-[#272933] text-neutral-300 hover:bg-[#20222b]'
                  }`}
                >
                  <span className="block text-xs font-medium">{title}</span>
                  <span className="block text-[10px] text-neutral-400">{hint}</span>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-[#272933] bg-[#191b22] divide-y divide-[#272933]">
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="text-[11px] text-neutral-400">Sites see you in</span>
                <span className="text-[11px] text-white truncate">
                  {seenAs ? `${flag(seenAs.countryCode)} ${describeGeo(seenAs)}` : isDirect && realFailed ? "couldn't detect" : 'checking…'}
                  <span className="ml-1.5 text-[10px] text-neutral-500">
                    {isDirect ? 'your connection' : egressViaProxy ? (proxy?.provider === 'warp' ? 'via Cloudflare WARP' : 'via VPN') : 'default VPN server'}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="text-[11px] text-neutral-400">You appear to be in</span>
                <span className="text-[11px] text-white truncate">
                  {realGeo ? `${flag(realGeo.countryCode)} ${describeGeo(realGeo)}` : realFailed ? "couldn't detect" : 'checking…'}
                </span>
              </div>
            </div>
            {mismatch && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1.5">
                <p className="text-[11px] text-amber-300">
                  Sites see {countryName(seenCode)}, but you are in {countryName(realCode)}.
                </p>
                <button
                  onClick={() => onSetConnection('direct')}
                  className="px-2.5 py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[11px] font-medium transition-colors"
                >
                  Use my own connection ({countryName(realCode)})
                </button>
              </div>
            )}
            {isDirect && (
              <p className="text-[10px] text-neutral-500 leading-relaxed">
                Sites that don't allow being shown inside another page open in a new tab instead, still on your own connection.
              </p>
            )}
            {!isDirect && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-neutral-400 shrink-0">VPN service</span>
                  <select
                    value={service}
                    onChange={(e) => setService(e.target.value as 'warp' | 'free')}
                    disabled={locBusy}
                    className="flex-1 min-w-0 bg-[#191b22] border border-[#272933] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="warp" disabled={warp?.supported === false}>
                      Cloudflare WARP: fast and reliable
                    </option>
                    <option value="free">Free servers: pick a country, slower</option>
                  </select>
                </div>

                {service === 'warp' ? (
                  <>
                    <div className="flex gap-2">
                      <button
                        onClick={connectWarp}
                        disabled={locBusy || busy || warp?.supported === false}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        <Shield className={`w-3 h-3 ${locBusy ? 'animate-pulse' : ''}`} />
                        {locBusy ? 'Connecting…' : proxy?.active && proxy.provider === 'warp' ? 'Reconnect WARP' : 'Connect WARP'}
                      </button>
                      {proxy?.active && (
                        <button
                          onClick={disconnectVpn}
                          disabled={locBusy || busy}
                          className="px-3 py-2 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-200 hover:bg-[#20222b] text-xs font-medium disabled:opacity-50 transition-colors shrink-0"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                    {warp?.supported === false && <p className="text-[11px] text-amber-400">{warp.reason}</p>}
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                      WARP is Cloudflare's free VPN service. It hides this server's address and is much faster than free servers, but Cloudflare picks the exit near the server, so you cannot choose another country with it. The first connection downloads two small helper programs (checked against published checksums) and registers a free WARP device, which accepts Cloudflare's terms.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <select
                        value={matchCountry}
                        onChange={(e) => setMatchCountry(e.target.value)}
                        disabled={locBusy}
                        className="flex-1 min-w-0 bg-[#191b22] border border-[#272933] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                      >
                        {[...new Set([realCode, ...MATCH_COUNTRIES].filter(Boolean))].map((code) => (
                          <option key={code} value={code}>
                            {flag(code)} {countryName(code)}
                            {code === realCode ? ' (detected)' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={matchLocation}
                        disabled={locBusy || busy || !matchCountry}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium disabled:opacity-50 transition-colors shrink-0"
                      >
                        <MapPin className={`w-3 h-3 ${locBusy ? 'animate-pulse' : ''}`} />
                        {locBusy ? 'Connecting…' : 'Connect VPN'}
                      </button>
                      {proxy?.active && (
                        <button
                          onClick={disconnectVpn}
                          disabled={locBusy || busy}
                          className="px-3 py-2 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-200 hover:bg-[#20222b] text-xs font-medium disabled:opacity-50 transition-colors shrink-0"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                      A free server can only match your country, not your city, and these are run by strangers and are slow. Only use them for things you would not mind a stranger seeing.
                    </p>
                  </>
                )}
                {locMsg && <p className="text-[11px] text-neutral-300 leading-relaxed">{locMsg}</p>}
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Sites that ask your browser for your location get your device's real position either way.
                </p>
              </div>
            )}
          </div>

          {/* Advanced VPN server controls: part of the VPN section above, not a second VPN */}
          <details className="rounded-xl border border-[#272933] bg-[#16181e]">
            <summary className="cursor-pointer select-none list-none flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white">
              <Network className="w-3.5 h-3.5 text-emerald-400" />
              <span>Advanced: choose a VPN server</span>
              {statusBadge}
            </summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-[11px] text-neutral-400">
              Routes every page through a VPN server of your choice, so sites see that server's location. Leave empty to use the default server.
            </p>
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://user:pass@vpn.host:8080"
                spellCheck={false}
                className="flex-1 min-w-0 bg-[#191b22] border border-[#272933] rounded-lg px-2.5 py-2 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-sky-500 font-mono"
              />
              <button
                onClick={() => saveProxy({ url: proxyUrl })}
                disabled={busy}
                className="px-3 py-2 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-200 hover:bg-[#20222b] text-xs font-medium disabled:opacity-50 transition-colors"
              >
                Save
              </button>
            </div>
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-neutral-300">Fastest public VPN servers</span>
                <button
                  onClick={() => scanProxies(!!scan)}
                  disabled={scanning || busy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-200 hover:bg-[#20222b] text-[11px] font-medium disabled:opacity-50 transition-colors shrink-0"
                >
                  <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
                  {scanning ? 'Scanning…' : scan ? 'Rescan' : 'Find fastest'}
                </button>
              </div>
              {scanning && (
                <p className="text-[11px] text-neutral-500">
                  Testing hundreds of free VPN servers for speed and stability. Only servers that can actually load search results are listed. This takes about 30 seconds.
                </p>
              )}
              {scanError && <p className="text-[11px] text-red-400">{scanError}</p>}
              {notice && <p className="text-[11px] text-amber-400">{notice}</p>}
              {scan && !scanning && (
                <>
                  {rankedItems.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">No VPN servers that can load search engines right now. Try rescanning.</p>
                  ) : (
                    <ul className="space-y-1">
                      {rankedItems.map((item, index) => {
                        const selected = !!proxy?.enabled && proxy.url.replace(/\/$/, '') === item.url;
                        return (
                          <li key={item.url}>
                            <button
                              onClick={() => selectProxy(item.url)}
                              disabled={busy}
                              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                                selected
                                  ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                                  : 'bg-[#191b22] border-[#272933] text-neutral-300 hover:bg-[#20222b]'
                              }`}
                            >
                              <span className="w-4 text-[10px] text-neutral-500">{index + 1}</span>
                              <span className="flex-1 min-w-0 truncate font-mono text-[11px]">{item.host}</span>
                              <span className="flex gap-1">
                                {Object.keys(ENGINE_LABELS).map((id) => (
                                  <span
                                    key={id}
                                    className={`px-1 rounded text-[9px] font-medium ${
                                      item.engines.includes(id)
                                        ? id === preferredEngine
                                          ? 'bg-emerald-500/20 text-emerald-300'
                                          : 'bg-sky-500/15 text-sky-300'
                                        : 'bg-neutral-800/60 text-neutral-600 line-through'
                                    }`}
                                  >
                                    {ENGINE_LABELS[id]}
                                  </span>
                                ))}
                              </span>
                              <span className="text-[10px] text-neutral-400 tabular-nums">{item.latencyMs}ms</span>
                              <span
                                className={`text-[10px] tabular-nums ${item.stability >= 1 ? 'text-emerald-400' : 'text-amber-400'}`}
                              >
                                {Math.round(item.stability * 100)}%
                              </span>
                              {selected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-[10px] text-neutral-500 leading-relaxed">
                    Checked {scan.tested} servers, {scan.alive} responded. Badges show which search engines each server can load (the highlighted badge is your default engine). Percent shows how many repeat checks succeeded over HTTPS. Free VPN servers are run by strangers and can see which sites you connect to, so avoid them for sensitive traffic.
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">
                {proxy?.active ? 'VPN server is routing your traffic' : 'Using the default VPN server'}
              </span>
              <button
                onClick={() => saveProxy({ enabled: !proxy?.enabled })}
                disabled={busy || (!!proxy && !proxy.enabled && !proxyUrl.trim())}
                className={`w-10 h-5 rounded-full p-0.5 transition-colors disabled:opacity-40 ${
                  proxy?.enabled ? 'bg-emerald-600' : 'bg-neutral-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    proxy?.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-neutral-400 truncate">
                {proxy?.error
                  ? proxy.error
                  : proxy?.lastTest
                    ? proxy.lastTest.ok
                      ? `Last check: ${proxy.lastTest.latencyMs}ms`
                      : `Last check failed: ${proxy.lastTest.error}`
                    : 'No connection check yet'}
              </span>
              <button
                onClick={() => saveProxy({ test: true })}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-200 hover:bg-[#20222b] text-[11px] font-medium disabled:opacity-50 transition-colors shrink-0"
              >
                <Activity className="w-3 h-3" />
                Test
              </button>
            </div>
          </div>
          </details>

          <div className="h-px bg-[#242630]" />

          {/* How it works */}
          <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
              <Shield className="w-3.5 h-3.5" />
              <span>Apex VPN engine</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Apex fetches pages on a VPN server, removes frame-blocking headers and rewrites links so ordinary sites render inside this app. It is not a device-wide VPN: only pages opened here use it.
            </p>
          </div>

          {/* Saved logins */}
          <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs">
                <KeyRound className="w-3.5 h-3.5" />
                <span>Saved logins</span>
              </div>
              {(logins?.cookies ?? 0) > 0 && (
                <button
                  onClick={forgetLogins}
                  className="px-2.5 py-1 rounded-lg border border-[#272933] bg-[#191b22] text-neutral-300 hover:bg-[#20222b] text-[11px] font-medium transition-colors"
                >
                  Forget saved logins
                </button>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              {logins && logins.cookies > 0
                ? `${logins.cookies} cookies across ${logins.sites} ${logins.sites === 1 ? 'site' : 'sites'} are stored on this device. They belong only to their own site, are never uploaded, and are kept out of the browser so no other site can see them.`
                : 'Nothing saved yet. When you sign in to a site, its cookies are stored on this device only — per site, never uploaded — and stay signed in across reloads and new tabs. Private tabs keep theirs in memory and forget them when closed.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#242630] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
