/**
 * Internal event bus.
 *
 * Within the modular monolith, modules communicate via direct typed service
 * calls for synchronous flows and via this event bus for fire-and-forget,
 * cross-module signals.
 *
 * Examples:
 *   - meeting.ended → brain extraction job, ledger EOM extraction job
 *   - contribution.generated → performance signal capture
 *   - meeting.specialist_invoked → marketplace metering meter event
 *
 * v1 implementation: in-process EventEmitter for development; backed by
 * Postgres LISTEN/NOTIFY in staging/production for cross-instance fan-out.
 */

export interface PlatformEvent<TPayload = unknown> {
  readonly type: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly payload: TPayload;
}

// Concrete event types declared by their owning service module.
// Each service exports its own typed events (e.g. MeetingEndedEvent) and the
// platform's event registry is the union of those.

export interface EventBus {
  publish<T extends PlatformEvent>(event: T): Promise<void>;
  subscribe<T extends PlatformEvent>(
    eventType: T['type'],
    handler: (event: T) => Promise<void>,
  ): void;
}

class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<string, Array<(event: PlatformEvent) => Promise<void>>>();

  async publish<T extends PlatformEvent>(event: T): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    // Fire and forget — handler errors logged by handler, not propagated to publisher.
    await Promise.allSettled(handlers.map((h) => h(event)));
  }

  subscribe<T extends PlatformEvent>(
    eventType: T['type'],
    handler: (event: T) => Promise<void>,
  ): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler as (event: PlatformEvent) => Promise<void>);
    this.handlers.set(eventType, list);
  }
}

export function createInProcessEventBus(): EventBus {
  return new InProcessEventBus();
}
