import type { VoiceReply } from './voice';

// 50 ms of silent, unsigned 8-bit PCM WAV, playable without a network request.
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACA' + 'gICA'.repeat(133);
export type ReplyAudioState = 'ready' | 'playing' | 'blocked';

export function createReplyAudio(options: {
  enabled: boolean;
  onState: (id: string, state: ReplyAudioState | undefined) => void;
  createAudio?: () => HTMLAudioElement;
  isHidden?: () => boolean;
}) {
  let enabled = options.enabled;
  let player: HTMLAudioElement | null = null;
  let activeId: string | null = null;
  let generation = 0;
  let disposed = false;
  const replies = new Map<string, string>();
  const isHidden = options.isHidden ?? (() => document.hidden);

  function element() {
    if (disposed) return null;
    try {
      if (!player) {
        player = options.createAudio?.() ?? new Audio();
        player.preload = 'auto';
        player.setAttribute('playsinline', '');
      }
      return player;
    } catch { return null; }
  }

  function stop() {
    generation++;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
    }
    if (activeId) options.onState(activeId, 'ready');
    activeId = null;
  }

  function play(id: string) {
    const src = replies.get(id);
    if (!src || disposed) return;
    stop();
    const audio = element();
    if (!audio) { options.onState(id, 'blocked'); return; }
    activeId = id;
    const attempt = generation;
    const current = () => !disposed && attempt === generation && activeId === id;
    audio.src = src;
    audio.onended = () => {
      if (current()) { options.onState(id, 'ready'); activeId = null; }
    };
    audio.onerror = () => {
      if (current()) { options.onState(id, 'blocked'); activeId = null; }
    };
    try {
      void Promise.resolve(audio.play()).then(() => {
        if (current()) options.onState(id, 'playing');
      }).catch(() => { if (current()) options.onState(id, 'blocked'); });
    } catch { if (current()) options.onState(id, 'blocked'); }
  }

  return {
    // Called synchronously inside pointerdown (including touch) or keyboard click,
    // before getUserMedia or any await. Keep this element across every request.
    beginRecordingGesture() {
      if (disposed) return;
      stop();
      const audio = element();
      if (!audio) return;
      const attempt = generation;
      audio.src = SILENT_AUDIO;
      try {
        void Promise.resolve(audio.play()).then(() => {
          // A slow unlock promise must never pause a later spoken reply.
          if (!disposed && generation === attempt && !activeId) audio.pause();
        }).catch(() => { /* The reply still gets an explicit playback fallback. */ });
      } catch { /* Recording and text work even if playback cannot be unlocked. */ }
    },
    receive(id: string, reply: Pick<VoiceReply, 'audio' | 'audioType'>) {
      if (disposed || !reply.audio || !reply.audioType) return;
      replies.set(id, `data:${reply.audioType};base64,${reply.audio}`);
      options.onState(id, 'ready');
      // Keep audio out of persisted chat and bound the in-memory replay cache.
      if (replies.size > 60) {
        const oldest = replies.keys().next().value!;
        replies.delete(oldest);
        options.onState(oldest, undefined);
      }
      if (enabled && !isHidden()) play(id);
    },
    setEnabled(on: boolean) { enabled = on; if (!on) stop(); },
    play,
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      if (player) {
        player.onended = null;
        player.onerror = null;
        player.pause();
        player.removeAttribute('src');
        player.load();
        player = null;
      }
      activeId = null;
      replies.clear();
    },
  };
}

export function createSpeakerPreference(scope: string, storage?: { session: Storage; local: Storage },
  token: string = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const snapshotKey = `bodega:speaker-tab:${scope}`;
  const localKey = `bodega:speaker:${token}:${scope}`;
  let enabled = true;
  let stores: typeof storage;
  try {
    stores = storage ?? { session: sessionStorage, local: localStorage };
    const saved = JSON.parse(stores.session.getItem(snapshotKey) ?? 'null');
    if (typeof saved?.on === 'boolean') enabled = saved.on;
    // Rotate the localStorage namespace per document: duplicated tabs can copy
    // sessionStorage, but their future preferences must never write the same key.
    if (typeof saved?.key === 'string' && saved.key.startsWith('bodega:speaker:')) stores.local.removeItem(saved.key);
  } catch { /* Storage is optional in private browsing. */ }
  function save(on: boolean) {
    enabled = on;
    try { stores?.session.setItem(snapshotKey, JSON.stringify({ on, key: localKey })); } catch { /* Optional. */ }
    try { stores?.local.setItem(localKey, on ? 'on' : 'off'); } catch { /* Optional. */ }
  }
  save(enabled);
  return { get enabled() { return enabled; }, set: save };
}
