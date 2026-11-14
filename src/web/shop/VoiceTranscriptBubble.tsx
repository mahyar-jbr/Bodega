export type VoiceDraft = { text: string | null; released: boolean };

/** This draft is rendered separately from persisted chat; only /api/voice supplies the final message. */
export function VoiceTranscriptBubble({ draft }: { draft: VoiceDraft }) {
  return <article className="shop-message is-customer is-live-voice" aria-label={draft.released ? 'Voice message being transcribed' : 'Live voice transcript'}>
    <div className="shop-message-content">
      <p>{draft.text || (draft.released ? 'Voice message…' : 'Listening…')}
        {draft.released && !draft.text && <svg className="shop-voice-wave" width="32" height="18" viewBox="0 0 32 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 7v4M7 4v10M12 2v14M17 5v8M22 3v12M27 6v6M31 8v2" /></svg>}
      </p>
      {!draft.released && <span className="shop-listening-cue"><i aria-hidden="true" />Listening</span>}
    </div>
  </article>;
}
