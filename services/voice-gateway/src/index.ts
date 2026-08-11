/**
 * Voice Gateway module — LiveKit room lifecycle and AI bot orchestration.
 *
 * Mounts at /v1/voice-gateway.
 *
 * When LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set,
 * a stub client is used so the rest of the platform continues to boot.
 * Voice endpoints will return stub data.
 */

import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import { buildVoiceGatewayRouter } from './routes.js';
import { createLiveKitClient, createStubLiveKitClient } from './livekit-client.js';

export { buildVoiceGatewayRouter } from './routes.js';
export { createLiveKitClient, createStubLiveKitClient } from './livekit-client.js';

const voiceGatewayModule: ModuleDefinition = {
  name: 'voice-gateway',

  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const livekitUrl = process.env['LIVEKIT_URL'];
    const livekitApiKey = process.env['LIVEKIT_API_KEY'];
    const livekitApiSecret = process.env['LIVEKIT_API_SECRET'];
    const mediaCoordinatorUrl =
      process.env['MEDIA_COORDINATOR_URL'] ?? 'http://localhost:3001';

    const isVoiceReady = Boolean(livekitUrl && livekitApiKey && livekitApiSecret);

    const livekit =
      isVoiceReady
        ? createLiveKitClient({
            url: livekitUrl!,
            apiKey: livekitApiKey!,
            apiSecret: livekitApiSecret!,
          })
        : createStubLiveKitClient();

    if (!isVoiceReady) {
      ctx.logger.warn('voice-gateway: LiveKit credentials not set — using stub client', {
        missing: [
          !livekitUrl && 'LIVEKIT_URL',
          !livekitApiKey && 'LIVEKIT_API_KEY',
          !livekitApiSecret && 'LIVEKIT_API_SECRET',
        ].filter(Boolean),
      });
    }

    const router = buildVoiceGatewayRouter({ livekit, mediaCoordinatorUrl, log: ctx.logger });

    return {
      name: 'voice-gateway',
      router,
      async health() {
        return isVoiceReady
          ? { status: 'healthy' as const }
          : { status: 'degraded' as const, reason: 'LiveKit credentials not configured' };
      },
      async shutdown() {},
    };
  },
};

export default voiceGatewayModule;
