/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tab, Bookmark, HistoryItem, BrowserSettings, ViewportDevice } from './types';
import { DEFAULT_BOOKMARKS } from './constants/presets';
import { TabBar } from './components/BrowserChrome/TabBar';
import { NavigationBar } from './components/BrowserChrome/NavigationBar';
import { BookmarksBar } from './components/BrowserChrome/BookmarksBar';
import { WebFrame } from './components/BrowserViewport/WebFrame';
import { NewTabPage } from './components/BrowserViewport/NewTabPage';
import { ReaderView } from './components/BrowserViewport/ReaderView';
import { DevToolsDrawer } from './components/DevTools/DevToolsDrawer';
import { BookmarksDrawer } from './components/Modals/BookmarksDrawer';
import { HistoryDrawer } from './components/Modals/HistoryDrawer';
import { SettingsModal } from './components/Modals/SettingsModal';
import { ShieldCheck, EyeOff, X } from 'lucide-react';

const INITIAL_TAB: Tab = {
  id: 'tab-1',
  url: 'apex://newtab',
  displayUrl: 'apex://newtab',
  title: 'New Tab',
  isLoading: false,
  history: ['apex://newtab'],
  historyIndex: 0,
  isPinned: false,
  isPrivate: false,
  mode: 'proxy',
  scrollPercent: 0,
  zoom: 100,
};

const DEFAULT_SETTINGS: BrowserSettings = {
  defaultSearchEngine: 'duckduckgo',
  homeUrl: 'apex://newtab',
  theme: 'dark',
  showBookmarksBar: true,
  blockTrackers: true,
};

