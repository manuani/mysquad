# @voai/scheduler

Scheduled job runner — one of the five process types in System
Architecture §3.7 (verification backlog Issue 4).

## Status

**Not yet scaffolded.** Placeholder workspace. Real entrypoint lands when
the first time-triggered workload needs it — the morning briefing
generation (Platform Specification §7.1, default 8:00 AM founder-local),
outcome-logging reminders at the 6-8 week decision window, decay-flag
detection sweeps, and similar cron-shaped work.

## Why it's separate from the API server and the worker pool

Scheduled jobs are triggered by time, not by an inbound request or a
queued job message — a different runtime concern from both the API
server pool and the background worker pool, even though all three may
end up calling the same service modules' typed exports to do their work.

## When this is built

First populated whenever the first time-triggered deliverable lands (the
morning briefing is the most likely first tenant — see Sprint Plan,
Phase 4 onwards, for exact timing).
