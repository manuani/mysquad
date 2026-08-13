/**
 * Voice pipeline orchestrator.
 *
 * Lifecycle for one meeting session in voice mode:
 *   1. Founder audio → Deepgram STT → transcript text
 *   2. Transcript text → agent-runtime /contributions/roster (with sessionId)
 *   3. Each contribution text → ElevenLabs TTS → audio buffer
 *   4. Audio buffer → LiveKit URL ingress → published as room track
 *
 * This module is stateless — one PipelineSession per meeting session.
 * The media-coordinator routes create and hold PipelineSessions.
 */

import type { SttClient, SttSession } from './stt.js';
import type { TtsClient } from './tts.js';
import type { WhipPublisher } from './whip-publisher.js';
import { voiceForPersona } from './voice-personas.js';
import { createTurnDetector } from './turn-detector.js';

export interface PipelineContribution {
  readonly agentName: string;
  readonly role: string;
  readonly text: string;
  readonly audio: Buffer | null;
  readonly rank: number;
  /** LiveKit ingress ID, set when audio was published to the room. Null when LiveKit is not configured. */
  readonly ingressId: string | null;
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
  /** When provided, each TTS buffer is published into the LiveKit room. */
  readonly livekitRoomName?: string;
  readonly publisher?: WhipPublisher;
  readonly selfBaseUrl?: string;
  /**
   * Silence after speech appears to end before the turn is dispatched.
   * Defaults to the turn detector's own value; exposed for tuning against real
   * conversations, where the right pause length is a feel judgement.
   */
  readonly turnSettleMs?: number;
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
            let audio: Buffer | null = null;
            if (voice) {
              try {
                audio = await tts.synthesise(c.contribution.content, voice.elevenLabsVoiceId);
              } catch (ttsErr) {
                opts.onError(ttsErr instanceof Error ? ttsErr : new Error(String(ttsErr)));
              }
            }

            // Publish audio into the LiveKit room when all three are configured.
            let ingressId: string | null = null;
            if (audio && opts.publisher && opts.livekitRoomName && opts.selfBaseUrl) {
              try {
                ingressId = await opts.publisher.publishAudio({
                  roomName: opts.livekitRoomName,
                  participantIdentity: voice?.personaId ?? c.agentName.toLowerCase().replace(/\s+/g, '-'),
                  participantName: c.agentName,
                  audioBuffer: audio,
                  selfBaseUrl: opts.selfBaseUrl,
                });
              } catch (publishErr) {
                // Non-fatal — text contribution still delivered; caller gets audio buffer too.
                opts.onError(
                  publishErr instanceof Error ? publishErr : new Error(String(publishErr)),
                );
              }
            }

            return {
              agentName: c.agentName,
              role: c.role,
              text: c.contribution.content,
              audio,
              rank: c.rank,
              ingressId,
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

  // Dispatch on end of turn, not on every stable segment. `is_final` fires on
  // the pauses inside a sentence, so answering it meant replying to half a
  // thought — "should we cut the marketing budget" got an answer while the
  // founder was still saying "or raise a bridge round?".
  const turns = createTurnDetector({
    settleMs: opts.turnSettleMs ?? undefined,
    onTurnComplete: (text) => {
      pendingTranscript = text;
      void processUtterance(text);
    },
  });

  const sttSession: SttSession = stt.startSession(
    (text, isFinal, speechFinal) => {
      // The live transcript still updates on every segment — the founder should
      // see their words appear as they speak, even though the advisors wait.
      if (text.trim()) opts.onTranscriptChunk(text, isFinal);
      turns.onTranscript(text, isFinal, speechFinal);
    },
    () => turns.onUtteranceEnd(),
  );

  return {
    sendAudio(chunk: Buffer): void {
      sttSession.sendAudio(chunk);
    },
    close(): void {
      // Anything still buffered is speech the founder finished but no silence
      // followed — losing it would drop their last sentence.
      turns.flush();
      turns.close();
      sttSession.close();
    },
  };
}
