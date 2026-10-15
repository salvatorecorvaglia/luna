/**
 * Backpressure for terminal output (SSH shell or local PTY → renderer).
 *
 * Output used to be forwarded as fast as it arrived: `yes`, `cat` of a large
 * file or a runaway log tail pushed up to 1 MiB per 16 ms frame over IPC no
 * matter how far behind xterm's parser was, so the renderer's queue — and its
 * memory — grew without bound and the UI stopped responding.
 *
 * Main counts characters sent; the renderer acknowledges them once xterm has
 * parsed them (its write callback). Past `high` unacknowledged, the source is
 * paused — which for an SSH channel stops the window updates, so the *server*
 * slows down — and resumed once the renderer has caught up below `low`.
 */
export class OutputFlow {
  private inflight = 0;
  private paused = false;

  constructor(
    private readonly pauseSource: () => void,
    private readonly resumeSource: () => void,
    private readonly high = 4 * 1024 * 1024,
    private readonly low = 1024 * 1024,
  ) {}

  /** Characters just handed to the renderer. */
  sent(chars: number): void {
    this.inflight += chars;
    if (!this.paused && this.inflight > this.high) {
      this.paused = true;
      this.pauseSource();
    }
  }

  /** Characters the renderer reports as parsed. */
  acked(chars: number): void {
    this.inflight = Math.max(0, this.inflight - chars);
    this.maybeResume();
  }

  /**
   * Forget everything outstanding. Sent when a terminal (re)attaches: output
   * emitted while no terminal was listening — across a renderer reload, say —
   * will never be acknowledged, and without a reset the source would stay
   * paused forever.
   */
  reset(): void {
    this.inflight = 0;
    this.maybeResume();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private maybeResume(): void {
    if (this.paused && this.inflight < this.low) {
      this.paused = false;
      this.resumeSource();
    }
  }
}
