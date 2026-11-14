import type { ChatReply, StoreId } from '../../shared/contract';
import { ApiError } from '../ui/api';

export type VoicePhase = 'idle' | 'requesting' | 'recording' | 'sending';
export interface VoiceReply {
  transcript: string;
  reply: ChatReply;
  audio: string | null;
  audioType: string | null;
}

export const MAX_RECORDING_MS = 30_000;
const MAX_AUDIO_BYTES = 3_500_000; // Leave room for multipart framing under the server's 4 MB limit.

export function canRecordVoice(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

/** Empty multipart is rejected before transcription: this probe makes no paid speech or agent call. */
export async function voiceAvailable(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/voice', { method: 'POST', body: new FormData(), signal });
    return response.status !== 501 && response.status !== 404;
  } catch {
    return !signal.aborted; // A transient network failure can be retried with a real recording.
  }
}

export function friendlyVoiceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'voice_off') return 'Voice is unavailable right now. You can still type below.';
    if (error.code === 'no_speech') return 'Didn’t catch that. Try speaking again, or type below.';
    if (error.status === 429) return 'Slow down a little and try that again.';
    if (error.code === 'too_long') return 'Keep your spoken message under 300 characters. Try a shorter one.';
    if (error.code === 'unknown_shopper') return 'I lost your shopper tab. Refresh and I’ll get you back in.';
    if (error.status === 413) return 'That recording is too large. Try a shorter message.';
    if (error.status === 503) return 'The store is closed for a moment. Try again shortly.';
    if (error.status === 502) return 'The voice line didn’t connect. Try again, or type below.';
  }
  if (error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
    return 'Allow microphone access in your browser, or type your message below.';
  }
  if (error instanceof Error && ['NotFoundError', 'NotReadableError'].includes(error.name)) {
    return 'Your microphone isn’t available. Check it, or type your message below.';
  }
  return 'Couldn’t send that voice message. Please try again, or type below.';
}

export function parseVoiceReply(payload: unknown): VoiceReply {
  if (!payload || typeof payload !== 'object') throw new Error('Incomplete voice reply');
  const value = payload as Partial<VoiceReply>;
  if (typeof value.transcript !== 'string' || !value.transcript.trim()
    || typeof value.reply?.reply !== 'string' || !Number.isSafeInteger(value.reply.walletCents)
    || !Array.isArray(value.reply.actions) || !Array.isArray(value.reply.blocked)) {
    throw new Error('Incomplete voice reply');
  }
  return {
    transcript: value.transcript, reply: value.reply,
    audio: typeof value.audio === 'string' ? value.audio : null,
    audioType: value.audioType === 'audio/mpeg' ? value.audioType : null,
  };
}

export function createVoiceRecorder(options: {
  shopperId: string;
  storeId: StoreId;
  onPhase: (phase: VoicePhase) => void;
  onReply: (reply: VoiceReply) => void;
  onError: (error: unknown, transcript?: string) => void;
  onUnavailable: () => void;
}) {
  let phase: VoicePhase = 'idle';
  let generation = 0;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;

  function setPhase(next: VoicePhase) { phase = next; options.onPhase(next); }
  function releaseTracks() {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  function cancel() {
    generation++;
    request?.abort();
    request = null;
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    releaseTracks();
    setPhase('idle');
  }

  async function upload(blob: Blob, token: number) {
    setPhase('sending');
    request = new AbortController();
    try {
      const form = new FormData();
      form.append('audio', blob, blob.type.includes('mp4') ? 'voice.mp4' : 'voice.webm');
      form.append('shopperId', options.shopperId);
      form.append('storeId', options.storeId);
      // Let fetch set the multipart boundary; apiJson's default JSON header is inappropriate here.
      const response = await fetch('/api/voice', { method: 'POST', body: form, signal: request.signal });
      const payload = await response.json().catch(() => null);
      if (token !== generation) return;
      if (!response.ok) {
        const error = new ApiError(response.status, typeof payload?.error === 'string' ? payload.error : null, 'Voice request failed');
        if (error.code === 'voice_off' || response.status === 501) options.onUnavailable();
        options.onError(error, typeof payload?.transcript === 'string' ? payload.transcript : undefined);
        return;
      }
      options.onReply(parseVoiceReply(payload));
    } catch (error) {
      if (token === generation) options.onError(error);
    } finally {
      if (token === generation) { request = null; setPhase('idle'); }
    }
  }

  return {
    get phase() { return phase; },
    async start() {
      if (phase !== 'idle') return;
      const token = ++generation;
      setPhase('requesting');
      try {
        const granted = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (token !== generation) { granted.getTracks().forEach((track) => track.stop()); return; }
        stream = granted;
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
          .find((type) => MediaRecorder.isTypeSupported(type));
        const current = new MediaRecorder(granted, mime ? { mimeType: mime } : undefined);
        recorder = current;
        const chunks: Blob[] = [];
        let size = 0;
        current.ondataavailable = ({ data }) => {
          if (data.size) { chunks.push(data); size += data.size; }
          if (size > MAX_AUDIO_BYTES && token === generation) {
            cancel();
            options.onError(new ApiError(413, 'recording_too_large', 'Recording too large'));
          }
        };
        current.onerror = () => { if (token === generation) { cancel(); options.onError(new Error('Recording failed')); } };
        current.onstop = () => {
          if (token !== generation) return;
          recorder = null;
          releaseTracks();
          const blob = new Blob(chunks, { type: current.mimeType || chunks[0]?.type || 'audio/webm' });
          if (!blob.size) { setPhase('idle'); options.onError(new ApiError(422, 'no_speech', 'Empty recording')); return; }
          void upload(blob, token);
        };
        current.start(1_000);
        setPhase('recording');
        timer = setTimeout(() => { if (current.state === 'recording') current.stop(); }, MAX_RECORDING_MS);
      } catch (error) {
        if (token === generation) { cancel(); options.onError(error); }
      }
    },
    stop() {
      if (phase === 'requesting') cancel(); // A release during the permission prompt must not leave the mic running.
      else if (recorder?.state === 'recording') recorder.stop();
    },
    cancel,
  };
}

export type VoiceRecorder = ReturnType<typeof createVoiceRecorder>;
