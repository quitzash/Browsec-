import { SearchEngine, Bookmark } from '../types';

export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrl: 'https://html.duckduckgo.com/html/?q=%s',
    icon: '🦆',
  },
  {
    id: 'google',
    name: 'Google',
    searchUrl: 'https://www.google.com/search?q=%s',
    icon: '🔍',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    searchUrl: 'https://en.wikipedia.org/wiki/Special:Search?search=%s',
    icon: '📚',
  },
  {
    id: 'bing',
    name: 'Bing',
    searchUrl: 'https://www.bing.com/search?q=%s',
    icon: '🌐',
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    searchUrl: 'https://www.ecosia.org/search?q=%s',
    icon: '🌱',
  },
];

export const DEFAULT_BOOKMARKS: Bookmark[] = [
  {
    id: 'bm-wiki',
    title: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    category: 'Reference',
    createdAt: Date.now() - 100000,
  },
  {
    id: 'bm-hn',
    title: 'Hacker News',
    url: 'https://news.ycombinator.com',
    category: 'Tech',
    createdAt: Date.now() - 90000,
  },
  {
    id: 'bm-mdn',
    title: 'MDN Web Docs',
    url: 'https://developer.mozilla.org/en-US/',
    category: 'Development',
    createdAt: Date.now() - 80000,
  },
  {
    id: 'bm-archive',
    title: 'Internet Archive',
    url: 'https://archive.org',
    category: 'Reference',
    createdAt: Date.now() - 70000,
  },
  {
    id: 'bm-gutenberg',
    title: 'Project Gutenberg',
    url: 'https://www.gutenberg.org',
    category: 'Books',
    createdAt: Date.now() - 60000,
  },
  {
    id: 'bm-bbc',
    title: 'BBC World News',
    url: 'https://www.bbc.com/news',
    category: 'News',
    createdAt: Date.now() - 50000,
  },
  {
    id: 'bm-nasa',
    title: 'NASA Mars Exploration',
    url: 'https://mars.nasa.gov',
    category: 'Science',
    createdAt: Date.now() - 40000,
  },
  {
    id: 'bm-devto',
    title: 'DEV Community',
    url: 'https://dev.to',
    category: 'Development',
    createdAt: Date.now() - 30000,
  },
];

export const SPEED_DIAL_SITES = [
  {
    title: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    desc: 'The free encyclopedia',
    icon: '📚',
    accent: '#334155',
  },
  {
    title: 'Hacker News',
    url: 'https://news.ycombinator.com',
    desc: 'Tech news & discussions',
    icon: '⚡',
    accent: '#c2410c',
  },
  {
    title: 'MDN Web Docs',
    url: 'https://developer.mozilla.org/en-US/',
    desc: 'Web technology reference',
    icon: '📑',
    accent: '#0284c7',
  },
  {
    title: 'BBC News',
    url: 'https://www.bbc.com/news',
    desc: 'Global journalism & breaking news',
    icon: '🌍',
    accent: '#b91c1c',
  },
  {
    title: 'Project Gutenberg',
    url: 'https://www.gutenberg.org',
    desc: '70,000+ free public domain eBooks',
    icon: '📖',
    accent: '#15803d',
  },
  {
    title: 'Internet Archive',
    url: 'https://archive.org',
    desc: 'Digital library of millions of books & music',
    icon: '🏛️',
    accent: '#475569',
  },
  {
    title: 'NASA Exploration',
    url: 'https://mars.nasa.gov',
    desc: 'Images & discoveries from Mars & beyond',
    icon: '🚀',
    accent: '#4338ca',
  },
  {
    title: 'DEV Community',
    url: 'https://dev.to',
    desc: 'Constructive web dev community',
    icon: '💻',
    accent: '#0f172a',
  },
];

export const THEMES = [
  { id: 'dark', name: 'Charcoal Dark', bg: 'bg-[#121316]', surface: 'bg-[#1a1b1f]', border: 'border-[#27282e]' },
  { id: 'midnight', name: 'Midnight Blue', bg: 'bg-[#0b0f19]', surface: 'bg-[#111827]', border: 'border-[#1f2937]' },
  { id: 'studio', name: 'Studio Slate', bg: 'bg-[#0f172a]', surface: 'bg-[#1e293b]', border: 'border-[#334155]' },
  { id: 'black', name: 'OLED Pure Black', bg: 'bg-[#000000]', surface: 'bg-[#0a0a0a]', border: 'border-[#1a1a1a]' },
];
