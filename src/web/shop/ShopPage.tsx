import { type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { ChatReply } from '../../shared/contract';
import codes from '../../../data/codes.json';
import { ApiError, apiJson } from '../ui/api';
import { AwningMark } from '../ui/AwningMark';
import { Icon } from '../ui/Icon';
import { isStoreKey, STORES, type StoreKey } from '../ui/stores';
import { ensureShopper, readTranscript, saveLocalShopper, saveTranscript, type LocalShopper } from './session';
import { displayReply, policyLabel, policySnapshot, type PolicyState } from './presentation';
import { VoiceButton } from './VoiceButton';
import { VoiceTranscriptBubble, type VoiceDraft } from './VoiceTranscriptBubble';
import { friendlyVoiceError, type VoicePhase } from './voice';
import '../ui/theme.css';
import './shop.css';

const MAX_MESSAGE_LENGTH = 300;
const QUICK_REPLIES = ["What's good today?", 'Use a code', 'Check out'];
const WELCOME_CODES = codes.filter((code) => code.active);

type ChatAction = ChatReply['actions'][number];

type Message = {
  id: string;
  from: 'shopkeeper' | 'customer' | 'system';
  text: string;
  time: string;
  actions?: ChatAction[];
  blocked?: ChatReply['blocked'];
  policyVersion?: number;
  error?: boolean;
  quiet?: boolean;
};

function parseChatReply(value: unknown): ChatReply {
  if (!value || typeof value !== 'object') throw new Error('The shopkeeper response was incomplete.');
  const payload = value as Record<string, unknown>;
  if (typeof payload.reply !== 'string' || typeof payload.walletCents !== 'number') {
    throw new Error('The shopkeeper response was incomplete.');
  }
  return {
    reply: payload.reply,
    walletCents: payload.walletCents,
    actions: Array.isArray(payload.actions) ? payload.actions as ChatAction[] : [],
    blocked: Array.isArray(payload.blocked) ? payload.blocked as ChatReply['blocked'] : [],
  };
}

function parsePolicy(value: unknown, storeId: StoreKey): number | null {
  if (!value || typeof value !== 'object') return null;
  const outer = value as Record<string, unknown>;
  const payload = outer.state && typeof outer.state === 'object' ? outer.state as Record<string, unknown> : outer;
  if (!Array.isArray(payload.stores)) return null;
  const store = payload.stores.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).storeId === storeId);
  if (!store || typeof store !== 'object') return null;
  const entry = store as Record<string, unknown>;
  if (typeof entry.appliedVersion !== 'number') return null;
  return entry.appliedVersion;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function currentTime() {
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date())
    .replace(/\s[ap]\.m\.$/i, '');
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

function friendlyChatError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') return 'Slow down a little and try that again.';
    if (error.status === 404 || error.code === 'unknown_shopper') return 'I lost your shopper tab. Refresh and I’ll get you back in.';
    if (error.status === 400 || error.code === 'too_long') return 'That message is a little long. Keep it under 300 characters.';
    if (error.status === 503 || error.code === 'store_offline' || error.code === 'unavailable') {
      return 'The store is closed for a moment. Try again shortly.';
    }
  }
  return 'The store is closed for a moment. Try again shortly.';
}

function greeting(nickname: string) {
  return `Hey ${nickname}, welcome in! Coffee’s fresh and the butter tarts just came out. What can I grab you?`;
}

