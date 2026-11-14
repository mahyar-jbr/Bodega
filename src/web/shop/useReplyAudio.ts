import { useEffect, useRef, useState } from 'react';
import { createReplyAudio, createSpeakerPreference, type ReplyAudioState } from './reply-audio';
import type { VoiceReply } from './voice';

export function useReplyAudio(scope: string) {
  const [enabled, setEnabled] = useState(true);
  const [states, setStates] = useState<Record<string, ReplyAudioState>>({});
  const current = useRef<{
    audio: ReturnType<typeof createReplyAudio>;
    preference: ReturnType<typeof createSpeakerPreference>;
  } | null>(null);

  useEffect(() => {
    const preference = createSpeakerPreference(scope);
    let mounted = true;
    const audio = createReplyAudio({ enabled: preference.enabled, onState: (id, state) => {
      if (mounted) setStates((previous) => {
        const next = { ...previous };
        if (state) next[id] = state;
        else delete next[id];
        return next;
      });
    } });
    current.current = { audio, preference };
    setEnabled(preference.enabled);
    setStates({});
    const onHidden = () => { if (document.hidden) audio.stop(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      mounted = false;
      audio.dispose();
      current.current = null;
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [scope]);

  return {
    enabled, states,
    toggle() {
      const session = current.current;
      if (!session) return;
      const on = !session.preference.enabled;
      session.preference.set(on);
      session.audio.setEnabled(on);
      setEnabled(on);
    },
    beginRecordingGesture() { current.current?.audio.beginRecordingGesture(); },
    receive(id: string, reply: VoiceReply) { current.current?.audio.receive(id, reply); },
    play(id: string) { current.current?.audio.play(id); },
    stop() { current.current?.audio.stop(); },
    clear() { current.current?.audio.clear(); },
  };
}
