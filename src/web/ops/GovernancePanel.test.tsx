import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AwaitingApproval } from '../../shared/contract';
import { GovernancePanel, MemoryProofResult, PendingApprovalCard, type MemoryProof } from './GovernancePanel';

const pending: AwaitingApproval = {
  version: 3, title: 'Check refund evidence', rules: ['Match the original order', 'Check the remaining refundable amount'],
  scamSuccess: 0, scamsTotal: 60, honestTurnedAway: 1, honestTotal: 60, since: new Date('2026-11-14T17:17:00Z'),
};
const proof: MemoryProof = { at: new Date(), collection: 'incidents', field: 'text', refused: true, code: 121, codeName: 'DocumentValidationFailure' };

describe('governance console', () => {
  it('shows the candidate rules and actual gate counts with both decisions available', () => {
    const html = renderToStaticMarkup(<PendingApprovalCard pending={pending} disabled={false} onApprove={() => {}} onReject={() => {}} />);
    expect(html).toContain('Policy v3: Check refund evidence');
    expect(html).toContain('Match the original order');
    expect(html).toContain('Check the remaining refundable amount');
    expect(html).toContain('0 / 60');
    expect(html).toContain('1 / 60');
    expect(html).toContain('>Approve</button>');
    expect(html).toContain('>Reject</button>');
    expect(html).toContain('Reason for rejection (optional)');
    const busy = renderToStaticMarkup(<PendingApprovalCard pending={pending} disabled onApprove={() => {}} onReject={() => {}} />);
    expect(busy.match(/disabled=""/g)).toHaveLength(3);
  });

  it('keeps the approval switch, shopper ID control and proof button visible without a pending candidate', () => {
    const html = renderToStaticMarkup(<GovernancePanel approvalRequired pending={null} disabled={false}
      perform={async () => ({ ok: false, error: 'Not invoked by rendering' })} />);
    expect(html).toContain('role="switch" aria-label="Require approval" aria-checked="true"');
    expect(html).toContain('No version is waiting for approval');
    expect(html).toContain('Shopper ID');
    expect(html).toContain('Prove memory rules');
    expect(html).not.toContain('Atlas refused it: code 121');
    expect(html).not.toContain('>Approve</button>');
  });

  it('claims Atlas validation only when the returned proof actually reports code 121 and refusal', () => {
    const html = renderToStaticMarkup(<MemoryProofResult proof={proof} />);
    expect(html).toContain('Atlas refused it: code 121');
    expect(html).toContain('incidents rejected the raw text field');
    for (const failed of [{ ...proof, refused: false, code: null }, { ...proof, code: 13, codeName: 'Unauthorized' }]) {
      const notProven = renderToStaticMarkup(<MemoryProofResult proof={failed} />);
      expect(notProven).toContain('Validator rejection was not confirmed');
      expect(notProven).not.toContain('Atlas refused it: code 121');
    }
  });
});
