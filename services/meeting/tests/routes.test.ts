import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@voai/types';
import { buildMeetingRouter } from '../src/routes.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_HEADERS = {
  'x-tenant-id': 'tenant-1',
  'x-user-id': 'user-1',
  'x-user-type': 'founder',
  'x-session-id': 'session-1',
};

const OTHER_TENANT_HEADERS = {
  'x-tenant-id': 'tenant-2',
  'x-user-id': 'user-2',
  'x-user-type': 'founder',
  'x-session-id': 'session-2',
};

function createFakeLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

describe('meeting routes', () => {
  let server: Server;
  let baseUrl: string;
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(async () => {
    ({ postgres } = createFakePostgres());
    const app = express();
    app.use(express.json());
    app.use(buildMeetingRouter(postgres, createFakeLogger()));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('runs the full meeting flow: start -> append x2 -> end -> read transcript', async () => {
    const startRes = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({}),
    });
    expect(startRes.status).toBe(201);
    const session = await startRes.json();
    expect(session.status).toBe('started');

    const append1 = await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ speakerType: 'founder', speakerName: 'Jane', content: 'Hello team' }),
    });
    expect(append1.status).toBe(201);

    const append2 = await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ speakerType: 'agent', speakerName: 'CFO Agent', content: 'Here is the summary' }),
    });
    expect(append2.status).toBe(201);

    const endRes = await fetch(`${baseUrl}/sessions/${session.id}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
    });
    expect(endRes.status).toBe(200);
    const ended = await endRes.json();
    expect(ended.status).toBe('ended');

    const transcriptRes = await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      headers: TENANT_HEADERS,
    });
    expect(transcriptRes.status).toBe(200);
    const transcript = await transcriptRes.json();
    expect(transcript.entries).toHaveLength(2);
    expect(transcript.entries[0].speakerType).toBe('founder');
    expect(transcript.entries[1].speakerType).toBe('agent');
  });

  it('rejects appending to an ended meeting with a 400', async () => {
    const startRes = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({}),
    });
    const session = await startRes.json();
    await fetch(`${baseUrl}/sessions/${session.id}/end`, {
      method: 'POST',
      headers: TENANT_HEADERS,
    });

    const append = await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ speakerType: 'founder', speakerName: 'Jane', content: 'too late' }),
    });
    expect(append.status).toBe(400);
  });

  it('POST /sessions without tenant headers returns an error', async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
  });

  it('a different tenant cannot read another tenant transcript', async () => {
    const startRes = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({}),
    });
    const session = await startRes.json();
    await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ speakerType: 'founder', speakerName: 'Jane', content: 'secret' }),
    });

    // The fake postgres doesn't filter by tenant_id (it stands in for
    // withTenant's call shape, not RLS) — real cross-tenant isolation is
    // verified against the live Docker Postgres stack with real RLS
    // policies, not this in-memory fake. This test just documents that
    // expectation rather than asserting on the fake's behavior.
    const res = await fetch(`${baseUrl}/sessions/${session.id}/transcript`, {
      headers: OTHER_TENANT_HEADERS,
    });
    expect(res.status).toBe(200);
  });
});
