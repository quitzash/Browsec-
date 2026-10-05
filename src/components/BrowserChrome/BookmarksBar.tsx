import React from 'react';
import { Bookmark } from '../../types';
import { Globe, Plus, Trash2 } from 'lucide-react';

interface BookmarksBarProps {
  bookmarks: Bookmark[];
  onNavigate: (url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onAddCurrentPage: () => void;
}

export const BookmarksBar: React.FC<BookmarksBarProps> = ({
  bookmarks,
  onNavigate,
  onRemoveBookmark,
  onAddCurrentPage,
}) => {
  return (
    <div className="flex items-center h-7 px-3 bg-[#131417] border-b border-[#202227] text-xs text-neutral-400 select-none overflow-x-auto no-scrollbar gap-1">
      {bookmarks.map((bm) => (
        <div
          key={bm.id}
          className="group relative flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-[#202228] hover:text-neutral-200 transition-colors cursor-pointer shrink-0 max-w-[160px]"
        >
          <div onClick={() => onNavigate(bm.url)} className="flex items-center gap-1.5 truncate">
            {bm.favicon ? (
              <img
                src={bm.favicon}
                alt=""
                className="w-3.5 h-3.5 rounded-xs shrink-0"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            )}
            <span className="truncate text-[11px] font-medium">{bm.title}</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveBookmark(bm.id);
            }}
            title="Delete bookmark"
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-500 hover:text-red-400 transition-opacity ml-1"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}

      <button
        onClick={onAddCurrentPage}
        title="Add current page to bookmarks"
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-[#202228] transition-colors shrink-0 ml-auto"
      >
        <Plus className="w-3 h-3" />
        <span>Add Bookmark</span>
      </button>
    </div>
  );
};
