import type { ReplyAudioState } from './reply-audio';

export function SpeakerToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <button type="button" className="shop-speaker-toggle" aria-pressed={enabled}
    aria-label={enabled ? 'Mute spoken replies' : 'Enable spoken replies'} onClick={onToggle}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4 6 8H3v8h3l5 4V4Z" />
      {enabled ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}
    </svg>
    {enabled ? 'Sound on' : 'Sound off'}
  </button>;
}

export function ReplyAudioControl({ state, onPlay, onStop }: {
  state?: ReplyAudioState; onPlay: () => void; onStop: () => void;
}) {
  if (!state) return null;
  return <button type="button" className="shop-reply-audio" onClick={state === 'playing' ? onStop : onPlay}>
    {state === 'playing' ? 'Stop spoken reply' : 'Tap to hear the reply'}
  </button>;
}
