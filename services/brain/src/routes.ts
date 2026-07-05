/**
 * HTTP routes for the brain module. Mounted by the gateway at
 * `/v1/brain/...` (module mount-path convention, see root CLAUDE.md
 * "Conventions").
 *
 * Per ADR 007, the only place a `TenantContext` is constructed from a raw
 * request is here — everything past that point (content-store.ts)
 * receives it as an explicit parameter. This module does not implement
 * authentication itself; it expects the gateway (or, in this skeleton
 * stage, the caller) to supply tenant/user identity via headers, matching
 * the dev-mode pattern used until a real session-token-to-context bridge
 * is wired in front of every module. See services/brain/README.md for the
 * exact header contract and why it's a deliberate placeholder.
 */

import { Router, type Request, type Response } from 'express';
import type { PostgresClient } from '@voai/db';
import { buildTenantContext, type TenantContext } from '@voai/auth-context';
import { isPlatformError, ValidationError } from '@voai/errors';
import { isBrainDomain, isBrainSource, type BrainDomain, type BrainSource } from './domains.js';
import {
  createBrainContentItem,
  deleteBrainContentItem,
  getBrainContentHistory,
  getBrainContentItem,
  listBrainContentByDomain,
  searchBrainContent,
  updateBrainContentItem,
} from './content-store.js';

function handleError(err: unknown, res: Response): void {
  if (isPlatformError(err)) {
    res
      .status(err.httpStatus)
      .json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

/**
 * Builds a `TenantContext` from request headers. Until the gateway wires a
 * shared session-token-to-context middleware in front of every module
 * (tracked alongside identity-and-tenancy's `/me` endpoint), each module
 * resolves tenant context for itself at the request boundary. Header names
 * mirror the `TenantContext` fields exactly: `x-tenant-id`, `x-user-id`,
 * `x-user-type`, `x-session-id`.
 */
function tenantContextFromRequest(req: Request): TenantContext {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function parseDomainParam(req: Request): BrainDomain {
  const { domain } = req.params;
  if (!isBrainDomain(domain)) {
    throw new ValidationError(
      `domain must be one of company_profile, financial_state, market_and_customers, competitive_landscape, decisions, risks, goals, relationships`,
    );
  }
  return domain;
}

function parseSource(value: unknown): BrainSource {
  if (!isBrainSource(value)) {
    throw new ValidationError(
      'source must be one of founder_edit, agent_extraction, integration_import',
    );
  }
  return value;
}

function parseIdParam(req: Request): string {
  const { id } = req.params;
  if (!id) {
    throw new ValidationError('id path parameter is required');
  }
  return id;
}

export function buildBrainRouter(postgres: PostgresClient): Router {
  const router = Router();

  router.get('/domains/:domain', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const domain = parseDomainParam(req);
      const items = await listBrainContentByDomain(tenantContext, postgres, domain);
      res.status(200).json({ items });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/domains/:domain', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const domain = parseDomainParam(req);
      const body = req.body as {
        language?: unknown;
        content?: unknown;
        contentEn?: unknown;
        source?: unknown;
      };
      if (typeof body.language !== 'string') {
        throw new ValidationError('language is required');
      }
      if (typeof body.content !== 'string') {
        throw new ValidationError('content is required');
      }
      const source = parseSource(body.source);
      const item = await createBrainContentItem(tenantContext, postgres, {
        domain,
        language: body.language,
        content: body.content,
        contentEn: typeof body.contentEn === 'string' ? body.contentEn : null,
        source,
      });
      res.status(201).json(item);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/search', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const q = req.query.q;
      if (typeof q !== 'string') {
        throw new ValidationError('q query parameter is required');
      }
      const items = await searchBrainContent(tenantContext, postgres, q);
      res.status(200).json({ items });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/items/:id/history', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const id = parseIdParam(req);
      const history = await getBrainContentHistory(tenantContext, postgres, id);
      res.status(200).json({ history });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/items/:id', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const id = parseIdParam(req);
      const item = await getBrainContentItem(tenantContext, postgres, id);
      if (!item) {
        res.status(404).json({ error: 'NOT_FOUND', message: `brain content item ${id} not found` });
        return;
      }
      res.status(200).json(item);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.patch('/items/:id', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const id = parseIdParam(req);
      const body = req.body as { content?: unknown; contentEn?: unknown; source?: unknown };
      const source = parseSource(body.source);
      const item = await updateBrainContentItem(tenantContext, postgres, id, {
        content: typeof body.content === 'string' ? body.content : undefined,
        contentEn:
          body.contentEn === null
            ? null
            : typeof body.contentEn === 'string'
              ? body.contentEn
              : undefined,
        source,
      });
      res.status(200).json(item);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/items/:id', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromRequest(req);
      const id = parseIdParam(req);
      const sourceParam = req.query.source ?? req.body?.source;
      const source = parseSource(sourceParam);
      await deleteBrainContentItem(tenantContext, postgres, id, source);
      res.status(204).send();
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
