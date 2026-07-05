export type ChannelConnectorLifecycleActionCode =
  | "deleted"
  | "disabled"
  | "enabled"
  | "invalid";

export type ChannelConnectorLifecycleActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: Exclude<ChannelConnectorLifecycleActionCode, "invalid">;
      readonly connectorId: string;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: "invalid";
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialChannelConnectorLifecycleActionState: ChannelConnectorLifecycleActionState =
  {
    status: "idle"
  };
