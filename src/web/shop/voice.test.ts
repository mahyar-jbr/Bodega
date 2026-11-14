import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../ui/api';
import { canRecordVoice, createVoiceRecorder, friendlyVoiceError, MAX_RECORDING_MS, MIN_RECORDING_MS, parseVoiceReply, voiceAvailable } from './voice';
import { createShopSession, saveLocalShopper, type ShopperRequest } from './session';

const payload = {
  transcript: 'One coffee please',
  reply: { reply: 'One coffee, coming up.', actions: [{ kind: 'order', orderNumber: 'Q-1001', totalCents: 325 }], blocked: [], walletCents: 1675 },
  audio: 'bXAz', audioType: 'audio/mpeg', timings: { sttMs: 10, chatMs: 20, ttsMs: 30 },
};
const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;
let recordings: FakeRecorder[];
let fetchMock: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

class FakeRecorder {
  static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus');
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  data = new Blob(['recorded speech'.padEnd(2_500, ' ')], { type: 'audio/webm;codecs=opus' });
  autoStopEvents = true;
  timeslice: number | undefined;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    recordings.push(this);
  }
  start(timeslice?: number) { this.timeslice = timeslice; this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (this.autoStopEvents) queueMicrotask(() => { this.ondataavailable?.({ data: this.data }); this.onstop?.(); });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  recordings = [];
  track.stop.mockClear();
  FakeRecorder.isTypeSupported.mockImplementation((type) => type === 'audio/webm;codecs=opus');
  getUserMedia = vi.fn(async () => stream);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('navigator', { userAgent: 'Desktop Chrome', maxTouchPoints: 0, mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture(withShopper?: ShopperRequest) {
  const callbacks = { onPhase: vi.fn(), onReply: vi.fn(), onError: vi.fn(), onUnavailable: vi.fn() };
  return { ...callbacks, recorder: createVoiceRecorder({ shopperId: 'shopper-q2', storeId: 'queen', ...callbacks, withShopper }) };
}
const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
const hold = () => vi.advanceTimersByTimeAsync(MIN_RECORDING_MS + 50);

function sessionStorageFixture() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
}

describe('voice after a Reset', () => {
  const old = { id: 'shopper-q2', nickname: 'Old Goose', storeId: 'queen' as const, walletCents: 100, joined: true };
  const fresh = { ...old, id: 'replacement', nickname: 'New Maple', walletCents: 2000 };

  async function resetFixture(alwaysMissing = false) {
    vi.stubGlobal('localStorage', sessionStorageFixture());
    vi.stubGlobal('sessionStorage', sessionStorageFixture());
    saveLocalShopper(old, 'demo');
    const uploads: FormData[] = [];
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/api/shoppers/${old.id}`) return new Response(JSON.stringify(old));
      if (path === '/api/shoppers') return new Response(JSON.stringify(fresh), { status: 201 });
      const form = init!.body as FormData; uploads.push(form);
      return form.get('shopperId') === old.id || alwaysMissing
        ? new Response(JSON.stringify({ error: 'unknown_shopper' }), { status: 404 })
        : new Response(JSON.stringify(payload));
    });
    const changed = vi.fn();
    const session = createShopSession('queen', 'demo', changed); await session.load();
    return { ...fixture(session.run), uploads, session, changed };
  }

  it.each(['audio/webm;codecs=opus', 'audio/mp4'])('retries the exact complete %s recording once without asking for the microphone again', async (mime) => {
    FakeRecorder.isTypeSupported.mockImplementation((type) => type === mime);
    const f = await resetFixture();
    await f.recorder.start(); await hold(); f.recorder.stop(); await flush();
    expect(f.uploads).toHaveLength(2);
    expect(f.uploads.map((form) => form.get('shopperId'))).toEqual([old.id, fresh.id]);
    const files = f.uploads.map((form) => form.get('audio') as File);
    expect(await files[0].arrayBuffer()).toEqual(await files[1].arrayBuffer());
    expect(files[0].type).toBe(mime); expect(files[1].name).toBe(mime.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    expect(getUserMedia).toHaveBeenCalledOnce(); expect(recordings).toHaveLength(1);
    expect(f.onReply).toHaveBeenCalledOnce(); expect(f.onError).not.toHaveBeenCalled();
    expect(f.session.shopper).toMatchObject({ id: fresh.id, nickname: fresh.nickname, walletCents: 2000 });
    expect(f.changed.mock.calls.filter(([, reason]) => reason === 'reset')).toHaveLength(1);
    expect(f.recorder.phase).toBe('idle');
  });

  it('surfaces the second voice 404 and stops after one replacement and retry', async () => {
    const f = await resetFixture(true);
    await f.recorder.start(); await hold(); f.recorder.stop(); await flush();
    expect(f.uploads).toHaveLength(2);
    expect(f.onReply).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unknown_shopper' }), undefined);
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
});

describe('voice recording', () => {
  it('requests the mic only on start, uploads multipart after final data, and preserves the full ChatReply', async () => {
    const f = fixture();
    expect(getUserMedia).not.toHaveBeenCalled();
    await f.recorder.start();
    expect(f.recorder.phase).toBe('recording');
    expect(recordings[0].timeslice).toBe(250);
    expect(fetchMock).not.toHaveBeenCalled();
    await hold();
    f.recorder.stop();
    await flush();
    const [path, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/voice');
    expect(request.headers).toBeUndefined();
    const form = request.body as FormData;
    expect(form.get('shopperId')).toBe('shopper-q2');
    expect(form.get('storeId')).toBe('queen');
    expect((form.get('audio') as File).name).toBe('voice.webm');
    expect(await (form.get('audio') as File).text()).toBe(await recordings[0].data.text());
    expect(f.onReply).toHaveBeenCalledWith(expect.objectContaining({ transcript: payload.transcript, reply: payload.reply }));
    expect(f.onPhase.mock.calls.map(([phase]) => phase)).toEqual(['requesting', 'recording', 'sending', 'idle']);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('negotiates MP4 and uses the matching upload filename for Safari', async () => {
    FakeRecorder.isTypeSupported.mockImplementation((type) => type === 'audio/mp4');
    const f = fixture();
    await f.recorder.start();
    expect(recordings[0].mimeType).toBe('audio/mp4');
    await hold();
    f.recorder.stop();
    await flush();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get('audio') as File).name).toBe('voice.m4a');
    expect((form.get('audio') as File).type).toBe('audio/mp4');
  });

  it('cancels a recording without sending it', async () => {
    const f = fixture();
    await f.recorder.start();
    f.recorder.cancel();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(f.recorder.phase).toBe('idle');
  });

  it('releases a late permission grant after the button was released', async () => {
    let grant!: (value: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const f = fixture();
    const starting = f.recorder.start();
    f.recorder.stop();
    grant(stream);
    await starting;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recordings).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops and sends at the recording limit', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.recorder.start();
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(f.onReply).toHaveBeenCalledOnce();
  });

  it('handles empty recordings locally without paying for transcription', async () => {
    const f = fixture();
    await f.recorder.start();
    recordings[0].data = new Blob();
    f.recorder.stop();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'bad_audio' }));
  });

  it('hides voice after 501 and preserves a useful error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'voice_off' }), { status: 501 }));
    const f = fixture();
    await f.recorder.start();
    await hold();
    f.recorder.stop();
    await flush();
    expect(f.onUnavailable).toHaveBeenCalledOnce();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'voice_off' }), undefined);
    expect(f.onReply).not.toHaveBeenCalled();
  });

  it('keeps the recognized transcript when the agent rejects the request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'too_long', transcript: 'A spoken message' }), { status: 400 }));
    const f = fixture();
    await f.recorder.start();
    await hold();
    f.recorder.stop();
    await flush();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'too_long' }), 'A spoken message');
    expect(f.recorder.phase).toBe('idle');
  });

  it('aborts on unmount and ignores a late reply', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const f = fixture();
    await f.recorder.start();
    await hold();
    f.recorder.stop();
    await flush();
    const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    f.recorder.cancel();
    expect(request.signal?.aborted).toBe(true);
    respond(new Response(JSON.stringify(payload)));
    await flush();
    expect(f.onReply).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });

  it('handles denied permission and allows retry', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    const f = fixture();
    await f.recorder.start();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(f.recorder.phase).toBe('idle');
    await f.recorder.start();
    expect(f.recorder.phase).toBe('recording');
    f.recorder.cancel();
  });

  it('keeps the MP4 header and all fragments and uploads only after the stop event', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5, mediaDevices: { getUserMedia } });
    FakeRecorder.isTypeSupported.mockReturnValue(true);
    const f = fixture();
    await f.recorder.start();
    const recording = recordings[0];
    expect(recording.mimeType).toBe('audio/mp4');
    recording.autoStopEvents = false;
    const header = 'ftyp-header'.padEnd(728, 'h');
    const fragment = 'moof-mdat'.padEnd(3_000, 'a');
    const final = 'final-mdat'.padEnd(1_000, 'z');
    recording.ondataavailable?.({ data: new Blob([header], { type: 'audio/mp4' }) });
    recording.ondataavailable?.({ data: new Blob([fragment], { type: 'audio/mp4' }) });
    await hold();
    expect(fetchMock).not.toHaveBeenCalled();
    f.recorder.stop();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    recording.ondataavailable?.({ data: new Blob([final], { type: 'audio/mp4' }) });
    expect(fetchMock).not.toHaveBeenCalled();
    recording.onstop?.();
    await flush();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    const file = form.get('audio') as File;
    expect(file.type).toBe('audio/mp4');
    expect(file.name).toBe('voice.m4a');
    expect(await file.text()).toBe(header + fragment + final);
  });

  it.each(['missing', 'empty', 'header-only', 'short'] as const)('does not upload a %s recording', async (kind) => {
    const f = fixture();
    await f.recorder.start();
    const recording = recordings[0];
    if (kind === 'missing') recording.autoStopEvents = false;
    if (kind === 'empty') recording.data = new Blob();
    if (kind === 'header-only') recording.data = new Blob(['h'.repeat(728)]);
    await vi.advanceTimersByTimeAsync(kind === 'short' ? MIN_RECORDING_MS - 1 : MIN_RECORDING_MS);
    f.recorder.stop();
    if (kind === 'missing') recording.onstop?.();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'bad_audio' }));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(f.recorder.phase).toBe('idle');
  });

  it('maps server bad_audio to the requested retry message and allows another recording', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad_audio' }), { status: 422 }));
    const f = fixture();
    await f.recorder.start(); await hold(); f.recorder.stop(); await flush();
    const error = f.onError.mock.calls[0][0];
    expect(friendlyVoiceError(error)).toBe("Sorry, I didn't catch that. Hold the button while you talk.");
    expect(f.onReply).not.toHaveBeenCalled();
    await f.recorder.start();
    expect(f.recorder.phase).toBe('recording');
    f.recorder.cancel();
  });

  it('keeps the complete recording upload working if optional live audio fails', async () => {
    const callbacks = { onPhase: vi.fn(), onReply: vi.fn(), onError: vi.fn(), onUnavailable: vi.fn() };
    const preview = { attachStream: vi.fn(() => { throw new Error('Web Audio unavailable'); }), finish: vi.fn(), cancel: vi.fn() };
    const recorder = createVoiceRecorder({ shopperId: 'q1', storeId: 'queen', ...callbacks, createLivePreview: () => preview });
    await recorder.start();
    expect(preview.cancel).toHaveBeenCalledOnce();
    expect(recorder.phase).toBe('recording');
    await hold(); recorder.stop(); await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect([...form.keys()]).toEqual(['audio', 'shopperId', 'storeId']);
    expect(callbacks.onReply).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('finishes live preview on release, then clears it when the final transcript replaces it', async () => {
    const callbacks = { onPhase: vi.fn(), onReply: vi.fn(), onError: vi.fn(), onUnavailable: vi.fn() };
    const preview = { attachStream: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const createLivePreview = vi.fn(() => preview);
    const recorder = createVoiceRecorder({ shopperId: 'q1', storeId: 'queen', ...callbacks, createLivePreview });
    await recorder.start();
    expect(createLivePreview).toHaveBeenCalledOnce();
    expect(preview.attachStream).toHaveBeenCalledWith(stream);
    await hold(); recorder.stop();
    expect(preview.finish).toHaveBeenCalled();
    await flush();
    expect(callbacks.onReply).toHaveBeenCalledWith(expect.objectContaining({ transcript: payload.transcript }));
    expect(preview.cancel).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('notifies release immediately, before final recorder data and upload are available', async () => {
    const onRelease = vi.fn();
    const recorder = createVoiceRecorder({ shopperId: 'q1', storeId: 'queen', onRelease,
      onPhase: vi.fn(), onReply: vi.fn(), onError: vi.fn(), onUnavailable: vi.fn() });
    await recorder.start(); await hold();
    recordings[0].autoStopEvents = false;
    recorder.stop();
    expect(onRelease).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    recordings[0].ondataavailable?.({ data: recordings[0].data });
    recordings[0].onstop?.(); await flush();
    expect(onRelease).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('voice availability and replies', () => {
  it('probes with empty multipart and hides a disabled endpoint without mic permission', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 501 })).mockResolvedValueOnce(new Response('{}', { status: 400 }));
    expect(await voiceAvailable(new AbortController().signal)).toBe(false);
    expect(await voiceAvailable(new AbortController().signal)).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect([...form.keys()]).toEqual([]);
  });

  it('detects unsupported recording without throwing', () => {
    expect(canRecordVoice()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(canRecordVoice()).toBe(false);
  });

  it('accepts text-only responses and rejects malformed payloads', () => {
    expect(parseVoiceReply({ ...payload, audio: null, audioType: null })).toMatchObject({ audio: null, reply: payload.reply });
    expect(() => parseVoiceReply({ reply: 'wrong' })).toThrow('Incomplete voice reply');
  });

  it.each([
    [422, 'no_speech', 'Didn’t catch that'], [429, 'rate_limited', 'Slow down'],
    [503, 'store_offline', 'closed for a moment'], [502, 'stt_failed', 'voice line'],
    [501, 'voice_off', 'still type'],
  ])('maps HTTP %i errors to helpful copy', (status, code, message) => {
    expect(friendlyVoiceError(new ApiError(status, code, 'server detail'))).toContain(message);
  });
});
