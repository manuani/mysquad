/**
 * Dependency probes for module health checks.
 *
 * Every module used to report a hardcoded `{ status: 'healthy' }`, so
 * `GET /healthz` stayed green while Postgres was down — the one moment the
 * check exists for. A health check that cannot fail is worse than none: it
 * reports success to load balancers and deploy gates during a real outage.
 *
 * Modules declare the stores they actually depend on and each is probed
 * concurrently. Unreachable dependencies are reported by name, so the response
 * says which store is down rather than just that something is.
 */

import type { HealthStatus } from '@voai/types';
import type { Neo4jClient, PostgresClient, RedisClient } from './index.js';

/** The stores a module can depend on. Pass only the ones it actually uses. */
export interface HealthDependencies {
  readonly postgres?: PostgresClient;
  readonly neo4j?: Neo4jClient;
  readonly redis?: RedisClient;
}

/**
 * A probe must not outlive the health request itself. Without a bound, a
 * dependency that accepts connections but never answers would hang /healthz
 * instead of reporting the outage.
 */
const PROBE_TIMEOUT_MS = 2_000;

async function withTimeout(name: string, probe: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} did not respond within ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probes each supplied dependency and reports the aggregate.
 *
 * Returns `unhealthy` when any dependency is unreachable: a module cannot
 * serve requests without its datastore, so there is no meaningful degraded
 * state here. Callers wanting partial availability should probe the optional
 * dependency separately and map the result themselves.
 */
/**
 * Turns a thrown value into something a human reading /healthz can act on.
 *
 * Node's connection failures arrive as an `AggregateError` whose `message` is
 * empty and whose detail sits in `code` and `errors[]` — one entry per address
 * tried. Reporting `err.message` alone yields "postgres: " and says nothing.
 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const code = (err as { code?: string }).code;
  if (err.message) return code ? `${err.message} (${code})` : err.message;

  const causes = (err as { errors?: unknown[] }).errors;
  if (Array.isArray(causes) && causes.length > 0) {
    const detail = causes
      .map((c) => (c instanceof Error ? c.message : String(c)))
      .filter(Boolean)
      .join(', ');
    if (detail) return detail;
  }

  return code ?? err.name;
}

export async function checkDependencies(deps: HealthDependencies): Promise<HealthStatus> {
  const probes: Array<{ name: string; run: Promise<void> }> = [];
  if (deps.postgres) probes.push({ name: 'postgres', run: deps.postgres.ping() });
  if (deps.neo4j) probes.push({ name: 'neo4j', run: deps.neo4j.ping() });
  if (deps.redis) probes.push({ name: 'redis', run: deps.redis.ping() });

  if (probes.length === 0) return { status: 'healthy' };

  const settled = await Promise.allSettled(
    probes.map(({ name, run }) => withTimeout(name, run)),
  );

  const failures = settled.flatMap((result, i) =>
    result.status === 'rejected' ? [`${probes[i]!.name}: ${describe(result.reason)}`] : [],
  );

  return failures.length === 0
    ? { status: 'healthy' }
    : { status: 'unhealthy', reason: failures.join('; ') };
}
