import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { FlashSale } from '../bots/flash';
import { AgentError, type AgentApi, type StoreApi, type StoreId } from '../shared/contract';
import { resetStoreData } from '../store/reset';
import { createFlashJobs } from './flash-jobs';

const storeIdSchema = z.enum(['queen', 'yonge', 'scarborough']);
const shopperSchema = z.object({ storeId: storeIdSchema }).strict();
const chatSchema = z.object({
  shopperId: z.string().trim().min(1).max(200),
  storeId: storeIdSchema,
  text: z.string().trim().min(1).max(300),
}).strict();
const evalSchema = z.object({
  set: z.enum(['dev', 'heldout']),
  version: z.number().int().nonnegative().optional(),
}).strict();
const optionalStoreSchema = z.object({ storeId: storeIdSchema.optional() }).strict();
const storeSchema = z.object({ storeId: storeIdSchema }).strict();
const onlineSchema = z.object({ online: z.boolean() }).strict();
const approvalSchema = z.object({ on: z.boolean() }).strict();
const rejectionSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
const forgetShopperSchema = z.object({ shopperId: z.string().trim().min(1).max(200) }).strict();

const STORE_ORDER: StoreId[] = ['queen', 'yonge', 'scarborough'];
const AGENT_ERROR_STATUS: Record<AgentError['code'], number> = {
  too_long: 400,
  rate_limited: 429,
  unknown_shopper: 404,
  store_offline: 503,
  unavailable: 503,
};

type StoreDocument = {
  storeId: StoreId;
  name: string;
  color: string;
  awning: string;
};

export interface OpsAutomation {
  opening(storeId: StoreId): Promise<unknown>;
  startCrowd(storeId: StoreId): Promise<unknown>;
  stopCrowd(): Promise<unknown>;
  status(): { running: boolean; runId?: string; storeId?: StoreId; active?: number };
}

export interface RouteDeps {
  store: StoreApi;
  agent: AgentApi;
  db: Db;
  opsAutomation?: OpsAutomation;
  flash?: FlashSale;
  resetData?: () => Promise<unknown>;
  /** The clock for the open-ops limits (tests). */
  now?: () => number;
}

