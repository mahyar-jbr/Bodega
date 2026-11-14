import { useState, type FormEvent } from 'react';
import type { AgentApi, AwaitingApproval } from '../../shared/contract';
import { Icon } from '../ui/Icon';

export type ActionOutcome = { ok: true; result: unknown; message: string } | { ok: false; error: string };
export type GovernanceAction = {
  key: 'approval' | 'approve' | 'reject' | 'forget-shopper' | 'prove-memory-rules';
  label: string;
  body?: Record<string, unknown>;
};
type ForgetResult = Awaited<ReturnType<NonNullable<AgentApi['forgetShopper']>>>;
export type MemoryProof = Omit<Awaited<ReturnType<NonNullable<AgentApi['proveMemoryRules']>>>, 'at'> & { at: string | Date };

export function GovernancePanel({ approvalRequired, pending, disabled, perform }: {
  approvalRequired: boolean;
  pending?: AwaitingApproval | null;
  disabled: boolean;
  perform: (action: GovernanceAction) => Promise<ActionOutcome>;
}) {
  const [shopperId, setShopperId] = useState('');
  const [confirmShopper, setConfirmShopper] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<(ForgetResult & { shopperId: string }) | null>(null);
  const [proof, setProof] = useState<MemoryProof | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  async function invoke(action: GovernanceAction) {
    setFeedback(null);
    const outcome = await perform(action);
    setFeedback(outcome.ok ? { text: outcome.message, error: false } : { text: outcome.error, error: true });
    return outcome;
  }

  function reviewForgetting(event: FormEvent) {
    event.preventDefault();
    if (disabled || !shopperId.trim()) return;
    setConfirmShopper(shopperId.trim());
    setForgotten(null);
    setFeedback(null);
  }

  async function forget() {
    if (!confirmShopper) return;
    const target = confirmShopper;
    const outcome = await invoke({ key: 'forget-shopper', label: 'Forget shopper', body: { shopperId: target } });
    if (outcome.ok) {
      setForgotten({ ...outcome.result as ForgetResult, shopperId: target });
      setConfirmShopper(null);
      setShopperId('');
    }
  }

  async function prove() {
    setProof(null);
    const outcome = await invoke({ key: 'prove-memory-rules', label: 'Prove memory rules' });
    if (outcome.ok) setProof(outcome.result as MemoryProof);
  }

  return (
    <div className="ops-governance">
      <div className="ops-approval-toggle-row">
        <div><strong>Require approval</strong><p className="ops-panel-copy">A version that passes the gate waits for your decision.</p></div>
        <button type="button" className="ops-store-toggle" role="switch" aria-label="Require approval"
          aria-checked={approvalRequired} disabled={disabled}
          onClick={() => void invoke({ key: 'approval', label: 'Update approval requirement', body: { on: !approvalRequired } })}>
          <i />{approvalRequired ? 'On' : 'Off'}
        </button>
      </div>

      {pending ? <PendingApprovalCard key={pending.version} pending={pending} disabled={disabled}
        onApprove={() => void invoke({ key: 'approve', label: 'Approve version' })}
        onReject={(reason) => void invoke({ key: 'reject', label: 'Reject version', body: reason ? { reason } : undefined })}
      /> : <p className="ops-panel-copy ops-no-approval">No version is waiting for approval.</p>}

      <section className="ops-governance-section" aria-labelledby="forget-shopper-title">
        <h3 id="forget-shopper-title">Forget a shopper</h3>
        <p className="ops-panel-copy">Delete their raw chats and redact their identity from incident summaries.</p>
        <form onSubmit={reviewForgetting}>
          <label htmlFor="forget-shopper-id">Shopper ID</label>
          <div className="ops-governance-input-row">
            <input id="forget-shopper-id" value={shopperId} maxLength={200} autoComplete="off" spellCheck={false}
              placeholder="Paste a shopper ID" disabled={disabled}
              onChange={(event) => { setShopperId(event.target.value); setConfirmShopper(null); setForgotten(null); }} />
            <button type="submit" className="ops-button is-secondary" disabled={disabled || !shopperId.trim()}>Review</button>
          </div>
        </form>
        {confirmShopper && <div className="ops-forget-confirm">
          <p>Forget the chats and incident identity for <code>{confirmShopper}</code>?</p>
          <div className="ops-button-pair">
            <button type="button" className="ops-button is-danger" disabled={disabled} onClick={() => void forget()}>Forget this shopper</button>
            <button type="button" className="ops-button is-ghost" disabled={disabled} onClick={() => setConfirmShopper(null)}>Cancel</button>
          </div>
        </div>}
        {forgotten && <p className="ops-governance-result" role="status"><code>{forgotten.shopperId}</code>: {forgotten.conversationsDeleted} conversations deleted; {forgotten.incidentsRedacted} incidents redacted.</p>}
      </section>

      <section className="ops-governance-section" aria-labelledby="memory-proof-title">
        <h3 id="memory-proof-title">Prove the memory rules</h3>
        <p className="ops-panel-copy">Ask Atlas to reject raw chat text in the incident memory.</p>
        <button type="button" className="ops-button is-secondary" disabled={disabled} onClick={() => void prove()}>
          <Icon name="shield" size={19} />Prove memory rules
        </button>
        {proof && <MemoryProofResult proof={proof} />}
      </section>
      {feedback && <p className={`ops-governance-feedback${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </div>
  );
}

export function PendingApprovalCard({ pending, disabled, onApprove, onReject }: {
  pending: AwaitingApproval; disabled: boolean; onApprove: () => void; onReject: (reason?: string) => void;
}) {
  const [reason, setReason] = useState('');
  return <section className="ops-pending-approval" aria-label={`Policy v${pending.version} awaiting approval`}>
    <header><Icon name="shield" size={24} /><div><span>Awaiting approval</span><h3>Policy v{pending.version}: {pending.title}</h3></div></header>
    <ul className="ops-proposed-rules">{pending.rules.map((rule, index) => <li key={`${index}-${rule}`}>{rule}</li>)}</ul>
    <dl className="ops-gate-results bd-num">
      <div><dt>Scams that got through</dt><dd>{pending.scamSuccess} / {pending.scamsTotal}</dd></div>
      <div><dt>Honest shoppers turned away</dt><dd>{pending.honestTurnedAway} / {pending.honestTotal}</dd></div>
    </dl>
    <label htmlFor="rejection-reason">Reason for rejection (optional)</label>
    <input id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={disabled} />
    <div className="ops-approval-actions">
      <button type="button" className="ops-button ops-approve-button" disabled={disabled} onClick={onApprove}><Icon name="check-circle" size={22} />Approve</button>
      <button type="button" className="ops-button ops-reject-button" disabled={disabled} onClick={() => onReject(reason.trim() || undefined)}><Icon name="x-circle" size={22} />Reject</button>
    </div>
  </section>;
}

export function MemoryProofResult({ proof }: { proof: MemoryProof }) {
  const passed = proof.refused && proof.code === 121;
  return <div className={`ops-memory-proof ${passed ? 'is-good' : 'is-error'}`} role="status">
    <Icon name={passed ? 'check-circle' : 'alert'} size={22} />
    <div><strong>{passed ? 'Atlas refused it: code 121' : 'Validator rejection was not confirmed'}</strong>
      <p>{passed ? `${proof.collection} rejected the raw ${proof.field} field.` : proof.code !== null ? `Atlas returned code ${proof.code}${proof.codeName ? ` (${proof.codeName})` : ''}.` : 'No Atlas validation error was returned.'}</p>
    </div>
  </div>;
}
