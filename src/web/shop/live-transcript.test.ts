import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveTranscript, LIVE_CHUNK_SAMPLES, Pcm16Resampler, pcm16Base64 } from './live-transcript';
import { createShopSession, saveLocalShopper } from './session';

const ticket = { url: 'wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=fake-single-use', model: 'scribe_v3_live', audioFormat: 'pcm_16000', sampleRate: 16000, expiresInS: 900 };
let sockets: FakeSocket[];
let contexts: FakeContext[];
let fetchMock: ReturnType<typeof vi.fn>;
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const localWrite = vi.fn();
const sessionWrite = vi.fn();

class FakeNode {
  connect = vi.fn(); disconnect = vi.fn();
  gain = { value: 1 };
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
}
class FakeContext {
  sampleRate = 48_000;
  source = new FakeNode(); processor = new FakeNode(); gain = new FakeNode(); destination = {};
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => this.source);
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => this.gain);
  constructor() { contexts.push(this); }
  feed(samples: Float32Array) { this.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent); }
}
class FakeSocket {
  readyState = 1; bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null; onclose: (() => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor(public url: string) { sockets.push(this); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  sockets = []; contexts = [];
  stopTrack.mockClear(); localWrite.mockClear(); sessionWrite.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(ticket)));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('localStorage', { setItem: localWrite });
  vi.stubGlobal('sessionStorage', { setItem: sessionWrite });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture() {
  const onText = vi.fn();
  const live = createLiveTranscript({ shopperId: 'shopper q/2', onText })!;
  live.attachStream(stream);
  await flush();
  return { live, onText, context: contexts[0], socket: sockets[0] };
}
const messages = (socket: FakeSocket) => socket.send.mock.calls.map(([text]) => JSON.parse(text));

describe('live token after a Reset', () => {
  function storage() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  }

  it.each([false, true])('recovers once for token 404; second missing=%s falls back without another shopper or socket', async (alwaysMissing) => {
    vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
    const old = { id: 'before-reset', nickname: 'Old Goose', storeId: 'queen' as const, walletCents: 300, joined: true };
    saveLocalShopper(old, 'q1');
    fetchMock.mockImplementation(async (path: string) => {
      if (path === `/api/shoppers/${old.id}`) return new Response(JSON.stringify(old));
      if (path === '/api/shoppers') return new Response(JSON.stringify({ ...old, id: 'new-shopper', nickname: 'New Maple', walletCents: 2000 }));
      return path.endsWith(old.id) || alwaysMissing ? new Response(JSON.stringify({ error: 'unknown_shopper' }), { status: 404 }) : new Response(JSON.stringify(ticket));
    });
    const changed = vi.fn(); const session = createShopSession('queen', 'q1', changed); await session.load();
    const onText = vi.fn();
    const live = createLiveTranscript({ shopperId: old.id, withShopper: session.run, onText })!;
    live.attachStream(stream);
    for (let index = 0; index < 60; index++) await Promise.resolve();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/voice/token')).map(([path]) => path)).toEqual([
      '/api/voice/token?shopperId=before-reset', '/api/voice/token?shopperId=new-shopper',
    ]);
    expect(changed.mock.calls.filter(([, reason]) => reason === 'reset')).toHaveLength(1);
    expect(session.shopper).toMatchObject({ id: 'new-shopper', nickname: 'New Maple', walletCents: 2000 });
    expect(sockets).toHaveLength(alwaysMissing ? 0 : 1);
    if (!alwaysMissing) { sockets[0].message({ message_type: 'partial_transcript', text: 'One coffee' }); expect(onText).toHaveBeenLastCalledWith('One coffee'); }
    expect(stopTrack).not.toHaveBeenCalled();
    live.cancel();
  });
});

describe('16 kHz PCM encoding', () => {
  it.each([44_100, 48_000, 16_000])('resamples a second at actual %i Hz to exactly 16000 samples', (sampleRate) => {
    const encoded = new Pcm16Resampler(sampleRate).push(new Float32Array(sampleRate).fill(0.5));
    expect(encoded).toHaveLength(16_000);
    expect(encoded.every((sample) => sample === 16_384)).toBe(true);
  });

  it('preserves fractional sample-rate continuity across arbitrary microphone callbacks', () => {
    const input = Float32Array.from({ length: 4_410 }, (_, index) => Math.sin(index / 27));
    const whole = new Pcm16Resampler(44_100).push(input);
    const streaming = new Pcm16Resampler(44_100);
    const chunks: number[] = [];
    for (let offset = 0; offset < input.length; offset += 137) chunks.push(...streaming.push(input.slice(offset, offset + 137)));
    expect(Int16Array.from(chunks)).toEqual(whole);
    expect(whole).toHaveLength(1_600);
  });

  it('encodes signed Int16 in little-endian order and clips loud input', () => {
    const clipped = new Pcm16Resampler(16_000).push(new Float32Array([-2, 0, 2]));
    expect([...clipped]).toEqual([-32_768, 0, 32_767]);
    expect([...Buffer.from(pcm16Base64(clipped), 'base64')]).toEqual([0, 128, 0, 0, 255, 127]);
    expect(pcm16Base64(new Int16Array())).toBe('');
  });
});

