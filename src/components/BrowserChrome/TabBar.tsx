import React from 'react';
import { Tab } from '../../types';
import { Plus, X, Globe, Lock, Shield, EyeOff, Pin, Sparkles, ShieldCheck } from 'lucide-react';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
  onNewPrivateTab: () => void;
  onTogglePinTab: (id: string) => void;
  onTogglePrivateTab: (id: string) => void;
  onDuplicateTab: (id: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewPrivateTab,
  onTogglePinTab,
  onTogglePrivateTab,
  onDuplicateTab,
}) => {
  return (
    <div className="flex items-center h-10 px-2 bg-[#121316] border-b border-[#22242a] select-none overflow-x-auto no-scrollbar gap-1">
      {/* Brand mark indicator */}
      <div className="flex items-center gap-2 pl-2 pr-3 shrink-0">
        <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-600 via-indigo-600 to-cyan-400 flex items-center justify-center shadow-xs">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold tracking-tight text-neutral-200">Apex</span>
      </div>

      <div className="h-4 w-px bg-neutral-800 shrink-0 mx-1" />

      {/* Tabs List */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isHomePage = !tab.url || tab.url === 'apex://newtab' || tab.url === 'about:blank';

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onTogglePinTab(tab.id);
              }}
              title={`${tab.isPrivate ? '[Private Browsing] ' : ''}${tab.title || 'New Tab'} - ${tab.url || 'Home'}`}
              className={`group relative flex items-center h-8 transition-all duration-150 cursor-pointer rounded-lg text-xs font-medium border ${
                tab.isPinned ? 'w-9 justify-center px-1' : 'min-w-[130px] max-w-[220px] flex-1 px-2.5'
              } ${
                tab.isPrivate
                  ? isActive
                    ? 'bg-[#1e172a] text-purple-100 border-purple-500/50 shadow-xs'
                    : 'bg-[#171220]/60 hover:bg-[#1c1527] text-purple-300/80 hover:text-purple-200 border-purple-900/40'
                  : isActive
                  ? 'bg-[#1e2026] text-neutral-100 border-[#2f323c] shadow-xs'
                  : 'bg-transparent hover:bg-[#18191f] text-neutral-400 hover:text-neutral-200 border-transparent'
              }`}
            >
              {/* Tab Icon / Favicon / Private Indicator */}
              <div className="shrink-0 flex items-center justify-center w-4 h-4 mr-2">
                {tab.isLoading ? (
                  <div className={`w-3.5 h-3.5 border-2 ${tab.isPrivate ? 'border-purple-400' : 'border-sky-400'} border-t-transparent rounded-full animate-spin`} />
                ) : tab.isPrivate ? (
                  <EyeOff className="w-3.5 h-3.5 text-purple-400" />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                    className="w-3.5 h-3.5 rounded-xs object-contain"
                  />
                ) : (
                  <Globe className={`w-3.5 h-3.5 ${isActive ? 'text-sky-400' : 'text-neutral-500'}`} />
                )}
              </div>

              {/* Title (hidden if pinned) */}
              {!tab.isPinned && (
                <div className="truncate flex-1 text-left flex items-center gap-1.5 min-w-0">
                  <span className="truncate">
                    {isHomePage ? (tab.isPrivate ? 'Private Tab' : 'New Tab') : tab.title || tab.displayUrl || 'Loading...'}
                  </span>
                  {tab.isPrivate && (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-purple-400/80 bg-purple-500/10 px-1 py-0.2 rounded">
                      Private
                    </span>
                  )}
                </div>
              )}

              {/* Pinned Icon Indicator */}
              {tab.isPinned && (
                <Pin className="w-2.5 h-2.5 text-neutral-500 group-hover:text-neutral-300" />
              )}

              {/* Tab Controls: Toggle Private & Close */}
              {!tab.isPinned && (
                <div className="flex items-center shrink-0 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePrivateTab(tab.id);
                    }}
                    title={tab.isPrivate ? 'Switch to Standard Tab' : 'Switch to Private Browsing Mode'}
                    className={`p-1 rounded-sm transition-colors ${
                      tab.isPrivate
                        ? 'text-purple-400 hover:text-purple-200 hover:bg-purple-900/50'
                        : 'text-neutral-400 hover:text-purple-300 hover:bg-neutral-700/60'
                    }`}
                  >
                    <EyeOff className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={(e) => onCloseTab(tab.id, e)}
                    title="Close tab (clears private storage on close)"
                    className="p-1 rounded-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Tab Action Buttons: New Tab & New Private Tab */}
        <div className="flex items-center gap-0.5 shrink-0 pl-1">
          <button
            onClick={onNewTab}
            title="Open new tab (Ctrl+T)"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-[#1f2128] transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={onNewPrivateTab}
            title="Open new private tab (Ctrl+Shift+N) - Disables history tracking & clears storage on close"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-purple-400 hover:text-purple-200 hover:bg-purple-950/40 border border-purple-900/40 transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px] font-medium">Private</span>
          </button>
        </div>
      </div>
    </div>
  );
};
