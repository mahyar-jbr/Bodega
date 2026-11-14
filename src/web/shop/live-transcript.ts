import type { VoicePreview } from './voice';

export const LIVE_SAMPLE_RATE = 16_000;
export const LIVE_CHUNK_SAMPLES = 1_600;
const MAX_QUEUED_SAMPLES = LIVE_SAMPLE_RATE * 2;

/** Area averaging across callback boundaries, using the actual device rate (including iOS 44.1/48k). */
export class Pcm16Resampler {
  private readonly ratio: number;
  private remaining: number;
  private sum = 0;
  private weight = 0;

  constructor(inputSampleRate: number) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) throw new Error('Invalid microphone sample rate');
    this.ratio = inputSampleRate / LIVE_SAMPLE_RATE;
    this.remaining = this.ratio;
  }

  push(input: Float32Array): Int16Array {
    const output: number[] = [];
    for (const value of input) {
      const sample = Number.isFinite(value) ? value : 0;
      let width = 1;
      while (width > 1e-8) {
        const used = Math.min(width, this.remaining);
        this.sum += sample * used;
        this.weight += used;
        this.remaining -= used;
        width -= used;
        if (this.remaining < 1e-8) {
          const average = Math.max(-1, Math.min(1, this.sum / this.weight));
          output.push(Math.round(average * (average < 0 ? 32_768 : 32_767)));
          this.sum = 0;
          this.weight = 0;
          this.remaining = this.ratio;
        }
      }
    }
    return Int16Array.from(output);
  }
}

export function pcm16Base64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return btoa(String.fromCharCode(...bytes));
}

/** Optional, display-only preview. No transcript is sent to our app or persisted. */
export function createLiveTranscript(options: { shopperId: string; onText: (text: string | null) => void }): VoicePreview | null {
  const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context || typeof WebSocket === 'undefined') return null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let mute: GainNode | null = null;
  let socket: WebSocket | null = null;
  let active = true;
  let ending = false;
  let started = false;
  let commitSent = false;
  let stable = '';
  let partial = '';
  const pending: number[] = [];
  const tokenRequest = new AbortController();
  let setupTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function stopAudio() {
    if (processor) processor.onaudioprocess = null;
    try { source?.disconnect(); } catch { /* Already disconnected. */ }
    try { processor?.disconnect(); } catch { /* Already disconnected. */ }
    try { mute?.disconnect(); } catch { /* Already disconnected. */ }
    source = null; processor = null; mute = null;
    if (context) { void context.close().catch(() => {}); context = null; }
    // The shared microphone tracks belong to MediaRecorder, not this optional preview.
  }

  function close(clearText: boolean) {
    if (!active) return;
    active = false;
    tokenRequest.abort();
    clearTimeout(setupTimer); clearTimeout(closeTimer);
    stopAudio();
    pending.length = 0;
    if (socket) {
      socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(); } catch { /* An unopened socket may already have closed. */ }
      socket = null;
    }
    if (clearText) options.onText(null);
  }

  function sendAudio(samples: Int16Array, commit: boolean) {
    if (!socket || socket.readyState !== 1) return;
    if (socket.bufferedAmount > 128_000) throw new Error('Live audio connection is slow');
    socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm16Base64(samples), commit, sample_rate: LIVE_SAMPLE_RATE }));
  }

  function flush() {
    if (!active || !started || !socket || socket.readyState !== 1) return;
    try {
      while (pending.length >= LIVE_CHUNK_SAMPLES || (ending && pending.length)) {
        sendAudio(Int16Array.from(pending.splice(0, LIVE_CHUNK_SAMPLES)), false);
      }
      if (ending && !commitSent) { sendAudio(new Int16Array(), true); commitSent = true; }
    } catch { close(true); }
  }

  function showText() {
    const text = partial.startsWith(stable) ? partial : [stable, partial].filter(Boolean).join(' ');
    options.onText(text.trim().slice(0, 4_000) || null);
  }

  // Construct/resume during the press gesture, before awaiting microphone permission or the token.
  try {
    context = new Context({ latencyHint: 'interactive' });
    void context.resume().catch(() => close(true));
  } catch { close(true); return null; }
  options.onText(null);
  setupTimer = setTimeout(() => close(true), 5_000);

  void (async () => {
    try {
      const response = await fetch(`/api/voice/token?shopperId=${encodeURIComponent(options.shopperId)}`, { signal: tokenRequest.signal });
      if (!response.ok) { close(true); return; }
      const ticket = await response.json() as { url?: unknown; sampleRate?: unknown; audioFormat?: unknown };
      if (!active) return;
      if (typeof ticket.url !== 'string' || !ticket.url.startsWith('wss://') || ticket.sampleRate !== LIVE_SAMPLE_RATE || ticket.audioFormat !== 'pcm_16000') {
        close(true); return;
      }
      // Use the single-use URL as provided. Never log it or put it in storage.
      socket = new WebSocket(ticket.url);
      socket.onmessage = ({ data }) => {
        if (!active) return;
        try {
          const message = JSON.parse(String(data)) as { message_type?: string; text?: unknown; error?: unknown };
          const type = message.message_type ?? '';
          if (type === 'session_started') { started = true; clearTimeout(setupTimer); flush(); }
          else if (type === 'partial_transcript') {
            if (typeof message.text !== 'string') { close(true); return; }
            partial = message.text; showText();
          } else if (type === 'committed_transcript') {
            if (typeof message.text !== 'string') { close(true); return; }
            const text = message.text.trim();
            stable = text.startsWith(stable) ? text : [stable, text].filter(Boolean).join(' ');
            partial = stable; showText();
            if (ending && commitSent) close(false);
          } else if (message.error || /error|exceeded|overflow|exhausted|rate_limited/.test(type)) close(true);
        } catch { close(true); }
      };
      socket.onerror = () => close(true);
      socket.onclose = () => close(!ending);
    } catch { close(true); }
  })();

  return {
    attachStream(stream) {
      if (!active || ending || !context) return;
      try {
        const resampler = new Pcm16Resampler(context.sampleRate);
        source = context.createMediaStreamSource(stream);
        // ScriptProcessor is supported by iOS; output is muted, and the recorder keeps the full file.
        processor = context.createScriptProcessor(2_048, 1, 1);
        mute = context.createGain();
        mute.gain.value = 0;
        processor.onaudioprocess = (event) => {
          if (!active || ending) return;
          const pcm = resampler.push(event.inputBuffer.getChannelData(0));
          for (const sample of pcm) pending.push(sample);
          flush();
          if (pending.length > MAX_QUEUED_SAMPLES) close(true);
        };
        source.connect(processor); processor.connect(mute); mute.connect(context.destination);
      } catch { close(true); }
    },
    finish() {
      if (!active || ending) return;
      ending = true;
      stopAudio();
      if (!socket) { close(true); return; }
      flush();
      if (active) closeTimer = setTimeout(() => close(false), 1_500);
    },
    cancel() { close(true); options.onText(null); },
  };
}
