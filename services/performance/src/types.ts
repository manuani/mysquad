/**
 * Shared request/response types for the Performance Service.
 */

export const SIGNAL_TYPES = [
  'factual_grounding',
  'peer_agreement',
  'expert_agreement',
  'founder_action',
  'outcome',
  'pushback',
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const RECORDED_BY_VALUES = ['system', 'founder', 'expert'] as const;
export type RecordedBy = (typeof RECORDED_BY_VALUES)[number];

export function isSignalType(value: unknown): value is SignalType {
  return SIGNAL_TYPES.includes(value as SignalType);
}

export function isRecordedBy(value: unknown): value is RecordedBy {
  return RECORDED_BY_VALUES.includes(value as RecordedBy);
}

// POST /signal

export interface RecordSignalBody {
  sessionId?: string;
  transcriptEntryId?: string;
  personaId: string;
  signalType: SignalType;
  value: number;
  recordedBy: RecordedBy;
  notes?: string;
}

export interface RecordSignalResponse {
  id: string;
  personaId: string;
  signalType: SignalType;
  value: number;
  recordedAt: string;
}

// GET /scores/:personaId

export interface SignalAggregate {
  avg: number;
  count: number;
}

export interface ScoresResponse {
  personaId: string;
  period: {
    days: number;
    from: string;
    to: string;
  };
  signals: Partial<Record<SignalType, SignalAggregate>>;
  overallScore: number;
}

// GET /weekly

export interface WeeklyPersonaSummary {
  personaId: string;
  overallScore: number;
  signalCounts: Partial<Record<SignalType, number>>;
}
