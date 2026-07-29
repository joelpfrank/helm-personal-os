// Frozen-clock shim for demo asset generation, loaded with `node --import`.
//
// When HELM_DEMO_NOW is set to an ISO timestamp, every `new Date()` and
// `Date.now()` in the process returns that exact instant, so the demo
// server, the seeded workspace, and the captured UI all agree on "today"
// no matter when or where the assets are regenerated. Without the
// variable the shim is inert; an unparseable value aborts the process
// rather than silently falling back to real time.

const iso = process.env.HELM_DEMO_NOW;

if (iso !== undefined) {
  const fixedMs = Date.parse(iso);
  if (!Number.isFinite(fixedMs)) {
    process.stderr.write(`demo-clock: HELM_DEMO_NOW is not a parseable timestamp: ${JSON.stringify(iso)}\n`);
    process.exit(1);
  }
  installFrozenClock(fixedMs);
}

export function installFrozenClock(fixedMs) {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() { return fixedMs; }
  }
  Object.defineProperty(FrozenDate, 'name', { value: 'Date' });
  globalThis.Date = FrozenDate;
}
