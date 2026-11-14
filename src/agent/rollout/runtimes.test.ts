// Store runtimes against a real Atlas database (a throwaway one on the dev cluster, dropped after).
// Skipped when no MONGODB_URI is available.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HAND_WRITTEN_RULES } from '../guard/hand-written';
import { createStoreRuntimes, type RolloutDoc, type StoreRuntimeDoc } from './runtimes';
import { promoteVersion, saveVersion } from './state';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (!process.env.MONGODB_URI && existsSync(envFile)) process.loadEnvFile(envFile);
const uri = process.env.MONGODB_URI?.trim();

const noBus = { on: () => () => {} };
const waitFor = async (check: () => Promise<boolean>, ms = 8_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await check()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};

describe.skipIf(!uri)('store runtimes on Atlas', () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    client = new MongoClient(uri!, { appName: 'bodega-test', serverSelectionTimeoutMS: 10_000 });
    db = client.db(`bodega_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  });
  afterAll(async () => {
    await db?.dropDatabase().catch(() => {});
    await client?.close();
  });

  it('an offline store ignores a promotion, then catches up when it is back online', async () => {
    const runtimes = createStoreRuntimes({ db, bus: noBus, pollMs: 150 });
    await runtimes.start();
    await runtimes.setOnline('yonge', false);
    expect((await db.collection<StoreRuntimeDoc>('store_runtime').findOne({ _id: 'yonge' }))?.online).toBe(false);

    const v = await saveVersion(db, { rules: HAND_WRITTEN_RULES, title: 'test', source: 'hand-written' });
    const p = await promoteVersion(db, v.version);
    expect(await waitFor(async () => runtimes.versionFor('queen').version === v.version && runtimes.versionFor('scarborough').version === v.version)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(runtimes.versionFor('yonge').version).toBe(0);   // offline: it ignored the change
    expect(runtimes.isOnline('yonge')).toBe(false);
    const promoted = await db.collection<RolloutDoc>('rollouts').find({ changedAt: p.changedAt }).toArray();
    expect(promoted.map((r) => `${r.storeId}:${r.change}`).sort()).toEqual(['queen:promote', 'scarborough:promote']);

    expect(await waitFor(async () => (await db.collection<RolloutDoc>('rollouts').countDocuments({ changedAt: p.changedAt })) >= 2)).toBe(true);
    await runtimes.setOnline('yonge', true);
    expect(runtimes.versionFor('yonge').version).toBe(v.version);
    expect(runtimes.isOnline('yonge')).toBe(true);
    const yonge = await db.collection<StoreRuntimeDoc>('store_runtime').findOne({ _id: 'yonge' });
    expect(yonge).toMatchObject({ online: true, appliedVersion: v.version });
    const catchup = await db.collection<RolloutDoc>('rollouts').findOne({ storeId: 'yonge', changedAt: p.changedAt });
    expect(catchup).toMatchObject({ change: 'catchup', version: v.version, via: 'catch-up' });
    expect(catchup!.ms).toBeGreaterThanOrEqual(500);
    expect(runtimes.stores().find((s) => s.storeId === 'yonge')).toMatchObject({ appliedVersion: v.version, online: true });
    runtimes.stop();
  }, 30_000);

  it('records one row per store and change, however many runtime sets apply it', async () => {
    const sets = [createStoreRuntimes({ db, bus: noBus, pollMs: 150 }), createStoreRuntimes({ db, bus: noBus, pollMs: 150 })];
    for (const s of sets) await s.start();
    const v = await saveVersion(db, { rules: HAND_WRITTEN_RULES, title: 'test 2', source: 'hand-written' });
    const p = await promoteVersion(db, v.version);
    expect(await waitFor(async () => sets.every((s) => s.stores().every((x) => x.appliedVersion === v.version)))).toBe(true);
    // The rows land just after the in-memory swap: wait for them, then make sure no extra ones follow.
    const rollouts = db.collection<RolloutDoc>('rollouts');
    expect(await waitFor(async () => (await rollouts.countDocuments({ changedAt: p.changedAt })) >= 3)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    const rows = await rollouts.find({ changedAt: p.changedAt }).toArray();
    expect(rows.map((r) => r.storeId).sort()).toEqual(['queen', 'scarborough', 'yonge']);
    for (const s of sets) s.stop();
  }, 30_000);
});
