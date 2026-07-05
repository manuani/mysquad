/**
 * Voice pipeline orchestrator.
 *
 * Lifecycle for one meeting session in voice mode:
 *   1. Founder audio → Deepgram STT → transcript text
 *   2. Transcript text → agent-runtime /contributions/roster (with sessionId)
 *   3. Each contribution text → ElevenLabs TTS → audio buffer
 *   4. Audio buffer returned to caller (LiveKit track publish or HTTP stream)
 *
 * This module is stateless — one PipelineSession per meeting session.
 * The media-coordinator routes create and hold PipelineSessions.
 */

import type { SttClient, SttSession } from './stt.js';
import type { TtsClient } from './tts.js';
import { voiceForPersona } from './voice-personas.js';

export interface PipelineContribution {
  readonly agentName: string;
  readonly role: string;
  readonly text: string;
  readonly audio: Buffer | null;
  readonly rank: number;
}

export interface PipelineSession {
  /** Feed raw audio (linear16 PCM) from the founder's mic. */
  sendAudio(chunk: Buffer): void;
  /** Gracefully shut down STT connection. */
  close(): void;
}

export interface PipelineOptions {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly apiServerUrl: string;
  readonly authHeaders: Record<string, string>;
  readonly onContributions: (contributions: PipelineContribution[]) => void;
  readonly onTranscriptChunk: (text: string, isFinal: boolean) => void;
  readonly onError: (err: Error) => void;
}

export function createPipelineSession(
  stt: SttClient,
  tts: TtsClient,
  opts: PipelineOptions,
): PipelineSession {
  let pendingTranscript = '';
  let processingUtterance = false;

  async function processUtterance(text: string): Promise<void> {
    if (processingUtterance || !text.trim()) return;
    processingUtterance = true;

    try {
      const response = await fetch(`${opts.apiServerUrl}/v1/agent-runtime/contributions/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...opts.authHeaders },
        body: JSON.stringify({ message: text, sessionId: opts.sessionId }),
      });

      if (!response.ok) {
        throw new Error(`agent-runtime returned ${response.status}`);
      }

      const data = (await response.json()) as {
        contributions: Array<{
          agentName: string;
          role: string;
          contribution: { content: string };
          rank: number;
          skipped: boolean;
        }>;
      };

      const contributions = await Promise.all(
        data.contributions
          .filter((c) => !c.skipped && c.contribution?.content)
          .map(async (c): Promise<PipelineContribution> => {
            const voice = voiceForPersona(c.agentName);
            const audio = voice
              ? await tts.synthesise(c.contribution.content, voice.elevenLabsVoiceId)
              : null;

            return {
              agentName: c.agentName,
              role: c.role,
              text: c.contribution.content,
              audio,
              rank: c.rank,
            };
          }),
      );

      opts.onContributions(contributions);
    } catch (err) {
      opts.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      processingUtterance = false;
      pendingTranscript = '';
    }
  }

  const sttSession: SttSession = stt.startSession((text, isFinal) => {
    opts.onTranscriptChunk(text, isFinal);
    if (isFinal) {
      pendingTranscript = text;
      void processUtterance(pendingTranscript);
    }
  });

  return {
    sendAudio(chunk: Buffer): void {
      sttSession.sendAudio(chunk);
    },
    close(): void {
      sttSession.close();
    },
  };
}
