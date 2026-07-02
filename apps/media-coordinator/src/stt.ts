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

export interface SttClient {
  startSession(onTranscript: (text: string, isFinal: boolean) => void): SttSession;
}

export function createSttClient(apiKey: string | undefined): SttClient {
  if (!apiKey) {
    // Stub: emit nothing — typed mode transcript comes via API
    return {
      startSession(onTranscript) {
        const emitter = new EventEmitter() as SttSession;
        emitter.sendAudio = () => {};
        emitter.close = () => {};
        return emitter;
      },
    };
  }

  const deepgram = createClient(apiKey);

  return {
    startSession(onTranscript) {
      const emitter = new EventEmitter() as SttSession;

      const connection = deepgram.listen.live({
        model: 'nova-2',
        language: 'en-IN',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        encoding: 'linear16',
        sample_rate: 16000,
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;
        const text: string = alt.transcript ?? '';
        const isFinal: boolean = data.is_final ?? false;
        if (text.trim()) onTranscript(text, isFinal);
      });

      connection.on(LiveTranscriptionEvents.Error, (err) => {
        emitter.emit('error', err);
      });

      emitter.sendAudio = (chunk: Buffer) => {
        // Deepgram's send() expects Blob | ArrayBuffer | string — slice the
        // Node Buffer's underlying ArrayBuffer to the correct byte range.
        connection.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
      };

      emitter.close = () => {
        connection.finish();
      };

      return emitter;
    },
  };
}
