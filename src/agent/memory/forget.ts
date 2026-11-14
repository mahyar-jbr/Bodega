// Forget one shopper (memory you can govern): their raw chats are deleted, and every incident and
// blocked-call metric that named them is anonymised. What the stores learned from them stays: the
// money amounts, violations and summaries, and the cons and rules (which never held raw text or ids).
// The ledger and orders are store-side money records with opaque ids, and stay as they are.
// Each erasure is recorded in forget_log with counts only: no shopper id, no nickname.
import type { Db } from 'mongodb';
import type { StoreApi } from '../../shared/contract';
import { CONVERSATIONS } from '../conversations';
import { INCIDENTS } from '../rollout/state';

export const FORGET_LOG = 'forget_log';
export const FORGOTTEN_NICKNAME = 'a forgotten shopper';

export interface ForgetLogDoc {
  at: Date;
  counts: { conversationsDeleted: number; incidentsRedacted: number; metricsRedacted: number };
}

export async function forgetShopper(db: Db, store: StoreApi, shopperId: string): Promise<{ conversationsDeleted: number; incidentsRedacted: number }> {
  const shopper = await store.shopper(shopperId).catch(() => null);
  const conversations = await db.collection(CONVERSATIONS).deleteMany({ shopperId });
  // conversationId is conv:<shopperId>, so it goes too.
  const incidents = await db.collection(INCIDENTS).updateMany({ shopperId },
    { $set: { shopperId: null, nickname: FORGOTTEN_NICKNAME, conversationId: null } });
  // Blocked-call metrics carry the nickname for the screen's feed. Best effort: a time-series
  // collection may refuse the update on some tiers, and the erasure still counts what it could.
  let metricsRedacted = 0;
  if (shopper?.nickname) {
    metricsRedacted = await db.collection('attack_metrics')
      .updateMany({ nickname: shopper.nickname }, { $set: { nickname: FORGOTTEN_NICKNAME } })
      .then((r) => r.modifiedCount)
      .catch((e) => { console.error(`forget: attack_metrics not anonymised (${(e as Error).message})`); return 0; });
  }
  const counts = { conversationsDeleted: conversations.deletedCount, incidentsRedacted: incidents.modifiedCount, metricsRedacted };
  await db.collection<ForgetLogDoc>(FORGET_LOG).insertOne({ at: new Date(), counts });
  return { conversationsDeleted: counts.conversationsDeleted, incidentsRedacted: counts.incidentsRedacted };
}
