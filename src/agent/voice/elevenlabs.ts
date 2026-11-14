// ElevenLabs as the ears and the voice of the phone line, nothing more: speech-to-text before the
// chat, text-to-speech after it. The shopkeeper, its frozen settings and the guard are the same as for
// typed chat. The API key stays on the server: it's read here, sent only to ElevenLabs, never logged.
const API = 'https://api.elevenlabs.io/v1';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface VoiceConfig {
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  voiceId: string;
  outputFormat: string;
}

/** The voice line's settings, or null when ELEVENLABS_API_KEY isn't set (the line is off). */
export function voiceConfig(): VoiceConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    sttModel: process.env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v1',
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',   // the low-latency model
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb',  // a warm premade voice
    outputFormat: 'mp3_44100_64',
  };
}

export class VoiceError extends Error {
  constructor(public step: 'stt' | 'tts', public status: number | null, message: string) { super(message); }
}

/** Speech to text. Returns the transcript ('' when nothing was said). */
export async function transcribe(config: VoiceConfig, audio: Blob, filename: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const form = new FormData();
  form.append('model_id', config.sttModel);
  form.append('language_code', 'en');
  form.append('tag_audio_events', 'false');
  form.append('file', audio, filename);
  const res = await fetchImpl(`${API}/speech-to-text`, {
    method: 'POST', headers: { 'xi-api-key': config.apiKey }, body: form, signal: AbortSignal.timeout(20_000),
  }).catch((e) => { throw new VoiceError('stt', null, `speech-to-text unreachable: ${(e as Error).name}`); });
  if (!res.ok) throw new VoiceError('stt', res.status, `speech-to-text answered HTTP ${res.status}`);
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text.trim() : '';
}

/** What the shopkeeper says, made speakable: no emoji, no markdown, one line. */
export function speakable(text: string): string {
  return text.replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}

/** Text to speech: an mp3 of the reply. */
export async function synthesize(config: VoiceConfig, text: string, fetchImpl: FetchLike = fetch): Promise<Buffer> {
  const res = await fetchImpl(`${API}/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=${config.outputFormat}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: speakable(text).slice(0, 1_000), model_id: config.ttsModel }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => { throw new VoiceError('tts', null, `text-to-speech unreachable: ${(e as Error).name}`); });
  if (!res.ok) throw new VoiceError('tts', res.status, `text-to-speech answered HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
