export type EmployeeMembershipActionCode =
  | "email_verification_required"
  | "invalid"
  | "memberships_updated"
  | "permission_denied"
  | "reauth_required";

export type EmployeeMembershipActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "memberships_updated";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<
        EmployeeMembershipActionCode,
        "memberships_updated"
      >;
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialEmployeeMembershipActionState: EmployeeMembershipActionState =
  {
    status: "idle"
  };
