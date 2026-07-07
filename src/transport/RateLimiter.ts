import { DEFAULT_RATE_LIMIT_CAPACITY, DEFAULT_RATE_LIMIT_REFILL_PER_SECOND } from '../constants';

/** Pause helper; injectable so tests can advance time without real waits. */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Token-bucket self-throttle keyed off Servicely's `X-Rate-Limit-Cost` header.
 *
 * Servicely does not publish a documented cost budget or window, so this is a
 * conservative client-side guard rather than an exact mirror of the server:
 * the bucket refills at a steady rate and each request's real cost (from the
 * response header) is deducted after the fact. When the balance runs dry,
 * `waitIfNeeded()` blocks the next request until enough tokens refill — which,
 * combined with the ApiClient's 429 retry/backoff, keeps a workflow from
 * hammering the API into hard throttling.
 *
 * Framework-agnostic and deterministic under injected `now`/`sleep` (testable).
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number = DEFAULT_RATE_LIMIT_CAPACITY,
    private readonly refillPerSecond: number = DEFAULT_RATE_LIMIT_REFILL_PER_SECOND,
    private readonly sleep: SleepFn = defaultSleep,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefillMs = this.now();
  }

  /** Block until at least one token is available, refilling by elapsed time. */
  async waitIfNeeded(): Promise<void> {
    this.refill();
    if (this.tokens >= 1 || this.refillPerSecond <= 0) {
      return;
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
    await this.sleep(waitMs);
    this.refill();
  }

  /**
   * Deduct the real cost of a completed request (from `X-Rate-Limit-Cost`).
   * Allows the balance to go negative so the next `waitIfNeeded()` pays it back.
   */
  recordCost(cost: number | undefined): void {
    if (cost === undefined || !Number.isFinite(cost) || cost <= 0) {
      return;
    }
    this.refill();
    this.tokens -= cost;
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedSec = (nowMs - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefillMs = nowMs;
  }
}
