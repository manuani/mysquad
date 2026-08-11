# ADR 013: Browser-side audio capture and TTS delivery

- Status: Accepted
- Date: 2026-08-11
- Deciders: lead engineer, founder

## Context

Architecture v2 §5.4–5.6 specifies the real-time audio pipeline: the media
coordinator opens a **server-side connection to each meeting room**, receives
every participant's audio from the SFU as Opus chunks, feeds it to STT, and
publishes agent contributions back **as a virtual participant mixed at the SFU
level** with streaming TTS (§5.6.3, first audio 400–700 ms after the first LLM
token).

Building it, three constraints bit:

1. **Browser capture fights the WebRTC engine.** With a LiveKit track publishing,
   `ScriptProcessorNode` returns silent buffers, `AnalyserNode` re-reads a stale
   ring buffer, and `AudioWorklet` repeats frames off the shared hardware mic
   buffer. Each produced garbled transcripts — "Brianna" for "Priya", "product
   product product". Chrome's echo canceller also treats the speaker's own voice
   as echo and cancels it to near silence.
2. **LiveKit URL ingress cannot reach `localhost`.** Publishing agent audio via
   ingress requires a publicly reachable URL for LiveKit Cloud to fetch. In local
   development there is none, so the spec's SFU-mixing path is silent — the exact
   path a developer needs to exercise most often.
3. **Server-side SFU subscription is a much larger build.** It needs the media
   coordinator to hold a LiveKit connection per room, decode Opus server-side,
   and manage per-participant track lifecycles.

The platform had no working voice path at all. The question was what to build
first, not what the eventual architecture should be.

## Options considered

### Option A — implement §5.4–5.6 as written

Server-side SFU subscription, Opus decode, streaming TTS, SFU-level mixing.
Matches the spec and gives per-participant diarisation "by construction" (§5.4).
Largest build; blocked in local dev by constraint 2 without a tunnel or a
deployed environment for every change.

### Option B — browser captures and streams; TTS returns over the same socket

Browser captures with `MediaRecorder` (WebM/Opus, 250 ms slices) and streams to
the media coordinator over a WebSocket. Contributions are synthesised whole and
returned as base64 MP3 on that socket, played client-side. Works identically in
local dev and deployed. Diverges from the spec on transport, diarisation source,
and TTS streaming.

### Option C — browser capture, but keep SFU publish for TTS

Capture as in B, publish agent audio through LiveKit ingress as the spec says.
Keeps agents audible to every participant, but leaves local dev silent — the
problem that motivated this work.

## Decision

**Option B**, with the LiveKit ingress path (`whip-publisher`, `ingressId`) left
wired and dormant so Option C remains a configuration change rather than a
rewrite.

## Rationale

A voice feature nobody can run locally does not get iterated on. Option B made
the pipeline exercisable end to end in one process pair, which is what surfaced
the container-header bug (see Consequences) that would have hit the spec'd
architecture too.

`MediaRecorder` sidesteps the shared-buffer problem entirely rather than working
around it: it does not read through Web Audio, so it cannot contend with the
WebRTC engine for the hardware mic buffer. AEC/NS/AGC are disabled explicitly on
the STT stream because the LiveKit track handles echo for the meeting audio, and
applying it twice cancels the speaker.

Diarisation is not lost at v1 because the founder is the only human speaker in a
meeting with three AI advisors — the spec's per-track diarisation matters when
multiple humans join, which is when Option C becomes necessary.

## Consequences

Easier:

- The whole path runs on a laptop with no tunnel: `pnpm verify:voice` drives a
  WAV file through Deepgram, the advisors, and ElevenLabs, and asserts audio
  comes back.
- No server-side Opus decoding or per-room connection lifecycle to manage.

Harder / now owed:

- **Multi-human meetings need Option C.** Guest browser join (§2.1) will require
  server-side SFU subscription for per-participant tracks. This ADR does not
  deliver that.
- **TTS is not streaming.** Contributions are synthesised whole, so an advisor
  starts speaking after generation completes rather than 400–700 ms in (§5.6.3).
  Latency is visibly worse than the spec targets on long replies.
- **Agent audio is heard only by the local client**, not mixed into the room, so
  a second participant would not hear advisors until Option C lands.
- Base64 over WebSocket is ~33% larger than binary and reached 1.4 MB for a long
  contribution. Acceptable at three advisors; not a pattern to scale.

Committed and awkward to reverse: the browser is now the STT capture point, so
any client that joins a meeting must implement capture rather than relying on
the server observing the room.

### Bug this surfaced

Deepgram receives a containerised stream, and the **first chunk carries the WebM
header**. An earlier lazy-connect dropped chunks that arrived before the socket
opened, so Deepgram could not decode anything that followed, closed the
connection, and the session span an endless open/close reconnect loop. The STT
layer now retains the header and replays it on every reconnect. Any transport
carrying a containerised stream has this failure mode, including the spec'd one.

## Revisit triggers

- Guest browser join or any second human participant is scheduled — Option C
  becomes required, not optional.
- Time-to-first-audio becomes a product complaint, which means implementing
  streaming TTS per §5.6.3.
- A deployed environment with a publicly reachable `selfBaseUrl` becomes the
  default development target, removing constraint 2.
