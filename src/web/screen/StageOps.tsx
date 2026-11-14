// The presenter's controls on /stage: a tiny corner button (or the key `o`) opens a strip with the four
// demo actions. It calls the same POST /api/ops/* routes as the ops console with the x-ops-password header.
// The password is asked for once and kept in sessionStorage only: never localStorage, the URL or a log.
// Clicks never move the keyboard focus (a shop window keeps its typing), and typing in the password field
// never reaches the scene keys.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiJson } from '../ui/api';

const KEY = 'bodega-ops-password';
const readPassword = () => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const savePassword = (p: string) => { try { if (p) sessionStorage.setItem(KEY, p); else sessionStorage.removeItem(KEY); } catch { /* private mode */ } };

type Action = { key: string; label: string; path: string; body?: Record<string, unknown>; confirm?: string; done: (r: Record<string, unknown>) => string };
const ACTIONS: Action[] = [
  { key: 'opening', label: 'Opening (Queen)', path: '/api/ops/opening', body: { storeId: 'queen' },
    done: (r) => `Opening sent: ${Array.isArray(r.cases) ? r.cases.length : 'the'} cons at Queen St` },
  { key: 'rollback', label: 'Roll back', path: '/api/ops/rollback',
    done: (r) => (typeof r.fromVersion === 'number' ? `Rolled back v${r.fromVersion} → v${r.toVersion}` : 'Rolled back') },
  { key: 'gate', label: 'Test a strict version', path: '/api/ops/gate-demo', confirm: 'Tap again to test',
    done: () => 'Testing a too-strict version on 120 unseen cases' },
  { key: 'reset', label: 'Reset', path: '/api/ops/reset', confirm: 'Tap again to reset',
    done: () => 'Reset: every store starts fresh' },
];

/** True when a key press is typing, so the scene keys and `o` leave it alone. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function StageOps() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(readPassword);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean; id: number } | null>(null);
  const toastTimer = useRef(0), armTimer = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'o' || e.key === 'O') setOpen((v) => !v);
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const say = (text: string, bad = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, bad, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), 4_500);
  };

  const run = async (a: Action) => {
    if (busy) return;
    if (a.confirm && armed !== a.key) {
      setArmed(a.key);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(null), 3_000);
      return;
    }
    setArmed(null);
    setBusy(a.key);
    try {
      const r = await apiJson<Record<string, unknown>>(a.path, {
        method: 'POST', headers: { 'x-ops-password': password }, body: JSON.stringify(a.body ?? {}),
      });
      say(a.done(r ?? {}));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { savePassword(''); setPassword(''); say('Password rejected', true); }
      else say(`${a.label} failed: ${e instanceof Error ? e.message : 'error'}`, true);
    } finally { setBusy(null); }
  };

  const unlock = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    savePassword(draft); setPassword(draft); setDraft('');
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // Mouse down without a focus change: a shop window keeps its keyboard.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="so-root">
      <button type="button" className="so-corner" onMouseDown={keepFocus} onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Hide demo controls (o)' : 'Show demo controls (o)'} aria-expanded={open} title="Demo controls (o)">
        <span aria-hidden="true">{open ? '×' : '•••'}</span>
      </button>
      {open && (
        <div className="so-strip bs-glass" role="toolbar" aria-label="Demo controls">
          {password ? ACTIONS.map((a) => (
            <button key={a.key} type="button" className="so-btn" onMouseDown={keepFocus} onClick={() => void run(a)}
              disabled={!!busy} data-armed={armed === a.key ? 'true' : undefined} data-busy={busy === a.key ? 'true' : undefined}>
              {armed === a.key ? a.confirm : busy === a.key ? `${a.label}…` : a.label}
            </button>
          )) : (
            <form className="so-unlock" onSubmit={unlock}>
              <input type="password" className="so-input" placeholder="Ops password" aria-label="Ops password" autoComplete="off"
                value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
              <button type="submit" className="so-btn">Unlock</button>
            </form>
          )}
        </div>
      )}
      {toast && <div className="so-toast bs-glass" data-bad={toast.bad ? 'true' : undefined} key={toast.id} role="status">{toast.text}</div>}
    </div>
  );
}
