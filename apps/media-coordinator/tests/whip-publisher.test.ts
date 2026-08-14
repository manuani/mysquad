/**
 * The one-shot audio-serve route is registered on the Express *application*,
 * and an app keeps its layers on `app._router.stack` — `app.stack` is
 * undefined. Reading the wrong one threw from inside the TTL timer, and an
 * uncaught exception in a timer takes the process down.
 *
 * It fired on every local meeting: LiveKit Cloud cannot fetch a localhost serve
 * URL (ADR 013), so the route was never hit and the TTL always expired. The
 * media coordinator died about a minute after the first advisor spoke, which
 * looked from the browser like typed messages silently failing to send.
 */

import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createWhipPublisher } from '../src/whip-publisher.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function publisherOn(router: express.Express | express.Router) {
  return createWhipPublisher({
    livekitUrl: 'wss://lk.test',
    livekitApiKey: 'key',
    livekitApiSecret: 'secret',
    router: router as express.Router,
    log,
  });
}

/** Layers currently registered, however this Express version stores them. */
function routePaths(target: express.Express | express.Router): string[] {
  const c = target as unknown as {
    stack?: Array<{ route?: { path: string } }>;
    _router?: { stack?: Array<{ route?: { path: string } }> };
  };
  const stack = c.stack ?? c._router?.stack ?? [];
  return stack.flatMap((l) => (l.route?.path ? [l.route.path] : []));
}

describe('audio-serve route cleanup', () => {
  it('finds the route stack on an Express app, not just a Router', () => {
    // The regression: `app.stack` is undefined, so the original lookup threw.
    const app = express();

    // `_router` is built lazily — it does not exist until something is
    // registered, so the lookup has to tolerate its absence as well as its
    // different name.
    expect((app as unknown as { _router?: unknown })._router).toBeUndefined();

    app.get('/audio-serve/tok', (_q, s) => s.end());

    expect((app as unknown as { stack?: unknown }).stack).toBeUndefined();
    expect(routePaths(app)).toContain('/audio-serve/tok');
  });

  it('removes an expired route from an app without throwing', async () => {
    vi.useFakeTimers();
    try {
      const app = express();
      const publisher = publisherOn(app);

      // The ingress call reaches LiveKit; only route bookkeeping is under test.
      const publish = publisher
        .publishAudio({
          roomName: 'room-1',
          participantIdentity: 'sarah-cfo',
          participantName: 'Sarah Chen',
          audioBuffer: Buffer.from('fake mp3'),
          selfBaseUrl: 'http://localhost:3001',
        })
        .catch(() => undefined);

      // Let the route register before the TTL fires.
      await Promise.resolve();
      const registered = routePaths(app).filter((p) => p.startsWith('/audio-serve/'));

      // Run out the TTL. Before the fix this threw inside the timer and would
      // have taken the process with it.
      expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();

      if (registered.length > 0) {
        expect(routePaths(app)).not.toContain(registered[0]);
      }
      await publish;
    } finally {
      vi.useRealTimers();
    }
  });

  it('still works when handed a Router rather than an app', () => {
    const router = express.Router();
    router.get('/audio-serve/tok', (_q, s) => s.end());
    expect(routePaths(router)).toContain('/audio-serve/tok');
  });
});
