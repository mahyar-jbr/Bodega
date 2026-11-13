// Startup: settings first, then the app, the change bus and the agent, then listen.
import './env';
import { closeDb, pingDb } from '../shared/db';
import { createApp } from './app';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

// ── Change bus ──────────────────────────────────────────────────────────────────────
// A stand-in that does nothing. The real bus (M2-03) opens one database-level change
// stream per process and fans events out with on(coll, fn), which returns an unsubscribe.
const bus = { on: (_coll: string, _fn: (event: unknown) => void) => () => {} };

// ── Agent (S07) ─────────────────────────────────────────────────────────────────────
// Once S05 lands, wire the agent here (getDb comes from ../shared/db):
//   const agent = createAgent({ store, db: getDb(), bus });
//   await agent.start();
// `store` is S05's MemoryStore at first, then the AtlasStore.

const server = app.listen(port, (error?: Error) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Bodega is listening on port ${port}`);
  void pingDb().then((db) =>
    console.log(db.ok ? `Atlas: connected to database ${db.name} (${db.latencyMs} ms)` : `Atlas: ${db.reason} (${db.detail})`),
  );
});

// Render sends SIGTERM before it replaces an instance on deploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`);
    // Open SSE streams would keep close() waiting, so stop after 5 s regardless.
    setTimeout(() => process.exit(0), 5_000).unref();
    server.close(() => void closeDb().finally(() => process.exit(0)));
    server.closeIdleConnections();
  });
}
