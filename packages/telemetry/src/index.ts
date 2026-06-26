/**
 * Telemetry — structured logging, tracing, metrics.
 *
 * v1 implementation: pino-based JSON logger that writes to stdout. Staging and
 * production deployments scrape stdout into the logging pipeline (CloudWatch,
 * GCP Cloud Logging, or Datadog — selected per Sprint 1.1.3 cloud decision).
 *
 * OpenTelemetry tracing and Prometheus metrics integration land in Phase 8
 * (Sprint 8.1 — Latency optimisation requires per-call tracing to identify
 * P95 bottlenecks).
 */

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  bindings?: Record<string, unknown>;
}

/**
 * Minimal stdout JSON logger. Replace with pino in implementation; the contract
 * stays stable so swapping the backend does not require service changes.
 */
class ConsoleLogger implements Logger {
  private readonly levelOrder: Record<LoggerOptions['level'], number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(private readonly opts: LoggerOptions) {}

  private emit(level: LoggerOptions['level'], msg: string, fields?: Record<string, unknown>): void {
    if (this.levelOrder[level] < this.levelOrder[this.opts.level]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.opts.service,
      msg,
      ...this.opts.bindings,
      ...fields,
    };
    (level === 'error' ? console.error : console.warn)(JSON.stringify(entry));
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.emit('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.emit('error', msg, fields);
  }
  child(fields: Record<string, unknown>): Logger {
    return new ConsoleLogger({
      ...this.opts,
      bindings: { ...this.opts.bindings, ...fields },
    });
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  return new ConsoleLogger(opts);
}
