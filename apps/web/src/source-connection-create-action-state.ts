export type SourceConnectionCreateActionCode =
  | "created"
  | "email_verification_required"
  | "invalid"
  | "module_unhealthy"
  | "permission_denied";

export type SourceConnectionCreateActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly status: "success";
      readonly code: "created";
      readonly sourceConnectionId: string;
      readonly webhookToken?: string;
      readonly submittedAt: string;
    }
  | {
      readonly status: "error";
      readonly code: Exclude<SourceConnectionCreateActionCode, "created">;
      readonly submittedAt: string;
    };

export const initialSourceConnectionCreateActionState: SourceConnectionCreateActionState =
  {
    status: "idle"
  };
