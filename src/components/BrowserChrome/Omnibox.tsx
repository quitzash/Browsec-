import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, Lock, ShieldCheck, Star, Copy, Check, BookOpen, ExternalLink, ArrowRight, CornerDownLeft } from 'lucide-react';
import { SearchEngine, BrowserMode } from '../../types';
import { SEARCH_ENGINES } from '../../constants/presets';

interface OmniboxProps {
  currentUrl: string;
  isLoading: boolean;
  isBookmarked: boolean;
  isPrivate: boolean;
  mode: BrowserMode;
  searchEngineId: string;
  onNavigate: (url: string) => void;
  onToggleBookmark: () => void;
  onToggleReaderMode: () => void;
  onSetSearchEngine: (id: string) => void;
  onToggleProxyMode: () => void;
  onTogglePrivateMode: () => void;
}

export const Omnibox: React.FC<OmniboxProps> = ({
  currentUrl,
  isLoading,
  isBookmarked,
  isPrivate,
  mode,
  searchEngineId,
  onNavigate,
  onToggleBookmark,
  onToggleReaderMode,
  onSetSearchEngine,
  onToggleProxyMode,
  onTogglePrivateMode,
}) => {
  const [inputValue, setInputValue] = useState(currentUrl);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentEngine = SEARCH_ENGINES.find((e) => e.id === searchEngineId) || SEARCH_ENGINES[0];

  // Sync input value with current tab URL when not actively editing
  useEffect(() => {
    if (!isFocused) {
      if (!currentUrl || currentUrl === 'apex://newtab' || currentUrl === 'about:blank') {
        setInputValue('');
      } else {
        setInputValue(currentUrl);
      }
    }
  }, [currentUrl, isFocused]);

  // Autocomplete suggestions debouncer
  useEffect(() => {
    if (!isFocused || !inputValue.trim() || inputValue.startsWith('http://') || inputValue.startsWith('https://')) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(inputValue.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
          }
        }
      } catch {
        setSuggestions([]);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [inputValue, isFocused]);

  // Handle outside click to close menus and suggestions
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
        setShowEngineMenu(false);
        setShowSecurityPopover(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleCopyUrl = async () => {
    if (!currentUrl || currentUrl === 'apex://newtab') return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSubmit = (targetUrl?: string) => {
    const query = (targetUrl || inputValue).trim();
    if (!query) return;

    // Check if it's already a full URL or looks like a domain name
    const hasProtocol = /^https?:\/\//i.test(query);
    const hasDomainExtension = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(query);

    let finalUrl = '';
    if (hasProtocol) {
      finalUrl = query;
    } else if (hasDomainExtension) {
      finalUrl = 'https://' + query;
    } else {
      // Search query using chosen search engine
      finalUrl = currentEngine.searchUrl.replace('%s', encodeURIComponent(query));
    }

    setIsFocused(false);
    setSuggestions([]);
    onNavigate(finalUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
        handleSubmit(suggestions[selectedSuggestionIndex]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setIsFocused(false);
      setSuggestions([]);
    }
  };

  const isHome = !currentUrl || currentUrl === 'apex://newtab' || currentUrl === 'about:blank';

  return (
    <div ref={containerRef} className="relative flex-1 max-w-3xl mx-auto">
      <div
        className={`flex items-center h-8.5 px-2.5 rounded-lg border transition-all text-xs ${
          isFocused
            ? 'bg-[#16171b] border-sky-500/80 shadow-md ring-1 ring-sky-500/20'
            : 'bg-[#18191e] border-[#292b34] hover:border-[#383b47]'
        }`}
      >
        {/* Search Engine Picker Button */}
        <div className="relative shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => setShowEngineMenu(!showEngineMenu)}
            title={`Search provider: ${currentEngine.name}. Click to change`}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-[#252731] transition-colors"
          >
            <span className="text-xs">{currentEngine.icon}</span>
          </button>

          {/* Engine Selector Dropdown */}
          {showEngineMenu && (
            <div className="absolute top-8 left-0 z-50 w-44 py-1 bg-[#1c1e24] border border-[#2e313b] rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Search Engine
              </div>
              {SEARCH_ENGINES.map((engine) => (
                <button
                  key={engine.id}
                  onClick={() => {
                    onSetSearchEngine(engine.id);
                    setShowEngineMenu(false);
                  }}
                  className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-left transition-colors ${
                    engine.id === currentEngine.id
                      ? 'bg-sky-500/15 text-sky-300 font-medium'
                      : 'text-neutral-300 hover:bg-[#262832]'
                  }`}
                >
                  <span>{engine.icon}</span>
                  <span className="flex-1">{engine.name}</span>
                  {engine.id === currentEngine.id && <Check className="w-3.5 h-3.5 text-sky-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Security Indicator & Private Browsing Indicator */}
        <div className="relative shrink-0 flex items-center gap-1 mx-1">
          <button
            type="button"
            onClick={() => setShowSecurityPopover(!showSecurityPopover)}
            title={isPrivate ? 'Private Browsing Mode - History is not tracked' : 'View Site Information'}
            className={`p-1 rounded transition-colors flex items-center gap-1 ${
              isPrivate
                ? 'text-purple-400 bg-purple-500/10 hover:bg-purple-500/20'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#252731]'
            }`}
          >
            {isPrivate ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-purple-300">
                <Lock className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline text-[10px]">Private</span>
              </span>
            ) : isHome ? (
              <Search className="w-3.5 h-3.5 text-neutral-400" />
            ) : mode === 'proxy' ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-neutral-400" />
            )}
          </button>

          {/* Security & VPN Popover */}
          {showSecurityPopover && (
            <div className="absolute top-8 left-0 z-50 w-76 p-3.5 bg-[#1c1e24] border border-[#2e313b] rounded-lg shadow-2xl text-xs space-y-2.5">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center gap-2">
                  {isPrivate ? (
                    <Lock className="w-4 h-4 text-purple-400" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="font-semibold text-neutral-100">
                    {isPrivate ? 'Private Browsing Active' : 'Connection Details'}
                  </span>
                </div>
                {isPrivate && (
                  <span className="text-[10px] font-semibold text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded">
                    Isolated
                  </span>
                )}
              </div>

              {isPrivate ? (
                <div className="space-y-1.5 text-neutral-300 text-[11px] leading-relaxed">
                  <p className="text-purple-200/90 font-medium">
                    History tracking is disabled for this tab.
                  </p>
                  <p className="text-neutral-400 text-[10px]">
                    Any session cookies or local storage created during this tab's session will be permanently erased as soon as you close it.
                  </p>
                  <button
                    onClick={() => {
                      onTogglePrivateMode();
                      setShowSecurityPopover(false);
                    }}
                    className="w-full mt-2 py-1 px-2 text-center rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium"
                  >
                    Switch to Standard Tab
                  </button>
                </div>
              ) : (
                <p className="text-neutral-400 leading-relaxed text-[11px]">
                  {mode === 'proxy'
                    ? 'Apex VPN is active. Pages are fetched by a VPN server, which also lifts frame-blocking headers so sites render inside the app.'
                    : 'Direct Sandbox Mode active. Browsing via standard frame container.'}
                </p>
              )}

              <div className="pt-1 flex items-center justify-between border-t border-neutral-800">
                <span className="text-neutral-400 text-[11px]">Connection</span>
                <button
                  onClick={() => {
                    onToggleProxyMode();
                    setShowSecurityPopover(false);
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium"
                >
                  Switch to {mode === 'proxy' ? 'Direct Mode' : 'VPN Mode'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Omnibox Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onFocus={() => {
            setIsFocused(true);
            inputRef.current?.select();
          }}
          onChange={(e) => {
            setInputValue(e.target.value);
            setSelectedSuggestionIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search with DuckDuckGo or enter web address..."
          className="flex-1 bg-transparent border-none outline-none text-neutral-200 placeholder:text-neutral-500 text-xs px-1 tracking-normal font-sans"
        />

        {/* Right side omnibox utilities */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {/* Reader View Toggle Button */}
          {!isHome && (
            <button
              type="button"
              onClick={onToggleReaderMode}
              title={mode === 'reader' ? 'Exit Reader Mode' : 'Toggle Distraction-Free Reader Mode'}
              className={`p-1 rounded transition-colors ${
                mode === 'reader'
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#252731]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Copy URL */}
          {!isHome && (
            <button
              type="button"
              onClick={handleCopyUrl}
              title={copied ? 'Copied!' : 'Copy Address'}
              className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-[#252731] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Star / Bookmark Toggle */}
          {!isHome && (
            <button
              type="button"
              onClick={onToggleBookmark}
              title={isBookmarked ? 'Remove Bookmark' : 'Bookmark this page'}
              className={`p-1 rounded transition-colors ${
                isBookmarked ? 'text-amber-400' : 'text-neutral-400 hover:text-amber-300 hover:bg-[#252731]'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-amber-400' : ''}`} />
            </button>
          )}

          {/* Submit Arrow (when focused with text) */}
          {isFocused && inputValue.trim().length > 0 && (
            <button
              type="button"
              onClick={() => handleSubmit()}
              title="Navigate"
              className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <CornerDownLeft className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Autocomplete Suggestions Dropdown */}
      {isFocused && suggestions.length > 0 && (
        <div className="absolute top-9.5 left-0 right-0 z-50 bg-[#191b22] border border-[#2c2f3a] rounded-lg shadow-2xl overflow-hidden py-1">
          <div className="px-3 py-1 text-[10px] uppercase font-semibold tracking-wider text-neutral-500 flex items-center justify-between">
            <span>Suggestions</span>
            <span>Press Enter ↵</span>
          </div>
          {suggestions.map((sug, idx) => (
            <div
              key={idx}
              onMouseDown={() => handleSubmit(sug)}
              onMouseEnter={() => setSelectedSuggestionIndex(idx)}
              className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs transition-colors ${
                idx === selectedSuggestionIndex
                  ? 'bg-sky-600/20 text-sky-200'
                  : 'text-neutral-300 hover:bg-[#22242e]'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="flex-1 truncate">{sug}</span>
              <ArrowRight className="w-3 h-3 text-neutral-600 shrink-0 opacity-0 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
