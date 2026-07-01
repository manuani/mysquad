/**
 * Shared types for the Notification Service.
 */

export interface NotificationPreferences {
  id: string;
  tenantId: string;
  morningBriefingEnabled: boolean;
  briefingHour: number;
  briefingTimezone: string;
  alertOnHighRisk: boolean;
  alertOnConflict: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRow {
  id: string;
  decision_type: string;
  summary: string;
  state: string;
  created_at: string;
}

export interface ActionRow {
  id: string;
  assigned_to: string;
  state: string;
  due_at: string | null;
  created_at: string;
}

export interface ConflictRow {
  id: string;
  conflict_type: string;
  severity: string;
  resolution_state: string;
  created_at: string;
}

export interface MorningBriefing {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  activity: {
    decisions: DecisionRow[];
    actions: ActionRow[];
    conflicts: ConflictRow[];
  };
}

export interface UpdatePreferencesInput {
  morningBriefingEnabled?: boolean;
  briefingHour?: number;
  briefingTimezone?: string;
  alertOnHighRisk?: boolean;
  alertOnConflict?: boolean;
}

export type AlertType = 'high_risk' | 'conflict' | 'decision';

export interface AlertInput {
  alertType: AlertType;
  entityId: string;
  entityType: string;
  summary: string;
}

/** DB row shape (snake_case) */
export interface PreferencesRow {
  id: string;
  tenant_id: string;
  morning_briefing_enabled: boolean;
  briefing_hour: number;
  briefing_timezone: string;
  alert_on_high_risk: boolean;
  alert_on_conflict: boolean;
  created_at: string;
  updated_at: string;
}
