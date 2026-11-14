import { describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from '../shared/contract';
import { isInvalidResumeTokenError, MongoChangeBus, STREAM_COLLECTIONS } from './change-bus';

describe('MongoChangeBus', () => {
  it('watches shoppers and every screen collection, but never conversations', () => {
    expect(STREAM_COLLECTIONS).toContain('shoppers');
    expect(STREAM_COLLECTIONS).toContain('orders');
    expect(STREAM_COLLECTIONS).not.toContain('conversations');
  });

  it('subscribes and unsubscribes collection listeners', () => {
    const bus = new MongoChangeBus({} as never);
    const listener = vi.fn<(event: ChangeEvent) => void>();
    const unsubscribe = bus.on('orders', listener);
    const change = {
      _id: { token: 1 }, operationType: 'insert', ns: { db: 'test', coll: 'orders' },
      documentKey: { _id: 'mongo-id' }, fullDocument: { id: 'order-id' },
    };

    Reflect.get(bus, 'dispatch').call(bus, change);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ coll: 'orders', op: 'insert', id: 'order-id' }));
    unsubscribe();
    Reflect.get(bus, 'dispatch').call(bus, change);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('recognizes only invalid or lost resume-token errors', () => {
    for (const code of [260, 280, 286]) expect(isInvalidResumeTokenError({ code })).toBe(true);
    expect(isInvalidResumeTokenError({ code: 6 })).toBe(false);
    expect(isInvalidResumeTokenError(new Error('network'))).toBe(false);
  });

  it('deletes only the saved bus checkpoint when a resume token is invalid', async () => {
    const deleteOne = vi.fn(async () => ({ deletedCount: 1 }));
    const bus = new MongoChangeBus({ collection: () => ({ deleteOne }) } as never);
    await Reflect.get(bus, 'clearStoredToken').call(bus);
    expect(deleteOne).toHaveBeenCalledWith({ _id: 'database-change-stream' });
  });
});