export default function App() {
  // Tabs State
  const [tabs, setTabs] = useState<Tab[]>([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // Viewport Device Simulation State
  const [viewportDevice, setViewportDevice] = useState<ViewportDevice>('responsive');

  // Bookmarks State (with LocalStorage persistence)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      const saved = localStorage.getItem('apex_bookmarks');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return DEFAULT_BOOKMARKS;
  });

  // History State (with LocalStorage persistence)
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('apex_history');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  });

  // Settings State
  const [settings, setSettings] = useState<BrowserSettings>(() => {
    try {
      const saved = localStorage.getItem('apex_settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  // Modals & Panels State
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Private Session Toast Notification
  const [privateToast, setPrivateToast] = useState<string | null>(null);

  // Sync state to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('apex_bookmarks', JSON.stringify(bookmarks));
    } catch {}
  }, [bookmarks]);

  useEffect(() => {
    try {
      localStorage.setItem('apex_history', JSON.stringify(history));
    } catch {}
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem('apex_settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Active Tab Finder
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // History record helper with Private Browsing Guard
  const recordHistory = useCallback((url: string, isPrivate: boolean, title?: string, favicon?: string) => {
    // If private browsing is enabled for this tab, do NOT track history!
    if (!url || url === 'apex://newtab' || url === 'about:blank' || isPrivate) {
      return;
    }
    const newItem: HistoryItem = {
      id: 'hist-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      url,
      title: title || url,
      visitedAt: Date.now(),
      favicon,
    };
    setHistory((prev) => [newItem, ...prev.filter((i) => i.url !== url)].slice(0, 200));
  }, []);

  // Tab Navigation Handler
  const handleNavigate = useCallback((url: string) => {
    let currentIsPrivate = false;
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        currentIsPrivate = t.isPrivate;
        // Truncate forward history if navigating to new page
        const newHistory = [...t.history.slice(0, t.historyIndex + 1), url];
        return {
          ...t,
          url,
          displayUrl: url,
          isLoading: url !== 'apex://newtab' && url !== 'about:blank',
          history: newHistory,
          historyIndex: newHistory.length - 1,
        };
      })
    );

    // Only record if NOT private
    if (!currentIsPrivate) {
      recordHistory(url, false);
    }
  }, [activeTabId, recordHistory]);

  // Tab History: Back
  const handleBack = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId || t.historyIndex <= 0) return t;
        const newIndex = t.historyIndex - 1;
        const prevUrl = t.history[newIndex];
        return {
          ...t,
          url: prevUrl,
          displayUrl: prevUrl,
          historyIndex: newIndex,
          isLoading: prevUrl !== 'apex://newtab',
        };
      })
    );
  }, [activeTabId]);

  // Tab History: Forward
  const handleForward = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId || t.historyIndex >= t.history.length - 1) return t;
        const newIndex = t.historyIndex + 1;
        const nextUrl = t.history[newIndex];
        return {
          ...t,
          url: nextUrl,
          displayUrl: nextUrl,
          historyIndex: newIndex,
          isLoading: nextUrl !== 'apex://newtab',
        };
      })
    );
  }, [activeTabId]);

  // Reload Tab
  const handleReload = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          isLoading: true,
          url: t.url,
        };
      })
    );
  }, [activeTabId]);

  // Home Navigation
  const handleHome = useCallback(() => {
    handleNavigate('apex://newtab');
  }, [handleNavigate]);

  // New Regular Tab Creator
  const handleNewTab = useCallback((initialUrl: string = 'apex://newtab') => {
    const newId = 'tab-' + Date.now();
    const newTabObj: Tab = {
      id: newId,
      url: initialUrl,
      displayUrl: initialUrl,
      title: initialUrl === 'apex://newtab' ? 'New Tab' : 'Loading...',
      isLoading: initialUrl !== 'apex://newtab',
      history: [initialUrl],
      historyIndex: 0,
      isPinned: false,
      isPrivate: false,
      mode: 'proxy',
      scrollPercent: 0,
      zoom: 100,
    };
    setTabs((prev) => [...prev, newTabObj]);
    setActiveTabId(newId);
  }, []);

  // New Private Tab Creator
  const handleNewPrivateTab = useCallback((initialUrl: string = 'apex://newtab') => {
    const newId = 'tab-private-' + Date.now();
    const newTabObj: Tab = {
      id: newId,
      url: initialUrl,
      displayUrl: initialUrl,
      title: initialUrl === 'apex://newtab' ? 'Private Tab' : 'Loading...',
      isLoading: initialUrl !== 'apex://newtab',
      history: [initialUrl],
      historyIndex: 0,
      isPinned: false,
      isPrivate: true,
      mode: 'proxy',
      scrollPercent: 0,
      zoom: 100,
    };
    setTabs((prev) => [...prev, newTabObj]);
    setActiveTabId(newId);
  }, []);

  // Toggle Private Mode on an existing tab
  const handleTogglePrivateTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const newIsPrivate = !t.isPrivate;
        if (!newIsPrivate) {
          // If turning off private mode, clear any proxy session cookies
          fetch(`/api/session/clear?tabId=${encodeURIComponent(tabId)}`, { method: 'POST' }).catch(() => {});
        }
        return {
          ...t,
          isPrivate: newIsPrivate,
          title: t.url === 'apex://newtab' ? (newIsPrivate ? 'Private Tab' : 'New Tab') : t.title,
        };
      })
    );
  }, []);

  // Close Tab with Private Session Storage & Cookie Cleanup
  const handleCloseTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Check if the tab being closed is a Private Tab
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (tabToClose?.isPrivate) {
      // 1. Clear isolated session cookies and proxy storage on the server
      fetch(`/api/session/clear?tabId=${encodeURIComponent(tabId)}`, { method: 'POST' }).catch(() => {});

      // 2. Clear any local storage and session storage data associated with this private tab session
      try {
        sessionStorage.removeItem(`apex_session_${tabId}`);
        localStorage.removeItem(`apex_session_${tabId}`);
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.includes(tabId)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (err) {
        // ignore
      }

      // 3. User feedback confirmation
      setPrivateToast('Private tab closed. History was not recorded and local session storage was cleared.');
      setTimeout(() => setPrivateToast(null), 3800);
    }

    setTabs((prevTabs) => {
      if (prevTabs.length === 1) {
        // If last tab is closed, reset it to new regular tab
        return [
          {
            ...INITIAL_TAB,
            id: 'tab-' + Date.now(),
          },
        ];
      }
      return prevTabs.filter((t) => t.id !== tabId);
    });

    // If active tab was closed, switch active to adjacent tab
    if (activeTabId === tabId) {
      setTabs((currentTabs) => {
        const remaining = currentTabs.filter((t) => t.id !== tabId);
        if (remaining.length > 0) {
          setActiveTabId(remaining[remaining.length - 1].id);
        }
        return remaining;
      });
    }
  }, [activeTabId, tabs]);

  // Toggle Tab Pin
  const handleTogglePinTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isPinned: !t.isPinned } : t))
    );
  }, []);

  // Duplicate Tab
  const handleDuplicateTab = useCallback((tabId: string) => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target) return;
    const newId = 'tab-' + Date.now();
    setTabs((prev) => [
      ...prev,
      {
        ...target,
        id: newId,
        history: [...target.history],
      },
    ]);
    setActiveTabId(newId);
  }, [tabs]);

  // Update Page Metadata (title & favicon) from bridge script
  const handleUpdateMetadata = useCallback((title: string, favicon?: string) => {
    let isTabPrivate = false;
    let tabUrl = '';

    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        isTabPrivate = t.isPrivate;
        tabUrl = t.url;
        return {
          ...t,
          title: title || t.title,
          favicon: favicon || t.favicon,
          isLoading: false,
        };
      })
    );

    // Only update history entry if NOT a private tab!
    if (!isTabPrivate && tabUrl && tabUrl !== 'apex://newtab') {
      setHistory((prev) =>
        prev.map((h) =>
          h.url === tabUrl
            ? { ...h, title: title || h.title, favicon: favicon || h.favicon }
            : h
        )
      );
    }
  }, [activeTabId]);

  // Set Tab Loading State
  const handleSetLoading = useCallback((loading: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: loading } : t))
    );
  }, [activeTabId]);

  // Zoom Adjuster
  const handleChangeZoom = useCallback((delta: number) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        const newZoom = Math.min(175, Math.max(70, t.zoom + delta));
        return { ...t, zoom: newZoom };
      })
    );
  }, [activeTabId]);

  // Reader Mode Toggle
  const handleToggleReaderMode = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          mode: t.mode === 'reader' ? 'proxy' : 'reader',
        };
      })
    );
  }, [activeTabId]);

  // Proxy Mode Toggle (Proxy vs Direct)
  const handleToggleProxyMode = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          mode: t.mode === 'proxy' ? 'direct' : 'proxy',
        };
      })
    );
  }, [activeTabId]);

  // Bookmarking Feature
  const isCurrentBookmarked = bookmarks.some((b) => b.url === activeTab?.url);

  const handleToggleBookmark = useCallback(() => {
    if (!activeTab?.url || activeTab.url === 'apex://newtab') return;

    if (isCurrentBookmarked) {
      setBookmarks((prev) => prev.filter((b) => b.url !== activeTab.url));
    } else {
      const newBm: Bookmark = {
        id: 'bm-' + Date.now(),
        title: activeTab.title || activeTab.url,
        url: activeTab.url,
        favicon: activeTab.favicon,
        category: 'General',
        createdAt: Date.now(),
      };
      setBookmarks((prev) => [newBm, ...prev]);
    }
  }, [activeTab, isCurrentBookmarked]);

  const handleAddBookmark = useCallback((newBm: Omit<Bookmark, 'id' | 'createdAt'>) => {
    const bookmarkItem: Bookmark = {
      ...newBm,
      id: 'bm-' + Date.now(),
      createdAt: Date.now(),
    };
    setBookmarks((prev) => [bookmarkItem, ...prev]);
  }, []);

  const handleRemoveBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleUpdateBookmark = useCallback((id: string, title: string, category: string) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, title, category } : b))
    );
  }, []);

  // History Actions
  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const handleRemoveHistoryItem = useCallback((id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }, []);

  // Settings Actions
  const handleUpdateSettings = useCallback((newSettings: Partial<BrowserSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + N: New Private Tab
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewPrivateTab();
      }
      // Ctrl/Cmd + T: New Tab
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      }
      // Ctrl/Cmd + W: Close Active Tab
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleCloseTab(activeTabId);
      }
      // Ctrl/Cmd + R: Reload
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleReload();
      }
      // Ctrl/Cmd + D: Bookmark current page
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleToggleBookmark();
      }
      // Ctrl/Cmd + B: Toggle Bookmarks Bar
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSettings((s) => ({ ...s, showBookmarksBar: !s.showBookmarksBar }));
      }
      // Ctrl/Cmd + H: Open History
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsHistoryOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewTab, handleNewPrivateTab, handleCloseTab, activeTabId, handleReload, handleToggleBookmark]);

  const canGoBack = activeTab ? activeTab.historyIndex > 0 : false;
  const canGoForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;
  const isHomePage = !activeTab?.url || activeTab.url === 'apex://newtab' || activeTab.url === 'about:blank';

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0d0e11] text-neutral-100 font-sans select-none">
      {/* 1. Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={() => handleNewTab()}
        onNewPrivateTab={() => handleNewPrivateTab()}
        onTogglePinTab={handleTogglePinTab}
        onTogglePrivateTab={handleTogglePrivateTab}
        onDuplicateTab={handleDuplicateTab}
      />

      {/* 2. Navigation Bar (Omnibox, Controls, DevTools) */}
      <NavigationBar
        currentUrl={activeTab?.url || ''}
        isLoading={activeTab?.isLoading || false}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isBookmarked={isCurrentBookmarked}
        isPrivate={activeTab?.isPrivate || false}
        mode={activeTab?.mode || 'proxy'}
        searchEngineId={settings.defaultSearchEngine}
        viewportDevice={viewportDevice}
        zoom={activeTab?.zoom || 100}
        isDevToolsOpen={isDevToolsOpen}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onHome={handleHome}
        onNavigate={handleNavigate}
        onToggleBookmark={handleToggleBookmark}
        onToggleReaderMode={handleToggleReaderMode}
        onSetSearchEngine={(id) => handleUpdateSettings({ defaultSearchEngine: id })}
        onToggleProxyMode={handleToggleProxyMode}
        onTogglePrivateMode={() => handleTogglePrivateTab(activeTabId)}
        onSetViewportDevice={setViewportDevice}
        onChangeZoom={handleChangeZoom}
        onToggleDevTools={() => setIsDevToolsOpen((prev) => !prev)}
        onOpenBookmarks={() => setIsBookmarksOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 3. Bookmarks Bar (Quick Access Strip) */}
      {settings.showBookmarksBar && (
        <BookmarksBar
          bookmarks={bookmarks}
          onNavigate={handleNavigate}
          onRemoveBookmark={handleRemoveBookmark}
          onAddCurrentPage={handleToggleBookmark}
        />
      )}

      {/* 4. Active Viewport */}
      <main className="flex-1 relative overflow-hidden flex flex-col bg-[#0a0a0c]">
        {isHomePage ? (
          <NewTabPage
            onNavigate={handleNavigate}
            recentHistory={history}
            defaultSearchEngineId={settings.defaultSearchEngine}
            isPrivate={activeTab?.isPrivate || false}
          />
        ) : activeTab.mode === 'reader' ? (
          <ReaderView
            url={activeTab.url}
            onExitReader={handleToggleReaderMode}
            onNavigate={handleNavigate}
          />
        ) : (
          <WebFrame
            key={activeTab.id + '-' + activeTab.url}
            url={activeTab.url}
            tabId={activeTab.id}
            isPrivate={activeTab.isPrivate || false}
            mode={activeTab.mode}
            zoom={activeTab.zoom}
            viewportDevice={viewportDevice}
            isLoading={activeTab.isLoading}
            onNavigate={handleNavigate}
            onUpdateMetadata={handleUpdateMetadata}
            onSetLoading={handleSetLoading}
            onSwitchToDirect={handleToggleProxyMode}
          />
        )}

        {/* 5. Developer Tools & Inspector Drawer */}
        <DevToolsDrawer
          isOpen={isDevToolsOpen}
          onClose={() => setIsDevToolsOpen(false)}
          url={activeTab?.url || ''}
          onNavigate={handleNavigate}
        />
      </main>

      {/* 6. Bookmarks Manager Drawer */}
      <BookmarksDrawer
        isOpen={isBookmarksOpen}
        onClose={() => setIsBookmarksOpen(false)}
        bookmarks={bookmarks}
        currentUrl={activeTab?.url || ''}
        currentTitle={activeTab?.title || ''}
        onNavigate={handleNavigate}
        onOpenInNewTab={(url) => handleNewTab(url)}
        onAddBookmark={handleAddBookmark}
        onRemoveBookmark={handleRemoveBookmark}
        onUpdateBookmark={handleUpdateBookmark}
      />

      {/* 7. History Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onNavigate={handleNavigate}
        onOpenInNewTab={(url) => handleNewTab(url)}
        onClearHistory={handleClearHistory}
        onRemoveHistoryItem={handleRemoveHistoryItem}
      />

      {/* 8. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* 9. Private Session Wiped Toast */}
      {privateToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-2.5 bg-[#1e172a] border border-purple-500/50 text-purple-200 rounded-xl shadow-2xl text-xs animate-in slide-in-from-bottom-2 duration-200">
          <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{privateToast}</span>
          <button
            onClick={() => setPrivateToast(null)}
            className="p-0.5 rounded text-purple-400 hover:text-white ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
