/**
 * ElevenLabs TTS — synthesises text to audio buffer.
 * Returns null when ElevenLabs is not configured.
 */
import { ElevenLabsClient } from 'elevenlabs';

export interface TtsClient {
  synthesise(text: string, voiceId: string): Promise<Buffer | null>;
}

export function createTtsClient(apiKey: string | undefined): TtsClient {
  if (!apiKey) {
    return {
      async synthesise(): Promise<null> {
        return null;
      },
    };
  }

  const client = new ElevenLabsClient({ apiKey });

  return {
    async synthesise(text: string, voiceId: string): Promise<Buffer | null> {
      const audio = await client.textToSpeech.convert(voiceId, {
        text,
        model_id: 'eleven_turbo_v2',
        output_format: 'mp3_44100_128',
      });

      const chunks: Buffer[] = [];
      for await (const chunk of audio) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
  };
}
