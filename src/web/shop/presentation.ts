export type PolicyState = { version: number; arrivedAt: Date | null };

export function policySnapshot(previous: PolicyState | null, version: number, now = new Date()): PolicyState {
  return {
    version,
    arrivedAt: version > 0 && previous && version > previous.version ? now
      : previous?.version === version ? previous.arrivedAt : null,
  };
}

export function policyLabel(policy: PolicyState, now = Date.now()) {
  const label = `Policy v${policy.version}`;
  if (policy.version === 0 || !policy.arrivedAt) return label;
  const minutes = Math.max(0, Math.floor((now - policy.arrivedAt.valueOf()) / 60_000));
  return `${label}, ${minutes === 0 ? 'just arrived' : `learned ${minutes} min ago`}`;
}

export function displayReply(text: string) {
  return text.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\u20E3]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/,(?=[.!?])/g, '')
    .trim();
}
