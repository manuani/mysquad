import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Router } from 'express';
import type { Logger } from '@voai/types';

// Mock livekit-server-sdk before importing publisher
const mockCreateIngress = vi.fn();
vi.mock('livekit-server-sdk', () => ({
  IngressClient: class {
    createIngress = mockCreateIngress;
  },
  IngressInput: { URL_INPUT: 2 },
}));

const { createWhipPublisher } = await import('../src/whip-publisher.js');

function makeRouter(): Router {
  const routes: Map<string, (req: unknown, res: unknown) => void> = new Map();
  const stack: Array<{ route?: { path: string } }> = [];

  const router = {
    get(path: string, handler: (req: unknown, res: unknown) => void) {
      routes.set(path, handler);
      stack.push({ route: { path } });
    },
    stack,
    _routes: routes,
  } as unknown as Router & { _routes: Map<string, (req: unknown, res: unknown) => void> };

  return router;
}

function makeLog(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('createWhipPublisher', () => {
  beforeEach(() => {
    mockCreateIngress.mockReset();
    mockCreateIngress.mockResolvedValue({ ingressId: 'ingress-abc' });
  });

  it('calls IngressClient.createIngress with URL_INPUT and correct params', async () => {
    const router = makeRouter();
    const publisher = createWhipPublisher({
      livekitUrl: 'wss://test.livekit.cloud',
      livekitApiKey: 'key',
      livekitApiSecret: 'secret',
      router,
      log: makeLog(),
    });

    const ingressId = await publisher.publishAudio({
      roomName: 'room-1',
      participantIdentity: 'sarah-cfo',
      participantName: 'Sarah Chen',
      audioBuffer: Buffer.from('mp3data'),
      selfBaseUrl: 'http://localhost:3001',
    });

    expect(ingressId).toBe('ingress-abc');
    expect(mockCreateIngress).toHaveBeenCalledWith(
      2, // IngressInput.URL_INPUT
      expect.objectContaining({
        roomName: 'room-1',
        participantIdentity: 'sarah-cfo',
        participantName: 'Sarah Chen',
        url: expect.stringMatching(/^http:\/\/localhost:3001\/audio-serve\//),
      }),
    );
  });

  it('registers a one-shot GET route that serves the MP3 buffer', async () => {
    const router = makeRouter() as Router & { _routes: Map<string, (req: unknown, res: unknown) => void> };
    const publisher = createWhipPublisher({
      livekitUrl: 'wss://test.livekit.cloud',
      livekitApiKey: 'key',
      livekitApiSecret: 'secret',
      router,
      log: makeLog(),
    });

    const audio = Buffer.from('fake-mp3');
    await publisher.publishAudio({
      roomName: 'room-1',
      participantIdentity: 'sarah-cfo',
      participantName: 'Sarah Chen',
      audioBuffer: audio,
      selfBaseUrl: 'http://mc.example.com',
    });

    // Find the registered route path from the createIngress call
    const calledUrl: string = (mockCreateIngress.mock.calls[0] as [unknown, { url: string }])[1].url;
    const path = new URL(calledUrl).pathname;

    const sentData: Buffer[] = [];
    const fakeRes = {
      setHeader: vi.fn(),
      send: vi.fn((data: Buffer) => sentData.push(data)),
      status: vi.fn().mockReturnThis(),
    };

    const handler = (router as unknown as { _routes: Map<string, (req: unknown, res: unknown) => void> })._routes.get(path);
    expect(handler).toBeDefined();
    handler!({}, fakeRes);

    expect(fakeRes.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
    expect(fakeRes.send).toHaveBeenCalledWith(audio);
  });

  it('returns the ingressId from LiveKit', async () => {
    mockCreateIngress.mockResolvedValueOnce({ ingressId: 'ing-xyz-789' });
    const publisher = createWhipPublisher({
      livekitUrl: 'wss://test.livekit.cloud',
      livekitApiKey: 'key',
      livekitApiSecret: 'secret',
      router: makeRouter(),
      log: makeLog(),
    });

    const id = await publisher.publishAudio({
      roomName: 'r',
      participantIdentity: 'marcus-da',
      participantName: 'Marcus Webb',
      audioBuffer: Buffer.from('x'),
      selfBaseUrl: 'http://mc.example.com',
    });

    expect(id).toBe('ing-xyz-789');
  });

  it('propagates IngressClient errors', async () => {
    mockCreateIngress.mockRejectedValueOnce(new Error('LiveKit unreachable'));
    const publisher = createWhipPublisher({
      livekitUrl: 'wss://test.livekit.cloud',
      livekitApiKey: 'key',
      livekitApiSecret: 'secret',
      router: makeRouter(),
      log: makeLog(),
    });

    await expect(
      publisher.publishAudio({
        roomName: 'r',
        participantIdentity: 'priya-cmo',
        participantName: 'Priya Reddy',
        audioBuffer: Buffer.from('x'),
        selfBaseUrl: 'http://mc.example.com',
      }),
    ).rejects.toThrow('LiveKit unreachable');
  });
});
