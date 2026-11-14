// POST /api/voice: the phone line. Multipart form: audio (a recording), shopperId, storeId.
// 1. ElevenLabs speech-to-text  2. agent.handleMessage, exactly like typed chat (same frozen shopkeeper,
// same guard, same 300-character and rate limits)  3. ElevenLabs text-to-speech of the reply.
// Returns { transcript, reply (the ChatReply), audio (base64 mp3, or null if speech failed), timings }.
// 501 { error: 'voice_off' } when ELEVENLABS_API_KEY isn't set, so nothing changes without the key.
import express, { Router } from 'express';
import { AgentError, type AgentApi, type ChatErrorCode } from '../../shared/contract';
import { isStoreId } from '../../shared/store-data';
import { synthesize, transcribe, voiceConfig, VoiceError, type FetchLike } from './elevenlabs';
import { brokenRecording, uploadName } from './audio-file';
import { createTokenLimiter, mintRealtimeTicket } from './realtime';

export const MAX_VOICE_UPLOAD = '4mb';
export const MIN_VOICE_BYTES = 2_048;
const STATUS: Record<ChatErrorCode, number> = { too_long: 400, rate_limited: 429, unknown_shopper: 404, store_offline: 503, unavailable: 503 };

export function createVoiceRouter({ agent, fetchImpl }: { agent: AgentApi; fetchImpl?: FetchLike }): Router {
  const router = Router();
  const allowToken = createTokenLimiter();

  // GET /api/voice/token?shopperId=…: a single-use ticket for the live transcript (ElevenLabs realtime
  // speech-to-text, straight from the browser). 501 without the key; 429 past the per-shopper limit.
  router.get('/voice/token', async (req, res) => {
    const config = voiceConfig();
    if (!config) { res.status(501).json({ error: 'voice_off' }); return; }
    const shopperId = typeof req.query.shopperId === 'string' ? req.query.shopperId.trim() : '';
    if (!shopperId || shopperId.length > 200) { res.status(400).json({ error: 'bad_request', detail: 'shopperId is required' }); return; }
    if (!allowToken(shopperId)) { res.status(429).json({ error: 'rate_limited' }); return; }
    try {
      res.set('cache-control', 'no-store').json(await mintRealtimeTicket(config, fetchImpl));
    } catch (error) {
      console.error(`voice token: ${(error as Error).message}`);
      res.status(502).json({ error: 'token_failed' });
    }
  });

  router.post('/voice', express.raw({ type: 'multipart/form-data', limit: MAX_VOICE_UPLOAD }), async (req, res) => {
    const config = voiceConfig();
    if (!config) { res.status(501).json({ error: 'voice_off' }); return; }

    let form: FormData;
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      form = await new Request('http://voice.local/', { method: 'POST', headers: { 'content-type': req.get('content-type') ?? '' },
        body: Uint8Array.from(body) }).formData();
    } catch {
      res.status(400).json({ error: 'bad_request', detail: 'send multipart/form-data with audio, shopperId and storeId' });
      return;
    }
    const audio = form.get('audio');
    const shopperId = form.get('shopperId');
    const storeId = form.get('storeId');
    if (!(audio instanceof Blob) || audio.size === 0 || typeof shopperId !== 'string' || !shopperId.trim() || !isStoreId(storeId)) {
      res.status(400).json({ error: 'bad_request', detail: 'audio, shopperId and storeId are required' });
      return;
    }

    // What came in (logged, never the audio itself), then a clean type and name for ElevenLabs.
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const upload = uploadName(audio.type, bytes);
    const seen = `type=${audio.type || '(none)'} name=${(audio as File).name || '(none)'} bytes=${bytes.length} kind=${upload.kind ?? 'unknown'}`;
    console.log(`voice: upload ${seen}`);
    if (bytes.length < MIN_VOICE_BYTES) { res.status(422).json({ error: 'no_speech', detail: 'the recording is too short' }); return; }
    const broken = brokenRecording(bytes);
    if (broken) { console.error(`voice: ${broken} (${seen})`); res.status(422).json({ error: 'bad_audio', detail: broken }); return; }

    const timings = { sttMs: 0, chatMs: 0, ttsMs: 0 };
    let t = Date.now();
    let transcript: string;
    try {
      transcript = await transcribe(config, new Blob([Uint8Array.from(bytes)], { type: upload.type }), upload.filename, fetchImpl);
    } catch (error) {
      const e = error as VoiceError;
      console.error(`voice: ${e.message} (${seen})`);
      if (e.status === 400) { res.status(422).json({ error: 'bad_audio', detail: e.detail }); return; }
      res.status(502).json({ error: 'stt_failed', status: e.status ?? null, detail: e.detail });
      return;
    }
    timings.sttMs = Date.now() - t;
    if (!transcript) { res.status(422).json({ error: 'no_speech' }); return; }

    t = Date.now();
    let reply;
    try {
      reply = await agent.handleMessage({ shopperId: shopperId.trim(), storeId, text: transcript });
    } catch (error) {
      if (error instanceof AgentError) { res.status(STATUS[error.code]).json({ error: error.code, transcript }); return; }
      throw error;
    }
    timings.chatMs = Date.now() - t;

    t = Date.now();
    let audioOut: string | null = null;
    let ttsError: string | null = null;
    try {
      audioOut = (await synthesize(config, reply.reply, fetchImpl)).toString('base64');
    } catch (error) {
      ttsError = 'tts_failed';
      console.error(`voice: ${(error as Error).message}`);
    }
    timings.ttsMs = Date.now() - t;

    res.json({ transcript, reply, audio: audioOut, audioType: audioOut ? 'audio/mpeg' : null, ...(ttsError ? { ttsError } : {}), timings });
  });

  return router;
}