export function createApiRouter({ store, agent, db, opsAutomation, flash, resetData, now = Date.now }: RouteDeps): Router {
  const router = Router();
  const resetDataStore = resetData ?? (() => resetStoreData(db));
  const flashJobs = flash ? createFlashJobs(flash, db) : null;

  router.post('/shoppers', async (req, res) => {
    const input = shopperSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    const shopper = await store.createShopper({ storeId: input.data.storeId, kind: 'crowd' });
    res.status(201).json(shopper);
  });

  // Cheap identity validation for phone tabs surviving an ops Reset; no agent call.
  router.get('/shoppers/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = z.string().trim().min(1).max(200).safeParse(req.params.id);
    if (!id.success) return invalid(res);
    const shopper = await store.shopper(id.data);
    if (!shopper) return res.status(404).json({ error: 'unknown_shopper' });
    const { id: shopperId, nickname, storeId, walletCents } = shopper;
    res.json({ id: shopperId, nickname, storeId, walletCents });
  });

  router.post('/chat', async (req, res) => {
    const input = chatSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    try {
      res.json(await agent.handleMessage(input.data));
    } catch (error) {
      if (error instanceof AgentError) {
        res.status(AGENT_ERROR_STATUS[error.code]).json({ error: error.code });
        return;
      }
      throw error;
    }
  });

  router.get('/stores', async (_req, res) => {
    const stores = await db.collection<StoreDocument>('stores')
      .find({}, { projection: { _id: 0, storeId: 1, name: 1, color: 1, awning: 1 } })
      .toArray();
    const position = new Map(STORE_ORDER.map((storeId, index) => [storeId, index]));
    stores.sort((left, right) => (position.get(left.storeId) ?? 99) - (position.get(right.storeId) ?? 99));
    res.json(stores);
  });

  router.get('/agent/state', async (_req, res) => {
    res.json(await agent.state());
  });

  router.get('/agent/metrics', async (_req, res) => {
    res.json(await agent.metrics());
  });

  router.use('/ops', createOpsGate(now));

  router.post('/ops/approval', async (req, res) => {
    const input = approvalSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    if (!agent.setApprovalRequired) return notImplemented(res);
    sendResult(res, await agent.setApprovalRequired(input.data.on));
  });

  router.post('/ops/approve', async (_req, res) => {
    if (!agent.approve) return notImplemented(res);
    sendResult(res, await agent.approve());
  });

  router.post('/ops/reject', async (req, res) => {
    const input = rejectionSchema.safeParse(req.body ?? {});
    if (!input.success) return invalid(res);
    if (!agent.reject) return notImplemented(res);
    sendResult(res, await agent.reject(input.data.reason));
  });

  router.post('/ops/forget-shopper', async (req, res) => {
    const input = forgetShopperSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    if (!agent.forgetShopper) return notImplemented(res);
    sendResult(res, await agent.forgetShopper(input.data.shopperId));
  });

  router.post('/ops/prove-memory-rules', async (_req, res) => {
    if (!agent.proveMemoryRules) return notImplemented(res);
    sendResult(res, await agent.proveMemoryRules());
  });

  router.post('/ops/reset', async (_req, res) => {
    if (flashJobs?.running()) return res.status(409).json({ error: 'flash_busy' });
    await resetDataStore();
    sendResult(res, await agent.reset());
    flashJobs?.clear();
  });

  router.post('/ops/learn-now', async (_req, res) => {
    sendResult(res, await agent.learnNow());
  });

  router.post('/ops/eval', async (req, res) => {
    const input = evalSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    sendResult(res, await agent.runEval(input.data));
  });

  router.post('/ops/gate-demo', async (_req, res) => {
    sendResult(res, await agent.gateDemo());
  });

  router.post('/ops/rollback', async (_req, res) => {
    sendResult(res, await agent.rollback());
  });

  router.post('/ops/opening', async (req, res) => {
    if (!opsAutomation) return unavailable(res);
    const input = optionalStoreSchema.safeParse(req.body ?? {});
    if (!input.success) return invalid(res);
    sendResult(res, await opsAutomation.opening(input.data.storeId ?? 'queen'));
  });

  router.post('/ops/crowd/start', async (req, res) => {
    if (!opsAutomation) return unavailable(res);
    const input = storeSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    sendResult(res, await opsAutomation.startCrowd(input.data.storeId));
  });

  router.post('/ops/crowd/stop', async (_req, res) => {
    if (!opsAutomation) return unavailable(res);
    sendResult(res, await opsAutomation.stopCrowd());
  });

  router.get('/ops/crowd/status', (_req, res) => {
    if (!opsAutomation) return unavailable(res);
    sendResult(res, opsAutomation.status());
  });

  router.post('/ops/flash', (req, res) => {
    const input = optionalStoreSchema.safeParse(req.body ?? {});
    if (!input.success) return invalid(res);
    if (!flashJobs) return unavailable(res);
    const storeId = input.data.storeId ?? 'queen';
    if (flashJobs.running(storeId)) return res.status(409).json({ error: 'flash_busy' });
    res.status(202).json(flashJobs.start(storeId));
  });

  router.get('/ops/flash', async (req, res) => {
    const input = optionalStoreSchema.safeParse(req.query);
    if (!input.success) return invalid(res);
    if (!flashJobs) return unavailable(res);
    res.json({ run: await flashJobs.status(input.data.storeId ?? 'queen') });
  });

  router.post('/ops/store/:storeId/online', async (req, res) => {
    const storeId = storeIdSchema.safeParse(req.params.storeId);
    const input = onlineSchema.safeParse(req.body);
    if (!storeId.success || !input.success) return invalid(res);
    await agent.setStoreOnline(storeId.data, input.data.online);
    const updated = (await agent.state()).stores.find((entry) => entry.storeId === storeId.data);
    if (!updated) return unavailable(res);
    res.json(updated);
  });

  return router;
}

