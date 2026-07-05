export type RoleActionCode =
  | "assigned"
  | "archived"
  | "created"
  | "direct_grant_created"
  | "direct_grant_revoked"
  | "email_verification_required"
  | "invalid"
  | "permission_denied"
  | "reauth_required"
  | "restored"
  | "revoked"
  | "template_created"
  | "updated";

export type RoleActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: Exclude<
        RoleActionCode,
        | "email_verification_required"
        | "invalid"
        | "permission_denied"
        | "reauth_required"
      >;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code:
        | "email_verification_required"
        | "invalid"
        | "permission_denied"
        | "reauth_required";
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialRoleActionState: RoleActionState = {
  status: "idle"
};
