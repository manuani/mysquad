/**
 * @voai/audit — append-only audit log
 *
 * Exposes:
 *   recordAuditEvent() — write a single audit row
 *   auditMiddleware()  — Express middleware that auto-logs every mutating
 *                        request after the response is sent
 */

export {
  recordAuditEvent,
  type AuditEvent,
  type AuditOutcome,
  type AuditActorType,
} from './audit.js';
export { auditMiddleware } from './middleware.js';
