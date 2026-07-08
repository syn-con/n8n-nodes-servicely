import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../transport/RateLimiter';

/** Build a limiter over a controllable clock; sleeping advances the clock. */
function makeLimiter(capacity: number, refillPerSecond: number) {
  const state = { clock: 0 };
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    state.clock += ms;
    waits.push(ms);
  };
  const limiter = new RateLimiter(capacity, refillPerSecond, sleep, () => state.clock);
  return { limiter, waits, advance: (ms: number) => (state.clock += ms) };
}

describe('RateLimiter', () => {
  it('does not wait while tokens remain', async () => {
    const { limiter, waits } = makeLimiter(5, 10);
    await limiter.waitIfNeeded();
    expect(waits).toEqual([]);
  });

  it('waits long enough to recover one token after the bucket is overdrawn', async () => {
    const { limiter, waits } = makeLimiter(5, 10);
    await limiter.waitIfNeeded(); // full bucket, no wait
    limiter.recordCost(20); // tokens ~ -15
    await limiter.waitIfNeeded(); // needs (1 - (-15)) / 10 s = 1600ms
    expect(waits).toEqual([1600]);
  });

  it('does not wait again once tokens have recovered', async () => {
    const { limiter, waits } = makeLimiter(5, 10);
    limiter.recordCost(20);
    await limiter.waitIfNeeded();
    await limiter.waitIfNeeded();
    expect(waits).toHaveLength(1);
  });

  it('refills over elapsed time but never above capacity', async () => {
    const { limiter, waits, advance } = makeLimiter(5, 10);
    limiter.recordCost(5); // tokens ~ 0
    advance(10_000); // 10s would add 100 tokens, capped at 5
    limiter.recordCost(5); // back to ~0 from the cap
    await limiter.waitIfNeeded(); // still needs to wait for ~1 token
    expect(waits[0]).toBe(100);
  });

  it('ignores non-positive or non-finite costs', async () => {
    const { limiter, waits } = makeLimiter(5, 10);
    limiter.recordCost(undefined);
    limiter.recordCost(0);
    limiter.recordCost(-4);
    limiter.recordCost(Number.NaN);
    await limiter.waitIfNeeded();
    expect(waits).toEqual([]);
  });

  it('never blocks when refill rate is zero (disabled)', async () => {
    const { limiter, waits } = makeLimiter(0, 0);
    limiter.recordCost(100);
    await limiter.waitIfNeeded();
    expect(waits).toEqual([]);
  });

  it('works with default capacity/refill and the built-in clock', async () => {
    const limiter = new RateLimiter(); // exercises default now()
    await expect(limiter.waitIfNeeded()).resolves.toBeUndefined();
  });

  it('uses the built-in sleep when a wait is actually required', async () => {
    // Tiny bucket + fast refill so the real setTimeout wait is ~1ms.
    const limiter = new RateLimiter(1, 1000);
    limiter.recordCost(2);
    await expect(limiter.waitIfNeeded()).resolves.toBeUndefined();
  });
});
