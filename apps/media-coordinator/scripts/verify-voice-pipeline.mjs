/**
 * End-to-end verification of the voice pipeline against a running stack.
 *
 * Exercises the real path a browser takes:
 *   WAV audio -> MC WebSocket -> Deepgram STT -> agent-runtime -> ElevenLabs TTS
 *
 * This is a live-stack check, not a unit test — it needs api-server (:3000) and
 * media-coordinator (:3001) running with real DEEPGRAM_API_KEY / ANTHROPIC_API_KEY
 * / ELEVENLABS_API_KEY, so it is deliberately kept out of `vitest run`.
 *
 * Usage:
 *   node scripts/verify-voice-pipeline.mjs [path/to/audio.wav]
 *
 * Generate a sample WAV on macOS:
 *   say -o /tmp/s.aiff "We are burning forty thousand a month with six months of runway"
 *   afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/s.aiff /tmp/s.wav
 *
 * Exits 0 when transcripts and contributions both arrive, 1 otherwise.
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const MC = process.env.MC_URL ?? 'http://localhost:3001';
const WAV = process.argv[2] ?? '/tmp/s.wav';
const sessionId = `verify-${Date.now()}`;

const wav = readFileSync(WAV);

const start = await fetch(`${MC}/sessions/${sessionId}/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenantId: process.env.TENANT_ID ?? 'shreesteel',
    userId: 'verify-user',
    sessionToken: 'verify-session',
  }),
});
if (!start.ok) {
  console.error('session start failed:', start.status, await start.text());
  process.exit(1);
}

const ws = new WebSocket(`${MC.replace('http', 'ws')}/sessions/${sessionId}/ws`);
const transcripts = [];
const contributions = [];

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'transcript' && msg.isFinal) {
    transcripts.push(msg.text);
    console.log('TRANSCRIPT:', msg.text);
  } else if (msg.type === 'contributions') {
    for (const c of msg.contributions) {
      contributions.push(c);
      const kb = c.audioMp3 ? Math.round((c.audioMp3.length * 3) / 4 / 1024) : 0;
      console.log(`\n${c.agentName} (${c.role})  [audio: ${kb ? `${kb} KB mp3` : 'NONE'}]`);
      console.log(`  ${c.text.slice(0, 200)}${c.text.length > 200 ? '…' : ''}\n`);
    }
  }
});

ws.on('open', async () => {
  // Stream in ~250ms slices to mimic MediaRecorder timeslicing. The first slice
  // carries the container header — the STT layer replays it across reconnects.
  const CHUNK = 8000; // 16kHz * 16-bit mono = 32000 B/s
  for (let off = 0; off < wav.length; off += CHUNK) {
    ws.send(wav.subarray(off, Math.min(off + CHUNK, wav.length)));
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 20_000)); // let advisors respond

  const withAudio = contributions.filter((c) => c.audioMp3).length;
  console.log('=== RESULT ===');
  console.log(`transcripts:   ${transcripts.length}`);
  console.log(`contributions: ${contributions.length} (${withAudio} with TTS audio)`);

  const pass = transcripts.length > 0 && contributions.length > 0;
  console.log(pass ? 'PASS' : 'FAIL');

  ws.close();
  await fetch(`${MC}/sessions/${sessionId}/end`, { method: 'POST' });
  process.exit(pass ? 0 : 1);
});
