import type { WebActionState } from "./web-action-state";

export type EmployeeEmailChangeActionCode =
  | "email_change_duplicate"
  | "email_change_invalid"
  | "email_change_sent"
  | "email_change_unavailable"
  | "email_unchanged"
  | "email_verification_required"
  | "not_configured"
  | "permission_denied"
  | "provider_failed";

export type EmployeeEmailChangeActionState =
  WebActionState<EmployeeEmailChangeActionCode>;

export const initialEmployeeEmailChangeActionState: EmployeeEmailChangeActionState =
  {
    status: "idle"
  };
