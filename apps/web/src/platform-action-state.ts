export type PlatformActionCode =
  | "channel_catalog_invalid"
  | "channel_catalog_updated"
  | "channel_policy_invalid"
  | "channel_policy_updated"
  | "egress_policy_invalid"
  | "egress_policy_updated";

export type PlatformActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code:
        | "channel_catalog_updated"
        | "channel_policy_updated"
        | "egress_policy_updated";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code:
        | "channel_catalog_invalid"
        | "channel_policy_invalid"
        | "egress_policy_invalid";
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialPlatformActionState: PlatformActionState = {
  status: "idle"
};

export function platformActionSuccess(
  code: Extract<PlatformActionState, { status: "success" }>["code"]
): PlatformActionState {
  return {
    code,
    status: "success",
    submittedAt: new Date().toISOString()
  };
}

export function platformActionError(
  code: Extract<PlatformActionState, { status: "error" }>["code"]
): PlatformActionState {
  return {
    code,
    status: "error",
    submittedAt: new Date().toISOString()
  };
}
