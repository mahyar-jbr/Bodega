import { useEffect, useRef, useState } from 'react';
import type { StoreId } from '../../shared/contract';
import { canRecordVoice, createVoiceRecorder, voiceAvailable, type VoicePhase, type VoiceRecorder, type VoiceReply } from './voice';
import { createLiveTranscript } from './live-transcript';
import type { VoiceDraft } from './VoiceTranscriptBubble';

interface Props {
  shopperId: string;
  storeId: StoreId;
  disabled: boolean;
  onPhase: (phase: VoicePhase) => void;
  onReply: (reply: VoiceReply) => void;
  onError: (error: unknown, transcript?: string) => void;
  onPreview: (draft: VoiceDraft | null) => void;
}

export function VoiceButton(props: Props) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [replay, setReplay] = useState(false);
  const liveText = useRef<string | null>(null);
  const released = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const recorder = useRef<VoiceRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const press = useRef<{ at: number; started: boolean } | null>(null);

  function stopPlayback() { audio.current?.pause(); audio.current = null; setReplay(false); }
  function playReply(reply: VoiceReply) {
    stopPlayback();
    if (!reply.audio || !reply.audioType) return;
    const player = new Audio(`data:${reply.audioType};base64,${reply.audio}`);
    audio.current = player;
    player.onended = () => { if (audio.current === player) setReplay(false); };
    if (document.hidden) { setReplay(true); return; }
    void player.play().catch(() => { if (audio.current === player) setReplay(true); });
  }

  useEffect(() => {
    if (!canRecordVoice()) return;
    let current = true;
    const probe = new AbortController();
    void voiceAvailable(probe.signal).then((value) => { if (current) setAvailable(value); });
    const control = createVoiceRecorder({
      shopperId: props.shopperId, storeId: props.storeId,
      onPhase: (next) => { if (current) {
        setPhase(next); latest.current.onPhase(next);
        if (next === 'idle' || next === 'requesting') { liveText.current = null; released.current = false; latest.current.onPreview(null); }
        if (next === 'recording') latest.current.onPreview({ text: liveText.current, released: false });
      } },
      onRelease: () => { if (current) { released.current = true; latest.current.onPreview({ text: liveText.current, released: true }); } },
      onReply: (reply) => { if (current) { latest.current.onPreview(null); latest.current.onReply(reply); playReply(reply); } },
      onError: (error, transcript) => { if (current) { latest.current.onPreview(null); latest.current.onError(error, transcript); } },
      onUnavailable: () => { if (current) setAvailable(false); },
      createLivePreview: () => createLiveTranscript({ shopperId: props.shopperId, onText: (text) => { if (current) {
        liveText.current = text;
        if (control.phase === 'recording' || released.current) latest.current.onPreview({ text, released: released.current });
      } } }),
    });
    recorder.current = control;
    const onHidden = () => {
      if (document.hidden) {
        if (control.phase !== 'sending') control.cancel();
        stopPlayback();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      current = false;
      probe.abort();
      control.cancel();
      recorder.current = null;
      audio.current?.pause();
      audio.current = null;
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [props.shopperId, props.storeId]);

  function toggle() {
    if (phase === 'recording' || phase === 'requesting') recorder.current?.stop();
    else if (phase === 'idle' && !props.disabled) { stopPlayback(); void recorder.current?.start(); }
  }

  if (!available) return null;
  const recording = phase === 'recording' || phase === 'requesting';
  const label = recording ? 'Stop recording and send voice message' : 'Record a voice message';
  return <div className="shop-voice-control">
    <button type="button" className={`shop-mic-button${recording ? ' is-recording' : ''}`}
      aria-label={label} aria-pressed={recording} aria-describedby="shop-voice-help"
      title="Hold to talk, release to send. On desktop, tap to start and stop."
      disabled={props.disabled || phase === 'sending'}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { at: Date.now(), started: phase === 'idle' };
        toggle();
      }}
      onPointerUp={(event) => {
        const held = press.current;
        press.current = null;
        if (held?.started && (event.pointerType !== 'mouse' || Date.now() - held.at >= 250)) recorder.current?.stop();
      }}
      onPointerCancel={() => { press.current = null; recorder.current?.cancel(); }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => { if (event.detail === 0) toggle(); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      </svg>
    </button>
    <span id="shop-voice-help" className="shop-visually-hidden">Hold to talk and release to send. On desktop, tap to start and tap again to send.</span>
    {recording && <div className="shop-voice-status" role="status">
      <span>{phase === 'requesting' ? 'Allow microphone access…' : 'Listening…'}</span>
      <button type="button" onClick={() => recorder.current?.cancel()}>Cancel</button>
    </div>}
    {replay && <button type="button" className="shop-voice-replay" onClick={() => {
      void audio.current?.play().then(() => setReplay(false)).catch(() => setReplay(true));
    }}>Play spoken reply</button>}
  </div>;
}
