import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ReplyAudioControl, SpeakerToggle } from './ReplyAudioControls';

it('labels the enabled speaker toggle and mute action accessibly', () => {
  const html = renderToStaticMarkup(<SpeakerToggle enabled onToggle={vi.fn()} />);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('Mute spoken replies'); expect(html).toContain('Sound on');
});
it('shows the muted preference with a clear enable action', () => {
  const html = renderToStaticMarkup(<SpeakerToggle enabled={false} onToggle={vi.fn()} />);
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('Enable spoken replies'); expect(html).toContain('Sound off');
});
it('always gives a blocked or muted audio reply the requested tap-to-hear chip', () => {
  for (const state of ['blocked', 'ready'] as const) {
    expect(renderToStaticMarkup(<ReplyAudioControl state={state} onPlay={vi.fn()} onStop={vi.fn()} />)).toContain('Tap to hear the reply');
  }
});
it('offers stop while speaking and no audio control on text-only replies', () => {
  expect(renderToStaticMarkup(<ReplyAudioControl state="playing" onPlay={vi.fn()} onStop={vi.fn()} />)).toContain('Stop spoken reply');
  expect(renderToStaticMarkup(<ReplyAudioControl onPlay={vi.fn()} onStop={vi.fn()} />)).toBe('');
});
