import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLedgerRouter } from '../src/routes.js';
import { createFakePostgres } from './fake-postgres.js';

const TENANT_HEADERS = {
  'x-tenant-id': 'tenant-1',
  'x-user-id': 'user-1',
  'x-user-type': 'founder',
  'x-session-id': 'session-1',
};

describe('ledger routes', () => {
  let server: Server;
  let baseUrl: string;
  let postgres: ReturnType<typeof createFakePostgres>['postgres'];

  beforeEach(async () => {
    ({ postgres } = createFakePostgres());
    const app = express();
    app.use(express.json());
    app.use(buildLedgerRouter(postgres));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /decisions creates a decision', async () => {
    const res = await fetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ decisionType: 'pricing', summary: 'Raise prices', stakesLevel: 'high' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.state).toBe('draft');
  });

  it('POST /decisions without tenant headers returns 401-equivalent error', async () => {
    const res = await fetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisionType: 'pricing', summary: 'Raise prices', stakesLevel: 'high' }),
    });
    expect(res.status).toBe(500);
  });

  it('POST /decisions with invalid stakesLevel returns 400', async () => {
    const res = await fetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ decisionType: 'pricing', summary: 'Raise prices', stakesLevel: 'extreme' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /decisions/:id/supersede applies the replaces mode', async () => {
    const createRes = await fetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ decisionType: 'pricing', summary: 'Old plan', stakesLevel: 'medium', state: 'active' }),
    });
    const prior = await createRes.json();

    const createNextRes = await fetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ decisionType: 'pricing', summary: 'New plan', stakesLevel: 'medium', state: 'active' }),
    });
    const next = await createNextRes.json();

    const res = await fetch(`${baseUrl}/decisions/${prior.id}/supersede`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ mode: 'replaces', newDecisionId: next.id, reason: 'pivot' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('superseded');
    expect(body.supersededBy).toBe(next.id);
  });

  it('POST /actions creates a pending action', async () => {
    const res = await fetch(`${baseUrl}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ assignedTo: 'founder' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.state).toBe('pending');
  });

  it('PATCH /actions/:id/state rejects an invalid state value', async () => {
    const createRes = await fetch(`${baseUrl}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ assignedTo: 'founder' }),
    });
    const action = await createRes.json();

    const res = await fetch(`${baseUrl}/actions/${action.id}/state`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ state: 'on_hold' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /actions/:id/state transitions to completed', async () => {
    const createRes = await fetch(`${baseUrl}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ assignedTo: 'founder' }),
    });
    const action = await createRes.json();

    await fetch(`${baseUrl}/actions/${action.id}/state`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ state: 'in_progress' }),
    });

    const res = await fetch(`${baseUrl}/actions/${action.id}/state`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ state: 'completed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('completed');
  });

  it('POST /conflicts creates a detected conflict', async () => {
    const res = await fetch(`${baseUrl}/conflicts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({
        conflictType: 'contradicting_decision',
        sourceAType: 'decision',
        sourceAId: 'decision-a',
        sourceBType: 'decision',
        sourceBId: 'decision-b',
        severity: 'high',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.resolutionState).toBe('detected');
  });

  it('POST /conflicts/:id/resolve resolves the conflict', async () => {
    const createRes = await fetch(`${baseUrl}/conflicts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({
        conflictType: 'contradicting_decision',
        sourceAType: 'decision',
        sourceAId: 'decision-a',
        sourceBType: 'decision',
        sourceBId: 'decision-b',
        severity: 'high',
      }),
    });
    const conflict = await createRes.json();

    const res = await fetch(`${baseUrl}/conflicts/${conflict.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ resolutionNote: 'replaces: decision-b wins' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolutionState).toBe('resolved');
  });

  it('GET /currently-active returns the aggregated view', async () => {
    await fetch(`${baseUrl}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TENANT_HEADERS },
      body: JSON.stringify({ assignedTo: 'founder' }),
    });

    const res = await fetch(`${baseUrl}/currently-active`, { headers: TENANT_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingOrInProgressActions).toHaveLength(1);
    expect(body.outcomeDueDecisions).toEqual([]);
    expect(body.unresolvedConflicts).toEqual([]);
  });
});
