/**
 * Voice gateway route tests.
 *
 * Focus is on the two things that carry real risk here:
 *   1. Tenant isolation — a room name is only reachable by the tenant whose id
 *      prefixes it, so a caller cannot join or end another tenant's meeting.
 *   2. Token issuance being genuinely awaited. `AccessToken.toJwt()` is async in
 *      livekit-server-sdk v2; forgetting to await it silently ships a pending
 *      Promise where a JWT string belongs, and the browser cannot connect.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVoiceGatewayRouter } from '../src/routes.js';
import { createStubLiveKitClient, type LiveKitClient } from '../src/livekit-client.js';

const TENANT = 'shreesteel-tenant-id';
const PREFIX = TENANT.slice(0, 8); // rooms for this tenant are named with this prefix
const ROOM = `${PREFIX}-abcd1234`;
const OTHER_ROOM = 'otherten-1234abcd';
const MC_URL = 'http://mc.test';

const TENANT_HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': TENANT,
  'x-user-id': 'user-1234-5678',
  'x-user-type': 'founder',
  'x-session-id': 'session-abc',
};

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => noopLogger),
};

describe('voice-gateway routes', () => {
  let server: Server;
  let baseUrl: string;
  let livekit: LiveKitClient;
  /** Captures calls the router makes out to the media-coordinator. */
  let realFetch: typeof globalThis.fetch;

  function startServer(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      buildVoiceGatewayRouter({
        livekit,
        mediaCoordinatorUrl: MC_URL,
        log: noopLogger as never,
      }),
    );
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  /** Stubs outbound MC calls only — requests to our own test server pass through. */
  function stubMediaCoordinator(response: Response): ReturnType<typeof vi.fn> {
    const calls = vi.fn();
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(MC_URL)) {
        calls(url, init);
        return Promise.resolve(response.clone());
      }
      return realFetch(input as never, init);
    });
    return calls;
  }

  beforeEach(async () => {
    realFetch = globalThis.fetch;
    livekit = createStubLiveKitClient();
    await startServer();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('auth', () => {
    it('rejects requests missing the x-* auth headers', async () => {
      const res = await fetch(`${baseUrl}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Q3 planning' }),
      });
      expect(res.status).toBe(401);
    });

    it('serves healthz without auth', async () => {
      const res = await fetch(`${baseUrl}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'healthy', mediaCoordinatorUrl: MC_URL });
    });
  });

  describe('POST /rooms', () => {
    it('creates a room whose name is prefixed with the tenant id', async () => {
      const res = await fetch(`${baseUrl}/rooms`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ title: 'Q3 planning' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.roomName.startsWith(PREFIX)).toBe(true);
      expect(body.title).toBe('Q3 planning');
    });

    it('falls back to the room name when no title is given', async () => {
      const res = await fetch(`${baseUrl}/rooms`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });
      const body = await res.json();
      expect(body.title).toBe(body.roomName);
    });
  });

  describe('POST /rooms/:name/token', () => {
    it('issues a token for a room belonging to the caller', async () => {
      const res = await fetch(`${baseUrl}/rooms/${ROOM}/token`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ displayName: 'Mura' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.roomName).toBe(ROOM);
      expect(typeof body.token).toBe('string');
      expect(body.identity).toMatch(/^human-/);
    });

    it("refuses to issue a token for another tenant's room", async () => {
      const res = await fetch(`${baseUrl}/rooms/${OTHER_ROOM}/token`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it('resolves the token before responding — never serialises a pending Promise', async () => {
      livekit = {
        ...createStubLiveKitClient(),
        issueToken: async (opts) => {
          await new Promise((r) => setTimeout(r, 5));
          return {
            token: 'real.jwt.value',
            wsUrl: 'wss://lk.test',
            identity: opts.identity,
            roomName: opts.roomName,
          };
        },
      };
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await startServer();

      const res = await fetch(`${baseUrl}/rooms/${ROOM}/token`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });
      const body = await res.json();
      expect(body.token).toBe('real.jwt.value');
      expect(body.wsUrl).toBe('wss://lk.test');
    });
  });

  describe('POST /rooms/:name/start-ai', () => {
    it('starts a media-coordinator session and returns a bot token per persona', async () => {
      const mcCalls = stubMediaCoordinator(
        new Response(JSON.stringify({ status: 'active' }), { status: 201 }),
      );

      const res = await fetch(`${baseUrl}/rooms/${ROOM}/start-ai`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ sessionToken: 'sess-token' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.roomName).toBe(ROOM);
      expect(body.voiceSessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.botTokens.map((t: { identity: string }) => t.identity)).toEqual([
        'sarah-cfo',
        'priya-cmo',
        'marcus-da',
      ]);

      // The MC is told which LiveKit room this session belongs to.
      const [url, init] = mcCalls.mock.calls[0]!;
      expect(String(url)).toContain(`${MC_URL}/sessions/`);
      expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
        tenantId: TENANT,
        sessionToken: 'sess-token',
        livekitRoomName: ROOM,
      });
    });

    it('requires a sessionToken', async () => {
      const res = await fetch(`${baseUrl}/rooms/${ROOM}/start-ai`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("refuses to start AI in another tenant's room", async () => {
      const res = await fetch(`${baseUrl}/rooms/${OTHER_ROOM}/start-ai`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ sessionToken: 'sess-token' }),
      });
      expect(res.status).toBe(401);
    });

    it('surfaces a media-coordinator failure instead of reporting success', async () => {
      stubMediaCoordinator(
        new Response(JSON.stringify({ message: 'session already active' }), { status: 409 }),
      );

      const res = await fetch(`${baseUrl}/rooms/${ROOM}/start-ai`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ sessionToken: 'sess-token' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /rooms/:name/end', () => {
    it('ends the media-coordinator session and deletes the LiveKit room', async () => {
      const deleteRoom = vi.fn(async () => {});
      livekit = { ...createStubLiveKitClient(), deleteRoom };
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await startServer();
      const mcCalls = stubMediaCoordinator(new Response('{}', { status: 200 }));

      const res = await fetch(`${baseUrl}/rooms/${ROOM}/end`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({ voiceSessionId: 'vs-1' }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ roomName: ROOM, status: 'ended' });
      expect(deleteRoom).toHaveBeenCalledWith(ROOM);
      expect(String(mcCalls.mock.calls[0]![0])).toBe(`${MC_URL}/sessions/vs-1/end`);
    });

    it('still deletes the room when no voiceSessionId is supplied', async () => {
      const deleteRoom = vi.fn(async () => {});
      livekit = { ...createStubLiveKitClient(), deleteRoom };
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await startServer();

      const res = await fetch(`${baseUrl}/rooms/${ROOM}/end`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(deleteRoom).toHaveBeenCalledWith(ROOM);
    });

    it("refuses to end another tenant's room", async () => {
      const deleteRoom = vi.fn(async () => {});
      livekit = { ...createStubLiveKitClient(), deleteRoom };
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await startServer();

      const res = await fetch(`${baseUrl}/rooms/${OTHER_ROOM}/end`, {
        method: 'POST',
        headers: TENANT_HEADERS,
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
      expect(deleteRoom).not.toHaveBeenCalled();
    });
  });
});
