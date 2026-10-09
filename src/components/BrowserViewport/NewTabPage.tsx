import React, { useState, useEffect } from 'react';
import { Search, Globe, Sparkles, BookOpen, Clock, ArrowUpRight, Compass, KeyRound, ShieldCheck } from 'lucide-react';
import { SPEED_DIAL_SITES, SEARCH_ENGINES, VPN_APPS } from '../../constants/presets';
import { HistoryItem } from '../../types';

interface NewTabPageProps {
  onNavigate: (url: string) => void;
  recentHistory: HistoryItem[];
  defaultSearchEngineId: string;
  isPrivate?: boolean;
}

export const NewTabPage: React.FC<NewTabPageProps> = ({
  onNavigate,
  recentHistory,
  defaultSearchEngineId,
  isPrivate = false,
}) => {
  const [query, setQuery] = useState('');
  const [activeEngineId, setActiveEngineId] = useState(defaultSearchEngineId);
  const [timeString, setTimeString] = useState('');
  const [dateString, setDateString] = useState('');

  const currentEngine = SEARCH_ENGINES.find((e) => e.id === activeEngineId) || SEARCH_ENGINES[0];

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
      );
      setDateString(
        now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (/^https?:\/\//i.test(q) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(q)) {
      onNavigate(/^https?:\/\//i.test(q) ? q : 'https://' + q);
    } else {
      const searchUrl = currentEngine.searchUrl.replace('%s', encodeURIComponent(q));
      onNavigate(searchUrl);
    }
  };

  return (
    <div className={`flex-1 w-full h-full overflow-y-auto ${isPrivate ? 'bg-gradient-to-b from-[#181224] via-[#0f0b18] to-[#0a0710]' : 'bg-gradient-to-b from-[#111215] via-[#0d0e11] to-[#090a0c]'} text-neutral-200 select-text p-6 md:p-12`}>
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[80vh]">
        {/* Private Mode Notice Banner */}
        {isPrivate ? (
          <div className="w-full max-w-2xl mb-8 p-5 rounded-2xl bg-purple-950/30 border border-purple-800/40 text-left shadow-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-purple-100">Private Browsing Tab</h2>
                <p className="text-xs text-purple-300/80">Isolated session with history tracking disabled</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-purple-900/40 text-[11px] text-purple-200/70">
              <div>
                <span className="font-semibold text-purple-300 block mb-0.5">Apex will not save:</span>
                <ul className="list-disc pl-4 space-y-0.5 text-neutral-400">
                  <li>Your browsing history for this tab</li>
                  <li>Search queries entered in the address bar</li>
                  <li>Form entries or cached credentials</li>
                </ul>
              </div>
              <div>
                <span className="font-semibold text-purple-300 block mb-0.5">Session Cleanup:</span>
                <p className="text-neutral-400">
                  All local storage, cached session data, and isolated session cookies for this tab will be immediately erased upon closing this tab.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Live Clock & Date */
          <div className="text-center mb-8">
            <h1 className="text-5xl md:text-6xl font-light tracking-tight text-white mb-2 font-mono tabular-nums">
              {timeString || '12:00 PM'}
            </h1>
            <p className="text-sm font-medium text-neutral-400">
              {dateString || 'Today'}
            </p>
          </div>
        )}

        {/* Central Search Form */}
        <form onSubmit={handleSearch} className="w-full max-w-2xl mb-10">
          <div className="relative group">
            <div className="flex items-center h-13 px-4 bg-[#1a1c23]/90 hover:bg-[#1f222b] focus-within:bg-[#1a1c23] border border-[#2e323e] focus-within:border-sky-500/80 rounded-2xl shadow-xl transition-all">
              <span className="text-lg mr-3 select-none">{currentEngine.icon}</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search the web with ${currentEngine.name} or type a URL...`}
                className="flex-1 bg-transparent border-none outline-none text-neutral-100 placeholder:text-neutral-500 text-sm tracking-normal"
                autoFocus
              />
              <button
                type="submit"
                className="ml-2 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1 shadow-sm"
              >
                <span>Search</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Engine Switcher Tabs */}
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-neutral-400">
              <span className="text-[11px] text-neutral-500">Search with:</span>
              {SEARCH_ENGINES.map((eng) => (
                <button
                  key={eng.id}
                  type="button"
                  onClick={() => setActiveEngineId(eng.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    eng.id === activeEngineId
                      ? 'bg-neutral-800 text-sky-300 border border-neutral-700'
                      : 'hover:text-neutral-200'
                  }`}
                >
                  {eng.name}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Featured Integrated VPN Apps */}
        <div className="w-full mb-10">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Integrated VPN Apps & Services</span>
            </h2>
            <span className="text-xs text-emerald-400/90 font-mono flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Dedicated Portals &amp; Tunnels
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {VPN_APPS.map((app) => (
              <div
                key={app.id}
                className="group relative flex flex-col justify-between p-4 bg-[#161820] hover:bg-[#1c1e28] border border-[#262936] hover:border-[#383d50] rounded-xl transition-all duration-150 hover:-translate-y-0.5 shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-sm"
                      style={{ backgroundColor: `${app.accent}20`, border: `1px solid ${app.accent}40` }}
                    >
                      <span>{app.icon}</span>
                    </div>
                    {app.badge && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase"
                        style={{ backgroundColor: `${app.accent}20`, color: app.accent, border: `1px solid ${app.accent}30` }}
                      >
                        {app.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors">
                    {app.name}
                  </h3>
                  <p className="text-[11px] text-neutral-400 line-clamp-2 mt-1 leading-relaxed">
                    {app.desc}
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-[#232633] flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {app.features.slice(0, 2).map((feat, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                        {feat}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => onNavigate(app.url)}
                    className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-[#2b2e3c] transition-colors"
                    title={`Open ${app.name} portal`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-sky-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Speed Dial Grid */}
        <div className="w-full mb-12">
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              <span>Speed Dial & Top Sites</span>
            </h2>
            <span className="text-xs text-neutral-500 font-mono">Bypasses iframe barriers</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {SPEED_DIAL_SITES.map((site, index) => (
              <button
                key={index}
                onClick={() => onNavigate(site.url)}
                className="group flex flex-col p-3.5 bg-[#17181e] hover:bg-[#1e2028] border border-[#272933] hover:border-[#383c4a] rounded-xl text-left transition-all duration-150 hover:-translate-y-0.5 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-base shadow-xs"
                    style={{ backgroundColor: `${site.accent}25`, border: `1px solid ${site.accent}40` }}
                  >
                    <span>{site.icon}</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-sky-400 transition-colors opacity-0 group-hover:opacity-100" />
                </div>
                <div className="text-xs font-semibold text-neutral-100 group-hover:text-white truncate">
                  {site.title}
                </div>
                <div className="text-[11px] text-neutral-400 truncate mt-0.5">
                  {site.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Recent History Quick Access (suppressed in private browsing mode) */}
        {!isPrivate && recentHistory.length > 0 && (
          <div className="w-full mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3 px-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Recently Visited</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {recentHistory.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.url)}
                  className="flex items-center gap-2.5 p-2 bg-[#14151a] hover:bg-[#1a1c22] border border-[#22242c] rounded-lg text-left transition-colors truncate"
                >
                  <Globe className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-neutral-200 truncate">
                      {item.title || item.url}
                    </div>
                    <div className="text-[10px] text-neutral-500 truncate font-mono">
                      {new URL(item.url).hostname}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feature Badges / Highlights */}
        <div className="w-full pt-6 border-t border-[#1e2028] flex flex-wrap items-center justify-between gap-4 text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>VPN mode removes X-Frame-Options and CORS restrictions</span>
          </div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Click the book icon in the Omnibox anytime for Distraction-Free Reader Mode</span>
          </div>
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Logins and cookies are saved on this device only</span>
          </div>
        </div>
      </div>
    </div>
  );
};
