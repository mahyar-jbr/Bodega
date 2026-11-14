// Conversations: the only place raw customer text lives. Append-only (one $push per message), never
// streamed, never shown on the big screen and never given to the learner. A TTL index deletes a
// conversation 24 hours after its last message (M2-10, src/agent/memory-rules.ts).
import type { Db } from 'mongodb';
import type { StoreId } from '../shared/contract';
import type { ShopkeeperMessage } from './shopkeeper/run';

export interface ConversationLog {
  load(conversationId: string): Promise<ShopkeeperMessage[]>;
  append(input: { conversationId: string; shopperId: string; storeId: StoreId; messages: ShopkeeperMessage[]; at: Date }): Promise<void>;
}

export interface ConversationDoc {
  _id: string;
  shopperId: string;
  storeId: StoreId;
  messages: ShopkeeperMessage[];
  messageCount: number;
  createdAt: Date;
  lastMessageAt: Date;
}

export const CONVERSATIONS = 'conversations';

/** One conversation per shopper (a shopper belongs to one store). */
export function conversationIdFor(shopperId: string): string {
  return `conv:${shopperId}`;
}

export function atlasConversations(db: Db): ConversationLog {
  const coll = db.collection<ConversationDoc>(CONVERSATIONS);
  return {
    async load(conversationId) {
      const doc = await coll.findOne({ _id: conversationId }, { projection: { messages: 1 } });
      return doc?.messages ?? [];
    },
    async append({ conversationId, shopperId, storeId, messages, at }) {
      if (messages.length === 0) return;
      await coll.updateOne(
        { _id: conversationId },
        {
          $push: { messages: { $each: messages } },
          $inc: { messageCount: messages.length },
          $set: { lastMessageAt: at },
          $setOnInsert: { shopperId, storeId, createdAt: at },
        },
        { upsert: true },
      );
    },
  };
}

/** For tests and keyless local runs. */
export function memoryConversations(): ConversationLog & { docs: Map<string, ShopkeeperMessage[]> } {
  const docs = new Map<string, ShopkeeperMessage[]>();
  return {
    docs,
    async load(id) { return structuredClone(docs.get(id) ?? []); },
    async append({ conversationId, messages }) { docs.set(conversationId, [...(docs.get(conversationId) ?? []), ...structuredClone(messages)]); },
  };
}
