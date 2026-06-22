export type EntitlementKey =
  | "module.enabled"
  | "seat.active_employee"
  | "storage.gb_month"
  | "transcription.minute"
  | "ai.credit"
  | "api.request"
  | "webhook.event"
  | "retention.day"
  | "deployment.type"
  | "support.sla"
  | "white_label.runtime"
  | "white_label.release_profile";

export type Entitlement = {
  key: EntitlementKey;
  value: string;
  enabled: boolean;
};
