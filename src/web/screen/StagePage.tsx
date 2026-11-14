// /stage: what the presenting laptop shows full screen (plan/DEMO.md). The big screen fills the left,
// and a phone-size shop window sits on the right with five tabs, each its own shopper. All four
// The demo controls hide behind `o` (StageOps). All five
// windows stay loaded, so switching is instant and every chat keeps its place.
import '../../../design/tokens.css';
import './screen.css';
import { useEffect, useRef, useState } from 'react';
import { BigScreen } from './ScreenPage';
import { StageOps } from './StageOps';

const TABS = [
  { key: 'q1', label: 'Queen', src: '/s/queen?as=q1' },
  { key: 'q2', label: 'Queen 2', src: '/s/queen?as=q2' },
  { key: 'y1', label: 'Yonge', src: '/s/yonge?as=y1' },
  { key: 'y2', label: 'Yonge 2', src: '/s/yonge?as=y2' },
  { key: 's1', label: 'Scarborough', src: '/s/scarborough?as=s1' },
] as const;

const PHONE_W = 390, PHONE_H = 844, TABS_H = 70, GUTTER = 24;

export default function StagePage() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(TABS[0].key);
  const [scale, setScale] = useState(1);

  // Keys reach the big screen without a click first.
  useEffect(() => { root.current?.focus(); }, []);

  // The phone takes the full height, less the tabs; the big screen gets the rest of the width.
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - TABS_H - 2 * GUTTER) / PHONE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Escape inside a shop window hands the keyboard back to the big screen (same origin, so we can listen).
  const onFrameLoad = (frame: HTMLIFrameElement) => {
    frame.contentWindow?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { frame.blur(); root.current?.focus(); }
    });
  };

  const colWidth = Math.round(PHONE_W * scale) + 2 * GUTTER;
  return (
    <div className="bs-root st-root" data-theme="stage" ref={root} tabIndex={-1}
      style={{ gridTemplateColumns: `1fr ${colWidth}px` }}>
      <div className="st-screen"><BigScreen /></div>
      <aside className="st-phone-col" aria-label="Shop window">
        <div className="st-tabs" role="tablist" style={{ height: TABS_H - 14 }}>
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={active === t.key} className="st-tab ui-callout"
              onClick={() => { setActive(t.key); requestAnimationFrame(() => document.querySelector<HTMLIFrameElement>(`iframe[data-tab="${t.key}"]`)?.focus()); }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="st-phone" style={{ width: PHONE_W * scale, height: PHONE_H * scale }}>
          {TABS.map((t) => (
            <iframe key={t.key} data-tab={t.key} title={`${t.label} shop`} src={t.src}
              onLoad={(e) => onFrameLoad(e.currentTarget)}
              className="st-frame" data-active={active === t.key}
              style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})` }} />
          ))}
        </div>
      </aside>
      <StageOps />
    </div>
  );
}
