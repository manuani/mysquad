/**
 * VoAI Scheduler — cron job runner.
 *
 * Runs as a separate process (port 3002 for health checks) alongside the
 * api-server. Currently registered jobs:
 *
 *   morning-briefing   — 0 8 * * *  (08:00 UTC daily)
 *
 * Future jobs (wired when credentials are available):
 *   metering-rollup    — 0 * * * *  (hourly token aggregation)
 *   expert-reminder    — 0 9 * * 1  (Monday morning expert session reminders)
 */

import { createLogger } from '@voai/telemetry';
import { CronRunner, parseCron } from './cron.js';
import { createMorningBriefingJob } from './jobs/morning-briefing.js';
import express from 'express';

const log = createLogger({ level: 'info', service: 'scheduler', bindings: {} });

const API_SERVER_URL = process.env['API_SERVER_URL'] ?? 'http://localhost:3000';
const SCHEDULER_SECRET = process.env['SCHEDULER_SECRET'] ?? 'dev-scheduler-secret';
const PORT = parseInt(process.env['SCHEDULER_PORT'] ?? '3002', 10);

const runner = new CronRunner();

runner.register({
  name: 'morning-briefing',
  expression: parseCron('0 8 * * *'),
  handler: createMorningBriefingJob({ apiServerUrl: API_SERVER_URL, schedulerSecret: SCHEDULER_SECRET }, log),
});

runner.start((job, err) => {
  log.error('cron job failed', { job: job.name, err: err.message });
});

log.info('cron runner started', { jobs: runner.jobNames });

// Health probe HTTP server
const app = express();
app.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy', jobs: runner.jobNames });
});
app.post('/run/:name', async (req, res) => {
  const secret = req.header('x-scheduler-secret');
  if (secret !== SCHEDULER_SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    await runner.runNow(req.params['name'] ?? '');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  log.info('scheduler health server listening', { port: PORT });
});

process.on('SIGTERM', () => {
  runner.stop();
  log.info('scheduler stopped');
  process.exit(0);
});
