import type {
  ChangeStream,
  ChangeStreamDocument,
  Db,
  Document,
  ResumeToken,
} from 'mongodb';
import { SCREEN_COLLECTIONS, type ChangeBus, type ChangeEvent } from '../shared/contract';

const STATE_ID = 'database-change-stream';
const DEFAULT_SAVE_INTERVAL_MS = 3_000;
const MAX_BACKOFF_MS = 5_000;

export const STREAM_COLLECTIONS = [...new Set([...SCREEN_COLLECTIONS, 'shoppers'])];

interface BusStateDoc {
  _id: string;
  token: ResumeToken;
  updatedAt: Date;
}

export interface MongoChangeBusOptions {
  collections?: readonly string[];
  saveIntervalMs?: number;
}

export class MongoChangeBus implements ChangeBus {
  private readonly handlers = new Map<string, Set<(event: ChangeEvent) => void>>();
  private readonly collections: readonly string[];
  private readonly saveIntervalMs: number;
  private stream: ChangeStream<Document, ChangeStreamDocument<Document>> | undefined;
  private loopPromise: Promise<void> | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private running = false;
  private lastToken: ResumeToken | undefined;
  private savedToken: ResumeToken | undefined;

  constructor(private readonly db: Db, options: MongoChangeBusOptions = {}) {
    this.collections = options.collections ?? STREAM_COLLECTIONS;
    this.saveIntervalMs = options.saveIntervalMs ?? DEFAULT_SAVE_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.saveTimer = setInterval(() => void this.flushToken(), this.saveIntervalMs);
    this.saveTimer.unref();
    this.loopPromise = this.watchLoop();
  }

  on<T = unknown>(coll: string, fn: (event: ChangeEvent<T>) => void): () => void {
    let listeners = this.handlers.get(coll);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(coll, listeners);
    }
    const listener = fn as (event: ChangeEvent) => void;
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.handlers.delete(coll);
    };
  }

  async close(): Promise<void> {
    if (!this.running && !this.loopPromise) return;
    this.running = false;
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = undefined;
    const stream = this.stream;
    this.stream = undefined;
    await stream?.close().catch(() => undefined);
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = undefined;
    await this.flushToken();
  }

  private async watchLoop(): Promise<void> {
    let backoffMs = 250;
    let loadedState = false;
    while (this.running) {
      try {
        if (!loadedState) {
          const state = await this.db.collection<BusStateDoc>('bus_state').findOne({ _id: STATE_ID });
          this.lastToken = state?.token;
          this.savedToken = state?.token;
          loadedState = true;
        }
        const options = {
          fullDocument: 'updateLookup' as const,
          ...(this.lastToken ? { resumeAfter: this.lastToken } : {}),
        };
        const stream = this.db.watch<Document, ChangeStreamDocument<Document>>([
          {
            $match: {
              'ns.coll': { $in: [...this.collections] },
              operationType: { $in: ['insert', 'update', 'replace', 'delete'] },
            },
          },
        ], options);
        this.stream = stream;
        backoffMs = 250;

        for await (const change of stream) {
          if (!this.running) break;
          this.lastToken = change._id;
          this.dispatch(change);
        }
        this.stream = undefined;
        if (this.running) throw new Error('change stream ended');
      } catch (error) {
        this.stream = undefined;
        if (!this.running) break;
        console.error(`Change stream reconnecting after ${describeError(error)}`);
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private dispatch(change: ChangeStreamDocument<Document>): void {
    if (!('ns' in change) || !('documentKey' in change)) return;
    const coll = change.ns.coll;
    if (!coll) return;
    const listeners = this.handlers.get(coll);
    if (!listeners?.size) return;

    const fullDocument = 'fullDocument' in change ? change.fullDocument ?? null : null;
    const event: ChangeEvent = {
      coll,
      op: change.operationType as ChangeEvent['op'],
      id: documentId(fullDocument, change.documentKey._id),
      doc: fullDocument,
      at: new Date(),
    };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`Change listener for ${coll} failed: ${describeError(error)}`);
      }
    }
  }

  private async flushToken(): Promise<void> {
    const token = this.lastToken;
    if (!token || token === this.savedToken) return;
    try {
      await this.db.collection<BusStateDoc>('bus_state').updateOne(
        { _id: STATE_ID },
        { $set: { token, updatedAt: new Date() } },
        { upsert: true },
      );
      this.savedToken = token;
    } catch (error) {
      if (this.running) console.error(`Change stream token save failed: ${describeError(error)}`);
    }
  }
}

function documentId(doc: Document | null, key: unknown): string {
  const value = doc && typeof doc.id === 'string' ? doc.id : key;
  return typeof value === 'string' ? value : String(value ?? '');
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const codeName = (error as { codeName?: unknown }).codeName;
  return typeof codeName === 'string' ? `${error.name} (${codeName})` : error.name;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
