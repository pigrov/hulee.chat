export type EmployeeAdminActionCode =
  | "deactivated"
  | "email_verification_required"
  | "invalid"
  | "invite_revoked"
  | "not_configured"
  | "permission_denied"
  | "provider_failed"
  | "sent";

export type EmployeeAdminActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "deactivated" | "invite_revoked" | "sent";
      readonly manualInviteUrl?: string;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: "not_configured" | "provider_failed";
      readonly manualInviteUrl: string;
      readonly status: "info";
      readonly submittedAt: string;
    }
  | {
      readonly code:
        | "email_verification_required"
        | "invalid"
        | "permission_denied";
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialEmployeeAdminActionState: EmployeeAdminActionState = {
  status: "idle"
};
