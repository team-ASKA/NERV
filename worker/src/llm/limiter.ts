/**
 * FIFO token bucket for outbound model calls.
 *
 * Every pod runs several jobs concurrently and each job may issue several model
 * calls, so without a shared ceiling a modest burst of uploads trips the
 * provider's account-wide rate limit and every job fails at once. Rationing
 * locally turns that cliff into a queue.
 *
 * FIFO rather than a sleep-and-retry loop: under sustained contention a
 * retry loop starves whichever caller is unlucky, and an ingestion job that
 * never acquires a token eventually hits BullMQ's stall timeout for no reason.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly waiters: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly perMinute: number,
    private readonly capacity = Math.max(1, Math.ceil(perMinute / 6)),
  ) {
    this.tokens = this.capacity;
  }

  private refill(): void {
    const now = Date.now();
    const minutes = (now - this.lastRefill) / 60_000;
    if (minutes <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + minutes * this.perMinute);
    this.lastRefill = now;
  }

  private drain(): void {
    this.refill();
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.waiters.shift()?.();
    }
    if (this.waiters.length > 0 && !this.timer) {
      const msPerToken = 60_000 / this.perMinute;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, Math.max(25, msPerToken));
      // Never hold the event loop open on account of a waiter.
      this.timer.unref?.();
    }
  }

  /** Resolves when this caller may proceed. Waiters are served in order. */
  acquire(): Promise<void> {
    this.refill();
    if (this.waiters.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
  }

  get queueDepth(): number {
    return this.waiters.length;
  }
}
