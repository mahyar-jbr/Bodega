// Sample data for building the big screen before the live routes exist. Swapped out in
// useScreenData once /api/agent/state answers. Summaries only, never a customer's words.
import type { ScreenData } from './types';

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

export const MOCK: ScreenData = {
  scene: 'round1',
  tiles: [
    { store: 'queen', status: 'conned', policy: 0, learnedAt: null, lostCents: 3850, blocked: 0, immuneInMs: null },
    { store: 'yonge', status: 'conned', policy: 0, learnedAt: null, lostCents: 2100, blocked: 0, immuneInMs: null },
    { store: 'scarborough', status: 'idle', policy: 0, learnedAt: null, lostCents: 0, blocked: 0, immuneInMs: null },
  ],
  feed: [
    { id: 'f5', kind: 'con-worked', who: 'Sneaky Raccoon', text: 'Conned Queen St, fake code', amountCents: -950, at: ago(20) },
    { id: 'f4', kind: 'sale', who: 'Polite Goose', text: 'Butter tart at Scarborough', amountCents: 350, at: ago(45) },
    { id: 'f3', kind: 'con-worked', who: 'Midnight Moose', text: 'Conned Yonge St, fake manager', amountCents: -1400, at: ago(70) },
    { id: 'f2', kind: 'sale', who: 'Captain Toque', text: 'Beef patty at Yonge St', amountCents: 375, at: ago(95) },
    { id: 'f1', kind: 'con-worked', who: 'Ketchup Bandit', text: 'Conned Queen St, fake refund', amountCents: -950, at: ago(130) },
  ],
  cons: [
    { id: 'c1', summary: 'Fake 50% code from Instagram', firstSeen: 'queen', worked: 3, blocked: 0 },
    { id: 'c2', summary: 'Claims to be the district manager', firstSeen: 'yonge', worked: 2, blocked: 0 },
    { id: 'c3', summary: 'Refund for an unbought sandwich', firstSeen: 'queen', worked: 1, blocked: 0 },
  ],
};
