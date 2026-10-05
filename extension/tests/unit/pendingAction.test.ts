import { describe, expect, it } from 'vitest';
import { PENDING_ACTION_MAX_AGE_MS, isFresh } from '../../src/core/pendingAction';

describe('pendingAction — freshness window for the "ask-about-selection" keyboard shortcut handoff', () => {
  it('treats a just-now request as fresh', () => {
    const now = 1_000_000;
    expect(isFresh(now, now)).toBe(true);
  });

  it('treats a request right at the edge of the max age as fresh', () => {
    const now = 1_000_000;
    const requestedAt = now - PENDING_ACTION_MAX_AGE_MS;
    expect(isFresh(requestedAt, now)).toBe(true);
  });

  it('treats a request older than the max age as stale', () => {
    const now = 1_000_000;
    const requestedAt = now - PENDING_ACTION_MAX_AGE_MS - 1;
    expect(isFresh(requestedAt, now)).toBe(false);
  });

  it('treats a request timestamped in the future (clock skew) as stale, not fresh', () => {
    const now = 1_000_000;
    expect(isFresh(now + 1, now)).toBe(false);
  });
});
