/**
 * The contract every service module exposes to the API gateway and to its peers.
 *
 * The platform is a modular monolith (per System Architecture v1, preserved in v2):
 * a single Node process boots, calls `register()` on each module, and the gateway
 * mounts the resulting router. Modules talk to each other through their typed
 * service exports — never by reaching into another module's internals.
 *
 * This file is the source of truth for that contract.
 */

import type { Router } from 'express';

/**
 * A handle the platform receives back from a module after registration.
 *
 * `router` is the HTTP surface the API gateway mounts at the module's mount path.
 * `health` is a per-module health probe surfaced through the platform's
 * `/healthz` endpoint.
 * `shutdown` runs on SIGTERM and lets the module flush state and close
 * connections cleanly.
 */
export interface ModuleHandle {
  readonly name: string;
  readonly router: Router;
  readonly health: () => Promise<HealthStatus>;
  readonly shutdown: () => Promise<void>;
}

/**
 * The dependencies the platform injects into every module at registration time.
 *
 * Modules do NOT instantiate database clients, telemetry, or config on their own.
 * They receive these from the platform so that test and staging environments can
 * inject doubles, and so that there is exactly one connection pool per process.
 */
export interface ModuleContext {
  readonly config: PlatformConfig;
  readonly logger: Logger;
  readonly db: DatabaseClients;
  readonly events: EventBus;
}

export interface ModuleDefinition {
  readonly name: string;
  readonly register: (ctx: ModuleContext) => Promise<ModuleHandle>;
}

export type HealthStatus =
  | { status: 'healthy' }
  | { status: 'degraded'; reason: string }
  | { status: 'unhealthy'; reason: string };

// Forward-declared shapes filled in by the relevant packages.
// Concrete implementations live in @voai/config, @voai/telemetry, @voai/db, @voai/events.
// Defined here as interfaces so every module can depend on the contract without
// circular dependencies on the implementing packages.

export interface PlatformConfig {
  readonly env: 'development' | 'staging' | 'production' | 'test';
  readonly region: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface DatabaseClients {
  readonly postgres: unknown; // pg.Pool — typed concretely in @voai/db
  readonly neo4j: unknown; // neo4j.Driver — typed concretely in @voai/db
  readonly redis: unknown; // ioredis.Redis — typed concretely in @voai/db
}

export interface EventBus {
  publish(event: PlatformEvent): Promise<void>;
  subscribe<T extends PlatformEvent>(
    eventType: T['type'],
    handler: (event: T) => Promise<void>,
  ): void;
}

export interface PlatformEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly payload: unknown;
}
