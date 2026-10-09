import { Pool, ProxyAgent, type Dispatcher } from 'undici';

interface ConnectTunnel {
  connect(params: any): any;
}

/**
 * Cloudflare WARP, free proxies and handheld Squid boxes all accept the same
 * HTTP CONNECT tunnel, but undici's tunnelling code writes the CONNECT `Host`
 * header from the target hostname only — it omits the port for standard ports.
 * Squid (used by a large share of public proxies) rejects that with
 * `400 ERR_INVALID_URL`, which kills every page load through those proxies.
 *
 * `makeProxyAgent` builds a ProxyAgent whose CONNECT request always carries the
 * full `host:port` in the Host header. SOCKS5 URLs are passed through untouched
 * (undici's Socks5ProxyAgent handles those and never sends an HTTP CONNECT).
 */
export function makeProxyAgent(uri: string, opts: object = {}): ProxyAgent {
  const options = {
    uri,
    connect: { timeout: 10000, ...(opts as any)?.connect },
    ...opts,
    clientFactory: (origin: URL, factoryOpts: object): Dispatcher => {
      const dispatcher = new Pool(String(origin), factoryOpts) as unknown as ConnectTunnel;
      const originalConnect = dispatcher.connect.bind(dispatcher);
      dispatcher.connect = (params: any) => {
        if (params && params.headers && typeof params.path === 'string') {
          // The CONNECT request line already carries host:port; mirror it into the Host header.
          const hostPort = /^([^/]+):(\d+)$/.exec(params.path);
          if (hostPort && !/:\d+$/.test(params.headers.host || '')) {
            params.headers.host = params.path;
          }
        }
        return originalConnect(params);
      };
      return dispatcher as unknown as Dispatcher;
    },
  };
  return new ProxyAgent(options as unknown as ProxyAgent.Options);
}