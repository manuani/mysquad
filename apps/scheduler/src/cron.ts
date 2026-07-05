/**
 * Lightweight cron runner.
 *
 * Registers named jobs with a cron expression and an async handler.
 * Uses setInterval polling at 1-minute resolution — sufficient for
 * the current job set (morning briefing, digest, metering rollup).
 *
 * No external cron library required: we own the full job lifecycle,
 * avoid binary dependencies, and stay pure ESM.
 */

export interface CronJob {
  readonly name: string;
  readonly expression: CronExpression;
  readonly handler: () => Promise<void>;
}

/**
 * A parsed cron expression supporting the fields we use:
 * minute, hour, dayOfMonth, month, dayOfWeek.
 * Supports '*' (any), and comma-separated values.
 */
export interface CronExpression {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    throw new Error(`invalid cron expression: "${expression}" (need 5 fields)`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true;
  return field.split(',').some((v) => parseInt(v, 10) === value);
}

export function shouldRun(expr: CronExpression, now: Date): boolean {
  return (
    matchField(expr.minute, now.getUTCMinutes()) &&
    matchField(expr.hour, now.getUTCHours()) &&
    matchField(expr.dayOfMonth, now.getUTCDate()) &&
    matchField(expr.month, now.getUTCMonth() + 1) &&
    matchField(expr.dayOfWeek, now.getUTCDay())
  );
}

export class CronRunner {
  private readonly jobs: CronJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  register(job: CronJob): void {
    this.jobs.push(job);
  }

  start(onError?: (job: CronJob, err: Error) => void): void {
    if (this.timer) return;
    // Tick at the top of each minute (poll every 60s)
    const tick = () => {
      const now = new Date();
      for (const job of this.jobs) {
        if (shouldRun(job.expression, now)) {
          job.handler().catch((err: unknown) => {
            onError?.(job, err instanceof Error ? err : new Error(String(err)));
          });
        }
      }
    };
    // Align first tick to the top of the next minute
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      tick();
      this.timer = setInterval(tick, 60_000);
    }, msUntilNextMinute);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a named job immediately (for testing or manual trigger). */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`no job named "${name}"`);
    await job.handler();
  }

  get jobNames(): readonly string[] {
    return this.jobs.map((j) => j.name);
  }
}
