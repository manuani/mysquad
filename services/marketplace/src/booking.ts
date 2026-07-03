/**
 * Expert session booking — compute available slots from expert_availability
 * windows and create booking records.
 *
 * Cal.com integration: when CALCOM_API_KEY is set, bookings are also
 * created in Cal.com (the expert's calendar). Without it, slots are
 * computed from the local availability windows only (graceful degradation).
 *
 * Booking flow:
 *   1. GET /experts/:id/slots?date=YYYY-MM-DD → available 30-min slots
 *   2. POST /experts/:id/book { slotStart, founderEmail, topic } → booking
 *   3. If Cal.com configured: create booking in Cal.com via API
 *   4. Expert and founder receive confirmation (SMTP or Cal.com email)
 */

import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';
import { ValidationError } from '@voai/errors';

export interface AvailableSlot {
  readonly startUtc: string;  // ISO8601
  readonly endUtc: string;
  readonly durationMinutes: number;
}

export interface BookingRecord {
  readonly id: string;
  readonly expertId: string;
  readonly tenantId: string;
  readonly slotStart: string;
  readonly slotEnd: string;
  readonly founderEmail: string;
  readonly topic: string;
  readonly calcomBookingId: string | null;
  readonly status: 'confirmed' | 'cancelled';
  readonly createdAt: string;
}

export interface CreateBookingInput {
  readonly expertId: string;
  readonly slotStart: string;
  readonly founderEmail: string;
  readonly topic: string;
}

const SLOT_DURATION_MINUTES = 30;

/**
 * Returns 30-minute slots available for a given expert on a given UTC date.
 * Reads expert_availability rows and generates all possible start times.
 */
export async function getAvailableSlots(
  _tc: TenantContext,
  client: TenantScopedClient,
  expertId: string,
  dateUtc: string,  // 'YYYY-MM-DD'
): Promise<AvailableSlot[]> {
  const date = new Date(dateUtc + 'T00:00:00Z');
  if (isNaN(date.getTime())) throw new ValidationError('invalid date format (expected YYYY-MM-DD)');

  const dayOfWeek = date.getUTCDay();

  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT start_utc_min, end_utc_min FROM expert_availability
     WHERE expert_id = $1 AND day_of_week = $2
     ORDER BY start_utc_min`,
    [expertId, dayOfWeek],
  );

  const slots: AvailableSlot[] = [];
  for (const row of rows) {
    let cursor = row['start_utc_min'] as number;
    const end = row['end_utc_min'] as number;
    while (cursor + SLOT_DURATION_MINUTES <= end) {
      const startMs = date.getTime() + cursor * 60_000;
      const endMs = startMs + SLOT_DURATION_MINUTES * 60_000;
      slots.push({
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(endMs).toISOString(),
        durationMinutes: SLOT_DURATION_MINUTES,
      });
      cursor += SLOT_DURATION_MINUTES;
    }
  }
  return slots;
}

/**
 * Creates a booking for a given slot. Optionally creates a Cal.com booking
 * when CALCOM_API_KEY is configured.
 */
export async function createBooking(
  tc: TenantContext,
  client: TenantScopedClient,
  input: CreateBookingInput,
): Promise<BookingRecord> {
  const slotStart = new Date(input.slotStart);
  if (isNaN(slotStart.getTime())) throw new ValidationError('invalid slotStart (expected ISO8601)');
  const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MINUTES * 60_000);

  let calcomBookingId: string | null = null;

  const calcomApiKey = process.env['CALCOM_API_KEY'];
  if (calcomApiKey) {
    calcomBookingId = await createCalcomBooking(calcomApiKey, input, slotStart, slotEnd).catch(() => null);
  }

  const { rows } = await client.query<Record<string, unknown>>(
    `INSERT INTO expert_bookings
       (expert_id, tenant_id, slot_start, slot_end, founder_email, topic, calcom_booking_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
     RETURNING *`,
    [
      input.expertId, tc.tenantId,
      slotStart.toISOString(), slotEnd.toISOString(),
      input.founderEmail, input.topic,
      calcomBookingId,
    ],
  );

  return rowToBooking(rows[0]!);
}

async function createCalcomBooking(
  apiKey: string,
  input: CreateBookingInput,
  slotStart: Date,
  slotEnd: Date,
): Promise<string> {
  const res = await fetch('https://api.cal.com/v1/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      eventTypeId: process.env['CALCOM_EVENT_TYPE_ID'] ?? 1,
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      responses: { email: input.founderEmail, notes: input.topic },
      timeZone: 'UTC',
      language: 'en',
    }),
  });
  if (!res.ok) throw new Error(`Cal.com API ${res.status}`);
  const data = await res.json() as { uid: string };
  return data.uid;
}

function rowToBooking(row: Record<string, unknown>): BookingRecord {
  return {
    id: row['id'] as string,
    expertId: row['expert_id'] as string,
    tenantId: row['tenant_id'] as string,
    slotStart: (row['slot_start'] as Date).toISOString(),
    slotEnd: (row['slot_end'] as Date).toISOString(),
    founderEmail: row['founder_email'] as string,
    topic: row['topic'] as string,
    calcomBookingId: (row['calcom_booking_id'] as string | null) ?? null,
    status: row['status'] as BookingRecord['status'],
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}
