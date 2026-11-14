import { describe, expect, it, vi } from 'vitest';
import { createReplyAudio, createSpeakerPreference, type ReplyAudioState } from './reply-audio';

const reply = { audio: 'bXAz', audioType: 'audio/mpeg' };
const flush = async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); };
function fixture(enabled = true) {
  const player = {
    src: '', preload: '', onended: null as (() => void) | null, onerror: null as (() => void) | null,
    play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), pause: vi.fn(),
    setAttribute: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
  };
  const states: Record<string, ReplyAudioState | undefined> = {};
  const createAudio = vi.fn(() => player as unknown as HTMLAudioElement);
  const isHidden = vi.fn(() => false);
  const audio = createReplyAudio({ enabled, createAudio, isHidden, onState: (id, state) => { states[id] = state; } });
  return { audio, player, states, createAudio, isHidden };
}

describe('spoken reply playback', () => {
  it('creates and plays a valid silent clip synchronously in the press gesture', async () => {
    const f = fixture();
    expect(f.createAudio).not.toHaveBeenCalled();
    f.audio.beginRecordingGesture();
    expect(f.createAudio).toHaveBeenCalledOnce();
    expect(f.player.play).toHaveBeenCalledOnce(); // No await or request before play.
    const wav = Buffer.from(f.player.src.split(',')[1], 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
    expect(wav.readUInt32LE(40)).toBe(400);
    expect([...wav.subarray(44)].every((value) => value === 128)).toBe(true);
    await flush();
    expect(f.player.pause).toHaveBeenCalledTimes(1);
  });

  it('reuses the same element for the MP3 and every later recording and reply', async () => {
    const f = fixture();
    for (let index = 0; index < 3; index++) {
      f.audio.beginRecordingGesture();
      await flush();
      f.audio.receive(`reply-${index}`, reply);
      await flush();
      expect(f.player.src).toBe('data:audio/mpeg;base64,bXAz');
      expect(f.states[`reply-${index}`]).toBe('playing');
    }
    expect(f.createAudio).toHaveBeenCalledOnce();
    expect(f.player.play).toHaveBeenCalledTimes(6);
  });

  it('retains a blocked reply on its bubble and retries with the same element', async () => {
    const f = fixture();
    f.audio.beginRecordingGesture();
    await flush();
    f.player.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    f.audio.receive('first', reply);
    await flush();
    expect(f.states.first).toBe('blocked');
    f.audio.play('first');
    await flush();
    expect(f.states.first).toBe('playing');
    expect(f.createAudio).toHaveBeenCalledOnce();
  });

  it('handles synchronous playback errors and failed unlocking without losing the reply', async () => {
    const f = fixture();
    f.player.play.mockImplementationOnce(() => { throw new Error('unlock blocked'); });
    expect(() => f.audio.beginRecordingGesture()).not.toThrow();
    f.player.play.mockImplementationOnce(() => { throw new Error('blocked'); });
    f.audio.receive('first', reply);
    expect(f.states.first).toBe('blocked');
    f.audio.play('first');
    await flush();
    expect(f.states.first).toBe('playing');
  });

  it('continues normally after an asynchronous unlock rejection', async () => {
    const f = fixture();
    f.player.play.mockRejectedValueOnce(new Error('unlock refused'));
    f.audio.beginRecordingGesture(); await flush();
    f.audio.receive('first', reply); await flush();
    expect(f.states.first).toBe('playing');
    expect(f.createAudio).toHaveBeenCalledOnce();
  });

  it('keeps muted replies text-first without automatic playback, allowing an explicit tap', async () => {
    const f = fixture(false);
    f.audio.receive('muted', reply);
    expect(f.player.play).not.toHaveBeenCalled();
    expect(f.states.muted).toBe('ready');
    f.audio.play('muted');
    await flush();
    expect(f.states.muted).toBe('playing');
  });

  it('muting stops current audio and suppresses future autoplay; enabling affects new replies', async () => {
    const f = fixture();
    f.audio.receive('first', reply);
    await flush();
    f.audio.setEnabled(false);
    expect(f.player.pause).toHaveBeenCalled();
    expect(f.states.first).toBe('ready');
    f.player.play.mockClear();
    f.audio.receive('second', reply);
    f.audio.setEnabled(true);
    expect(f.player.play).not.toHaveBeenCalled();
    f.audio.receive('third', reply);
    await flush();
    expect(f.states.third).toBe('playing');
  });

  it('pauses the spoken reply before playing the silent unlock for barge-in', async () => {
    const f = fixture();
    f.audio.receive('first', reply);
    await flush();
    f.player.pause.mockClear(); f.player.play.mockClear();
    f.audio.beginRecordingGesture();
    expect(f.player.pause.mock.invocationCallOrder[0]).toBeLessThan(f.player.play.mock.invocationCallOrder[0]);
    expect(f.states.first).toBe('ready');
    expect(f.player.src).toMatch(/^data:audio\/wav/);
  });

  it('a delayed unlock promise cannot pause a newer spoken reply', async () => {
    const f = fixture();
    let unlocked!: () => void;
    f.player.play.mockReturnValueOnce(new Promise((resolve) => { unlocked = resolve; }));
    f.audio.beginRecordingGesture();
    f.audio.receive('first', reply);
    await flush();
    f.player.pause.mockClear();
    unlocked(); await flush();
    expect(f.player.pause).not.toHaveBeenCalled();
    expect(f.states.first).toBe('playing');
  });

  it('ignores stale play rejection after barge-in and a replacement reply', async () => {
    const f = fixture();
    let rejectOld!: (error: Error) => void;
    f.player.play.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; }));
    f.audio.receive('first', reply);
    const oldEnd = f.player.onended;
    f.audio.beginRecordingGesture();
    f.audio.receive('second', { ...reply, audio: 'c2Vjb25k' });
    await flush();
    rejectOld(new Error('old failure')); oldEnd?.(); await flush();
    expect(f.states.first).toBe('ready');
    expect(f.states.second).toBe('playing');
  });

  it('keeps all blocked replies independently reachable after repeated requests', async () => {
    const f = fixture();
    f.player.play.mockRejectedValue(new Error('blocked'));
    f.audio.receive('first', reply); await flush();
    f.audio.receive('second', { ...reply, audio: 'c2Vjb25k' }); await flush();
    f.player.play.mockResolvedValue(undefined);
    f.audio.play('first'); await flush();
    expect(f.player.src).toBe('data:audio/mpeg;base64,bXAz');
    expect(f.states.first).toBe('playing');
    expect(f.states.second).not.toBe('playing');
  });

  it('offers replay after completion and media errors', async () => {
    const f = fixture();
    f.audio.receive('first', reply); await flush();
    f.player.onended?.();
    expect(f.states.first).toBe('ready');
    f.audio.play('first'); await flush();
    f.player.onerror?.();
    expect(f.states.first).toBe('blocked');
    f.audio.play('first'); await flush();
    expect(f.states.first).toBe('playing');
  });

  it('does not overwrite a media error with a late play resolution', async () => {
    const f = fixture();
    let resolvePlay!: () => void;
    f.player.play.mockReturnValueOnce(new Promise((resolve) => { resolvePlay = resolve; }));
    f.audio.receive('first', reply);
    f.player.onerror?.();
    resolvePlay(); await flush();
    expect(f.states.first).toBe('blocked');
  });

  it('does not autoplay while hidden, and stopping on hide retains an explicit replay', async () => {
    const f = fixture();
    f.isHidden.mockReturnValue(true);
    f.audio.receive('first', reply);
    expect(f.player.play).not.toHaveBeenCalled();
    expect(f.states.first).toBe('ready');
    f.isHidden.mockReturnValue(false);
    f.audio.play('first'); await flush();
    f.audio.stop();
    expect(f.states.first).toBe('ready');
    expect(f.player.pause).toHaveBeenCalled();
  });

  it('ignores text-only replies without constructing audio or adding a replay chip', () => {
    const f = fixture();
    f.audio.receive('text', { audio: null, audioType: null });
    expect(f.createAudio).not.toHaveBeenCalled();
    expect(f.states.text).toBeUndefined();
  });

  it('handles an unavailable audio element gracefully', () => {
    const onState = vi.fn();
    const audio = createReplyAudio({ enabled: true, onState, isHidden: () => false, createAudio: () => { throw new Error('unsupported'); } });
    expect(() => audio.beginRecordingGesture()).not.toThrow();
    audio.receive('first', reply);
    expect(onState).toHaveBeenLastCalledWith('first', 'blocked');
  });

  it('disposes handlers, source and pending playback without affecting another page', async () => {
    const f = fixture();
    let resolvePlay!: () => void;
    f.player.play.mockReturnValueOnce(new Promise((resolve) => { resolvePlay = resolve; }));
    f.audio.receive('first', reply);
    f.audio.dispose(); f.audio.dispose();
    expect(f.player.onended).toBeNull(); expect(f.player.onerror).toBeNull();
    expect(f.player.removeAttribute).toHaveBeenCalledWith('src');
    expect(f.player.load).toHaveBeenCalledOnce();
    const calls = f.player.play.mock.calls.length;
    resolvePlay(); await flush();
    f.audio.beginRecordingGesture(); f.audio.receive('second', reply); f.audio.play('first');
    expect(f.player.play).toHaveBeenCalledTimes(calls);
    expect(f.states.first).toBe('ready');
    expect(f.states.second).toBeUndefined();
  });

  it('bounds the in-memory audio cache without saving base64 in storage', () => {
    const f = fixture(false);
    for (let index = 0; index < 61; index++) f.audio.receive(String(index), reply);
    expect(f.states['0']).toBeUndefined();
    f.audio.play('0');
    expect(f.player.play).not.toHaveBeenCalled();
    expect(f.states['60']).toBe('ready');
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }, clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

describe('per-tab speaker preference', () => {
  it('defaults on, remembers mute after reload and stores a tab-scoped localStorage preference', () => {
    const storage = { local: memoryStorage(), session: memoryStorage() };
    const first = createSpeakerPreference('scarborough:demo', storage, 'tab-a');
    expect(first.enabled).toBe(true);
    first.set(false);
    expect(storage.local.getItem('bodega:speaker:tab-a:scarborough:demo')).toBe('off');
    const reload = createSpeakerPreference('scarborough:demo', storage, 'tab-a-reload');
    expect(reload.enabled).toBe(false);
    expect(storage.local.getItem('bodega:speaker:tab-a-reload:scarborough:demo')).toBe('off');
    expect(storage.local.getItem('bodega:speaker:tab-a:scarborough:demo')).toBeNull();
  });

  it('isolates new tabs, store slots, and later changes in duplicated tabs', () => {
    const local = memoryStorage(), firstSession = memoryStorage(), duplicateSession = memoryStorage();
    const first = createSpeakerPreference('queen:a', { local, session: firstSession }, 'first');
    first.set(false);
    duplicateSession.setItem('bodega:speaker-tab:queen:a', firstSession.getItem('bodega:speaker-tab:queen:a')!);
    const duplicate = createSpeakerPreference('queen:a', { local, session: duplicateSession }, 'duplicate');
    const newTab = createSpeakerPreference('queen:a', { local, session: memoryStorage() }, 'new-tab');
    const otherSlot = createSpeakerPreference('queen:b', { local, session: firstSession }, 'other-slot');
    expect(newTab.enabled).toBe(true); expect(otherSlot.enabled).toBe(true);
    duplicate.set(true);
    expect(first.enabled).toBe(false);
    expect(createSpeakerPreference('queen:a', { local, session: firstSession }, 'reloaded-first').enabled).toBe(false);
    expect(createSpeakerPreference('queen:a', { local, session: duplicateSession }, 'reloaded-duplicate').enabled).toBe(true);
  });

  it('ignores malformed preferences and tolerates denied storage', () => {
    const storage = { local: memoryStorage(), session: memoryStorage() };
    storage.session.setItem('bodega:speaker-tab:queen:', 'broken');
    expect(createSpeakerPreference('queen:', storage, 'test').enabled).toBe(true);
    storage.session.getItem = () => { throw new Error('denied'); };
    storage.session.setItem = () => { throw new Error('denied'); };
    storage.local.setItem = () => { throw new Error('denied'); };
    const preference = createSpeakerPreference('queen:', storage, 'private');
    expect(preference.enabled).toBe(true);
    expect(() => preference.set(false)).not.toThrow();
    expect(preference.enabled).toBe(false);
  });
});
