import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Laptop,
  Smartphone,
  Tablet,
  Monitor,
  Code2,
  Bookmark,
  History,
  Settings,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import { Omnibox } from './Omnibox';
import { BrowserMode, ViewportDevice } from '../../types';

interface NavigationBarProps {
  currentUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isBookmarked: boolean;
  isPrivate: boolean;
  mode: BrowserMode;
  searchEngineId: string;
  viewportDevice: ViewportDevice;
  zoom: number;
  isDevToolsOpen: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onNavigate: (url: string) => void;
  onToggleBookmark: () => void;
  onToggleReaderMode: () => void;
  onSetSearchEngine: (id: string) => void;
  onToggleProxyMode: () => void;
  onTogglePrivateMode: () => void;
  onSetViewportDevice: (device: ViewportDevice) => void;
  onChangeZoom: (delta: number) => void;
  onToggleDevTools: () => void;
  onOpenBookmarks: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  currentUrl,
  isLoading,
  canGoBack,
  canGoForward,
  isBookmarked,
  isPrivate,
  mode,
  searchEngineId,
  viewportDevice,
  zoom,
  isDevToolsOpen,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  onToggleBookmark,
  onToggleReaderMode,
  onSetSearchEngine,
  onToggleProxyMode,
  onTogglePrivateMode,
  onSetViewportDevice,
  onChangeZoom,
  onToggleDevTools,
  onOpenBookmarks,
  onOpenHistory,
  onOpenSettings,
}) => {
  return (
    <div className="flex items-center justify-between h-11 px-3 bg-[#16171b] border-b border-[#24262d] gap-2 select-none">
      {/* Navigation Cluster: Back, Forward, Reload, Home */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          title="Back (Alt+Left)"
          className={`p-1.5 rounded-md transition-colors ${
            canGoBack
              ? 'text-neutral-300 hover:text-white hover:bg-[#252731]'
              : 'text-neutral-600 cursor-not-allowed'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <button
          onClick={onForward}
          disabled={!canGoForward}
          title="Forward (Alt+Right)"
          className={`p-1.5 rounded-md transition-colors ${
            canGoForward
              ? 'text-neutral-300 hover:text-white hover:bg-[#252731]'
              : 'text-neutral-600 cursor-not-allowed'
          }`}
        >
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={onReload}
          title={isLoading ? 'Stop loading' : 'Reload (Ctrl+R)'}
          className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-[#252731] transition-colors"
        >
          {isLoading ? (
            <X className="w-4 h-4 text-amber-400" />
          ) : (
            <RotateCw className="w-4 h-4" />
          )}
        </button>

        <button
          onClick={onHome}
          title="Homepage / Speed Dial"
          className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-[#252731] transition-colors"
        >
          <Home className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Omnibox Address & Search Bar */}
      <Omnibox
        currentUrl={currentUrl}
        isLoading={isLoading}
        isBookmarked={isBookmarked}
        isPrivate={isPrivate}
        mode={mode}
        searchEngineId={searchEngineId}
        onNavigate={onNavigate}
        onToggleBookmark={onToggleBookmark}
        onToggleReaderMode={onToggleReaderMode}
        onSetSearchEngine={onSetSearchEngine}
        onToggleProxyMode={onToggleProxyMode}
        onTogglePrivateMode={onTogglePrivateMode}
      />

      {/* Right Controls: Device Emulator, Zoom, Inspector, History, Bookmarks, Settings */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Viewport Device Mode Switcher */}
        <div className="hidden lg:flex items-center p-0.5 bg-[#1f2129] border border-[#2c2f3a] rounded-lg">
          <button
            onClick={() => onSetViewportDevice('responsive')}
            title="Desktop Fullscreen"
            className={`p-1 rounded text-xs transition-colors ${
              viewportDevice === 'responsive'
                ? 'bg-neutral-800 text-sky-400 font-semibold shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSetViewportDevice('laptop')}
            title="Laptop (1366px)"
            className={`p-1 rounded text-xs transition-colors ${
              viewportDevice === 'laptop'
                ? 'bg-neutral-800 text-sky-400 font-semibold shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSetViewportDevice('tablet')}
            title="Tablet (768px)"
            className={`p-1 rounded text-xs transition-colors ${
              viewportDevice === 'tablet'
                ? 'bg-neutral-800 text-sky-400 font-semibold shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSetViewportDevice('mobile')}
            title="Mobile (390px)"
            className={`p-1 rounded text-xs transition-colors ${
              viewportDevice === 'mobile'
                ? 'bg-neutral-800 text-sky-400 font-semibold shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="hidden xl:flex items-center gap-1 text-[11px] font-mono text-neutral-400 px-1">
          <button
            onClick={() => onChangeZoom(-10)}
            title="Zoom out"
            className="p-1 rounded hover:bg-[#252731] hover:text-neutral-200"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="w-8 text-center tabular-nums">{zoom}%</span>
          <button
            onClick={() => onChangeZoom(10)}
            title="Zoom in"
            className="p-1 rounded hover:bg-[#252731] hover:text-neutral-200"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        <div className="h-4 w-px bg-neutral-800 mx-1" />

        {/* DevTools Inspector Button */}
        <button
          onClick={onToggleDevTools}
          title={isDevToolsOpen ? 'Close DevTools' : 'Open DevTools & Headers Inspector'}
          className={`p-1.5 rounded-md transition-colors ${
            isDevToolsOpen
              ? 'bg-sky-500/20 text-sky-400'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#252731]'
          }`}
        >
          <Code2 className="w-4 h-4" />
        </button>

        {/* Bookmarks Drawer */}
        <button
          onClick={onOpenBookmarks}
          title="All Bookmarks"
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[#252731] transition-colors"
        >
          <Bookmark className="w-4 h-4" />
        </button>

        {/* Browsing History */}
        <button
          onClick={onOpenHistory}
          title="Browsing History"
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[#252731] transition-colors"
        >
          <History className="w-4 h-4" />
        </button>

        {/* Browser Settings */}
        <button
          onClick={onOpenSettings}
          title="Browser Settings"
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[#252731] transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
