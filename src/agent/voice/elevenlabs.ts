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
  /** Expressive but clear: lower stability and some style, so the shopkeeper doesn't sound robotic. */
  voiceSettings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
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
    voiceSettings: {
      stability: envNumber('ELEVENLABS_STABILITY', 0.4),
      similarity_boost: envNumber('ELEVENLABS_SIMILARITY', 0.8),
      style: envNumber('ELEVENLABS_STYLE', 0.35),
      use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST?.trim().toLowerCase() !== 'false',
    },
  };
}

export class VoiceError extends Error {
  /** ElevenLabs' own explanation (from its JSON error body), at most 300 characters; never the key or audio. */
  detail: string | null;
  constructor(public step: 'stt' | 'tts', public status: number | null, message: string, detail: string | null = null) {
    super(detail ? `${message}: ${detail}` : message);
    this.detail = detail;
  }
}

async function errorDetail(res: Response): Promise<string | null> {
  const text = await res.text().catch(() => '');
  try {
    const d = (JSON.parse(text) as { detail?: unknown }).detail;
    const message = typeof d === 'string' ? d : d && typeof d === 'object' ? [(d as { code?: string }).code, (d as { message?: string }).message].filter(Boolean).join(': ') : '';
    return (message || text).slice(0, 300) || null;
  } catch {
    return text.slice(0, 300) || null;
  }
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
  if (!res.ok) throw new VoiceError('stt', res.status, `speech-to-text answered HTTP ${res.status}`, await errorDetail(res));
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text.trim() : '';
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under100(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}

/** 0 to 9999 in words: 549 is "five hundred forty-nine". */
export function numberWords(n: number): string {
  if (n < 100) return under100(n);
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${under100(n % 100)}` : ''}`;
  return `${under100(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
}

/** "$9.50" is "nine fifty", "$3.09" is "three oh nine", "$13.00" is "thirteen dollars", "$0.38" is "thirty-eight cents". */
function money(dollars: number, cents: number): string {
  if (cents === 0) return dollars === 1 ? 'one dollar' : `${numberWords(dollars)} dollars`;
  if (dollars === 0) return `${under100(cents)} cent${cents === 1 ? '' : 's'}`;
  return `${numberWords(dollars)} ${cents < 10 ? `oh ${ONES[cents]}` : under100(cents)}`;
}

/** "Q-1042" is "Q ten forty-two", "S-1001" is "S ten oh one", "Y-1100" is "Y eleven hundred". */
function orderNumber(letter: string, digits: string): string {
  const first = Number(digits.slice(0, 2));
  const last = Number(digits.slice(2));
  const tail = last === 0 ? 'hundred' : last < 10 ? `oh ${ONES[last]}` : under100(last);
  return `${letter} ${under100(first)} ${tail}`;
}

/** What the shopkeeper says, made natural to hear: prices and order numbers as people say them,
 *  no emoji, no markdown or bullets, one line. */
export function speakable(text: string): string {
  return text
    .split('\n').map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')).join(' ')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/#?\b([QYS])-(\d{4})\b/g, (_, letter: string, digits: string) => orderNumber(letter, digits))
    .replace(/\$(\d{1,4})(?:\.(\d{2}))?\b/g, (_, d: string, c?: string) => money(Number(d), Number(c ?? 0)))
    .replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 percent')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text to speech: an mp3 of the reply. */
export async function synthesize(config: VoiceConfig, text: string, fetchImpl: FetchLike = fetch): Promise<Buffer> {
  const res = await fetchImpl(`${API}/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=${config.outputFormat}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: speakable(text).slice(0, 1_000), model_id: config.ttsModel, voice_settings: config.voiceSettings }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => { throw new VoiceError('tts', null, `text-to-speech unreachable: ${(e as Error).name}`); });
  if (!res.ok) throw new VoiceError('tts', res.status, `text-to-speech answered HTTP ${res.status}`, await errorDetail(res));
  return Buffer.from(await res.arrayBuffer());
}