type PasswordCheck = 'ok' | 'not_configured' | 'wrong';

function checkOpsPassword(req: Request): PasswordCheck {
  const expected = process.env.OPS_PASSWORD;
  if (!expected) return 'not_configured';
  const supplied = req.get('x-ops-password') ?? '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes) ? 'ok' : 'wrong';
}

export type OpenOpsPolicy =
  | { kind: 'password' }
  | { kind: 'open' }
  | { kind: 'global'; everyMs: number }
  | { kind: 'perIp'; max: number; windowMs: number };

const PER_IP = { kind: 'perIp', max: 10, windowMs: 60_000 } as const;

/** With OPS_OPEN=true, what an ops route needs without the password. Anything that spends money or
 *  floods the app (eval, gate-demo, learn-now, crowd/start, flash), and any route not listed here,
 *  still needs it. */
export function openOpsPolicy(method: string, path: string): OpenOpsPolicy {
  if (method === 'GET') return { kind: 'open' };                     // status reads
  const p = path.toLowerCase().replace(/\/+$/, '') || '/';
  switch (p) {
    case '/opening': return { kind: 'global', everyMs: 60_000 };     // starts learning and a gate run
    case '/reset': return { kind: 'global', everyMs: 10_000 };
    case '/rollback': return { kind: 'global', everyMs: 5_000 };
    case '/approval': case '/approve': case '/reject': case '/forget-shopper': case '/prove-memory-rules': case '/crowd/stop':
      return PER_IP;
  }
  if (/^\/store\/[^/]+\/online$/.test(p)) return PER_IP;
  return { kind: 'password' };
}

/** The ops routes' gate. The right password always passes, with no limits. With OPS_OPEN=true (a
 *  demo-day switch, off unless set exactly), the demo buttons work without it, within the limits above. */
function createOpsGate(now: () => number): RequestHandler {
  const lastAt = new Map<string, number>();
  const hits = new Map<string, number[]>();
  return (req, res, next) => {
    const password = checkOpsPassword(req);
    if (password === 'ok') { next(); return; }
    if (process.env.OPS_OPEN?.trim() === 'true') {
      const policy = openOpsPolicy(req.method, req.path);
      if (policy.kind !== 'password') {
        const t = now();
        let waitMs = 0;
        if (policy.kind === 'global') {
          const key = req.path.toLowerCase().replace(/\/+$/, '');
          const last = lastAt.get(key);
          if (last !== undefined && t - last < policy.everyMs) waitMs = policy.everyMs - (t - last);
          else lastAt.set(key, t);
        } else if (policy.kind === 'perIp') {
          const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
          const recent = (hits.get(key) ?? []).filter((at) => t - at < policy.windowMs);
          if (recent.length >= policy.max) waitMs = policy.windowMs - (t - recent[0]);
          else recent.push(t);
          hits.set(key, recent);
          if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((at) => t - at >= policy.windowMs)) hits.delete(k);
        }
        if (waitMs > 0) {
          const seconds = Math.ceil(waitMs / 1000);
          res.set('retry-after', String(seconds)).status(429).json({ error: 'rate_limited', detail: `wait ${seconds} s`, retryAfterS: seconds });
          return;
        }
        next();
        return;
      }
    }
    if (password === 'not_configured') { res.status(503).json({ error: 'ops_not_configured' }); return; }
    res.status(401).json({ error: 'unauthorized' });
  };
}

function invalid(res: Response) {
  return res.status(400).json({ error: 'invalid_request' });
}

function unavailable(res: Response) {
  return res.status(503).json({ error: 'unavailable' });
}

function notImplemented(res: Response) {
  return res.status(501).json({ error: 'not_implemented' });
}

function sendResult(res: Response, result: unknown) {
  res.json(result ?? {});
}
