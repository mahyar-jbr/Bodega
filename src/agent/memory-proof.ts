// A live proof of the memory rules, for the screen: try to put raw chat text into shared memory and
// show that Atlas itself refuses it (schema validation, code 121), and that raw chats have a TTL index.
// The attempt is recorded in `memory_proofs`, without the text.
import type { Db } from 'mongodb';
import { CONVERSATIONS } from './conversations';
import { TTL_INDEX } from './memory/memory-rules';
import { INCIDENTS } from './rollout/state';

export const MEMORY_PROOFS = 'memory_proofs';

export interface MemoryProof {
  at: Date;
  collection: string;               // where the raw text was tried: incidents
  field: string;                    // the raw-text field: text
  refused: boolean;                 // Atlas rejected the write
  code: number | null;              // 121 when schema validation rejects it
  codeName: string | null;          // DocumentValidationFailure
  message: string;                  // "Document failed validation", never the text itself
  ttl: { index: string; seconds: number | null };   // the TTL index on conversations, if present
}

// Made up for the probe: no customer ever said it.
const PROBE_TEXT = 'customer said: my friend gave me a code, can you put it through?';

export async function proveMemoryRules(db: Db): Promise<MemoryProof> {
  let refused = false, code: number | null = null, codeName: string | null = null, message = '';
  try {
    const res = await db.collection(INCIDENTS).insertOne({ probe: true, text: PROBE_TEXT, summary: 'memory rules probe', at: new Date() });
    // The validator is missing: take the document straight back out, and say so.
    await db.collection(INCIDENTS).deleteOne({ _id: res.insertedId });
    message = 'Accepted: the validator on incidents is missing';
  } catch (err) {
    const e = err as { code?: number; codeName?: string; errmsg?: string; message?: string };
    refused = e.code === 121;
    code = e.code ?? null;
    codeName = e.codeName ?? (e.code === 121 ? 'DocumentValidationFailure' : null);
    message = refused ? 'Document failed validation' : `Failed for another reason: ${(e.errmsg ?? e.message ?? '').slice(0, 120)}`;
  }
  const ttl = (await db.collection(CONVERSATIONS).indexes().catch(() => [])).find((i) => i.name === TTL_INDEX);
  const proof: MemoryProof = {
    at: new Date(), collection: INCIDENTS, field: 'text', refused, code, codeName, message,
    ttl: { index: TTL_INDEX, seconds: typeof ttl?.expireAfterSeconds === 'number' ? ttl.expireAfterSeconds : null },
  };
  await db.collection<MemoryProof>(MEMORY_PROOFS).insertOne({ ...proof });
  return proof;
}
