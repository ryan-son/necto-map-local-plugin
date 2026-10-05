//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

/// How long a transient notice stays. It does not expire while held (the pointer is over
/// it or focus is inside) and restarts in full once let go, so someone who was reading or
/// about to press it still gets the whole time after they move away.
export class Lifetime {
  private timer?: ReturnType<typeof setTimeout>;
  private deferred = false;

  constructor(private readonly ms: number, private readonly expire: () => void, private readonly held: () => boolean) {}

  start() {
    this.stop();
    this.timer = setTimeout(() => this.fire(), this.ms);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.deferred = false;
  }

  /// Call when the hold may have ended. If an expiry was deferred and the hold has really
  /// ended, the count starts again.
  release() {
    if (!this.deferred || this.held()) return;
    this.deferred = false;
    this.timer = setTimeout(() => this.fire(), this.ms);
  }

  private fire() {
    this.timer = undefined;
    if (this.held()) { this.deferred = true; return; }
    this.expire();
  }
}
