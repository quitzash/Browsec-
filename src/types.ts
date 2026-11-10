export type BrowserMode = 'proxy' | 'direct' | 'reader';

export interface Tab {
  id: string;
  url: string;
  displayUrl: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  history: string[];
  historyIndex: number;
  isPinned: boolean;
  isPrivate: boolean;
  mode: BrowserMode;
  scrollPercent: number;
  zoom: number; // 75, 90, 100, 110, 125, 150
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  category: string;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
  favicon?: string;
}

export interface SearchEngine {
  id: string;
  name: string;
  searchUrl: string; // e.g. "https://duckduckgo.com/?q=%s"
  icon: string;
}

export interface InspectData {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  latencyMs: number;
  contentType: string;
  contentLength: string;
  serverHeader: string;
  headers: { name: string; value: string }[];
  meta: {
    title: string;
    description: string;
    ogImage: string;
    linkCount: number;
    imageCount: number;
  };
}

export interface ReaderArticle {
  url: string;
  title: string;
  author: string;
  siteName: string;
  publishedTime: string;
  leadImage: string;
  wordCount: number;
  readingTimeMin: number;
  elements: {
    type: 'h2' | 'h3' | 'p' | 'blockquote' | 'img';
    text?: string;
    src?: string;
    alt?: string;
  }[];
}

export type ViewportDevice = 'responsive' | 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface BrowserSettings {
  defaultSearchEngine: string;
  homeUrl: string;
  theme: 'dark' | 'midnight' | 'studio' | 'black';
  showBookmarksBar: boolean;
  blockTrackers: boolean;
  /** 'direct' loads sites from the visitor's own browser and connection; 'proxy' goes through this server. */
  defaultMode: 'proxy' | 'direct';
}

export type VpnProviderType = 'warp' | 'xvpn' | 'potatovpn' | 'free' | 'custom' | 'none';

export interface VpnApp {
  id: string;
  name: string;
  provider: VpnProviderType;
  url: string;
  desc: string;
  icon: string;
  accent: string;
  badge?: string;
  features: string[];
}
