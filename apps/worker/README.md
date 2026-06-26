# @voai/worker

Background worker pool — one of the five process types in System
Architecture §3.7 (verification backlog Issue 4).

## Status

**Not yet scaffolded.** Placeholder workspace. Real entrypoint lands when
the first background-job workload needs it — brain extraction from
uploaded documents, marketplace metering aggregation, performance-signal
evaluation runs, and similar async work that should not run inline in an
HTTP request handler.

## Why it's separate from the API server

`apps/api-server` is the API server pool (§3.7) — request/response, low
latency, no long-running work. Background jobs belong in their own
process so a slow extraction job or a metering batch run cannot starve
API request handling. CLAUDE.md's architecture rules are explicit: don't
bundle worker logic into the API server when this work starts.

## When this is built

First populated whenever the first background-job-shaped deliverable
lands (extraction, metering, evaluation — see Sprint Plan for exact
timing). Until then this directory exists so the process-type boundary
is visible in the repo layout from day one, not retrofitted later.
