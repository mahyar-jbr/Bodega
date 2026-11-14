import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler, type Response } from 'express';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { AgentError, type AgentApi, type StoreApi, type StoreId } from '../shared/contract';
import { resetStoreData } from '../store/reset';

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
  resetData?: () => Promise<unknown>;
}

export function createApiRouter({ store, agent, db, opsAutomation, resetData }: RouteDeps): Router {
  const router = Router();
  const resetDataStore = resetData ?? (() => resetStoreData(db));

  router.post('/shoppers', async (req, res) => {
    const input = shopperSchema.safeParse(req.body);
    if (!input.success) return invalid(res);
    const shopper = await store.createShopper({ storeId: input.data.storeId, kind: 'crowd' });
    res.status(201).json(shopper);
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

  router.use('/ops', requireOpsPassword);

  router.post('/ops/reset', async (_req, res) => {
    await resetDataStore();
    sendResult(res, await agent.reset());
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

  return router;
}

const requireOpsPassword: RequestHandler = (req, res, next) => {
  const expected = process.env.OPS_PASSWORD;
  if (!expected) {
    res.status(503).json({ error: 'ops_not_configured' });
    return;
  }
  const supplied = req.get('x-ops-password') ?? '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const valid = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
  if (!valid) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};

function invalid(res: Response) {
  return res.status(400).json({ error: 'invalid_request' });
}

function unavailable(res: Response) {
  return res.status(503).json({ error: 'unavailable' });
}

function sendResult(res: Response, result: unknown) {
  res.json(result ?? {});
}
