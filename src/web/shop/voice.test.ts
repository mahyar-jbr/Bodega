import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../ui/api';
import { canRecordVoice, createVoiceRecorder, friendlyVoiceError, MAX_RECORDING_MS, parseVoiceReply, voiceAvailable } from './voice';

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
  data = new Blob(['recorded speech'], { type: 'audio/webm;codecs=opus' });
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    recordings.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.ondataavailable?.({ data: this.data }); this.onstop?.(); });
  }
}

beforeEach(() => {
  recordings = [];
  track.stop.mockClear();
  FakeRecorder.isTypeSupported.mockImplementation((type) => type === 'audio/webm;codecs=opus');
  getUserMedia = vi.fn(async () => stream);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  const callbacks = { onPhase: vi.fn(), onReply: vi.fn(), onError: vi.fn(), onUnavailable: vi.fn() };
  return { ...callbacks, recorder: createVoiceRecorder({ shopperId: 'shopper-q2', storeId: 'queen', ...callbacks }) };
}
const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };

describe('voice recording', () => {
  it('requests the mic only on start, uploads multipart after final data, and preserves the full ChatReply', async () => {
    const f = fixture();
    expect(getUserMedia).not.toHaveBeenCalled();
    await f.recorder.start();
    expect(f.recorder.phase).toBe('recording');
    expect(fetchMock).not.toHaveBeenCalled();
    f.recorder.stop();
    await flush();
    const [path, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/voice');
    expect(request.headers).toBeUndefined();
    const form = request.body as FormData;
    expect(form.get('shopperId')).toBe('shopper-q2');
    expect(form.get('storeId')).toBe('queen');
    expect((form.get('audio') as File).name).toBe('voice.webm');
    expect(await (form.get('audio') as File).text()).toBe('recorded speech');
    expect(f.onReply).toHaveBeenCalledWith(expect.objectContaining({ transcript: payload.transcript, reply: payload.reply }));
    expect(f.onPhase.mock.calls.map(([phase]) => phase)).toEqual(['requesting', 'recording', 'sending', 'idle']);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('negotiates MP4 and uses the matching upload filename for Safari', async () => {
    FakeRecorder.isTypeSupported.mockImplementation((type) => type === 'audio/mp4');
    const f = fixture();
    await f.recorder.start();
    expect(recordings[0].mimeType).toBe('audio/mp4');
    f.recorder.stop();
    await flush();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get('audio') as File).name).toBe('voice.mp4');
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
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'no_speech' }));
  });

  it('hides voice after 501 and preserves a useful error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'voice_off' }), { status: 501 }));
    const f = fixture();
    await f.recorder.start();
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
