/**
 * LiveKit audio publisher — URL Ingress approach.
 *
 * Why not WHIP?
 * WHIP (WebRTC HTTP Ingest Protocol) requires the client to generate an SDP
 * offer and negotiate ICE candidates. That is the WebRTC client stack — only
 * available via @livekit/rtc-node (native .node binaries) or a browser.
 * Running native binaries in a Fargate container adds significant build
 * complexity (multi-arch .node files, node-gyp in the Docker build stage).
 *
 * Why URL Ingress instead?
 * LiveKit's URL Ingress lets the LiveKit *server* pull media from any
 * HTTP(S) URL that serves a valid audio/video stream. The media-coordinator
 * creates a temporary one-shot HTTP endpoint serving the MP3 buffer, hands
 * that URL to LiveKit's IngressClient, and LiveKit pulls it — no WebRTC
 * client stack required on our side, no native dependencies.
 *
 * Lifecycle per contribution batch:
 *   1. Register a one-shot /audio-serve/:token route on the Express server
 *   2. Call IngressClient.createIngress(URL_INPUT, { url, roomName, participantIdentity })
 *   3. LiveKit fetches the audio, publishes it as a track in the room
 *   4. Route is deregistered after first request or 30-second TTL
 */

import { randomUUID } from 'node:crypto';
import { IngressClient, IngressInput } from 'livekit-server-sdk';
import type { Router } from 'express';
import type { Logger } from '@voai/types';

export interface PublishAudioOpts {
  readonly roomName: string;
  /** Participant identity that will appear in the LiveKit room. e.g. "sarah-cfo" */
  readonly participantIdentity: string;
  readonly participantName: string;
  /** MP3 audio buffer from ElevenLabs */
  readonly audioBuffer: Buffer;
  /** Public base URL of THIS media-coordinator process, reachable by LiveKit */
  readonly selfBaseUrl: string;
}

export interface WhipPublisher {
  /**
   * Publish one MP3 audio buffer into the LiveKit room as a URL ingress.
   * Returns the ingress ID — can be used to delete the ingress after completion.
   */
  publishAudio(opts: PublishAudioOpts): Promise<string>;
}

export interface WhipPublisherDeps {
  readonly livekitUrl: string;
  readonly livekitApiKey: string;
  readonly livekitApiSecret: string;
  /** The Express router to register temporary audio-serve routes on */
  readonly router: Router;
  readonly log: Logger;
}

const SERVE_TTL_MS = 30_000;

export function createWhipPublisher(deps: WhipPublisherDeps): WhipPublisher {
  const { livekitUrl, livekitApiKey, livekitApiSecret, router, log } = deps;
  const ingress = new IngressClient(livekitUrl, livekitApiKey, livekitApiSecret);

  return {
    async publishAudio(opts: PublishAudioOpts): Promise<string> {
      const token = randomUUID();
      const servePath = `/audio-serve/${token}`;
      const serveUrl = `${opts.selfBaseUrl}${servePath}`;

      // Register one-shot route — deregistered after first hit or TTL
      let served = false;
      const ttl = setTimeout(() => {
        if (!served) {
          log.warn('audio-serve TTL expired without request', { token });
          removeRoute(servePath, router);
        }
      }, SERVE_TTL_MS);

      router.get(servePath, (_req, res) => {
        if (served) {
          res.status(410).send('Gone');
          return;
        }
        served = true;
        clearTimeout(ttl);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', String(opts.audioBuffer.length));
        res.send(opts.audioBuffer);
        // Deregister after responding
        setImmediate(() => removeRoute(servePath, router));
        log.debug('audio-serve: served', { token, bytes: opts.audioBuffer.length });
      });

      log.info('creating LiveKit URL ingress', {
        participantIdentity: opts.participantIdentity,
        room: opts.roomName,
        serveUrl,
      });

      const info = await ingress.createIngress(IngressInput.URL_INPUT, {
        roomName: opts.roomName,
        participantIdentity: opts.participantIdentity,
        participantName: opts.participantName,
        url: serveUrl,
        name: `tts-${opts.participantIdentity}-${Date.now()}`,
        // No video — audio-only TTS output
        enableTranscoding: true,
      });

      const ingressId = info.ingressId ?? '';
      log.info('LiveKit URL ingress created', {
        ingressId,
        participantIdentity: opts.participantIdentity,
      });

      return ingressId;
    },
  };
}

/**
 * Remove a dynamically-added route from an Express Router.
 * Express stores routes on router.stack — find by path and splice it out.
 */
function removeRoute(path: string, router: Router): void {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
  const idx = stack.findIndex((layer) => layer.route?.path === path);
  if (idx !== -1) stack.splice(idx, 1);
}
