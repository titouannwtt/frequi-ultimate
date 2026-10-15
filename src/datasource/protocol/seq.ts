/** Client-side sequence tracking of one channel. Port of `fg-core::protocol::SeqTracker`. */
import type { SeqCheck } from '@/gateway/types.gen';

export class SeqTracker {
  private lastSeq: number | null = null;

  /** Set the baseline from a snapshot (`X-Gw-Seq`) or a `subscribed` frame. */
  reset(seq: number): void {
    this.lastSeq = seq;
  }

  /** Last applied sequence number, to send as `resume`. */
  get last(): number | null {
    return this.lastSeq;
  }

  /**
   * Check an incoming frame; the baseline only moves on `in_order`. Without a baseline the first
   * frame is accepted as the baseline.
   */
  observe(seq: number): SeqCheck {
    const last = this.lastSeq;
    if (last === null || seq === last + 1) {
      this.lastSeq = seq;
      return { verdict: 'in_order' };
    }
    if (seq <= last) {
      return { verdict: 'duplicate' };
    }
    return { verdict: 'gap', expected: last + 1, got: seq };
  }
}
