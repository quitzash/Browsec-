import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiApp } from './server-api.ts';
import { flushSavedLogins } from './cookie-store.ts';
import { flushStorage } from './web-storage.ts';
import { stopWarp } from './warp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = apiApp;
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT ? Number(process.env.PORT) : 3000;

async function setupServer() {
  const isProd = process.env.NODE_ENV === 'production';

  // Proxied pages see their real path (history.replaceState), so a page that calls location.reload() or sets a
  // relative location.href would load this app inside the viewport. Hand those back to the browser chrome instead.
  app.use((req: Request, res: Response, next) => {
    if (req.headers['sec-fetch-dest'] === 'iframe' && !req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      return res
        .status(200)
        .type('html')
        .send(
          "<!doctype html><script>try{window.parent.postMessage({type:'APEX_NAVIGATE_REL',path:location.pathname+location.search+location.hash},'*')}catch(e){}</script>",
        );
    }
    next();
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Browser full-stack server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    // Saved logins and site storage are debounced to disk; flush them so nothing typed in the last
    // moment is lost, alongside stopping the tunnel.
    Promise.allSettled([stopWarp(), flushSavedLogins(), flushStorage()]).finally(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

setupServer();
