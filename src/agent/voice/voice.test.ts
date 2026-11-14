import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError, type AgentApi, type ChatReply } from '../../shared/contract';
import { speakable, voiceConfig } from './elevenlabs';
import { createVoiceRouter } from './router';

const KEY = 'test-eleven-key-123';
const calls: { url: string; init: RequestInit }[] = [];
let stt: () => Promise<Response>;
let tts: () => Promise<Response>;
let token: () => Promise<Response> = async () => Response.json({ token: 'single-use-abc' });
const fakeFetch = async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  if (url.includes('/single-use-token/')) return token();
  return url.includes('/speech-to-text') ? stt() : tts();
};

const chats: { shopperId: string; storeId: string; text: string }[] = [];
let chatResult: () => Promise<ChatReply>;
const agent = { handleMessage: async (input: { shopperId: string; storeId: string; text: string }) => { chats.push(input); return chatResult(); } } as unknown as AgentApi;

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', createVoiceRouter({ agent, fetchImpl: fakeFetch }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  calls.length = 0;
  chats.length = 0;
  vi.stubEnv('ELEVENLABS_API_KEY', KEY);
  stt = async () => Response.json({ text: ' One large coffee with TORONTO5 please. ' });
  tts = async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  chatResult = async () => ({ reply: "You're all set! ☕ $3.09, order S-1001.", actions: [{ kind: 'order', orderNumber: 'S-1001', totalCents: 309 }], blocked: [], walletCents: 1691 });
});

function upload(fields: Record<string, string | Blob> = { audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), shopperId: 'shopper-1', storeId: 'scarborough' }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v as never);
  return fetch(`${base}/api/voice`, { method: 'POST', body: form });
}

describe('voice line', () => {
  it('is off without the key', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const res = await upload();
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'voice_off' });
    expect(calls).toHaveLength(0);
  });

  it('transcribes, chats through the agent exactly like typed text, and speaks the reply', async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toBe('One large coffee with TORONTO5 please.');
    expect(chats).toEqual([{ shopperId: 'shopper-1', storeId: 'scarborough', text: 'One large coffee with TORONTO5 please.' }]);
    expect(body.reply.actions).toEqual([{ kind: 'order', orderNumber: 'S-1001', totalCents: 309 }]);
    expect(Buffer.from(body.audio, 'base64')).toEqual(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]));
    expect(body.audioType).toBe('audio/mpeg');
    expect(Object.keys(body.timings)).toEqual(['sttMs', 'chatMs', 'ttsMs']);

    const [sttCall, ttsCall] = calls;
    expect(sttCall!.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect((sttCall!.init.body as FormData).get('model_id')).toBe('scribe_v1');
    expect((sttCall!.init.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
    expect(ttsCall!.url).toMatch(/\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_44100_64$/);
    expect(JSON.parse(ttsCall!.init.body as string)).toEqual({ text: "You're all set! three oh nine, order S ten oh one.", model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } });
    expect(JSON.stringify(body)).not.toContain(KEY);   // the key never reaches the browser
  });

  it('keeps the chat limits: an agent error maps to its HTTP status, with the transcript', async () => {
    chatResult = async () => { throw new AgentError('rate_limited', 'One message every couple of seconds, please.'); };
    const res = await upload();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited', transcript: 'One large coffee with TORONTO5 please.' });
    expect(calls).toHaveLength(1);   // no speech for a refused message
  });

  it('still answers in text when speech fails, and refuses bad input', async () => {
    tts = async () => new Response('nope', { status: 503 });
    const res = await upload();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ audio: null, ttsError: 'tts_failed', transcript: 'One large coffee with TORONTO5 please.' });
    expect(body.reply.walletCents).toBe(1691);

    expect((await upload({ shopperId: 'shopper-1', storeId: 'scarborough' })).status).toBe(400);
    expect((await upload({ audio: new Blob([new Uint8Array([1])]), shopperId: 'shopper-1', storeId: 'mars' })).status).toBe(400);
    stt = async () => Response.json({ text: '   ' });
    expect((await upload()).status).toBe(422);
    stt = async () => new Response('down', { status: 500 });
    const failed = await upload();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'stt_failed', status: 500 });
  });

  it('mints a single-use live-transcript ticket without exposing the key, rate-limited per shopper', async () => {
    const get = (q: string) => fetch(`${base}/api/voice/token${q}`);
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    expect((await get('?shopperId=s-1')).status).toBe(501);
    vi.stubEnv('ELEVENLABS_API_KEY', KEY);
    expect((await get('')).status).toBe(400);
    const res = await get('?shopperId=s-token-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const ticket = await res.json();
    expect(ticket).toMatchObject({ model: 'scribe_v3_live', audioFormat: 'pcm_16000', sampleRate: 16000, expiresInS: 900 });
    const url = new URL(ticket.url);
    expect(`${url.origin}${url.pathname}`).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    expect(Object.fromEntries(url.searchParams)).toEqual({ model_id: 'scribe_v3_live', token: 'single-use-abc', audio_format: 'pcm_16000', language_code: 'en', commit_strategy: 'manual' });
    expect(JSON.stringify(ticket)).not.toContain(KEY);
    const mint = calls.find((c) => c.url.includes('/single-use-token/realtime_scribe'))!;
    expect(mint.init.method).toBe('POST');
    expect((mint.init.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
    expect((await get('?shopperId=s-token-1')).status).toBe(429);   // one every 3 seconds
    token = async () => new Response('no', { status: 401 });
    expect(await (await get('?shopperId=s-token-2')).json()).toEqual({ error: 'token_failed' });
    token = async () => Response.json({ token: 'single-use-abc' });
  });

  it('makes replies natural to hear: prices, order numbers, no emoji or bullets', () => {
    expect(speakable("You're all set! ☕🥧 Order **S-1001**.\n\n🛡 Bodega memory: Queen St saw this trick first."))
      .toBe("You're all set! Order S ten oh one. Bodega memory: Queen St saw this trick first.");
    expect(speakable("I've refunded $9.50, so your balance is $29.50. Order #Q-1042 was $13.00.")).toBe(
      "I've refunded nine fifty, so your balance is twenty-nine fifty. Order Q ten forty-two was thirteen dollars.");
    expect(speakable('- 3 butter tarts: $3.09\n- toque: $0.38\n- console: $549.00, 10% off, Y-1100')).toBe(
      '3 butter tarts: three oh nine toque: thirty-eight cents console: five hundred forty-nine dollars, 10 percent off, Y eleven hundred');
  });

  it('reads expressive voice settings from env, with defaults', () => {
    vi.stubEnv('ELEVENLABS_STABILITY', '0.3');
    vi.stubEnv('ELEVENLABS_STYLE', 'nonsense');
    vi.stubEnv('ELEVENLABS_SPEAKER_BOOST', 'false');
    expect(voiceConfig()!.voiceSettings).toEqual({ stability: 0.3, similarity_boost: 0.8, style: 0.35, use_speaker_boost: false });
  });
});
