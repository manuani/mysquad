/**
 * Voice pipeline configuration — reads from environment variables.
 * All voice fields are optional; when absent, voice mode gracefully degrades.
 */
export interface VoiceConfig {
  readonly livekitUrl: string;
  readonly livekitApiKey: string;
  readonly livekitApiSecret: string;
  readonly deepgramApiKey: string;
  readonly elevenLabsApiKey: string;
  readonly apiServerUrl: string;
  readonly port: number;
}

export interface VoiceConfigPartial {
  readonly livekitUrl: string | undefined;
  readonly livekitApiKey: string | undefined;
  readonly livekitApiSecret: string | undefined;
  readonly deepgramApiKey: string | undefined;
  readonly elevenLabsApiKey: string | undefined;
  readonly apiServerUrl: string;
  readonly port: number;
  readonly isVoiceReady: boolean;
}

export function loadVoiceConfig(): VoiceConfigPartial {
  const livekitUrl = process.env['LIVEKIT_URL'];
  const livekitApiKey = process.env['LIVEKIT_API_KEY'];
  const livekitApiSecret = process.env['LIVEKIT_API_SECRET'];
  const deepgramApiKey = process.env['DEEPGRAM_API_KEY'];
  const elevenLabsApiKey = process.env['ELEVENLABS_API_KEY'];
  const apiServerUrl = process.env['API_SERVER_URL'] ?? 'http://localhost:3000';
  const port = parseInt(process.env['MEDIA_COORDINATOR_PORT'] ?? '3001', 10);

  const isVoiceReady = Boolean(
    livekitUrl && livekitApiKey && livekitApiSecret && deepgramApiKey && elevenLabsApiKey,
  );

  return {
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    deepgramApiKey,
    elevenLabsApiKey,
    apiServerUrl,
    port,
    isVoiceReady,
  };
}
