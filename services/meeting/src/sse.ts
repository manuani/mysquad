/**
 * SseManager — tracks live SSE connections per meeting session.
 *
 * One instance is created per process in meeting/index.ts and passed to the
 * router. When the meeting module subscribes to `raise-hand` events on the
 * EventBus, it calls `sseManager.emit()` to fan out to every connected
 * browser tab watching that session.
 *
 * Intentionally simple: no heartbeat, no reconnect token. Browsers reconnect
 * automatically on drop; the EventSource API handles that transparently.
 */

import type { Response } from 'express';

export class SseManager {
  private readonly clients = new Map<string, Set<Response>>();

  /** Register a new SSE response for the given session. */
  add(sessionId: string, res: Response): void {
    let bucket = this.clients.get(sessionId);
    if (!bucket) {
      bucket = new Set();
      this.clients.set(sessionId, bucket);
    }
    bucket.add(res);
  }

  /** Remove an SSE response (called on client disconnect). */
  remove(sessionId: string, res: Response): void {
    const bucket = this.clients.get(sessionId);
    if (!bucket) return;
    bucket.delete(res);
    if (bucket.size === 0) this.clients.delete(sessionId);
  }

  /** Push an SSE event to every client watching `sessionId`. */
  emit(sessionId: string, eventType: string, payload: unknown): void {
    const bucket = this.clients.get(sessionId);
    if (!bucket || bucket.size === 0) return;
    const line = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of bucket) {
      res.write(line);
    }
  }

  /** Number of live connections for a session (useful for logging). */
  connectionCount(sessionId: string): number {
    return this.clients.get(sessionId)?.size ?? 0;
  }
}
