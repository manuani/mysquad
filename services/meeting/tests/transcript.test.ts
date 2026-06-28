import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import { NotFoundError, ValidationError } from '@voai/errors';
import { startSession, endSession, getSession } from '../src/sessions.js';
import { appendTranscriptEntry, getTranscript } from '../src/transcript.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'session-1',
};

describe('transcript persistence', () => {
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(() => {
    ({ postgres } = createFakePostgres());
  });

  it('appends entries in order and assigns increasing sequence numbers', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);

    const first = await appendTranscriptEntry(TENANT_CONTEXT, postgres, {
      sessionId: session.id,
      speakerType: 'founder',
      speakerName: 'Founder Jane',
      content: 'Let us start the meeting.',
    });
    const second = await appendTranscriptEntry(TENANT_CONTEXT, postgres, {
      sessionId: session.id,
      speakerType: 'agent',
      speakerName: 'CFO Agent',
      content: 'Here is the financial summary.',
    });

    expect(first.sequenceNumber).toBe(1);
    expect(second.sequenceNumber).toBe(2);

    const transcript = await getTranscript(TENANT_CONTEXT, postgres, session.id);
    expect(transcript.map((e) => e.content)).toEqual([first.content, second.content]);
  });

  it('appending the first entry implicitly activates a started session', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    expect(session.status).toBe('started');

    await appendTranscriptEntry(TENANT_CONTEXT, postgres, {
      sessionId: session.id,
      speakerType: 'founder',
      speakerName: 'Founder Jane',
      content: 'Kicking things off.',
    });

    const reloaded = await getSession(TENANT_CONTEXT, postgres, session.id);
    expect(reloaded?.status).toBe('active');
  });

  it('rejects appending to an ended session', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    await endSession(TENANT_CONTEXT, postgres, session.id);

    await expect(
      appendTranscriptEntry(TENANT_CONTEXT, postgres, {
        sessionId: session.id,
        speakerType: 'founder',
        speakerName: 'Founder Jane',
        content: 'Too late.',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid speakerType', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    await expect(
      appendTranscriptEntry(TENANT_CONTEXT, postgres, {
        sessionId: session.id,
        // @ts-expect-error -- intentionally invalid for the test
        speakerType: 'observer',
        speakerName: 'Someone',
        content: 'hi',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('appendTranscriptEntry on an unknown session raises NotFoundError', async () => {
    await expect(
      appendTranscriptEntry(TENANT_CONTEXT, postgres, {
        sessionId: 'does-not-exist',
        speakerType: 'founder',
        speakerName: 'Founder Jane',
        content: 'hi',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getTranscript on an unknown session raises NotFoundError', async () => {
    await expect(getTranscript(TENANT_CONTEXT, postgres, 'does-not-exist')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getTranscript returns an empty array for a session with no entries', async () => {
    const session = await startSession(TENANT_CONTEXT, postgres);
    const transcript = await getTranscript(TENANT_CONTEXT, postgres, session.id);
    expect(transcript).toEqual([]);
  });
});
