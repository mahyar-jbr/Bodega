// A live check of the deployed app, with one chat message (one shopkeeper turn). Run it before the
// recorded run and before judging, before the ops reset (its shopper and $2.50 order are real).
//   npm run smoke                                   the live app
//   npm run smoke -- --url http://localhost:3000    any other
//   npm run smoke -- --store yonge --no-heartbeat   another store; skip waiting for the 15 s heartbeat
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.SMOKE_URL ?? 'https://bodega-dxwd.onrender.com' },
    store: { type: 'string', default: 'scarborough' },
    'no-heartbeat': { type: 'boolean', default: false },
  },
});
const base = values.url!.replace(/\/$/, '');
const storeId = values.store!;
const results: { name: string; ok: boolean; ms: number; note: string }[] = [];

async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, note });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, note: (error as Error).message });
  }
  const r = results.at(-1)!;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${String(r.ms).padStart(6)} ms  ${r.note}`);
  return r.ok;
}

async function json(path: string, init?: RequestInit & { expect?: number }) {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (res.status !== (init?.expect ?? 200)) throw new Error(`HTTP ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  return body;
}

function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

console.log(`Smoke check of ${base} at ${storeId}`);
let shopper: { id: string; walletCents: number } | null = null;

await check('health', async () => {
  const h = await json('/api/health');
  must(h?.ok === true, `not ok: ${JSON.stringify(h)}`);
  return `database ${h.db.name}, ${h.db.latencyMs} ms to Atlas, up ${h.uptimeSeconds} s`;
});

await check('stores', async () => {
  const stores = (await json('/api/stores')) as { storeId: string; name: string }[];
  must(stores.map((s) => s.storeId).join() === 'queen,yonge,scarborough', `stores: ${stores.map((s) => s.storeId).join()}`);
  return stores.map((s) => s.name).join(', ');
});

await check('create a shopper', async () => {
  shopper = await json('/api/shoppers', { method: 'POST', body: JSON.stringify({ storeId }), expect: 201 });
  must(shopper?.id && shopper.walletCents === 2000, `unexpected shopper ${JSON.stringify(shopper)}`);
  return `${(shopper as unknown as { nickname: string }).nickname}, $20.00`;
});

await check('chat purchase', async () => {
  must(shopper, 'no shopper');
  const r = await json('/api/chat', { method: 'POST', body: JSON.stringify({ shopperId: shopper.id, storeId, text: 'one iced tea please' }) });
  const order = r.actions?.find((a: { kind: string }) => a.kind === 'order');
  must(order?.totalCents === 250, `no $2.50 order: ${JSON.stringify(r.actions)} reply "${String(r.reply).slice(0, 80)}"`);
  must(r.walletCents === 1750, `wallet ${r.walletCents}, expected 1750`);
  return `${order.orderNumber} for $2.50, wallet $17.50`;
});

await check('agent state', async () => {
  const s = await json('/api/agent/state');
  must(Array.isArray(s.stores) && s.stores.length === 3, 'not 3 stores');
  const offline = s.stores.filter((x: { online: boolean }) => !x.online).map((x: { storeId: string }) => x.storeId);
  must(offline.length === 0, `offline: ${offline.join(', ')}`);
  return `active v${s.activeVersion}, stores on ${s.stores.map((x: { appliedVersion: number }) => `v${x.appliedVersion}`).join('/')}, learning ${s.learning}, paused ${s.learningPaused}, screen ${s.screen ? 'yes' : 'missing'}`;
});

await check('live updates (SSE)', async () => {
  const res = await fetch(`${base}/api/events?topics=screen`, { signal: AbortSignal.timeout(values['no-heartbeat'] ? 8_000 : 20_000) });
  must(res.ok && (res.headers.get('content-type') ?? '').includes('text/event-stream'), `HTTP ${res.status} ${res.headers.get('content-type')}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const started = Date.now();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      seen += decoder.decode(value, { stream: true });
      if (seen.includes(': connected') && (values['no-heartbeat'] || seen.includes(': heartbeat'))) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return values['no-heartbeat'] ? 'connected' : `connected, heartbeat after ${((Date.now() - started) / 1000).toFixed(1)} s`;
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nSMOKE PASS: ${results.length} of ${results.length}` : `\nSMOKE FAIL: ${failed.map((r) => r.name).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
