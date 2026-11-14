import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { createRealtimeRouter, type RealtimeRouteDeps } from '../realtime/routes';
import { pingDb } from '../shared/db';

const DEFAULT_DIST = fileURLToPath(new URL('../../dist', import.meta.url));

export function createApp({ distDir = DEFAULT_DIST, realtime }:
  { distDir?: string; realtime?: RealtimeRouteDeps } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // 200 when Atlas answers a ping, 503 with the reason otherwise. Render's health check uses it.
  app.get('/api/health', async (_req, res) => {
    const db = await pingDb();
    res.status(db.ok ? 200 : 503).json({ ok: db.ok, db, uptimeSeconds: Math.round(process.uptime()) });
  });

  // ── API routes are mounted here, above the 404 below. ──
  if (realtime) app.use(createRealtimeRouter(realtime));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // The built web app (npm run build writes dist/). Every other GET gets index.html, so the
  // React routes (/s/:storeId, /screen, /ops) load directly and on refresh.
  const indexHtml = path.join(distDir, 'index.html');
  if (existsSync(indexHtml)) {
    // Built assets have hashed names: cache them for a year, and 404 a missing one
    // instead of answering with index.html.
    app.use('/assets', express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.use(express.static(distDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text').send('The web app is not built: run npm run build, or use npm run dev and open http://localhost:5173.');
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'internal' : 'bad_request' });
  };
  app.use(onError);

  return app;
}
