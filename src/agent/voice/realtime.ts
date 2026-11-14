// Live transcript while the shopper speaks: the browser streams its microphone straight to ElevenLabs
// realtime speech-to-text (Scribe) and shows the partial text on that phone only. This server only
// mints a single-use token (valid 15 minutes, one connection), so the API key never reaches the
// browser. The live text is display only: the final transcript and the reply still come from
// POST /api/voice, through the same frozen shopkeeper and guard.
import type { FetchLike, VoiceConfig } from './elevenlabs';

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
const WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

export interface RealtimeTicket {
  /** Open this WebSocket as is: the single-use token and the session settings are in it. */
  url: string;
  model: string;
  audioFormat: 'pcm_16000';
  sampleRate: 16000;
  expiresInS: number;
}

export function realtimeModel(): string {
  return process.env.ELEVENLABS_REALTIME_MODEL?.trim() || 'scribe_v3_live';
}

export async function mintRealtimeTicket(config: VoiceConfig, fetchImpl: FetchLike = fetch): Promise<RealtimeTicket> {
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'xi-api-key': config.apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`single-use token answered HTTP ${res.status}`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) throw new Error('single-use token response had no token');
  const model = realtimeModel();
  const query = new URLSearchParams({ model_id: model, token: body.token, audio_format: 'pcm_16000', language_code: 'en', commit_strategy: 'manual' });
  return { url: `${WS_URL}?${query}`, model, audioFormat: 'pcm_16000', sampleRate: 16000, expiresInS: 15 * 60 };
}

/** Tokens per shopper: one every 3 seconds, 30 in all; and at most 60 a minute across the app. */
export function createTokenLimiter(now: () => number = Date.now) {
  const perShopper = new Map<string, { last: number; count: number }>();
  let windowStart = now();
  let inWindow = 0;
  return (shopperId: string): boolean => {
    const t = now();
    if (t - windowStart >= 60_000) { windowStart = t; inWindow = 0; }
    const s = perShopper.get(shopperId) ?? { last: -Infinity, count: 0 };
    if (inWindow >= 60 || s.count >= 30 || t - s.last < 3_000) return false;
    perShopper.set(shopperId, { last: t, count: s.count + 1 });
    inWindow++;
    return true;
  };
}
