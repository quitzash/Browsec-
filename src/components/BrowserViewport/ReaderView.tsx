import React, { useState, useEffect } from 'react';
import { ReaderArticle } from '../../types';
import {
  BookOpen,
  ArrowLeft,
  Type,
  Minus,
  Plus,
  Palette,
  Download,
  Share2,
  Clock,
  Sparkles,
  ExternalLink,
  Check,
} from 'lucide-react';

interface ReaderViewProps {
  url: string;
  onExitReader: () => void;
  onNavigate: (url: string) => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  url,
  onExitReader,
  onNavigate,
}) => {
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reader Customization State
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans' | 'mono'>('serif');
  const [fontSize, setFontSize] = useState(18); // px
  const [theme, setTheme] = useState<'sepia' | 'dark' | 'light' | 'midnight'>('dark');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    async function fetchCleanArticle() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
          throw new Error(`Failed to extract article (${res.status})`);
        }
        const data = await res.json();
        if (!isCancelled) {
          setArticle(data);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err.message || 'Could not parse clean article content.');
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    if (url) {
      fetchCleanArticle();
    }

    return () => {
      isCancelled = true;
    };
  }, [url]);

  const handleCopyMarkdown = () => {
    if (!article) return;
    const md = [
      `# ${article.title}`,
      article.author ? `**By**: ${article.author}` : '',
      article.siteName ? `**Source**: [${article.siteName}](${article.url})` : '',
      `\n---\n`,
      ...article.elements.map((el) => {
        if (el.type === 'h2') return `\n## ${el.text}\n`;
        if (el.type === 'h3') return `\n### ${el.text}\n`;
        if (el.type === 'blockquote') return `\n> ${el.text}\n`;
        if (el.type === 'img' && el.src) return `\n![${el.alt || 'image'}](${el.src})\n`;
        return `${el.text}\n`;
      }),
    ].join('\n');

    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Theme styling mapping
  const getThemeClasses = () => {
    switch (theme) {
      case 'sepia':
        return {
          bg: 'bg-[#f4ecd8]',
          text: 'text-[#3c3426]',
          muted: 'text-[#756a57]',
          border: 'border-[#dfd3b8]',
          controls: 'bg-[#ebe2cb] text-[#3c3426] border-[#dfd3b8]',
        };
      case 'light':
        return {
          bg: 'bg-[#fafafa]',
          text: 'text-[#18181b]',
          muted: 'text-[#71717a]',
          border: 'border-[#e4e4e7]',
          controls: 'bg-[#f4f4f5] text-[#18181b] border-[#e4e4e7]',
        };
      case 'midnight':
        return {
          bg: 'bg-[#0f172a]',
          text: 'text-[#e2e8f0]',
          muted: 'text-[#94a3b8]',
          border: 'border-[#1e293b]',
          controls: 'bg-[#1e293b] text-[#e2e8f0] border-[#334155]',
        };
      default: // dark
        return {
          bg: 'bg-[#121316]',
          text: 'text-[#e4e4e7]',
          muted: 'text-[#a1a1aa]',
          border: 'border-[#27272a]',
          controls: 'bg-[#1a1b1f] text-[#e4e4e7] border-[#27272a]',
        };
    }
  };

  const themeClasses = getThemeClasses();

  const getFontFamilyClass = () => {
    switch (fontFamily) {
      case 'sans':
        return 'font-sans';
      case 'mono':
        return 'font-mono';
      default:
        return 'font-serif';
    }
  };

  return (
    <div className={`flex-1 w-full h-full overflow-y-auto select-text transition-colors duration-150 ${themeClasses.bg}`}>
      {/* Top Floating Reader Toolbar */}
      <div className={`sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2 flex items-center justify-between gap-4 transition-colors ${themeClasses.controls}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={onExitReader}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Web</span>
          </button>
          <span className="text-xs opacity-40">|</span>
          <span className="text-xs font-medium flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Reader Mode</span>
          </span>
        </div>

        {/* Reader Customizer: Fonts, Sizes, Themes */}
        <div className="flex items-center gap-2 text-xs">
          {/* Font Family Selector */}
          <div className="flex items-center rounded-lg p-0.5 border border-black/10 dark:border-white/10">
            <button
              onClick={() => setFontFamily('serif')}
              className={`px-2 py-0.5 rounded font-serif ${fontFamily === 'serif' ? 'bg-black/10 dark:bg-white/15 font-bold' : ''}`}
            >
              Serif
            </button>
            <button
              onClick={() => setFontFamily('sans')}
              className={`px-2 py-0.5 rounded font-sans ${fontFamily === 'sans' ? 'bg-black/10 dark:bg-white/15 font-bold' : ''}`}
            >
              Sans
            </button>
            <button
              onClick={() => setFontFamily('mono')}
              className={`px-2 py-0.5 rounded font-mono text-[10px] ${fontFamily === 'mono' ? 'bg-black/10 dark:bg-white/15 font-bold' : ''}`}
            >
              Mono
            </button>
          </div>

          {/* Font Size Adjusters */}
          <div className="flex items-center rounded-lg border border-black/10 dark:border-white/10 px-1">
            <button
              onClick={() => setFontSize((s) => Math.max(13, s - 1))}
              className="p-1 hover:opacity-75"
              title="Decrease font size"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="px-1 text-[11px] font-mono tabular-nums">{fontSize}px</span>
            <button
              onClick={() => setFontSize((s) => Math.min(26, s + 1))}
              className="p-1 hover:opacity-75"
              title="Increase font size"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Theme Palette Buttons */}
          <div className="flex items-center gap-1 pl-1">
            <button
              onClick={() => setTheme('dark')}
              title="Dark"
              className={`w-5 h-5 rounded-full bg-[#121316] border ${theme === 'dark' ? 'ring-2 ring-sky-400 border-white' : 'border-neutral-600'}`}
            />
            <button
              onClick={() => setTheme('sepia')}
              title="Sepia Paper"
              className={`w-5 h-5 rounded-full bg-[#f4ecd8] border ${theme === 'sepia' ? 'ring-2 ring-amber-600 border-amber-900' : 'border-[#d4c8a8]'}`}
            />
            <button
              onClick={() => setTheme('light')}
              title="Clean White"
              className={`w-5 h-5 rounded-full bg-[#fafafa] border ${theme === 'light' ? 'ring-2 ring-sky-500 border-neutral-400' : 'border-neutral-300'}`}
            />
            <button
              onClick={() => setTheme('midnight')}
              title="Midnight Slate"
              className={`w-5 h-5 rounded-full bg-[#0f172a] border ${theme === 'midnight' ? 'ring-2 ring-indigo-400 border-white' : 'border-slate-700'}`}
            />
          </div>

          {/* Copy Markdown */}
          <button
            onClick={handleCopyMarkdown}
            title="Copy Clean Article as Markdown"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 hover:opacity-80 transition-opacity ml-1"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Download className="w-3 h-3" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Markdown'}</span>
          </button>
        </div>
      </div>

      {/* Reader Content Body */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-8 h-8 border-3 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium opacity-60">Extracting article text & stripping clutter...</p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 text-center">
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <button
              onClick={onExitReader}
              className="px-4 py-2 bg-neutral-800 text-white rounded-lg text-xs font-medium hover:bg-neutral-700"
            >
              Return to Standard Web Page
            </button>
          </div>
        ) : article ? (
          <article className={getFontFamilyClass()}>
            {/* Header info */}
            <header className="mb-8 border-b pb-6 border-black/10 dark:border-white/10">
              <h1
                className="font-bold tracking-tight mb-4 leading-tight"
                style={{ fontSize: `${fontSize * 1.8}px` }}
              >
                {article.title}
              </h1>

              {/* Byline metadata with zero-pill unboxed typographic separators */}
              <div className={`flex flex-wrap items-center gap-2 text-xs ${themeClasses.muted}`}>
                {article.author && <span>By {article.author}</span>}
                {article.author && <span aria-hidden="true">·</span>}
                <span>{article.siteName}</span>
                <span aria-hidden="true">·</span>
                <span>{article.readingTimeMin} min read</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{article.wordCount} words</span>
              </div>
            </header>

            {/* Optional Lead Image */}
            {article.leadImage && (
              <figure className="mb-8">
                <img
                  src={article.leadImage}
                  alt={article.title}
                  referrerPolicy="no-referrer"
                  className="w-full rounded-xl object-cover max-h-[440px] shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </figure>
            )}

            {/* Article Paragraphs & Headings */}
            <div
              className="space-y-6 leading-relaxed"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            >
              {article.elements.map((el, i) => {
                if (el.type === 'h2') {
                  return (
                    <h2
                      key={i}
                      className="font-bold tracking-tight mt-8 mb-3"
                      style={{ fontSize: `${fontSize * 1.35}px` }}
                    >
                      {el.text}
                    </h2>
                  );
                }
                if (el.type === 'h3') {
                  return (
                    <h3
                      key={i}
                      className="font-semibold tracking-tight mt-6 mb-2"
                      style={{ fontSize: `${fontSize * 1.15}px` }}
                    >
                      {el.text}
                    </h3>
                  );
                }
                if (el.type === 'blockquote') {
                  return (
                    <blockquote
                      key={i}
                      className="border-l-4 border-sky-500/60 pl-4 my-4 italic opacity-90"
                    >
                      {el.text}
                    </blockquote>
                  );
                }
                if (el.type === 'img' && el.src) {
                  return (
                    <figure key={i} className="my-6">
                      <img
                        src={el.src}
                        alt={el.alt || ''}
                        referrerPolicy="no-referrer"
                        className="w-full rounded-lg max-h-[400px] object-contain bg-black/5"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      {el.alt && (
                        <figcaption className="text-center text-xs opacity-60 mt-2 font-sans">
                          {el.alt}
                        </figcaption>
                      )}
                    </figure>
                  );
                }
                return (
                  <p key={i} className="text-justify">
                    {el.text}
                  </p>
                );
              })}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
};
