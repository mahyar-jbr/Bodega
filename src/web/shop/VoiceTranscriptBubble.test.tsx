import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VoiceTranscriptBubble } from './VoiceTranscriptBubble';

it('shows spoken words on the shopper side with a listening cue', () => {
  const html = renderToStaticMarkup(<VoiceTranscriptBubble draft={{ text: 'One coffee please', released: false }} />);
  expect(html).toContain('is-customer');
  expect(html).toContain('One coffee please');
  expect(html).toContain('Listening');
  expect(html).not.toContain('Voice message…');
});

it('shows a released voice bubble immediately even if live transcription failed', () => {
  const html = renderToStaticMarkup(<VoiceTranscriptBubble draft={{ text: null, released: true }} />);
  expect(html).toContain('Voice message…');
  expect(html).toContain('shop-voice-wave');
  expect(html).not.toContain('shop-listening-cue');
});

it('keeps the last words stable after release while the normal reply is pending', () => {
  const html = renderToStaticMarkup(<VoiceTranscriptBubble draft={{ text: 'One coffee please', released: true }} />);
  expect(html).toContain('One coffee please');
  expect(html).not.toContain('Listening');
  expect(html).not.toContain('Voice message…');
});
