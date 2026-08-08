/**
 * LiveKit room management — wraps livekit-server-sdk.
 *
 * Responsible for:
 *   - Creating/deleting rooms
 *   - Issuing short-lived access tokens for human participants
 *   - Issuing bot tokens for the media-coordinator AI participant
 */

import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';

export interface LiveKitConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export interface RoomInfo {
  readonly name: string;
  readonly numParticipants: number;
  readonly creationTime: number;
  readonly sid: string;
}

export interface ParticipantToken {
  readonly token: string;
  readonly wsUrl: string;
  readonly identity: string;
  readonly roomName: string;
}

export interface LiveKitClient {
  createRoom(roomName: string, emptyTimeoutSeconds?: number): Promise<RoomInfo>;
  deleteRoom(roomName: string): Promise<void>;
  listRooms(): Promise<RoomInfo[]>;
  issueToken(opts: {
    roomName: string;
    identity: string;
    displayName: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
    ttlSeconds?: number;
  }): Promise<ParticipantToken>;
}

export function createLiveKitClient(cfg: LiveKitConfig): LiveKitClient {
  const svc = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);

  return {
    async createRoom(roomName, emptyTimeoutSeconds = 300): Promise<RoomInfo> {
      const room = await svc.createRoom({ name: roomName, emptyTimeout: emptyTimeoutSeconds });
      return {
        name: room.name,
        numParticipants: room.numParticipants,
        creationTime: Number(room.creationTime),
        sid: room.sid,
      };
    },

    async deleteRoom(roomName): Promise<void> {
      await svc.deleteRoom(roomName);
    },

    async listRooms(): Promise<RoomInfo[]> {
      const rooms = await svc.listRooms();
      return rooms.map((r) => ({
        name: r.name,
        numParticipants: r.numParticipants,
        creationTime: Number(r.creationTime),
        sid: r.sid,
      }));
    },

    async issueToken({ roomName, identity, displayName, canPublish = true, canSubscribe = true, ttlSeconds = 3600 }): Promise<ParticipantToken> {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: displayName,
        ttl: `${ttlSeconds}s`,
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish,
        canSubscribe,
        canPublishData: true,
      });
      const token = await at.toJwt();
      return { token, wsUrl: cfg.url, identity, roomName };
    },
  };
}

/** Stub for when LiveKit credentials are not configured. */
export function createStubLiveKitClient(): LiveKitClient {
  return {
    async createRoom(roomName) {
      return { name: roomName, numParticipants: 0, creationTime: Date.now(), sid: `stub-${roomName}` };
    },
    async deleteRoom() {},
    async listRooms() { return []; },
    async issueToken({ roomName, identity }) {
      return { token: 'stub-token', wsUrl: 'ws://localhost:7880', identity, roomName };
    },
  };
}
