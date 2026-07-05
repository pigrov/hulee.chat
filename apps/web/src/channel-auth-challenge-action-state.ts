export type ChannelAuthChallengeActionCode =
  | "cancelled"
  | "email_verification_required"
  | "invalid"
  | "permission_denied"
  | "started"
  | "submitted";

export type ChannelAuthChallengeActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly challengeId?: string;
      readonly code: "cancelled" | "started" | "submitted";
      readonly connectorId: string;
      readonly status: "success";
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

export type ChannelAuthChallengeActionMessages = Record<
  ChannelAuthChallengeActionCode,
  string
>;

export const initialChannelAuthChallengeActionState: ChannelAuthChallengeActionState =
  {
    status: "idle"
  };

export function channelAuthChallengeActionSuccess(input: {
  readonly challengeId?: string;
  readonly code: "cancelled" | "started" | "submitted";
  readonly connectorId: string;
}): ChannelAuthChallengeActionState {
  return {
    ...input,
    status: "success",
    submittedAt: new Date().toISOString()
  };
}

export function channelAuthChallengeActionError(
  code: Extract<ChannelAuthChallengeActionState, { status: "error" }>["code"]
): ChannelAuthChallengeActionState {
  return {
    code,
    status: "error",
    submittedAt: new Date().toISOString()
  };
}
