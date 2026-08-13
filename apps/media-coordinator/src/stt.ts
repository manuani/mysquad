/**
 * Deepgram streaming STT adapter.
 *
 * For a real-time meeting: call createSttSession() when a founder starts
 * speaking, pipe PCM audio chunks to session.sendAudio(), listen for
 * transcript events. The session emits 'transcript' when Deepgram returns
 * a final utterance.
 */
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'node:events';

export interface SttSession extends EventEmitter {
  sendAudio(chunk: Buffer): void;
  close(): void;
}

/**
 * `speechFinal` is Deepgram's endpointing verdict — it believes the utterance
 * ended, as opposed to `isFinal`, which only means the text will not be
 * revised. The distinction is what separates a pause inside a sentence from the
 * end of a turn; see turn-detector.ts.
 */
export type OnTranscript = (text: string, isFinal: boolean, speechFinal: boolean) => void;

/** Fired when silence exceeds `utterance_end_ms` server-side. */
export type OnUtteranceEnd = () => void;

export interface SttClient {
  startSession(onTranscript: OnTranscript, onUtteranceEnd?: OnUtteranceEnd): SttSession;
}

export function createSttClient(apiKey: string | undefined): SttClient {
  if (!apiKey) {
    // Stub: emit nothing — typed mode transcript comes via API
    return {
      startSession() {
        const emitter = new EventEmitter() as SttSession;
        emitter.sendAudio = () => {};
        emitter.close = () => {};
        return emitter;
      },
    };
  }

  const deepgram = createClient(apiKey);

  const DG_OPTS = {
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1000,
    vad_events: true,
    // No encoding/sample_rate — browser sends WebM/Opus, Deepgram auto-detects
  } as const;

  return {
    startSession(onTranscript, onUtteranceEnd) {
      const emitter = new EventEmitter() as SttSession;
      let closed = false;
      let conn: ReturnType<typeof deepgram.listen.live> | null = null;
      let connOpen = false;
      let reconnectDelay = 1000;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let lastAudioAt = 0;
      // The browser sends a containerised stream (WebM/Opus from MediaRecorder,
      // or WAV in tests). The very first chunk carries the container header —
      // without it Deepgram cannot decode anything that follows and drops the
      // socket, which used to produce an endless open/close reconnect loop.
      // So: keep the header, buffer audio that arrives before the socket is
      // open, and replay the header first on every reconnect.
      let header: Buffer | null = null;
      let pending: Buffer[] = [];

      const send = (c: ReturnType<typeof deepgram.listen.live>, chunk: Buffer): void => {
        c.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
      };

      function connect() {
        if (closed) return;
        const c = deepgram.listen.live(DG_OPTS);
        conn = c;
        connOpen = false;

        c.on(LiveTranscriptionEvents.Open, () => {
          connOpen = true;
          reconnectDelay = 1000; // reset backoff on success
          console.log(JSON.stringify({ level: 'info', msg: 'deepgram-open' }));
          // Replay the container header, then flush anything buffered while
          // the socket was connecting.
          if (header && !pending.includes(header)) send(c, header);
          for (const chunk of pending) send(c, chunk);
          pending = [];
        });

        c.on(LiveTranscriptionEvents.Transcript, (data) => {
          const alt = data.channel?.alternatives?.[0];
          if (!alt) return;
          const text: string = alt.transcript ?? '';
          const isFinal: boolean = data.is_final ?? false;
          const speechFinal: boolean = data.speech_final ?? false;
          if (text.trim()) {
            console.log(
              JSON.stringify({ level: 'info', msg: 'deepgram-transcript', text, isFinal, speechFinal }),
            );
          }
          // Empty finals still matter: they carry the endpointing signal that
          // tells the turn detector speech has stopped.
          if (text.trim() || isFinal) onTranscript(text, isFinal, speechFinal);
        });

        c.on(LiveTranscriptionEvents.UtteranceEnd, () => {
          console.log(JSON.stringify({ level: 'info', msg: 'deepgram-utterance-end' }));
          onUtteranceEnd?.();
        });

        const scheduleReconnect = () => {
          conn = null;
          connOpen = false;
          if (closed) return;
          // Don't reconnect if no audio has arrived recently (idle session)
          if (Date.now() - lastAudioAt > 30_000) {
            console.log(JSON.stringify({ level: 'info', msg: 'deepgram-idle-no-reconnect' }));
            return;
          }
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
          reconnectTimer = setTimeout(connect, reconnectDelay);
        };

        c.on(LiveTranscriptionEvents.Close, scheduleReconnect);
        c.on(LiveTranscriptionEvents.Error, () => { c.finish(); scheduleReconnect(); });
      }

      // Lazy connect — open Deepgram only when audio actually arrives
      emitter.sendAudio = (chunk: Buffer) => {
        if (closed) return;
        lastAudioAt = Date.now();
        header ??= chunk; // first chunk of the stream carries the container header
        if (!conn) connect();
        if (connOpen) {
          send(conn!, chunk);
        } else {
          // Socket still connecting — buffer rather than drop, or we lose the
          // header and every later chunk becomes undecodable.
          pending.push(chunk);
          if (pending.length > 200) pending.splice(0, pending.length - 200); // cap ~50s
        }
      };

      emitter.close = () => {
        closed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        pending = [];
        conn?.finish();
        conn = null;
      };

      return emitter;
    },
  };
}
