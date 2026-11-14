// Dev tool for the rollout (M2-09): promote the hand-written version, roll back, or show the state,
// on the database in MONGODB_URI / MONGODB_DB. A running app's store runtimes apply each change from
// the change bus and record their times in `rollouts`.
//   npx tsx scripts/rollout.ts status
//   npx tsx scripts/rollout.ts hand-written     # save a new hand-written version and promote it
//   npx tsx scripts/rollout.ts rollback         # take back the active version (learning pauses)
// Times recorded by an app on another machine include the clock difference between the two machines;
// on stage, promotions and rollbacks happen inside the app's own process.
import '../src/server/env';
import { closeDb, dbName, getDb } from '../src/shared/db';
import { handWrittenVersion, HAND_WRITTEN_RULES } from '../src/agent/guard/hand-written';
import { ensureAgentState, promoteVersion, readAgentState, rollbackActive, ROLLOUTS, saveVersion, STORE_RUNTIME } from '../src/agent/rollout/state';

const command = process.argv[2] ?? 'status';
const db = getDb();
await ensureAgentState(db);

async function status() {
  const state = await readAgentState(db);
  const stores = await db.collection(STORE_RUNTIME).find().toArray();
  const rollouts = await db.collection(ROLLOUTS).find({ changedAt: state.changedAt }).toArray();
  console.log(`${dbName()}: active v${state.activeVersion} (${state.change} at ${state.changedAt.toISOString()}), stack [${state.stack.join(', ')}], learningPaused ${state.learningPaused}, epoch ${state.epoch}`);
  for (const s of stores) {
    const r = rollouts.find((x) => x.storeId === s._id);
    console.log(`  ${String(s._id).padEnd(12)} v${s.appliedVersion} ${s.online ? 'online' : 'OFFLINE'}${r ? `  ${r.change} in ${r.ms} ms via ${r.via}` : ''}`);
  }
}

if (command === 'hand-written') {
  const saved = await saveVersion(db, { rules: HAND_WRITTEN_RULES, title: 'Hand-written test version', source: 'hand-written' });
  const p = await promoteVersion(db, saved.version);
  console.log(`promoted v${p.toVersion} (from v${p.fromVersion}); rules: ${handWrittenVersion(saved.version).rules.map((r) => r.id).join(', ')}`);
  await new Promise((r) => setTimeout(r, 4_000));
} else if (command === 'rollback') {
  const r = await rollbackActive(db);
  console.log(`rolled back v${r.fromVersion} -> v${r.toVersion}`);
  await new Promise((r) => setTimeout(r, 4_000));
} else if (command !== 'status') {
  console.log('usage: npx tsx scripts/rollout.ts status | hand-written | rollback');
  process.exitCode = 1;
}
await status();
await closeDb();
