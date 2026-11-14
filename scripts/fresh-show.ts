// A clean slate before judging: the first learned version on stage is v1 again, and the version chart
// shows only v0's baseline. Nothing is deleted from the record: earlier versions, learning runs,
// rollouts and evaluations move to *_archive collections (with originalId, archivedAt and archiveEpoch), so the
// README's numbers stay checkable (`npm run compare -- --archive`).
//   npm run fresh-show -- --yes          on the database in MONGODB_URI / MONGODB_DB
// Then: the store data is reset (shoppers, orders, ledger, bot runs; shelves restocked) and the agent
// is reset (every store on v0, learning unpaused, a new con-memory epoch; incidents, cons and
// conversations cleared). Kept: v0, its two held-out baselines, codes, members and stores.
import '../src/server/env';
import { parseArgs } from 'node:util';
import { ObjectId, type Document, type Filter } from 'mongodb';
import { LEARNING_RUNS } from '../src/agent/learner/learner';
import { ensureAgentState, GUARDRAILS, readAgentState, resetAgentState, ROLLOUTS } from '../src/agent/rollout/state';
import { closeDb, dbName, getDb } from '../src/shared/db';
import { resetStoreData } from '../src/store/reset';

const V0_HASH = '6adbcc65b15bc033c4cb5aad921eca17af4ed709e768632c7b5fe0f82df4b345';
const ALLOWED = new Set(['bodega', 'bodega_mahyar', 'bodega_kasra', 'bodega_eng2']);
const EVALUATIONS = 'evaluations';

const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false }, force: { type: 'boolean', default: false } } });
const name = dbName();
const host = (process.env.MONGODB_URI ?? '').replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split(/[/?]/)[0] || '(no MONGODB_URI)';
console.log(`fresh-show on database ${name} at ${host}`);
if (!ALLOWED.has(name)) {
  console.log(`Refusing: ${name} is not one of ${[...ALLOWED].join(', ')}.`);
  process.exit(1);
}
if (!values.yes) {
  console.log('Nothing changed. Add --yes to archive this show and reset it.');
  process.exit(1);
}

const db = getDb();
await ensureAgentState(db);
const state = await readAgentState(db);
const baselines = { purpose: 'baseline', version: 0, settingsHash: V0_HASH };
const running = await db.collection(EVALUATIONS).countDocuments({ status: 'running' });
const lockFresh = state.learning && state.learningLockedAt && Date.now() - new Date(state.learningLockedAt).getTime() < 30_000;
const baselineCount = await db.collection(EVALUATIONS).countDocuments(baselines);
const problems = [
  ...(lockFresh ? ['a learning cycle is running'] : []),
  ...(running ? [`${running} evaluation(s) still running`] : []),
  ...(baselineCount === 0 ? [`no v0 baseline with hash ${V0_HASH.slice(0, 8)}… (the gate would have nothing to compare with)`] : []),
];
if (problems.length && !values.force) {
  console.log(`Refusing: ${problems.join('; ')}. Wait, or add --force.`);
  await closeDb();
  process.exit(1);
}

const archivedAt = new Date();
async function archive(coll: string, filter: Filter<Document>): Promise<number> {
  const docs = await db.collection(coll).find(filter).toArray();
  if (docs.length === 0) return 0;
  await db.collection(`${coll}_archive`).insertMany(docs.map((d) => ({ ...d, _id: new ObjectId(), originalId: d._id, archivedAt, archiveEpoch: state.epoch })));
  await db.collection(coll).deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  return docs.length;
}

const archived = {
  guardrails: await archive(GUARDRAILS, { _id: { $gt: 0 } } as unknown as Filter<Document>),
  learning_runs: await archive(LEARNING_RUNS, {}),
  rollouts: await archive(ROLLOUTS, {}),
  evaluations: await archive(EVALUATIONS, { $nor: [baselines] }),
};
console.log(`archived (epoch ${state.epoch}): ${Object.entries(archived).map(([k, n]) => `${k} ${n}`).join(', ')}`);

const store = await resetStoreData(db);
console.log(`store data reset: ${JSON.stringify(store)}`);
const agent = await resetAgentState(db);
console.log(`agent reset: every store on v0, learning unpaused, epoch ${agent.epoch}; incidents, cons and conversations cleared`);

const left = {
  guardrails: await db.collection(GUARDRAILS).countDocuments(),
  evaluations: await db.collection(EVALUATIONS).countDocuments(),
  baselines: await db.collection(EVALUATIONS).countDocuments(baselines),
  learning_runs: await db.collection(LEARNING_RUNS).countDocuments(),
  rollouts: await db.collection(ROLLOUTS).countDocuments(),
};
console.log(`left: ${Object.entries(left).map(([k, n]) => `${k} ${n}`).join(', ')}. The next learned version is v1.`);
await closeDb();
process.exit(0);
