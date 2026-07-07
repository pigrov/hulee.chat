export type ChannelConnectorSettingsActionCode = "saved" | "invalid";

export type ChannelConnectorSettingsActionState = {
  readonly code: ChannelConnectorSettingsActionCode;
  readonly connectorId?: string;
  readonly status: "idle" | "success" | "error";
  readonly submittedAt?: string;
};

export const initialChannelConnectorSettingsActionState: ChannelConnectorSettingsActionState =
  {
    code: "saved",
    status: "idle"
  };
