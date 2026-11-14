// What the voice line may spend: per-IP caps on each route, and daily ceilings on ElevenLabs calls as a
// final safety net, so a script rotating shopper ids or addresses can't run up the bill.

/** At most `max` requests per key in any rolling `windowMs`. */
export function createWindowLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((at) => t - at >= windowMs)) hits.delete(k);
    return true;
  };
}

export type VoiceSpend = 'stt' | 'tts' | 'realtime';

/** Calls to ElevenLabs per UTC day, per kind; take() is false once the day's ceiling is reached. */
export function createDailyBudget(ceilings: Record<VoiceSpend, number>, now: () => number = Date.now) {
  let day = '';
  const used: Record<VoiceSpend, number> = { stt: 0, tts: 0, realtime: 0 };
  const roll = () => {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; used.stt = 0; used.tts = 0; used.realtime = 0; }
  };
  return {
    take(kind: VoiceSpend): boolean {
      roll();
      if (used[kind] >= ceilings[kind]) return false;
      used[kind]++;
      return true;
    },
    used(): Record<VoiceSpend, number> { roll(); return { ...used }; },
  };
}

export interface VoiceLimits {
  perIpPerMinute: number;
  daily: Record<VoiceSpend, number>;
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function voiceLimits(): VoiceLimits {
  return {
    perIpPerMinute: envInt('VOICE_PER_IP_PER_MIN', 10),
    daily: { stt: envInt('VOICE_DAILY_STT', 400), tts: envInt('VOICE_DAILY_TTS', 400), realtime: envInt('VOICE_DAILY_REALTIME', 400) },
  };
}