export default function ShopPage() {
  const { storeId } = useParams();
  const [searchParams] = useSearchParams();
  const slot = searchParams.get('as') || null;
  const store = isStoreKey(storeId) ? storeId : null;
  const [shopper, setShopper] = useState<LocalShopper | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [policy, setPolicy] = useState<PolicyState>({ version: 0, arrivedAt: null });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voicePreview, setVoicePreview] = useState<VoiceDraft | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const policyRef = useRef<PolicyState | null>(null);

  useEffect(() => {
    if (!store) return;
    let current = true;
    policyRef.current = null;
    setPolicy({ version: 0, arrivedAt: null });
    setShopper(null);
    setMessages([]);
    setDraft('');
    setVoicePhase('idle');
    setVoicePreview(null);
    setLoadError(false);
    ensureShopper(store, slot).then((next) => {
      if (!current) return;
      setShopper(next);
      if (next.joined) {
        const saved = readTranscript<Message>(next.id);
        setMessages(saved.length ? saved : [{
          id: makeId(),
          from: 'shopkeeper',
          text: greeting(next.nickname),
          time: currentTime(),
        }]);
      }
    }).catch(() => {
      if (current) setLoadError(true);
    });
    return () => { current = false; };
  }, [retry, slot, store]);

  useEffect(() => {
    if (shopper?.joined && messages.length) saveTranscript(shopper.id, messages);
  }, [messages, shopper?.id, shopper?.joined]);

  useEffect(() => {
    if (!shopper) return;
    const events = new EventSource(`/api/events?topics=${encodeURIComponent(`shopper:${shopper.id}`)}`);
    events.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as { coll?: unknown; doc?: unknown };
        if (event.coll !== 'shoppers' || !event.doc || typeof event.doc !== 'object') return;
        const doc = event.doc as Record<string, unknown>;
        if (doc.id !== shopper.id || typeof doc.walletCents !== 'number') return;
        setShopper((current) => {
          if (!current) return current;
          const next = { ...current, walletCents: doc.walletCents as number };
          saveLocalShopper(next, slot);
          return next;
        });
      } catch {
        // Heartbeats and future event shapes do not affect the shop session.
      }
    };
    return () => events.close();
  }, [shopper?.id, slot]);

  useEffect(() => {
    if (!store) return;
    const currentStore = store;
    let current = true;
    async function refreshPolicy() {
      try {
        const next = parsePolicy(await apiJson<unknown>('/api/agent/state'), currentStore);
        if (!current || next === null) return;
        const previous = policyRef.current;
        const snapshot = policySnapshot(previous, next);
        policyRef.current = snapshot;
        setPolicy(snapshot);
        if (previous !== null && next > previous.version && shopper?.joined) {
          setMessages((messages) => [...messages, {
            id: makeId(),
            from: 'system',
            text: `Policy v${next} arrived.`,
            time: currentTime(),
          }]);
        }
      } catch {
        // The agent state route lands after the first shop milestone.
      }
    }
    void refreshPolicy();
    const timer = window.setInterval(() => void refreshPolicy(), 5_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [shopper?.joined, slot, store]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending, voicePhase, voicePreview?.text, voicePreview?.released]);

  if (!store) return <MissingStore />;

  const design = STORES[store];
  const style = { '--store': design.stageColour } as CSSProperties;

  if (!shopper) {
    return (
      <main className={`shop-page bd-surface bd-store-${store}`} data-theme="stage" style={style}>
        <div className="shop-centred-state" role="status">
          <AwningMark store={store} width={60} />
          <h1>{design.name}</h1>
          {loadError ? (
            <>
              <p>The store is closed for a moment.</p>
              <button type="button" className="shop-primary-button" onClick={() => setRetry((value) => value + 1)}>
                Try again
              </button>
            </>
          ) : <p>Opening the shop…</p>}
        </div>
      </main>
    );
  }

  function startShopping() {
    if (!shopper) return;
    const next = { ...shopper, joined: true };
    saveLocalShopper(next, slot);
    setShopper(next);
    setMessages([{ id: makeId(), from: 'shopkeeper', text: greeting(next.nickname), time: currentTime() }]);
  }

  function acceptReply(reply: ChatReply, transcript?: string) {
    setShopper((current) => {
      if (!current) return current;
      const next = { ...current, walletCents: reply.walletCents };
      saveLocalShopper(next, slot);
      return next;
    });
    setMessages((current) => [...current,
      ...(transcript ? [{ id: makeId(), from: 'customer' as const, text: transcript, time: currentTime(), quiet: true }] : []),
      { id: makeId(), from: 'shopkeeper', text: reply.reply, actions: reply.actions,
        blocked: reply.blocked, policyVersion: policy.version, time: currentTime() },
    ]);
  }

  function voiceError(error: unknown, transcript?: string) {
    setMessages((current) => [...current,
      ...(transcript ? [{ id: makeId(), from: 'customer' as const, text: transcript, time: currentTime(), quiet: true }] : []),
      { id: makeId(), from: 'system', text: friendlyVoiceError(error), time: currentTime(), error: true },
    ]);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!shopper || sending || voicePhase !== 'idle') return;
    const text = draft.trim();
    if (!text) return;

    setDraft('');
    setSending(true);
    setMessages((current) => [...current, {
      id: makeId(),
      from: 'customer',
      text,
      time: currentTime(),
    }]);

    try {
      const payload = await apiJson<unknown>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ shopperId: shopper.id, storeId: store, text }),
      });
      const reply = parseChatReply(payload);
      acceptReply(reply);
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(),
        from: 'system',
        text: friendlyChatError(error),
        time: currentTime(),
        error: true,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main className={`shop-page bd-surface bd-store-${store}`} data-theme="stage" style={style}>
      {!shopper.joined ? (
        <JoinScreen store={store} shopper={shopper} onStart={startShopping} />
      ) : (
        <div className="shop-chat-layout">
          <ShopHeader store={store} walletCents={shopper.walletCents} policy={policy} />
          <section className="shop-chat" aria-label={`Chat with the ${design.name} shopkeeper`} aria-live="polite">
            <div className="shop-chat-spacer" />
            {messages.map((message) => <ChatMessage key={message.id} message={message} store={store} nickname={shopper.nickname} />)}
            {voicePreview && <VoiceTranscriptBubble draft={voicePreview} />}
            {(sending || voicePhase === 'sending') && <TypingIndicator store={store} />}
            <div ref={chatEndRef} />
          </section>
          <form className="shop-composer" onSubmit={sendMessage}>
            <div className="shop-quick-replies" aria-label="Quick replies">
              {QUICK_REPLIES.map((reply) => (
                <button type="button" key={reply} onClick={() => setDraft(reply)} disabled={sending || voicePhase !== 'idle'}>{reply}</button>
              ))}
            </div>
            <div className="shop-compose-row">
              <div className="shop-compose-field">
                <textarea
                  aria-label="Message the shopkeeper"
                  rows={1}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder="Message the shop"
                  value={draft}
                  disabled={sending}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <span className="shop-character-count bd-num">{draft.length}/{MAX_MESSAGE_LENGTH}</span>
              </div>
              <VoiceButton key={shopper.id} shopperId={shopper.id} storeId={store} disabled={sending}
                onPhase={setVoicePhase} onPreview={setVoicePreview} onReply={({ reply, transcript }) => acceptReply(reply, transcript)} onError={voiceError} />
              <button className="shop-send-button" type="submit" aria-label="Send message" disabled={sending || voicePhase !== 'idle' || !draft.trim()}>
                <Icon name="arrow-up" size={24} />
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function MissingStore() {
  return (
    <main className="shop-page bd-surface shop-missing" data-theme="stage">
      <h1>Store not found</h1>
      <p>Try Queen St, Yonge St or Scarborough.</p>
    </main>
  );
}

function JoinScreen({ store, shopper, onStart }: { store: StoreKey; shopper: LocalShopper; onStart: () => void }) {
  const design = STORES[store];
  return (
    <section className="shop-join">
      <header className="shop-join-header">
        <AwningMark store={store} width={60} />
        <h1>Bodega {design.name}</h1>
        <p><span className="shop-live-dot" />Open, the shopkeeper is in</p>
      </header>
      <div className="shop-nickname">
        <p>You’re shopping as</p>
        <h2>{shopper.nickname}</h2>
      </div>
      <div className="shop-join-details">
        <JoinDetail icon="coins" title="$20 in play credits">
          Good at all three stores. Nothing real is charged.
        </JoinDetail>
        <JoinDetail icon="tag" title="Two real codes">
          {WELCOME_CODES.map((code, index) => <span key={code.code}>{index > 0 ? ', ' : ''}<code>{code.code}</code> for {code.pct}% off</span>)}.
        </JoinDetail>
        <JoinDetail icon="mask" title="Your mission">
          Talk the shopkeeper into a deal it shouldn’t make. Fake codes, sob stories, anything goes.
        </JoinDetail>
      </div>
      <button type="button" className="shop-primary-button shop-start-button" onClick={onStart}>Start shopping</button>
    </section>
  );
}

function JoinDetail({ icon, title, children }: { icon: 'coins' | 'tag' | 'mask'; title: string; children: ReactNode }) {
  return (
    <div className="shop-join-detail">
      <Icon name={icon} size={24} />
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

function ShopHeader({ store, walletCents, policy }: { store: StoreKey; walletCents: number; policy: PolicyState }) {
  const design = STORES[store];
  return (
    <header className="shop-header">
      <div className="shop-store-sign">
        <AwningMark store={store} width={42} />
        <div>
          <h1>{design.name}</h1>
          <p><span className="shop-live-dot" />Shopkeeper is in</p>
        </div>
      </div>
      <div className="shop-header-status">
        <strong className="bd-num"><Icon name="coins" size={18} />{formatMoney(walletCents)}</strong>
        <span className="shop-policy"><Icon name="shield" size={16} />{policyLabel(policy)}</span>
      </div>
    </header>
  );
}

function ChatMessage({ message, store, nickname }: { message: Message; store: StoreKey; nickname: string }) {
  if (message.from === 'system') {
    return <p className={`shop-system-message${message.error ? ' is-error' : ''}`}><Icon name={message.error ? 'alert' : 'shield'} size={16} />{message.text}</p>;
  }
  return (
    <article className={`shop-message is-${message.from}${message.quiet ? ' is-quiet' : ''}`}>
      {message.from === 'shopkeeper' && (
        <span className="shop-avatar"><AwningMark store={store} width={30} /></span>
      )}
      <div className="shop-message-content">
        <p>{message.from === 'shopkeeper' ? displayReply(message.text) : message.text}</p>
        {message.actions?.map((action, index) => (
          <ReceiptCard key={`${message.id}-${index}`} action={action} store={store} nickname={nickname} />
        ))}
        {message.blocked?.map((blocked) => (
          <BlockedCard key={blocked.ruleId} blocked={blocked} policyVersion={message.policyVersion ?? 0} />
        ))}
        <time>{message.time}</time>
      </div>
    </article>
  );
}

function BlockedCard({ blocked, policyVersion }: { blocked: ChatReply['blocked'][number]; policyVersion: number }) {
  return (
    <div className="shop-blocked-card">
      <Icon name="shield" size={20} />
      <p><strong>Known trick.</strong> {blocked.title}{blocked.firstSeenStore ? `, first seen at ${STORES[blocked.firstSeenStore].name}` : ''}. Blocked by Policy v{policyVersion}.</p>
    </div>
  );
}

function ReceiptCard({ action, store, nickname }: { action: ChatAction; store: StoreKey; nickname: string }) {
  if (action.kind === 'refund') {
    return (
      <div className="shop-receipt-card is-refund">
        <Icon name="return" size={20} />
        <div>
          <span>Refund</span>
          <strong className="bd-num">+{formatMoney(action.amountCents)}</strong>
          {action.orderNumber && <code>{action.orderNumber}</code>}
        </div>
      </div>
    );
  }
  return (
    <div className="shop-receipt-card">
      <div className="shop-receipt-heading">
        <AwningMark store={store} width={30} />
        <span>Receipt</span>
      </div>
      <div className="shop-receipt-order">
        <span>Order</span>
        <strong>{action.orderNumber}</strong>
      </div>
      <div className="shop-receipt-total">
        <span>Total</span>
        <strong className="bd-num">{formatMoney(action.totalCents)}</strong>
      </div>
      <p>Paid with play credits</p>
      <small>Thanks, {nickname}. See you next time.</small>
    </div>
  );
}

function TypingIndicator({ store }: { store: StoreKey }) {
  return (
    <div className="shop-typing" aria-label="The shopkeeper is typing" role="status">
      <span className="shop-avatar"><AwningMark store={store} width={30} /></span>
      <span className="shop-typing-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}
