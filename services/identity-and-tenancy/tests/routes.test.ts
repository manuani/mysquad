import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, UnauthenticatedError } from '@voai/errors';
import type { AuthProvider, AuthResult, SignInMethod } from '../src/auth-provider.js';
import { buildIdentityAndTenancyRouter } from '../src/routes.js';

const SAMPLE_RESULT: AuthResult = {
  sessionToken: 'token-abc',
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

class FakeAuthProvider implements AuthProvider {
  public lastSignUp: { email: string; method: SignInMethod } | null = null;
  public lastSignIn: { email: string; method: SignInMethod } | null = null;
  public signUpError: Error | null = null;
  public signInError: Error | null = null;
  public sessionToResolve: AuthResult | null = SAMPLE_RESULT;
  public signOutCalledWith: string | null = null;

  async signUp(email: string, method: SignInMethod): Promise<AuthResult> {
    this.lastSignUp = { email, method };
    if (this.signUpError) throw this.signUpError;
    return SAMPLE_RESULT;
  }

  async signIn(email: string, method: SignInMethod): Promise<AuthResult> {
    this.lastSignIn = { email, method };
    if (this.signInError) throw this.signInError;
    return SAMPLE_RESULT;
  }

  async resolveSession(_sessionToken: string): Promise<AuthResult | null> {
    return this.sessionToResolve;
  }

  async signOut(sessionToken: string): Promise<void> {
    this.signOutCalledWith = sessionToken;
  }
}

describe('identity-and-tenancy routes', () => {
  let server: Server;
  let baseUrl: string;
  let fakeProvider: FakeAuthProvider;

  beforeEach(async () => {
    fakeProvider = new FakeAuthProvider();
    const app = express();
    app.use(express.json());
    app.use(buildIdentityAndTenancyRouter(fakeProvider));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /signup returns 201 with the session result', async () => {
    const res = await fetch(`${baseUrl}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', method: 'email_magic_link' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(SAMPLE_RESULT);
    expect(fakeProvider.lastSignUp).toEqual({ email: 'a@example.com', method: 'email_magic_link' });
  });

  it('POST /signup with an invalid method returns 400', async () => {
    const res = await fetch(`${baseUrl}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', method: 'carrier_pigeon' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /signup propagates ConflictError as 409', async () => {
    fakeProvider.signUpError = new ConflictError('already exists');
    const res = await fetch(`${baseUrl}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', method: 'google' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /signin returns 200 with the session result', async () => {
    const res = await fetch(`${baseUrl}/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', method: 'apple' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAMPLE_RESULT);
  });

  it('POST /signin propagates NotFoundError as 404', async () => {
    fakeProvider.signInError = new NotFoundError('no such user');
    const res = await fetch(`${baseUrl}/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', method: 'apple' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /me without a bearer token returns 401', async () => {
    const res = await fetch(`${baseUrl}/me`);
    expect(res.status).toBe(401);
  });

  it('GET /me with a valid token resolves the tenant context', async () => {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { authorization: 'Bearer token-abc' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tenantId: SAMPLE_RESULT.tenantId,
      userId: SAMPLE_RESULT.userId,
      userType: SAMPLE_RESULT.userType,
      expiresAt: SAMPLE_RESULT.expiresAt,
    });
  });

  it('GET /me with an unresolvable token returns 401', async () => {
    fakeProvider.sessionToResolve = null;
    const res = await fetch(`${baseUrl}/me`, {
      headers: { authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /signout revokes the session and returns 204', async () => {
    const res = await fetch(`${baseUrl}/signout`, {
      method: 'POST',
      headers: { authorization: 'Bearer token-abc' },
    });
    expect(res.status).toBe(204);
    expect(fakeProvider.signOutCalledWith).toBe('token-abc');
  });

  it('POST /signout without a bearer token returns 401', async () => {
    const res = await fetch(`${baseUrl}/signout`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

// Sanity-check the error mapper handles a plain UnauthenticatedError shape,
// matching what routes.ts's handleError does for thrown PlatformErrors.
describe('error shape', () => {
  it('UnauthenticatedError carries the expected code and status', () => {
    const err = new UnauthenticatedError('missing token');
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.httpStatus).toBe(401);
  });
});
