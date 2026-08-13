import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { NotFoundError, ValidationError } from '@voai/errors';
import { activateSession, endSession, getSession, startSession } from '../src/sessions.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('session lifecycle', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('starts a session in started state with typed mode by default', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    expect(session.status).toBe('started');
    expect(session.mode).toBe('typed');
    expect(session.startedBy).toBe('user-1');
    expect(session.endedAt).toBeNull();
  });

  it('accepts voice and mixed mode now the real-time pipeline exists', async () => {
    // These were rejected while LiveKit, STT and TTS were still deferred. That
    // infrastructure now runs end to end (ADR 013), and the stale restriction
    // surfaced as a 500 when the meeting UI opened a voice session to attach an
    // agenda to.
    expect((await startSession(TENANT_CONTEXT, postgres, { mode: 'voice' })).mode).toBe('voice');
    expect((await startSession(TENANT_CONTEXT, postgres, { mode: 'mixed' })).mode).toBe('mixed');
  });

  it('still rejects a mode outside the supported set', async () => {
    await expect(
      startSession(TENANT_CONTEXT, postgres, { mode: 'telepathy' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('activateSession transitions started -> active', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    const activated = await activateSession(TENANT_CONTEXT, postgres, session.id);
    expect(activated.status).toBe('active');
  });

  it('activateSession is idempotent when already active', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    await activateSession(TENANT_CONTEXT, postgres, session.id);
    const activatedAgain = await activateSession(TENANT_CONTEXT, postgres, session.id);
    expect(activatedAgain.status).toBe('active');
  });

  it('endSession transitions to ended and stamps endedAt', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    const ended = await endSession(TENANT_CONTEXT, postgres, session.id);
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).not.toBeNull();
  });

  it('rejects ending an already-ended session', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    await endSession(TENANT_CONTEXT, postgres, session.id);
    await expect(endSession(TENANT_CONTEXT, postgres, session.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('endSession on an unknown session raises NotFoundError', async () => {
    await expect(endSession(TENANT_CONTEXT, postgres, 'does-not-exist')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('getSession returns null for unknown session', async () => {
    const session = await getSession(TENANT_CONTEXT, postgres, 'does-not-exist');
    expect(session).toBeNull();
  });

  it('can end a session directly from started (no explicit activate first)', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    const ended = await endSession(TENANT_CONTEXT, postgres, session.id);
    expect(ended.status).toBe('ended');
  });
});
