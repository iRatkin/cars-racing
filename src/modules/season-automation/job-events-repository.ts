import type { SeasonAutomationEventType } from "./season-schedule.js";

export type JobEventStatus = "started" | "completed" | "failed";
export type JobEventSource = "cron" | "admin" | "api";
export type JobEventOutcome = "sent" | "suppressed";

export interface JobEventClaimInput {
  eventKey: string;
  eventType: SeasonAutomationEventType | "season_window_created";
  seasonId: string;
  scheduledAt: Date;
  source?: JobEventSource;
}

export interface JobEventClaimResult {
  claimed: boolean;
  eventKey: string;
  scheduledAt: Date;
}

export interface JobEventCompletionInput {
  source?: JobEventSource;
  outcome?: JobEventOutcome;
  reason?: string;
}

export interface JobEventSuppressInput {
  eventKey: string;
  eventType: SeasonAutomationEventType | "season_window_created";
  seasonId: string;
  scheduledAt: Date;
  source: JobEventSource;
  reason: string;
}

export interface JobEventsRepository {
  claimEvent(input: JobEventClaimInput): Promise<JobEventClaimResult>;
  markCompleted(eventKey: string, completion?: JobEventCompletionInput): Promise<void>;
  markFailed(eventKey: string, error: string): Promise<void>;
  suppressEvent(input: JobEventSuppressInput): Promise<void>;
}
