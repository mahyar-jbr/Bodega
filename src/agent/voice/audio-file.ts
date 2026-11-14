// What a recording really is, from its first bytes, and the clean type and file name to send upstream.
// iOS Safari's MediaRecorder sends AAC in MP4 (often as "audio/mp4;codecs=mp4a.40.2", named "blob");
// Chrome and Android send Opus in WebM. A recording that is only the MP4 header, or only the fragments
// after it (some of MediaRecorder's chunks lost), can't be decoded: ElevenLabs answers 400
// invalid_audio, "File is corrupted". Those are caught here, before the upload.

export type AudioKind = 'mp4' | 'webm' | 'mp3' | 'ogg' | 'wav' | 'aac';

const TYPE_BY_KIND: Record<AudioKind, { type: string; ext: string }> = {
  mp4: { type: 'audio/mp4', ext: 'm4a' }, webm: { type: 'audio/webm', ext: 'webm' }, mp3: { type: 'audio/mpeg', ext: 'mp3' },
  ogg: { type: 'audio/ogg', ext: 'ogg' }, wav: { type: 'audio/wav', ext: 'wav' }, aac: { type: 'audio/aac', ext: 'aac' },
};

const KIND_BY_TYPE: Record<string, AudioKind> = {
  'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/x-m4a': 'mp4', 'audio/m4a': 'mp4', 'audio/webm': 'webm', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/aac': 'aac',
};

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** The top-level MP4 box types, in order (stops at the first malformed box). */
export function mp4Boxes(b: Uint8Array): string[] {
  const boxes: string[] = [];
  let at = 0;
  while (at + 8 <= b.length && boxes.length < 64) {
    let size = ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
    const type = ascii(b, at + 4, 4);
    if (!/^[a-z0-9 ]{4}$/i.test(type)) break;
    if (size === 1 && at + 16 <= b.length) size = Number(new DataView(b.buffer, b.byteOffset + at + 8, 8).getBigUint64(0));
    if (size === 0) size = b.length - at;
    if (size < 8) break;
    boxes.push(type);
    at += size;
  }
  return boxes;
}

export function sniff(b: Uint8Array): AudioKind | null {
  if (b.length >= 8 && ascii(b, 4, 4) === 'ftyp') return 'mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (b.length >= 3 && ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return 'aac';   // ADTS
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return 'mp3';   // MPEG frame sync
  return null;
}

/** Why a recording can't be decoded, or null when it looks whole. */
export function brokenRecording(b: Uint8Array): string | null {
  const kind = sniff(b);
  if (kind === null) {
    const first = mp4Boxes(b)[0];
    if (first === 'moof' || first === 'mdat' || first === 'styp') return 'the MP4 recording is missing its header: send every MediaRecorder chunk, the first one included';
    return null;   // unknown: let ElevenLabs decide
  }
  if (kind === 'mp4') {
    const boxes = mp4Boxes(b);
    if (!boxes.includes('moov')) return 'the MP4 recording has no moov box (not finished?): build the Blob from all chunks after recorder.stop()';
    if (!boxes.includes('mdat')) return 'the MP4 recording has no audio data (only its header): build the Blob from all chunks after recorder.stop()';
  }
  return null;
}

/** The clean content type and file name to send upstream: the base type (no codecs parameter), and an
 *  extension that matches it; from the content itself when the browser's type is missing or generic. */
export function uploadName(browserType: string, b: Uint8Array): { type: string; filename: string; kind: AudioKind | null } {
  const base = browserType.split(';')[0]!.trim().toLowerCase();
  const kind = sniff(b) ?? KIND_BY_TYPE[base] ?? null;
  if (!kind) return { type: base || 'application/octet-stream', filename: 'voice', kind: null };
  return { type: TYPE_BY_KIND[kind].type, filename: `voice.${TYPE_BY_KIND[kind].ext}`, kind };
}
