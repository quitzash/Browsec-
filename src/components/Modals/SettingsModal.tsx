import React from 'react';
import { BrowserSettings } from '../../types';
import { SEARCH_ENGINES, THEMES } from '../../constants/presets';
import { Settings, X, Shield, Search, Globe, Bookmark, Palette } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: BrowserSettings;
  onUpdateSettings: (newSettings: Partial<BrowserSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

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

          {/* Smart Proxy & Anti-Blocker Information */}
          <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
              <Shield className="w-3.5 h-3.5" />
              <span>Smart Frame Proxy Engine</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Apex Browser utilizes a server-side streaming proxy that removes restrictive frame-ancestors, CSP, and X-Frame-Options policies, injecting relative base tags so that standard web pages render directly inside this application.
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
