import type { WebActionState } from "./web-action-state";

export type EmployeeProfileActionStatus =
  | "avatar_invalid_type"
  | "avatar_storage_unavailable"
  | "avatar_too_large"
  | "profile_invalid"
  | "phone_invalid";

export type EmployeeProfileActionCode =
  | EmployeeProfileActionStatus
  | "email_verification_required"
  | "permission_denied"
  | "profile_updated";

export type EmployeeProfileActionState =
  WebActionState<EmployeeProfileActionCode>;

export const initialEmployeeProfileActionState: EmployeeProfileActionState = {
  status: "idle"
};
