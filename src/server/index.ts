// Startup: settings first, then the app, the change bus and the agent, then listen.
import './env';
import { createAgent } from '../agent';
import { createCrowdBot } from '../bots/crowd';
import { createFlashSale } from '../bots/flash';
import { MongoChangeBus } from '../realtime/change-bus';
import { closeDb, getDb, pingDb } from '../shared/db';
import { AtlasStore } from '../store/atlas-store';
import { createApp } from './app';
import type { OpsAutomation } from './routes';

const port = Number(process.env.PORT) || 3000;

// ── Change bus ──────────────────────────────────────────────────────────────────────
// One database-level stream per process, fanned out to collection subscribers.
const db = getDb();
const bus = new MongoChangeBus(db);
await bus.start();

// ── Agent (S07) ─────────────────────────────────────────────────────────────────────
const store = new AtlasStore(db);
const agent = createAgent({ store, db, bus });
await agent.start();
const crowd = createCrowdBot({ agent, store, db });
const flash = createFlashSale({ store, db });
const opsAutomation: OpsAutomation = {
  opening: (storeId) => crowd.opening({ storeId }),
  startCrowd: (storeId) => crowd.startCrowd({ storeId }),
  stopCrowd: () => crowd.stopCrowd(),
  status: () => crowd.status(),
};
const app = createApp({ api: { store, agent, db, opsAutomation, flash }, realtime: { bus } });

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
    server.close(() => void bus.close().then(closeDb).finally(() => process.exit(0)));
    server.closeIdleConnections();
  });
}
