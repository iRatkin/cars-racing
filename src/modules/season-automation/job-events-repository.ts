import type { SeasonAutomationEventType } from "./season-schedule.js";

export type JobEventStatus = "started" | "completed" | "failed";

export interface JobEventClaimInput {
  eventKey: string;
  eventType: SeasonAutomationEventType | "season_window_created";
  seasonId: string;
  scheduledAt: Date;
}

export interface JobEventClaimResult {
  claimed: boolean;
  eventKey: string;
  scheduledAt: Date;
}

export interface JobEventsRepository {
  claimEvent(input: JobEventClaimInput): Promise<JobEventClaimResult>;
  markCompleted(eventKey: string): Promise<void>;
  markFailed(eventKey: string, error: string): Promise<void>;
}
