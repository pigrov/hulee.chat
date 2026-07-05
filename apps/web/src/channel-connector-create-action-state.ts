export type ChannelConnectorCreateActionCode =
  | "created"
  | "email_verification_required"
  | "invalid"
  | "permission_denied";

export type ChannelConnectorCreateActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "created";
      readonly connectorId: string;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<ChannelConnectorCreateActionCode, "created">;
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialChannelConnectorCreateActionState: ChannelConnectorCreateActionState =
  {
    status: "idle"
  };
