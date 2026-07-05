/**
 * HTTP routes for the identity-and-tenancy module. Mounted by the gateway
 * at `/v1/identity-and-tenancy/...` (module mount-path convention, see
 * root CLAUDE.md "Conventions").
 *
 * Per ADR 007, the only place a `TenantContext` is constructed from a raw
 * session token is here (`GET /me`, `POST /signout`) — everything past
 * that point (tenancy.ts) receives it as an explicit parameter.
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext } from '@voai/auth-context';
import { isPlatformError, UnauthenticatedError, ValidationError } from '@voai/errors';
import type { Logger } from '@voai/types';
import type { AuthProvider, SignInMethod } from './auth-provider.js';

const SIGN_IN_METHODS: readonly SignInMethod[] = [
  'apple',
  'google',
  'microsoft',
  'email_magic_link',
];

function isSignInMethod(value: unknown): value is SignInMethod {
  return typeof value === 'string' && (SIGN_IN_METHODS as readonly string[]).includes(value);
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function handleError(err: unknown, res: Response, log: Logger): void {
  if (isPlatformError(err)) {
    res
      .status(err.httpStatus)
      .json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  // Unexpected (non-platform) errors are exactly the ones worth seeing —
  // a bug here was previously invisible because this branch returned a
  // generic 500 with no log line at all.
  log.error('unhandled error in identity-and-tenancy route', {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

function parseSignUpInRequest(req: Request): { email: string; method: SignInMethod } {
  const { email, method } = req.body as { email?: unknown; method?: unknown };
  if (typeof email !== 'string' || email.length === 0) {
    throw new ValidationError('email is required');
  }
  if (!isSignInMethod(method)) {
    throw new ValidationError(`method must be one of ${SIGN_IN_METHODS.join(', ')}`);
  }
  return { email, method };
}

export function buildIdentityAndTenancyRouter(authProvider: AuthProvider, log: Logger): Router {
  const router = Router();

  router.post('/signup', async (req: Request, res: Response) => {
    try {
      const { email, method } = parseSignUpInRequest(req);
      const result = await authProvider.signUp(email, method);
      res.status(201).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/signin', async (req: Request, res: Response) => {
    try {
      const { email, method } = parseSignUpInRequest(req);
      const result = await authProvider.signIn(email, method);
      res.status(200).json(result);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/me', async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        throw new UnauthenticatedError('missing bearer session token');
      }
      const session = await authProvider.resolveSession(token);
      if (!session) {
        throw new UnauthenticatedError('session token invalid or expired');
      }
      const tenantContext = buildTenantContext({
        tenantId: session.tenantId,
        userId: session.userId,
        userType: session.userType,
        sessionId: session.sessionToken,
      });
      res.status(200).json({
        tenantId: tenantContext.tenantId,
        userId: tenantContext.userId,
        userType: tenantContext.userType,
        expiresAt: session.expiresAt,
      });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/signout', async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        throw new UnauthenticatedError('missing bearer session token');
      }
      await authProvider.signOut(token);
      res.status(204).send();
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
