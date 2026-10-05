import React, { useState, useEffect } from 'react';
import { InspectData } from '../../types';
import {
  Code2,
  X,
  RefreshCw,
  Search,
  ExternalLink,
  Copy,
  Check,
  Shield,
  Layers,
  FileCode,
  Activity,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface DevToolsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  onNavigate: (url: string) => void;
}

export const DevToolsDrawer: React.FC<DevToolsDrawerProps> = ({
  isOpen,
  onClose,
  url,
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<'network' | 'meta' | 'source' | 'console'>('network');
  const [data, setData] = useState<InspectData | null>(null);
  const [sourceCode, setSourceCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [headerFilter, setHeaderFilter] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !url || url === 'apex://newtab' || url === 'about:blank') return;

    let isCancelled = false;
    async function inspectPage() {
      setLoading(true);
      try {
        const res = await fetch(`/api/inspect?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const json = await res.json();
          if (!isCancelled) setData(json);
        }

        const sourceRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
        if (sourceRes.ok) {
          const text = await sourceRes.text();
          if (!isCancelled) setSourceCode(text);
        }
      } catch {
        // ignore
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    inspectPage();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, url]);

  if (!isOpen) return null;

  const handleCopySource = () => {
    navigator.clipboard.writeText(sourceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredHeaders = (data?.headers || []).filter(
    (h) =>
      h.name.toLowerCase().includes(headerFilter.toLowerCase()) ||
      h.value.toLowerCase().includes(headerFilter.toLowerCase())
  );

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 bg-[#121316] border-t border-[#27282e] shadow-2xl flex flex-col text-neutral-200 transition-all duration-200 ${
        isExpanded ? 'h-[75vh]' : 'h-80'
      }`}
    >
      {/* DevTools Header / Tab Bar */}
      <div className="flex items-center justify-between h-9 px-3 bg-[#18191f] border-b border-[#27282e] select-none text-xs">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1.5 px-2 py-1 text-sky-400 font-semibold border-r border-neutral-700 mr-2">
            <Code2 className="w-3.5 h-3.5" />
            <span>DevTools</span>
          </div>

          <button
            onClick={() => setActiveTab('network')}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === 'network'
                ? 'bg-neutral-800 text-white font-medium'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Network & Headers
          </button>
          <button
            onClick={() => setActiveTab('meta')}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === 'meta'
                ? 'bg-neutral-800 text-white font-medium'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Page Metadata & Media
          </button>
          <button
            onClick={() => setActiveTab('source')}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === 'source'
                ? 'bg-neutral-800 text-white font-medium'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            HTML Source
          </button>
        </div>

        <div className="flex items-center gap-1">
          {data && (
            <div className="hidden sm:flex items-center gap-2 mr-3 text-[11px] font-mono">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  data.status >= 200 && data.status < 300
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                }`}
              >
                {data.status} {data.statusText}
              </span>
              <span className="text-neutral-400 tabular-nums">{data.latencyMs}ms</span>
            </div>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Restore Height' : 'Maximize Drawer'}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* DevTools Body */}
      <div className="flex-1 overflow-y-auto p-4 text-xs font-mono">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-neutral-400">
            <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
            <span>Analyzing target host & headers...</span>
          </div>
        ) : activeTab === 'network' ? (
          <div className="space-y-4">
            {/* Top diagnostic cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-2.5 bg-[#191b22] border border-[#272933] rounded-lg">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Status</div>
                <div className="text-sm font-semibold text-emerald-400 mt-0.5">
                  {data?.status} {data?.statusText}
                </div>
              </div>
              <div className="p-2.5 bg-[#191b22] border border-[#272933] rounded-lg">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Latency</div>
                <div className="text-sm font-semibold text-neutral-200 mt-0.5 tabular-nums">
                  {data?.latencyMs} ms
                </div>
              </div>
              <div className="p-2.5 bg-[#191b22] border border-[#272933] rounded-lg">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Content Type</div>
                <div className="text-xs font-medium text-neutral-300 mt-0.5 truncate" title={data?.contentType}>
                  {data?.contentType || 'text/html'}
                </div>
              </div>
              <div className="p-2.5 bg-[#191b22] border border-[#272933] rounded-lg">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Server Engine</div>
                <div className="text-xs font-medium text-neutral-300 mt-0.5 truncate">
                  {data?.serverHeader || 'Cloudflare / Edge'}
                </div>
              </div>
            </div>

            {/* Filter */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-neutral-300 font-sans">
                HTTP Response Headers ({filteredHeaders.length})
              </span>
              <div className="relative w-64">
                <Search className="w-3 h-3 text-neutral-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={headerFilter}
                  onChange={(e) => setHeaderFilter(e.target.value)}
                  placeholder="Filter headers..."
                  className="w-full bg-[#18191f] border border-[#2a2c35] rounded pl-7 pr-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Headers Table */}
            <div className="border border-[#272933] rounded-lg overflow-hidden bg-[#16171d]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#1f2129] border-b border-[#272933] text-[10px] text-neutral-400 uppercase">
                    <th className="py-1.5 px-3 w-1/3">Header Name</th>
                    <th className="py-1.5 px-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23252d]">
                  {filteredHeaders.map((h, i) => (
                    <tr key={i} className="hover:bg-[#1e2028]">
                      <td className="py-1.5 px-3 text-sky-400 font-medium select-text">{h.name}</td>
                      <td className="py-1.5 px-3 text-neutral-300 break-all select-text">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'meta' ? (
          <div className="space-y-4">
            <div className="p-3 bg-[#191b22] border border-[#272933] rounded-lg space-y-2">
              <div>
                <span className="text-neutral-500 text-[10px] uppercase">Title</span>
                <p className="text-white text-xs font-sans mt-0.5">{data?.meta?.title || 'No title tag'}</p>
              </div>
              <div>
                <span className="text-neutral-500 text-[10px] uppercase">Description</span>
                <p className="text-neutral-300 text-xs font-sans mt-0.5">{data?.meta?.description || 'No description tag found'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-[#191b22] border border-[#272933] rounded-lg">
                <span className="text-neutral-500 text-[10px] uppercase">Hyperlinks Discovered</span>
                <p className="text-lg font-bold text-white tabular-nums mt-1">{data?.meta?.linkCount ?? 0}</p>
              </div>
              <div className="p-3 bg-[#191b22] border border-[#272933] rounded-lg">
                <span className="text-neutral-500 text-[10px] uppercase">Images Found</span>
                <p className="text-lg font-bold text-white tabular-nums mt-1">{data?.meta?.imageCount ?? 0}</p>
              </div>
            </div>

            {data?.meta?.ogImage && (
              <div>
                <span className="text-neutral-500 text-[10px] uppercase block mb-1">OpenGraph Social Preview Image</span>
                <img
                  src={data.meta.ogImage}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="rounded-lg max-h-48 border border-neutral-700 object-cover"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="relative h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-neutral-400 text-xs font-sans">
                Source Document ({sourceCode.length.toLocaleString()} bytes)
              </span>
              <button
                onClick={handleCopySource}
                className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied Source' : 'Copy All'}</span>
              </button>
            </div>
            <pre className="p-3 bg-[#0d0e11] border border-[#242630] rounded-lg overflow-x-auto text-[11px] leading-relaxed text-emerald-400/90 font-mono select-text max-h-[50vh]">
              <code>{sourceCode || '<!-- No source loaded -->'}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
