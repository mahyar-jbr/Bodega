// One MongoClient per process for MONGODB_URI, created on first use, so the app
// starts (and /api/health answers) without a database.
import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;

export function isDbConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export function dbName(): string {
  return process.env.MONGODB_DB?.trim() || 'bodega';
}

export function getClient(): MongoClient {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is not set');
  client ??= new MongoClient(uri, {
    appName: 'bodega',
    // Answer within 5 s when Atlas can't be reached (the driver's default is 30 s), so a
    // health check fails fast instead of hanging.
    serverSelectionTimeoutMS: 5_000,
    // Up to five processes share one free-tier cluster on build day (Render, two laptops,
    // the helper), and free tiers allow 500 connections. Operations are short and spaced
    // out by model calls, and the tier caps throughput at about 100 operations a second,
    // so 20 connections per process is plenty.
    maxPoolSize: 20,
  });
  return client;
}

/** The database named by MONGODB_DB (default "bodega"). Getting it doesn't connect. */
export function getDb(): Db {
  return getClient().db(dbName());
}

export type DbHealth =
  | { ok: true; name: string; latencyMs: number }
  | { ok: false; reason: 'not_configured' | 'unreachable'; detail: string };

/** Pings Atlas. Never throws, and never reports hosts or credentials. */
export async function pingDb(): Promise<DbHealth> {
  if (!isDbConfigured()) {
    return { ok: false, reason: 'not_configured', detail: 'MONGODB_URI is empty' };
  }
  const started = Date.now();
  try {
    await getClient().db('admin').command({ ping: 1 });
    return { ok: true, name: dbName(), latencyMs: Date.now() - started };
  } catch (error) {
    console.error('Atlas ping failed:', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'unreachable', detail: describe(error) };
  }
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.close();
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const codeName = (error as { codeName?: unknown }).codeName;
  return typeof codeName === 'string' ? `${error.name} (${codeName})` : error.name;
}
