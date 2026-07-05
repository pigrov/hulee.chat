export type OrgStructureActionCode =
  | "email_verification_required"
  | "invalid"
  | "org_unit_archived"
  | "org_unit_restored"
  | "org_unit_saved"
  | "team_saved"
  | "work_queue_archived"
  | "work_queue_restored"
  | "work_queue_saved";

export type OrgStructureActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: Exclude<
        OrgStructureActionCode,
        "email_verification_required" | "invalid"
      >;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: "email_verification_required" | "invalid";
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialOrgStructureActionState: OrgStructureActionState = {
  status: "idle"
};