describe('phone-only live transcript protocol', () => {
  it('requests one ticket, uses its URL as-is, and sends only 1600-sample frames after session_started', async () => {
    const f = await fixture();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/voice/token?shopperId=shopper%20q%2F2');
    expect(f.socket.url).toBe(ticket.url);
    f.context.feed(new Float32Array(4_800).fill(0.5));
    expect(f.socket.send).not.toHaveBeenCalled();
    f.socket.message({ message_type: 'session_started' });
    const [frame] = messages(f.socket);
    expect(frame).toMatchObject({ message_type: 'input_audio_chunk', commit: false, sample_rate: 16_000 });
    expect(Buffer.from(frame.audio_base_64, 'base64')).toHaveLength(LIVE_CHUNK_SAMPLES * 2);
    expect(Buffer.from(frame.audio_base_64, 'base64').readInt16LE(0)).toBe(16_384);
    expect(f.context.gain.gain.value).toBe(0);
    f.live.cancel();
  });

  it('replaces partial words, keeps committed words stable, and never persists or posts text', async () => {
    const f = await fixture();
    f.socket.message({ message_type: 'session_started' });
    f.socket.message({ message_type: 'partial_transcript', text: 'One' });
    f.socket.message({ message_type: 'partial_transcript', text: 'One coffee' });
    expect(f.onText).toHaveBeenLastCalledWith('One coffee');
    f.socket.message({ message_type: 'committed_transcript', text: 'One coffee' });
    f.socket.message({ message_type: 'partial_transcript', text: 'please' });
    expect(f.onText).toHaveBeenLastCalledWith('One coffee please');
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    f.live.cancel();
  });

  it('flushes the last samples, sends the empty final commit, and closes after the committed reply', async () => {
    const f = await fixture();
    f.socket.message({ message_type: 'session_started' });
    f.context.feed(new Float32Array(4_800 + 300).fill(0.25));
    f.live.finish();
    const frames = messages(f.socket);
    expect(frames).toHaveLength(3);
    expect(Buffer.from(frames[1].audio_base_64, 'base64')).toHaveLength(200);
    expect(frames[2]).toEqual({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16_000 });
    expect(f.socket.close).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
    f.socket.message({ message_type: 'committed_transcript', text: 'One coffee please' });
    expect(f.onText).toHaveBeenLastCalledWith('One coffee please');
    expect(f.socket.close).toHaveBeenCalledOnce();
    f.live.cancel();
    expect(f.onText).toHaveBeenLastCalledWith(null);
  });

  it('closes after 1.5 seconds without waiting for the ordinary recording upload', async () => {
    const f = await fixture();
    f.socket.message({ message_type: 'session_started' });
    f.live.finish();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(f.socket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.socket.close).toHaveBeenCalledOnce();
    expect(f.context.processor.onaudioprocess).toBeNull();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('waits for a late handshake before sending the final commit, within the close deadline', async () => {
    const f = await fixture();
    f.context.feed(new Float32Array(4_800));
    f.live.finish();
    expect(f.socket.send).not.toHaveBeenCalled();
    f.socket.message({ message_type: 'session_started' });
    expect(messages(f.socket).at(-1)?.commit).toBe(true);
    f.live.cancel();
  });

  it.each([501, 429, 502])('quietly disables live text on token HTTP %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
    const f = await fixture();
    expect(sockets).toHaveLength(0);
    expect(f.onText).toHaveBeenLastCalledWith(null);
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
    f.live.cancel();
  });

  it('aborts a late ticket on cancellation and does not open a stale socket', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const f = await fixture();
    f.live.cancel();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    respond(new Response(JSON.stringify(ticket)));
    await flush();
    expect(sockets).toHaveLength(0);
    expect(f.context.close).toHaveBeenCalledOnce();
  });

  it('hides failed live text and disconnects only its own audio graph', async () => {
    const f = await fixture();
    f.socket.message({ message_type: 'partial_transcript', text: 'temporary words' });
    f.socket.message({ message_type: 'input_error', error: 'Invalid format' });
    expect(f.onText).toHaveBeenLastCalledWith(null);
    expect(f.socket.close).toHaveBeenCalledOnce();
    expect(f.context.processor.disconnect).toHaveBeenCalledOnce();
    expect(f.context.source.disconnect).toHaveBeenCalledOnce();
    expect(f.context.gain.disconnect).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('bounds queued audio while no session is ready', async () => {
    const f = await fixture();
    f.context.feed(new Float32Array(48_000 * 3));
    expect(f.socket.send).not.toHaveBeenCalled();
    expect(f.socket.close).toHaveBeenCalledOnce();
    expect(f.onText).toHaveBeenLastCalledWith(null);
  });

  it('times out a stalled handshake and clears its microphone processing', async () => {
    const f = await fixture();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.socket.close).toHaveBeenCalledOnce();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.context.processor.onaudioprocess).toBeNull();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('abandons a slow socket without accumulating audio or exposing an error', async () => {
    const f = await fixture();
    f.socket.message({ message_type: 'session_started' });
    f.socket.bufferedAmount = 129_000;
    f.context.feed(new Float32Array(4_800));
    expect(f.socket.send).not.toHaveBeenCalled();
    expect(f.socket.close).toHaveBeenCalledOnce();
    expect(f.onText).toHaveBeenLastCalledWith(null);
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('rejects an unsupported token format and never opens its socket', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...ticket, sampleRate: 44_100, audioFormat: 'mp4' })));
    const f = await fixture();
    expect(sockets).toHaveLength(0);
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.onText).toHaveBeenLastCalledWith(null);
  });

  it('skips live text entirely when Web Audio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    expect(createLiveTranscript({ shopperId: 'id', onText: vi.fn() })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
