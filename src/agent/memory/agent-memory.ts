// Atlas Agent Memory (Agent Engine) client for the con memory (ARCHITECTURE Appendix E).
// Auth: the project's service account (AGENTIC_MEMORY_CLIENT_ID / _SECRET) is exchanged for a 1-hour
// token, refreshed before it expires. A fetch shim puts the fresh token on every request and carries
// the two fixes SDK 0.11.13 needs: drop empty org_id/project_id from request bodies, and drop null
// embeddings from responses.
import { Memory } from '@mongodb-js/agent-engine-sdk-memory';

const GATEWAY = 'https://agentengine.mongodb.com';
const TOKEN_URL = `${GATEWAY}/api/v1/oauth/token`;

export function agentMemoryConfigured(): boolean {
  return Boolean(process.env.AGENTIC_MEMORY_CLIENT_ID?.trim() && process.env.AGENTIC_MEMORY_CLIENT_SECRET?.trim()
    && process.env.AGENTIC_MEMORY_PROJECT_ID?.trim());
}

let token: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const clientId = process.env.AGENTIC_MEMORY_CLIENT_ID!.trim();
  const clientSecret = process.env.AGENTIC_MEMORY_CLIENT_SECRET!.trim();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Agent Memory token: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Agent Memory token: no access_token in the response');
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** A valid token, refreshed 5 minutes before it expires. */
export async function accessToken(): Promise<string> {
  if (token && token.expiresAt - Date.now() > 5 * 60_000) return token.value;
  pending ??= fetchToken().finally(() => { pending = null; });
  return pending;
}

function dropKeys(value: unknown, drop: (key: string, v: unknown) => boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => dropKeys(v, drop));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => !drop(k, v)).map(([k, v]) => [k, dropKeys(v, drop)]));
  }
  return value;
}

async function shimFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await accessToken()}`);
  let body = init.body;
  if (typeof body === 'string' && body.startsWith('{')) {
    try {
      body = JSON.stringify(dropKeys(JSON.parse(body), (k, v) => (k === 'org_id' || k === 'project_id') && v === ''));
    } catch { /* not JSON: send as is */ }
  }
  const res = await fetch(url, { ...init, headers, body });
  if (!(res.headers.get('content-type') ?? '').includes('json')) return res;
  const text = await res.text();
  let fixed = text;
  try { fixed = JSON.stringify(dropKeys(JSON.parse(text), (k, v) => k === 'embedding' && v === null)); } catch { /* leave it */ }
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(fixed, { status: res.status, statusText: res.statusText, headers: out });
}

let memory: Memory | null = null;

export function agentMemory(): Memory {
  memory ??= new Memory({
    serviceAccountToken: 'refreshed-per-request',   // the shim sets the real token on each request
    projectId: process.env.AGENTIC_MEMORY_PROJECT_ID!.trim(),
    baseUrl: GATEWAY,
    fetchImpl: shimFetch,
  });
  return memory;
}
