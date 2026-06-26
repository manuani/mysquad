# @voai/media-coordinator

Media coordinator pool — one of the five process types in System
Architecture §3.7 (verification backlog Issue 4).

## Status

**Not yet scaffolded.** Placeholder workspace. Real entrypoint lands with
Phase 2 (the real-time meeting pipeline) — WebRTC/LiveKit session
coordination, STT/TTS streaming orchestration, and the real-time
hand-raise detection path.

## Why it's separate from the API server

Real-time media handling has different scaling and latency
characteristics than request/response API traffic (P95 hand-raise to
first agent audio < 1.5s, per Platform Specification §13.2) and should
scale independently of the API server pool — more concurrent meetings
need more media coordinator capacity, not necessarily more API server
capacity.

## When this is built

Phase 2 — Real-time meeting pipeline (`services/meeting`,
`services/agent-runtime` land alongside this).
