import React, { useRef, useEffect, useState } from 'react';
import { BrowserMode, ViewportDevice } from '../../types';
import { ExternalLink, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';

interface WebFrameProps {
  url: string;
  tabId: string;
  isPrivate: boolean;
  mode: BrowserMode;
  zoom: number;
  viewportDevice: ViewportDevice;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onUpdateMetadata: (title: string, favicon?: string) => void;
  onSetLoading: (loading: boolean) => void;
  onSwitchToDirect?: () => void;
}

export const WebFrame: React.FC<WebFrameProps> = ({
  url,
  tabId,
  isPrivate,
  mode,
  zoom,
  viewportDevice,
  isLoading,
  onNavigate,
  onUpdateMetadata,
  onSetLoading,
  onSwitchToDirect,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Determine iframe source URL
  const iframeSrc = React.useMemo(() => {
    if (!url || url === 'apex://newtab' || url === 'about:blank') return '';
    if (mode === 'proxy') {
      return `/api/proxy?url=${encodeURIComponent(url)}&tabId=${encodeURIComponent(tabId)}&isPrivate=${isPrivate ? 'true' : 'false'}`;
    }
    return url;
  }, [url, mode, tabId, isPrivate]);

  // Listen to bridge messages from injected client script
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      switch (event.data.type) {
        case 'APEX_PAGE_LOADED':
          if (event.data.title) {
            onUpdateMetadata(event.data.title, event.data.favicon);
          }
          onSetLoading(false);
          setLoadError(false);
          break;

        case 'APEX_NAVIGATE_TO':
          if (event.data.url) {
            onNavigate(event.data.url);
          }
          break;

        case 'APEX_NAVIGATE_HOME':
          onNavigate('apex://newtab');
          break;

        case 'APEX_SWITCH_TO_DIRECT':
          if (onSwitchToDirect) {
            onSwitchToDirect();
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onNavigate, onUpdateMetadata, onSetLoading, onSwitchToDirect]);

  // Handle iframe load event
  const handleIframeLoad = () => {
    onSetLoading(false);
    // Attempt fallback title extraction if not reported via bridge
    try {
      const hostname = new URL(url).hostname;
      onUpdateMetadata(hostname);
    } catch {
      // ignore
    }
  };

  const handleIframeError = () => {
    onSetLoading(false);
    setLoadError(true);
    setErrorMessage('Failed to load page. Some sites enforce strict framing policies or require Direct Mode.');
  };

  // Device dimension styling
  const getDeviceContainerClass = () => {
    switch (viewportDevice) {
      case 'laptop':
        return 'w-[1366px] h-[768px] my-6 mx-auto rounded-lg shadow-2xl border border-neutral-700 bg-neutral-900 overflow-hidden';
      case 'tablet':
        return 'w-[768px] h-[1024px] my-6 mx-auto rounded-2xl shadow-2xl border-4 border-neutral-700 bg-neutral-900 overflow-hidden';
      case 'mobile':
        return 'w-[390px] h-[844px] my-6 mx-auto rounded-3xl shadow-2xl border-8 border-neutral-800 bg-neutral-900 overflow-hidden';
      default:
        return 'w-full h-full';
    }
  };

  return (
    <div className="relative flex-1 w-full h-full bg-[#0a0a0c] overflow-auto flex items-center justify-center">
      {/* Top Loading Progress Bar */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-neutral-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-cyan-400 animate-pulse w-full" />
        </div>
      )}

      {/* Frame Container with optional Device Emulation & Zoom */}
      <div
        className={`${getDeviceContainerClass()} transition-all duration-200 relative`}
        style={{
          transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
          transformOrigin: 'top center',
        }}
      >
        {loadError ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[#131418] text-neutral-300">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Display Warning</h3>
            <p className="text-sm text-neutral-400 max-w-md mb-6 leading-relaxed">
              {errorMessage}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setLoadError(false);
                  onSetLoading(true);
                  if (iframeRef.current) {
                    iframeRef.current.src = iframeSrc;
                  }
                }}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Load</span>
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
              >
                <span>Open in Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title="Apex Web Viewport"
            className="w-full h-full border-none bg-white"
            // We provide proper sandbox permissions for web apps to execute scripts, forms, and popups safely
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  );
};
