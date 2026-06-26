import { describe, expect, it, vi } from 'vitest';
import { createInProcessEventBus, type PlatformEvent } from '../src/index.js';

interface MeetingEndedEvent extends PlatformEvent<{ meetingId: string }> {
  readonly type: 'meeting.ended';
}

describe('in-process event bus', () => {
  it('delivers events to matching subscribers', async () => {
    const bus = createInProcessEventBus();
    const handler = vi.fn(async () => {});
    bus.subscribe<MeetingEndedEvent>('meeting.ended', handler);

    const event: MeetingEndedEvent = {
      type: 'meeting.ended',
      tenantId: 't1',
      timestamp: '2026-05-03T00:00:00Z',
      payload: { meetingId: 'm1' },
    };
    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('does not propagate handler errors to publisher', async () => {
    const bus = createInProcessEventBus();
    bus.subscribe<MeetingEndedEvent>('meeting.ended', async () => {
      throw new Error('handler failed');
    });
    await expect(
      bus.publish({
        type: 'meeting.ended',
        tenantId: 't1',
        timestamp: '2026-05-03T00:00:00Z',
        payload: { meetingId: 'm1' },
      } as MeetingEndedEvent),
    ).resolves.toBeUndefined();
  });

  it('routes only to handlers for the matching event type', async () => {
    const bus = createInProcessEventBus();
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    bus.subscribe('foo.happened', a);
    bus.subscribe('bar.happened', b);
    await bus.publish({
      type: 'foo.happened',
      tenantId: 't',
      timestamp: 'now',
      payload: null,
    });
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });
});
