import React, { useState } from 'react';
import { HistoryItem } from '../../types';
import { History, X, Search, Trash2, Globe, ExternalLink, Clock } from 'lucide-react';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onNavigate: (url: string) => void;
  onOpenInNewTab: (url: string) => void;
  onClearHistory: () => void;
  onRemoveHistoryItem: (id: string) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  history,
  onNavigate,
  onOpenInNewTab,
  onClearHistory,
  onRemoveHistoryItem,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredHistory = history.filter((item) => {
    return (
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.url.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md h-full bg-[#14151a] border-l border-[#272932] shadow-2xl flex flex-col text-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#242630]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Browsing History</h2>
              <p className="text-[11px] text-neutral-400 font-mono tabular-nums">
                {history.length} records
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="px-2.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-[#20222a] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-[#242630]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history by title or URL..."
              className="w-full bg-[#1b1c23] border border-[#2b2e3a] rounded-lg pl-9 pr-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-neutral-500">
              <Clock className="w-8 h-8 stroke-1 mb-2 opacity-40" />
              <p className="text-xs">No browsing history found.</p>
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="group flex items-center justify-between p-2 rounded-lg hover:bg-[#1c1d25] transition-colors gap-2"
              >
                <div
                  onClick={() => {
                    onNavigate(item.url);
                    onClose();
                  }}
                  className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-neutral-200 group-hover:text-white truncate">
                      {item.title || item.url}
                    </div>
                    <div className="text-[10px] text-neutral-500 truncate font-mono">
                      {item.url}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-neutral-500 font-mono tabular-nums">
                    {new Date(item.visitedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    onClick={() => onOpenInNewTab(item.url)}
                    title="Open in new tab"
                    className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-white"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onRemoveHistoryItem(item.id)}
                    title="Delete item"
                    className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
