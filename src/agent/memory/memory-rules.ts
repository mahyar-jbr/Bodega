// The memory rules, enforced by Atlas itself (problem statement 2):
// - Raw chat text lives only in `conversations`, and a TTL index deletes a conversation 24 hours after
//   its last message, with no cleanup job.
// - Shared memory holds summaries only: validators on `incidents` and `cons` reject documents with
//   raw-text fields, so no customer's words reach shared memory.
// Startup never fails on these: each problem is logged loudly instead (for example a database user
// without the collMod privilege), and memoryRulesStatus() reports what is in place.
import { isDeepStrictEqual } from 'node:util';
import type { Db } from 'mongodb';
import { CONVERSATIONS } from '../conversations';
import { CONS, INCIDENTS } from '../rollout/state';

export const RAW_TEXT_FIELDS = ['text', 'messages', 'turns', 'excerpts'] as const;
export const RAW_TEXT_TTL_SECONDS = 24 * 60 * 60;
export const TTL_INDEX = 'raw_text_expires_24h';

export const NO_RAW_TEXT_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'Summaries only: raw customer text never enters shared memory',
    not: { anyOf: RAW_TEXT_FIELDS.map((field) => ({ required: [field] })) },
  },
};

async function validatorOf(db: Db, name: string): Promise<unknown> {
  const [info] = await db.listCollections({ name }).toArray();
  return (info as { options?: { validator?: unknown } } | undefined)?.options?.validator;
}

export async function ensureMemoryRules(db: Db): Promise<void> {
  try {
    await db.collection(CONVERSATIONS).createIndex({ lastMessageAt: 1 }, { expireAfterSeconds: RAW_TEXT_TTL_SECONDS, name: TTL_INDEX });
  } catch (error) {
    console.error(`MEMORY RULES: the TTL index on conversations failed: ${(error as Error).message}`);
  }
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of [INCIDENTS, CONS]) {
    try {
      if (!existing.has(name)) {
        await db.createCollection(name, { validator: NO_RAW_TEXT_VALIDATOR, validationLevel: 'strict', validationAction: 'error' });
      } else if (!isDeepStrictEqual(await validatorOf(db, name), NO_RAW_TEXT_VALIDATOR)) {
        await db.command({ collMod: name, validator: NO_RAW_TEXT_VALIDATOR, validationLevel: 'strict', validationAction: 'error' });
      }
    } catch (error) {
      console.error(`MEMORY RULES: the validator on ${name} failed (${(error as Error).message}). The database user needs createCollection and collMod.`);
    }
  }
}

/** What is in place, for checks and the screen. */
export async function memoryRulesStatus(db: Db) {
  const ttl = (await db.collection(CONVERSATIONS).indexes().catch(() => [])).find((i) => i.name === TTL_INDEX);
  return {
    conversationsTtlSeconds: ttl?.expireAfterSeconds ?? null,
    incidentsValidator: isDeepStrictEqual(await validatorOf(db, INCIDENTS), NO_RAW_TEXT_VALIDATOR),
    consValidator: isDeepStrictEqual(await validatorOf(db, CONS), NO_RAW_TEXT_VALIDATOR),
  };
}
