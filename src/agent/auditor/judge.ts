// Judge one ledger entry against the valid basis, after the money moved. Shared by the live auditor
// (AtlasStore) and the evaluation's scorer (MemoryStore).
import type { LedgerEntry, StoreApi } from '../../shared/contract';
import { checkoutBasis, refundBasis, type BasisResult } from '../guard/basis';
import { checkoutCallFromOrder, checkoutFacts, refundFacts } from '../guard/facts';

export interface Judgement extends BasisResult {
  kind: 'sale' | 'refund';
  amountCents: number;          // what moved, positive
  orderNumber: string | null;
}

/**
 * @param priorRefundedCents for a refund: what was refunded on its order by earlier entries. The
 *   order's refundedCents already includes this one, so the caller supplies the earlier total.
 */
export async function judgeEntry(store: StoreApi, entry: LedgerEntry, priorRefundedCents = 0): Promise<Judgement | null> {
  if (entry.kind === 'sale') {
    const order = entry.orderId ? (await store.ordersFor(entry.shopperId)).find((o) => o.id === entry.orderId) : undefined;
    if (!order) return null;
    const basis = checkoutBasis(await checkoutFacts(store, checkoutCallFromOrder(order)));
    return { ...basis, kind: 'sale', amountCents: order.totalCents, orderNumber: order.number };
  }
  if (entry.kind === 'refund') {
    const basis = refundBasis(await refundFacts(store, {
      shopperId: entry.shopperId,
      amountCents: entry.walletDeltaCents,
      orderNumber: entry.claimedOrderNumber,
      conversationId: entry.conversationId,
      priorRefundedCents,
    }));
    return { ...basis, kind: 'refund', amountCents: entry.walletDeltaCents, orderNumber: entry.claimedOrderNumber };
  }
  return null;                                    // grants are never judged
}

/** Judge a shopper's entries in order, tracking earlier refunds per order. */
export async function judgeEntries(store: StoreApi, entries: LedgerEntry[]): Promise<Judgement[]> {
  const refunded = new Map<string, number>();
  const out: Judgement[] = [];
  for (const e of entries) {
    const prior = e.orderId ? refunded.get(e.orderId) ?? 0 : 0;
    const j = await judgeEntry(store, e, prior);
    if (e.kind === 'refund' && e.orderId) refunded.set(e.orderId, prior + e.walletDeltaCents);
    if (j) out.push(j);
  }
  return out;
}
