import { Router, type Request, type Response } from 'express';
import {
  SCREEN_COLLECTIONS,
  STRIP_FIELDS,
  type ChangeBus,
  type ChangeEvent,
  type StoreId,
} from '../shared/contract';
import { isStoreId } from '../shared/store-data';

const HEARTBEAT_MS = 15_000;
const OPS_COLLECTIONS = ['settings', 'bot_runs'] as const;
const STORE_COLLECTIONS = ['orders', 'ledger'] as const;
const SHOPPER_COLLECTIONS = ['shoppers', 'orders', 'ledger'] as const;
const STRIPPED = new Set<string>(STRIP_FIELDS);

export interface SseRouteDeps {
  bus: ChangeBus;
}

interface TopicSubscription {
  topic: string;
  collections: readonly string[];
  matches: (event: ChangeEvent) => boolean;
}

export function createSseRouter({ bus }: SseRouteDeps): Router {
  const router = Router();

  router.get('/api/events', (req, res) => {
    const parsed = parseTopics(req);
    if ('error' in parsed) {
      res.status(400).json({ error: 'invalid_topics', detail: parsed.error });
      return;
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const byCollection = new Map<string, TopicSubscription[]>();
    for (const subscription of parsed.subscriptions) {
      for (const coll of subscription.collections) {
        const subscriptions = byCollection.get(coll) ?? [];
        subscriptions.push(subscription);
        byCollection.set(coll, subscriptions);
      }
    }

    const unsubscribe = [...byCollection].map(([coll, subscriptions]) =>
      bus.on(coll, (event) => {
        for (const subscription of subscriptions) {
          if (!subscription.matches(event)) continue;
          writeEvent(res, {
            topic: subscription.topic,
            coll: event.coll,
            op: event.op,
            doc: stripFields(event.doc),
            at: event.at,
          });
        }
      }));
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    heartbeat.unref();

    res.once('close', () => {
      clearInterval(heartbeat);
      for (const off of unsubscribe) off();
    });
  });

  return router;
}

function parseTopics(req: Request): { subscriptions: TopicSubscription[] } | { error: string } {
  const raw = Array.isArray(req.query.topics) ? req.query.topics.join(',') : String(req.query.topics ?? '');
  const topics = [...new Set(raw.split(',').map((topic) => topic.trim()).filter(Boolean))];
  if (topics.length === 0) return { error: 'topics is required' };

  const subscriptions: TopicSubscription[] = [];
  for (const topic of topics) {
    if (topic === 'screen') {
      subscriptions.push({ topic, collections: SCREEN_COLLECTIONS, matches: () => true });
      continue;
    }
    if (topic === 'ops') {
      subscriptions.push({ topic, collections: OPS_COLLECTIONS, matches: () => true });
      continue;
    }
    if (topic.startsWith('store:')) {
      const storeId = topic.slice('store:'.length);
      if (!isStoreId(storeId)) return { error: `unknown store topic "${topic}"` };
      subscriptions.push({ topic, collections: STORE_COLLECTIONS, matches: storeMatcher(storeId) });
      continue;
    }
    if (topic.startsWith('shopper:')) {
      const shopperId = topic.slice('shopper:'.length).trim();
      if (!shopperId || shopperId.length > 128) return { error: `invalid shopper topic "${topic}"` };
      subscriptions.push({ topic, collections: SHOPPER_COLLECTIONS, matches: shopperMatcher(shopperId) });
      continue;
    }
    return { error: `unknown topic "${topic}"` };
  }
  return { subscriptions };
}

function storeMatcher(storeId: StoreId): (event: ChangeEvent) => boolean {
  return (event) => field(event.doc, 'storeId') === storeId;
}

function shopperMatcher(shopperId: string): (event: ChangeEvent) => boolean {
  return (event) => event.coll === 'shoppers'
    ? field(event.doc, 'id') === shopperId
    : field(event.doc, 'shopperId') === shopperId;
}

function field(doc: unknown, key: string): unknown {
  return doc && typeof doc === 'object' ? (doc as Record<string, unknown>)[key] : undefined;
}

function stripFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFields);
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !STRIPPED.has(key))
      .map(([key, child]) => [key, stripFields(child)]),
  );
}

function writeEvent(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
