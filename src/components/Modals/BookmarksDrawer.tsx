import React, { useState } from 'react';
import { Bookmark } from '../../types';
import {
  Bookmark as BookmarkIcon,
  X,
  Search,
  Plus,
  Trash2,
  ExternalLink,
  Edit2,
  Folder,
  Globe,
  Check,
  Download,
  Upload,
} from 'lucide-react';

interface BookmarksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  currentUrl: string;
  currentTitle: string;
  onNavigate: (url: string) => void;
  onOpenInNewTab: (url: string) => void;
  onAddBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => void;
  onRemoveBookmark: (id: string) => void;
  onUpdateBookmark: (id: string, title: string, category: string) => void;
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({
  isOpen,
  onClose,
  bookmarks,
  currentUrl,
  currentTitle,
  onNavigate,
  onOpenInNewTab,
  onAddBookmark,
  onRemoveBookmark,
  onUpdateBookmark,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states for new/edit bookmark
  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formCategory, setFormCategory] = useState('General');

  if (!isOpen) return null;

  // Extract unique categories
  const categories = ['All', ...Array.from(new Set(bookmarks.map((b) => b.category || 'General')))];

  const filteredBookmarks = bookmarks.filter((bm) => {
    const matchesCategory = selectedCategory === 'All' || (bm.category || 'General') === selectedCategory;
    const matchesSearch =
      bm.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bm.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (bm.category && bm.category.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handleStartAddCurrentPage = () => {
    setFormTitle(currentTitle || currentUrl || 'New Bookmark');
    setFormUrl(currentUrl || 'https://');
    setFormCategory('General');
    setIsAddingNew(true);
    setEditingId(null);
  };

  const handleSaveNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUrl.trim()) return;

    let finalUrl = formUrl.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    onAddBookmark({
      title: formTitle.trim() || finalUrl,
      url: finalUrl,
      category: formCategory.trim() || 'General',
    });

    setIsAddingNew(false);
    setFormTitle('');
    setFormUrl('');
  };

  const handleStartEdit = (bm: Bookmark) => {
    setEditingId(bm.id);
    setFormTitle(bm.title);
    setFormCategory(bm.category || 'General');
  };

  const handleSaveEdit = (id: string) => {
    if (!formTitle.trim()) return;
    onUpdateBookmark(id, formTitle.trim(), formCategory.trim() || 'General');
    setEditingId(null);
  };

  const handleExportBookmarks = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `apex_bookmarks_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md h-full bg-[#14151a] border-l border-[#272932] shadow-2xl flex flex-col text-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#242630]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <BookmarkIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Bookmarks Manager</h2>
              <p className="text-[11px] text-neutral-400 font-mono tabular-nums">
                {bookmarks.length} saved bookmarks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleExportBookmarks}
              title="Export Bookmarks (JSON)"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-[#20222a] transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-[#20222a] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Add Bar & Search */}
        <div className="p-4 border-b border-[#242630] space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartAddCurrentPage}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Bookmark Current Page</span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bookmarks by title or URL..."
              className="w-full bg-[#1b1c23] border border-[#2b2e3a] rounded-lg pl-9 pr-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 outline-none focus:border-sky-500"
            />
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-neutral-800 text-sky-400 font-semibold border border-neutral-700'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#1b1c23]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Inline Add New Form Modal */}
        {isAddingNew && (
          <form onSubmit={handleSaveNew} className="p-4 bg-[#1a1c24] border-b border-[#2e313e] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-200">
              <span>Add New Bookmark</span>
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="text-neutral-400 hover:text-neutral-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                Title
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Site Title"
                className="w-full bg-[#131418] border border-[#2e313e] rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                URL Address
              </label>
              <input
                type="text"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-[#131418] border border-[#2e313e] rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                Category / Folder
              </label>
              <input
                type="text"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                placeholder="Reference, Tech, News, etc."
                className="w-full bg-[#131418] border border-[#2e313e] rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="px-3 py-1.5 rounded text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium"
              >
                Save Bookmark
              </button>
            </div>
          </form>
        )}

        {/* Bookmarks List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredBookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-neutral-500">
              <BookmarkIcon className="w-8 h-8 stroke-1 mb-2 opacity-40" />
              <p className="text-xs">No bookmarks found.</p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-xs text-sky-400 hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            filteredBookmarks.map((bm) => (
              <div
                key={bm.id}
                className="group relative flex flex-col p-2.5 bg-[#191b22] hover:bg-[#1e2029] border border-[#272933] hover:border-[#383b48] rounded-xl transition-all"
              >
                {editingId === bm.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      className="w-full bg-[#131418] border border-neutral-700 rounded px-2 py-1 text-xs text-white"
                    />
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        placeholder="Category"
                        className="bg-[#131418] border border-neutral-700 rounded px-2 py-0.5 text-[11px] text-white w-32"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-xs text-neutral-400"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(bm.id)}
                          className="px-2 py-1 bg-sky-600 text-white rounded text-xs"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div
                        onClick={() => {
                          onNavigate(bm.url);
                          onClose();
                        }}
                        className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
                      >
                        <div className="w-6 h-6 rounded bg-neutral-800 flex items-center justify-center shrink-0">
                          {bm.favicon ? (
                            <img
                              src={bm.favicon}
                              alt=""
                              className="w-4 h-4 rounded-xs"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Globe className="w-3.5 h-3.5 text-neutral-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-semibold text-neutral-100 group-hover:text-white truncate">
                            {bm.title}
                          </h4>
                          <span className="text-[11px] text-neutral-400 hover:text-sky-400 truncate block font-mono">
                            {bm.url}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onOpenInNewTab(bm.url)}
                          title="Open in new tab"
                          className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStartEdit(bm)}
                          title="Edit bookmark"
                          className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRemoveBookmark(bm.id)}
                          title="Delete bookmark"
                          className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-neutral-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Metadata line with unboxed separators */}
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#232530] text-[10px] text-neutral-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3 text-neutral-400" />
                        <span>{bm.category || 'General'}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {new Date(bm.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
